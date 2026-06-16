import { generateReply } from "../lib/agent/llm";
import { checkAvailability } from "../lib/db/reservations";

async function main() {
  console.log("=== Tool Invocation Smoke Test ===\n");

  const system = `You are a helpful voice receptionist. If the user asks for a booking, you must use the check_availability tool. If available, use create_booking to confirm it.
Today's date is 2026-10-09.`;

  const user = "Hi, can you book a table for 4 people tomorrow at 7:00 PM? My user ID is U-123.";

  console.log(`[Test] System Prompt: ${system}`);
  console.log(`[Test] User Prompt: ${user}\n`);

  const initialAvail = await checkAvailability("2026-10-10", "19:00");
  console.log(`[Test] DB Availability Before LLM Call (2026-10-10 @ 19:00): ${initialAvail}`);

  console.log("\n[Test] Executing LLM Loop (Waiting for LLM & Tool Calls)...\n");

  try {
    const reply = await generateReply({ system, user, clientId: "test-client-id" });
    console.log(`\n[Test] Final Agent Reply: "${reply.text}"`);
    console.log(`[Test] Model Used: ${reply.model}`);
    console.log(`[Test] Used Live API: ${reply.usedLive}`);
  } catch (err: any) {
    console.error(`\n[Test] LLM Error: ${err.message}`);
  }

  const finalAvail = await checkAvailability("2026-10-10", "19:00");
  console.log(`\n[Test] DB Availability After LLM Call (2026-10-10 @ 19:00): ${finalAvail}`);
  console.log("\n✅ Tool smoke test complete.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
