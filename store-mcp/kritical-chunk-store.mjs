// Kritical SCX — CHUNK STORE: open + edit MASSIVE files across synthetic context, never choking.
//
// A file that doesn't fit a model window is split into semantic chunks stored EXTERNALLY (SQLite here;
// SQL Server mirror in sql/chunk-store-schema.sql). To edit, the model is given a synthetic window:
// the FOCUS chunk(s) in FULL + a compressed MAP (per-chunk summary + line range + symbols) of the rest.
// The model edits the focus chunk; `apply` writes it back and reassembles the whole file byte-safely.
// This is how you "open a massive code file and edit perfectly across synthetic context."
//
//   node kritical-chunk-store.mjs chunk <file>                     split + store (+ round-trip verify)
//   node kritical-chunk-store.mjs map <file>                       print the synthetic whole-file map
//   node kritical-chunk-store.mjs context <file> <focus> [budget]  synthetic edit window (focus full + map)
//   node kritical-chunk-store.mjs apply <file> <idx> <newFile>     replace chunk <idx> with <newFile>, reassemble
//   node kritical-chunk-store.mjs reassemble <file> [outFile]      rebuild file from chunks
//   node kritical-chunk-store.mjs summarize <file> "<idx>:<text>"  set a chunk's synthetic summary
//
// Author: Joshua Finley — Kritical Pty Ltd — (c) 2026.
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import { homedir } from 'node:os';
import { join, dirname, extname } from 'node:path';
import { pathToFileURL } from 'node:url';

const DB_PATH = process.env.KRIT_CHUNK_STORE || join(homedir(), '.kritical-scx', 'chunk-store.db');
mkdirSync(dirname(DB_PATH), { recursive: true });

// Semantic boundary: a line that starts a new top-level construct (TS/JS/PS/AL/Python/SQL).
const BOUNDARY = /^(?:export\s+)?(?:async\s+)?(?:function|class|const|let|var|interface|type|enum)\b|^\s*(?:function|def|class|procedure|local\s+procedure|trigger)\b|^\s*(?:codeunit|table(?:extension)?|page(?:extension)?|report|enum|query|xmlport|permissionset)\s+\d|^(?:CREATE|ALTER)\s+(?:TABLE|VIEW|PROC|FUNCTION|INDEX)\b/i;
const SYMBOL = /^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)|^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=|^\s*(?:export\s+)?class\s+([A-Za-z_$][\w$]*)|^\s*def\s+([A-Za-z_]\w*)|^\s*(?:local\s+)?procedure\s+([A-Za-z_]\w*)|^\s*(?:codeunit|table|page)\s+\d+\s+"?([^"\n]+)/i;

function db() { const d = new DatabaseSync(DB_PATH); d.exec('PRAGMA journal_mode=WAL;'); return d; }
function ensure(d) {
  d.exec(`CREATE TABLE IF NOT EXISTS files(file TEXT PRIMARY KEY, lang TEXT, loc INT, sha TEXT, n_chunks INT, synopsis TEXT, mined_utc TEXT);
          CREATE TABLE IF NOT EXISTS chunks(file TEXT, idx INT, start_line INT, end_line INT, sha TEXT, symbols TEXT, content TEXT, summary TEXT, PRIMARY KEY(file, idx));
          CREATE INDEX IF NOT EXISTS ix_chunks_file ON chunks(file);
          -- .5231 6502 content-addressing: each unique chunk body stored ONCE by SHA; chunks reference it.
          -- codec = storage tier for that blob: 'raw' text, or 'gz' (gzip -> base64) when that is actually smaller.
          CREATE TABLE IF NOT EXISTS blobs(sha TEXT PRIMARY KEY, codec TEXT, content TEXT);`);
  // migrate a pre-tier blobs table (sha,content) in place — add the codec column; existing rows read as raw.
  if (!d.prepare('PRAGMA table_info(blobs)').all().some((c) => c.name === 'codec')) d.exec('ALTER TABLE blobs ADD COLUMN codec TEXT');
}

// .5231 6502 compression tier: pick the SMALLEST representation per blob. gzip then base64 inflates ~33%,
// so gz only wins on genuinely compressible bodies (repeated code, boilerplate) — tiny/incompressible chunks
// stay raw automatically. Fully reversible: decodeBlob is the exact inverse. Byte-safety is preserved.
function encodeBlob(content) {
  const raw = Buffer.byteLength(content, 'utf8');
  const b64 = gzipSync(Buffer.from(content, 'utf8')).toString('base64');
  return b64.length < raw ? { codec: 'gz', stored: b64 } : { codec: 'raw', stored: content };
}
const decodeBlob = (codec, stored) => (codec === 'gz' ? gunzipSync(Buffer.from(stored, 'base64')).toString('utf8') : stored);

