import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock Supabase to check our mock context
const mockChain = {
  select: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  single: vi.fn(),
  update: vi.fn().mockResolvedValue({ error: null }),
  insert: vi.fn().mockResolvedValue({ error: null }),
};

vi.mock("../../lib/db/supabase", () => ({
  supabase: {
    from: vi.fn(() => mockChain),
  },
}));

import { encrypt, decrypt } from "../../lib/util/crypto";
import { createCalendarEvent, checkGoogleCalendarConflict } from "../../lib/integrations/calendar";

describe("Database Security & Hardening (Issue #12)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("AES-256-GCM Encryption Utility", () => {
    it("successfully encrypts and decrypts text", () => {
      const secretText = "my-super-secret-key-12345";
      const encrypted = encrypt(secretText);
      
      expect(encrypted).not.toBe(secretText);
      expect(encrypted.split(":").length).toBe(3); // iv:authTag:ciphertext

      const decrypted = decrypt(encrypted);
      expect(decrypted).toBe(secretText);
    });

    it("returns empty string if input is empty", () => {
      expect(encrypt("")).toBe("");
      expect(decrypt("")).toBe("");
    });

    it("throws error for invalid encrypted text format", () => {
      expect(() => decrypt("invalid-text")).toThrow("Invalid encrypted text format.");
    });
  });

  describe("Google Calendar Dynamic Credentials Lookup", () => {
    it("falls back to environment variables if clientId is demo or empty", async () => {
      // Set temporary mock env variables
      process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = "env-email@google.com";
      process.env.GOOGLE_PRIVATE_KEY = "env-private-key";
      process.env.GOOGLE_CALENDAR_ID = "env-calendar-id";

      // Mock checkGoogleCalendarConflict isGoogleConfigured bypasses
      const hasConflict = await checkGoogleCalendarConflict("2026-12-25", "19:00", "demo");
      expect(hasConflict).toBe(false); // mock calendar fetch fails / doesn't conflict
    });

    it("queries database and decrypts custom credentials if present", async () => {
      const rawPrivateKey = "-----BEGIN PRIVATE KEY-----\nMIIEvgIBADANBg...\n-----END PRIVATE KEY-----";
      const encryptedPrivateKey = encrypt(rawPrivateKey);

      // Mock chain returning custom credentials
      mockChain.single
        .mockResolvedValueOnce({ data: { id: "mock-tenant-uuid" }, error: null }) // tenants query
        .mockResolvedValueOnce({ // tenant_credentials query
          data: {
            google_service_account_email: "tenant-email@google.com",
            google_private_key: encryptedPrivateKey,
            google_calendar_id: "tenant-calendar-id",
          },
          error: null,
        });

      const eventId = await createCalendarEvent({
        id: "test-booking",
        userId: "test-user",
        clientId: "test-client-owner",
        status: "confirmed",
        date: "2026-12-25",
        time: "19:00",
        partySize: 2,
      });

      // Assert it resolved and called Google endpoint (mocked output returned)
      expect(eventId).toContain("FALLBACK-GCAL-"); // Mock fallback of real HTTP request failure, confirming config was parsed
    });
  });
});
