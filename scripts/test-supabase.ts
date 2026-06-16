import { config } from "dotenv";
config({ path: ".env.local" });

import { createBooking, cancelBooking, checkAvailability } from "../lib/db/reservations";

async function run() {
  console.log("=== Testing Supabase Connection ===");
  try {
    const isAvail = await checkAvailability("2026-12-25", "19:00");
    console.log(`Slot available? ${isAvail}`);

    console.log("\nAttempting to create a booking...");
    const booking = await createBooking({
      userId: "test-user-123",
      clientId: "test-client-id",
      date: "2026-12-25",
      time: "19:00",
      partySize: 4
    });
    console.log("Booking created:", booking);

    console.log("\nAttempting to cancel the booking...");
    const cancelled = await cancelBooking(booking.id);
    console.log("Booking cancelled?", cancelled);

    console.log("\n✅ Supabase Database logic works perfectly!");
  } catch (err) {
    console.error("❌ Test Failed:", err);
  }
}

run();
