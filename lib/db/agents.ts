import type { SupabaseClient } from "@supabase/supabase-js";
import { isMissingColumnError } from "./follow-up-tasks";

/**
 * Shared DB access for the `agents` table (migration_v2.sql + v11.sql).
 * Functions take a SupabaseClient rather than importing one directly, so
 * they work equally with the cookie-bound, RLS-respecting client used by
 * the authenticated /api/admin/agents routes and the service-role client
 * used by the orchestrator/server.ts (which have no logged-in session to
 * bind to).
 */

export interface AgentRecord {
  id: string;
  tenant_id: string;
  name: string;
  type: string | null;
  status: string;
  description: string | null;
  system_prompt: string | null;
  greeting: string | null;
  voice_persona: string | null;
  /** NULL = inherit the tenant's business_settings default. See lib/speech/resolve.ts. */
  speech_provider: string | null;
  /** NULL = inherit the tenant default. Ignored when speech_provider resolves to "deepgram". */
  language: string | null;
  /** migration_v29.sql — explicit allowlist of tool names (see
   * lib/agent/tools.ts's getToolsForAgent) this agent may call during a
   * live turn. Defaults to [] for every agent, including every agent that
   * existed before this column did — an agent gets a tool only once a
   * hospital admin opts it in, never implicitly. */
  enabledTools: string[];
  created_at: string;
  updated_at: string;
}

export interface AgentWithTenant extends AgentRecord {
  tenant_auth_user_id: string;
}

export interface AgentFields {
  name: string;
  description?: string | null;
  system_prompt?: string | null;
  greeting?: string | null;
  voice_persona?: string | null;
  speech_provider?: string | null;
  language?: string | null;
  type?: string | null;
  enabledTools?: string[];
}

const BASE_AGENT_COLUMNS =
  "id, tenant_id, name, type, status, description, system_prompt, greeting, voice_persona, created_at, updated_at";
/** migration_v27.sql adds speech_provider/language (see lib/speech/resolve.ts);
 * migration_v29.sql adds "enabledTools". Both tiers fall back together to
 * BASE_AGENT_COLUMNS if either migration hasn't run yet — see
 * withAgentColumnFallback below. */
const AGENT_COLUMNS = `${BASE_AGENT_COLUMNS}, speech_provider, language, "enabledTools"`;

function unwrapTenant(row: any): string | undefined {
  const t = Array.isArray(row.tenants) ? row.tenants[0] : row.tenants;
  return t?.auth_user_id;
}

/** Fills in defaults for rows read via the base-columns fallback (which
 * simply won't have `speech_provider`/`language` keys at all), so every
 * caller still gets a complete, consistently-shaped AgentRecord either way —
 * same reasoning as lib/db/patients.ts's withDefaults() for migration_v28. */
function withSpeechDefaults<T extends Record<string, unknown>>(
  row: T,
): T & { speech_provider: string | null; language: string | null; enabledTools: string[] } {
  return {
    ...row,
    speech_provider: (row.speech_provider as string | null | undefined) ?? null,
    language: (row.language as string | null | undefined) ?? null,
    enabledTools: (row.enabledTools as string[] | null | undefined) ?? [],
  };
}

/** Runs an agents-table select with AGENT_COLUMNS first; if that fails
 * specifically because the speech_provider/language columns don't exist yet
 * (migration_v27.sql hasn't run), retries with just BASE_AGENT_COLUMNS —
 * `columns` is threaded through so callers can still append a join (e.g.
 * getAgentWithTenant's `tenants!inner(auth_user_id)`). Without this, every
 * agent read failed outright pre-migration (not just speech-provider
 * lookups), since Postgres rejects the whole query when any selected column
 * is missing — same failure class lib/db/patients.ts's migration_v28 fix
 * addressed for "condition"/"riskLevel". */
