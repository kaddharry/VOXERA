/**
 * The one list of environment variables VOXERA reads, with their exact
 * names. `.env.example`, docs/VOXERA_DEPLOYMENT_RUNBOOK.md and the code must
 * agree with this list; __tests__/config/env-schema.test.ts fails if any
 * variable the app reads from process.env, or any variable in .env.example,
 * is missing from it.
 *
 * Names are case-sensitive: `REDIS_URL` and `redis_url` are different
 * variables on Linux (and on Vercel). Only ever set them in UPPER CASE
 * exactly as written here.
 *
 * Requirement levels:
 *  - required: the app can't do its core job (log in, place/answer a call)
 *    without it in Production.
 *  - one-of:llm: at least one LLM provider key must be set.
 *  - feature: only needed when that feature is used.
 *  - optional: tuning / overrides with safe defaults.
 *  - platform: set automatically by Vercel or Node; never set by hand.
 */

export type EnvLevel = "required" | "one-of:llm" | "feature" | "optional" | "platform";

export interface EnvVar {
  name: string;
  level: EnvLevel;
  /** Secret values must never be logged or sent to the browser. */
  secret: boolean;
  /** Where to get the value. */
  source: string;
  purpose: string;
}

export const ENV_SPEC: EnvVar[] = [
  // ── Supabase ──
  { name: "SUPABASE_URL", level: "required", secret: false, source: "Supabase → Project Settings → API → Project URL", purpose: "Database, auth, storage and Realtime." },
  { name: "SUPABASE_ANON_KEY", level: "required", secret: false, source: "Supabase → Project Settings → API Keys → anon / publishable key", purpose: "Signed-in users' requests (row-level security applies)." },
  { name: "SUPABASE_SERVICE_ROLE_KEY", level: "required", secret: true, source: "Supabase → Project Settings → API Keys → service_role / secret key", purpose: "Server-only: call coordination, jobs, Live Calls Realtime. Never expose to the browser." },
  // ── Twilio ──
  { name: "TWILIO_ACCOUNT_SID", level: "required", secret: false, source: "Twilio Console → Account Info", purpose: "Placing outbound calls." },
  { name: "TWILIO_AUTH_TOKEN", level: "required", secret: true, source: "Twilio Console → Account Info", purpose: "Placing calls and verifying Twilio's request signatures." },
  { name: "TWILIO_PHONE_NUMBER", level: "required", secret: false, source: "Twilio Console → Phone Numbers → Active numbers (E.164, e.g. +15551234567)", purpose: "Caller ID for outbound calls." },
  { name: "TWILIO_VALIDATE_STREAM_SIGNATURE", level: "optional", secret: false, source: "Leave unset (= true)", purpose: "Emergency switch: 'false' makes a bad Media Stream handshake signature log-only instead of refused." },
  // ── Public URLs ──
  { name: "VOXERA_PUBLIC_URL", level: "required", secret: false, source: "Vercel → Project → Domains (e.g. https://voxera-mu.vercel.app, no trailing slash)", purpose: "Twilio webhook/stream URLs, signature checks, scheduled calls." },
  { name: "NEXT_PUBLIC_BASE_URL", level: "optional", secret: false, source: "Same value as VOXERA_PUBLIC_URL", purpose: "Older alias of VOXERA_PUBLIC_URL; only read when VOXERA_PUBLIC_URL is unset." },
  { name: "VOICE_STREAM_URL", level: "optional", secret: false, source: "Leave unset on Vercel", purpose: "wss:// URL of a separate voice server, if the call stream ever moves off Vercel." },
  { name: "NEXT_PUBLIC_REALTIME_WS_URL", level: "optional", secret: false, source: "Leave unset on Vercel", purpose: "Local development only: WebSocket URL for the Test Agent drawer." },
  // ── Scheduling ──
  { name: "CRON_SECRET", level: "required", secret: true, source: "Generate: openssl rand -hex 32", purpose: "Authenticates Vercel Cron calls to /api/cron/dispatch (refused in Production without it)." },
  // ── Speech ──
  { name: "DEEPGRAM_API_KEY", level: "required", secret: true, source: "Deepgram Console → API Keys", purpose: "Live speech-to-text and text-to-speech on every call." },
  { name: "GNANI_API_KEY", level: "feature", secret: true, source: "Gnani / Vachana dashboard", purpose: "Indian-language speech, for agents whose speech provider is Gnani." },
  { name: "GNANI_LLM_API_KEY", level: "feature", secret: true, source: "Gnani API dashboard (key with the LLM scope — early access)", purpose: "Optional Gnani Evon LLM, used as a fallback for Indian-language replies." },
  { name: "ELEVENLABS_API_KEY", level: "feature", secret: true, source: "ElevenLabs → Profile → API key", purpose: "Custom voice cloning." },
  // ── LLM ──
  { name: "GROQ_API_KEYS", level: "one-of:llm", secret: true, source: "Groq Console → API Keys (comma-separated for rotation)", purpose: "Primary LLM provider." },
  { name: "GROQ_API_KEYS_2", level: "optional", secret: true, source: "Keys from a second Groq account", purpose: "Second Groq quota, tried before ZenMux." },
  { name: "GROQ_MODEL", level: "optional", secret: false, source: "Groq model id", purpose: "Overrides the default Groq model." },
  { name: "CALL_LEARNING", level: "optional", secret: false, source: "Set to \"off\" to disable", purpose: "Turns off learning from calls (patient facts, agent and global lessons) when set to off." },
  { name: "ZENMUX_API_KEY", level: "one-of:llm", secret: true, source: "ZenMux dashboard", purpose: "LLM fallback after Groq (an OpenAI-compatible gateway; no OpenAI key needed)." },
  { name: "ZENMUX_BASE_URL", level: "optional", secret: false, source: "Default https://zenmux.ai/api/v1", purpose: "Overrides the ZenMux endpoint." },
  { name: "ZENMUX_MODEL", level: "optional", secret: false, source: "Default openai/gpt-4o-mini (a model name served by ZenMux)", purpose: "Overrides the ZenMux model." },
  // ── Emotion models (optional remote paths; the local ONNX models need no key) ──
  { name: "HF_TOKEN", level: "feature", secret: true, source: "Hugging Face → Settings → Access Tokens", purpose: "Remote Hugging Face emotion models (multilingual XLM-EMO)." },
  { name: "HUGGINGFACE_API_KEY", level: "optional", secret: true, source: "Same as HF_TOKEN", purpose: "Older alias of HF_TOKEN." },
  { name: "EMOTION_DIAGNOSTICS", level: "optional", secret: false, source: "Leave unset", purpose: "'on' turns on per-turn emotion diagnostics." },
  // ── Product features ──
  { name: "CREDENTIALS_ENCRYPTION_KEY", level: "feature", secret: true, source: "Generate: openssl rand -base64 32. If credentials were already saved without it, ask before setting it: changing the key makes them unreadable", purpose: "Encrypts tenants' stored integration credentials (falls back to a built-in key when unset, which is not secure)." },
  { name: "RESEND_API_KEY", level: "feature", secret: true, source: "Resend → API Keys", purpose: "Sending email." },
  { name: "PLATFORM_ADMIN_EMAILS", level: "feature", secret: false, source: "Comma-separated emails", purpose: "Who may open /admin/tenants." },
  { name: "DEFAULT_CLIENT_ID", level: "optional", secret: false, source: "A tenant's user id", purpose: "Tenant for inbound calls to a number not assigned in Settings → Phone Numbers (default 'demo')." },
  { name: "FOLLOWUP_AMD", level: "optional", secret: false, source: "Leave unset", purpose: "'off' turns off voicemail detection on follow-up calls (a paid Twilio feature)." },
  { name: "GOOGLE_SERVICE_ACCOUNT_EMAIL", level: "feature", secret: false, source: "Google Cloud service account", purpose: "Google Calendar sync." },
  { name: "GOOGLE_PRIVATE_KEY", level: "feature", secret: true, source: "Google Cloud service account key", purpose: "Google Calendar sync." },
  { name: "GOOGLE_CALENDAR_ID", level: "feature", secret: false, source: "Google Calendar settings", purpose: "Google Calendar sync." },
  { name: "STRIPE_SECRET_KEY", level: "feature", secret: true, source: "Stripe Dashboard → Developers → API keys", purpose: "Billing." },
  { name: "STRIPE_WEBHOOK_SECRET", level: "feature", secret: true, source: "Stripe Dashboard → Webhooks", purpose: "Billing webhooks." },
  { name: "STRIPE_PRICE_STARTER", level: "feature", secret: false, source: "Stripe price id", purpose: "Billing plans." },
  { name: "STRIPE_PRICE_GROWTH", level: "feature", secret: false, source: "Stripe price id", purpose: "Billing plans." },
  { name: "STRIPE_PRICE_ENTERPRISE", level: "feature", secret: false, source: "Stripe price id", purpose: "Billing plans." },
  // ── Set by the platform ──
  { name: "VERCEL", level: "platform", secret: false, source: "Set by Vercel", purpose: "Detects the Vercel runtime." },
  { name: "VERCEL_ENV", level: "platform", secret: false, source: "Set by Vercel", purpose: "production | preview | development." },
  { name: "NODE_ENV", level: "platform", secret: false, source: "Set by Node/Next.js", purpose: "Build mode." },
  { name: "PORT", level: "platform", secret: false, source: "Local server", purpose: "custom-server.ts port." },
  { name: "HOSTNAME", level: "platform", secret: false, source: "Local server", purpose: "custom-server.ts host." },
];

