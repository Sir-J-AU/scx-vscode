/**
 * Paired test (HR21) for the .5214 in-panel MUX (src/extension.ts scxMux).
 * Stubs `vscode` + `https` and proves:
 *   concurrency=1 -> 1 SCX call (plain).
 *   concurrency=3 -> 3 shard calls + 1 synthesiser call = 4, and returns the synth text.
 *   SCX-only: every request goes to the configured SCX baseUrl with x-api-key (never Anthropic).
 * Run: node tests/Test-KritScxCodeMux.js
 */
const fs = require('fs'), path = require('path'), Module = require('module');
const bundle = path.join(__dirname, '..', 'src', 'out', 'extension.js');

let httpCalls = [];
function makeReq(cannedText) {
  return {
    write() {}, end() {},
    on(ev) { return this; },
  };
}
// stub https so scxPost resolves with a canned Anthropic-shape response
const httpsStub = {
  request(opts, cb) {
    httpCalls.push({ host: opts.hostname, path: opts.path, hasApiKey: !!(opts.headers && opts.headers['x-api-key']), hasAnthropicAuth: !!(opts.headers && opts.headers['authorization']) });
    const res = { statusCode: 200, on(ev, fn) {
      if (ev === 'data') fn(JSON.stringify({ id: 'm', type: 'message', role: 'assistant',
        content: [{ type: 'text', text: 'canned-answer' }], model: 'MiniMax-M2.7', stop_reason: 'end_turn',
        usage: { input_tokens: 5, output_tokens: 3 } }));
      if (ev === 'end') fn();
    }};
    setImmediate(() => cb(res));
    return { write() {}, end() {}, on() { return this; } };
  },
};

// stub vscode with a config that we control per-test
let CFG = {};
const vscodeStub = {
  workspace: { getConfiguration: () => ({ get: (k, d) => (k in CFG ? CFG[k] : d) }) },
  window: { activeTextEditor: undefined },
  ConfigurationTarget: { Global: 1 },
};
const origLoad = Module._load;
Module._load = function (req, ...a) {
  if (req === 'vscode') return vscodeStub;
  if (req === 'https') return httpsStub;
  return origLoad.call(this, req, ...a);
};

process.env.SCX_API_KEY = 'test-scx-key';
let code = fs.readFileSync(bundle, 'utf8') + '\nmodule.exports.__scxMux = (typeof scxMux === "function") ? scxMux : null;';
const m = new Module(bundle, null); m.filename = bundle; m.paths = Module._nodeModulePaths(path.dirname(bundle));
m._compile(code, bundle);
const scxMux = m.exports.__scxMux;

let pass = 0, fail = 0;
function check(name, cond) { if (cond) { pass++; console.log('  PASS ' + name); } else { fail++; console.log('  FAIL ' + name); } }

(async () => {
  check('scxMux is exported', typeof scxMux === 'function');

  // --- concurrency 1 => single call ---
  CFG = { apiKey: '${env:SCX_API_KEY}', baseUrl: 'https://api.scx.ai', defaultModel: 'MiniMax-M2.7', fallbackChain: [], temperature: 0, provider: 'scx-native', autoContext: 'off' };
  httpCalls = [];
  const r1 = await scxMux([{ role: 'user', content: 'hi' }], 1, 800);
  check('concurrency=1 -> exactly 1 SCX call', httpCalls.length === 1);
  check('concurrency=1 -> shards=1', r1.shards === 1);
  check('concurrency=1 -> returns text', r1.res.content[0].text === 'canned-answer');

  // --- concurrency 3 => 3 shards + 1 synth = 4 ---
  httpCalls = [];
  const r3 = await scxMux([{ role: 'user', content: 'design X' }], 3, 1500);
  check('concurrency=3 -> 4 SCX calls (3 shards + 1 synth)', httpCalls.length === 4);
  check('concurrency=3 -> shards=3', r3.shards === 3);
  check('concurrency=3 -> returns synthesised text', r3.res.content[0].text === 'canned-answer');

  // --- SCX-only: every call used x-api-key, none used Anthropic auth, all to api.scx.ai ---
  check('all calls used x-api-key (SCX shape)', httpCalls.every(c => c.hasApiKey));
  check('no call used Anthropic bearer auth', httpCalls.every(c => !c.hasAnthropicAuth));
  check('all calls hit configured SCX host', httpCalls.every(c => c.host === 'api.scx.ai' && c.path === '/v1/messages'));

  // --- clamp: concurrency 99 clamps to 8 (8 shards + 1 synth = 9) ---
  httpCalls = [];
  const rBig = await scxMux([{ role: 'user', content: 'y' }], 99, 800);
  check('concurrency=99 clamps to 8 shards (+1 synth = 9 calls)', httpCalls.length === 9 && rBig.shards === 8);

  console.log('\n' + (fail === 0 ? 'ALL PASS' : fail + ' FAILED') + ' (' + pass + ' passed, ' + fail + ' failed)');
  process.exit(fail === 0 ? 0 : 1);
})();
