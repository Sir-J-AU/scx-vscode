# Kilo Code And Kritical Mega Agentic Pipeline

Date: 2026-07-08  
Purpose: bring Kilo Code, comparable agent tools, Kritical SCXCode routers, MCP tools, stores, and supervisor lanes into one additive E2E install/configure flow.

## Upstream Facts Verified

Kilo Code currently presents itself as an open-source coding agent for VS Code, JetBrains, CLI, and cloud. Its docs show VS Code install via `code --install-extension kilocode.kilo-code` and CLI install via `npm install -g @kilocode/cli`.

Kilo's docs say the current extension is rebuilt on the Kilo CLI and continues access to 500+ models through Kilo Gateway. The Kilo Gateway is OpenAI-compatible at `https://api.kilo.ai/api/gateway`, supports BYOK, usage tracking, organization controls, tool calling, and FIM completions.

Kilo's automation docs call out Agent Manager, worktree-isolated sessions, MCP, local models, shell integration, code reviews, and custom integrations through MCP.

KiloClaw is Kilo's hosted OpenClaw service. The current docs describe it as a hosted 24/7 OpenClaw agent with Kilo Chat plus optional Telegram, Discord, and Slack connections. KiloClaw uses platform-managed keys, so it is useful as a managed always-on agent surface but should be treated as account-managed rather than "free local compute."

OpenClaw is the underlying self-hosted always-on agent category. It is powerful because it can connect to chat platforms, use memory, run tools, and operate continuously; it is also the most security-sensitive surface and should be restricted to sandboxed worktrees, explicit repo roots, and least-privilege tools.

Hermes Agent is a terminal-native autonomous agent from Nous Research. OpenRouter documents Hermes as supporting persistent memory, agent-created skills, and broad messaging gateway integrations. Hermes is valuable in this system as a persistent autonomous lane and as a natural consumer of OpenRouter/free plus local/Ollama style provider routing.

Kilo's own comparison set for VS Code agent tools includes Kilo Code, GitHub Copilot Agent HQ, Cline, Continue, Amazon Q Developer, Gemini Code Assist, Cursor, and Windsurf. The broader terminal/cloud comparison also points at Claude Code, OpenCode, Hermes, OpenClaw/KiloClaw, and Devin-style cloud delegation.

Sources:

- `https://kilo.ai/docs`
- `https://github.com/kilo-org/kilocode`
- `https://kilo.ai/docs/automate`
- `https://kilo.ai/docs/gateway`
- `https://kilo.ai/docs/kiloclaw`
- `https://kilo.ai/kiloclaw`
- `https://openrouter.ai/docs/cookbook/coding-agents/hermes-integration`
- `https://hermes-agent.nousresearch.com/docs/integrations/providers`
- `https://kilo.ai/docs/code-with-ai/platforms/vscode/whats-new`
- `https://kilo.ai/articles/coding-agents-for-vscode`

## Kritical Positioning

Kritical should not replace Kilo, Claude Code, Codex, Cline, Continue, Copilot, Q, Gemini, Cursor, or Windsurf. Kritical should add:

- A free-router model plane on `127.0.0.1:4182`.
- An SCX-native model plane through `https://api.scx.ai/v1`.
- A Codex Responses shim on `127.0.0.1:4199`.
- Store and chunk MCP tools.
- SQL and SQLite persistence.
- Supervisor lanes that can batch, compare, synthesize, and report.
- Repo-local instructions that tell any installed agent exactly how to use the above.

## Tool Matrix

| Tool | Kritical use | Config confidence | Notes |
|---|---|---:|---|
| Kilo Code | Primary model-neutral IDE/CLI agent candidate | Medium | Verified install surfaces, Gateway, MCP, Agent Manager, subagents. Native local config schema still needs live installed-client proof. |
| Cline | MCP-heavy VS Code plan/act agent | High | OpenAI-compatible and MCP-oriented workflow matches Kritical pack pattern. |
| Roo Code | Cline-family VS Code agent | Medium | Use same OpenAI-compatible/MCP overlay pattern where installed. |
| Continue | Declarative chat/context assistant | High | Already represented in configs. Best for lower-risk config-driven assistant use. |
| Codex | Terminal agent with SCX Responses shim | High | Existing SCXCode shim and wrapper are local source of truth. |
| Claude Code | Native high-quality terminal agent | Medium | Keep native config untouched; use overlay only where custom endpoints are supported. |
| OpenCode | Terminal-native peer to Claude/Codex | Medium | Add OpenAI-compatible snippet; live CLI proof still needed. |
| Aider | Git patch agent | Medium | Add OpenAI-compatible snippet; live CLI proof still needed. |
| DeepCode | Review/explain/test helper | Low/Medium | Snippets exist; native CLI not present during audit. |
| Hermes Agent | Persistent terminal autonomous agent | Medium | Provider docs support OpenRouter/Ollama/vLLM style routing; local install channel still needs proof. |
| OpenClaw | Self-hosted 24/7 action agent | Medium | Powerful but high-risk; use sandboxed worktrees and least-privilege permissions. |
| KiloClaw | Hosted OpenClaw | Account-managed | Useful for managed 24/7 operation; Kritical supplies instructions/MCP shape, not billing bypass. |
| GitHub Copilot Agent HQ | GitHub-native issue/PR agent | Account-managed | Do not inject Kritical router into account-managed routing. Use when GitHub workflow is the system of record. |
| Amazon Q Developer | AWS-specialist agent | Account-managed | Do not inject Kritical router into AWS account auth. |
| Gemini Code Assist | GCP/Android specialist | Account-managed | Direct Gemini API keys still route through Kritical free plane where useful. |
| Cursor | Separate editor | External | Not a VS Code extension; do not mutate VS Code for it. |
| Windsurf | Separate editor | External | Optional external surface, not a Kritical dependency. |

