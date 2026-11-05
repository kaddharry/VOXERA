import { describe, it, expect, vi } from "vitest";
import { getAgentWithTenant, listAgentsForTenant, getAgentForTenant, createAgent, updateAgent } from "../../lib/db/agents";

/**
 * migration_v27.sql adds "speech_provider"/"language" to `agents`. Every
 * read/write in lib/db/agents.ts unconditionally selects those columns —
 * before this fix, deploying the Gnani code ahead of running that migration
 * made EVERY agent lookup fail (not just speech-provider-related ones),
 * since Postgres rejects the whole query when any selected column doesn't
 * exist. Same failure class as lib/db/patients.ts's pre-migration_v28 bug.
 * These tests simulate "migration hasn't run yet" by having the first call
 * to a chain return a 42703 (column does not exist) error, then assert the
 * code retries with the base column set instead of just giving up.
 */

const MISSING_COLUMN_ERROR = { code: "42703", message: 'column "speech_provider" does not exist' };

/** Minimal fake Supabase query-builder chain — mirrors __tests__/db/onboarding.test.ts's
 * convention. Each call to db.from() advances to the next queued chain. */
function makeChain(result: { data: any; error: any }) {
  const chain: any = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    order: vi.fn(() => chain),
    insert: vi.fn(() => chain),
    update: vi.fn(() => chain),
    single: vi.fn(() => Promise.resolve(result)),
    then: (resolve: any) => Promise.resolve(result).then(resolve), // listAgentsForTenant awaits the chain directly, no .single()
  };
  return chain;
}

function makeDb(results: Array<{ data: any; error: any }>) {
  const queue = results.map(makeChain);
  let i = 0;
  return { from: vi.fn(() => queue[i++]) } as any;
}

const AGENT_ROW_WITH_SPEECH = {
  id: "agent-1",
  tenant_id: "tenant-1",
  name: "Front Desk",
  type: "custom",
  status: "active",
  description: null,
  system_prompt: null,
  greeting: null,
  voice_persona: "female-friendly",
  speech_provider: "gnani",
  language: "hi-IN",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

const AGENT_ROW_WITHOUT_SPEECH = {
  id: "agent-1",
  tenant_id: "tenant-1",
  name: "Front Desk",
  type: "custom",
  status: "active",
  description: null,
  system_prompt: null,
  greeting: null,
  voice_persona: "female-friendly",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

describe("lib/db/agents — migration_v27 (speech_provider/language) fallback", () => {
  it("getAgentForTenant falls back to base columns and defaults speech_provider/language to null", async () => {
    const db = makeDb([
      { data: null, error: MISSING_COLUMN_ERROR }, // full-column select fails
      { data: AGENT_ROW_WITHOUT_SPEECH, error: null }, // base-column retry succeeds
    ]);

    const agent = await getAgentForTenant(db, "agent-1", "tenant-1");

    expect(agent).not.toBeNull();
    expect(agent!.id).toBe("agent-1");
    expect(agent!.speech_provider).toBeNull();
    expect(agent!.language).toBeNull();
  });

  it("listAgentsForTenant falls back to base columns instead of returning an empty list", async () => {
    const db = makeDb([
      { data: null, error: MISSING_COLUMN_ERROR },
      { data: [AGENT_ROW_WITHOUT_SPEECH], error: null },
    ]);

    const agents = await listAgentsForTenant(db, "tenant-1");

    expect(agents).toHaveLength(1);
    expect(agents[0].id).toBe("agent-1");
  });

  it("getAgentWithTenant falls back to base columns (the orchestrator's main lookup path)", async () => {
    const db = makeDb([
      { data: null, error: MISSING_COLUMN_ERROR },
      { data: { ...AGENT_ROW_WITHOUT_SPEECH, tenants: { auth_user_id: "auth-1" } }, error: null },
    ]);

    const agent = await getAgentWithTenant(db, "agent-1");

    expect(agent).not.toBeNull();
    expect(agent!.tenant_auth_user_id).toBe("auth-1");
    expect(agent!.speech_provider).toBeNull();
  });

  it("getAgentWithTenant still returns null (not a throw) on a genuinely missing agent", async () => {
    const db = makeDb([{ data: null, error: { code: "PGRST116", message: "no rows" } }]);
    const agent = await getAgentWithTenant(db, "ghost-agent");
    expect(agent).toBeNull();
  });

  it("createAgent retries without speech_provider/language instead of failing the whole creation", async () => {
    const db = makeDb([
      { data: null, error: MISSING_COLUMN_ERROR }, // insert+select with speech fields fails
      { data: AGENT_ROW_WITHOUT_SPEECH, error: null }, // base-column retry succeeds
    ]);

    const agent = await createAgent(db, "tenant-1", { name: "Front Desk" });

    expect(agent).not.toBeNull();
    expect(agent!.id).toBe("agent-1");
    expect(agent!.speech_provider).toBeNull();
  });

  it("updateAgent retries the trailing select without speech_provider/language when the edit itself didn't touch them", async () => {
    const db = makeDb([
      { data: null, error: MISSING_COLUMN_ERROR }, // update+select with speech columns fails
      { data: AGENT_ROW_WITHOUT_SPEECH, error: null }, // base-column retry succeeds
    ]);

    const agent = await updateAgent(db, "agent-1", "tenant-1", { greeting: "Hi there!" });

    expect(agent).not.toBeNull();
    expect(agent!.id).toBe("agent-1");
  });

  it("updateAgent fails loudly (not silently) when the edit explicitly targets speech_provider/language pre-migration", async () => {
    const db = makeDb([{ data: null, error: MISSING_COLUMN_ERROR }]);

    const agent = await updateAgent(db, "agent-1", "tenant-1", { speech_provider: "gnani" });

    expect(agent).toBeNull();
  });

  it("a healthy, already-migrated database is untouched — single round trip, full row back", async () => {
    const db = makeDb([{ data: AGENT_ROW_WITH_SPEECH, error: null }]);

    const agent = await getAgentForTenant(db, "agent-1", "tenant-1");

    expect(agent).not.toBeNull();
    expect(agent!.speech_provider).toBe("gnani");
    expect(agent!.language).toBe("hi-IN");
    expect(db.from).toHaveBeenCalledTimes(1);
  });
});