export class MissingEnvError extends Error {
  constructor(public readonly variable: string, purpose: string) {
    super(`Missing environment variable ${variable} (${purpose}). Set it in Vercel → Settings → Environment Variables (exact upper-case name) and redeploy.`);
    this.name = "MissingEnvError";
  }
}

function value(name: string): string | undefined {
  const v = process.env[name]?.trim();
  return v ? v : undefined;
}

/** Variables that must be set for calls to work but aren't. Names only — never values. */
export function missingRequiredEnv(): string[] {
  const missing = ENV_SPEC.filter((v) => v.level === "required" && !value(v.name)).map((v) => v.name);
  const llm = ENV_SPEC.filter((v) => v.level === "one-of:llm");
  if (!llm.some((v) => value(v.name))) missing.push(llm.map((v) => v.name).join(" or "));
  return missing;
}

/** Throws a clear error naming `name` if it isn't set. */
export function requireEnv(name: string): string {
  const v = value(name);
  if (v) return v;
  const spec = ENV_SPEC.find((s) => s.name === name);
  throw new MissingEnvError(name, spec?.purpose ?? "required");
}

let reported = false;

/**
 * Logs, once per instance, which required variables are missing (names
 * only). Called at the entry points of a call so a misconfigured deployment
 * says exactly what's wrong in the Vercel logs.
 */
