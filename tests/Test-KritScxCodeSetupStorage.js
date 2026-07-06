/**
 * Regression lock for the Setup GUI storage picker. The SCXCode pane must expose
 * the SQLite/MSSQL backing-store controls and save them without touching native
 * OpenAI/Anthropic settings.
 * Run: node tests/Test-KritScxCodeSetupStorage.js
 */
const fs = require('fs'), path = require('path'), Module = require('module'), vm = require('vm');
const bundle = path.join(__dirname, '..', 'src', 'out', 'extension.js');
const code = fs.readFileSync(bundle, 'utf8') + '\nmodule.exports.__setupGuiHtml=(typeof setupGuiHtml==="function")?setupGuiHtml:null;';
const originalLoad = Module._load;
Module._load = function (request, ...args) {
  if (request === 'vscode') return new Proxy({}, { get: () => () => ({}) });
  return originalLoad.call(this, request, ...args);
};
const mod = new Module(bundle, null); mod.filename = bundle; mod.paths = Module._nodeModulePaths(path.dirname(bundle)); mod._compile(code, bundle);
const html = mod.exports.__setupGuiHtml('');
const script = html.match(/<script[^>]*>([\s\S]*?)<\/script>/)[1];

let pass = 0, fail = 0;
function ok(name, condition) { if (condition) { pass++; } else { fail++; console.log('  FAIL ' + name); } }

const required = ['sx-base', 'sx-model', 'sx-storage', 'sx-storage-note', 'sx-sqlite-path', 'sx-mssql-server', 'sx-mssql-db', 'save-scxcode'];
console.log('--- 1. storage controls exist in setup HTML ---');
required.forEach(id => ok('#' + id + ' present', html.includes('id="' + id + '"')));
ok('auto storage option present', html.includes('value="auto"'));
ok('sqlite storage option present', html.includes('value="sqlite"'));
ok('mssql storage option present', html.includes('value="mssql"'));

const posted = [];
const listeners = {};
function el(id) {
  return {
    id, value: '', _text: '', _html: '', options: [], dataset: {}, style: {},
    classList: { add() {}, remove() {} },
    getContext: () => ({ clearRect(){}, beginPath(){}, arc(){}, fill(){}, moveTo(){}, lineTo(){}, stroke(){}, createRadialGradient(){ return { addColorStop() {} }; } }),
    appendChild(child) { this.options.push(child); },
    querySelectorAll() { return []; },
    querySelector() { return el('child'); },
    click() { if (this.onclick_) this.onclick_(); },
    set onclick(fn) { this.onclick_ = fn; },
    set onchange(fn) { this.onchange_ = fn; },
    set textContent(v) { this._text = v; },
    get textContent() { return this._text; },
    set innerHTML(v) { this._html = v; if (v === '') this.options = []; },
    get innerHTML() { return this._html; },
  };
}
const elements = {};
required.concat(['sky', 'cfgpath', 'cx-model', 'cx-model-note', 'cx-sandbox', 'cx-reasoning', 'cx-approval', 'cx-summary', 'cx-verbosity', 'mcp-rows', 'status', 'pdot', 'msg-scxcode']).forEach(id => elements[id] = el(id));
const sandbox = {
  acquireVsCodeApi: () => ({ postMessage: msg => posted.push(msg) }),
  document: {
    getElementById: id => elements[id] || (elements[id] = el(id)),
    createElement: () => el('option'),
    querySelectorAll: () => [],
    querySelector: () => null,
  },
  window: { addEventListener: (type, fn) => { (listeners[type] = listeners[type] || []).push(fn); } },
  Math, JSON, setTimeout() {}, requestAnimationFrame() {}, console,
};

console.log('--- 2. setup script loads and hydrates controls ---');
try { vm.createContext(sandbox); vm.runInContext(script, sandbox, { timeout: 3000 }); ok('script loads', true); }
catch (error) { ok('script loads', false); console.log('  ' + error.message); }
ok('requests setup data on load', posted.some(msg => msg.type === 'load'));
ok('message listener attached', (listeners.message || []).length === 1);

listeners.message[0]({ data: {
  type: 'data',
  models: ['MiniMax-M2.7', 'coder'],
  codexConfigPath: 'C:/Users/test/.codex/config.toml',
  codex: { model: '', sandbox_mode: 'danger-full-access', model_reasoning_effort: 'high', approval_policy: 'never', model_reasoning_summary: 'auto', model_verbosity: 'medium' },
  mcp: [],
  scxcode: {
    baseUrl: 'https://api.scx.ai',
    defaultModel: 'MiniMax-M2.7',
    apiKeySet: true,
    keyCount: 2,
    storageBackend: 'mssql',
    sqliteStorePath: 'D:/scx/scxcode-store.db',
    sqliteResolvedPath: 'D:/scx/scxcode-store.db',
    mssqlServer: '.\\SQLEXPRESS',
    mssqlDatabase: 'KriticalSCXCodeStore',
  },
} });
ok('storage backend hydrates', elements['sx-storage'].value === 'mssql');
ok('sqlite path hydrates', elements['sx-sqlite-path'].value === 'D:/scx/scxcode-store.db');
ok('mssql server hydrates', elements['sx-mssql-server'].value === '.\\SQLEXPRESS');
ok('mssql database hydrates', elements['sx-mssql-db'].value === 'KriticalSCXCodeStore');
ok('storage note mentions SQL target', elements['sx-storage-note'].innerHTML.includes('KriticalSCXCodeStore'));

console.log('--- 3. save posts storage settings ---');
posted.length = 0;
elements['sx-storage'].value = 'sqlite';
elements['sx-sqlite-path'].value = 'E:/krit/local.db';
elements['sx-mssql-server'].value = '.\\SQLEXPRESS';
elements['sx-mssql-db'].value = 'KriticalSCXCodeStore';
elements['save-scxcode'].onclick_();
const saved = posted.find(msg => msg.type === 'saveScxcode');
ok('saveScxcode posted', !!saved);
ok('save includes storageBackend', saved && saved.storageBackend === 'sqlite');
ok('save includes sqliteStorePath', saved && saved.sqliteStorePath === 'E:/krit/local.db');
ok('save includes mssqlServer', saved && saved.mssqlServer === '.\\SQLEXPRESS');
ok('save includes mssqlDatabase', saved && saved.mssqlDatabase === 'KriticalSCXCodeStore');

console.log('\n===== SETUP STORAGE UI: ' + pass + ' passed, ' + fail + ' failed =====');
process.exit(fail === 0 ? 0 : 1);
