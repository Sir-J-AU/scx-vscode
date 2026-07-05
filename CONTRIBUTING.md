# Contributing to Kritical.SCXCode

## Repo Layout (Surfaces)

```
Kritical.SCXCode/
├── src/                          # VS Code extension (TypeScript, VSIX 0.1.27)
├── ps-module/                    # PowerShell module (11 functions + 4 aliases)
├── mcp-server/                   # stdio JSON-RPC 2.0 MCP server
├── codex-wrapper/                # Agentic Codex shim + PowerShell wrapper
├── store-mcp/                    # Node SQLite corpus store + miner
├── mux/                          # Multi-model parallel mux + synthesis
├── lens/                         # Lens Looking Glass (SQL Server ingest + corpus mining)
├── docs/                         # Architecture, specs, bugfix waves
├── install/                      # Idempotent install/heal/status scripts
├── safety/                       # Recovery scripts
└── tests/                        # Test suites
```

## Building

### VS Code Extension
```bash
cd src
npm run build  # esbuild bundle to out/extension.js
```

## Testing

### Node Tests (.mjs)
```bash
node --test tests/*.mjs
```

### Python Tests (.py)
```bash
python -m pytest tests/*.py
```

### Shim Tests
```bash
cd codex-wrapper
node --test scx-agentic-shim.test.mjs
```

## HARD RULES

**HR1**: SCX_API_KEY only for AI inference — never OPENAI_/ANTHROPIC_ keys. All surfaces must use SCX-native credentials only.

**HR29**: Additive layers only — never disruptive. Removing any Kritical component must return the operator to a working baseline.

**Network Security**: Never bind 0.0.0.0. Localhost (127.0.0.1) only.

**Operator Environment**: Keep vanilla ~/.codex pristine. Never modify the operator's real Codex CLI installation or configuration.

## Commit Style

Use conventional commits with .5231-style wave tags:

```
feat(shim): add plan-gate retry telemetry [.5231]

Fixes scx-deep-bughunt finding #5: clean error return on retry failure.

Co-Authored-By: Joshua Finley <joshua.finley@kritical.net>
```

Include `Co-Authored-By` trailers for all contributing engineers.

## Sovereign-SCX Bulk-Write Loop

1. **SCX drafts**: Use SCX models for initial implementation
2. **Operator lenses**: Human review with Lens Looking Glass introspection
3. **Verification**: Run full test suite + adversarial verification
4. **Landing**: Commit only after all checks pass

All contributions must pass the full test suite and adhere to the architectural patterns documented in `docs/ARCHITECTURE.md`.

## Getting Started

1. Fork the repository
2. Create a feature branch from `main`
3. Make additive changes only (HR29)
4. Test thoroughly across all affected surfaces
5. Submit a PR with conventional commit messages and Co-Authored-By tags

All contributions are licensed under Apache-2.0. By contributing, you agree to license your work under the same terms.
