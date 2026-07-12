/**
 * Tests: Reservation Workflows & Integrations (lib/db/reservations.ts)
 * Sprint 4 — FR-13 Reservations, FR-14 Calendar, FR-15 Emails, double-booking transaction
 *
 * Run: npm run test:run
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { 
  checkAvailability, 
  createBooking, 
  modifyBooking, 
  cancelBooking 
} from "../../lib/db/reservations";
import { supabase } from "../../lib/db/supabase";
import { 
  createCalendarEvent, 
  updateCalendarEvent, 
  deleteCalendarEvent, 
  checkGoogleCalendarConflict 
} from "../../lib/integrations/calendar";
import { sendBookingConfirmation } from "../../lib/integrations/email";

// ─── Mocks ────────────────────────────────────────────────────────────────────

// Mock Calendar Integrations
vi.mock("../../lib/integrations/calendar", () => ({
  createCalendarEvent: vi.fn().mockResolvedValue("gcal-event-123"),
  updateCalendarEvent: vi.fn().mockResolvedValue(undefined),
  deleteCalendarEvent: vi.fn().mockResolvedValue(undefined),
  checkGoogleCalendarConflict: vi.fn().mockResolvedValue(false),
}));

// Mock Email Integrations
vi.mock("../../lib/integrations/email", () => ({
  sendBookingConfirmation: vi.fn().mockResolvedValue(undefined),
}));

// Mock Supabase
const mockChain = {
  select: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  single: vi.fn().mockReturnThis(),
  insert: vi.fn().mockReturnThis(),
  update: vi.fn().mockReturnThis(),
  delete: vi.fn().mockReturnThis(),
  then: vi.fn().mockImplementation((onfulfilled) => {
    return Promise.resolve({ data: [], error: null }).then(onfulfilled);
  }),
};

vi.mock("../../lib/db/supabase", () => {
  return {
    supabase: {
      from: vi.fn(() => mockChain),
      rpc: vi.fn().mockResolvedValue({ data: {}, error: null } as any),
    },
  };
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("Reservation Workflows", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    
    // Default mockChain database resolves
    mockChain.then.mockImplementation((onfulfilled) => {
      return Promise.resolve({ data: [], error: null }).then(onfulfilled);
    });

    vi.mocked(supabase.rpc).mockResolvedValue({
      data: {
        id: "BKG-12345",
        userId: "user-abc",
        clientId: "client-xyz",
        date: "2026-12-25",
        time: "19:00",
        partySize: 4,
        customerName: "Alice Smith",
        customerEmail: "alice@example.com",
        customerPhone: "+15555555555",
      },
      error: null,
    } as any);
  });

  describe("checkAvailability", () => {
    it("returns false if Google Calendar has conflicts", async () => {
      vi.mocked(checkGoogleCalendarConflict).mockResolvedValueOnce(true);
      const isAvail = await checkAvailability("2026-12-25", "19:00", "client-xyz");
      expect(isAvail).toBe(false);
      expect(checkGoogleCalendarConflict).toHaveBeenCalledWith("2026-12-25", "19:00", "client-xyz");
    });

    it("returns false if local reservation slots are full", async () => {
      mockChain.then.mockImplementationOnce((onfulfilled) => {
        // Returns two existing bookings (max limit)
        return Promise.resolve({ data: [{ id: "b1" }, { id: "b2" }], error: null }).then(onfulfilled);
      });

      const isAvail = await checkAvailability("2026-12-25", "19:00", "client-xyz");
      expect(isAvail).toBe(false);
      // Confirms database scoping
      expect(supabase.from).toHaveBeenCalledWith("reservations");
      expect(mockChain.eq).toHaveBeenCalledWith("clientId", "client-xyz");
    });

    it("returns true if slot is free and no conflicts", async () => {
      mockChain.then.mockImplementationOnce((onfulfilled) => {
        return Promise.resolve({ data: [], error: null }).then(onfulfilled);
      });

      const isAvail = await checkAvailability("2026-12-25", "19:00", "client-xyz");
      expect(isAvail).toBe(true);
    });
  });

  describe("createBooking", () => {
    it("calls atomic RPC function and dispatches calendar and email confirmations", async () => {
      const booking = await createBooking({
        userId: "user-abc",
        clientId: "client-xyz",
        date: "2026-12-25",
        time: "19:00",
        partySize: 4,
        customerName: "Alice Smith",
        customerEmail: "alice@example.com",
        customerPhone: "+15555555555",
      });

      expect(supabase.rpc).toHaveBeenCalledWith("create_reservation_atomic", expect.objectContaining({
        p_user_id: "user-abc",
        p_client_id: "client-xyz",
        p_cust_email: "alice@example.com",
      }));

      // Verify integrations
      expect(createCalendarEvent).toHaveBeenCalled();
      expect(sendBookingConfirmation).toHaveBeenCalledWith("alice@example.com", expect.objectContaining({
        id: "BKG-12345",
      }));
    });
  });

  describe("modifyBooking", () => {
    it("asserts slot availability and triggers updates if slot changes", async () => {
      // Setup current booking retrieval
      mockChain.then.mockImplementationOnce((onfulfilled) => {
        return Promise.resolve({
          data: {
            id: "BKG-12345",
            clientId: "client-xyz",
            date: "2026-12-25",
            time: "19:00",
            customerEmail: "alice@example.com",
            calendarEventId: "gcal-event-123",
          },
          error: null,
        }).then(onfulfilled);
      });

      // Mock update to succeed
      mockChain.then.mockImplementationOnce((onfulfilled) => {
        return Promise.resolve({ error: null }).then(onfulfilled);
      });

      const updated = await modifyBooking(
        "BKG-12345",
        {
          date: "2026-12-26", // changed date
          time: "19:30",
          partySize: 2,
        },
        "client-xyz"
      );

      expect(updated.date).toBe("2026-12-26");
      expect(updated.time).toBe("19:30");
      expect(updateCalendarEvent).toHaveBeenCalled();
      expect(sendBookingConfirmation).toHaveBeenCalledWith("alice@example.com", expect.any(Object), true); // true = update trigger
    });
  });

  describe("cancelBooking", () => {
    it("updates reservation status and triggers cancellation flows", async () => {
      // Mock retrieve
      mockChain.then.mockImplementationOnce((onfulfilled) => {
        return Promise.resolve({
          data: {
            id: "BKG-12345",
            clientId: "client-xyz",
            status: "confirmed",
            customerEmail: "alice@example.com",
            calendarEventId: "gcal-event-123",
          },
          error: null,
        }).then(onfulfilled);
      });

      // Mock update
      mockChain.then.mockImplementationOnce((onfulfilled) => {
        return Promise.resolve({ error: null }).then(onfulfilled);
      });

      const success = await cancelBooking("BKG-12345", "client-xyz");
      expect(success).toBe(true);
      expect(deleteCalendarEvent).toHaveBeenCalledWith("gcal-event-123", "client-xyz");
      expect(sendBookingConfirmation).toHaveBeenCalledWith("alice@example.com", expect.objectContaining({
        status: "cancelled",
      }));
    });
  });
});
