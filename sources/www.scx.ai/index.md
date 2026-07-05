# scx.ai — homepage (captured 2026-07-04)

Source: `https://scx.ai/`
Captured via Playwright MCP by Claude Code / Kritical.SCXCode
Provider: Southern Cross AI Pty Ltd (Australian sovereign AI infrastructure)

## Title / meta

- **Title**: `SCX.ai - Australia's Sovereign AI Infrastructure Provider`
- **Description**: `SCX.ai is Australia's fast, energy efficient, and secure AI infrastructure platform. Deploy with confidence at scale.`
- **OG title**: `Sovereign, Secure, High-Performance AI`
- **OG description**: `Sovereign AI solution for government and enterprise.`

## Positioning

> **Fast inference. Real savings. Total sovereignty.**

> **Sovereign AI without compromise.**
> Australian-hosted infrastructure built for organisations that need security, control, and performance in equal measure.

### Sovereign by design
- No prompt caching
- No training on your data
- Onshore, isolated inference
- IRAP-aligned controls

### Operational control
- Open-weight model support
- API and version stability
- No forced migrations
- Dedicated inference available

### Performance economics
- High-throughput inference
- Predictable local pricing
- Up to 5× better performance per watt
- Scales from prototype to production

## Compatibility (both shapes from one endpoint)

**OpenAI-shape**:

```python
import os
import openai

client = openai.OpenAI(
    base_url="https://api.scx.ai/v1",
    api_key=os.environ.get("SCX_API_KEY"),
)

response = client.chat.completions.create(
    model="MiniMax-M2.5",
    messages=[{"role": "user", "content": "Hello!"}],
)

print(response.choices[0].message.content)
```

**Anthropic-shape**: also supported at the same endpoint (the homepage shows an OpenAI/Anthropic switcher).

## Highlighted models (excerpt — full list at [models.md](./models.md))

- **MiniMax: MiniMax-M2.7** — 230B MoE (10B active, 256 experts). Built for software engineering + agentic tool use. **56.2% SWE-Bench Pro**, matching GPT-5.3-Codex. 192k context. 399 t/s.
- **DeepSeek: DeepSeek-V3.1** — 671B MoE (37B active), hybrid thinking/non-thinking, tool use, 128k context. 200 t/s.
- **OpenAI: gpt-oss-120b** — 117B open-weight MoE (5.1B active), near o4-mini reasoning. 128k context. 655 t/s.
- **scx.ai: coder** — SCX's own coding assistant. 192k context, FP8. Tools + JSON.
- **scx.ai: MAGPiE** — 117B MoE fine-tuned for Australian context with sovereign data handling. 128k context.

## Enterprise capabilities

- Performant LLM runtimes (Qwen, DeepSeek, Llama, gpt-oss on purpose-built dataflow accelerators)
- Optimised transcription — Whisper-Large-v3 with lowest time-to-first-byte
- Fastest embeddings — E5-Mistral-7B-Instruct, 32K context, 4,096 dimensions
- Enterprise-grade guardrails (keyword + content filters, PII detection, custom webhooks)
- Managed vector stores (built-in embeddings, configurable distance metrics)
- Ultra-low-latency compound AI (dataflow architecture, 6× better resource utilisation)

## Data sovereignty guarantees

- No prompt caching
- No input or output retention
- No training on your data
- No resale or reuse across customers/partners

## Use cases advertised

- Code Assistance (IDE copilots, code generation, debugging agents)
- Conversational AI (support, helpdesk, multilingual)
- Agentic Systems (multi-step reasoning, planning, execution)
- Search (enterprise assistants, summarisation, semantic search)
- Multimodal (text + vision, real-time workflows)
- Enterprise RAG (secure knowledge retrieval)

## AI Enablement & Support Services

- Embedded AI engineering (solution architects + ML engineers embed in customer teams)
- Solution architecture (IRAP-ready security design, RAG pipelines)
- Integration & agentic AI (OpenAI-compatible APIs, agent frameworks, tool calling, intelligent model routing)
- Model optimisation & ACE (LoRA/PEFT fine-tuning, Agentic Context Engineering)

## Key destinations

| Destination | URL | Purpose |
|---|---|---|
| Main | https://scx.ai/ | Marketing home |
| Platform / Sign-in | https://platform.scx.ai/sign-in | Get API key |
| Models catalog | https://scx.ai/models | 15 models with specs |
| Benchmarks | https://scx.ai/benchmarks | Vendor-agnostic benchmarks |
| Sovereignty assessment | https://scx.ai/assessment | Self-check |
| Sovereign audit | https://scx.ai/sovereign-audit | Technical audit |
| Industries / solutions | https://scx.ai/industries | Vertical use cases |
| Partner program | https://scx.ai/partner-program | ★ Kritical positioning angle |
| AI Enablement | https://scx.ai/ai-enablement | Managed services |
| Contact | https://scx.ai/contact | Sales contact |
| Trust Center | https://trust.scx.ai | Compliance |
| Whitepaper | https://scx.ai/whitepaper | Technical positioning |
| Tokens | https://scx.ai/tokens | Inference-as-a-Service |
| Containers | https://scx.ai/containers | Container deployment |
| MAGPiE Societies | https://scx.ai/magpie-societies | Aus-tuned model community |
| Labs | https://labs.scx.ai | Research + benchmarks |
| Investor relations | https://scx.ai/investors | Corporate |
| GitHub | https://github.com/SouthernCrossAI | Source repos |
| LinkedIn | https://www.linkedin.com/company/southerncrossai | Company |

## Full page text (verbatim capture)

> Fast inference.
> Real savings.
> Total sovereignty.
>
> Get your API key
> Check your sovereign posture
>
> SWITCH FASTER THAN YOU CAN READ THIS.
>
> OpenAI and Anthropic compatible in just two lines.
>
> [code sample above]
>
> SOVEREIGN. CONTROLLED. FAST.
>
> Sovereign AI without compromise.
>
> Australian-hosted infrastructure built for organisations that need security, control, and performance in equal measure.
>
> [Sovereign by design / Operational control / Performance economics — expanded above]
>
> Powerful Open-Source Models.
> Access the latest frontier models from Meta, Google and OpenAI.
>
> [5 headline models expanded above]
>
> Engineered for the most demanding Gen AI apps.
> Purpose-built inference infrastructure optimised for throughput, latency, and cost at every layer of the stack.
>
> [Enterprise capabilities expanded above]
>
> Your AI data stays yours.
> SCX.ai is built for organisations that cannot afford data leakage, uncontrolled model behaviour, or opaque AI vendors.
>
> [Data sovereignty guarantees expanded above]
>
> What Can You Build on SCX.ai
> From experimentation to production, SCX.ai provides the platform to build your Generative AI capabilities—optimised and at scale.
>
> [Use cases expanded above]
>
> AI ENABLEMENT & SUPPORT SERVICES
> Your engineering team. Our AI platform expertise.
>
> [Enablement services expanded above]
>
> Scale to trillions of tokens without breaking the bank.
> Low pay-as-you-go pricing—no long-term contracts, no hidden fees, no surprises.
>
> Introducing SCX Labs.
> Building the future of sovereign AI — open research, vendor-agnostic benchmarks, and live model work.
