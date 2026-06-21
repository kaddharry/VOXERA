import { nanoid } from "nanoid";
import { 
  createCalendarEvent, 
  updateCalendarEvent, 
  deleteCalendarEvent, 
  checkGoogleCalendarConflict 
} from "../integrations/calendar";
import { sendBookingConfirmation } from "../integrations/email";
import { supabase } from "./supabase";

export interface Booking {
  id: string;
  userId: string;
  clientId: string;
  status: "confirmed" | "cancelled";
  date: string;
  time: string;
  partySize: number;
  customerName?: string;
  customerEmail?: string;
  customerPhone?: string;
  calendarEventId?: string;
}

export interface CreateBookingArgs {
  userId: string;
  clientId: string;
  date: string;
  time: string;
  partySize: number;
  customerName?: string;
  customerEmail: string; // Required for notification emails
  customerPhone?: string;
}

/**
 * Checks if a date and time slot is available for booking,
 * verifying both Google Calendar conflicts and local reservations count.
 */
export async function checkAvailability(date: string, time: string, clientId: string): Promise<boolean> {
  // 1. Check Google Calendar conflicts if configured
  const hasGcalConflict = await checkGoogleCalendarConflict(date, time);
  if (hasGcalConflict) {
    console.log(`[Conflict Checker] Conflict detected in Google Calendar for ${date} @ ${time}`);
    return false;
  }

  // 2. Check local database count for this tenant
  const { data, error } = await supabase
    .from("reservations")
    .select("id")
    .eq("clientId", clientId)
    .eq("date", date)
    .eq("time", time)
    .eq("status", "confirmed");

  if (error) {
    console.error("[Supabase] checkAvailability error:", error);
    throw new Error("Failed to check database availability.");
  }

  // Max 2 bookings per time slot
  return (data?.length || 0) < 2;
}

/**
 * Creates a new booking using Postgres RPC function for atomic check-and-insert
 * to prevent concurrent double bookings.
 */
export async function createBooking(args: CreateBookingArgs): Promise<Booking> {
  const bookingId = `BKG-${nanoid(6).toUpperCase()}`;

  // Call the Postgres RPC function to do atomic check + insert
  const { data, error } = await supabase.rpc("create_reservation_atomic", {
    p_booking_id: bookingId,
    p_user_id: args.userId,
    p_client_id: args.clientId,
    p_date: args.date,
    p_time: args.time,
    p_party_size: args.partySize,
    p_cust_name: args.customerName || null,
    p_cust_email: args.customerEmail,
    p_cust_phone: args.customerPhone || null,
  });

  if (error) {
    console.error("[Supabase] createBooking atomic error:", error);
    throw new Error(error.message || "Reservation slot is fully booked.");
  }

  const newBooking: Booking = {
    id: data.id,
    userId: data.userId,
    clientId: data.clientId,
    status: "confirmed",
    date: data.date,
    time: data.time,
    partySize: data.partySize,
    customerName: data.customerName,
    customerEmail: data.customerEmail,
    customerPhone: data.customerPhone,
  };

  // Sync to Google Calendar
  const calendarEventId = await createCalendarEvent(newBooking);
  if (calendarEventId) {
    newBooking.calendarEventId = calendarEventId;
    await supabase
      .from("reservations")
      .update({ calendarEventId })
      .eq("id", newBooking.id);
  }

  // Send confirmation email
  await sendBookingConfirmation(newBooking.customerEmail!, newBooking);

  return newBooking;
}

/**
 * Modifies an existing booking date, time, partySize, and customer details.
 */
export async function modifyBooking(
  bookingId: string,
  patch: { 
    date?: string; 
    time?: string; 
    partySize?: number; 
    customerName?: string; 
    customerEmail?: string; 
    customerPhone?: string 
  },
  clientId: string
): Promise<Booking> {
  // 1. Fetch current reservation to ensure ownership and read variables
  const { data: current, error: getError } = await supabase
    .from("reservations")
    .select("*")
    .eq("id", bookingId)
    .eq("clientId", clientId)
    .single();

  if (getError || !current) {
    throw new Error(`Booking ${bookingId} not found or permission denied.`);
  }

  const updatedDate = patch.date ?? current.date;
  const updatedTime = patch.time ?? current.time;

  // 2. Check slot availability if the schedule is changed
  if (updatedDate !== current.date || updatedTime !== current.time) {
    const isAvail = await checkAvailability(updatedDate, updatedTime, clientId);
    if (!isAvail) {
      throw new Error(`Slot ${updatedDate} at ${updatedTime} is fully booked.`);
    }
  }

  const updateData: Record<string, any> = {
    date: updatedDate,
    time: updatedTime,
  };
  if (patch.partySize !== undefined) updateData.partySize = patch.partySize;
  if (patch.customerName !== undefined) updateData.customerName = patch.customerName;
  if (patch.customerEmail !== undefined) updateData.customerEmail = patch.customerEmail;
  if (patch.customerPhone !== undefined) updateData.customerPhone = patch.customerPhone;

  // 3. Update database
  const { error: updateError } = await supabase
    .from("reservations")
    .update(updateData)
    .eq("id", bookingId);

  if (updateError) {
    console.error("[Supabase] modifyBooking error:", updateError);
    throw new Error("Failed to update reservation in database.");
  }

  const updatedBooking: Booking = {
    ...current,
    ...updateData,
    status: current.status,
  };

  // 4. Update Google Calendar
  if (updatedBooking.calendarEventId) {
    await updateCalendarEvent(updatedBooking);
  }

  // 5. Send updated confirmation email
  const emailToSend = updatedBooking.customerEmail || current.customerEmail;
  if (emailToSend) {
    await sendBookingConfirmation(emailToSend, updatedBooking, true);
  }

  return updatedBooking;
}

/**
 * Cancels an existing booking, sets status to 'cancelled', removes Google Calendar event,
 * and sends a cancellation email.
 */
export async function cancelBooking(bookingId: string, clientId: string): Promise<boolean> {
  // 1. Fetch booking metadata
  const { data: current, error: getError } = await supabase
    .from("reservations")
    .select("*")
    .eq("id", bookingId)
    .eq("clientId", clientId)
    .single();

  if (getError || !current) {
    throw new Error(`Booking ${bookingId} not found or permission denied.`);
  }

  if (current.status === "cancelled") return true;

  // 2. Perform DB cancellation
  const { error: updateError } = await supabase
    .from("reservations")
    .update({ status: "cancelled" })
    .eq("id", bookingId);

  if (updateError) {
    console.error("[Supabase] cancelBooking update error:", updateError);
    throw new Error("Failed to update reservation in database.");
  }

  const cancelledBooking: Booking = {
    ...current,
    status: "cancelled",
  };

  // 3. Delete Google Calendar Event
  if (cancelledBooking.calendarEventId) {
    await deleteCalendarEvent(cancelledBooking.calendarEventId);
  }

  // 4. Dispatch cancellation email
  if (cancelledBooking.customerEmail) {
    await sendBookingConfirmation(cancelledBooking.customerEmail, cancelledBooking);
  }

  return true;
}
