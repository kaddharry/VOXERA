import type { SupabaseClient } from "@supabase/supabase-js";

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
}

const AGENT_COLUMNS =
  "id, tenant_id, name, type, status, description, system_prompt, greeting, voice_persona, speech_provider, language, created_at, updated_at";

function unwrapTenant(row: any): string | undefined {
  const t = Array.isArray(row.tenants) ? row.tenants[0] : row.tenants;
  return t?.auth_user_id;
}

/** Used by the orchestrator/server.ts to resolve an agentId into its custom
 * prompt and the tenant clientId that scopes its knowledge base. Logs the
 * real reason on failure — this previously returned null silently on any
 * Supabase error (RLS block, wrong key, missing tenant join, etc.), which
 * made "the agent isn't being picked up" completely undiagnosable: the
 * caller just saw a silent fallback to the demo agent with zero indication
 * of why the lookup actually failed. */
export async function getAgentWithTenant(db: SupabaseClient, agentId: string): Promise<AgentWithTenant | null> {
  const { data, error } = await db
    .from("agents")
    .select(`${AGENT_COLUMNS}, tenants!inner(auth_user_id)`)
    .eq("id", agentId)
    .single();
  if (error) {
    // PGRST116 = no rows matched — the expected, silent case for a bad/
    // deleted agentId. Anything else (RLS denial, connection failure, a
    // schema mismatch) is a real problem worth surfacing loudly.
    if (error.code !== "PGRST116") {
      console.error(`[lib/db/agents] getAgentWithTenant(${agentId}) failed:`, error.message, `(code: ${error.code})`);
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
  return { ...agent, tenant_auth_user_id: tenantAuthUserId };
}

export async function getTenantIdForUser(db: SupabaseClient, authUserId: string): Promise<string | null> {
  const { data, error } = await db.from("tenants").select("id").eq("auth_user_id", authUserId).single();
  if (error || !data) return null;
  return data.id;
}

export async function listAgentsForTenant(db: SupabaseClient, tenantId: string): Promise<AgentRecord[]> {
  const { data, error } = await db
    .from("agents")
    .select(AGENT_COLUMNS)
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false });
  if (error || !data) return [];
  return data as unknown as AgentRecord[];
}

export async function getAgentForTenant(db: SupabaseClient, agentId: string, tenantId: string): Promise<AgentRecord | null> {
  const { data, error } = await db
    .from("agents")
    .select(AGENT_COLUMNS)
    .eq("id", agentId)
    .eq("tenant_id", tenantId)
    .single();
  if (error || !data) return null;
  return data as unknown as AgentRecord;
}

export async function createAgent(db: SupabaseClient, tenantId: string, fields: AgentFields): Promise<AgentRecord | null> {
  const { data, error } = await db
    .from("agents")
    .insert({
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
    })
    .select(AGENT_COLUMNS)
    .single();
  if (error || !data) {
    console.error("[lib/db/agents] createAgent failed:", error?.message);
    return null;
  }
  return data as unknown as AgentRecord;
}

export async function updateAgent(
  db: SupabaseClient,
  agentId: string,
  tenantId: string,
  fields: Partial<AgentFields>
): Promise<AgentRecord | null> {
  const { data, error } = await db
    .from("agents")
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq("id", agentId)
    .eq("tenant_id", tenantId)
    .select(AGENT_COLUMNS)
    .single();
  if (error || !data) {
    console.error("[lib/db/agents] updateAgent failed:", error?.message);
    return null;
  }
  return data as unknown as AgentRecord;
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
