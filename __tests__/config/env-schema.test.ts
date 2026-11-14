import { describe, it, expect, afterEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { ENV_SPEC, missingRequiredEnv, supabaseCredentials, MissingEnvError } from "../../lib/env";

const ROOT = path.resolve(__dirname, "../..");
const SCAN = ["lib", "app", "components", "custom-server.ts", "proxy.ts", "next.config.ts"];

function files(p: string): string[] {
  const full = path.join(ROOT, p);
  if (!fs.existsSync(full)) return [];
  if (fs.statSync(full).isFile()) return [full];
  return fs.readdirSync(full, { withFileTypes: true }).flatMap((d) =>
    d.isDirectory() ? files(path.join(p, d.name)) : /\.(ts|tsx|js|mjs)$/.test(d.name) ? [path.join(full, d.name)] : [],
  );
}
const source = SCAN.flatMap(files).map((f) => ({ f, text: fs.readFileSync(f, "utf8") }));
const names = new Set(ENV_SPEC.map((v) => v.name));

describe("environment variable schema (lib/env.ts)", () => {
  it("declares every process.env variable the app reads, with its exact name", () => {
    const used = new Set<string>();
    for (const { text } of source) {
      for (const m of text.matchAll(/process\.env\.([A-Z0-9_]+)/g)) used.add(m[1]);
      for (const m of text.matchAll(/envKey:\s*"([A-Z0-9_]+)"/g)) used.add(m[1]);
    }
    expect([...used].filter((n) => !names.has(n))).toEqual([]);
  });

  it(".env.example lists exactly the variables a person sets (no extra, none missing)", () => {
    const example = fs.readFileSync(path.join(ROOT, ".env.example"), "utf8");
    const listed = new Set([...example.matchAll(/^#?\s*([A-Z][A-Z0-9_]+)=/gm)].map((m) => m[1]));
    const settable = ENV_SPEC.filter((v) => v.level !== "platform").map((v) => v.name);
    expect([...listed].filter((n) => !names.has(n))).toEqual([]);
    expect(settable.filter((n) => !listed.has(n))).toEqual([]);
  });

  it("the deployment runbook lists every variable a person sets", () => {
    const runbook = fs.readFileSync(path.join(ROOT, "docs/VOXERA_DEPLOYMENT_RUNBOOK.md"), "utf8");
    const missing = ENV_SPEC.filter((v) => v.level !== "platform" && !runbook.includes(`\`${v.name}\``)).map((v) => v.name);
    expect(missing).toEqual([]);
  });

  it("every variable name is upper case", () => {
    expect(ENV_SPEC.filter((v) => v.name !== v.name.toUpperCase())).toEqual([]);
  });

  it("no Redis, Upstash, LIVE_EVENTS_TRANSPORT or direct OpenAI configuration remains", () => {
    for (const gone of ["REDIS_URL", "LIVE_EVENTS_TRANSPORT", "OPENAI_API_KEY", "UPSTASH"]) expect(names.has(gone)).toBe(false);
    const offenders = source.filter(({ text }) => /from ["']ioredis["']|lib\/redis\/client|process\.env\.(REDIS_URL|OPENAI_API_KEY|LIVE_EVENTS_TRANSPORT)|api\.openai\.com/.test(text));
    expect(offenders.map((o) => path.relative(ROOT, o.f))).toEqual([]);
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
    expect({ ...pkg.dependencies, ...pkg.devDependencies }).not.toHaveProperty("ioredis");
    expect({ ...pkg.dependencies, ...pkg.devDependencies }).not.toHaveProperty("@upstash/redis");
  });
});

describe("required configuration checks", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("names the missing required variables (names only)", () => {
    for (const v of ENV_SPEC) vi.stubEnv(v.name, "");
    vi.stubEnv("SUPABASE_URL", "https://x.supabase.co");
    const missing = missingRequiredEnv();
    expect(missing).toContain("DEEPGRAM_API_KEY");
    expect(missing).toContain("GROQ_API_KEYS or ZENMUX_API_KEY");
    expect(missing).not.toContain("SUPABASE_URL");
  });

  it("never substitutes placeholder Supabase credentials in Production", () => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("SUPABASE_URL", "https://x.supabase.co");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    vi.stubEnv("SUPABASE_ANON_KEY", "anon");
    expect(() => supabaseCredentials("service")).toThrow(MissingEnvError);
    expect(() => supabaseCredentials("service")).toThrow(/SUPABASE_SERVICE_ROLE_KEY/);
    expect(supabaseCredentials("anon")).toEqual({ url: "https://x.supabase.co", key: "anon" });
  });

  it("uses a placeholder (with a warning) outside Production so local builds work", () => {
    vi.stubEnv("VERCEL_ENV", "");
    vi.stubEnv("SUPABASE_URL", "");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(supabaseCredentials("service").url).toContain("placeholder");
  });
});
