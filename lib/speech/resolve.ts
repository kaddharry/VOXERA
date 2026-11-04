import { supabase, isSupabaseHealthy } from "../db/supabase";
import { getAgentWithTenant, type AgentWithTenant } from "../db/agents";
import type { SpeechProvider } from "./types";

export interface ResolvedSpeechConfig {
  provider: SpeechProvider;
  language: string;
  /** Raw voice_persona string from whichever row it was resolved from — for
   * Gnani this is the composite "gnani:<model>:<voiceId>" format (see
   * lib/tts/gnani-voices.ts's parseGnaniPersona), null if unset. Not
   * meaningful for Deepgram here (resolved separately via resolveVoiceModel
   * in stream-handler.ts, which already has its own tenant/agent logic). */
  voicePersona: string | null;
}

const DEFAULT_CONFIG: ResolvedSpeechConfig = { provider: "deepgram", language: "en-IN", voicePersona: null };

// Same 5-minute-TTL in-memory cache pattern as getClientVoiceSettings()
// (lib/deepgram/tts.ts) — a tenant's speech defaults almost never change
// mid-session, so there's no reason to pay a Supabase round trip on every
// single call/turn.
const CACHE_TTL_MS = 5 * 60 * 1000;
const tenantDefaultCache = new Map<string, { value: ResolvedSpeechConfig; ts: number }>();

export function __clearSpeechResolveCacheForTesting(): void {
  tenantDefaultCache.clear();
}

function normalizeProvider(value: string | null | undefined): SpeechProvider {
  return value === "gnani" ? "gnani" : "deepgram";
}

/** business_settings.language's pre-v27 default was the free-text 'English'
 * — treat that (and anything else unrecognized) as the en-IN default rather
 * than matching it literally. */
function normalizeLanguage(value: string | null | undefined): string {
  if (!value || value === "English") return DEFAULT_CONFIG.language;
  return value;
}

async function getTenantDefault(clientId: string): Promise<ResolvedSpeechConfig> {
  const cached = tenantDefaultCache.get(clientId);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) return cached.value;

  // Same outage-skip behavior as getClientVoiceSettings — fall through to
  // the hard default rather than risk the round trip during a known outage.
  if (!isSupabaseHealthy()) return DEFAULT_CONFIG;

  let result = DEFAULT_CONFIG;
  try {
    const { data: tenant } = await supabase.from("tenants").select("id").eq("auth_user_id", clientId).single();
    if (tenant) {
      const { data: settings } = await supabase
        .from("business_settings")
        .select("speech_provider, language, voice_persona")
        .eq("tenant_id", tenant.id)
        .single();
      if (settings) {
        result = {
          provider: normalizeProvider(settings.speech_provider),
          language: normalizeLanguage(settings.language),
          voicePersona: settings.voice_persona ?? null,
        };
      }
    }
  } catch (err) {
    console.warn("[speech/resolve] Failed to resolve tenant speech default, using Deepgram/English:", err);
  }
  tenantDefaultCache.set(clientId, { value: result, ts: Date.now() });
  return result;
}

/**
 * Resolves the speech provider+language for a call: the agent's own
 * `speech_provider`/`language` columns win when set, otherwise falls back to
 * the tenant's business_settings default.
 *
 * Pass `agentRow` when the caller already fetched the agent (e.g.
 * TelephonyStreamHandler.setupVoiceForCall() already calls
 * getAgentWithTenant) to skip a second query. Omit it (with an `agentId`) to
 * have this function do its own lookup — used by callers that don't already
 * have the row, e.g. the browser demo path.
 */
export async function resolveSpeechConfig(
  clientId: string,
  agentId?: string,
  agentRow?: Pick<AgentWithTenant, "speech_provider" | "language" | "voice_persona"> | null
): Promise<ResolvedSpeechConfig> {
  let row = agentRow;
  if (row === undefined && agentId) {
    row = await getAgentWithTenant(supabase, agentId).catch(() => null);
  }

  if (!row?.speech_provider && !row?.language && !row?.voice_persona) {
    return getTenantDefault(clientId);
  }

  const fallback = await getTenantDefault(clientId);
  return {
    provider: row.speech_provider ? normalizeProvider(row.speech_provider) : fallback.provider,
    language: row.language ? normalizeLanguage(row.language) : fallback.language,
    voicePersona: row.voice_persona ?? fallback.voicePersona,
  };
}