// read a file's chunks, materialising content from the SHA-keyed blob (fallback to any inline content) + decoding the tier.
function chunkRows(d, file) {
  const rs = d.prepare('SELECT c.idx idx, c.start_line start_line, c.end_line end_line, c.symbols symbols, b.codec codec, COALESCE(b.content, c.content) content, c.summary summary FROM chunks c LEFT JOIN blobs b ON b.sha=c.sha WHERE c.file=? ORDER BY c.idx').all(file);
  for (const r of rs) { r.content = decodeBlob(r.codec, r.content); delete r.codec; }
  return rs;
}
const sha = (s) => createHash('sha256').update(s, 'utf8').digest('hex');

// Split source into semantic chunks: break at top-level boundaries, keep each within [minLines, maxLines].
export function chunkText(src, { maxLines = 140, minLines = 24 } = {}) {
  const lines = src.split('\n');
  const spans = []; let start = 0;
  for (let i = 1; i < lines.length; i++) {
    const size = i - start;
    if ((BOUNDARY.test(lines[i]) && size >= minLines) || size >= maxLines) { spans.push([start, i - 1]); start = i; }
  }
  spans.push([start, lines.length - 1]);
  return spans.map(([s, e]) => {
    const content = lines.slice(s, e + 1).join('\n');
    const syms = new Set();
    for (const ln of lines.slice(s, e + 1)) { const m = ln.match(SYMBOL); if (m) { const n = m.slice(1).find(Boolean); if (n) syms.add(n.trim()); } }
    return { start: s + 1, end: e + 1, content, symbols: [...syms].join(',') };
  });
}

function chunkFile(file) {
  const src = readFileSync(file, 'utf8');
  const d = db(); ensure(d);
  const chunks = chunkText(src);
  d.exec('BEGIN');
  d.prepare('DELETE FROM chunks WHERE file=?').run(file);
  // content-addressed: store each unique body once in blobs; chunk rows reference it by SHA (content=NULL).
  const blobIns = d.prepare('INSERT OR IGNORE INTO blobs(sha,codec,content) VALUES(?,?,?)');
  const ins = d.prepare('INSERT INTO chunks(file,idx,start_line,end_line,sha,symbols,content,summary) VALUES(?,?,?,?,?,?,NULL,NULL)');
  chunks.forEach((c, i) => { const h = sha(c.content); const e = encodeBlob(c.content); blobIns.run(h, e.codec, e.stored); ins.run(file, i, c.start, c.end, h, c.symbols); });
  d.prepare('INSERT OR REPLACE INTO files(file,lang,loc,sha,n_chunks,synopsis,mined_utc) VALUES(?,?,?,?,?,?,?)')
    .run(file, extname(file).slice(1), src.split('\n').length, sha(src), chunks.length, null, new Date().toISOString());
  d.exec('COMMIT');
  // round-trip verify: reassembled chunks must equal the original byte-for-byte
  const rebuilt = chunks.map((c) => c.content).join('\n');
  const ok = rebuilt === src;
  console.log(`[chunk] ${file}: ${chunks.length} chunks / ${src.split('\n').length} lines -> ${DB_PATH}  round-trip=${ok ? 'OK' : 'MISMATCH'}`);
  if (!ok) process.exitCode = 1;
}

function rows(file) { const d = db(); ensure(d); return chunkRows(d, file); }

// One compact map line per chunk: idx, line range, symbols, and a summary (SCX) or first-line preview.
function mapLine(r) {
  const preview = (r.summary && r.summary.trim()) || (r.content.split('\n').find((l) => l.trim()) || '').trim().slice(0, 100);
  const syms = r.symbols ? ` {${r.symbols}}` : '';
  return `  [#${r.idx}] L${r.start_line}-${r.end_line}${syms}: ${preview}`;
}

function printMap(file) {
  const rs = rows(file);
  if (!rs.length) { console.log(`(no chunks for ${file} — run: chunk ${file})`); return; }
  console.log(`SYNTHETIC MAP — ${file} (${rs.length} chunks):`);
  for (const r of rs) console.log(mapLine(r));
}

