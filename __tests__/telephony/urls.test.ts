import { afterEach, describe, expect, it, vi } from "vitest";
import { publicWebhookUrl, resolvePublicBaseUrl, resolveVoiceWebSocketUrl } from "../../lib/telephony/urls";

describe("telephony public URL resolution", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("prefers the configured production origin over request host", () => {
    expect(resolvePublicBaseUrl({ configured: "https://voxera.example", requestUrl: "https://preview.vercel.app/api/telephony/incoming" }))
      .toBe("https://voxera.example");
  });

  it("derives the request origin when no public URL is configured", () => {
    expect(resolvePublicBaseUrl({ requestUrl: "https://preview.vercel.app/api/telephony/incoming?x=1" }))
      .toBe("https://preview.vercel.app");
  });

  it("rejects malformed and credential-bearing public URLs", () => {
    expect(() => resolvePublicBaseUrl({ configured: "not a url" })).toThrow();
    expect(() => resolvePublicBaseUrl({ configured: "https://user:secret@voxera.example" })).toThrow();
  });

  it("prefers a dedicated voice host and otherwise derives a wss URL", () => {
    expect(resolveVoiceWebSocketUrl("https://voxera.example")).toBe("wss://voxera.example/api/telephony/stream");
    vi.stubEnv("VOICE_STREAM_URL", "wss://voice.voxera.example/media");
    expect(resolveVoiceWebSocketUrl("https://voxera.example")).toBe("wss://voice.voxera.example/media");
  });

  it("builds absolute webhook URLs", () => {
    expect(publicWebhookUrl("https://voxera.example", "/api/telephony/stream-status"))
      .toBe("https://voxera.example/api/telephony/stream-status");
  });
});
