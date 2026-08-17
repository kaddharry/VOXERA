import path from "node:path";
import { config } from "dotenv";

// Must be imported before any lib/* module. Several read process.env at module
// load — lib/redis/client.ts:117 picks MockRedis vs real Redis, and
// lib/db/supabase.ts:139 builds the client — so loading .env.local after those
// imports would silently leave the custom server on placeholder credentials.
// Next loads env itself, but only during app.prepare(), which is too late.
//
// In a container the environment is already populated and this is a no-op:
// dotenv never overwrites an existing process.env value.
config({ path: path.resolve(__dirname, "..", ".env.local") });
