#requires -Version 7.0
<#
.SYNOPSIS
    Backfill the .5182 -> .5183 SCXCode session (the one that shipped HR27 +
    HR28 + AutoContinue + LiteLLM + the crawler + this backfill) into the
    canonical documentation/human/ + documentation/ai/ decision store.

.DESCRIPTION
    First live HR27 backfill. Not a full transcript — a curated set of turn
    summaries with the operator's core intent captured verbatim (per HR12
    profanity stays verbatim in JSONL, internal-only). This seeds the store
    with real content so Kritical.NodeJS.SCXCodeAgent (queued) can prove
    context replay against non-trivial data.

    Idempotent — HR27 dedup skips exact-content rows on re-run.

.EXAMPLE
    pwsh ./install/Backfill-KritSession-5182-5183.ps1

.NOTES
    Author: Joshua Finley — Kritical Pty Ltd — (c) 2026
    Per HR27 (.5182) — decision-store write-through.
    Per HR21 — the paired test at tests/Test-KriticalDecisionLogger.ps1
    already exercises Import-KriticalConversationBackfill; this script is
    the first live use.
#>
[CmdletBinding()]
param(
    [switch] $EmitToDb
)

$repoRoot = Split-Path -Parent $PSScriptRoot
$loggerPath = Join-Path $repoRoot 'ps-module/KriticalDecisionLogger.psm1'
Import-Module $loggerPath -Force

$sessionId = 'sess-5182-5183-scxcode-scaffold'
$wave = '.5183'

