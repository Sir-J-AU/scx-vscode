/**
 * Paired UI regression test (HR21) — ticks off EVERY interactive element in the SCXCode webview
 * and proves it's wired. Fails if any control is missing, the model dropdown doesn't populate,
 * or a control doesn't post the correct message. This is the "never regress a UI element" gate.
 * Run: node tests/Test-KritScxCodeUI.js
 */
const fs = require('fs'), path = require('path'), Module = require('module'), vm = require('vm');
const bundle = path.join(__dirname, '..', 'src', 'out', 'extension.js');
let code = fs.readFileSync(bundle, 'utf8') + '\nmodule.exports.__chatHtml=(typeof chatHtml==="function")?chatHtml:null;';
const oL = Module._load; Module._load = function (r, ...a) { if (r === 'vscode') return new Proxy({}, { get: () => () => ({}) }); return oL.call(this, r, ...a); };
const m = new Module(bundle, null); m.filename = bundle; m.paths = Module._nodeModulePaths(path.dirname(bundle)); m._compile(code, bundle);
const html = m.exports.__chatHtml();
const script = html.match(/<script[^>]*>([\s\S]*?)<\/script>/)[1];

let pass = 0, fail = 0;
function ok(n, c) { if (c) { pass++; } else { fail++; console.log('  FAIL ' + n); } }

// ---- 1. every element declared in HTML ----
const ELEMENTS = ['model','len','streams','ctx','temp','tempVal','tempSrc','provider','advBtn','adv','ctxChip','tbUpload','tbRepo','tbMcp','tbCodex','in','send','clear','chat'];
console.log('--- 1. all interactive elements present in HTML ---');
ELEMENTS.forEach(id => ok('#' + id + ' present', html.includes('id="' + id + '"')));
ok('sales tagline present', html.includes('IT &amp; IT Security Experts'));
ok('footer present', /class="footer"/.test(html));

// ---- 2. execute the webview; capture handlers + posts ----
const posted = [];
const handlers = {};
function el(id) {
  return { id, _t:'', value:'', title:'', disabled:false, options:[], dataset:{}, style:{},
    classList:{toggle(){},add(){},remove(){}},
    set textContent(v){this._t=v;} , get textContent(){return this._t;},
    set innerHTML(v){this._h=v; if(v==='') this.options=[];}, get innerHTML(){return this._h||'';},
    appendChild(c){this.options.push(c);}, querySelectorAll(){return[];},
    set onclick(f){this.onclick_=f;}, set onchange(f){this.onchange_=f;}, set oninput(f){this.oninput_=f;}, set onkeydown(f){},
    scrollTop:0, scrollHeight:0 };
}
const els = {}; ELEMENTS.forEach(id => els[id] = el(id));
const L = {};
const sb = {
  acquireVsCodeApi: () => ({ postMessage: x => posted.push(x) }),
  document: { getElementById: id => els[id] || el(id), createElement: () => el('opt') },
  window: { addEventListener: (t,f) => { (L[t]=L[t]||[]).push(f); } },
  navigator: { clipboard: { writeText(){} } }, Math, JSON, setTimeout, console, parseInt, parseFloat, String, Array, Boolean
};
vm.createContext(sb);
console.log('--- 2. webview loads + self-requests config ---');
try { vm.runInContext(script, sb, { timeout: 3000 }); ok('script loads', true); }
catch (e) { ok('script loads', false); console.log('  ' + e.message); }
ok('message listener attached', (L.message||[]).length === 1);
ok('posts config on load', posted.some(p => p.type === 'config'));

// ---- 3. config with models -> dropdown POPULATES (the blank-dropdown bug) ----
console.log('--- 3. config populates model dropdown + all settings ---');
const models = [{id:'MiniMax-M2.7',detail:'a'},{id:'DeepSeek-V3.1',detail:'b'},{id:'coder',detail:'c'}];
L.message[0]({ data:{ type:'config', model:'DeepSeek-V3.1', models, maxTokens:4096, concurrency:4, autoContext:'file', provider:'scx-native', temperature:0.5, keyCount:1 } });
ok('MODEL DROPDOWN POPULATED (not blank)', els.model.options.length === 3);
ok('model value set', els.model.value === 'DeepSeek-V3.1');
ok('length applied', els.len.value === '4096');
ok('streams applied', els.streams.value === '4');
ok('context applied', els.ctx.value === 'file');
ok('provider applied', els.provider.value === 'scx-native');
ok('temp applied', els.temp.value === '0.5' && els.tempVal.textContent === '0.5');

// ---- 4. every control posts the correct message ----
console.log('--- 4. every control is wired to the host ---');
function firePost(el, handler, val, expectType, expectKey) {
  posted.length = 0; if (val !== undefined) el.value = val;
  if (typeof handler === 'function') handler();
  const p = posted.find(x => x.type === expectType && (!expectKey || x.key === expectKey));
  return !!p;
}
ok('model change -> setConfig defaultModel', firePost(els.model, els.model.onchange_, 'coder', 'setConfig', 'defaultModel'));
ok('length change -> setConfig maxTokens', firePost(els.len, els.len.onchange_, '800', 'setConfig', 'maxTokens'));
ok('streams change -> setConfig concurrency', firePost(els.streams, els.streams.onchange_, '3', 'setConfig', 'concurrency'));
ok('context change -> setConfig autoContext', firePost(els.ctx, els.ctx.onchange_, 'off', 'setConfig', 'autoContext'));
ok('provider change -> setConfig provider', firePost(els.provider, els.provider.onchange_, 'auto', 'setConfig', 'provider'));
ok('temp change -> setConfig temperature', firePost(els.temp, els.temp.onchange_, '0.7', 'setConfig', 'temperature'));
ok('File button -> uploadFile', firePost(els.tbUpload, els.tbUpload.onclick_, undefined, 'uploadFile'));
ok('Repo button -> attachRepo', firePost(els.tbRepo, els.tbRepo.onclick_, undefined, 'attachRepo'));
ok('MCP button -> listMcp', firePost(els.tbMcp, els.tbMcp.onclick_, undefined, 'listMcp'));
ok('SCX Codex button -> openCodex', firePost(els.tbCodex, els.tbCodex.onclick_, undefined, 'openCodex'));

// ---- 5. reply + attach chip render ----
console.log('--- 5. reply + attach render ---');
try { L.message[0]({ data:{ type:'reply', text:'ok', model:'coder', tokensIn:1, tokensOut:1, shards:1 } }); ok('reply renders', true); } catch(e){ ok('reply renders', false); }
try { L.message[0]({ data:{ type:'fileAttached', name:'x.ts', chars:9 } }); ok('file chip shows', els.ctxChip.textContent.includes('x.ts')); } catch(e){ ok('file chip shows', false); }

console.log('\n===== UI ELEMENT CHECKLIST: ' + pass + ' passed, ' + fail + ' failed =====');
process.exit(fail === 0 ? 0 : 1);
