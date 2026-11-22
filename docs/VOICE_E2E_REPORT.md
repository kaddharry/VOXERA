# Voice agent end-to-end test report (Gnani agent "Sivani", language = auto)

Method: `scripts/voice_e2e_test.ts` drives the REAL `server.ts` WebSocket. Gnani TTS plays the caller in 11 languages;
audio is streamed as 16 kHz PCM in real time → Gnani STT (prisma-v3.0 indic-auto) → orchestrator + LLM → Gnani TTS streaming
back. Every event is timestamped. Run it again with:
`REALTIME_SERVER_PORT=3011 npx tsx --env-file=.env.local scripts/voice_e2e_test.ts all`

## Before → after (22 language turns)
| | before fixes | after fixes |
|---|---|---|
| median "felt" latency (end of caller speech → first agent audio) | 3.2 s | 3.1 s |
| p90 | 7.2 s | 3.5 s |
| worst turn | 8.1 s (21.9 s in an intermediate run) | 4.5 s |
| turns > 5 s | 5 / 22 | 0 / 22 |
| LLM retry timeouts (KeyRotator) | 6 per run | 0 |
| garbled / duplicated replies | yes (Hinglish, Bengali) | none |

## Root causes found and fixed
1. Model reasoning spoken aloud: planning text reached TTS → `reply-hygiene.ts` filter + `reasoning_format: hidden`.
2. Whole-reply 5 s race timeout (`executeWithRotation`) restarted healthy long replies on another key while the first kept
   streaming into the same chunker → 6-20 s turns, glued/duplicated text → stall watchdog + per-attempt reset.
3. Groq 8000 tokens/min per key vs a ~4k-token prompt → prompt cut ~39 % (15.0k → 9.2k chars) + round-robin keys.
4. Browser test handler dropped a second STT fragment that arrived while the agent was thinking → merge (as telephony does).
5. Hindi guard sentences were English; Marathi answered in Hindi; English caller answered in Hindi once; "देता/देती"
   gender slash; caller gender assumed → localized guards, language hint per turn, speaker-gender from voice.
6. Hindi `।` was not a sentence end → Hindi replies waited for the safety valve.

## Barge-in / turn-taking (8/8 pass, 3 runs)
- client-VAD `barge_in` stops audio (0 chunks after 300 ms); next turn answered. PASS
- server-side RMS fallback stops audio with no client message. PASS
- barge-in while the LLM is still thinking drops the stale reply. PASS
- second utterance during a turn is not lost. PASS
- 8 s of silence → no reply. PASS
- caller talking over the greeting still gets an answer. PASS
- 0.7 s mid-sentence pause: STT splits it into 2 finals; fragments merge only if the 2nd arrives while the agent is still
  thinking. Otherwise they become 2 replies. KNOWN LIMIT (see below).

## Known limits / next steps
- Felt latency ≈ 3.1 s: ~0.9 s STT endpointing + ~0.3-0.6 s emotion/embedding + ~0.7 s LLM first clause + ~0.3 s TTS first
  audio + ~0.9 s audio-emotion ML. Biggest lever: run the audio-emotion pass off the critical path.
- STT endpointing splits at ~0.5-0.7 s pauses. Consider a Gnani advanced-ASR endpointing setting or a short hold.
- Gnani Evon LLM is wired as an optional fallback but the current key lacks the LLM scope (403 SCOPE_NOT_ALLOWED).
- Replies for symptoms are still 7-9 s of audio in long-word languages (Tamil/Telugu); consider a tighter cap there.
- 3 unit-test files cannot load because `@electric-sql/pglite` is not installed (pre-existing).
