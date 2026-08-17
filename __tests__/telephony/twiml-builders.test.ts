/**
 * Tests: TwiML Builders (lib/telephony/twilio.ts)
 * Sprint 1 — FR-1 Incoming Call Handling
 *
 * Tests the TwiML XML output without hitting the Twilio API.
 * Run: npm run test:run
 */

import { describe, it, expect } from "vitest";
import {
  buildConnectTwiml,
  buildWaitTwiml,
  buildRejectTwiml,
} from "../../lib/telephony/twilio";

describe("buildConnectTwiml", () => {
  it("returns valid XML string", () => {
    const xml = buildConnectTwiml("wss://example.com/stream", { callSid: "CA123" });
    expect(xml).toContain("<?xml");
    expect(xml).toContain("<Response>");
    expect(xml).toContain("</Response>");
  });

  it("contains a <Connect> and <Stream> element", () => {
    const xml = buildConnectTwiml("wss://example.com/stream", { callSid: "CA123" });
    expect(xml).toContain("<Connect>");
    expect(xml).toContain("<Stream");
  });

  it("embeds the correct WebSocket URL in the stream", () => {
    const wsUrl = "wss://my-ngrok.ngrok-free.app/api/telephony/stream";
    const xml = buildConnectTwiml(wsUrl, { callSid: "CA456" });
    expect(xml).toContain(wsUrl);
  });

  it("embeds the callSid as a parameter", () => {
    const xml = buildConnectTwiml("wss://example.com/stream", { callSid: "CA789" });
    expect(xml).toContain("callSid");
    expect(xml).toContain("CA789");
  });

  it("includes a <Say> greeting before connect", () => {
    const xml = buildConnectTwiml("wss://example.com/stream", { callSid: "CA000" });
    expect(xml).toContain("<Say");
    expect(xml.toLowerCase()).toContain("please hold");
  });
});

describe("buildWaitTwiml", () => {
  it("returns valid XML string", () => {
    const xml = buildWaitTwiml(120);
    expect(xml).toContain("<?xml");
    expect(xml).toContain("<Response>");
  });

  it("says the correct minute count (2 mins for 120 seconds)", () => {
    const xml = buildWaitTwiml(120);
    expect(xml).toContain("2 minutes");
  });

  it("says '1 minute' (singular) for 60 seconds", () => {
    const xml = buildWaitTwiml(60);
    expect(xml).toContain("1 minute");
    expect(xml).not.toContain("1 minutes");
  });

  it("rounds up fractional minutes (90s → 2 min)", () => {
    const xml = buildWaitTwiml(90);
    expect(xml).toContain("2 minutes");
  });

  it("includes a <Redirect> back to /api/telephony/incoming", () => {
    const xml = buildWaitTwiml(180);
    expect(xml).toContain("<Redirect");
    expect(xml).toContain("/api/telephony/incoming");
  });

  it("includes a <Pause> element", () => {
    const xml = buildWaitTwiml(60);
    expect(xml).toContain("<Pause");
  });
});

describe("buildRejectTwiml", () => {
  it("returns valid XML string", () => {
    const xml = buildRejectTwiml();
    expect(xml).toContain("<?xml");
    expect(xml).toContain("<Response>");
  });

  it("includes a <Hangup> element", () => {
    const xml = buildRejectTwiml();
    expect(xml).toContain("<Hangup");
  });

  it("says an apology before hanging up", () => {
    const xml = buildRejectTwiml();
    expect(xml).toContain("<Say");
    expect(xml.toLowerCase()).toContain("sorry");
  });

  it("does NOT include a <Connect> or <Stream> — call is rejected", () => {
    const xml = buildRejectTwiml();
    expect(xml).not.toContain("<Connect");
    expect(xml).not.toContain("<Stream");
  });
});
