/**
 * Kritical Lens — SCXCODE WEBVIEW LENS (.5228): a repeatable static sweep for the CLASSES of bug that
 * bit us this session, so future regressions are caught before they ship instead of by screenshot.
 *
 * It lenses the built extension bundle + package.json and reports, per class:
 *   C1 UNWIRED-CONTROL   — an interactive element id="X" with no onclick/onchange/oninput handler.
 *   C2 DEAD-MESSAGE      — a webview postMessage({type:'X'}) with no matching host handler (dead button).
 *   C3 ORPHAN-COMMAND    — a package.json command with no registerCommand in the bundle (palette no-op).
 *   C4 CONTRAST-RISK     — a <select> with no explicit option colour rule (white-on-white popup risk).
 *   C5 BLANKABLE-CONTROL — the model <select> with no preseed population (empty-dropdown risk).
 *   C6 UNHANDLED-CONFIG  — a config key the host sends that the webview never applies (silent-drop risk).
 *
 * Exit non-zero on any finding when run with --strict (wire into CI as a never-regress gate).
 * Run: node lens/Invoke-KritScxCodeWebviewLens.js [--strict] [--json]
 */
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const bundle = fs.readFileSync(path.join(ROOT, 'src', 'out', 'extension.js'), 'utf8');
const source = fs.readFileSync(path.join(ROOT, 'src', 'extension.ts'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'package.json'), 'utf8'));
const STRICT = process.argv.includes('--strict');
const AS_JSON = process.argv.includes('--json');

// the chat webview HTML+script is embedded in source/bundle. Prefer source so a Looking Glass snippet
// cannot satisfy the first <div class="top"> match and blind the control lens.
const chatStart = source.indexOf('function chatHtml()');
const chatSource = chatStart >= 0 ? source.slice(chatStart) : source;
const htmlMatch = chatSource.match(/<div class="top">[\s\S]*?<\/body>/) || bundle.match(/<div class="top">[\s\S]*?<\/body>/);
const html = htmlMatch ? htmlMatch[0] : '';
const scriptZone = bundle.slice(bundle.indexOf('acquireVsCodeApi'), bundle.indexOf('vscode.postMessage({ type: \'config\' })') + 200);

const findings = [];
const add = (cls, detail) => findings.push({ cls, detail });

const Q = "['\"]"; // quote-agnostic: esbuild normalizes the bundle's string quotes.

// ---- C1 UNWIRED-CONTROL: every id="X" control must have a handler. Map id -> declared var name
// (const X = document.getElementById('id')) since handlers use arbitrary var names, not always <id>El. ----
const ids = [...html.matchAll(/id="([a-zA-Z0-9_-]+)"/g)].map((m) => m[1]);
const CONTROL_IDS = ids.filter((id) => /button|select|input|textarea/i.test(
  (html.match(new RegExp('<[^>]*id="' + id + '"[^>]*>')) || [''])[0]) && !['tempVal','tempSrc','ctxChip','adv','chat'].includes(id));
const idVar = {};
for (const m of bundle.matchAll(/(?:const|let|var)\s+(\w+)\s*=\s*document\.getElementById\(['"]([\w-]+)['"]\)/g)) { idVar[m[2]] = m[1]; }
for (const id of [...new Set(CONTROL_IDS)]) {
  const v = idVar[id];
  const wired =
    (v && new RegExp('\\b' + v + '\\.(onclick|onchange|oninput|onkeydown)').test(bundle)) ||
    new RegExp('getElementById\\(' + Q + id + Q + '\\)\\.(onclick|onchange|oninput|onkeydown)').test(bundle) ||
    new RegExp('\\b' + id + 'El\\.(onclick|onchange|oninput|onkeydown)').test(bundle);
  if (!wired) { add('C1 UNWIRED-CONTROL', `#${id} has no onclick/onchange/oninput handler`); }
}

// ---- C2 DEAD-MESSAGE: every webview-sent message type must have a host-side handler ----
const sentTypes = [...new Set([...scriptZone.matchAll(/postMessage\(\{\s*type:\s*'([a-zA-Z]+)'/g)].map((m) => m[1]))];
for (const t of sentTypes) {
  if (t === 'config') { continue; } // config is the request; handled below
  const handled = new RegExp('(msg|m)\\.type\\s*===\\s*' + Q + t + Q).test(bundle);
  if (!handled) { add('C2 DEAD-MESSAGE', `webview posts '${t}' but no host handler (msg.type === '${t}')`); }
}

// ---- C3 ORPHAN-COMMAND: every declared command must be registered ----
for (const c of (pkg.contributes?.commands || [])) {
  if (!(bundle.includes(`'${c.command}'`) || bundle.includes(`"${c.command}"`))) { add('C3 ORPHAN-COMMAND', `${c.command} declared in package.json but not registered in bundle`); }
}

// ---- C4 CONTRAST-RISK: any <select> requires an explicit option colour rule ----
const hasOptionRule = /select option\s*\{[^}]*color/.test(bundle);
if (html.includes('<select') && !hasOptionRule) { add('C4 CONTRAST-RISK', 'a <select> exists but no "select option { color }" rule — white-on-white popup risk'); }

// ---- C5 BLANKABLE-CONTROL: the model select must be preseeded so it is never blank ----
if (html.includes('id="model"') && !/PRESEED the model dropdown/.test(bundle)) {
  add('C5 BLANKABLE-CONTROL', '#model select has no preseed population — can render blank before host config');
}

// ---- C6 UNHANDLED-CONFIG: keys the host sends in a config message the webview must apply ----
const cfgSendMatch = bundle.match(/type:\s*'config'[^}]*\}/g) || [];
const sentKeys = [...new Set([].concat(...cfgSendMatch.map((s) => [...s.matchAll(/(\w+):/g)].map((m) => m[1]))))]
  .filter((k) => !['type'].includes(k));
for (const k of sentKeys) {
  // the webview applies a key either as m.<key> or by populating models/model
  const applied = new RegExp('m\\.' + k + '\\b').test(bundle) || ['models','keyCount'].includes(k);
  if (!applied) { add('C6 UNHANDLED-CONFIG', `host sends config.${k} but the webview never reads m.${k}`); }
}

// ---- report ----
const byClass = {};
for (const f of findings) { (byClass[f.cls] = byClass[f.cls] || []).push(f.detail); }
if (AS_JSON) {
  console.log(JSON.stringify({ ok: findings.length === 0, count: findings.length, findings }, null, 2));
} else {
  console.log('===== SCXCODE WEBVIEW LENS =====');
  const CLASSES = ['C1 UNWIRED-CONTROL','C2 DEAD-MESSAGE','C3 ORPHAN-COMMAND','C4 CONTRAST-RISK','C5 BLANKABLE-CONTROL','C6 UNHANDLED-CONFIG'];
  for (const c of CLASSES) {
    const hits = byClass[c] || [];
    console.log(`  ${hits.length === 0 ? 'PASS' : 'FAIL(' + hits.length + ')'}  ${c}`);
    for (const h of hits) { console.log(`         - ${h}`); }
  }
  console.log(`\n  TOTAL FINDINGS: ${findings.length}   controls=${[...new Set(CONTROL_IDS)].length}  sentMsgTypes=${sentTypes.length}  commands=${(pkg.contributes?.commands||[]).length}`);
}
process.exit((STRICT && findings.length) ? 1 : 0);