## Shipped Files

| File | Purpose |
|---|---|
| `free-router/agent-packs/kritical-agentic-mega-pipeline.agent-pack.json` | Unified pack for Kilo plus comparable tools. |
| `free-router/agent-packs/kritical-mcp-tools.bundle.json` | MCP bundle for SCX, store, chunk store, local store, and supervisor. |
| `free-router/config/free-agentic-model-catalog.json` | Free/local/SCX/Claude lane catalog for all-day coding orchestration. |
| `install/Add-KritAgenticRepo.ps1` | Adds `.kritical/` instructions, MCP bundle, pack manifest, and supervisor wrapper to any target repo. |
| `install/Test-KritCodingSystem.ps1` | Read-only readiness checker for CLIs, keys, endpoints, VS Code extensions, manifests, and sister supervisors. |
| `install/Start-KritCodingQueueRunner.ps1` | Long-running free-first queue runner that emits supervisor reports for queued coding tasks. |
| `tests/Invoke-KritScxE2EProof.ps1` | Validates the new pack, MCP bundle, and target repo bootstrap. |

## E2E Install And Configure Flow

1. Install or verify the desired native tools. Kritical does not require all of them.

```powershell
code --install-extension kilocode.kilo-code
npm install -g @kilocode/cli
```

2. Load keys from outside-repo secrets.

```powershell
pwsh -NoProfile -File .\free-router\scripts\Import-KritSecretsToEnv.ps1 -Mode Load -PersistUser
```

3. Start free-router when using free/BYOK lanes.

```powershell
pwsh -NoProfile -File .\free-router\scripts\Start-KritFreeRouter.ps1 -Mode Start -Config free
```

4. Install the mega pack snippets.

```powershell
pwsh -NoProfile -File .\free-router\scripts\Install-KritAgentPack.ps1 -Mode Install -Pack kritical-agentic-mega-pipeline -PersistHKCU
```

5. Add Kritical instructions and MCP bundle to a target repo.

```powershell
pwsh -NoProfile -File .\install\Add-KritAgenticRepo.ps1 -RepoPath 'C:\Path\To\Repo' -Pack mega
```

6. Paste or reference `.kritical/AGENT-INSTRUCTIONS.md` in Kilo, Cline, Roo Code, Claude Code, Codex, or other tools.

7. Run supervisor from the target repo wrapper.

```powershell
pwsh -NoProfile -File 'C:\Path\To\Repo\.kritical\supervisor\run-supervisor.ps1' -Mode dry-run -Prompt 'Implement the attached design using free lanes first, then SCX for synthesis and verification.'
```

8. Run SCXCode proof.

```powershell
pwsh -NoProfile -File .\tests\Invoke-KritScxE2EProof.ps1 -Live
```

9. Check all local coding-system dependencies.

```powershell
pwsh -NoProfile -File .\install\Test-KritCodingSystem.ps1
```

10. Run the always-on queue in report mode.

```powershell
pwsh -NoProfile -File .\install\Start-KritCodingQueueRunner.ps1 -Mode Loop -StartRouters -SleepSeconds 60
```

Kill switch:

```powershell
pwsh -NoProfile -File .\install\Start-KritCodingQueueRunner.ps1 -Mode Stop
```

## Supervisor Strategy

The supervisor should treat agent/model access as lanes:

- Free exploration lanes: OpenRouter/free, Mistral free tier, Gemini free, Together, Groq, DeepSeek, Fireworks, Cohere, local Ollama/LM Studio.
- SCX synthesis lanes: `coder`, `MiniMax-M2.7`, `MAGPiE`, `gpt-oss-120b`, `DeepSeek-V3.1`.
- Native agent lanes: Kilo, Codex, Claude Code, Cline/Roo, Continue, Aider/OpenCode where installed.
- Autonomous persistent lanes: Hermes, OpenClaw, KiloClaw where installed/configured and explicitly bounded.
- MCP lanes: SCX MCP, local store, SQL store, chunk store, filesystem/repo tools where the host agent supports them.

Batch order:

1. Expand design into task graph.
2. Run free lanes for repo scan, candidate implementation plans, and cheap draft patches.
3. Use MCP/store/chunk context to compress only the relevant repo state.
4. Use SCX lanes for final design arbitration and patch plan.
5. Let one editor/terminal agent apply changes.
6. Run tests.
7. Use SCX plus free lanes for review.
8. Return an operator-ready summary with exact evidence.

## Guardrails

- Kritical layers are additive and removable.
- No local proxy binds to `0.0.0.0`.
- Do not commit secrets.
- Do not overwrite native agent config unless a script explicitly backs it up and the operator asked for native writes.
- Account-managed products stay account-managed.
- Claims about native Kilo/Cline/Roo/OpenCode config need live installed-client proof before being marked complete.
- Claims about 24/7 zero-cost operation must remain bounded: free providers can throttle, KiloClaw is account-managed, and SCX/Claude are existing allocations rather than magic free compute.

(c) 2026 Kritical Pty Ltd. All rights reserved.
