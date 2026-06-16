import { ensureSeeded, DEMO } from "../lib/bootstrap";
import { chunkText } from "../lib/knowledge/chunk";
import { ingestDocument, queryKnowledgeBase } from "../lib/knowledge/ingest";
import { classifyConfidence } from "../lib/emotion/confidence";
import { vectorStore } from "../lib/memory/store";
import { seedClientMemory } from "../lib/memory/writer";

async function main() {
  await ensureSeeded();
  console.log("=== Knowledge Base Smoke Test ===\n");

  // ---------------------------------------------------------------
  // 1. Test text chunking
  // ---------------------------------------------------------------
  console.log("--- Chunk Test ---");
  const sampleText = [
    "Voxera is a voice-based AI receptionist platform.",
    "It handles incoming calls automatically using speech recognition.",
    "The system supports English and Hinglish languages.",
    "Customers can make reservations through voice commands.",
    "The AI detects emotions in real-time to adapt its responses.",
    "High-priority issues are escalated to human agents immediately.",
    "All conversations are logged for quality assurance purposes.",
    "Business owners can upload their FAQs and pricing information.",
    "The platform operates 24 hours a day, 7 days a week.",
    "Subscription plans are available at different pricing tiers.",
  ].join(" ");

  const chunks = chunkText(sampleText, { chunkSize: 200, overlap: 40 });
  console.log(`Input length: ${sampleText.length} chars`);
  console.log(`Chunks produced: ${chunks.length}`);
  for (let i = 0; i < chunks.length; i++) {
    console.log(`  [${i}] (${chunks[i].length} chars) "${chunks[i].slice(0, 60)}..."`);
  }

  // ---------------------------------------------------------------
  // 2. Test document ingestion
  // ---------------------------------------------------------------
  console.log("\n--- Ingestion Test ---");
  const docContent = Buffer.from(
    [
      "Hotel Paradise Room Information",
      "",
      "Deluxe Room: $150/night, king bed, city view, free WiFi.",
      "Suite: $280/night, living area, balcony, minibar included.",
      "Standard Room: $95/night, queen bed, garden view.",
      "",
      "Check-in: 3 PM. Check-out: 11 AM.",
      "Late checkout available upon request for $30.",
      "",
      "Cancellation Policy:",
      "Free cancellation up to 24 hours before check-in.",
      "50% charge for cancellations within 24 hours.",
      "No-shows are charged the full first night.",
      "",
      "Special Requests:",
      "Extra bed: $25/night. Crib: free upon request.",
      "Airport shuttle: $45 one-way, must book 24 hours in advance.",
    ].join("\n"),
    "utf-8",
  );

  const result = await ingestDocument({
    clientId: DEMO.clientId,
    filename: "hotel_paradise_rooms.txt",
    content: docContent,
    mimeType: "text/plain",
  });

  console.log(`Document ID: ${result.documentId}`);
  console.log(`Chunks ingested: ${result.chunkCount}`);
  console.log(`Chunk IDs: ${result.chunkIds.join(", ")}`);
  console.log(`Store sizes:`, await vectorStore.size());

  // ---------------------------------------------------------------
  // 3. Test knowledge base query
  // ---------------------------------------------------------------
  console.log("\n--- Query Test ---");

  await seedClientMemory({
    clientId: DEMO.clientId,
    topic: "policy",
    text: "Never offer refunds exceeding $50 without manager approval.",
    importance: 0.95,
  });
  await seedClientMemory({
    clientId: DEMO.clientId,
    topic: "technical",
    text: "If the router displays a blinking red light, instruct the user to power cycle it for 30 seconds.",
    importance: 0.8,
  });

  const queries = [
    "How much does a deluxe room cost?",
    "What is the cancellation policy?",
    "Can I get an airport shuttle?",
    "What time is check-in?",
  ];

  for (const q of queries) {
    const results = await queryKnowledgeBase({
      clientId: DEMO.clientId,
      query: q,
      topK: 2,
    });
    console.log(`\nQ: "${q}"`);
    for (const r of results) {
      console.log(`  [sim=${r.similarity}] (${r.topic}) "${r.text.slice(0, 80)}..."`);
    }
  }

  // ---------------------------------------------------------------
  // 4. Test confidence classification (FR-7)
  // ---------------------------------------------------------------
  console.log("\n--- Confidence Classification Test ---");
  const testValues = [0.0, 0.25, 0.49, 0.50, 0.65, 0.79, 0.80, 0.95, 1.0];
  for (const v of testValues) {
    const cat = classifyConfidence(v);
    console.log(`  ${v.toFixed(2)} → ${cat}`);
  }

  console.log("\n✅ All smoke tests passed.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
