import crypto from "crypto";
import type { Booking } from "../db/reservations";

function isGoogleConfigured(): boolean {
  return !!(
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL &&
    process.env.GOOGLE_PRIVATE_KEY &&
    process.env.GOOGLE_CALENDAR_ID
  );
}

function signJwt(payload: object, privateKeyPem: string): string {
  const header = { alg: "RS256", typ: "JWT" };
  
  const base64UrlEncode = (str: string) => 
    Buffer.from(str)
      .toString("base64")
      .replace(/=/g, "")
      .replace(/\+/g, "-")
      .replace(/\//g, "_");

  const headerB64 = base64UrlEncode(JSON.stringify(header));
  const payloadB64 = base64UrlEncode(JSON.stringify(payload));
  const input = `${headerB64}.${payloadB64}`;

  const sign = crypto.createSign("RSA-SHA256");
  sign.update(input);
  const formattedKey = privateKeyPem.replace(/\\n/g, "\n");
  const signature = sign.sign(formattedKey, "base64");
  const signatureB64 = signature
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");

  return `${input}.${signatureB64}`;
}

async function getGoogleAccessToken(): Promise<string> {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL!;
  const privateKey = process.env.GOOGLE_PRIVATE_KEY!;

  const now = Math.floor(Date.now() / 1000);
  const claim = {
    iss: email,
    scope: "https://www.googleapis.com/auth/calendar",
    aud: "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now,
  };

  const jwt = signJwt(claim, privateKey);

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Google OAuth error: ${errText}`);
  }

  const data = await res.json();
  return data.access_token;
}

// Calculate booking end time (+1 hour by default)
function getStartAndEndTimes(date: string, time: string): { startIso: string; endIso: string } {
  // Assume date format is YYYY-MM-DD and time format is HH:MM
  const start = new Date(`${date}T${time}:00`);
  const end = new Date(start.getTime() + 60 * 60 * 1000); // Add 1 hour
  return {
    startIso: start.toISOString(),
    endIso: end.toISOString()
  };
}

/**
 * Creates an event in Google Calendar and returns the event ID.
 */
export async function createCalendarEvent(booking: Booking): Promise<string> {
  if (!isGoogleConfigured()) {
    console.log(`[Calendar Integration Stub] Created Mock Event for Booking ${booking.id}`);
    return `MOCK-GCAL-${Math.random().toString(36).substr(2, 9).toUpperCase()}`;
  }

  try {
    const token = await getGoogleAccessToken();
    const calendarId = process.env.GOOGLE_CALENDAR_ID!;
    const { startIso, endIso } = getStartAndEndTimes(booking.date, booking.time);

    const eventDetails = {
      summary: `VOXERA Appointment - ${booking.customerName || "Customer"}`,
      description: `Reservation ID: ${booking.id}\nParty Size: ${booking.partySize}\nPhone: ${booking.customerPhone || "N/A"}\nEmail: ${booking.customerEmail || "N/A"}`,
      start: {
        dateTime: startIso,
      },
      end: {
        dateTime: endIso,
      },
    };

    const res = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(eventDetails),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Google Calendar API Error: ${errText}`);
    }

    const event = await res.json();
    console.log(`[Calendar Integration] Created Google Calendar event. ID: ${event.id}`);
    return event.id;
  } catch (err) {
    console.error("[Calendar Integration] Failed to create Google Calendar event:", err);
    // Return a fallback ID so booking doesn't crash
    return `FALLBACK-GCAL-${Math.random().toString(36).substr(2, 9).toUpperCase()}`;
  }
}

/**
 * Updates an existing Google Calendar event.
 */
export async function updateCalendarEvent(booking: Booking): Promise<void> {
  if (!booking.calendarEventId) return;
  if (!isGoogleConfigured()) {
    console.log(`[Calendar Integration Stub] Updated Mock Event ${booking.calendarEventId} (${booking.date} @ ${booking.time})`);
    return;
  }

  try {
    const token = await getGoogleAccessToken();
    const calendarId = process.env.GOOGLE_CALENDAR_ID!;
    const { startIso, endIso } = getStartAndEndTimes(booking.date, booking.time);

    const eventDetails = {
      summary: `VOXERA Appointment - ${booking.customerName || "Customer"}`,
      description: `Reservation ID: ${booking.id}\nParty Size: ${booking.partySize}\nPhone: ${booking.customerPhone || "N/A"}\nEmail: ${booking.customerEmail || "N/A"}`,
      start: {
        dateTime: startIso,
      },
      end: {
        dateTime: endIso,
      },
    };

    const res = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(booking.calendarEventId)}`,
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(eventDetails),
      }
    );

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Google Calendar API Error: ${errText}`);
    }

    console.log(`[Calendar Integration] Updated Google Calendar event. ID: ${booking.calendarEventId}`);
  } catch (err) {
    console.error("[Calendar Integration] Failed to update Google Calendar event:", err);
  }
}

/**
 * Deletes a Google Calendar event.
 */
export async function deleteCalendarEvent(calendarEventId: string): Promise<void> {
  if (!calendarEventId) return;
  if (!isGoogleConfigured()) {
    console.log(`[Calendar Integration Stub] Deleted Mock Event ${calendarEventId}`);
    return;
  }

  try {
    const token = await getGoogleAccessToken();
    const calendarId = process.env.GOOGLE_CALENDAR_ID!;

    const res = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(calendarEventId)}`,
      {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }
    );

    if (!res.ok && res.status !== 404) {
      const errText = await res.text();
      throw new Error(`Google Calendar API Error: ${errText}`);
    }

    console.log(`[Calendar Integration] Deleted Google Calendar event. ID: ${calendarEventId}`);
  } catch (err) {
    console.error("[Calendar Integration] Failed to delete Google Calendar event:", err);
  }
}

/**
 * Queries Google Calendar FreeBusy endpoint to check for conflicts.
 * Returns true if the slot is busy.
 */
export async function checkGoogleCalendarConflict(date: string, time: string): Promise<boolean> {
  if (!isGoogleConfigured()) {
    return false; // No mock conflicts
  }

  try {
    const token = await getGoogleAccessToken();
    const calendarId = process.env.GOOGLE_CALENDAR_ID!;
    const { startIso, endIso } = getStartAndEndTimes(date, time);

    const body = {
      timeMin: startIso,
      timeMax: endIso,
      items: [{ id: calendarId }],
    };

    const res = await fetch("https://www.googleapis.com/calendar/v3/freeBusy", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Google Calendar FreeBusy Error: ${errText}`);
    }

    const data = await res.json();
    const busyTimes = data.calendars?.[calendarId]?.busy ?? [];
    
    return busyTimes.length > 0;
  } catch (err) {
    console.error("[Calendar Integration] Failed to check Google Calendar conflicts:", err);
    return false; // Fail open to not block reservations
  }
}
