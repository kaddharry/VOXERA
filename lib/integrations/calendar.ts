import crypto from "crypto";
import type { Booking } from "../db/reservations";
import { decrypt } from "../util/crypto";
import { supabase } from "../db/supabase";

interface GoogleConfig {
  email: string | null;
  privateKey: string | null;
  calendarId: string | null;
}

async function resolveGoogleConfig(clientId?: string): Promise<GoogleConfig> {
  const fallback = {
    email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || null,
    privateKey: process.env.GOOGLE_PRIVATE_KEY || null,
    calendarId: process.env.GOOGLE_CALENDAR_ID || null,
  };

  if (!clientId || clientId === "demo") {
    return fallback;
  }

  try {
    const { data: tenant } = await supabase
      .from("tenants")
      .select("id")
      .eq("auth_user_id", clientId)
      .single();

    if (!tenant) return fallback;

    const { data: creds } = await supabase
      .from("tenant_credentials")
      .select("*")
      .eq("tenant_id", tenant.id)
      .single();

    if (creds && creds.google_service_account_email && creds.google_private_key && creds.google_calendar_id) {
      const privateKey = decrypt(creds.google_private_key);
      return {
        email: creds.google_service_account_email,
        privateKey,
        calendarId: creds.google_calendar_id,
      };
    }
  } catch (err) {
    console.error("[Calendar] Failed to resolve tenant credentials:", err);
  }

  return fallback;
}

function isGoogleConfigured(config: GoogleConfig): boolean {
  return !!(
    config.email &&
    config.privateKey &&
    config.calendarId
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

async function getGoogleAccessToken(config: GoogleConfig): Promise<string> {
  const email = config.email!;
  const privateKey = config.privateKey!;

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
  const config = await resolveGoogleConfig(booking.clientId);

  if (!isGoogleConfigured(config)) {
    console.log(`[Calendar Integration Stub] Created Mock Event for Booking ${booking.id}`);
    return `MOCK-GCAL-${Math.random().toString(36).substr(2, 9).toUpperCase()}`;
  }

  try {
    const token = await getGoogleAccessToken(config);
    const calendarId = config.calendarId!;
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
    return `FALLBACK-GCAL-${Math.random().toString(36).substr(2, 9).toUpperCase()}`;
  }
}

/**
 * Updates an existing Google Calendar event.
 */
export async function updateCalendarEvent(booking: Booking): Promise<void> {
  if (!booking.calendarEventId) return;
  const config = await resolveGoogleConfig(booking.clientId);

  if (!isGoogleConfigured(config)) {
    console.log(`[Calendar Integration Stub] Updated Mock Event ${booking.calendarEventId} (${booking.date} @ ${booking.time})`);
    return;
  }

  try {
    const token = await getGoogleAccessToken(config);
    const calendarId = config.calendarId!;
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
export async function deleteCalendarEvent(calendarEventId: string, clientId?: string): Promise<void> {
  if (!calendarEventId) return;
  const config = await resolveGoogleConfig(clientId);

  if (!isGoogleConfigured(config)) {
    console.log(`[Calendar Integration Stub] Deleted Mock Event ${calendarEventId}`);
    return;
  }

  try {
    const token = await getGoogleAccessToken(config);
    const calendarId = config.calendarId!;

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
export async function checkGoogleCalendarConflict(date: string, time: string, clientId?: string): Promise<boolean> {
  const config = await resolveGoogleConfig(clientId);

  if (!isGoogleConfigured(config)) {
    return false;
  }

  try {
    const token = await getGoogleAccessToken(config);
    const calendarId = config.calendarId!;
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
    return false;
  }
}