async function withAgentColumnFallback<T>(
  run: (columns: string) => PromiseLike<{ data: T | null; error: { code?: string; message?: string } | null }>,
): Promise<{ data: T | null; error: { code?: string; message?: string } | null; migrationPending: boolean }> {
  const result = await run(AGENT_COLUMNS);
  if (result.error && isMissingColumnError(result.error)) {
    const fallback = await run(BASE_AGENT_COLUMNS);
    return { ...fallback, migrationPending: true };
  }
  return { ...result, migrationPending: false };
}

const MIGRATION_WARNING =
  '[lib/db/agents] "speech_provider"/"language"/"enabledTools" columns not found — run sql/migration_v27.sql and sql/migration_v29.sql. Resolving without them in the meantime.';

/** Used by the orchestrator/server.ts to resolve an agentId into its custom
 * prompt and the tenant clientId that scopes its knowledge base. Logs the
 * real reason on failure — this previously returned null silently on any
 * Supabase error (RLS block, wrong key, missing tenant join, etc.), which
 * made "the agent isn't being picked up" completely undiagnosable: the
 * caller just saw a silent fallback to the demo agent with zero indication
 * of why the lookup actually failed. */
export async function getAgentWithTenant(db: SupabaseClient, agentId: string): Promise<AgentWithTenant | null> {
  const { data, error, migrationPending } = await withAgentColumnFallback((columns) =>
    db
      .from("agents")
      .select(`${columns}, tenants!inner(auth_user_id)`)
      .eq("id", agentId)
      .single()
  );
  if (migrationPending) console.warn(MIGRATION_WARNING);
  if (error) {
    // PGRST116 = no rows matched — the expected, silent case for a bad/
    // deleted agentId. Anything else (RLS denial, connection failure, a
    // schema mismatch) is a real problem worth surfacing loudly.
    if ((error as { code?: string }).code !== "PGRST116") {
      console.error(`[lib/db/agents] getAgentWithTenant(${agentId}) failed:`, error.message, `(code: ${(error as { code?: string }).code})`);
    }
    return null;
  }
  if (!data) return null;
  const tenantAuthUserId = unwrapTenant(data);
  if (!tenantAuthUserId) {
    console.error(
      `[lib/db/agents] getAgentWithTenant(${agentId}) found the agent row but its tenant join returned no ` +
        `auth_user_id — the agent's tenant_id likely doesn't match any row in tenants, or that tenant has no auth_user_id set.`
    );
    return null;
  }
  const { tenants, ...agent } = data as any;
  return { ...withSpeechDefaults(agent), tenant_auth_user_id: tenantAuthUserId };
}

export async function getTenantIdForUser(db: SupabaseClient, authUserId: string): Promise<string | null> {
  const { data, error } = await db.from("tenants").select("id").eq("auth_user_id", authUserId).single();
  if (error || !data) return null;
  return data.id;
}

export async function listAgentsForTenant(db: SupabaseClient, tenantId: string): Promise<AgentRecord[]> {
  const { data, error, migrationPending } = await withAgentColumnFallback((columns) =>
    db.from("agents").select(columns).eq("tenant_id", tenantId).order("created_at", { ascending: false })
  );
  if (migrationPending) console.warn(MIGRATION_WARNING);
  if (error || !data) return [];
  return (data as unknown as Record<string, unknown>[]).map(withSpeechDefaults) as unknown as AgentRecord[];
}

export async function getAgentForTenant(db: SupabaseClient, agentId: string, tenantId: string): Promise<AgentRecord | null> {
  const { data, error, migrationPending } = await withAgentColumnFallback((columns) =>
    db.from("agents").select(columns).eq("id", agentId).eq("tenant_id", tenantId).single()
  );
  if (migrationPending) console.warn(MIGRATION_WARNING);
  if (error || !data) return null;
  return withSpeechDefaults(data as unknown as Record<string, unknown>) as unknown as AgentRecord;
}