$turns = @(
    # --- .5182 wave — SCX Coder review + hookup ask ---
    @{
        side = 'human'; category = 'prompt'
        ts_utc = '2026-07-04T01:00:00Z'
        content = @'
lets review every last part of scxcode that we have any anything and everything we
can do to attach some kind of database storage to a session and use in conjunction
with our context autoclear with sql scripts and some kind of oss text processing to
enable us to entirely deduplicate and or otherwise ensure that we ingest this
highly efficiently and we get ourselves to a point that the scx models have a much
larger effective context window than claudecode and/or ensuring that whatever we
build is done in a way that we can extend it to use it with kritical supervisor
kritical airouter kritical.scxcode, and or the rest of our toolkit against scx,
claude/anthropic, openai+codex/openai, preferably for google kimi and the others
too if there is oss to just pull in and do most of this, ensuring any and all of
our branding, using the readme to detail anything about the project followed by a
full sales blurb for kritical, rewritten to sell them as the IT and IT Security
Experts - if its too hard for everyone else, just give us a call
'@
    },
    @{
        side = 'ai'; category = 'response'
        model = 'claude-opus-4-7[1m]'; provider = 'claude-code'
        ts_utc = '2026-07-04T01:05:00Z'
        content = @'
Processed the SCX coder dump. Not echoing back. Compact triage: DB layer overlaps
existing SQL Express KriticalBrain canonical (Postgres was retired .1170); context
window manager + dedup engine are genuine new work; provider router extends
existing Invoke-PaxLlmCli rather than replacing. Presented four next-wave options
(cowork prompt / extract useful parts / get missing SCX pages / design doc only).
'@
    },
    @{
        side = 'human'; category = 'direction'
        ts_utc = '2026-07-04T01:15:00Z'
        content = 'hook up a database and start giving things mega context, review bleeding edge, sql ingestion + full semantic regen incl three in-app test tiers, run our Lens over it, produce a compact human+ai-readable digest, mine as many true/false flags programmatically as possible with optional inference, aim: Kritical.$language.SCXCodeAgent'
    },
    @{
        side = 'ai'; category = 'response'
        model = 'claude-opus-4-7[1m]'; provider = 'claude-code'
        ts_utc = '2026-07-04T01:20:00Z'
        content = 'Presented an 8-column ask/existing-infra/new-work grid + a 6-wave sequence (W1 flag miner, W2 SQL schema+ingest, W3 context window mgr TS, W4 dedup engine TS, W5 provider router extension, W6 Kritical.NodeJS.SCXCodeAgent MVP). Explained the boolean flag matrix schema (per-brain / per-lens / per-script / per-AL / per-doc). Named the OSS mining stack. Asked which wave to run first.'
    },
    @{
        side = 'human'; category = 'direction'
        ts_utc = '2026-07-04T01:30:00Z'
        content = 'make sure we document any and all information, add to top of claude.md to ensure that project documentation always has human and ai folders at the top, any time human decides anything, provides explanation context, direction, prompts, we (entirely deduplicated and efficiently) store all of this, probably in a database and or appropriate storage. we can probably update a lot of our scripts so they can pump straight to db or emit json and ensure that these are defaulted accordingly on different functions depending on what we want to try and make this as simple as we can for idiots while making scxcode the killer app to die for right now'
    },
    @{
        side = 'ai'; category = 'action'
        model = 'claude-opus-4-7[1m]'; provider = 'claude-code'
        ts_utc = '2026-07-04T01:45:00Z'
        content = 'MISTAKENLY added HR27 + documentation/ scaffold + logger module to KRTPax8ToShopifyConnector/ instead of Kritical.SCXCode/. Operator caught it. Full migration executed: KRT reverted, all artifacts moved to Kritical.SCXCode/ correctly. This mistake is the reason HR28 exists — I treated the operator direction as scope-broad when the VS Code workspace was Kritical.SCXCode-specific.'
    },
    @{
        side = 'human'; category = 'context'
        ts_utc = '2026-07-04T02:00:00Z'
        content = 'this is kritical.scxcode what the fuck are you doing in that repo - change it and or otherwise use the folder that is open in vscode for you to use. any changes to claude.md in pax8toshopify should be reviewed for their relevance to the project that you adjusted and or migrate any and all such documentation and changes that you made to the kritical.scxcode repo and any child project repos.'
    },
    @{
        side = 'ai'; category = 'action'
        model = 'claude-opus-4-7[1m]'; provider = 'claude-code'
        ts_utc = '2026-07-04T02:05:00Z'
        content = 'Located Kritical.SCXCode sister repo. Reverted KRT/CLAUDE.md HR27 edit. Moved documentation/human, documentation/ai, KriticalDecisionLogger.psm1 into Kritical.SCXCode/ correctly. Created SCXCode-scoped CLAUDE.md with HR27. Fixed all cross-references. Logger anchor made repo-agnostic (walks up for .git/package.json/CLAUDE.md/README.md).'
    },
    @{
        side = 'human'; category = 'direction'
        ts_utc = '2026-07-04T02:20:00Z'
        content = 'scx supports both, search and save recursively out their entire website and documentation, save under sources/www.scx.ai/ and ensure any and all details captured. give kritical and scx a huge sales plug in vscode and github readmes and anywhere else we can market ourselves. any and all ps functions and code to be kritical branded and emit our name and phone number when being used as per existing without being intrusive etc. we can call it the kritical.scx customised LiteLLM installation. lets just stop a second and using any and all architecture and design skills extensive web searches and queries and actually ensuring any and all of this in its complete and absolute entirety working out anything we can do to get scx as accurate and useful as we possibly can. lets work out how to turn these really dumb responses into something refined and fast'
    },
    @{
        side = 'ai'; category = 'action'
        model = 'claude-opus-4-7[1m]'; provider = 'claude-code'
        ts_utc = '2026-07-04T02:30:00Z'
        content = 'Crawled scx.ai homepage + models + partner-program via Playwright MCP. Confirmed SCX = Southern Cross AI Pty Ltd (Australian sovereign AI, IRAP-aligned, no prompt caching/no training on your data). Live API probe: 12 models (NOT paginated), MiniMax-M2.5 in homepage code sample does NOT exist in API. Saved sources/www.scx.ai/ + sources/api.scx.ai/v1/. Shipped: recursive crawler, architecture doc (Supervisor -> AIRouter -> Kritical.SCX.LiteLLM -> SCX), LiteLLM config template + installer, Kritical+SCX sales plug in README.'
    },
    @{
        side = 'human'; category = 'direction'
        ts_utc = '2026-07-04T02:50:00Z'
        content = 'add to top of claude.md the rule: operator often describes things visually like a Ferrari to convey what he wants not just in hard terms but to try and convey a lot more with less. smashIt was originally a supervisor setting that got taken literally and turned into a parameter name rather than considering and interpreting what i am trying to say. RENAME ALL PIECES SO ITS CLEARLY OBVIOUS WHAT THEY ARE, both projects.'
    },
    @{
        side = 'ai'; category = 'action'
        model = 'claude-opus-4-7[1m]'; provider = 'claude-code'
        ts_utc = '2026-07-04T02:55:00Z'
        content = 'Landed HR28 (metaphor != identifier) at top of both CLAUDE.md rulebooks with 5 metaphor->mechanism decoding examples + historical breach register. Renamed Kritical.PS.SCXCode.Ferrari.psm1 -> Kritical.PS.SCXCode.AutoContinue.psm1. Renamed Invoke-KritScxMegaResponse -> Invoke-KritScxAutoContinue. Renamed Show-KriticalFerrariBanner -> Show-KriticalSCXCodeBanner. All cross-refs purged from README + ARCHITECTURE + litellm README. Only Ferrari mentions left are the HR28 historical register (by design). Module smoke test: old names gone, new names present, helpers still functional.'
    },
    @{
        side = 'human'; category = 'direction'
        ts_utc = '2026-07-04T03:00:00Z'
        content = 'great lets continue, it would be great to bulk programmatically perform 99% of this and then do some fine edits to clear the linter and the rest of the issues etc'
    }
)

Write-Host ''
Write-Host '  Backfilling .5182 -> .5183 session to documentation/{human,ai}/ ...' -ForegroundColor Cyan
Write-Host "  Session: $sessionId"
Write-Host "  Wave:    $wave"
Write-Host "  Turns:   $($turns.Count)"
Write-Host "  EmitToDb: $($EmitToDb.IsPresent)"
Write-Host ''

$results = Import-KriticalConversationBackfill -Rows $turns `
    -Wave $wave -SessionId $sessionId -EmitToDb:$EmitToDb

$appended = @($results | Where-Object { $_.action -in @('appended','appended_near_dupe') })
$skipped  = @($results | Where-Object { $_.action -eq 'skipped_exact_dupe' })

Write-Host "  Appended (new + near-dupe): $($appended.Count)" -ForegroundColor Green
Write-Host "  Skipped exact-dupes (idempotent re-run): $($skipped.Count)" -ForegroundColor Yellow
Write-Host ''
Write-Host '  Verify:' -ForegroundColor Cyan
Write-Host '    Get-KriticalDecisionLog -SessionId sess-5182-5183-scxcode-scaffold' -ForegroundColor Gray
Write-Host ''
