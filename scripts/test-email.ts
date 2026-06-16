import { config } from "dotenv";
config({ path: ".env.local" });

import { sendBookingConfirmation } from "../lib/integrations/email";

async function run() {
  console.log("=== Testing Resend Email Dispatch ===");
  try {
    await sendBookingConfirmation("onboarding@resend.dev", {
      id: "BKG-TEST",
      userId: "123",
      clientId: "test-client",
      date: "2026-12-25",
      time: "19:00",
      partySize: 2,
      status: "confirmed"
    });
    console.log("✅ Email trigger executed!");
  } catch (err) {
    console.error("❌ Test Failed:", err);
  }
}

run();
