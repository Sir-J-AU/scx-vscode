/**
 * Regression lock for the SHARED config write (.5229). The setup GUI writes ~/.codex/config.toml — the
 * SAME file the `codex` CLI reads — so a bad write could nuke the operator's plugins/marketplaces. This
 * asserts the surgical merge semantics the extension uses: parse existing -> set only the targeted keys
 * (model / mcp_servers) -> stringify -> reparse; everything else MUST survive, and it must round-trip.
 * Run: node tests/Test-KritScxCodeSetupConfig.js
 */
const toml = require('../src/node_modules/@iarna/toml');
let pass = 0, fail = 0; function ok(n, c) { if (c) { pass++; } else { fail++; console.log('  FAIL ' + n); } }

const existing = `sandbox_mode = "workspace-write"
model = "gpt-5.5"
model_reasoning_effort = "xhigh"
notify = [ "x.exe", "turn-ended" ]

[marketplaces.openai-bundled]
source_type = "local"

[plugins."github@openai-curated"]
enabled = true
`;

// --- replicate the extension's saveMcp + saveCodex merge exactly ---
const cfg = toml.parse(existing);
// saveCodex: set only these 4 keys
cfg.model = 'scx-coder'; cfg.sandbox_mode = 'workspace-write'; cfg.model_reasoning_effort = 'high'; cfg.approval_policy = 'on-request';
// saveMcp: replace mcp_servers only
cfg.mcp_servers = {
  pax8: { command: 'npx', args: ['-y', 'pax8-mcp'], env: { PAX8_KEY: 'x' } },
  shopify: { command: 'npx', args: ['-y', 'shopify-mcp'] },
};
const out = toml.stringify(cfg);
let reparse; let threw = false;
try { reparse = toml.parse(out); } catch { threw = true; }

ok('round-trip re-parses (no invalid TOML written)', !threw && reparse);
ok('operator plugins PRESERVED', !!(reparse.plugins && reparse.plugins['github@openai-curated'] && reparse.plugins['github@openai-curated'].enabled === true));
ok('operator marketplaces PRESERVED', !!(reparse.marketplaces && reparse.marketplaces['openai-bundled']));
ok('operator notify PRESERVED', Array.isArray(reparse.notify) && reparse.notify.length === 2);
ok('codex model updated (targeted key only)', reparse.model === 'scx-coder');
ok('codex approval added', reparse.approval_policy === 'on-request');
ok('mcp pax8 present with args + env', reparse.mcp_servers.pax8.command === 'npx' && reparse.mcp_servers.pax8.args.join(' ') === '-y pax8-mcp' && reparse.mcp_servers.pax8.env.PAX8_KEY === 'x');
ok('mcp shopify present (no env)', reparse.mcp_servers.shopify.command === 'npx' && !reparse.mcp_servers.shopify.env);

// --- removing an MCP server: rebuild mcp_servers from a shorter list -> the dropped one is gone ---
const cfg2 = toml.parse(out);
cfg2.mcp_servers = { pax8: { command: 'npx', args: ['-y', 'pax8-mcp'] } };  // shopify removed
const reparse2 = toml.parse(toml.stringify(cfg2));
ok('MCP remove drops only the removed server', !!reparse2.mcp_servers.pax8 && !reparse2.mcp_servers.shopify);
ok('MCP remove still preserves plugins', !!(reparse2.plugins && reparse2.plugins['github@openai-curated']));

console.log('\n===== SETUP CONFIG (shared config.toml) SAFETY: ' + pass + ' passed, ' + fail + ' failed =====');
process.exit(fail === 0 ? 0 : 1);
