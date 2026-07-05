/** Render the SCX Setup GUI with a mock host so it's viewable/clickable in the preview. */
const fs = require('fs'), path = require('path'), Module = require('module');
const b = path.join(__dirname, '..', 'src', 'out', 'extension.js');
let c = fs.readFileSync(b, 'utf8') + '\nmodule.exports.__setup=(typeof setupGuiHtml==="function")?setupGuiHtml:null;';
const oL = Module._load; Module._load = function (r, ...a) { if (r === 'vscode') return new Proxy({}, { get: () => () => ({}) }); return oL.call(this, r, ...a); };
const m = new Module(b, null); m.filename = b; m.paths = Module._nodeModulePaths(path.dirname(b)); m._compile(c, b);
let html = m.exports.__setup();

const mock = `<script>
(function () {
  function reply(d) { window.dispatchEvent(new MessageEvent('message', { data: d })); }
  window.acquireVsCodeApi = function () {
    return {
      getState: function () {},
      setState: function () {},
      postMessage: function (msg) {
        if (msg.type === 'load') {
          setTimeout(function () {
            reply({
              type: 'data', tab: 'codex', codexConfigPath: 'C:\\\\Users\\\\joshl\\\\.codex\\\\config.toml',
              models: ['MiniMax-M2.7', 'DeepSeek-V3.1', 'coder', 'gemma-4-31B-it'],
              codex: { model: 'gpt-5.5', sandbox_mode: 'workspace-write', model_reasoning_effort: 'xhigh', approval_policy: 'on-request' },
              mcp: [{ name: 'pax8', command: 'npx', args: '-y pax8-mcp', env: '{"PAX8_KEY":"x"}' }, { name: 'shopify', command: 'npx', args: '-y shopify-mcp', env: '' }],
              scxcode: { baseUrl: 'https://api.scx.ai', defaultModel: 'DeepSeek-V3.1', apiKeySet: true, keyCount: 2, temperature: 0.6 }
            });
            reply({ type: 'proxy', running: true });
          }, 20);
        } else if (msg.type && msg.type.indexOf('save') === 0) {
          reply({ type: 'saved', section: msg.type.replace('save', '').toLowerCase(), ok: true, backup: 'config.toml.bak-1720000000000' });
        }
      }
    };
  };
})();
</script>`;

html = html.replace('<head>', '<head>' + mock);
fs.writeFileSync(path.join(__dirname, 'emitted', 'index.html'), html);
console.log('  setup-gui demo -> index.html (' + html.length + ' bytes); mock parses: ' + (function () { try { new Function(mock.replace(/<\/?script>/g, '')); return true; } catch (e) { return e.message; } })());
