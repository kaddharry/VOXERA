import { nanoid } from "nanoid";
import { syncCalendarEvent } from "../integrations/calendar";
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
}

export async function checkAvailability(date: string, time: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("reservations")
    .select("id")
    .eq("date", date)
    .eq("time", time)
    .eq("status", "confirmed");

  if (error) {
    console.error("[Supabase] checkAvailability error:", error);
    throw new Error("Failed to check database availability.");
  }

  // Allow max 2 bookings per time slot
  return (data?.length || 0) < 2;
}

export async function createBooking(args: Omit<Booking, "id" | "status">): Promise<Booking> {
  const isAvail = await checkAvailability(args.date, args.time);
  if (!isAvail) {
    throw new Error(`Slot ${args.date} at ${args.time} is fully booked.`);
  }

  const newBooking: Booking = {
    ...args,
    id: `BKG-${nanoid(6).toUpperCase()}`,
    status: "confirmed",
  };

  const { error } = await supabase
    .from("reservations")
    .insert([newBooking]);

  if (error) {
    console.error("[Supabase] createBooking error:", error);
    throw new Error("Failed to insert booking into database.");
  }

  // Trigger integrations
  await syncCalendarEvent(newBooking);
  // Passing a default email since we don't have user authentication tied to the phone call yet
  await sendBookingConfirmation("user@example.com", newBooking);

  return newBooking;
}

export async function cancelBooking(bookingId: string): Promise<boolean> {
  const { data, error: selectError } = await supabase
    .from("reservations")
    .select("status")
    .eq("id", bookingId)
    .single();

  if (selectError || !data) {
    throw new Error("Booking not found");
  }

  if (data.status === "cancelled") return true;

  const { error: updateError } = await supabase
    .from("reservations")
    .update({ status: "cancelled" })
    .eq("id", bookingId);

  if (updateError) {
    console.error("[Supabase] cancelBooking error:", updateError);
    throw new Error("Failed to update database.");
  }

  // Mocking the full booking object for the calendar sync
  await syncCalendarEvent({ id: bookingId, status: "cancelled" } as Booking);
  return true;
}
