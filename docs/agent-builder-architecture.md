# VOXERA agent builder: architecture review and upgrade plan

Updated 6 November 2026

## What exists today

- The AI create flow captures the brief, call outcome, tone, language/provider, and enabled actions. The editor has persona, prompt, knowledge, built-in tools, and MCP connections.
- Agent prompts and greetings are saved per agent. The call path resolves an agent's tenant, prompt, speech provider, and language.
- Built-in appointment actions and selected MCP server tools are allowlisted per agent and dispatched by the LLM layer. MCP credentials are encrypted and tenant scoped.
- Uploads are parsed, chunked, embedded, and stored in pgvector. Small and large knowledge sources are now retrieved only when factual/action cues are detected; obvious social turns skip client KB retrieval.
- The telephony path accepts final STT transcripts, runs `handleTurn`, and streams LLM clauses to TTS. Logs report audio-to-final-transcript, final-transcript-to-first-text, and final-transcript-to-first-audio stages.
- The current provider capabilities are not language universal: Deepgram is configured here for English, while Gnani is used for the supported Indian-language and code-mixed configurations.

## Product and architecture direction

Build an agent from a structured capability manifest, not from prose alone. The builder should first gather a short business brief, desired outcome, audience, language/provider, tone, allowed actions, and safety/escalation constraints. Ask follow-up questions only for consequential missing facts (for example, whether an appointment may be booked or only requested); otherwise make conservative assumptions visible in the draft. Generate persona, greeting, concise runtime instructions, tool policy, language behavior, knowledge policy, and test scenarios from that shared manifest.

Keep capability configuration authoritative. The builder should read connected tools and knowledge status, pass those capabilities to generation, and validate them again when saving. Prompt text is descriptive; runtime allowlists and tool schemas enforce what the agent can do. Rebuild or lint the prompt whenever capabilities change, and show a warning if configured intent lacks an enabled action.

### Target components

1. **Agent specification** — versioned structured JSON for goal, persona, language policy, allowed intents, tool IDs, knowledge sources, confirmations, escalation, and success criteria. Keep generated prompt as a rendered artifact with spec and model version metadata.
2. **Builder interview** — one to three adaptive questions selected from missing high-impact fields. Include a preview and let the user revise assumptions before saving.
3. **Capability registry** — typed tool contracts with name, description, JSON schema, auth reference, timeout, retry policy, idempotency policy, and tenant scope. Start with internal appointment tools; add reusable HTTPS/webhook tools and MCP server connections as separately permissioned capabilities. Never expose secrets to the model. Require owner/admin approval and test the tool before enabling it.
4. **Knowledge service** — per-tenant/per-agent source assignment, extraction status, chunking and embedding metadata, retrieval thresholds, citations, and versioning. Trigger retrieval only for factual business intents (or when the model explicitly requests the query tool); do not prepend the full KB to every call. Keep ingestion separate from per-call retrieval, cache embeddings/index lookups, and expose retrieval traces.
5. **Voice runtime** — provider capability negotiation for language, locale, STT, TTS, code switching, streaming, interruption, and endpointing. Do not present unsupported language/provider combinations. Measure endpointing, STT final, LLM first token, first TTS audio, tool wait, and total caller-perceived latency independently.
6. **Evaluation loop** — generate a compact scenario set from the agent spec (common intents, ambiguity, tool success/failure, unsupported request, interruption, language switching, and angry caller). Run offline and live-test calls; inspect tool correctness, grounded answers, turn latency, interruption recovery, and language naturalness before publishing.

## Implementation sequence

### Now: builder reliability and grounded drafting

- Replace the single-input generation with the brief plus call outcome, tone, language/provider, enabled actions, and connected knowledge state.
- Constrain prompt generation to enabled tool IDs and available provider capabilities. Treat uploaded material as business data, never as instructions to the generator.
- Fail the build if attached files fail to upload/index; use the completed upload result in the same generation request.
- Keep preview/edit/review before save.

### Next: broader tool support and capability-aware prompt reconciliation

- Add a tenant-scoped reusable tool registry and agent-to-tool assignments; persist schemas and secret references securely.
- Implement a signed/allowlisted HTTP tool executor with schema validation, strict timeouts, idempotency for writes, audit logs, and tool-result summaries.
- Extend MCP auth beyond bearer and API-key headers, add connection health UI, and evaluate more transports. Current integration supports HTTPS Streamable HTTP with public-host checks, response bounds, per-agent allowlists, and encrypted tokens.
- Add prompt lint/reconciliation when tools or knowledge sources are connected, removed, or fail health checks.

### Then: multilingual call quality and richer retrieval diagnostics

- Improve the current multilingual intent cue gate with tenant-configurable intents or a calibrated classifier and source-tagged retrieval. Return short passages and abstain if relevance is weak.
- Add retrieval probes for greetings/small talk to verify the KB is skipped, and factual questions to verify it is called.
- Tune endpointing and interruption per STT provider and call environment. Deepgram documents endpointing as configurable silence duration (for example 300 ms); choose it using real call recordings and avoid cutting off code-mixed speech. Gnani final-transcript boundaries and supported language models should be measured independently.
- Build a language/provider test matrix, especially English, Hindi, Hinglish, and each supported regional language, with noisy 8 kHz calls, names, numbers, and mid-call language changes.
- Add per-stage latency telemetry and set budgets from production percentiles before changing model/retry behavior. Fast turn-taking is an end-to-end property; lowering endpoint delay alone cannot fix slow model or TTS startup.

## Research notes

- Vapi describes tool calls as model selection, runtime resolution/validation, execution, and returning results; its tools include function/API, handoff, transfer, and MCP options. Its latency guide separates transport, endpointing, transcription, model time-to-first-token, and first audio. This supports capability manifests and per-stage telemetry rather than a prompt-only solution. [Vapi tools](https://docs.vapi.ai/tools) · [Vapi latency](https://docs.vapi.ai/assistants/model-intelligence/understanding-latency)
- ElevenLabs groups agent construction around system prompts, workflows/turn-taking, voice and language, knowledge, and tools/MCP. Its channel controls also frame response time as a budget across reasoning and tool calls. This supports keeping voice behavior, capabilities, and prompt generation as coordinated settings. [ElevenLabs build overview](https://elevenlabs.io/docs/eleven-agents/build/overview) · [Channel behavior](https://elevenlabs.io/docs/eleven-agents/customization/channel-behavior)
- Deepgram's streaming docs expose endpointing in milliseconds and interim results; this is a tunable boundary, not a universal best value. [Deepgram endpointing](https://developers.deepgram.com/docs/understand-endpointing-interim-results)
- Gnani's API documentation publishes its available STT/TTS, streaming, and language-specific interfaces. Use the configured product/model capability list as source of truth rather than claiming universal language coverage. [Gnani API docs](https://docs.gnani.ai/)

## Current change in this branch

The AI create form captures success outcome, desired tone, language/provider, and enabled actions. Prompt generation receives capability selections and attached business references. The Tools tab manages tenant MCP connections, discovers schemas, and selects per-agent capabilities. Prompt regeneration uses selected tools and current knowledge availability. The runtime skips obvious non-factual turns before client KB retrieval and logs response latency stages. Language coverage still depends on configured vendors; this work does not claim support beyond their available STT/TTS models.