export function reportMissingEnvOnce(context: string): void {
  if (reported) return;
  reported = true;
  const missing = missingRequiredEnv();
  if (missing.length > 0) {
    console.error(JSON.stringify({ service: "config", event: "config_missing", context, missing }));
  }
}

/** True on a real production deployment (Vercel Production), where placeholders must never be used. */
export function isProductionDeployment(): boolean {
  return process.env.VERCEL_ENV === "production";
}

const PLACEHOLDER_URL = "https://placeholder-project-id.supabase.co";
const PLACEHOLDER_KEY = "placeholder-key";
let warnedPlaceholder = false;

/**
 * Supabase URL + key for a client. In Production a missing value is an
 * error naming the variable — never a silent placeholder (and never the
 * anon key standing in for the service-role key). Outside Production
 * (local builds, tests) a placeholder is used with a warning, so the app
 * can still build and run without a database.
 */
export function supabaseCredentials(kind: "service" | "anon"): { url: string; key: string } {
  const url = value("SUPABASE_URL");
  const key = kind === "service" ? value("SUPABASE_SERVICE_ROLE_KEY") : value("SUPABASE_ANON_KEY");
  const keyName = kind === "service" ? "SUPABASE_SERVICE_ROLE_KEY" : "SUPABASE_ANON_KEY";
  if (url && key) return { url, key };
  if (isProductionDeployment()) {
    throw new MissingEnvError(!url ? "SUPABASE_URL" : keyName, "Supabase connection");
  }
  if (!warnedPlaceholder) {
    warnedPlaceholder = true;
    console.warn(JSON.stringify({ service: "config", event: "supabase_placeholder", missing: [!url && "SUPABASE_URL", !key && keyName].filter(Boolean) }));
  }
  return { url: url ?? PLACEHOLDER_URL, key: key ?? PLACEHOLDER_KEY };
}