// The synthetic edit window: the FOCUS chunk(s) in full + a MAP of every other chunk, within a char budget.
export function buildContext(fileRows, focus, budget = 12000) {
  const raw = String(focus || '').trim();
  const isNum = /^\d+$/.test(raw);
  const terms = raw.toLowerCase().split(/\s+/).filter((t) => t.length > 2); // multi-term: match ANY identifier
  const focusIdx = new Set();
  for (const r of fileRows) {
    if (isNum) { const n = +raw; if (n >= r.start_line && n <= r.end_line) focusIdx.add(r.idx); continue; }
    const hay = ((r.symbols || '') + ' ' + r.content).toLowerCase();
    if (terms.some((t) => hay.includes(t))) focusIdx.add(r.idx);
  }
  if (!focusIdx.size && fileRows.length) focusIdx.add(fileRows[0].idx); // fall back to first chunk
  const header = `# SYNTHETIC EDIT CONTEXT (${fileRows.length} chunks; focus=[${[...focusIdx].join(',')}]). Chunks not shown in full live in external storage — request them by #idx.\n`;
  let out = header;
  // 1) the FOCUS chunk(s) in FULL first — the editable region is guaranteed (always at least the first one).
  for (const r of fileRows) {
    if (!focusIdx.has(r.idx)) continue;
    const block = `--- FOCUS CHUNK #${r.idx} (lines ${r.start_line}-${r.end_line}) — EDIT THIS ---\n${r.content}\n--- END CHUNK #${r.idx} ---\n`;
    if (out.length + block.length > budget && out.length > header.length) break; // keep at least one focus chunk
    out += block + '\n';
  }
  // 2) the WHOLE-FILE MAP fills the remaining budget (truncated if the file is enormous).
  let map = 'WHOLE-FILE MAP:\n';
  for (const r of fileRows) { const ml = mapLine(r) + '\n'; if (out.length + map.length + ml.length > budget) break; map += ml; }
  out += map;
  return { text: out, focus: [...focusIdx] };
}

function printContext(file, focus, budget) {
  const rs = rows(file);
  if (!rs.length) { console.log(`(no chunks — run: chunk ${file})`); return; }
  const { text, focus: f } = buildContext(rs, focus, budget);
  console.log(text);
  console.error(`[context] ${file} focus=${JSON.stringify(f)} -> ${text.length} chars (budget ${budget})`);
}

function reassemble(file, outFile) {
  const rs = rows(file);
  if (!rs.length) { console.log(`(no chunks for ${file})`); process.exitCode = 1; return; }
  const text = rs.map((r) => r.content).join('\n');
  if (outFile) { writeFileSync(outFile, text, 'utf8'); console.log(`[reassemble] ${file} -> ${outFile} (${text.length} chars, sha ${sha(text).slice(0, 12)})`); }
  else console.log(text);
  return text;
}

function applyChunk(file, idx, newFile) {
  const d = db(); ensure(d);
  const newContent = readFileSync(newFile, 'utf8').replace(/\n$/, '');
  const existing = d.prepare('SELECT idx FROM chunks WHERE file=? AND idx=?').get(file, +idx);
  if (!existing) { console.error(`[apply] no chunk #${idx} for ${file}`); process.exitCode = 1; return; }
  const startEnd = d.prepare('SELECT start_line,end_line FROM chunks WHERE file=? AND idx=?').get(file, +idx);
  const newLoc = newContent.split('\n').length;
  const h = sha(newContent);
  const e = encodeBlob(newContent);
  d.prepare('INSERT OR IGNORE INTO blobs(sha,codec,content) VALUES(?,?,?)').run(h, e.codec, e.stored);   // content-addressed + tiered
  d.prepare('UPDATE chunks SET content=NULL, sha=?, end_line=? WHERE file=? AND idx=?')
    .run(h, startEnd.start_line + newLoc - 1, file, +idx);
  // renumber downstream line ranges + reassemble the file to disk (content materialised via blob join)
  const rs = chunkRows(d, file);
  let line = 1;
  for (const r of rs) { const loc = r.content.split('\n').length; d.prepare('UPDATE chunks SET start_line=?, end_line=? WHERE file=? AND idx=?').run(line, line + loc - 1, file, r.idx); line += loc; }
  const text = rs.map((r) => r.content).join('\n');
  writeFileSync(file, text.endsWith('\n') ? text : text + '\n', 'utf8');
  d.prepare('UPDATE files SET sha=?, loc=?, mined_utc=? WHERE file=?').run(sha(text), text.split('\n').length, new Date().toISOString(), file);
  console.log(`[apply] ${file} chunk #${idx} updated -> reassembled ${text.split('\n').length} lines (sha ${sha(text).slice(0, 12)})`);
}

function summarize(file, spec) {
  const [idx, ...rest] = spec.split(':');
  const d = db(); ensure(d);
  d.prepare('UPDATE chunks SET summary=? WHERE file=? AND idx=?').run(rest.join(':').trim(), file, +idx);
  console.log(`[summarize] ${file} #${idx} summary set`);
}

// Only run the CLI when executed directly — so importing chunkText/buildContext is side-effect-free.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [cmd, file, a3, a4] = process.argv.slice(2);
  if (cmd === 'chunk') chunkFile(file);
  else if (cmd === 'map') printMap(file);
  else if (cmd === 'context') printContext(file, a3 || '1', a4 ? +a4 : 12000);
  else if (cmd === 'apply') applyChunk(file, a3, a4);
  else if (cmd === 'reassemble') reassemble(file, a3);
  else if (cmd === 'summarize') summarize(file, a3);
  else console.log('usage: chunk <file> | map <file> | context <file> <focus> [budget] | apply <file> <idx> <newFile> | reassemble <file> [out] | summarize <file> "<idx>:<text>"');
}
