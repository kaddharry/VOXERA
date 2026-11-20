import { describe, it, expect, afterEach, vi } from "vitest";
import twilio from "twilio";

/**
 * Twilio signature checks: HTTP webhooks (URL incl. query + POST params) and
 * the Media Stream WebSocket handshake (exact wss:// URL, no params).
 */
const TOKEN = "test_auth_token_123";
const sign = (url: string, params: Record<string, string> = {}) => twilio.getExpectedTwilioSignature(TOKEN, url, params);

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

async function load() {
  vi.stubEnv("TWILIO_AUTH_TOKEN", TOKEN);
  vi.stubEnv("VOXERA_PUBLIC_URL", "https://voxera.example");
  return import("../../lib/telephony/webhook-auth");
}

describe("verifyTwilioStreamHandshake", () => {
  it("accepts Twilio's signature over the wss:// stream URL", async () => {
    const { verifyTwilioStreamHandshake } = await load();
    const req = new Request("https://voxera.example/api/telephony/stream", { headers: { "x-twilio-signature": sign("wss://voxera.example/api/telephony/stream") } });
    expect(verifyTwilioStreamHandshake(req)).toMatchObject({ ok: true, enforced: true });
  });

  it("refuses a missing or wrong signature", async () => {
    const { verifyTwilioStreamHandshake } = await load();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(verifyTwilioStreamHandshake(new Request("https://voxera.example/api/telephony/stream")).ok).toBe(false);
    const forged = new Request("https://voxera.example/api/telephony/stream", { headers: { "x-twilio-signature": sign("https://voxera.example/api/telephony/stream") } });
    expect(verifyTwilioStreamHandshake(forged).ok).toBe(false);
  });

  it("the emergency switch makes a mismatch log-only", async () => {
    vi.stubEnv("TWILIO_VALIDATE_STREAM_SIGNATURE", "false");
    const { verifyTwilioStreamHandshake } = await load();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(verifyTwilioStreamHandshake(new Request("https://voxera.example/api/telephony/stream"))).toMatchObject({ ok: false, enforced: false });
  });
});

describe("GET /api/telephony/stream", () => {
  it("refuses an unsigned handshake before upgrading", async () => {
    await load();
    vi.doMock("@vercel/functions", () => ({ upgradeWebSocket: vi.fn(() => new Response(null, { status: 200 })) }));
    vi.doMock("../../lib/telephony/stream-handler", () => ({ TelephonyStreamHandler: vi.fn() }));
    vi.doMock("../../lib/warmup", () => ({ warmupModels: vi.fn(async () => {}) }));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { GET } = await import("../../app/api/telephony/stream/route");
    const { upgradeWebSocket } = await import("@vercel/functions");
    expect((await GET(new Request("https://voxera.example/api/telephony/stream"))).status).toBe(403);
    expect(upgradeWebSocket).not.toHaveBeenCalled();
    const signed = new Request("https://voxera.example/api/telephony/stream", { headers: { "x-twilio-signature": sign("wss://voxera.example/api/telephony/stream") } });
    GET(signed);
    expect(upgradeWebSocket).toHaveBeenCalledTimes(1);
  });
});
