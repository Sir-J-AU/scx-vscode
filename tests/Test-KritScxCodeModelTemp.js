/**
 * Per-model temperature defaults (.5227). Proves:
 *  - selecting a model snaps the temp slider to that model's recommended default (coder=0.1, gemma=0.6)
 *  - the model change posts the new temperature to the host
 *  - once the operator manually sets temp, model changes STOP overriding it (_tempUserSet)
 * Run: node tests/Test-KritScxCodeModelTemp.js
 */
const fs = require('fs'), path = require('path'), Module = require('module'), vm = require('vm');
const bundle = path.join(__dirname, '..', 'src', 'out', 'extension.js');
let code = fs.readFileSync(bundle, 'utf8') + '\nmodule.exports.__chatHtml=(typeof chatHtml==="function")?chatHtml:null;';
const oL = Module._load; Module._load = function (r, ...a) { if (r === 'vscode') return new Proxy({}, { get: () => () => ({}) }); return oL.call(this, r, ...a); };
const m = new Module(bundle, null); m.filename = bundle; m.paths = Module._nodeModulePaths(path.dirname(bundle)); m._compile(code, bundle);
const html = m.exports.__chatHtml();
const script = html.match(/<script[^>]*>([\s\S]*?)<\/script>/)[1];

const IDS = ['model','len','streams','ctx','temp','tempVal','provider','advBtn','adv','ctxChip','tbUpload','tbRepo','tbMcp','in','send','clear','chat'];
function el(id){ return { id, _t:'', value:'', title:'', options:[], dataset:{}, style:{}, classList:{toggle(){},add(){},remove(){}},
  set textContent(v){this._t=v;}, get textContent(){return this._t;}, set innerHTML(v){this._h=v; if(v==='') this.options=[];}, get innerHTML(){return this._h||'';},
  appendChild(c){this.options.push(c);}, querySelectorAll(){return[];},
  set onclick(f){this.onclick_=f;}, set onchange(f){this.onchange_=f;}, set oninput(f){this.oninput_=f;}, set onkeydown(f){}, scrollTop:0, scrollHeight:0 }; }
const els = {}; IDS.forEach(id => els[id] = el(id));
const posted = []; const L = {};
const sb = { acquireVsCodeApi: () => ({ postMessage: x => posted.push(x) }),
  document: { getElementById: id => els[id] || el(id), createElement: () => el('opt') },
  window: { addEventListener: (t,f) => { (L[t]=L[t]||[]).push(f); } },
  navigator: { clipboard:{ writeText(){} } }, Math, JSON, setTimeout, console, parseInt, parseFloat, String, Array, Boolean, Object };
vm.createContext(sb); vm.runInContext(script, sb, { timeout: 3000 });
let pass = 0, fail = 0; function ok(n,c){ if(c){pass++;}else{fail++;console.log('  FAIL '+n+'  (got temp='+els.temp.value+')');} }

// baseline config
const models = [{id:'MiniMax-M2.7',detail:'a'},{id:'coder',detail:'b'},{id:'gemma-4-31B-it',detail:'c'},{id:'DeepSeek-V3.1',detail:'d'}];
L.message[0]({ data:{ type:'config', model:'MiniMax-M2.7', models, temperature:0.3 } });
ok('load reflects MiniMax default temp 0.3', els.temp.value === '0.3');

function changeModel(id){ posted.length = 0; els.model.value = id; els.model.onchange_(); }
changeModel('coder');           ok('coder snaps temp to 0.2', els.temp.value === '0.2');
ok('coder change posts temperature 0.2', posted.some(p => p.type==='setConfig' && p.key==='temperature' && p.value===0.2));
ok('coder change posts defaultModel', posted.some(p => p.type==='setConfig' && p.key==='defaultModel' && p.value==='coder'));
changeModel('gemma-4-31B-it');  ok('gemma snaps temp to 1', els.temp.value === '1');
changeModel('DeepSeek-V3.1');   ok('deepseek snaps temp to 0.6', els.temp.value === '0.6');

// operator override -> subsequent model changes must NOT snap
els.temp.value = '0.9'; els.temp.onchange_();
ok('manual temp override posts 0.9', posted.some(p => p.type==='setConfig' && p.key==='temperature' && p.value===0.9));
changeModel('coder');           ok('after override, coder does NOT snap (stays 0.9)', els.temp.value === '0.9');

console.log('\n===== PER-MODEL TEMP DEFAULTS: ' + pass + ' passed, ' + fail + ' failed =====');
process.exit(fail === 0 ? 0 : 1);
