/** Public URL helpers shared by Twilio webhooks and the Media Stream setup. */
export function resolvePublicBaseUrl(input: {
  configured?: string | null;
  requestUrl?: string;
}): string {
  const configured = input.configured?.trim();
  const value = configured || (input.requestUrl ? new URL(input.requestUrl).origin : undefined);
  if (!value) throw new Error("Set VOXERA_PUBLIC_URL to the public application URL.");

  const url = new URL(value);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("VOXERA_PUBLIC_URL must use https:// (http:// is allowed only for local development).");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error("VOXERA_PUBLIC_URL must be an origin or base path without credentials, query, or fragment.");
  }
  return url.toString().replace(/\/$/, "");
}

export function resolveVoiceWebSocketUrl(publicBaseUrl: string): string {
  const dedicated = process.env.VOICE_STREAM_URL?.trim();
  const url = dedicated
    ? new URL(dedicated)
    : new URL("/api/telephony/stream", publicBaseUrl);
  if (!dedicated && url.protocol === "https:") url.protocol = "wss:";
  if (!dedicated && url.protocol === "http:" && url.hostname === "localhost") url.protocol = "ws:";
  if (url.protocol !== "wss:" && !(url.protocol === "ws:" && url.hostname === "localhost")) {
    throw new Error("VOICE_STREAM_URL must use wss:// (ws:// is allowed only for localhost).");
  }
  return url.toString();
}

export function publicWebhookUrl(publicBaseUrl: string, path: string): string {
  return new URL(path.replace(/^\//, ""), `${publicBaseUrl}/`).toString();
}
