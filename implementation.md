# VOXERA PR Implementation Summary

This document summarizes the engineering logic implemented to resolve Issue #16: Business Voice Personalization & Customer Recovery.

---

## 1. Database Migrations (`sql/migration_v7.sql`)
Added settings columns to the `public.business_settings` table to link custom voice cloning and recovery configurations to individual business tenants:
* `voice_provider`: Specifies the current custom voice provider (`'elevenlabs'`, `'deepgram'`).
* `custom_voice_id`: Holds the voice ID returned from the cloning API.
* `sms_recovery_enabled`: Boolean flag to toggle post-call SMS triggers.
* `sms_recovery_template`: Text template for recovery SMS with `{{link}}` support placeholder.
* `sms_recovery_link`: Target URL of the tenant's support or feedback page.

---

## 2. ElevenLabs Custom Voice Personalization (`lib/tts/voice-clone.ts`)
Created a dedicated Voice Personalization service supporting:
* **Voice Cloning:** Native form data upload of audio samples to the ElevenLabs `/v1/voices/add` API. Falls back to generating a unique mock voice ID in local environments without API keys.
* **Speech Synthesis:** Calls ElevenLabs `/v1/text-to-speech/{voice_id}` requesting `pcm_8000` (8kHz linear16 PCM) output format, matching Twilio's sample rate specifications.

---

## 3. Dynamic TTS Routing (`lib/deepgram/tts.ts`)
Upgraded speech generation to check tenant settings:
* Fetches the client's `business_settings` from the database.
* If a custom ElevenLabs voice is configured, it synthesizes the audio via ElevenLabs.
* If the synthesis fails, or if no custom voice is configured, it falls back to the default Deepgram voice, ensuring high reliability and zero downtime.

---

## 4. Post-Call SMS Customer Recovery (`lib/telephony/stream-handler.ts`, `lib/telephony/sms.ts`)
* **SMS Dispatch Utility:** Uses the Twilio REST client to dispatch messages. Falls back to console log simulation when Twilio keys are absent.
* **Sentiment recovery trigger:** On call end (`onCallEnded`), the handler retrieves the final user utterance from Short-Term Memory (STM) and checks its emotional state.
* If the final emotion is negative (`anger`, `frustration`, `sadness`, `distress`, `disappointment`) and recovery is enabled:
  - Formats the SMS recovery message (replacing the `{{link}}` placeholder with the configured support link).
  - Triggers the SMS dispatch via Twilio to the customer's phone number.

---

## 5. settings Page Dashboard (`app/admin/settings/page.tsx`, `/api/settings/*`)
* **Settings APIs:** Added REST endpoints `/api/settings/voice` and `/api/settings/recovery` to retrieve and save configurations from the database instead of browser `localStorage`.
* **Sleek UI:** Enhanced Settings Page UI with dark glassmorphism card components, dropzone file upload capability, custom voice selectors, and toggle switches for customer recovery configurations.
