# SCX API Surface Matrix - 2026-07-07

Purpose: point-in-time evidence ledger for the mined SCX API reference, generated OpenAPI candidate, and live smoke checks.

## Source Evidence

- Official docs crawled from `https://platform.scx.ai/docs` and `https://platform.scx.ai/api-reference`.
- Official OpenAPI probes attempted:
  - `https://platform.scx.ai/openapi.json`
  - `https://platform.scx.ai/api-reference/openapi.json`
  - `https://api.scx.ai/openapi.json`
  - `https://api.scx.ai/v1/openapi.json`
- No official OpenAPI document was found at those locations.
- Local snapshot: `UpstreamDocumentation/`
  - 44 HTML pages
  - 44 text dumps
  - 4 JSON artifacts
  - 2 user-pasted guide captures under `UpstreamDocumentation/attachments/`

## Generated Spec

- Candidate spec: `UpstreamDocumentation/scx-openapi.candidate.json`
- OpenAPI version: `3.1.1`
- Paths: 22
- Operations: 28
- Schemas: 23
- Server: `https://api.scx.ai/v1`
- Security: bearer auth

## Compatibility Rules Captured

- OpenAI-compatible base URL: `https://api.scx.ai/v1`
- Compatibility-safe temperature range: `0..1`
- SCX-only sampling parameter: `top_k`
- Currently unsupported OpenAI parameters marked deprecated/ignored:
  - `logprobs`
  - `top_logprobs`
  - `n`
  - `presence_penalty`
  - `frequency_penalty`
  - `logit_bias`
  - `seed`

## Speech Rules Captured

- Public speech model: `scx-tts`
- Default response format: `wav`
- Formats: `mp3`, `wav`, `pcm`
- Input cap: 5000 characters
- Speed range: `0.25..4.0`
- Voice enrollment: `POST /v1/audio/voices` returns stored `voice_...` IDs.
- Inline cloning fields:
  - `voice_ref_wav_b64`
  - `voice_ref_wav_format`
  - `ref_text`
  - `x_vector_only_mode`
  - `max_new_tokens`

## Server Tools Captured

`web_search`, `code_interpreter`, `file_retrieval`, `academic_search`, `youtube_search`, `reddit_search`, `x_search`, `mcp_search`, `trove_search`, `retrieve`, `movie_tv_search`, `trending_movies`, `trending_tv`, `mermaid_diagram`, `coin_data`, `coin_data_by_contract`, `coin_ohlc`, `currency_converter`, `stock_chart`, `stock_price`, `find_place_on_map`, `nearby_places_search`, `weather`, `travel_advisor`, `flight_tracker`, `flight_live_tracker`, `datetime`, `greeting`, `text_translate`, `memory_manager`.

## Live Smoke Result

Receipt: `UpstreamDocumentation/scx-live-smoke.latest.json`

- `GET /models`: pass, 12 models.
- `GET /batches`: pass, empty list.
- `GET /vector-stores`: pass, empty list.
- `POST /chat/completions`: quota-blocked, `429 Daily token limit exceeded`.
- `POST /responses`: quota-blocked, `429 Daily token limit exceeded`.
- `POST /embeddings`: quota-blocked, `429 Daily token limit exceeded`.

The quota-blocked checks prove endpoint reachability and account-level gating, not model output correctness. Re-run after quota reset or with a fresh key:

```powershell
$env:SCX_API_KEY = [Environment]::GetEnvironmentVariable('SCX_API_KEY','User')
node tests/Test-KritScxLiveSurface.mjs --live
```

Optional higher-cost probes:

```powershell
node tests/Test-KritScxLiveSurface.mjs --live --include-tools
node tests/Test-KritScxLiveSurface.mjs --live --include-audio
```

## Local Tooling Alignment

- VS Code temperature UI and request clamp use the SCX OpenAI-compatible `0..1` range.
- File and folder attach dialogs now have a home-folder fallback when no workspace is open.
- Repo attach still requires an open workspace and reports a clear error when none exists.
- The generated spec and live-smoke harness are intended to drive the shim, VS Code dropdowns, model metadata cache, mux testing, and future SCX platform feature wiring.