export async function createAgent(db: SupabaseClient, tenantId: string, fields: AgentFields): Promise<AgentRecord | null> {
  const payload: Record<string, unknown> = {
    tenant_id: tenantId,
    name: fields.name,
    type: fields.type ?? "custom",
    status: "active",
    description: fields.description ?? null,
    system_prompt: fields.system_prompt ?? null,
    greeting: fields.greeting ?? null,
    voice_persona: fields.voice_persona ?? "female-friendly",
    speech_provider: fields.speech_provider ?? null,
    language: fields.language ?? null,
    enabledTools: fields.enabledTools ?? [],
  };

  let { data, error } = await db.from("agents").insert(payload).select(AGENT_COLUMNS).single();
  if (error && isMissingColumnError(error)) {
    console.warn('[lib/db/agents] "speech_provider"/"language"/"enabledTools" columns not found — run sql/migration_v27.sql and sql/migration_v29.sql. Creating agent without them in the meantime.');
    const { speech_provider: _speechProvider, language: _language, enabledTools: _enabledTools, ...basePayload } = payload;
    void _speechProvider;
    void _language;
    void _enabledTools;
    ({ data, error } = await db.from("agents").insert(basePayload).select(BASE_AGENT_COLUMNS).single());
  }
  if (error || !data) {
    console.error("[lib/db/agents] createAgent failed:", error?.message);
    return null;
  }
  return withSpeechDefaults(data as unknown as Record<string, unknown>) as unknown as AgentRecord;
}

export async function updateAgent(
  db: SupabaseClient,
  agentId: string,
  tenantId: string,
  fields: Partial<AgentFields>
): Promise<AgentRecord | null> {
  const payload = { ...fields, updated_at: new Date().toISOString() };
  let { data, error } = await db.from("agents").update(payload).eq("id", agentId).eq("tenant_id", tenantId).select(AGENT_COLUMNS).single();
  if (error && isMissingColumnError(error)) {
    if (fields.speech_provider !== undefined || fields.language !== undefined || fields.enabledTools !== undefined) {
      // The caller explicitly asked to change one of the missing columns —
      // nothing to fall back to without silently dropping that part of the
      // request, same posture as lib/db/patients.ts's updatePatient for
      // condition/riskLevel: fail loudly rather than pretend it saved.
      console.error(`[lib/db/agents] updateAgent(${agentId}) failed: "speech_provider"/"language"/"enabledTools" columns don't exist yet — run sql/migration_v27.sql and sql/migration_v29.sql before editing them.`);
      return null;
    }
    console.warn('[lib/db/agents] "speech_provider"/"language"/"enabledTools" columns not found — run sql/migration_v27.sql and sql/migration_v29.sql. Updating agent without them in the meantime.');
    ({ data, error } = await db.from("agents").update(payload).eq("id", agentId).eq("tenant_id", tenantId).select(BASE_AGENT_COLUMNS).single());
  }
  if (error || !data) {
    console.error("[lib/db/agents] updateAgent failed:", error?.message);
    return null;
  }
  return withSpeechDefaults(data as unknown as Record<string, unknown>) as unknown as AgentRecord;
}

export async function deleteAgent(db: SupabaseClient, agentId: string, tenantId: string): Promise<boolean> {
  const { error } = await db.from("agents").delete().eq("id", agentId).eq("tenant_id", tenantId);
  if (error) {
    console.error("[lib/db/agents] deleteAgent failed:", error.message);
    return false;
  }
  return true;
}

export interface PublicAgentListing {
  id: string;
  name: string;
  description: string | null;
  tenantAuthUserId: string;
}

/** Minimal, no-auth listing — powers the "which agent am I testing/calling"
 * selectors on the public /demo page, mirroring /api/tenants' shape. */
export async function listPublicAgents(db: SupabaseClient): Promise<PublicAgentListing[]> {
  const { data, error } = await db
    .from("agents")
    .select("id, name, description, tenants!inner(auth_user_id)")
    .order("created_at", { ascending: false })
    .limit(50);
  if (error || !data) return [];
  return data
    .map((a: any) => ({
      id: a.id,
      name: a.name || "Untitled agent",
      description: a.description ?? null,
      tenantAuthUserId: unwrapTenant(a),
    }))
    .filter((a): a is PublicAgentListing => !!a.tenantAuthUserId);
}
