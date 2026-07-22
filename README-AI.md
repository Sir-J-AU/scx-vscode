{
  "schema": "kritical-readme-ai/v1",
  "generatedUtc": "2026-07-16",
  "generatedFrom": ["README.md surfaces table", "ps-module/Kritical.PS.SCXCode.psd1", "node-agent/package.json", "src/package.json", "component dir enumeration"],
  "repo": {
    "name": "Kritical.SCXCode",
    "type": "multi-language monorepo (VS Code TS + PS module + Node agent + Python lens + LiteLLM)",
    "tagline": "Sovereign Southern Cross AI (SCX) inside VS Code",
    "author": "Kritical Pty Ltd",
    "purpose": "Puts Southern Cross AI (SCX) at the centre of the developer workstation across multiple independently-switchable surfaces; additive, never a fork.",
    "compliance": ["HR29 (additive/switchable — operator Codex/Claude/VSCode keep working with layer on/degraded/absent)", "HR27 (write-through)"],
    "models": ["MiniMax-M2.7", "MAGPiE", "gpt-oss-120b", "DeepSeek-V3.1", "coder", "gemma-4", "Qwen3", "Llama-4-Maverick", "E5-Mistral (embeddings)", "Whisper", "opir"]
  },
  "surfaces": [
    { "name": "VS Code extension", "id": "SCXCode", "version": "0.1.27", "location": "src/", "does": "chat panel, inline autocomplete, model picker, auto-failover, auto-context, telemetry (VSIX)" },
    { "name": "PowerShell module", "id": "Kritical.PS.SCXCode", "version": "0.1.0", "location": "ps-module/", "does": "11 fns for SCX chat/embeddings/config/key-mgmt/status" },
    { "name": "MCP server", "id": "kritical-scxcode", "location": "mcp-server/server.mjs", "does": "stdio JSON-RPC 2.0 — SCX chat + corpus search + symbol lookup as MCP tools" },
    { "name": "Agentic Codex shim", "location": "codex-wrapper/scx-agentic-shim.mjs", "does": "flatten-proxy 127.0.0.1:4199 rewriting Codex tool serialisation for SCX" },
    { "name": "PS Codex wrapper", "location": "codex-wrapper/kritical-codex.ps1", "does": "launch real Codex CLI through shim, reuse operator ~/.codex untouched" },
    { "name": "Node agent", "id": "@kritical/scxcode-agent", "version": "0.1.0", "location": "node-agent/", "does": "multi-provider bridge daemon, auto-continuation, web tools, HR27 write-through" },
    { "name": "Model mux / free-router / litellm", "location": "mux/ free-router/ litellm/", "does": "multi-model routing + LiteLLM" },
    { "name": "Lens Looking Glass", "location": "lens/", "does": "Python git-archaeology + brain bug-hunt + repo-sweep + Netlink parity" }
  ],
  "psModuleFunctions": ["Invoke-KritScx", "Invoke-KritScxChat", "Get-KritScxModels", "Get-KritScxConfig", "Set-KritScxConfig", "Test-KritScxConnection", "New-KritScxEmbedding", "Get-KritScxStatus", "Install-KritScxKey", "Uninstall-KritScxKey", "Switch-KritScxKey"],
  "notableContents": {
    "brandSpec": { "path": "media/brand-spec.json", "role": "AUTHORITATIVE Kritical brand-spec — legal name, ABN 39 687 048 086, ACN, address, phones, fonts, colours; source of truth used by L22 storefront footer ABN" },
    "lensLookingGlass": { "path": "lens/", "files": ["Invoke-KritLensBrainBugHunt.py", "Invoke-KritLensRepoSweep.py", "Invoke-KritLensDiff.py", "Invoke-KritGitBlobArchaeology.py", "Invoke-KritGitBlobArchaeologyExtended.py", "Extract-KritNetlinkStateByDate.py"], "note": "SCX-embedded Python analysis toolset, distinct from the PowerShell Kritical.Lens fleet; potentially L16-relevant" },
    "other": ["store-mcp/", "mcp-server/", "sql/", "src-db/", "BRANDING-REGISTER.md", "CLAUDE.md", "AGENTS.md"]
  },
  "estateRole": {
    "role": "AI/model backbone — SCX offload the LlmOffload (Kritical.PS.Toolkit/lib) + Showcase catalog generation route through",
    "mcpSurface": "consumable by any MCP client incl. Claude Code",
    "brandSourceOfTruth": "media/brand-spec.json"
  },
  "notes": ["large multi-language monorepo, no single build — each surface builds independently (HR29)", "additive shim layer, not a fork of Codex/Claude/VSCode"],
  "provenance": { "note": "New files only; README.md untouched (already a strong human intro).", "lane": "L4", "repoOrdinal": "34th repo in L4 sweep" }
}
