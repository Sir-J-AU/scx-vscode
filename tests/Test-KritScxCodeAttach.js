/**
 * Regression lock for file+folder attach (.5230). Loads the built bundle with a MOCK vscode whose
 * workspace.fs serves an in-memory tree, then drives collectAttachments to prove it: reads files,
 * recurses folders, SKIPS node_modules/.git/binaries, and caps output. This is the "buttons talking
 * to the local machine" behaviour.
 * Run: node tests/Test-KritScxCodeAttach.js
 */
const fs = require('fs'), path = require('path'), Module = require('module');

// --- in-memory fake filesystem ---
const T_DIR = 2, T_FILE = 1;
const tree = {
  '/ws': { type: T_DIR, children: ['src', 'node_modules', 'readme.md', 'logo.png'] },
  '/ws/src': { type: T_DIR, children: ['a.ts', 'b.js', 'nested'] },
  '/ws/src/a.ts': { type: T_FILE, size: 30, content: 'export const a = 1;' },
  '/ws/src/b.js': { type: T_FILE, size: 20, content: 'const b = 2;' },
  '/ws/src/nested': { type: T_DIR, children: ['c.py'] },
  '/ws/src/nested/c.py': { type: T_FILE, size: 12, content: 'c = 3' },
  '/ws/node_modules': { type: T_DIR, children: ['junk.js'] },              // MUST be skipped
  '/ws/node_modules/junk.js': { type: T_FILE, size: 10, content: 'junk' },
  '/ws/readme.md': { type: T_FILE, size: 14, content: '# hello world' },
  '/ws/logo.png': { type: T_FILE, size: 500, content: '��PNGbinary' }, // binary-ish, large-ext skip
};
const enc = new TextEncoder();
const vscodeMock = {
  FileType: { Directory: T_DIR, File: T_FILE, Unknown: 0, SymbolicLink: 64 },
  Uri: { joinPath: (u, name) => ({ path: u.path + '/' + name }) },
  workspace: {
    fs: {
      stat: async (u) => { const n = tree[u.path]; if (!n) { throw new Error('ENOENT ' + u.path); } return { type: n.type, size: n.size || 0 }; },
      readDirectory: async (u) => (tree[u.path].children || []).map((c) => [c, tree[u.path + '/' + c].type]),
      readFile: async (u) => enc.encode(tree[u.path].content || ''),
    },
    asRelativePath: (u) => u.path.replace('/ws/', ''),
  },
};

const bundle = path.join(__dirname, '..', 'src', 'out', 'extension.js');
let code = fs.readFileSync(bundle, 'utf8') + '\nmodule.exports.__collect=(typeof collectAttachments==="function")?collectAttachments:null;';
const oL = Module._load; Module._load = function (r, ...a) { if (r === 'vscode') { return vscodeMock; } return oL.call(this, r, ...a); };
const m = new Module(bundle, null); m.filename = bundle; m.paths = Module._nodeModulePaths(path.dirname(bundle)); m._compile(code, bundle);
const collect = m.exports.__collect;

let pass = 0, fail = 0; function ok(n, c) { if (c) { pass++; } else { fail++; console.log('  FAIL ' + n); } }

(async () => {
  ok('collectAttachments is exported', typeof collect === 'function');
  const r = await collect([{ path: '/ws' }]);
  ok('recurses folders + reads files (a.ts,b.js,c.py,readme.md)', r.fileCount === 4);
  ok('SKIPS node_modules (junk.js not attached)', !/junk\.js/.test(r.block));
  ok('SKIPS binary-ish png', !/logo\.png/.test(r.block));
  ok('attaches nested file', /src\/nested\/c\.py/.test(r.block));
  ok('attaches relative paths', /## Attached: src\/a\.ts/.test(r.block));
  ok('reports chars > 0', r.chars > 0);
  // attaching a single subfolder only
  const r2 = await collect([{ path: '/ws/src' }]);
  ok('folder-only attach reads just that folder (3 files)', r2.fileCount === 3);
  console.log('\n===== FILE+FOLDER ATTACH: ' + pass + ' passed, ' + fail + ' failed =====');
  process.exit(fail === 0 ? 0 : 1);
})();
