commit ce4b3091730d171a8f3eca3689f6779f825b93fc
Author: Vikasverma9515 <142911666+Vikasverma9515@users.noreply.github.com>
Date:   Wed Nov 11 17:22:09 2026 +0530

    untracked files on codex/telephony-production-readiness: 7a3ef20 Switch vercel.json cron config to the Schedules format

diff --git a/__tests__/agent/language-guard.test.ts b/__tests__/agent/language-guard.test.ts
new file mode 100644
index 0000000..11aa600
--- /dev/null
+++ b/__tests__/agent/language-guard.test.ts
@@ -0,0 +1,32 @@
+import { describe, expect, it } from "vitest";
+import { guardReplyLanguage } from "../../lib/agent/language-guard";
+
+describe("guardReplyLanguage", () => {
+  it("removes a stray Gujarati fragment from a Marathi reply while preserving Marathi and Latin names", () => {
+    const result = guardReplyLanguage("नक्की मदत करतो. બીજું काय हवे? Acme Dental", "mr-IN", "कृपया मला मदत करा");
+    expect(result.changed).toBe(true);
+    expect(result.text).toContain("नक्की मदत करतो");
+    expect(result.text).toContain("काय हवे");
+    expect(result.text).toContain("Acme Dental");
+    expect(result.text).not.toMatch(/[\u0a80-\u0aff]/);
+  });
+
+  it("uses the current utterance's script in auto mode", () => {
+    const result = guardReplyLanguage("জি, বলুন. नमस्ते", "auto", "দয়া করে আমাকে সাহায্য করুন");
+    expect(result.text).toBe("জি, বলুন.");
+  });
+
+  it("allows Hindi and Latin code-switching for Hinglish", () => {
+    const result = guardReplyLanguage("बिल्कुल, I can help. તમે શું પૂછવા માંગો છો?", "hi-en", "Please meri help kijiye");
+    expect(result.text).toBe("बिल्कुल, I can help?");
+  });
+
+  it("removes an unrelated non-Indic script from an Indian-language response", () => {
+    expect(guardReplyLanguage("ਹਾਂ, یہ مدد ਹੈ", "pa-IN", "ਕਿਰਪਾ ਕਰਕੇ ਮਦਦ ਕਰੋ").text).toBe("ਹਾਂ, ਹੈ");
+  });
+
+  it("leaves English-only speech unchanged", () => {
+    const reply = "I can help with that today.";
+    expect(guardReplyLanguage(reply, "en-IN", "Please help me")).toEqual({ text: reply, changed: false });
+  });
+});
diff --git a/__tests__/components/test-agent-registry.test.ts b/__tests__/components/test-agent-registry.test.ts
new file mode 100644
index 0000000..66d8637
--- /dev/null
+++ b/__tests__/components/test-agent-registry.test.ts
@@ -0,0 +1,27 @@
+import { describe, expect, it, vi } from "vitest";
+import { loadTestAgentOptions } from "../../app/_components/testAgentRegistry";
+
+const response = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => body }) as Response;
+
+describe("loadTestAgentOptions", () => {
+  it("loads only the signed-in tenant's builder agents", async () => {
+    const fetcher = vi.fn().mockResolvedValue(response(200, { agents: [{ id: "agent-1", name: "My agent", description: "Mine", system_prompt: "secret" }] }));
+    await expect(loadTestAgentOptions(fetcher)).resolves.toEqual([{ id: "agent-1", name: "My agent", description: "Mine" }]);
+    expect(fetcher).toHaveBeenCalledTimes(1);
+    expect(fetcher).toHaveBeenCalledWith("/api/admin/agents");
+  });
+
+  it("uses the minimal public list only for anonymous users", async () => {
+    const fetcher = vi.fn()
+      .mockResolvedValueOnce(response(401, { error: "Unauthorized" }))
+      .mockResolvedValueOnce(response(200, { agents: [{ id: "public-1", name: "Public agent" }] }));
+    await expect(loadTestAgentOptions(fetcher)).resolves.toEqual([{ id: "public-1", name: "Public agent", description: null }]);
+    expect(fetcher).toHaveBeenNthCalledWith(2, "/api/agents");
+  });
+
+  it("does not fall back to other tenants after a server failure", async () => {
+    const fetcher = vi.fn().mockResolvedValue(response(500, { error: "Unavailable" }));
+    await expect(loadTestAgentOptions(fetcher)).resolves.toEqual([]);
+    expect(fetcher).toHaveBeenCalledTimes(1);
+  });
+});
diff --git a/__tests__/knowledge/intent.test.ts b/__tests__/knowledge/intent.test.ts
new file mode 100644
index 0000000..9e671de
--- /dev/null
+++ b/__tests__/knowledge/intent.test.ts
@@ -0,0 +1,31 @@
+import { describe, expect, it } from "vitest";
+import { shouldRetrieveClientKnowledge } from "../../lib/knowledge/intent";
+
+describe("shouldRetrieveClientKnowledge", () => {
+  it.each([
+    ["hello", false],
+    ["How are you?", false],
+    ["I'm fine, thank you", false],
+    ["ठीक है", false],
+    ["नमस्ते", false],
+    ["Thanks!", false],
+  ])("skips KB lookup for social turn: %s", (utterance, expected) => {
+    expect(shouldRetrieveClientKnowledge(utterance)).toBe(expected);
+  });
+
+  it.each([
+    ["What time do you close?", true],
+    ["How much does a consultation cost", true],
+    ["Can I reschedule my appointment", true],
+    ["क्लिनिक का पता क्या है?", true],
+    ["डॉक्टर कब उपलब्ध हैं", true],
+    ["இந்த சேவையின் விலை என்ன?", true],
+    ["ఈ ఆసుపత్రి సమయం ఏమిటి?", true],
+  ])("looks up factual or action intent: %s", (utterance, expected) => {
+    expect(shouldRetrieveClientKnowledge(utterance)).toBe(expected);
+  });
+
+  it("skips empty input", () => {
+    expect(shouldRetrieveClientKnowledge("  ")).toBe(false);
+  });
+});
diff --git a/__tests__/tools/custom.test.ts b/__tests__/tools/custom.test.ts
new file mode 100644
index 0000000..1a04398
--- /dev/null
+++ b/__tests__/tools/custom.test.ts
@@ -0,0 +1,22 @@
+import { describe, expect, it } from "vitest";
+import { customToolDefinitions, customToolFunctionName, executeCustomTool, type CustomToolRow } from "../../lib/tools/custom";
+
+const row: CustomToolRow = {
+  id:"a0b1c2d3-e4f5-6789-abcd-ef0123456789",tenant_id:"tenant",name:"Lookup order",description:"Look up an order",endpoint:"https://example.com",method:"POST",
+  input_schema:{type:"object",properties:{orderId:{type:"string"}},required:["orderId"]},headers:{},encrypted_secret:null,secret_header:null,status:"active",
+};
+
+describe("custom tool registry",()=>{
+  it("creates a stable provider-safe function id",()=>expect(customToolFunctionName(row.id)).toBe("custom_a0b1c2d3e4f56789abcdef01"));
+  it("only advertises active saved tools with their schemas",()=>{
+    const tools=customToolDefinitions([row,{...row,id:"b0b1c2d3-e4f5-6789-abcd-ef0123456789",status:"disabled"}]);
+    expect(tools).toHaveLength(1);expect(tools[0].function.name).toBe(customToolFunctionName(row.id));expect(tools[0].function.parameters).toEqual(row.input_schema);
+  });
+  it("rejects missing and unexpected arguments before contacting endpoints",async()=>{
+    await expect(executeCustomTool(row,{})).rejects.toThrow("Missing required input: orderId");
+    await expect(executeCustomTool(row,{orderId:"A1",extra:true})).rejects.toThrow("Unexpected input: extra");
+  });
+  it("rejects non HTTPS endpoints before network access",async()=>{
+    await expect(executeCustomTool({...row,endpoint:"http://127.0.0.1:8080"},{orderId:"A1"})).rejects.toThrow("must use HTTPS");
+  });
+});
diff --git a/app/_components/testAgentRegistry.ts b/app/_components/testAgentRegistry.ts
new file mode 100644
index 0000000..be49d64
--- /dev/null
+++ b/app/_components/testAgentRegistry.ts
@@ -0,0 +1,40 @@
+export interface TestAgentOption {
+  id: string;
+  name: string;
+  description: string | null;
+}
+
+/** Prefer the signed-in tenant's agents. Only anonymous users fall back to
+ * the minimal public list; don't leak other tenants' agents on API failures. */
+export async function loadTestAgentOptions(fetcher: typeof fetch = fetch): Promise<TestAgentOption[]> {
+  let scoped: Response | null = null;
+  try {
+    scoped = await fetcher("/api/admin/agents");
+  } catch {
+    return [];
+  }
+  if (scoped.ok) {
+    const body = await scoped.json().catch(() => null) as { agents?: unknown[] } | null;
+    return normalize(body?.agents);
+  }
+  if (scoped.status !== 401) return [];
+
+  try {
+    const publicResponse = await fetcher("/api/agents");
+    if (!publicResponse.ok) return [];
+    const body = await publicResponse.json().catch(() => null) as { agents?: unknown[] } | null;
+    return normalize(body?.agents);
+  } catch {
+    return [];
+  }
+}
+
+function normalize(rows: unknown): TestAgentOption[] {
+  if (!Array.isArray(rows)) return [];
+  return rows.flatMap((row) => {
+    if (!row || typeof row !== "object") return [];
+    const item = row as Record<string, unknown>;
+    if (typeof item.id !== "string" || typeof item.name !== "string") return [];
+    return [{ id: item.id, name: item.name, description: typeof item.description === "string" ? item.description : null }];
+  });
+}
diff --git a/app/admin/agents/BuiltInToolsPicker.tsx b/app/admin/agents/BuiltInToolsPicker.tsx
new file mode 100644
index 0000000..8409305
--- /dev/null
+++ b/app/admin/agents/BuiltInToolsPicker.tsx
@@ -0,0 +1,57 @@
+"use client";
+
+import { useEffect, useState } from "react";
+import { ArrowUpRight, CalendarDays, Check, ChevronDown, ChevronUp, ClipboardList, Loader2, ShieldCheck, Wrench } from "lucide-react";
+
+type BuiltInTool = { id: string; name: string; category: string; description: string; inputSchema?: { properties?: Record<string, { type?: string; description?: string }>; required?: string[] } };
+
+export function BuiltInToolsPicker({ enabledTools, onChange }: { enabledTools: string[]; onChange: (tools: string[]) => void }) {
+  const [tools, setTools] = useState<BuiltInTool[]>([]);
+  const [loading, setLoading] = useState(true);
+  const [error, setError] = useState("");
+  const [expanded, setExpanded] = useState<string | null>(null);
+
+  useEffect(() => {
+    let current = true;
+    fetch("/api/admin/tools").then(async (response) => {
+      const data = await response.json();
+      if (!response.ok) throw new Error(data.error ?? "Could not load built-in tools.");
+      if (current) setTools(data.builtIns ?? []);
+    }).catch((cause) => { if (current) setError(cause instanceof Error ? cause.message : String(cause)); }).finally(() => { if (current) setLoading(false); });
+    return () => { current = false; };
+  }, []);
+
+  const toggle = (id: string) => onChange(enabledTools.includes(id) ? enabledTools.filter((item) => item !== id) : [...enabledTools, id]);
+
+  return <section className="rounded-xl border border-[var(--color-border-subtle)] p-4">
+    <div className="flex flex-wrap items-start justify-between gap-3">
+      <div>
+        <div className="flex items-center gap-2"><span className="flex size-7 items-center justify-center rounded-lg bg-cyan-400/10 text-cyan-300"><Wrench className="size-3.5" /></span><h3 className="text-[13px] font-bold text-[var(--color-text-primary)]">Voxera built-in tools</h3><span className="rounded-full bg-[var(--color-bg-surface)] px-2 py-0.5 text-[10px] text-[var(--color-text-muted)]">{tools.length}</span></div>
+        <p className="mt-1 text-[11px] text-[var(--color-text-muted)]">Enable only actions this agent needs. Select a tool to add it; open details to inspect its inputs and behavior.</p>
+      </div>
+      <a href="/admin/tools" className="inline-flex items-center gap-1 text-[10.5px] font-semibold text-violet-300 hover:text-violet-200">Browse integrations <ArrowUpRight className="size-3" /></a>
+    </div>
+    {loading ? <div className="mt-4 flex items-center gap-2 text-xs text-[var(--color-text-muted)]"><Loader2 className="size-3 animate-spin" />Loading available actions…</div> : error ? <p role="alert" className="mt-3 text-xs text-red-400">{error}</p> : <div className="mt-3 divide-y divide-[var(--color-border-subtle)] overflow-hidden rounded-lg border border-[var(--color-border-subtle)]">
+      {tools.map((tool) => {
+        const selected = enabledTools.includes(tool.id);
+        const isOpen = expanded === tool.id;
+        const Icon = tool.category === "Appointments" ? CalendarDays : ClipboardList;
+        const properties = Object.entries(tool.inputSchema?.properties ?? {});
+        return <div key={tool.id} className="bg-[var(--color-bg-surface)]">
+          <div className="flex items-center gap-2.5 px-3 py-2.5">
+            <button type="button" onClick={() => toggle(tool.id)} aria-pressed={selected} aria-label={`${selected ? "Disable" : "Enable"} ${tool.name}`} className={`flex size-8 flex-none items-center justify-center rounded-lg border transition-colors ${tool.category === "Appointments" ? "border-cyan-300/20 bg-cyan-400/10 text-cyan-200" : "border-amber-300/20 bg-amber-400/10 text-amber-200"} ${selected ? "ring-1 ring-violet-400/70" : "hover:border-[var(--color-border-active)]"}`}><Icon className="size-4" /></button>
+            <button type="button" onClick={() => toggle(tool.id)} className="min-w-0 flex-1 text-left"><span className="block truncate text-[11.5px] font-semibold text-[var(--color-text-primary)]">{tool.name}</span><span className="block truncate text-[10px] text-[var(--color-text-muted)]">{tool.description}</span></button>
+            {selected && <Check aria-label="Enabled" className="size-3.5 text-violet-300" />}
+            <button type="button" onClick={() => setExpanded(isOpen ? null : tool.id)} aria-expanded={isOpen} aria-label={`${isOpen ? "Hide" : "Show"} details for ${tool.name}`} className="rounded p-1 text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]">{isOpen ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}</button>
+          </div>
+          {isOpen && <div className="border-t border-[var(--color-border-subtle)] px-3 py-3 pl-[3.35rem]">
+            <p className="text-[10.5px] leading-relaxed text-[var(--color-text-secondary)]">{tool.description}</p>
+            {properties.length > 0 && <><div className="mt-2 text-[9px] font-bold uppercase tracking-wider text-[var(--color-text-muted)]">Inputs {tool.inputSchema?.required?.length ? `· ${tool.inputSchema.required.length} required` : ""}</div><div className="mt-1.5 flex flex-wrap gap-1.5">{properties.map(([key, value]) => <span key={key} title={value.description} className="rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-bg-base)] px-2 py-1 text-[9.5px] text-[var(--color-text-secondary)]"><code>{key}</code><span className="ml-1 text-[var(--color-text-muted)]">{value.type}</span>{tool.inputSchema?.required?.includes(key) && <span className="ml-1 text-amber-300">required</span>}</span>)}</div></>}
+            {tool.category === "Appointments" && <div className="mt-2 flex items-start gap-1.5 text-[9.5px] leading-relaxed text-emerald-200/80"><ShieldCheck className="mt-0.5 size-3 flex-none" />Appointment updates require an identified patient and validated appointment details.</div>}
+          </div>}
+        </div>;
+      })}
+      {!tools.length && !error && <p className="p-3 text-[11px] text-[var(--color-text-muted)]">No built-in call actions are available.</p>}
+    </div>}
+  </section>;
+}
diff --git a/app/admin/agents/CustomToolPicker.tsx b/app/admin/agents/CustomToolPicker.tsx
new file mode 100644
index 0000000..63229ac
--- /dev/null
+++ b/app/admin/agents/CustomToolPicker.tsx
@@ -0,0 +1,42 @@
+"use client";
+
+import { useEffect, useState } from "react";
+import { ChevronDown, ChevronUp, Code2, ExternalLink, Loader2 } from "lucide-react";
+
+type Tool = { id: string; functionName: string; name: string; description: string; endpoint: string; method: string; inputSchema: Record<string, unknown>; status: string; lastTestedAt: string | null };
+
+export function CustomToolPicker({ enabledTools, onChange }: { enabledTools: string[]; onChange: (tools: string[]) => void }) {
+  const [tools, setTools] = useState<Tool[]>([]);
+  const [loading, setLoading] = useState(true);
+  const [error, setError] = useState("");
+  const [expanded, setExpanded] = useState<string | null>(null);
+  useEffect(() => {
+    let current = true;
+    fetch("/api/admin/tools").then(async (response) => { const data = await response.json(); if (!response.ok) throw new Error(data.error ?? "Could not load saved tools."); if (current) setTools(data.tools ?? []); }).catch((cause) => { if (current) setError(cause instanceof Error ? cause.message : String(cause)); }).finally(() => { if (current) setLoading(false); });
+    return () => { current = false; };
+  }, []);
+
+  return <section className="rounded-xl border border-[var(--color-border-subtle)] p-4">
+    <div className="flex items-center gap-2"><span className="flex size-7 items-center justify-center rounded-lg bg-violet-400/10 text-violet-300"><Code2 className="size-3.5" /></span><h3 className="text-[13px] font-bold text-[var(--color-text-primary)]">Saved custom tools</h3><span className="rounded-full bg-[var(--color-bg-surface)] px-2 py-0.5 text-[10px] text-[var(--color-text-muted)]">{tools.length}</span></div>
+    <p className="mt-1 text-[11px] text-[var(--color-text-muted)]">Reusable HTTP actions from Tools. Select an action to give this agent access; open it to inspect its endpoint and input fields.</p>
+    {loading ? <p className="mt-3 flex items-center gap-2 text-xs text-[var(--color-text-muted)]"><Loader2 className="size-3 animate-spin" />Loading saved tools…</p> : tools.length ? <div className="mt-3 divide-y divide-[var(--color-border-subtle)] overflow-hidden rounded-lg border border-[var(--color-border-subtle)]">
+      {tools.map((tool) => {
+        const selected = enabledTools.includes(tool.functionName);
+        const isOpen = expanded === tool.functionName;
+        let host = "";
+        try { host = new URL(tool.endpoint).hostname; } catch { /* An invalid saved URL is still shown as text. */ }
+        return <div key={tool.functionName} className="bg-[var(--color-bg-surface)]">
+          <div className="flex items-center gap-2.5 px-3 py-2.5">
+            <span className="flex size-8 flex-none items-center justify-center rounded-lg border border-violet-300/20 bg-violet-400/10 text-violet-200"><Code2 className="size-4" /></span>
+            <button type="button" onClick={() => setExpanded(isOpen ? null : tool.functionName)} aria-expanded={isOpen} className="min-w-0 flex-1 text-left"><span className="block truncate text-[11.5px] font-semibold text-[var(--color-text-primary)]">{tool.name}</span><span className="block truncate text-[10px] text-[var(--color-text-muted)]">{tool.description}</span></button>
+            <input aria-label={`Enable ${tool.name}`} type="checkbox" checked={selected} disabled={tool.status !== "active"} onChange={() => onChange(selected ? enabledTools.filter((id) => id !== tool.functionName) : [...enabledTools, tool.functionName])} className="accent-violet-500" />
+            {tool.status !== "active" && <span className="rounded bg-amber-400/10 px-1.5 py-0.5 text-[9px] text-amber-200">Disabled</span>}
+            <button type="button" onClick={() => setExpanded(isOpen ? null : tool.functionName)} aria-label={`${isOpen ? "Hide" : "Show"} details for ${tool.name}`} aria-expanded={isOpen} className="rounded p-1 text-[var(--color-text-muted)]">{isOpen ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}</button>
+          </div>
+          {isOpen && <div className="border-t border-[var(--color-border-subtle)] px-3 py-3 pl-[3.35rem]"><p className="text-[10.5px] text-[var(--color-text-secondary)]">{tool.description}</p><div className="mt-2 flex flex-wrap items-center gap-2 text-[9.5px] text-[var(--color-text-muted)]"><span className="rounded bg-[var(--color-bg-base)] px-1.5 py-1 font-mono">{tool.method}</span><span className="inline-flex max-w-full items-center gap-1 truncate"><ExternalLink className="size-3 flex-none" />{host || "Endpoint not available"}</span>{tool.lastTestedAt && <span>Tested {new Date(tool.lastTestedAt).toLocaleDateString()}</span>}</div><div className="mt-2 text-[9px] font-bold uppercase tracking-wider text-[var(--color-text-muted)]">Input schema</div><pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded bg-[var(--color-bg-base)] p-2 text-[9.5px] text-[var(--color-text-secondary)]">{JSON.stringify(tool.inputSchema, null, 2)}</pre></div>}
+        </div>;
+      })}
+    </div> : <div className="mt-3 rounded-lg border border-dashed border-[var(--color-border-subtle)] px-3 py-3 text-[11px] text-[var(--color-text-muted)]">No saved custom tools yet. Add an HTTP action in Tools to make it available here.</div>}
+    {error && <p role="alert" className="mt-2 text-xs text-red-400">{error}</p>}
+  </section>;
+}
diff --git a/app/admin/agents/MCPToolsPanel.tsx b/app/admin/agents/MCPToolsPanel.tsx
new file mode 100644
index 0000000..9875a7e
--- /dev/null
+++ b/app/admin/agents/MCPToolsPanel.tsx
@@ -0,0 +1,136 @@
+"use client";
+
+import { useCallback, useEffect, useState } from "react";
+import { Activity, ChevronDown, ChevronUp, Loader2, Plus, RefreshCw, Trash2 } from "lucide-react";
+
+interface MCPToolOption { id: string; name: string; description: string; inputSchema: Record<string, unknown> }
+interface Connection { id: string; name: string; endpoint: string; hasToken: boolean; status: string; toolsCheckedAt: string | null; lastError: string | null; tools: MCPToolOption[] }
+
+export function MCPToolsPanel({ enabledTools, onChange, initialName = "", selectable = true }: { enabledTools: string[]; onChange: (ids: string[]) => void; initialName?: string; selectable?: boolean }) {
+  const [connections, setConnections] = useState<Connection[]>([]);
+  const [name, setName] = useState("");
+  const [endpoint, setEndpoint] = useState("");
+  const [token, setToken] = useState("");
+  const [tokenHeader, setTokenHeader] = useState("authorization");
+  const [busy, setBusy] = useState(false);
+  const [error, setError] = useState<string | null>(null);
+  const [testOutput, setTestOutput] = useState<Record<string,string>>({});
+  const [expandedTool, setExpandedTool] = useState<string | null>(null);
+
+  const load = useCallback(async () => {
+    const response = await fetch("/api/admin/mcp-connections");
+    const data = await response.json();
+    if (!response.ok) throw new Error(data.error ?? "Could not load MCP connections.");
+    setConnections(data.connections ?? []);
+  }, []);
+
+  useEffect(() => { void load().catch((err) => setError(err instanceof Error ? err.message : String(err))); }, [load]);
+  useEffect(() => { if (initialName) setName(initialName); }, [initialName]);
+
+  const add = async () => {
+    setBusy(true); setError(null);
+    try {
+      const response = await fetch("/api/admin/mcp-connections", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, endpoint, token: token || undefined, tokenHeader }) });
+      const data = await response.json();
+      if (!response.ok) throw new Error(data.error ?? "Could not connect MCP server.");
+      setName(""); setEndpoint(""); setToken(""); setTokenHeader("authorization");
+      await load();
+    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
+    finally { setBusy(false); }
+  };
+
+  const refresh = async (id: string) => {
+    setBusy(true); setError(null);
+    try {
+      const response = await fetch("/api/admin/mcp-connections", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
+      const data = await response.json();
+      if (!response.ok) throw new Error(data.error ?? "Could not refresh tools.");
+      const updated: Connection = data.connection;
+      const previous = connections.find((item) => item.id === id);
+      const nextIds = new Set(updated.tools.map((tool) => tool.id));
+      if (previous) onChange(enabledTools.filter((toolId) => !previous.tools.some((tool) => tool.id === toolId) || nextIds.has(toolId)));
+      await load();
+    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
+    finally { setBusy(false); }
+  };
+
+  const remove = async (connection: Connection) => {
+    if (!confirm(`Remove MCP server “${connection.name}”? Agents using its tools will lose access.`)) return;
+    setBusy(true); setError(null);
+    try {
+      const response = await fetch(`/api/admin/mcp-connections?id=${encodeURIComponent(connection.id)}`, { method: "DELETE" });
+      const data = await response.json();
+      if (!response.ok) throw new Error(data.error ?? "Could not remove connection.");
+      const removedIds = connection.tools.map((tool) => tool.id);
+      onChange(enabledTools.filter((id) => !removedIds.includes(id)));
+      await load();
+    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
+    finally { setBusy(false); }
+  };
+
+  const testTool = async (connection: Connection, tool: MCPToolOption) => {
+    if (!confirm(`Run MCP tool “${tool.name}” with sample arguments? This may make real changes in the connected service.`)) return;
+    const raw = window.prompt("Sample arguments as JSON", "{}");
+    if (raw === null) return;
+    const key = `${connection.id}:${tool.id}`;
+    setBusy(true); setError(null); setTestOutput((current) => ({ ...current, [key]: "Running…" }));
+    try {
+      const args = JSON.parse(raw);
+      if (!args || typeof args !== "object" || Array.isArray(args)) throw new Error("Arguments must be a JSON object.");
+      const response = await fetch("/api/admin/mcp-connections", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "test", id: connection.id, toolName: tool.name, arguments: args }) });
+      const data = await response.json();
+      if (!response.ok) throw new Error(data.error ?? "MCP tool test failed.");
+      setTestOutput((current) => ({ ...current, [key]: `Success: ${data.output ?? "Tool completed."}` }));
+    } catch (err) { setTestOutput((current) => ({ ...current, [key]: `Failed: ${err instanceof Error ? err.message : String(err)}` })); }
+    finally { setBusy(false); }
+  };
+
+  return <section className="flex flex-col gap-3 rounded-xl border border-[var(--color-border-subtle)] p-4">
+    <div>
+      <h3 className="text-[13px] font-bold text-[var(--color-text-primary)]">Model Context Protocol (MCP)</h3>
+      <p className="text-[11.5px] text-[var(--color-text-muted)] mt-1">Connect an HTTPS MCP server, discover its tool schemas, then allow only the actions this agent should use. Credentials stay server-side and are encrypted at rest.</p>
+    </div>
+    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
+      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Connection name" maxLength={80} className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] px-3 py-2 text-[12.5px] text-[var(--color-text-primary)]" />
+      <input value={endpoint} onChange={(e) => setEndpoint(e.target.value)} placeholder="https://example.com/mcp" maxLength={500} className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] px-3 py-2 text-[12.5px] text-[var(--color-text-primary)]" />
+      <div className="flex gap-2">
+        <select value={tokenHeader} onChange={(e) => setTokenHeader(e.target.value)} className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] px-2 text-[11px] text-[var(--color-text-primary)]"><option value="authorization">Bearer</option><option value="x-api-key">x-api-key</option><option value="x-auth-token">x-auth-token</option></select>
+        <input value={token} onChange={(e) => setToken(e.target.value)} type="password" placeholder="Token (optional)" maxLength={2000} className="min-w-0 flex-1 rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] px-3 py-2 text-[12.5px] text-[var(--color-text-primary)]" />
+      </div>
+      <button type="button" disabled={busy || !name.trim() || !endpoint.trim()} onClick={add} className="flex items-center justify-center gap-2 rounded-lg bg-[var(--color-accent-violet)] px-3 py-2 text-[12.5px] font-semibold text-white disabled:opacity-50">{busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />} Connect and discover</button>
+    </div>
+    {connections.map((connection) => <div key={connection.id} className="rounded-lg border border-[var(--color-border-subtle)] p-3">
+      <div className="flex items-center gap-2">
+        <ConnectionLogo name={connection.name} />
+        <div className="min-w-0 flex-1"><div className="truncate text-[12.5px] font-semibold text-[var(--color-text-primary)]">{connection.name}</div><div className="truncate text-[10.5px] text-[var(--color-text-muted)]">{connection.endpoint} · {connection.tools.length} tools {connection.hasToken ? "· credential saved" : ""}</div></div>
+        <button type="button" title="Refresh tool list" disabled={busy} onClick={() => void refresh(connection.id)} className="rounded-md p-1.5 text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"><RefreshCw className="h-3.5 w-3.5" /></button>
+        <button type="button" title="Remove MCP server" disabled={busy} onClick={() => void remove(connection)} className="rounded-md p-1.5 text-[var(--color-text-muted)] hover:text-red-400"><Trash2 className="h-3.5 w-3.5" /></button>
+      </div>
+      {connection.tools.map((tool) => {
+        const selected = enabledTools.includes(tool.id);
+        const key = `${connection.id}:${tool.id}`;
+        const isOpen = expandedTool === key;
+        return <div key={tool.id} className="mt-2 rounded-md bg-[var(--color-bg-surface)] p-2.5">
+          <div className="flex items-start gap-2">
+            {selectable && <input aria-label={`Enable ${tool.name}`} type="checkbox" checked={selected} disabled={connection.status !== "active"} onChange={() => onChange(selected ? enabledTools.filter((id) => id !== tool.id) : [...enabledTools, tool.id])} className="mt-1 accent-violet-500" />}
+            <button type="button" onClick={() => setExpandedTool(isOpen ? null : key)} aria-expanded={isOpen} className="min-w-0 flex-1 text-left"><span className="block text-[11.5px] font-semibold text-[var(--color-text-primary)]">{tool.name}</span><span className="block text-[10.5px] text-[var(--color-text-muted)]">{tool.description || "No description provided."}</span></button>
+            <button type="button" onClick={() => setExpandedTool(isOpen ? null : key)} aria-label={`${isOpen ? "Hide" : "Show"} details for ${tool.name}`} aria-expanded={isOpen} className="rounded p-1 text-[var(--color-text-muted)]">{isOpen ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}</button>
+          </div>
+          {isOpen && <div className="mt-2 border-t border-[var(--color-border-subtle)] pt-2"><p className="text-[10.5px] text-[var(--color-text-secondary)]">{tool.description || "This action is provided by the connected MCP server."}</p><div className="mt-1.5 text-[9px] font-bold uppercase tracking-wider text-[var(--color-text-muted)]">Input schema</div><pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded bg-[var(--color-bg-base)] p-2 text-[9.5px] text-[var(--color-text-secondary)]">{JSON.stringify(tool.inputSchema ?? {}, null, 2)}</pre></div>}
+          <button type="button" disabled={busy || connection.status !== "active"} onClick={() => void testTool(connection, tool)} className="mt-1 inline-flex items-center gap-1 text-[10px] font-semibold text-violet-300 disabled:opacity-40"><Activity className="size-3"/> Test action</button>
+          {testOutput[key] && <span className="mt-1 block break-words text-[10px] text-[var(--color-text-muted)]">{testOutput[key]}</span>}
+        </div>;
+      })}
+      {connection.toolsCheckedAt && <p className="mt-2 text-[10px] text-[var(--color-text-muted)]">Last discovered {new Date(connection.toolsCheckedAt).toLocaleString()}</p>}
+      {connection.status !== "active" && <p className="mt-1 text-[10.5px] text-amber-400">Connection needs refresh. {connection.lastError}</p>}
+    </div>)}
+    {!connections.length && <p className="text-[11px] text-[var(--color-text-muted)]">No MCP servers connected yet.</p>}
+    {error && <p role="alert" className="text-[11.5px] text-red-400">{error}</p>}
+  </section>;
+}
+
+function ConnectionLogo({ name }: { name: string }) {
+  const domain = ({ slack: "slack.com", google: "google.com", gmail: "gmail.com", outlook: "outlook.com", microsoft: "microsoft.com", salesforce: "salesforce.com", hubspot: "hubspot.com", zendesk: "zendesk.com", notion: "notion.so", zoom: "zoom.us", shopify: "shopify.com", stripe: "stripe.com", github: "github.com", linear: "linear.app", zapier: "zapier.com", airtable: "airtable.com", calendly: "calendly.com", highlevel: "gohighlevel.com", gohighlevel: "gohighlevel.com" } as Record<string, string>)[name.toLowerCase()];
+  const [failed, setFailed] = useState(false);
+  return <span className="flex size-8 flex-none items-center justify-center overflow-hidden rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] text-[10px] font-bold text-violet-200">{domain && !failed ? <img src={`https://www.google.com/s2/favicons?domain=${domain}&sz=64`} alt={`${name} logo`} className="size-5 object-contain" onError={() => setFailed(true)} /> : name.split(/\s+/).map((part) => part[0]).slice(0, 2).join("").toUpperCase()}</span>;
+}
diff --git a/app/admin/agents/PrebuiltIntegrationsPicker.tsx b/app/admin/agents/PrebuiltIntegrationsPicker.tsx
new file mode 100644
index 0000000..8250b45
--- /dev/null
+++ b/app/admin/agents/PrebuiltIntegrationsPicker.tsx
@@ -0,0 +1,77 @@
+"use client";
+
+import { useEffect, useMemo, useState } from "react";
+import { ArrowUpRight, Check, ChevronDown, ChevronUp, Loader2, Search, Wrench } from "lucide-react";
+
+type RemoteTool = { id: string; name: string; description?: string; inputSchema?: Record<string, unknown> };
+type Connection = { id: string; name: string; status: string; tools: RemoteTool[] };
+type Integration = { name: string; category: string; domain: string; color: string };
+
+const APPS: Integration[] = [
+  { name: "Google Calendar", category: "Calendar", domain: "calendar.google.com", color: "4285F4" },
+  { name: "Google Sheets", category: "Productivity", domain: "sheets.google.com", color: "34A853" },
+  { name: "Gmail", category: "Email", domain: "gmail.com", color: "EA4335" },
+  { name: "Google Drive", category: "Files", domain: "drive.google.com", color: "4285F4" },
+  { name: "Slack", category: "Communication", domain: "slack.com", color: "4A154B" },
+  { name: "Microsoft Outlook", category: "Email & calendar", domain: "outlook.com", color: "0078D4" },
+  { name: "Salesforce", category: "CRM", domain: "salesforce.com", color: "00A1E0" },
+  { name: "HubSpot", category: "CRM", domain: "hubspot.com", color: "FF7A59" },
+  { name: "GoHighLevel", category: "CRM", domain: "gohighlevel.com", color: "188BF6" },
+  { name: "Zendesk", category: "Support", domain: "zendesk.com", color: "03363D" },
+  { name: "Shopify", category: "Commerce", domain: "shopify.com", color: "7AB55C" },
+  { name: "Stripe", category: "Payments", domain: "stripe.com", color: "635BFF" },
+  { name: "Notion", category: "Productivity", domain: "notion.so", color: "FFFFFF" },
+  { name: "Airtable", category: "Productivity", domain: "airtable.com", color: "FCB400" },
+  { name: "Calendly", category: "Calendar", domain: "calendly.com", color: "006BFF" },
+  { name: "Zoom", category: "Communication", domain: "zoom.us", color: "0B5CFF" },
+  { name: "Trello", category: "Productivity", domain: "trello.com", color: "0052CC" },
+  { name: "Asana", category: "Productivity", domain: "asana.com", color: "F06A6A" },
+  { name: "Jira", category: "Productivity", domain: "atlassian.com", color: "2684FF" },
+  { name: "Linear", category: "Productivity", domain: "linear.app", color: "8B5CF6" },
+  { name: "Make", category: "Automation", domain: "make.com", color: "6D00CC" },
+  { name: "n8n", category: "Automation", domain: "n8n.io", color: "EA4B71" },
+  { name: "Zapier MCP", category: "Integration hub", domain: "zapier.com", color: "FF4A00" },
+];
+
+export function PrebuiltIntegrationsPicker({ enabledTools, onChange }: { enabledTools: string[]; onChange: (tools: string[]) => void }) {
+  const [connections, setConnections] = useState<Connection[]>([]);
+  const [loading, setLoading] = useState(true);
+  const [error, setError] = useState("");
+  const [query, setQuery] = useState("");
+  const [expanded, setExpanded] = useState<string | null>(null);
+
+  useEffect(() => {
+    let current = true;
+    fetch("/api/admin/tools").then(async (response) => { const data = await response.json(); if (!response.ok) throw new Error(data.error ?? "Could not load connected integrations."); if (current) setConnections(data.mcpConnections ?? []); }).catch((cause) => { if (current) setError(cause instanceof Error ? cause.message : String(cause)); }).finally(() => { if (current) setLoading(false); });
+    return () => { current = false; };
+  }, []);
+
+  const visibleApps = useMemo(() => APPS.filter((app) => `${app.name} ${app.category}`.toLowerCase().includes(query.trim().toLowerCase())), [query]);
+  const connectionFor = (app: Integration) => connections.find((connection) => connection.name.toLowerCase().includes(app.name.toLowerCase()) || (app.name === "Zapier MCP" && connection.name.toLowerCase().includes("zapier")));
+
+  return <section className="rounded-xl border border-[var(--color-border-subtle)] p-4">
+    <div className="flex flex-wrap items-start justify-between gap-3">
+      <div><div className="flex items-center gap-2"><span className="flex size-7 items-center justify-center rounded-lg bg-blue-400/10 text-blue-200"><Wrench className="size-3.5" /></span><h3 className="text-[13px] font-bold text-[var(--color-text-primary)]">Prebuilt app integrations</h3><span className="rounded-full bg-[var(--color-bg-surface)] px-2 py-0.5 text-[10px] text-[var(--color-text-muted)]">{APPS.length}</span></div><p className="mt-1 text-[11px] text-[var(--color-text-muted)]">Connect an app once in Tools, then select its discovered actions for this agent.</p></div>
+      <a href="/admin/tools" className="inline-flex items-center gap-1 text-[10.5px] font-semibold text-violet-300 hover:text-violet-200">Manage integrations <ArrowUpRight className="size-3" /></a>
+    </div>
+    <label className="relative mt-3 block"><Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-[var(--color-text-muted)]" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find Google Calendar, Slack, CRM…" className="w-full rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-base)] py-2 pl-8 pr-3 text-[11px] text-[var(--color-text-primary)] outline-none focus:border-[var(--color-border-active)]" /></label>
+    {loading ? <p className="mt-3 flex items-center gap-2 text-xs text-[var(--color-text-muted)]"><Loader2 className="size-3 animate-spin" />Loading integrations…</p> : error ? <p role="alert" className="mt-3 text-xs text-red-400">{error}</p> : <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
+      {visibleApps.map((app) => {
+        const connection = connectionFor(app);
+        const ready = connection?.status === "active";
+        const isOpen = expanded === app.name;
+        const tools = connection?.tools ?? [];
+        return <div key={app.name} className="min-w-0 overflow-hidden rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)]">
+          <div className="flex items-center gap-2 px-2.5 py-2">
+            <span className="flex size-8 flex-none items-center justify-center rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-base)] p-1.5"><img src={`https://www.google.com/s2/favicons?domain=${app.domain}&sz=64`} alt={`${app.name} logo`} className="size-full object-contain" loading="lazy" /></span>
+            <button type="button" onClick={() => setExpanded(isOpen ? null : app.name)} aria-expanded={isOpen} className="min-w-0 flex-1 text-left"><span className="block truncate text-[10.5px] font-semibold text-[var(--color-text-primary)]">{app.name}</span><span className="block truncate text-[9px] text-[var(--color-text-muted)]">{ready ? `${tools.length} actions · connected` : connection ? "Reconnect in Tools" : `${app.category} · connect in Tools`}</span></button>
+            {ready && tools.some((tool) => enabledTools.includes(tool.id)) && <Check aria-label="Actions enabled" className="size-3.5 flex-none text-emerald-300" />}
+            <button type="button" onClick={() => setExpanded(isOpen ? null : app.name)} aria-label={`${isOpen ? "Hide" : "Show"} ${app.name} actions`} aria-expanded={isOpen} className="rounded p-1 text-[var(--color-text-muted)]">{isOpen ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}</button>
+          </div>
+          {isOpen && <div className="border-t border-[var(--color-border-subtle)] p-2.5">{ready && tools.length ? <div className="space-y-1.5">{tools.map((tool) => { const selected = enabledTools.includes(tool.id); return <label key={tool.id} className="flex cursor-pointer items-start gap-2 rounded-md bg-[var(--color-bg-base)] p-2"><input type="checkbox" checked={selected} onChange={() => onChange(selected ? enabledTools.filter((id) => id !== tool.id) : [...enabledTools, tool.id])} className="mt-0.5 accent-violet-500" /><span className="min-w-0"><span className="block text-[10px] font-semibold text-[var(--color-text-primary)]">{tool.name}</span><span className="block text-[9px] text-[var(--color-text-muted)]">{tool.description || "No action description provided."}</span></span></label>; })}</div> : <div><p className="text-[9.5px] leading-relaxed text-[var(--color-text-muted)]">{connection ? "This connection is not active. Refresh it to discover actions." : "Connect this app through its MCP provider to discover actions you can assign to this agent."}</p><a href={`/admin/tools?connect=${encodeURIComponent(app.name)}`} className="mt-2 inline-flex items-center gap-1 rounded-md border border-[var(--color-border-subtle)] px-2 py-1.5 text-[9.5px] font-semibold text-violet-200 hover:bg-[var(--color-bg-elevated)]">Connect {app.name} in Tools <ArrowUpRight className="size-3" /></a></div>}</div>}
+        </div>;
+      })}
+      {visibleApps.length === 0 && <p className="col-span-full py-5 text-center text-[10.5px] text-[var(--color-text-muted)]">No integrations match that search.</p>}
+    </div>}
+  </section>;
+}
diff --git a/app/admin/tools/page.tsx b/app/admin/tools/page.tsx
new file mode 100644
index 0000000..807a9b3
--- /dev/null
+++ b/app/admin/tools/page.tsx
@@ -0,0 +1,3 @@
+import { ToolsRegistry } from "./tools-registry";
+
+export default function ToolsPage() { return <ToolsRegistry />; }
diff --git a/app/admin/tools/tools-registry.tsx b/app/admin/tools/tools-registry.tsx
new file mode 100644
index 0000000..9214cfc
--- /dev/null
+++ b/app/admin/tools/tools-registry.tsx
@@ -0,0 +1,307 @@
+"use client";
+
+import { useCallback, useEffect, useMemo, useState } from "react";
+import { Activity, ArrowRight, CalendarDays, Check, ChevronDown, ChevronUp, ClipboardList, Code2, ExternalLink, Loader2, Plus, Search, ShieldCheck, Trash2, Wrench, X } from "lucide-react";
+import { MCPToolsPanel } from "../agents/MCPToolsPanel";
+
+type Tool = { id: string; functionName: string; name: string; description: string; endpoint: string; method: string; inputSchema: Record<string, unknown>; hasSecret: boolean; status: string; lastTestedAt: string | null; lastError: string | null };
+type BuiltIn = { id: string; name: string; category: string; description: string; inputSchema?: { properties?: Record<string, { type?: string; description?: string }>; required?: string[] } };
+type Connection = { id: string; name: string; endpoint: string; status: string; tools: Array<{ name: string; description?: string }>; tools_checked_at?: string | null; last_error?: string | null };
+type Catalog = { tools: Tool[]; builtIns: BuiltIn[]; mcpConnections: Connection[] };
+type Integration = { name: string; category: string; slug: string; color: string; logoDomain?: string; via: string; url: string };
+
+const INTEGRATIONS: Integration[] = [
+  { name: "Google Calendar", category: "Calendar", slug: "googlecalendar", color: "4285F4", via: "Zapier MCP or Google API", url: "https://docs.vapi.ai/tools/google-calendar" },
+  { name: "Google Sheets", category: "Productivity", slug: "googlesheets", color: "34A853", via: "Zapier MCP", url: "https://docs.vapi.ai/tools/integrations" },
+  { name: "Gmail", category: "Email", slug: "gmail", color: "EA4335", via: "Zapier MCP", url: "https://zapier.com/apps/mcp-client-by-zapier/integrations" },
+  { name: "Google Drive", category: "Files", slug: "googledrive", color: "4285F4", via: "Zapier MCP", url: "https://zapier.com/apps/mcp-client-by-zapier/integrations" },
+  { name: "Slack", category: "Communication", slug: "slack", color: "4A154B", logoDomain: "slack.com", via: "Zapier MCP or Slack API", url: "https://docs.vapi.ai/tools/integrations" },
+  { name: "Microsoft Outlook", category: "Email & calendar", slug: "microsoftoutlook", color: "0078D4", logoDomain: "outlook.com", via: "Zapier MCP or Microsoft Graph", url: "https://zapier.com/apps/mcp-client-by-zapier/integrations" },
+  { name: "Salesforce", category: "CRM", slug: "salesforce", color: "00A1E0", logoDomain: "salesforce.com", via: "Zapier MCP", url: "https://zapier.com/apps/mcp-client-by-zapier/integrations" },
+  { name: "HubSpot", category: "CRM", slug: "hubspot", color: "FF7A59", via: "Zapier MCP", url: "https://zapier.com/apps/mcp-client-by-zapier/integrations" },
+  { name: "GoHighLevel", category: "CRM", slug: "gohighlevel", color: "188BF6", logoDomain: "gohighlevel.com", via: "GoHighLevel MCP or API", url: "https://docs.vapi.ai/tools/integrations" },
+  { name: "Zendesk", category: "Support", slug: "zendesk", color: "03363D", via: "Zapier MCP", url: "https://zapier.com/apps/mcp-client-by-zapier/integrations" },
+  { name: "Shopify", category: "Commerce", slug: "shopify", color: "7AB55C", via: "Zapier MCP", url: "https://zapier.com/apps/mcp-client-by-zapier/integrations" },
+  { name: "Stripe", category: "Payments", slug: "stripe", color: "635BFF", via: "Zapier MCP or Stripe API", url: "https://zapier.com/apps/mcp-client-by-zapier/integrations" },
+  { name: "Notion", category: "Productivity", slug: "notion", color: "FFFFFF", via: "Zapier MCP", url: "https://zapier.com/apps/mcp-client-by-zapier/integrations" },
+  { name: "Airtable", category: "Productivity", slug: "airtable", color: "FCB400", via: "Zapier MCP", url: "https://zapier.com/apps/mcp-client-by-zapier/integrations" },
+  { name: "Calendly", category: "Calendar", slug: "calendly", color: "006BFF", via: "Zapier MCP", url: "https://zapier.com/apps/mcp-client-by-zapier/integrations" },
+  { name: "Zoom", category: "Communication", slug: "zoom", color: "0B5CFF", via: "Zapier MCP", url: "https://zapier.com/apps/mcp-client-by-zapier/integrations" },
+  { name: "Trello", category: "Productivity", slug: "trello", color: "0052CC", via: "Zapier MCP", url: "https://zapier.com/apps/mcp-client-by-zapier/integrations" },
+  { name: "Asana", category: "Productivity", slug: "asana", color: "F06A6A", via: "Zapier MCP", url: "https://zapier.com/apps/mcp-client-by-zapier/integrations" },
+  { name: "Jira", category: "Productivity", slug: "jira", color: "2684FF", via: "Zapier MCP", url: "https://zapier.com/apps/mcp-client-by-zapier/integrations" },
+  { name: "Linear", category: "Productivity", slug: "linear", color: "8B5CF6", via: "Linear MCP or API", url: "https://linear.app/docs/mcp" },
+  { name: "Make", category: "Automation", slug: "make", color: "6D00CC", via: "Make MCP or webhook", url: "https://www.make.com/en/integrations" },
+  { name: "n8n", category: "Automation", slug: "n8n", color: "EA4B71", via: "n8n MCP or webhook", url: "https://docs.n8n.io/advanced-ai/accessing-n8n-mcp-server/" },
+  { name: "Zapier MCP", category: "Integration hub", slug: "zapier", color: "FF4A00", via: "Native MCP", url: "https://help.zapier.com/hc/en-us/articles/48308034391821-What-is-Zapier-MCP" },
+];
+
+const EMPTY_SCHEMA = JSON.stringify({ type: "object", properties: {}, required: [] }, null, 2);
+const inputClass = "w-full rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-base)] px-3 py-2 text-xs text-[var(--color-text-primary)] outline-none focus:border-violet-400/60";
+
+export function ToolsRegistry() {
+  const [catalog, setCatalog] = useState<Catalog>({ tools: [], builtIns: [], mcpConnections: [] });
+  const [loading, setLoading] = useState(true);
+  const [error, setError] = useState("");
+  const [search, setSearch] = useState("");
+  const [category, setCategory] = useState("All apps");
+  const [selectedIntegration, setSelectedIntegration] = useState("");
+  const [showConnect, setShowConnect] = useState(false);
+  const [showForm, setShowForm] = useState(false);
+  const [editing, setEditing] = useState<Tool | null>(null);
+  const [busy, setBusy] = useState(false);
+  const [form, setForm] = useState({ name: "", description: "", endpoint: "", method: "POST", headers: "{}", secret: "", secretHeader: "authorization", inputSchema: EMPTY_SCHEMA, sampleInput: "{}" });
+  const [testResult, setTestResult] = useState("");
+  const [expandedBuiltIn, setExpandedBuiltIn] = useState<string | null>(null);
+
+  const load = useCallback(async () => {
+    setLoading(true);
+    try {
+      const response = await fetch("/api/admin/tools");
+      const data = await response.json();
+      if (!response.ok) throw new Error(data.error ?? "Could not load tools.");
+      setCatalog(data);
+      setError("");
+    } catch (cause) {
+      setError(cause instanceof Error ? cause.message : String(cause));
+    } finally {
+      setLoading(false);
+    }
+  }, []);
+
+  useEffect(() => { void load(); }, [load]);
+
+  useEffect(() => {
+    const requested = new URLSearchParams(window.location.search).get("connect");
+    if (!requested) return;
+    const integration = INTEGRATIONS.find((item) => item.name.toLowerCase() === requested.toLowerCase());
+    if (integration) {
+      setSelectedIntegration(integration.name);
+      setShowConnect(true);
+    }
+  }, []);
+
+  const categories = useMemo(() => ["All apps", ...new Set(INTEGRATIONS.map((item) => item.category))], []);
+  const visibleIntegrations = useMemo(() => {
+    const query = search.trim().toLowerCase();
+    return INTEGRATIONS.filter((item) => (category === "All apps" || item.category === category) && (!query || `${item.name} ${item.category} ${item.via}`.toLowerCase().includes(query)));
+  }, [category, search]);
+
+  const connectionFor = (integration: Integration) => catalog.mcpConnections.find((connection) => connection.name.toLowerCase().includes(integration.name.toLowerCase()));
+  const openConnector = (integration: Integration) => {
+    setSelectedIntegration(integration.name);
+    setShowConnect(true);
+  };
+
+  const createCustomTool = () => {
+    setEditing(null);
+    setForm({ name: "", description: "", endpoint: "", method: "POST", headers: "{}", secret: "", secretHeader: "authorization", inputSchema: EMPTY_SCHEMA, sampleInput: "{}" });
+    setTestResult("");
+    setError("");
+    setShowForm(true);
+  };
+
+  const editCustomTool = (tool: Tool) => {
+    setEditing(tool);
+    setForm({ name: tool.name, description: tool.description, endpoint: tool.endpoint, method: tool.method, headers: "{}", secret: "", secretHeader: "authorization", inputSchema: JSON.stringify(tool.inputSchema, null, 2), sampleInput: "{}" });
+    setTestResult("");
+    setError("");
+    setShowForm(true);
+  };
+
+  const saveOrTest = async (action: "save" | "test") => {
+    setBusy(true);
+    setError("");
+    setTestResult("");
+    try {
+      const payload = { ...form, inputSchema: JSON.parse(form.inputSchema), headers: JSON.parse(form.headers), sampleInput: JSON.parse(form.sampleInput), id: editing?.id };
+      const response = await fetch(`/api/admin/tools${action === "test" ? "?action=test" : ""}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
+      const data = await response.json();
+      if (!response.ok) throw new Error(data.error ?? "Tool operation failed.");
+      if (action === "test") setTestResult(data.output || "Connection succeeded.");
+      else { setShowForm(false); await load(); }
+    } catch (cause) {
+      setError(cause instanceof Error ? cause.message : "Check the JSON fields and try again.");
+    } finally {
+      setBusy(false);
+    }
+  };
+
+  const removeCustomTool = async (tool: Tool) => {
+    if (!confirm(`Remove “${tool.name}”? Agents using it will lose access.`)) return;
+    const response = await fetch(`/api/admin/tools?id=${encodeURIComponent(tool.id)}`, { method: "DELETE" });
+    const data = await response.json();
+    if (!response.ok) { setError(data.error ?? "Could not remove tool."); return; }
+    await load();
+  };
+
+  const toggleCustomTool = async (tool: Tool) => {
+    const status = tool.status === "disabled" ? "active" : "disabled";
+    const response = await fetch("/api/admin/tools", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: tool.id, status }) });
+    const data = await response.json();
+    if (!response.ok) { setError(data.error ?? "Could not update tool."); return; }
+    await load();
+  };
+
+  return (
+    <div className="flex h-full flex-col font-body">
+      <header className="flex flex-none items-center justify-between gap-3 border-b border-[var(--color-border-subtle)] px-6 py-3 md:px-10">
+        <div className="flex min-w-0 items-center gap-2">
+          <Wrench className="h-4 w-4 flex-none text-[var(--color-accent-cyan)]" />
+          <span className="text-[13px] font-semibold text-[var(--color-text-primary)]">Tools</span>
+          <span className="hidden truncate text-[12px] text-[var(--color-text-muted)] sm:inline">· integrations for your voice agents</span>
+        </div>
+        <button onClick={createCustomTool} className="inline-flex flex-none items-center gap-1.5 rounded-lg btn-gradient px-3.5 py-1.5 text-[12.5px] font-semibold text-white transition-all hover:scale-[1.02]">
+          <Plus className="h-3.5 w-3.5" /> Create tool
+        </button>
+      </header>
+
+      <main className="min-h-0 flex-1 overflow-y-auto px-5 py-5 md:px-10 md:py-6">
+        <section aria-labelledby="prebuilt-title">
+          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
+            <div className="flex min-w-0 items-baseline gap-2">
+              <h1 id="prebuilt-title" className="text-[17px] font-semibold tracking-tight text-[var(--color-text-primary)]">Prebuilt integrations</h1>
+              <span className="text-[11px] text-[var(--color-text-muted)]">{INTEGRATIONS.length} apps</span>
+            </div>
+            <label className="relative w-full sm:w-56">
+              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--color-text-muted)]" />
+              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search apps" className="w-full rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] py-2 pl-8 pr-3 text-[11.5px] text-[var(--color-text-primary)] outline-none focus:border-[var(--color-border-active)]" />
+            </label>
+          </div>
+
+          <div className="mb-3 flex gap-1.5 overflow-x-auto pb-1">
+            {categories.map((item) => <button key={item} onClick={() => setCategory(item)} className={`flex-none rounded-full px-2.5 py-1 text-[10.5px] font-medium transition-colors ${category === item ? "bg-[var(--color-bg-elevated)] text-[var(--color-text-primary)]" : "text-[var(--color-text-muted)] hover:bg-[var(--color-bg-surface)] hover:text-[var(--color-text-primary)]"}`}>{item}</button>)}
+          </div>
+
+          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
+            {visibleIntegrations.map((integration) => {
+              const connected = connectionFor(integration);
+              return (
+                <button key={integration.name} type="button" onClick={() => openConnector(integration)} className="group flex min-w-0 items-center gap-2.5 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] px-2.5 py-2 text-left transition-colors hover:border-[var(--color-border-active)] hover:bg-[var(--color-bg-elevated)]">
+                  <IntegrationLogo integration={integration} />
+                  <span className="min-w-0 flex-1">
+                    <span className="block truncate text-[11.5px] font-semibold text-[var(--color-text-primary)]">{integration.name}</span>
+                    <span className="block truncate text-[9.5px] text-[var(--color-text-muted)]">{connected ? `${connected.tools.length} tools connected` : integration.category}</span>
+                  </span>
+                  {connected ? <Check className="h-3.5 w-3.5 flex-none text-emerald-400" /> : <Plus className="h-3.5 w-3.5 flex-none text-[var(--color-text-muted)] transition-colors group-hover:text-[var(--color-text-primary)]" />}
+                </button>
+              );
+            })}
+            {visibleIntegrations.length === 0 && <p className="col-span-full py-6 text-center text-xs text-[var(--color-text-muted)]">No apps match this search.</p>}
+          </div>
+          <p className="mt-2 text-[10px] text-[var(--color-text-muted)]">Connect an app through its MCP provider to discover its available actions. Each agent gets only the tools you enable.</p>
+        </section>
+
+        {error && <p role="alert" className="mt-4 rounded-lg border border-red-400/25 bg-red-400/5 px-3 py-2 text-xs text-red-300">{error}</p>}
+
+        <section className="mt-7 border-t border-[var(--color-border-subtle)] pt-5" aria-labelledby="connected-title">
+          <div className="mb-3 flex items-center justify-between gap-3">
+            <div className="flex items-baseline gap-2"><h2 id="connected-title" className="text-[14px] font-semibold text-[var(--color-text-primary)]">Connected integrations</h2><span className="text-[10px] text-[var(--color-text-muted)]">{catalog.mcpConnections.length}</span></div>
+            <button onClick={() => { setSelectedIntegration(""); setShowConnect(true); }} className="text-[10.5px] font-semibold text-violet-300 hover:text-violet-200">Add MCP server</button>
+          </div>
+          {loading ? <p className="flex items-center gap-2 py-3 text-[11px] text-[var(--color-text-muted)]"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading tools…</p> : catalog.mcpConnections.length ? <div className="divide-y divide-[var(--color-border-subtle)] rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)]">
+            {catalog.mcpConnections.map((connection) => <div key={connection.id} className="flex items-center gap-2.5 px-3 py-2.5">
+              <IntegrationLogo integration={INTEGRATIONS.find((item) => connection.name.toLowerCase().includes(item.name.toLowerCase())) ?? { name: connection.name, category: "MCP", slug: "", color: "8B5CF6", via: "MCP", url: "" }} />
+              <span className="min-w-0 flex-1"><span className="block truncate text-[11.5px] font-semibold text-[var(--color-text-primary)]">{connection.name}</span><span className="block text-[9.5px] text-[var(--color-text-muted)]">{connection.tools.length} tools · {connection.status}</span></span>
+              <span className={`h-1.5 w-1.5 rounded-full ${connection.status === "active" ? "bg-emerald-400" : "bg-amber-400"}`} />
+              <button title="Manage MCP connection" onClick={() => { setSelectedIntegration(connection.name.replace(/ MCP$/i, "")); setShowConnect(true); }} className="rounded p-1 text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"><ArrowRight className="h-3.5 w-3.5" /></button>
+            </div>)}
+          </div> : <p className="rounded-xl border border-dashed border-[var(--color-border-subtle)] px-3 py-3 text-[11px] text-[var(--color-text-muted)]">No integrations connected yet. Choose an app above to connect it.</p>}
+        </section>
+
+        <section className="mt-7 border-t border-[var(--color-border-subtle)] pt-5" aria-labelledby="custom-title">
+          <div className="mb-3 flex items-center justify-between gap-3">
+            <div className="flex items-baseline gap-2"><h2 id="custom-title" className="text-[14px] font-semibold text-[var(--color-text-primary)]">Custom tools</h2><span className="text-[10px] text-[var(--color-text-muted)]">{catalog.tools.length}</span></div>
+            <button onClick={createCustomTool} className="inline-flex items-center gap-1 rounded-md border border-[var(--color-border-subtle)] px-2.5 py-1.5 text-[10.5px] font-semibold text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-surface)]"><Plus className="h-3 w-3" /> Create tool</button>
+          </div>
+          {catalog.tools.length ? <div className="divide-y divide-[var(--color-border-subtle)] rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)]">
+            {catalog.tools.map((tool) => <div key={tool.id} className="flex items-center gap-2.5 px-3 py-2.5">
+              <span className={`flex h-8 w-8 flex-none items-center justify-center rounded-lg ${tool.status === "active" ? "bg-violet-400/10 text-violet-200" : "bg-[var(--color-bg-elevated)] text-[var(--color-text-muted)]"}`}><Code2 className="h-4 w-4" /></span>
+              <span className="min-w-0 flex-1"><span className="block truncate text-[11.5px] font-semibold text-[var(--color-text-primary)]">{tool.name}</span><span className="block truncate text-[9.5px] text-[var(--color-text-muted)]">{tool.method} · {tool.description}</span></span>
+              <span title={tool.hasSecret ? "Credential saved" : "No credential"}>{tool.hasSecret && <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />}</span>
+              <button onClick={() => editCustomTool(tool)} className="rounded-md border border-[var(--color-border-subtle)] px-2 py-1 text-[9.5px] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]">Configure</button>
+              <button onClick={() => void toggleCustomTool(tool)} className="rounded-md border border-[var(--color-border-subtle)] px-2 py-1 text-[9.5px] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]">{tool.status === "disabled" ? "Enable" : "Disable"}</button>
+              <button title="Remove custom tool" onClick={() => void removeCustomTool(tool)} className="rounded p-1 text-[var(--color-text-muted)] hover:text-red-300"><Trash2 className="h-3.5 w-3.5" /></button>
+            </div>)}
+          </div> : <button onClick={createCustomTool} className="flex w-full items-center gap-2 rounded-xl border border-dashed border-[var(--color-border-subtle)] px-3 py-3 text-left text-[11px] text-[var(--color-text-muted)] hover:border-[var(--color-border-active)] hover:text-[var(--color-text-primary)]"><Plus className="h-3.5 w-3.5" /> Add your first custom HTTP tool</button>}
+        </section>
+
+        <details className="group mt-7 border-t border-[var(--color-border-subtle)] pt-4">
+          <summary className="flex cursor-pointer list-none items-center gap-2 text-[12px] font-semibold text-[var(--color-text-secondary)]"><Wrench className="h-3.5 w-3.5 text-[var(--color-accent-cyan)]" /> Voxera built-in actions <span className="text-[10px] font-normal text-[var(--color-text-muted)]">{catalog.builtIns.length}</span><ChevronDown className="ml-auto h-3.5 w-3.5 transition-transform group-open:rotate-180" /></summary>
+          <div className="mt-2 divide-y divide-[var(--color-border-subtle)] overflow-hidden rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)]">
+            {catalog.builtIns.map((tool) => {
+              const Icon = tool.category === "Appointments" ? CalendarDays : ClipboardList;
+              const open = expandedBuiltIn === tool.id;
+              const fields = Object.entries(tool.inputSchema?.properties ?? {});
+              return <div key={tool.id} className="bg-[var(--color-bg-surface)]">
+                <button type="button" onClick={() => setExpandedBuiltIn(open ? null : tool.id)} aria-expanded={open} className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left hover:bg-[var(--color-bg-elevated)]">
+                  <span className={`flex size-8 flex-none items-center justify-center rounded-lg ${tool.category === "Appointments" ? "bg-cyan-400/10 text-cyan-300" : "bg-amber-400/10 text-amber-200"}`}><Icon className="size-4" /></span>
+                  <span className="min-w-0 flex-1"><span className="block text-[10.5px] font-medium text-[var(--color-text-primary)]">{tool.name}</span><span className="block text-[9px] text-[var(--color-text-muted)]">{tool.description}</span></span>
+                  <span className="text-[9px] text-[var(--color-text-muted)]">{tool.category}</span>{open ? <ChevronUp className="size-3.5 text-[var(--color-text-muted)]" /> : <ChevronDown className="size-3.5 text-[var(--color-text-muted)]" />}
+                </button>
+                {open && <div className="border-t border-[var(--color-border-subtle)] px-3 py-3 pl-[3.4rem]"><p className="text-[10px] leading-relaxed text-[var(--color-text-secondary)]">{tool.description}</p>{fields.length > 0 && <><div className="mt-2 text-[9px] font-bold uppercase tracking-wider text-[var(--color-text-muted)]">Inputs</div><div className="mt-1.5 flex flex-wrap gap-1.5">{fields.map(([key, value]) => <span key={key} title={value.description} className="rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-bg-base)] px-2 py-1 text-[9px] text-[var(--color-text-secondary)]"><code>{key}</code><span className="ml-1 text-[var(--color-text-muted)]">{value.type}</span>{tool.inputSchema?.required?.includes(key) && <span className="ml-1 text-amber-300">required</span>}</span>)}</div></>}{tool.category === "Appointments" && <p className="mt-2 flex items-center gap-1.5 text-[9px] text-emerald-200/80"><ShieldCheck className="size-3" />Requires caller identity to be established before patient updates.</p>}</div>}
+              </div>;
+            })}
+          </div>
+          <p className="mt-2 text-[9.5px] text-[var(--color-text-muted)]">Built-ins are enabled per agent from Agent Builder → Tools. Appointment actions verify patient identity before making changes.</p>
+        </details>
+      </main>
+
+      {showConnect && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-3" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowConnect(false); }}>
+        <div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-4 shadow-2xl sm:p-5">
+          <div className="mb-4 flex items-start justify-between gap-3"><div className="flex items-center gap-2.5"><IntegrationLogo integration={INTEGRATIONS.find((item) => item.name === selectedIntegration) ?? { name: "MCP server", category: "MCP", slug: "", color: "8B5CF6", via: "MCP", url: "" }} /><div><h2 className="text-[14px] font-semibold text-[var(--color-text-primary)]">{selectedIntegration ? `Connect ${selectedIntegration}` : "Connect MCP server"}</h2><p className="mt-0.5 text-[10px] text-[var(--color-text-muted)]">Discover provider actions once, then enable them for each agent.</p></div></div><button onClick={() => { setShowConnect(false); void load(); }} aria-label="Close connect dialog" className="rounded p-1.5 text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"><X className="h-4 w-4" /></button></div>
+          {selectedIntegration && <div className="mb-3 flex items-center justify-between rounded-lg bg-[var(--color-bg-base)] px-3 py-2 text-[10px] text-[var(--color-text-muted)]"><span>Connection method: {INTEGRATIONS.find((item) => item.name === selectedIntegration)?.via ?? "MCP"}</span><a href={INTEGRATIONS.find((item) => item.name === selectedIntegration)?.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-violet-300 hover:text-violet-200">Setup guide <ExternalLink className="h-3 w-3" /></a></div>}
+          <MCPToolsPanel enabledTools={[]} onChange={() => {}} initialName={selectedIntegration ? `${selectedIntegration} MCP` : ""} selectable={false} />
+          <p className="mt-3 text-[9.5px] leading-4 text-[var(--color-text-muted)]">Voxera supports HTTPS MCP servers using no auth or a static bearer/API key. OAuth-only providers need a compatible gateway. Tool execution follows the server’s configured permissions.</p>
+        </div>
+      </div>}
+
+      {showForm && <CustomToolDialog
+        form={form}
+        setForm={setForm}
+        editing={editing}
+        busy={busy}
+        error={error}
+        testResult={testResult}
+        close={() => setShowForm(false)}
+        save={() => void saveOrTest("save")}
+        test={() => void saveOrTest("test")}
+      />}
+    </div>
+  );
+}
+
+function IntegrationLogo({ integration }: { integration: Pick<Integration, "name" | "slug" | "color" | "logoDomain"> }) {
+  const [failed, setFailed] = useState(false);
+  return <span className="flex h-8 w-8 flex-none items-center justify-center rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-base)] p-1.5">
+    {!failed && integration.logoDomain ? <img src={`https://www.google.com/s2/favicons?domain=${integration.logoDomain}&sz=64`} alt={`${integration.name} logo`} loading="lazy" className="h-full w-full object-contain" onError={() => setFailed(true)} /> : !failed && integration.slug ? <img src={`https://cdn.simpleicons.org/${integration.slug}/${integration.color}`} alt={`${integration.name} logo`} loading="lazy" className="h-full w-full object-contain" onError={() => setFailed(true)} /> : <span aria-hidden="true" className="text-[9px] font-bold" style={{ color: `#${integration.color}` }}>{integration.name.split(/\s+/).map((part) => part[0]).slice(0, 2).join("")}</span>}
+  </span>;
+}
+
+type ToolForm = { name: string; description: string; endpoint: string; method: string; headers: string; secret: string; secretHeader: string; inputSchema: string; sampleInput: string };
+function CustomToolDialog({ form, setForm, editing, busy, error, testResult, close, save, test }: { form: ToolForm; setForm: (value: ToolForm) => void; editing: Tool | null; busy: boolean; error: string; testResult: string; close: () => void; save: () => void; test: () => void }) {
+  const update = (key: keyof ToolForm, value: string) => setForm({ ...form, [key]: value });
+  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-3" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}>
+    <div className="max-h-[95vh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-5 shadow-2xl">
+      <div className="flex items-center justify-between"><div><h2 className="text-[16px] font-semibold text-[var(--color-text-primary)]">{editing ? "Configure custom tool" : "Create custom tool"}</h2><p className="mt-1 text-[10.5px] text-[var(--color-text-muted)]">Define an HTTPS action, its input schema, and optional credential.</p></div><button onClick={close} aria-label="Close tool dialog" className="rounded p-2 text-[var(--color-text-muted)]"><X className="h-4 w-4" /></button></div>
+      <div className="mt-4 grid gap-3 md:grid-cols-2">
+        <Field label="Tool name"><input value={form.name} onChange={(event) => update("name", event.target.value)} placeholder="e.g. Find order" className={inputClass} /></Field>
+        <Field label="HTTP method"><select value={form.method} onChange={(event) => update("method", event.target.value)} className={inputClass}>{["GET", "POST", "PUT", "PATCH", "DELETE"].map((method) => <option key={method}>{method}</option>)}</select></Field>
+        <Field label="HTTPS endpoint" wide><input value={form.endpoint} onChange={(event) => update("endpoint", event.target.value)} placeholder="https://api.example.com/orders/lookup" className={inputClass} /></Field>
+        <Field label="Description for the agent" wide><textarea value={form.description} onChange={(event) => update("description", event.target.value)} placeholder="When and how should the agent use this action?" rows={2} className={inputClass} /></Field>
+        <Field label="Input JSON schema"><textarea value={form.inputSchema} onChange={(event) => update("inputSchema", event.target.value)} rows={7} className={`${inputClass} font-mono text-[10.5px]`} /></Field>
+        <Field label="Sample input for test"><textarea value={form.sampleInput} onChange={(event) => update("sampleInput", event.target.value)} rows={7} className={`${inputClass} font-mono text-[10.5px]`} /></Field>
+        <Field label="Additional headers (JSON)"><textarea value={form.headers} onChange={(event) => update("headers", event.target.value)} rows={3} className={`${inputClass} font-mono text-[10.5px]`} /></Field>
+        <Field label="Authentication"><div className="flex gap-2"><select value={form.secretHeader} onChange={(event) => update("secretHeader", event.target.value)} className={`${inputClass} w-36`}>{[["authorization", "Bearer"], ["x-api-key", "x-api-key"], ["x-auth-token", "x-auth-token"]].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><input type="password" value={form.secret} onChange={(event) => update("secret", event.target.value)} placeholder={editing?.hasSecret ? "Saved · enter to rotate" : "Optional credential"} className={inputClass} /></div></Field>
+      </div>
+      {error && <p role="alert" className="mt-3 text-xs text-red-300">{error}</p>}
+      {testResult && <div className="mt-3 rounded-lg border border-emerald-400/20 bg-emerald-400/5 p-3"><div className="text-[10.5px] font-semibold text-emerald-200">Test succeeded</div><pre className="mt-2 max-h-36 overflow-auto whitespace-pre-wrap text-[10px] text-[var(--color-text-secondary)]">{testResult}</pre></div>}
+      <div className="mt-4 flex flex-wrap items-center justify-end gap-2"><button disabled={busy || !editing} onClick={test} className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-border-subtle)] px-3 py-2 text-[10.5px] font-semibold text-[var(--color-text-secondary)] disabled:opacity-50"><Activity className="h-3.5 w-3.5" /> Test tool</button><button disabled={busy || !form.name || !form.endpoint || !form.description} onClick={save} className="inline-flex items-center gap-1.5 rounded-lg btn-gradient px-3.5 py-2 text-[10.5px] font-semibold text-white disabled:opacity-50">{busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Save tool</button></div>
+      <p className="mt-2 text-[9px] leading-4 text-[var(--color-text-muted)]">Tests send sample input to the endpoint and may trigger real side effects. Use safe data.</p>
+    </div>
+  </div>;
+}
+
+function Field({ label, wide, children }: { label: string; wide?: boolean; children: React.ReactNode }) {
+  return <label className={`block ${wide ? "md:col-span-2" : ""}`}><span className="mb-1 block text-[9.5px] font-bold uppercase tracking-wider text-[var(--color-text-muted)]">{label}</span>{children}</label>;
+}
diff --git a/app/api/admin/mcp-connections/route.ts b/app/api/admin/mcp-connections/route.ts
new file mode 100644
index 0000000..e905fce
--- /dev/null
+++ b/app/api/admin/mcp-connections/route.ts
@@ -0,0 +1,129 @@
+import { NextRequest, NextResponse } from "next/server";
+import { z } from "zod";
+import { createClient } from "../../../../lib/db/server";
+import { getTenantIdForUser } from "../../../../lib/db/agents";
+import { discoverMCPTools, makeFunctionName, validateMCPEndpoint, type MCPConnection } from "../../../../lib/mcp/client";
+import { encrypt } from "../../../../lib/util/crypto";
+import { dispatchMCPTool } from "../../../../lib/mcp/client";
+
+export const dynamic = "force-dynamic";
+export const runtime = "nodejs";
+
+const CreateSchema = z.object({
+  name: z.string().trim().min(1).max(80),
+  endpoint: z.string().url().max(500),
+  token: z.string().max(2000).optional(),
+  tokenHeader: z.enum(["authorization", "x-api-key", "x-auth-token"]).optional(),
+});
+
+async function auth() {
+  const db = await createClient();
+  const { data: { user } } = await db.auth.getUser();
+  if (!user) return { db, user: null, tenantId: null };
+  return { db, user, tenantId: await getTenantIdForUser(db, user.id) };
+}
+
+function publicConnection(row: MCPConnection) {
+  return {
+    id: row.id,
+    name: row.name,
+    endpoint: row.endpoint,
+    hasToken: !!row.encrypted_token,
+    protocolVersion: row.protocol_version ?? "2025-03-26",
+    status: row.status,
+    toolsCheckedAt: row.tools_checked_at,
+    lastError: (row as MCPConnection & { last_error?: string }).last_error ?? null,
+    tools: (row.tools ?? []).map((tool) => ({
+      id: makeFunctionName(row.id, tool.name),
+      name: tool.name,
+      description: tool.description ?? "",
+      inputSchema: tool.inputSchema ?? { type: "object", properties: {} },
+    })),
+  };
+}
+
+export async function GET() {
+  const { db, user, tenantId } = await auth();
+  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
+  if (!tenantId) return NextResponse.json({ connections: [] });
+  const { data, error } = await db.from("mcp_connections").select("*").eq("tenant_id", tenantId).order("created_at", { ascending: false });
+  if (error) return NextResponse.json({ error: "Could not load MCP connections." }, { status: 500 });
+  return NextResponse.json({ connections: (data ?? []).map((row) => publicConnection(row as MCPConnection)) });
+}
+
+export async function POST(request: NextRequest) {
+  const { db, user, tenantId } = await auth();
+  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
+  if (!tenantId) return NextResponse.json({ error: "No tenant found" }, { status: 404 });
+  const rawBody = await request.json().catch(() => null) as Record<string, unknown> | null;
+  const parsed = CreateSchema.safeParse(rawBody);
+  if (rawBody?.action === "test") {
+    const test = z.object({ action:z.literal("test"), id:z.string().uuid(), toolName:z.string().min(1).max(128), arguments:z.record(z.string(),z.unknown()).default({}) }).safeParse(rawBody);
+    if(!test.success)return NextResponse.json({error:"Invalid MCP test request."},{status:400});
+    const {data:connection,error}=await db.from("mcp_connections").select("*").eq("id",test.data.id).eq("tenant_id",tenantId).eq("status","active").single();
+    if(error||!connection)return NextResponse.json({error:"Active MCP connection not found."},{status:404});
+    if(!((connection.tools??[]) as Array<{name:string}>).some((tool)=>tool.name===test.data.toolName))return NextResponse.json({error:"Tool is not in the latest discovered catalog. Refresh tools first."},{status:400});
+    try {
+      const {makeFunctionName}=await import("../../../../lib/mcp/client");
+      const output=await dispatchMCPTool(makeFunctionName(test.data.id,test.data.toolName),test.data.arguments,user.id);
+      return NextResponse.json({success:true,output});
+    } catch(error) {return NextResponse.json({error:error instanceof Error?error.message:"MCP tool test failed."},{status:400});}
+  }
+  if (!parsed.success) return NextResponse.json({ error: "Invalid MCP connection", issues: parsed.error.issues }, { status: 400 });
+  if (parsed.data.token && !process.env.CREDENTIALS_ENCRYPTION_KEY) {
+    return NextResponse.json({ error: "Set CREDENTIALS_ENCRYPTION_KEY before saving MCP credentials." }, { status: 503 });
+  }
+  try {
+    await validateMCPEndpoint(parsed.data.endpoint);
+    const encryptedToken = parsed.data.token ? encrypt(parsed.data.token) : null;
+    const discovered = await discoverMCPTools({ endpoint: parsed.data.endpoint, encrypted_token: encryptedToken, token_header: parsed.data.tokenHeader ?? "authorization" });
+    const { data, error } = await db.from("mcp_connections").insert({
+      tenant_id: tenantId,
+      name: parsed.data.name,
+      endpoint: parsed.data.endpoint,
+      token_header: parsed.data.tokenHeader ?? "authorization",
+      encrypted_token: encryptedToken,
+      tools: discovered.tools,
+      protocol_version: discovered.protocolVersion,
+      tools_checked_at: new Date().toISOString(),
+      status: "active",
+      last_error: null,
+    }).select("*").single();
+    if (error || !data) throw new Error(error?.message ?? "Could not save MCP connection.");
+    return NextResponse.json({ connection: publicConnection(data as MCPConnection) }, { status: 201 });
+  } catch (error) {
+    const message = error instanceof Error ? error.message : "MCP connection failed.";
+    return NextResponse.json({ error: message }, { status: 400 });
+  }
+}
+
+export async function PATCH(request: NextRequest) {
+  const { db, user, tenantId } = await auth();
+  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
+  if (!tenantId) return NextResponse.json({ error: "No tenant found" }, { status: 404 });
+  const body = z.object({ id: z.string().uuid() }).safeParse(await request.json().catch(() => null));
+  if (!body.success) return NextResponse.json({ error: "Connection id is required." }, { status: 400 });
+  const { data: row, error } = await db.from("mcp_connections").select("*").eq("id", body.data.id).eq("tenant_id", tenantId).single();
+  if (error || !row) return NextResponse.json({ error: "Connection not found." }, { status: 404 });
+  try {
+    const discovered = await discoverMCPTools(row as MCPConnection);
+    const { data, error: updateError } = await db.from("mcp_connections").update({ tools: discovered.tools, protocol_version: discovered.protocolVersion, tools_checked_at: new Date().toISOString(), status: "active", last_error: null, updated_at: new Date().toISOString() }).eq("id", body.data.id).eq("tenant_id", tenantId).select("*").single();
+    if (updateError || !data) throw new Error(updateError?.message ?? "Could not refresh tools.");
+    return NextResponse.json({ connection: publicConnection(data as MCPConnection) });
+  } catch (error) {
+    const message = error instanceof Error ? error.message : "MCP refresh failed.";
+    await db.from("mcp_connections").update({ status: "error", last_error: message.slice(0, 500), updated_at: new Date().toISOString() }).eq("id", body.data.id).eq("tenant_id", tenantId);
+    return NextResponse.json({ error: message }, { status: 400 });
+  }
+}
+
+export async function DELETE(request: NextRequest) {
+  const { db, user, tenantId } = await auth();
+  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
+  if (!tenantId) return NextResponse.json({ error: "No tenant found" }, { status: 404 });
+  const id = request.nextUrl.searchParams.get("id");
+  if (!id || !z.string().uuid().safeParse(id).success) return NextResponse.json({ error: "Valid connection id is required." }, { status: 400 });
+  const { error } = await db.from("mcp_connections").delete().eq("id", id).eq("tenant_id", tenantId);
+  if (error) return NextResponse.json({ error: "Could not remove MCP connection." }, { status: 500 });
+  return NextResponse.json({ success: true });
+}
diff --git a/app/api/admin/tools/route.ts b/app/api/admin/tools/route.ts
new file mode 100644
index 0000000..dd566ad
--- /dev/null
+++ b/app/api/admin/tools/route.ts
@@ -0,0 +1,90 @@
+import { NextRequest, NextResponse } from "next/server";
+import { z } from "zod";
+import { createClient } from "../../../../lib/db/server";
+import { getTenantIdForUser } from "../../../../lib/db/agents";
+import { customToolDefinitions, executeCustomTool, type CustomToolRow } from "../../../../lib/tools/custom";
+import { encrypt } from "../../../../lib/util/crypto";
+import { APPOINTMENT_TOOLS, RESERVATION_TOOLS } from "../../../../lib/agent/tools";
+
+export const dynamic = "force-dynamic";
+export const runtime = "nodejs";
+
+const Schema = z.object({ type: z.literal("object"), properties: z.record(z.string(), z.object({ type: z.enum(["string","number","integer","boolean","array","object"]), description: z.string().max(300).optional() })).default({}), required: z.array(z.string()).max(40).default([]) }).refine((schema) => schema.required.every((key) => key in schema.properties), "Required inputs must exist in properties.");
+const Form = z.object({
+  id: z.string().uuid().optional(), name: z.string().trim().min(1).max(80), description: z.string().trim().min(1).max(500), endpoint: z.string().url().max(1200),
+  method: z.enum(["GET","POST","PUT","PATCH","DELETE"]), inputSchema: Schema, headers: z.record(z.string(), z.string().max(1000)).default({}), secret: z.string().max(4000).optional(), secretHeader: z.enum(["authorization","x-api-key","x-auth-token"]).optional(),
+});
+
+async function auth() {
+  const db = await createClient(); const { data: { user } } = await db.auth.getUser();
+  return { db, user, tenantId: user ? await getTenantIdForUser(db, user.id) : null };
+}
+function publicTool(row: CustomToolRow & Record<string, unknown>) {
+  return { id: row.id, functionName: `custom_${row.id.replaceAll("-", "").slice(0,24)}`, name: row.name, description: row.description, endpoint: row.endpoint, method: row.method, inputSchema: row.input_schema, hasSecret: !!row.encrypted_secret, status: row.status, lastTestedAt: row.last_tested_at, lastError: row.last_error };
+}
+function safeHeaders(headers: Record<string,string>) {
+  const entries = Object.entries(headers);
+  if (entries.length > 12) throw new Error("Use at most 12 custom headers.");
+  for (const [key,value] of entries) if (!/^[a-zA-Z0-9-]{1,64}$/.test(key) || /^(host|content-length|connection|transfer-encoding|authorization|cookie)$/i.test(key) || /[\r\n]/.test(value)) throw new Error(`Header “${key}” is not allowed.`);
+}
+
+export async function GET() {
+  const { db,user,tenantId } = await auth();
+  if (!user) return NextResponse.json({error:"Unauthorized"},{status:401});
+  if (!tenantId) return NextResponse.json({tools:[],mcpConnections:[],builtIns:[]});
+  const [{data:rows,error},{data:mcp}] = await Promise.all([
+    db.from("custom_tools").select("*").eq("tenant_id",tenantId).order("created_at",{ascending:false}),
+    db.from("mcp_connections").select("id,name,endpoint,status,tools,tools_checked_at,last_error").eq("tenant_id",tenantId).order("created_at",{ascending:false}),
+  ]);
+  if(error) return NextResponse.json({error:"Could not load tool registry. Apply migration_v34.sql."},{status:500});
+  const builtIns = [...APPOINTMENT_TOOLS.map((tool) => ({ ...tool, category: "Appointments" })), ...RESERVATION_TOOLS.map((tool) => ({ ...tool, category: "Reservations" }))].map((tool) => ({
+    id: tool.function.name,
+    name: tool.function.name.split("_").map((part) => part[0].toUpperCase() + part.slice(1)).join(" "),
+    category: tool.category,
+    description: tool.function.description,
+    inputSchema: tool.function.parameters,
+  }));
+  return NextResponse.json({tools:(rows??[]).map((r)=>publicTool(r as CustomToolRow & Record<string,unknown>)),mcpConnections:mcp??[],builtIns});
+}
+
+export async function POST(request: NextRequest) {
+  const {db,user,tenantId}=await auth(); if(!user)return NextResponse.json({error:"Unauthorized"},{status:401}); if(!tenantId)return NextResponse.json({error:"No tenant found"},{status:404});
+  const rawBody=await request.json().catch(()=>null) as (Record<string,unknown>&{sampleInput?:unknown})|null;
+  const parsed=Form.safeParse(rawBody); if(!parsed.success)return NextResponse.json({error:"Invalid custom tool configuration.",issues:parsed.error.issues},{status:400});
+  const body=parsed.data; const action=request.nextUrl.searchParams.get("action");
+  try {
+    safeHeaders(body.headers);
+    if(body.secret && !process.env.CREDENTIALS_ENCRYPTION_KEY) throw new Error("Set CREDENTIALS_ENCRYPTION_KEY before saving credentials.");
+    const update={tenant_id:tenantId,name:body.name,description:body.description,endpoint:body.endpoint,method:body.method,input_schema:body.inputSchema,headers:body.headers, ...(body.secret?{encrypted_secret:encrypt(body.secret),secret_header:body.secretHeader??"authorization"}:{})};
+    if(action==="test") {
+      if(!body.id) return NextResponse.json({error:"Save this tool before running a connection test."},{status:400});
+      const {data:row,error}=await db.from("custom_tools").select("*").eq("id",body.id).eq("tenant_id",tenantId).single();
+      if(error||!row)return NextResponse.json({error:"Tool not found."},{status:404});
+      const candidate={...(row as CustomToolRow),...update,encrypted_secret:body.secret?encrypt(body.secret):(row as CustomToolRow).encrypted_secret,secret_header:body.secretHeader??(row as CustomToolRow).secret_header};
+      const sampleInput=z.record(z.string(),z.unknown()).safeParse(rawBody?.sampleInput??{});
+      if(!sampleInput.success)return NextResponse.json({error:"Sample input must be a JSON object."},{status:400});
+      const output=await executeCustomTool(candidate, sampleInput.data);
+      await db.from("custom_tools").update({last_tested_at:new Date().toISOString(),last_error:null,status:"active"}).eq("id",body.id).eq("tenant_id",tenantId);
+      return NextResponse.json({success:true,output});
+    }
+    const query=body.id ? db.from("custom_tools").update({...update,updated_at:new Date().toISOString()}).eq("id",body.id).eq("tenant_id",tenantId).select("*").single() : db.from("custom_tools").insert(update).select("*").single();
+    const {data,error}=await query; if(error||!data) return NextResponse.json({error:"Could not save tool."},{status:500});
+    return NextResponse.json({tool:publicTool(data as CustomToolRow & Record<string,unknown>)},{status:body.id?200:201});
+  } catch(error) {
+    const message=error instanceof Error?error.message:"Tool operation failed.";
+    if(action==="test"&&body.id) await db.from("custom_tools").update({last_tested_at:new Date().toISOString(),last_error:message.slice(0,500)}).eq("id",body.id).eq("tenant_id",tenantId);
+    return NextResponse.json({error:message},{status:400});
+  }
+}
+
+export async function PATCH(request:NextRequest) {
+  const {db,user,tenantId}=await auth(); if(!user)return NextResponse.json({error:"Unauthorized"},{status:401}); if(!tenantId)return NextResponse.json({error:"No tenant found"},{status:404});
+  const parsed=z.object({id:z.string().uuid(),status:z.enum(["active","disabled"])}).safeParse(await request.json().catch(()=>null)); if(!parsed.success)return NextResponse.json({error:"Invalid tool update."},{status:400});
+  const {error}=await db.from("custom_tools").update({status:parsed.data.status,updated_at:new Date().toISOString()}).eq("id",parsed.data.id).eq("tenant_id",tenantId); if(error)return NextResponse.json({error:"Could not update tool."},{status:500}); return NextResponse.json({success:true});
+}
+
+export async function DELETE(request:NextRequest) {
+  const {db,user,tenantId}=await auth(); if(!user)return NextResponse.json({error:"Unauthorized"},{status:401}); if(!tenantId)return NextResponse.json({error:"No tenant found"},{status:404});
+  const id=request.nextUrl.searchParams.get("id"); if(!id||!z.string().uuid().safeParse(id).success)return NextResponse.json({error:"Valid tool id is required."},{status:400});
+  const {error}=await db.from("custom_tools").delete().eq("id",id).eq("tenant_id",tenantId); if(error)return NextResponse.json({error:"Could not remove tool."},{status:500}); return NextResponse.json({success:true});
+}
diff --git a/app/api/test-agent/stream/route.ts b/app/api/test-agent/stream/route.ts
new file mode 100644
index 0000000..2c120b6
--- /dev/null
+++ b/app/api/test-agent/stream/route.ts
@@ -0,0 +1,32 @@
+import { upgradeWebSocket } from "@vercel/functions";
+import { NextRequest } from "next/server";
+import { TestAgentStreamHandler } from "@/lib/testagent/stream-handler";
+import { DEMO } from "@/lib/bootstrap";
+
+export const runtime = "nodejs";
+export const dynamic = "force-dynamic";
+// Vercel Hobby plan hard cap — every Function (this WebSocket included) is
+// killed at 300s regardless of this value. A browser test call is expected
+// to be much shorter than a real phone call, so this is more headroom than
+// this route needs, but kept consistent with app/api/telephony/stream's
+// documented reasoning. See that file for what raising it requires.
+export const maxDuration = 300;
+
+/**
+ * Deployed-app equivalent of server.ts's standalone WebSocketServer, for
+ * the admin-only "Live Test Call" drawer (app/_components/TestAgentDrawer.tsx).
+ * Unlike the Twilio route (app/api/telephony/stream/route.ts), the caller's
+ * query params ARE available here — the browser constructs this URL
+ * directly (no Twilio relay in between), so there's no need for the
+ * Twilio route's "unknown, replaced once 'start' arrives" placeholder
+ * pattern.
+ */
+export function GET(req: NextRequest) {
+  const agentId = req.nextUrl.searchParams.get("agentId") || undefined;
+  const clientId = req.nextUrl.searchParams.get("clientId") || DEMO.clientId;
+  const patientId = req.nextUrl.searchParams.get("patientId") || undefined;
+
+  return upgradeWebSocket((ws) => {
+    new TestAgentStreamHandler({ ws, agentId, clientId, patientId });
+  });
+}
diff --git a/docs/agent-builder-architecture.md b/docs/agent-builder-architecture.md
new file mode 100644
index 0000000..edb6a1e
--- /dev/null
+++ b/docs/agent-builder-architecture.md
@@ -0,0 +1,62 @@
+# VOXERA agent builder: architecture review and upgrade plan
+
+Updated 6 November 2026
+
+## What exists today
+
+- The AI create flow captures the brief, call outcome, tone, language/provider, and enabled actions. The editor has persona, prompt, knowledge, built-in tools, and MCP connections.
+- Agent prompts and greetings are saved per agent. The call path resolves an agent's tenant, prompt, speech provider, and language.
+- Built-in appointment actions and selected MCP server tools are allowlisted per agent and dispatched by the LLM layer. MCP credentials are encrypted and tenant scoped.
+- Uploads are parsed, chunked, embedded, and stored in pgvector. Small and large knowledge sources are now retrieved only when factual/action cues are detected; obvious social turns skip client KB retrieval.
+- The telephony path accepts final STT transcripts, runs `handleTurn`, and streams LLM clauses to TTS. Logs report audio-to-final-transcript, final-transcript-to-first-text, and final-transcript-to-first-audio stages.
+- The current provider capabilities are not language universal: Deepgram is configured here for English, while Gnani is used for the supported Indian-language and code-mixed configurations.
+
+## Product and architecture direction
+
+Build an agent from a structured capability manifest, not from prose alone. The builder should first gather a short business brief, desired outcome, audience, language/provider, tone, allowed actions, and safety/escalation constraints. Ask follow-up questions only for consequential missing facts (for example, whether an appointment may be booked or only requested); otherwise make conservative assumptions visible in the draft. Generate persona, greeting, concise runtime instructions, tool policy, language behavior, knowledge policy, and test scenarios from that shared manifest.
+
+Keep capability configuration authoritative. The builder should read connected tools and knowledge status, pass those capabilities to generation, and validate them again when saving. Prompt text is descriptive; runtime allowlists and tool schemas enforce what the agent can do. Rebuild or lint the prompt whenever capabilities change, and show a warning if configured intent lacks an enabled action.
+
+### Target components
+
+1. **Agent specification** — versioned structured JSON for goal, persona, language policy, allowed intents, tool IDs, knowledge sources, confirmations, escalation, and success criteria. Keep generated prompt as a rendered artifact with spec and model version metadata.
+2. **Builder interview** — one to three adaptive questions selected from missing high-impact fields. Include a preview and let the user revise assumptions before saving.
+3. **Capability registry** — typed tool contracts with name, description, JSON schema, auth reference, timeout, retry policy, idempotency policy, and tenant scope. Start with internal appointment tools; add reusable HTTPS/webhook tools and MCP server connections as separately permissioned capabilities. Never expose secrets to the model. Require owner/admin approval and test the tool before enabling it.
+4. **Knowledge service** — per-tenant/per-agent source assignment, extraction status, chunking and embedding metadata, retrieval thresholds, citations, and versioning. Trigger retrieval only for factual business intents (or when the model explicitly requests the query tool); do not prepend the full KB to every call. Keep ingestion separate from per-call retrieval, cache embeddings/index lookups, and expose retrieval traces.
+5. **Voice runtime** — provider capability negotiation for language, locale, STT, TTS, code switching, streaming, interruption, and endpointing. Do not present unsupported language/provider combinations. Measure endpointing, STT final, LLM first token, first TTS audio, tool wait, and total caller-perceived latency independently.
+6. **Evaluation loop** — generate a compact scenario set from the agent spec (common intents, ambiguity, tool success/failure, unsupported request, interruption, language switching, and angry caller). Run offline and live-test calls; inspect tool correctness, grounded answers, turn latency, interruption recovery, and language naturalness before publishing.
+
+## Implementation sequence
+
+### Now: builder reliability and grounded drafting
+
+- Replace the single-input generation with the brief plus call outcome, tone, language/provider, enabled actions, and connected knowledge state.
+- Constrain prompt generation to enabled tool IDs and available provider capabilities. Treat uploaded material as business data, never as instructions to the generator.
+- Fail the build if attached files fail to upload/index; use the completed upload result in the same generation request.
+- Keep preview/edit/review before save.
+
+### Next: broader tool support and capability-aware prompt reconciliation
+
+- Add a tenant-scoped reusable tool registry and agent-to-tool assignments; persist schemas and secret references securely.
+- Implement a signed/allowlisted HTTP tool executor with schema validation, strict timeouts, idempotency for writes, audit logs, and tool-result summaries.
+- Extend MCP auth beyond bearer and API-key headers, add connection health UI, and evaluate more transports. Current integration supports HTTPS Streamable HTTP with public-host checks, response bounds, per-agent allowlists, and encrypted tokens.
+- Add prompt lint/reconciliation when tools or knowledge sources are connected, removed, or fail health checks.
+
+### Then: multilingual call quality and richer retrieval diagnostics
+
+- Improve the current multilingual intent cue gate with tenant-configurable intents or a calibrated classifier and source-tagged retrieval. Return short passages and abstain if relevance is weak.
+- Add retrieval probes for greetings/small talk to verify the KB is skipped, and factual questions to verify it is called.
+- Tune endpointing and interruption per STT provider and call environment. Deepgram documents endpointing as configurable silence duration (for example 300 ms); choose it using real call recordings and avoid cutting off code-mixed speech. Gnani final-transcript boundaries and supported language models should be measured independently.
+- Build a language/provider test matrix, especially English, Hindi, Hinglish, and each supported regional language, with noisy 8 kHz calls, names, numbers, and mid-call language changes.
+- Add per-stage latency telemetry and set budgets from production percentiles before changing model/retry behavior. Fast turn-taking is an end-to-end property; lowering endpoint delay alone cannot fix slow model or TTS startup.
+
+## Research notes
+
+- Vapi describes tool calls as model selection, runtime resolution/validation, execution, and returning results; its tools include function/API, handoff, transfer, and MCP options. Its latency guide separates transport, endpointing, transcription, model time-to-first-token, and first audio. This supports capability manifests and per-stage telemetry rather than a prompt-only solution. [Vapi tools](https://docs.vapi.ai/tools) · [Vapi latency](https://docs.vapi.ai/assistants/model-intelligence/understanding-latency)
+- ElevenLabs groups agent construction around system prompts, workflows/turn-taking, voice and language, knowledge, and tools/MCP. Its channel controls also frame response time as a budget across reasoning and tool calls. This supports keeping voice behavior, capabilities, and prompt generation as coordinated settings. [ElevenLabs build overview](https://elevenlabs.io/docs/eleven-agents/build/overview) · [Channel behavior](https://elevenlabs.io/docs/eleven-agents/customization/channel-behavior)
+- Deepgram's streaming docs expose endpointing in milliseconds and interim results; this is a tunable boundary, not a universal best value. [Deepgram endpointing](https://developers.deepgram.com/docs/understand-endpointing-interim-results)
+- Gnani's API documentation publishes its available STT/TTS, streaming, and language-specific interfaces. Use the configured product/model capability list as source of truth rather than claiming universal language coverage. [Gnani API docs](https://docs.gnani.ai/)
+
+## Current change in this branch
+
+The AI create form captures success outcome, desired tone, language/provider, and enabled actions. Prompt generation receives capability selections and attached business references. The Tools tab manages tenant MCP connections, discovers schemas, and selects per-agent capabilities. Prompt regeneration uses selected tools and current knowledge availability. The runtime skips obvious non-factual turns before client KB retrieval and logs response latency stages. Language coverage still depends on configured vendors; this work does not claim support beyond their available STT/TTS models.
diff --git a/docs/gnani-language-test-matrix.md b/docs/gnani-language-test-matrix.md
new file mode 100644
index 0000000..c3433ce
--- /dev/null
+++ b/docs/gnani-language-test-matrix.md
@@ -0,0 +1,27 @@
+# Gnani voice language verification
+
+Run the live synthetic round-trip matrix with a disposable Agent Builder agent:
+
+```sh
+node --env-file=.env.local --import tsx scripts/test-gnani-language-matrix.ts <agent-id>
+```
+
+The test temporarily updates only that agent's speech provider, language, and voice, then restores those three saved fields in a `finally` block. It requires `GNANI_API_KEY`, Supabase service credentials, a reachable local `server.ts` process, and an LLM provider key. To rerun selected locales after a transient provider failure, set `GNANI_LANGUAGE_FILTER=mr-IN,bn-IN` (comma-separated picker IDs).
+
+For each picker option, the script:
+
+1. Uses a synthetic phrase to request raw PCM speech from Gnani TTS.
+2. Opens the local realtime voice server with the selected agent and locale.
+3. Streams the generated caller audio through Gnani STT.
+4. Verifies that the response came from the selected agent and a live LLM, uses the expected script, and does not mix unrelated Indic or foreign writing systems.
+5. Keeps the socket open until the Gnani response audio has finished streaming and checks that the audio is non-empty.
+
+| Builder option | Gnani voice used in the matrix |
+|---|---|
+| Hindi, English, Tamil, Telugu, Kannada, Malayalam, Marathi, Punjabi, Bengali, Gujarati | Shivani · Timbre v3.0 |
+| Hinglish | Poorvi · Timbre v2.5 |
+| Auto-detect | Shivani · Timbre v3.0 |
+
+Timbre v3.0 supports Gnani's ten listed languages and its docs allow `auto` language detection; Hinglish uses the v2.5 voice listed for that mode. See [Gnani's available-voices documentation](https://docs.gnani.ai/api/TTS/available-voices) and [STT overview](https://docs.gnani.ai/api/STT/overview).
+
+This is an automated codec/provider/prompt-path check using generated audio. It does not replace native-speaker review of pronunciation, accent, prosody, or naturalness, nor a real microphone/phone-network test. Review those before claiming production-quality coverage for each locale.
diff --git a/docs/prebuilt-tool-integrations.md b/docs/prebuilt-tool-integrations.md
new file mode 100644
index 0000000..1a60e08
--- /dev/null
+++ b/docs/prebuilt-tool-integrations.md
@@ -0,0 +1,34 @@
+# Prebuilt tool integrations
+
+The admin Tools workspace has three kinds of capabilities:
+
+1. **Voxera built-ins** — the appointment and reservation tools shipped and executed by Voxera.
+2. **Provider-hosted MCP tools** — the provider owns the app authorization and service calls. Voxera stores the MCP endpoint and optional bearer/API key, discovers its tool schemas, lets admins test a selected action, and allows agents to opt into individual actions.
+3. **Custom HTTP tools** — a tenant-owned HTTPS endpoint with a saved JSON input schema and optional encrypted credential.
+
+The prebuilt app directory is an integration guide and setup shortcut. It does not claim an app is connected before credentials are configured. Vapi's documented first-party app integrations include Google Calendar, Google Sheets, Slack, GoHighLevel, and Make/n8n integration patterns. Its tools also support custom HTTP/function and MCP connections. For broad app coverage, Zapier MCP exposes provider-managed actions across thousands of apps; a compatible MCP provider performs OAuth and action execution. The discovered schemas and tools are the operational source of truth after connection.
+
+Voxera currently connects to public HTTPS MCP endpoints with no authentication or a static bearer/API-key header. It does not yet implement the MCP OAuth authorization flow or elicitation needed by OAuth-only MCP providers. Use a compatible gateway (for example, a Zapier MCP endpoint with its server URL/credential) or a custom HTTP tool until direct OAuth support is implemented.
+
+## Admin setup flow
+
+1. Open **Tools → Prebuilt apps** and choose the app.
+2. Follow its provider setup guide and choose a narrow set of actions.
+3. Open **Tools → MCP servers** and paste the provider's HTTPS MCP endpoint. Add a bearer/API key if that server uses one.
+4. Connect and discover. Refresh after changing the upstream action list.
+5. Use **Test tool** with safe sample arguments. A write action can change the external system.
+6. In **Agent Builder → Tools**, opt a specific agent into only the actions it needs, then regenerate its prompt so instructions match its capabilities.
+
+## Research references
+
+- Vapi integrations and connection patterns: https://docs.vapi.ai/tools/integrations
+- Vapi Google Calendar setup: https://docs.vapi.ai/tools/google-calendar
+- Vapi MCP setup and authentication: https://docs.vapi.ai/tools/mcp
+- Vapi reusable tool catalog and tool types: https://docs.vapi.ai/tools
+- Zapier MCP coverage and selected app actions: https://help.zapier.com/hc/en-us/articles/48308034391821-What-is-Zapier-MCP
+- Zapier's MCP app directory: https://zapier.com/apps/mcp-client-by-zapier/integrations
+- Composio MCP sessions and managed auth: https://docs.composio.dev/docs/sessions-via-mcp and https://docs.composio.dev/docs/authentication
+
+## Deployment
+
+Review and apply `sql/migration_v33.sql` for MCP connections and `sql/migration_v34.sql` for custom tools. Set `CREDENTIALS_ENCRYPTION_KEY` before saving credentials. Migration application and provider account authorization are deployment/account setup steps; application code does not silently authorize external accounts.
diff --git a/lib/agent/language-guard.ts b/lib/agent/language-guard.ts
new file mode 100644
index 0000000..643886c
--- /dev/null
+++ b/lib/agent/language-guard.ts
@@ -0,0 +1,60 @@
+const SCRIPT_RANGES: Array<{ name: string; pattern: RegExp }> = [
+  { name: "Devanagari", pattern: /[\u0900-\u097f]/g },
+  { name: "Bengali", pattern: /[\u0980-\u09ff]/g },
+  { name: "Gurmukhi", pattern: /[\u0a00-\u0a7f]/g },
+  { name: "Gujarati", pattern: /[\u0a80-\u0aff]/g },
+  { name: "Tamil", pattern: /[\u0b80-\u0bff]/g },
+  { name: "Telugu", pattern: /[\u0c00-\u0c7f]/g },
+  { name: "Kannada", pattern: /[\u0c80-\u0cff]/g },
+  { name: "Malayalam", pattern: /[\u0d00-\u0d7f]/g },
+  { name: "Arabic", pattern: /[\u0600-\u06ff]/g },
+  { name: "Cyrillic", pattern: /[\u0400-\u04ff]/g },
+  { name: "CJK", pattern: /[\u4e00-\u9fff]/g },
+];
+
+const LANGUAGE_SCRIPT: Record<string, string> = {
+  "hi-IN": "Devanagari", "mr-IN": "Devanagari", "ta-IN": "Tamil", "te-IN": "Telugu",
+  "kn-IN": "Kannada", "ml-IN": "Malayalam", "pa-IN": "Gurmukhi", "bn-IN": "Bengali", "gu-IN": "Gujarati",
+};
+
+function scriptCount(text: string, pattern: RegExp): number {
+  return [...text.matchAll(new RegExp(pattern.source, "g"))].length;
+}
+
+/** Remove accidental text in a different writing system while preserving the
+ * selected locale, Latin loanwords, names, punctuation, and caller-led
+ * language switches. This is a final speech-text safety net for multilingual
+ * models that occasionally splice one script into another. */
+export function guardReplyLanguage(
+  reply: string,
+  language?: string,
+  callerText?: string,
+): { text: string; changed: boolean } {
+  if (!language || language === "en-IN" || language === "en-US" || language === "en") {
+    return { text: reply, changed: false };
+  }
+
+  const callerScripts = SCRIPT_RANGES
+    .map(({ name, pattern }) => ({ name, count: scriptCount(callerText ?? "", pattern) }))
+    .filter((item) => item.count >= 3)
+    .sort((a, b) => b.count - a.count);
+  const allowed = new Set<string>();
+  const configured = LANGUAGE_SCRIPT[language];
+  if (configured) allowed.add(configured);
+  if (language === "hi-en") allowed.add("Devanagari");
+  if (language === "auto") {
+    if (callerScripts[0]) allowed.add(callerScripts[0].name);
+  } else if (callerScripts[0] && callerScripts[0].name !== configured) {
+    // Match a clear per-turn switch while retaining the configured language
+    // as a reasonable fallback for short/ambiguous caller turns.
+    allowed.add(callerScripts[0].name);
+  }
+  if (allowed.size === 0) return { text: reply, changed: false };
+
+  let text = reply;
+  for (const script of SCRIPT_RANGES) {
+    if (!allowed.has(script.name)) text = text.replace(script.pattern, "");
+  }
+  text = text.replace(/[ \t]{2,}/g, " ").replace(/\s+([,.;!?।])/g, "$1").replace(/([.!?।])(?=[!?])/g, "").trim();
+  return { text, changed: text !== reply };
+}
diff --git a/lib/knowledge/intent.ts b/lib/knowledge/intent.ts
new file mode 100644
index 0000000..04fb6d1
--- /dev/null
+++ b/lib/knowledge/intent.ts
@@ -0,0 +1,28 @@
+/** Conservative intent gate for the tenant knowledge index. All unmatched
+ * turns skip customer-document lookup; supported question/action cues turn
+ * it on. This keeps greetings, acknowledgements and social talk out of RAG
+ * while allowing factual queries in English, Hindi, Hinglish and common
+ * Indic-language forms to retrieve the same turn. */
+const KNOWLEDGE_CUES = [
+  /\?/, 
+  /\b(what|which|when|where|who|why|how|much|many|cost|price|fee|hours?|open|close|address|location|service|policy|coverage|eligible|available|appointment|book|cancel|reschedule|schedule|doctor|provider|refund|return|warranty|order|status|delivery|product|plan|offer|insurance|clinic|hospital|timing|rate|charge|bill|payment|procedure|medicine|medication|document|requirement|can i|do you|is there|tell me about)\b/i,
+  /(?:क्या|कौन|कब|कहाँ|कहां|क्यों|कैसे|कितना|कितनी|कितने|कीमत|दाम|समय|पता|उपलब्ध|अपॉइंटमेंट|डॉक्टर|बुक|रद्द|बदल|फीस|सेवा|नीति|क्लिनिक|अस्पताल)/,
+  /\b(kya|kaun|kab|kahan|kyun|kaise|kitna|kitni|kitne|price|paisa|daam|samay|pata|available|appointment|doctor|book|cancel|reschedule|fees|service|policy|clinic|hospital|timing)\b/i,
+  /(?:என்ன|எப்போது|எங்கே|எப்படி|எவ்வளவு|விலை|நேரம்|முகவரி|மருத்துவர்|சேவை|கட்டணம்|மருத்துவமனை)/,
+  /(?:ఏమి|ఎప్పుడు|ఎక్కడ|ఎలా|ఎంత|ధర|సమయం|చిరునామా|డాక్టర్|సేవ|ఫీజు|ఆసుపత్రి)/,
+  /(?:ಏನು|ಯಾವಾಗ|ಎಲ್ಲಿ|ಹೇಗೆ|ಎಷ್ಟು|ಬೆಲೆ|ಸಮಯ|ವಿಳಾಸ|ವೈದ್ಯ|ಸೇವೆ|ಶುಲ್ಕ|ಆಸ್ಪತ್ರೆ)/,
+  /(?:എന്ത്|എപ്പോൾ|എവിടെ|എങ്ങനെ|എത്ര|വില|സമയം|വിലാസം|ഡോക്ടർ|സേവനം|ഫീസ്|ആശുപത്രി)/,
+  /(?:काय|कधी|कुठे|कसे|किती|किंमत|वेळ|पत्ता|डॉक्टर|सेवा|शुल्क|रुग्णालय)/,
+  /(?:ਕੀ|ਕੌਣ|ਕਦੋਂ|ਕਿੱਥੇ|ਕਿਵੇਂ|ਕਿੰਨਾ|ਕੀਮਤ|ਸਮਾਂ|ਪਤਾ|ਡਾਕਟਰ|ਸੇਵਾ|ਫੀਸ|ਹਸਪਤਾਲ)/,
+  /(?:কি|কখন|কোথায়|কোথায়|কেন|কিভাবে|কত|দাম|সময়|ঠিকানা|ডাক্তার|সেবা|ফি|হাসপাতাল)/,
+  /(?:શું|ક્યારે|ક્યાં|કેવી|કેટલું|કિંમત|સમય|સરનામું|ડૉક્ટર|સેવા|ફી|હોસ્પિટલ)/,
+];
+
+const NON_KNOWLEDGE_SOCIAL = /^(?:(?:hi|hello|hey|good morning|good afternoon|good evening|how are you|i am (?:fine|good|great|okay)|i'm (?:fine|good|great|okay)|fine|good|great|okay|ok|yes|no|yeah|yep|nope|thanks|thank you|thank you so much|bye|goodbye|hmm|uh huh|right|got it|अच्छा|ठीक है|हाँ|हां|जी|नमस्ते|धन्यवाद|हैलो|சரி|வணக்கம்|అవును|సరే|ನಮಸ್ಕಾರ|ശരി|হ্যাঁ|ঠিক আছে|હા|બરાબર|ਹਾਂ|ਠੀਕ ਹੈ)[.!?\s,।]*|(?:ha|acha|theek hai|ji|haan|shukriya|namaste|seri|sari|sare|avunu|illa|dhanyavaad)[.!?\s,]*)$/i;
+
+export function shouldRetrieveClientKnowledge(transcript: string): boolean {
+  const text = transcript.trim();
+  if (!text) return false;
+  if (NON_KNOWLEDGE_SOCIAL.test(text)) return false;
+  return KNOWLEDGE_CUES.some((cue) => cue.test(text));
+}
diff --git a/lib/mcp/client.ts b/lib/mcp/client.ts
new file mode 100644
index 0000000..20d3b2e
--- /dev/null
+++ b/lib/mcp/client.ts
@@ -0,0 +1,267 @@
+import { lookup } from "node:dns/promises";
+import { isIP } from "node:net";
+import { request as httpsRequest } from "node:https";
+import { decrypt } from "../util/crypto";
+import { supabase } from "../db/supabase";
+import type { ToolDef } from "../agent/tools";
+
+export interface MCPConnection {
+  id: string;
+  tenant_id: string;
+  name: string;
+  endpoint: string;
+  token_header?: string | null;
+  encrypted_token: string | null;
+  tools: MCPRemoteTool[];
+  tools_checked_at: string | null;
+  protocol_version?: string | null;
+  status: "active" | "error";
+}
+
+export interface MCPRemoteTool {
+  name: string;
+  description?: string;
+  inputSchema?: Record<string, unknown>;
+}
+
+function normalizeSchema(schema: Record<string, unknown> | undefined, depth = 0): Record<string, unknown> {
+  if (!schema || depth > 6) return { type: "object", properties: {} };
+  const out: Record<string, unknown> = {};
+  const type = schema.type;
+  if (typeof type === "string" && ["object", "array", "string", "number", "integer", "boolean"].includes(type)) out.type = type;
+  if (typeof schema.description === "string") out.description = schema.description.slice(0, 300);
+  if (Array.isArray(schema.required)) out.required = schema.required.filter((v) => typeof v === "string").slice(0, 40);
+  if (Array.isArray(schema.enum)) out.enum = schema.enum.slice(0, 40);
+  if (typeof schema.additionalProperties === "boolean") out.additionalProperties = schema.additionalProperties;
+  for (const key of ["minimum", "maximum", "minLength", "maxLength", "minItems", "maxItems"] as const) {
+    if (typeof schema[key] === "number") out[key] = schema[key];
+  }
+  if (schema.properties && typeof schema.properties === "object" && !Array.isArray(schema.properties)) {
+    out.properties = Object.fromEntries(Object.entries(schema.properties as Record<string, unknown>).slice(0, 40).map(([key, value]) => [key.slice(0, 80), normalizeSchema(value as Record<string, unknown>, depth + 1)]));
+  }
+  if (schema.items && typeof schema.items === "object") out.items = normalizeSchema(schema.items as Record<string, unknown>, depth + 1);
+  return out.type ? out : { type: "object", properties: {} };
+}
+
+function validateArguments(schema: Record<string, unknown>, value: unknown, path = "arguments", depth = 0): void {
+  if (depth > 6) throw new Error("MCP tool arguments exceed the maximum nesting depth.");
+  const type = schema.type;
+  const valid = type === "object" ? !!value && typeof value === "object" && !Array.isArray(value)
+    : type === "array" ? Array.isArray(value)
+    : type === "integer" ? Number.isInteger(value)
+    : type === "number" ? typeof value === "number" && Number.isFinite(value)
+    : type === "boolean" ? typeof value === "boolean"
+    : type === "string" ? typeof value === "string"
+    : true;
+  if (!valid) throw new Error(`MCP argument '${path}' must be ${String(type)}.`);
+  if (Array.isArray(schema.enum) && !schema.enum.some((item) => item === value)) throw new Error(`MCP argument '${path}' is not an allowed value.`);
+  if (typeof value === "string") {
+    if (typeof schema.maxLength === "number" && value.length > schema.maxLength) throw new Error(`MCP argument '${path}' is too long.`);
+    if (typeof schema.minLength === "number" && value.length < schema.minLength) throw new Error(`MCP argument '${path}' is too short.`);
+  }
+  if (typeof value === "number") {
+    if (typeof schema.minimum === "number" && value < schema.minimum) throw new Error(`MCP argument '${path}' is below its minimum.`);
+    if (typeof schema.maximum === "number" && value > schema.maximum) throw new Error(`MCP argument '${path}' exceeds its maximum.`);
+  }
+  if (Array.isArray(value) && schema.items && typeof schema.items === "object") value.slice(0, 100).forEach((item, index) => validateArguments(schema.items as Record<string, unknown>, item, `${path}[${index}]`, depth + 1));
+  if (value && typeof value === "object" && !Array.isArray(value)) {
+    const props = (schema.properties && typeof schema.properties === "object" ? schema.properties : {}) as Record<string, Record<string, unknown>>;
+    for (const required of (Array.isArray(schema.required) ? schema.required : []) as string[]) {
+      if (!(required in value)) throw new Error(`MCP argument '${path}.${required}' is required.`);
+    }
+    if (schema.additionalProperties === false && Object.keys(value).some((key) => !(key in props))) throw new Error(`MCP tool received an unsupported argument at '${path}'.`);
+    for (const [key, item] of Object.entries(value)) if (props[key]) validateArguments(props[key], item, `${path}.${key}`, depth + 1);
+  }
+}
+
+const PROTOCOL_VERSION = "2025-03-26";
+const MODERN_PROTOCOL_VERSION = "2026-07-28";
+const TOOL_NAME_TO_REMOTE = new Map<string, { connectionId: string; remoteName: string }>();
+const AGENT_TOOLS_CACHE = new Map<string, { expiresAt: number; tools: ToolDef[] }>();
+
+class MCPRpcError extends Error {
+  constructor(message: string, readonly code?: number, readonly status?: number, readonly data?: unknown) { super(message); }
+}
+
+function isPublicAddress(address: string): boolean {
+  if (isIP(address) === 4) {
+    const [a, b] = address.split(".").map(Number);
+    return !(a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 0 || b === 168 || b === 88)) || (a === 198 && (b === 18 || b === 19 || b === 51)) || (a === 203 && b === 0) || a >= 224);
+  }
+  const normalized = address.toLowerCase();
+  if (normalized.startsWith("::ffff:")) return isPublicAddress(normalized.slice(7));
+  // Only global-unicast 2000::/3 is eligible. This rejects unspecified,
+  // loopback, unique-local, link-local, multicast, and other special ranges.
+  return /^[23]/.test(normalized) && !normalized.startsWith("2001:db8:");
+}
+
+export async function validateMCPEndpoint(endpoint: string): Promise<URL> {
+  let url: URL;
+  try { url = new URL(endpoint); } catch { throw new Error("Enter a valid MCP server URL."); }
+  if (url.protocol !== "https:" || url.username || url.password || url.hash || url.search) {
+    throw new Error("MCP servers must use an HTTPS URL without embedded credentials, query strings, or fragments.");
+  }
+  if (["localhost", "127.0.0.1", "::1"].includes(url.hostname) || /\.(local|internal|localhost)$/.test(url.hostname)) {
+    throw new Error("Local and private network MCP servers are not allowed.");
+  }
+  if (isIP(url.hostname)) {
+    if (!isPublicAddress(url.hostname)) throw new Error("Private network MCP servers are not allowed.");
+  } else {
+    const addresses = await lookup(url.hostname, { all: true, verbatim: true });
+    if (!addresses.length || addresses.some((item) => !isPublicAddress(item.address))) {
+      throw new Error("MCP server host must resolve only to public IP addresses.");
+    }
+  }
+  return url;
+}
+
+async function rpc(connection: Pick<MCPConnection, "endpoint" | "encrypted_token" | "token_header">, method: string, params?: unknown, sessionId?: string, protocolVersion?: string) {
+  const url = await validateMCPEndpoint(connection.endpoint);
+  const headers: Record<string, string> = { "content-type": "application/json", accept: "application/json, text/event-stream" };
+  if (connection.encrypted_token) {
+    const token = decrypt(connection.encrypted_token);
+    headers[connection.token_header ?? "authorization"] = (connection.token_header ?? "authorization") === "authorization" ? `Bearer ${token}` : token;
+  }
+  if (sessionId) headers["mcp-session-id"] = sessionId;
+  if (protocolVersion?.startsWith("2026-")) {
+    headers["mcp-protocol-version"] = protocolVersion;
+    headers["mcp-method"] = method;
+    if (method === "tools/call" && params && typeof params === "object" && "name" in params) headers["mcp-name"] = String((params as { name: string }).name);
+  }
+  const addresses = isIP(url.hostname) ? [{ address: url.hostname, family: isIP(url.hostname) }] : await lookup(url.hostname, { all: true, verbatim: true });
+  if (!addresses.length || addresses.some((item) => !isPublicAddress(item.address))) throw new Error("MCP server host must resolve only to public IP addresses.");
+  const pinnedAddress = isIP(url.hostname)
+    ? { address: url.hostname, family: isIP(url.hostname) }
+    : addresses[0];
+  if (!pinnedAddress) throw new Error("MCP server host did not resolve to a public IP address.");
+  const withMeta = protocolVersion?.startsWith("2026-") && params && typeof params === "object"
+    ? { ...(params as Record<string, unknown>), _meta: { "io.modelcontextprotocol/protocolVersion": protocolVersion, "io.modelcontextprotocol/clientInfo": { name: "voxera-agent-builder", version: "1.0.0" }, "io.modelcontextprotocol/clientCapabilities": {} } }
+    : protocolVersion?.startsWith("2026-") ? { _meta: { "io.modelcontextprotocol/protocolVersion": protocolVersion, "io.modelcontextprotocol/clientInfo": { name: "voxera-agent-builder", version: "1.0.0" }, "io.modelcontextprotocol/clientCapabilities": {} } } : params;
+  const body = JSON.stringify({ jsonrpc: "2.0", ...(method.startsWith("notifications/") ? {} : { id: Date.now() }), method, ...(withMeta === undefined ? {} : { params: withMeta }) });
+  const response = await new Promise<{ status: number; headers: Record<string, string | string[] | undefined>; body: string }>((resolve, reject) => {
+    const req = httpsRequest({
+      protocol: "https:", hostname: url.hostname, port: url.port || 443, path: `${url.pathname}${url.search}`,
+      method: "POST", headers: { ...headers, "content-length": Buffer.byteLength(body) }, servername: isIP(url.hostname) ? undefined : url.hostname,
+      lookup: ((_hostname: string, options: { all?: boolean }, callback: (...args: unknown[]) => void) => {
+        if (options?.all) callback(null, [{ address: pinnedAddress.address, family: pinnedAddress.family }]);
+        else callback(null, pinnedAddress.address, pinnedAddress.family);
+      }) as any,
+    }, (res) => {
+      const chunks: Buffer[] = []; let bytes = 0;
+      res.on("data", (chunk: Buffer) => { bytes += chunk.length; if (bytes > 1_000_000) req.destroy(new Error("MCP response exceeds 1 MB.")); else chunks.push(chunk); });
+      res.on("end", () => resolve({ status: res.statusCode ?? 500, headers: res.headers as Record<string, string | string[] | undefined>, body: Buffer.concat(chunks).toString("utf8") }));
+      res.on("error", reject);
+    });
+    req.setTimeout(7000, () => req.destroy(new Error("MCP server timed out.")));
+    req.on("error", reject);
+    req.end(body);
+  });
+  const nextSessionId = (response.headers["mcp-session-id"] as string | undefined) ?? sessionId;
+  const contentType = (response.headers["content-type"] as string | undefined) ?? "";
+  const raw = response.body;
+  if (!raw) {
+    if (response.status < 200 || response.status >= 300) throw new MCPRpcError(`MCP server returned HTTP ${response.status}.`, undefined, response.status);
+    return { result: null, sessionId: nextSessionId };
+  }
+  let payload: any;
+  if (contentType.includes("text/event-stream")) {
+    const data = raw.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).filter(Boolean).at(-1);
+    payload = data ? JSON.parse(data) : null;
+  } else {
+    payload = JSON.parse(raw);
+  }
+  if (payload?.error) throw new MCPRpcError(payload.error.message || "MCP request failed.", payload.error.code, response.status, payload.error.data);
+  if (response.status < 200 || response.status >= 300) throw new MCPRpcError(`MCP server returned HTTP ${response.status}.`, undefined, response.status);
+  return { result: payload?.result ?? null, sessionId: nextSessionId };
+}
+
+export async function discoverMCPTools(connection: Pick<MCPConnection, "endpoint" | "encrypted_token" | "token_header">): Promise<{ tools: MCPRemoteTool[]; protocolVersion: string }> {
+  try {
+    const discovery = await rpc(connection, "server/discover", {}, undefined, MODERN_PROTOCOL_VERSION);
+    const supported = discovery.result?.supportedVersions as string[] | undefined;
+    const selectedVersion = supported?.includes(MODERN_PROTOCOL_VERSION) ? MODERN_PROTOCOL_VERSION : undefined;
+    if (selectedVersion) {
+      const list = await rpc(connection, "tools/list", {}, undefined, selectedVersion);
+      const tools = list.result?.tools as MCPRemoteTool[];
+      if (!Array.isArray(tools) || tools.length > 60) throw new Error("MCP server returned an invalid or oversized tool list.");
+      return { tools: tools.filter((tool) => typeof tool.name === "string" && /^[\w.-]{1,128}$/.test(tool.name)), protocolVersion: selectedVersion };
+    }
+  } catch (error) {
+    // An empty/non-MCP response means a legacy server; recognized modern
+    // protocol errors remain visible because they indicate a real mismatch.
+    if (error instanceof MCPRpcError && error.code === -32022) {
+      const supported = (error.data as { supported?: string[] } | undefined)?.supported;
+      if (supported?.includes(MODERN_PROTOCOL_VERSION)) throw error;
+    }
+  }
+  const init = await rpc(connection, "initialize", {
+    protocolVersion: PROTOCOL_VERSION,
+    capabilities: {},
+    clientInfo: { name: "voxera-agent-builder", version: "1.0.0" },
+  });
+  const negotiatedVersion = typeof init.result?.protocolVersion === "string" ? init.result.protocolVersion : PROTOCOL_VERSION;
+  await rpc(connection, "notifications/initialized", undefined, init.sessionId ?? undefined).catch(() => undefined);
+  const list = await rpc(connection, "tools/list", {}, init.sessionId ?? undefined);
+  const tools = (list.result?.tools ?? []) as MCPRemoteTool[];
+  if (!Array.isArray(tools) || tools.length > 60) throw new Error("MCP server returned an invalid or oversized tool list. Limit a connection to 60 tools.");
+  return { tools: tools.filter((tool) => typeof tool.name === "string" && /^[\w.-]{1,128}$/.test(tool.name)), protocolVersion: negotiatedVersion };
+}
+
+export function makeFunctionName(connectionId: string, remoteName: string): string {
+  const compactId = connectionId.replaceAll("-", "").slice(0, 8);
+  const safeName = remoteName.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 42);
+  const digest = Buffer.from(remoteName).toString("base64url").slice(0, 7);
+  const functionName = `mcp_${compactId}_${safeName}_${digest}`.slice(0, 64);
+  TOOL_NAME_TO_REMOTE.set(functionName, { connectionId, remoteName });
+  return functionName;
+}
+
+export async function getMCPToolsForAgent(clientId: string, enabledTools: string[]): Promise<ToolDef[]> {
+  const ids = enabledTools.filter((id) => id.startsWith("mcp_"));
+  if (!ids.length) return [];
+  const cacheKey = `${clientId}:${ids.slice().sort().join(",")}`;
+  const cached = AGENT_TOOLS_CACHE.get(cacheKey);
+  if (cached && cached.expiresAt > Date.now()) return cached.tools;
+  const { data: tenant } = await supabase.from("tenants").select("id").eq("auth_user_id", clientId).single();
+  if (!tenant) return [];
+  const { data: rows, error } = await supabase.from("mcp_connections").select("*").eq("tenant_id", tenant.id).eq("status", "active");
+  if (error || !rows) return [];
+  const definitions: ToolDef[] = [];
+  for (const row of rows as MCPConnection[]) {
+    for (const remote of row.tools ?? []) {
+      const name = makeFunctionName(row.id, remote.name);
+      if (!ids.includes(name)) continue;
+      definitions.push({ type: "function", function: {
+        name,
+        description: `[MCP: ${row.name}] ${(remote.description || remote.name).slice(0, 800)}`,
+        parameters: normalizeSchema(remote.inputSchema),
+      } });
+    }
+  }
+  AGENT_TOOLS_CACHE.set(cacheKey, { tools: definitions, expiresAt: Date.now() + 30_000 });
+  return definitions;
+}
+
+export async function dispatchMCPTool(functionName: string, args: Record<string, unknown>, clientId: string): Promise<string> {
+  const mapping = TOOL_NAME_TO_REMOTE.get(functionName);
+  if (!mapping) throw new Error("MCP tool is no longer available; refresh the agent's tools.");
+  const { data: tenant } = await supabase.from("tenants").select("id").eq("auth_user_id", clientId).single();
+  if (!tenant) throw new Error("Tenant not found.");
+  const { data: row } = await supabase.from("mcp_connections").select("*").eq("id", mapping.connectionId).eq("tenant_id", tenant.id).eq("status", "active").single();
+  if (!row) throw new Error("MCP connection is unavailable.");
+  const connection = row as MCPConnection;
+  const remoteTool = (connection.tools ?? []).find((tool) => tool.name === mapping.remoteName);
+  if (!remoteTool) throw new Error("MCP tool is not enabled on this connection.");
+  validateArguments(normalizeSchema(remoteTool.inputSchema), args);
+  let sessionId: string | undefined;
+  const protocolVersion = connection.protocol_version ?? PROTOCOL_VERSION;
+  if (!protocolVersion.startsWith("2026-")) {
+    const init = await rpc(connection, "initialize", { protocolVersion, capabilities: {}, clientInfo: { name: "voxera-agent-builder", version: "1.0.0" } });
+    sessionId = init.sessionId ?? undefined;
+    await rpc(connection, "notifications/initialized", undefined, sessionId).catch(() => undefined);
+  }
+  const call = await rpc(connection, "tools/call", { name: mapping.remoteName, arguments: args }, sessionId, protocolVersion.startsWith("2026-") ? protocolVersion : undefined);
+  const content = call.result?.content;
+  if (Array.isArray(content)) return content.map((item: any) => item.text ?? JSON.stringify(item)).join("\n").slice(0, 8000);
+  return JSON.stringify(call.result ?? { ok: true }).slice(0, 8000);
+}
diff --git a/lib/testagent/stream-handler.ts b/lib/testagent/stream-handler.ts
new file mode 100644
index 0000000..2de0eb1
--- /dev/null
+++ b/lib/testagent/stream-handler.ts
@@ -0,0 +1,563 @@
+import type { WebSocket } from "ws";
+import { nanoid } from "nanoid";
+import { announceGreeting, handleTurn } from "../agent/orchestrator";
+import { synthesize, resolveVoiceModel, getClientVoiceSettings } from "../deepgram/tts";
+import { applyEmotionProsody, getEmotionTTSParams, type TTSProsodyParams } from "../emotion/tts-params";
+import { getAgentWithTenant } from "../db/agents";
+import { supabase } from "../db/supabase";
+import { createLiveStt, createSpeakStream } from "../speech/factory";
+import { resolveSpeechConfig } from "../speech/resolve";
+import { parseGnaniPersona } from "../tts/gnani-voices";
+import type { LiveSttConnection, SpeakStreamHandle, SpeechProvider } from "../speech/types";
+import { extractAcousticFeatures, computeRmsEnergy, isolateLastUtterance } from "../audio/acoustic";
+import { int16ToFloat32Pcm } from "../emotion/local-audio-detect";
+import { DEMO, ensureSeeded } from "../bootstrap";
+import { CONFIG } from "../config";
+
+// Sample rate for browser TTS playback. Not constrained by Twilio's 8kHz
+// requirement (unlike lib/telephony/stream-handler.ts) — the browser's Web
+// Audio API resamples an AudioBuffer at any declared rate transparently, so
+// this is just "what quality does Deepgram render at," picked for clarity
+// over telephony-grade compression.
+const BROWSER_TTS_SAMPLE_RATE = 24000;
+
+/**
+ * The browser mic streams 16kHz linear16 PCM, but lib/audio/acoustic.ts's
+ * feature extraction (pitch lag range, frame sizes) is tuned for Twilio's
+ * 8kHz telephony audio — the same DSP real calls use. Downsample 2:1 rather
+ * than re-parametrizing that module, so the acoustic engine itself stays
+ * exactly what real calls exercise (and keeps its existing test suite valid).
+ */
+function downsample16kTo8k(pcm: Buffer): Buffer {
+  const inSamples = Math.floor(pcm.length / 2);
+  const outSamples = Math.floor(inSamples / 2);
+  const out = Buffer.alloc(outSamples * 2);
+  for (let i = 0; i < outSamples; i++) {
+    out.writeInt16LE(pcm.readInt16LE(i * 4), i * 2);
+  }
+  return out;
+}
+
+export interface TestAgentStreamHandlerOptions {
+  ws: WebSocket;
+  /** Optional Agent Builder agent id — lets the live test drawer test
+   * against a specific custom agent instead of always the hardcoded demo
+   * agent. Resolved inside handleTurn (lib/agent/orchestrator.ts), which
+   * also overrides clientId from the agent's tenant when agentId is valid. */
+  agentId?: string;
+  /** Tenant auth_user_id, for direct tenant testing without a specific
+   * agent. Defaults to the seeded demo tenant. */
+  clientId: string;
+  /** Roster patient (lib/db/patients.ts) id — lets the test drawer verify
+   * appointment-booking tools end to end; those tools refuse to act
+   * without either a patientId or a real caller phone number, and a
+   * browser test call has neither by default. */
+  patientId?: string;
+}
+
+/**
+ * Handles one browser "Live Test Call" WebSocket connection — the
+ * admin-only agent test drawer (app/_components/TestAgentDrawer.tsx), not
+ * a real Twilio phone call (see lib/telephony/stream-handler.ts for that).
+ *
+ * Extracted from server.ts's original inline `wss.on("connection", ...)`
+ * closure (same per-connection shape lib/telephony/stream-handler.ts
+ * already uses) so this logic can be driven from two different hosts:
+ *  - server.ts: a standalone `ws` WebSocketServer for local dev
+ *    (`npm run server` / `npm run dev:full`).
+ *  - app/api/test-agent/stream/route.ts: a Vercel Function using
+ *    `upgradeWebSocket`, for the deployed app.
+ */
+export class TestAgentStreamHandler {
+  private ws: WebSocket;
+  private agentId?: string;
+  private clientId: string;
+  private patientId?: string;
+  private sessionId: string;
+
+  private isBusy = false; // prevent overlapping turns while a reply is being generated
+  // Tracks whether TTS audio is currently being sent — used by the
+  // server-side RMS barge-in fallback below. Previously this path had no
+  // server-side barge-in detection at all, relying entirely on the browser's
+  // client-side VAD sending a "barge_in" message; this is a safety net for
+  // when that's slow, missing, or the client-side VAD fails.
+  private isSpeaking = false;
+
+  // Bumped on every user-initiated barge-in. A reply that started synthesizing
+  // before the bump is stale by the time it resolves — drop it instead of
+  // playing audio over what the user is now saying. Same generation-counter
+  // pattern as lib/telephony/stream-handler.ts.
+  private generation = 0;
+  private turnAudioChunks: Buffer[] = [];
+  // Manual acoustic-engine calibration knob (-1..1, default 0), set via the
+  // "set_sensitivity_bias" control message — see detectAudioEmotion()'s
+  // opts doc in lib/emotion/audio-emotion.ts. Persists for this connection.
+  private sensitivityBias = 0;
+
+  // Cancels the in-flight LLM generation for the current turn on barge-in.
+  private currentAbortController: AbortController | null = null;
+  // ONE Speak connection reused for the whole session (see
+  // ensureSpeakStream() below for the same pattern and its rationale — a
+  // fresh handshake per turn measured 900ms-5.3s live).
+  private currentSpeakStream: SpeakStreamHandle | null = null;
+  private speakStreamReadyPromise: Promise<void> | null = null;
+  private voiceModel: string = CONFIG.deepgram.ttsModel;
+  private useBufferedTts = false;
+  // Resolved in voiceSetupPromise, mirroring lib/telephony/
+  // stream-handler.ts's setupVoiceForCall() exactly — without this, every
+  // browser test call spoke Deepgram/English regardless of the agent's own
+  // speech_provider/language (Gnani) setting.
+  private speechProvider: SpeechProvider = "deepgram";
+  private language: string = "en-IN";
+  private gnaniVoice: string = "Nalini";
+  private gnaniModel: string = "timbre-v2.5";
+  // Agent Builder's "greeting" field — spoken once, proactively, as soon as
+  // voice setup resolves, instead of the agent only ever responding once
+  // the user speaks first.
+  private greeting: string | null = null;
+
+  private stt: LiveSttConnection;
+  private sttConnectPromise: Promise<void>;
+  private voiceSetupPromise: Promise<void>;
+
+  // Diagnostic: confirm audio frames are actually arriving from the browser,
+  // and that the STT provider's internal state is "connected" when we try
+  // to forward them (sendAudio silently drops frames otherwise).
+  private audioChunkCount = 0;
+  private audioByteCount = 0;
+
+  constructor(opts: TestAgentStreamHandlerOptions) {
+    this.ws = opts.ws;
+    this.agentId = opts.agentId;
+    this.clientId = opts.clientId || DEMO.clientId;
+    this.patientId = opts.patientId;
+    this.sessionId = `browser-${nanoid(12)}`;
+
+    console.log(`\n[TestAgentStream] New client connected. clientId=${this.clientId} agentId=${this.agentId ?? "(none)"} patientId=${this.patientId ?? "(none)"}`);
+
+    // Eagerly opens the DEFAULT (Deepgram) STT connection — the real
+    // provider/language isn't known until voiceSetupPromise resolves (needs
+    // clientId/agentId, see below). This preserves the "don't lose early
+    // audio" latency optimization for the common (Deepgram) case;
+    // voiceSetupPromise tears this down and reopens with the resolved
+    // provider only when it actually differs — same pattern as
+    // lib/telephony/stream-handler.ts's constructor/setupVoiceForCall().
+    this.stt = createLiveStt("deepgram", { sampleRate: 16000, language: "en-IN", onTranscript: this.onSttTranscript });
+    // Kicked off immediately (not awaited yet) so it's already in flight by
+    // the time voiceSetupPromise might need to swap providers — ws's
+    // WebSocket throws/emits an error ("WebSocket was closed before the
+    // connection was established") if .close() is called on a socket that's
+    // still mid-handshake, which an unhandled rejection on this promise would
+    // otherwise crash the whole process over (live-reproduced: resolveSpeech-
+    // Config resolving to Gnani before Deepgram's real network handshake to
+    // api.deepgram.com finished). The Gnani-swap branch below awaits this
+    // first (swallowing any failure, since it's discarding the connection
+    // either way) so close() is never called on a not-yet-open socket.
+    this.sttConnectPromise = this.stt.connect();
+
+    // Register every ws event handler in this same synchronous tick, before
+    // awaiting anything — Node's EventEmitter drops events fired before a
+    // listener is attached, and a real client starts sending audio the
+    // instant the socket opens; if ensureSeeded()/sttConnectPromise were
+    // awaited first, any audio sent during that window — a real network
+    // round trip, not instant — would be silently lost. The STT provider's
+    // sendAudio() already buffers audio while its state is "connecting", so
+    // it's safe to start receiving before connect() resolves.
+    this.ws.on("message", (message: Buffer, isBinary: boolean) => this.onMessage(message, isBinary));
+    this.ws.on("close", (code: number, reason: Buffer) => this.onClose(code, reason));
+    this.ws.on("error", (err: Error) => this.onError(err));
+
+    // Resolved once per connection (agent voice persona / tenant ElevenLabs
+    // override / speech provider+language / greeting), same rationale as
+    // stream-handler.ts's setupVoiceForCall() — avoids a per-turn DB round
+    // trip, and kicked off here (not awaited yet) so it overlaps with
+    // ensureSeeded()/STT connect below.
+    this.voiceSetupPromise = this.setupVoice();
+
+    this.init().catch((err) => {
+      console.error("[TestAgentStream] Failed to connect to Deepgram:", err);
+      this.ws.send(JSON.stringify({ type: "error", message: "Failed to initialize STT" }));
+      this.ws.close();
+    });
+  }
+
+  // Now that every handler above is attached and the default STT provider
+  // is already connecting, it's safe to await the slower setup steps.
+  private async init(): Promise<void> {
+    await ensureSeeded();
+    await this.sttConnectPromise;
+    this.ws.send(JSON.stringify({ type: "system", message: "Connected to STT engine", clientId: this.clientId }));
+  }
+
+  private ensureSpeakStream(): { stream: SpeakStreamHandle; ready: Promise<void> } {
+    if (!this.currentSpeakStream) {
+      const stream = createSpeakStream(
+        this.speechProvider,
+        {
+          sampleRate: BROWSER_TTS_SAMPLE_RATE,
+          language: this.language,
+          voice: this.speechProvider === "gnani" ? this.gnaniVoice : this.voiceModel,
+          gnaniModel: this.gnaniModel,
+        },
+        () => {} // rebound per-turn via setAudioHandler before first use
+      );
+      this.currentSpeakStream = stream;
+      this.speakStreamReadyPromise = stream.connect().catch((err) => {
+        console.error(`[TestAgentStream] Speak stream connect failed for ${this.sessionId}:`, err);
+        this.currentSpeakStream = null;
+        this.speakStreamReadyPromise = null;
+      });
+    }
+    return { stream: this.currentSpeakStream, ready: this.speakStreamReadyPromise! };
+  }
+
+  // Shared barge-in trigger — invoked either by the client's own VAD
+  // sending {type:"barge_in"}, or by the server-side RMS fallback below.
+  // Mirrors lib/telephony/stream-handler.ts's triggerBargeIn().
+  private triggerBargeIn(reason: string): void {
+    this.generation++;
+    this.isBusy = false;
+    this.isSpeaking = false;
+    this.turnAudioChunks = [];
+    this.currentAbortController?.abort();
+    // clear() only, not close() — the connection stays open for the next
+    // turn (see ensureSpeakStream()).
+    this.currentSpeakStream?.clear();
+    console.log(`[TestAgentStream] Barge-in (${reason}) — generation now ${this.generation}.`);
+  }
+
+  // STT message handler — provider-agnostic, shared by whichever
+  // LiveSttConnection `stt` currently points at.
+  private onSttTranscript = (text: string, isFinal: boolean): void => {
+    // Diagnostic: log every transcript the provider produces, not just
+    // finals, so we can tell "STT is receiving audio but never finalizing"
+    // apart from "no audio is reaching STT at all."
+    console.log(`[STT ${isFinal ? "FINAL" : "interim"}] "${text}"`);
+
+    this.ws.send(JSON.stringify({ type: isFinal ? "transcript_final" : "transcript_interim", text }));
+
+    if (isFinal) {
+      void this.onFinalTranscript(text);
+    }
+  };
+
+  /**
+   * Speaks the agent's configured opening line (Agent Builder's `greeting`
+   * field) the moment voice setup resolves, instead of the agent only ever
+   * responding once the user speaks first. Sends the same reply_text/
+   * reply_audio(_chunk) message shapes a normal turn would, tagged with
+   * their own turnId, so it shows up in the test drawer's transcript too.
+   */
+  private async speakGreeting(text: string): Promise<void> {
+    void announceGreeting({ sessionId: this.sessionId, userId: DEMO.userId, clientId: this.clientId, text });
+    const turnId = nanoid(8);
+    this.ws.send(JSON.stringify({ type: "reply_text", turnId, text }));
+
+    if (this.useBufferedTts) {
+      const audio = await synthesize(text, { clientId: this.clientId });
+      this.ws.send(JSON.stringify({ type: "reply_audio", turnId, ttsMs: 0, audio: Buffer.from(audio).toString("base64"), mime: "audio/mpeg" }));
+      return;
+    }
+
+    const myGeneration = this.generation;
+    const { stream: speakStream, ready: speakStreamReady } = this.ensureSpeakStream();
+    speakStream.setAudioHandler((audioChunk) => {
+      if (myGeneration !== this.generation) return; // barge-in happened mid-greeting
+      this.isSpeaking = true;
+      this.ws.send(JSON.stringify({ type: "reply_audio_chunk", turnId, audio: audioChunk.toString("base64"), sampleRate: BROWSER_TTS_SAMPLE_RATE }));
+    });
+    await speakStreamReady;
+    if (myGeneration !== this.generation) return;
+    speakStream.sendText(text);
+    speakStream.flush();
+  }
+
+  private async setupVoice(): Promise<void> {
+    try {
+      const [agentInfo, voiceSettings] = await Promise.all([
+        this.agentId ? getAgentWithTenant(supabase, this.agentId).catch(() => null) : Promise.resolve(null),
+        getClientVoiceSettings(this.clientId).catch(() => null),
+      ]);
+      if (agentInfo?.voice_persona) {
+        this.voiceModel = resolveVoiceModel(agentInfo.voice_persona);
+      }
+      this.greeting = agentInfo?.greeting ?? null;
+
+      if (voiceSettings?.provider === "elevenlabs" && voiceSettings.voiceId) {
+        // Neither streaming Speak WS (Deepgram or Gnani) covers a tenant's
+        // custom cloned ElevenLabs voice — fall back to the original
+        // buffered synth-then-send path for this session only.
+        this.useBufferedTts = true;
+      } else {
+        const speechConfig = await resolveSpeechConfig(this.clientId, this.agentId, agentInfo);
+        this.speechProvider = speechConfig.provider;
+        this.language = speechConfig.language;
+
+        if (this.speechProvider === "gnani") {
+          // Agent's own voice_persona wins; falls back to the tenant's
+          // business_settings.voice_persona (resolveSpeechConfig already
+          // carried that through), then to the DEFAULT_GNANI_VOICE default.
+          const gnani = parseGnaniPersona(agentInfo?.voice_persona ?? speechConfig.voicePersona);
+          this.gnaniVoice = gnani.id;
+          this.gnaniModel = gnani.model;
+
+          // The eagerly-opened default (Deepgram) STT connection above was
+          // already started before this resolved — swap it for Gnani's,
+          // same "fast start, then swap only if needed" pattern as
+          // stream-handler.ts's setupVoiceForCall(). Only Gnani-routed test
+          // calls pay this one reconnect. Must wait for the eager connect to
+          // actually settle (success or failure) before closing it — see
+          // sttConnectPromise's doc comment above for the crash this avoids.
+          await this.sttConnectPromise.catch(() => {});
+          this.stt.close();
+          this.stt = createLiveStt("gnani", { sampleRate: 16000, language: this.language, onTranscript: this.onSttTranscript });
+          this.sttConnectPromise = this.stt.connect();
+          await this.sttConnectPromise;
+        }
+
+        this.ensureSpeakStream();
+      }
+    } catch (err) {
+      console.warn(`[TestAgentStream] Voice setup failed for ${this.sessionId}, using defaults:`, err);
+    }
+
+    if (this.greeting?.trim()) {
+      await this.speakGreeting(this.greeting.trim()).catch((err) => console.error(`[TestAgentStream] speakGreeting failed for ${this.sessionId}:`, err));
+    }
+  }
+
+  private async onFinalTranscript(text: string): Promise<void> {
+    if (!text.trim() || this.isBusy) return;
+    this.isBusy = true;
+    const myGeneration = this.generation;
+    this.ws.send(JSON.stringify({ type: "turn_start" }));
+
+    const turnPcm = Buffer.concat(this.turnAudioChunks);
+    this.turnAudioChunks = [];
+    // Real STT time isn't cleanly measurable per-turn (Deepgram streams
+    // interim results continuously while the user is still talking) — the
+    // one honest number we have is how long the audio itself ran, which
+    // approximates it well enough for the pipeline visual's "Listen" stage.
+    const sttMs = Math.round((turnPcm.length / 2 / 16000) * 1000);
+
+    const abortController = new AbortController();
+    this.currentAbortController = abortController;
+
+    try {
+      console.log(`[STT] User: "${text}"`);
+
+      const wordCount = text.split(/\s+/).filter(Boolean).length;
+      const utterancePcm = turnPcm.length > 0 ? isolateLastUtterance(downsample16kTo8k(turnPcm)) : Buffer.alloc(0);
+      const acousticFeatures = utterancePcm.length > 0
+        ? extractAcousticFeatures(utterancePcm, wordCount)
+        : undefined;
+      // Raw 16kHz PCM (pre-downsampling) for the wav2vec2 acoustic ML
+      // diagnostic engine — the browser mic already captures at this
+      // model's native sample rate, so no resampling is needed here.
+      const rawAudioPcm16k = turnPcm.length > 0 ? int16ToFloat32Pcm(turnPcm) : undefined;
+
+      await this.voiceSetupPromise;
+
+      const turnInput = {
+        sessionId: this.sessionId,
+        // A browser test call is a fresh synthetic caller. Reusing the one
+        // seeded demo user leaked unrelated cross-call memories into every
+        // custom agent test (including mixed-language text), which could
+        // steer the reply into the wrong language or persona.
+        userId: this.agentId ? this.sessionId : DEMO.userId,
+        clientId: this.clientId,
+        agentId: this.agentId,
+        patientId: this.patientId,
+        transcript: text,
+        // buildLLMContext's language-matching rule (lib/agent/context.ts)
+        // only fires when this is set — without it the browser test drawer
+        // always replied in English regardless of what language the caller
+        // actually spoke, even though STT (Gnani, when configured) was
+        // already transcribing it correctly.
+        language: this.language,
+        sttConfidence: 0.9,
+        acousticFeatures,
+        rawAudioPcm16k,
+        sensitivityBias: this.sensitivityBias,
+        // Full per-engine breakdown (HF/Lexicon/Local ONNX/Acoustic) so the
+        // live test drawer can show the same diagnostics the Text demo does,
+        // not just the fused label.
+        diagnostics: true,
+      };
+
+      // Shared id lets the client correlate reply_text and reply_audio_chunk
+      // (sent separately, further below) back to the same turn.
+      const replyTurnId = nanoid(8);
+
+      if (this.useBufferedTts) {
+        // Tenant has a custom ElevenLabs voice — no streaming Speak WS
+        // support for that path yet, use the original buffered flow.
+        const output = await handleTurn(turnInput);
+        if (myGeneration !== this.generation) {
+          console.log(`[TestAgentStream] Dropping stale reply (generation ${myGeneration} != ${this.generation}).`);
+          return;
+        }
+        console.log(`[LLM] Reply: "${output.reply}"`);
+        if (output.trace.timings) output.trace.timings.sttMs = sttMs;
+        this.ws.send(JSON.stringify({ type: "reply_text", turnId: replyTurnId, text: output.reply, trace: output.trace }));
+
+        const ttsStart = Date.now();
+        const audio = await synthesize(output.reply, {
+          policy: output.trace.policy,
+          emotion: output.trace.emotion.current.label,
+          persona: output.trace.agent?.voicePersona ?? undefined,
+          clientId: this.clientId,
+          callerText: text,
+        });
+        const ttsMs = Date.now() - ttsStart;
+        if (myGeneration !== this.generation) return;
+        this.isSpeaking = true;
+        this.ws.send(JSON.stringify({ type: "reply_audio", turnId: replyTurnId, ttsMs, audio: Buffer.from(audio).toString("base64"), mime: "audio/mpeg" }));
+        return;
+      }
+
+      const { stream: speakStream, ready: speakStreamReady } = this.ensureSpeakStream();
+      speakStream.setAudioHandler((audioChunk) => {
+        if (myGeneration !== this.generation) return; // stale — dropped by barge-in
+        this.isSpeaking = true;
+        this.ws.send(
+          JSON.stringify({
+            type: "reply_audio_chunk",
+            turnId: replyTurnId,
+            audio: audioChunk.toString("base64"),
+            sampleRate: BROWSER_TTS_SAMPLE_RATE,
+          })
+        );
+      });
+
+      // Resolved via onEmotionResolved below, well before the first clause
+      // arrives — lets each streamed clause get the same adaptive-tone
+      // pause shaping (BUG-V1) the buffered path applies to the whole
+      // reply at once.
+      let prosodyParams: TTSProsodyParams | null = null;
+
+      const output = await handleTurn(turnInput, {
+        abortSignal: abortController.signal,
+        onEmotionResolved: (emotion, policy) => {
+          prosodyParams = getEmotionTTSParams(emotion, policy, text);
+        },
+        onReplyChunk: (clause) => {
+          if (myGeneration !== this.generation) return; // stale — dropped by barge-in
+          const shaped = prosodyParams ? applyEmotionProsody(clause, prosodyParams) : clause;
+          void speakStreamReady.then(() => {
+            if (myGeneration !== this.generation) return;
+            speakStream.sendText(shaped);
+            speakStream.flush();
+          });
+        },
+      });
+
+      if (myGeneration !== this.generation) {
+        console.log(`[TestAgentStream] Dropping stale reply (generation ${myGeneration} != ${this.generation}).`);
+        return;
+      }
+
+      console.log(`[LLM] Reply: "${output.reply}"`);
+      if (output.trace.timings) output.trace.timings.sttMs = sttMs;
+
+      // Sent after the clauses have already started streaming as audio —
+      // the transcript/trace panel updates a beat behind the caller's first
+      // words, same tradeoff lib/telephony/stream-handler.ts makes. Not
+      // synthesizing again here (unlike the pre-streaming version) — every
+      // clause's audio (already prosody-shaped — see onReplyChunk above)
+      // was sent as it was generated.
+      this.ws.send(JSON.stringify({ type: "reply_text", turnId: replyTurnId, text: output.reply, trace: output.trace }));
+    } catch (err) {
+      if (myGeneration !== this.generation) {
+        console.log(`[TestAgentStream] Turn cancelled by barge-in for ${this.sessionId}.`);
+      } else {
+        console.error("[TestAgentStream] Turn error:", err);
+        this.ws.send(
+          JSON.stringify({
+            type: "error",
+            message: "Something went wrong generating a reply. Please try again.",
+          })
+        );
+      }
+    } finally {
+      this.isSpeaking = false;
+      this.isBusy = false;
+      this.currentAbortController = null;
+      this.ws.send(JSON.stringify({ type: "turn_end" }));
+    }
+  }
+
+  // Handle incoming messages from the client (usually raw audio buffers).
+  // Discriminate on `isBinary`, not `Buffer.isBuffer(message)` — this ws
+  // version delivers BOTH binary and text frames as Buffer objects, so
+  // Buffer.isBuffer() was always true regardless of frame type. That meant
+  // every text control message (ping, barge_in, set_sensitivity_bias) was
+  // silently misrouted into the "it's audio" branch below — fed to Deepgram
+  // as garbage PCM and never reaching the JSON.parse branch at all.
+  private onMessage(message: Buffer, isBinary: boolean): void {
+    if (isBinary && Buffer.isBuffer(message)) {
+      this.audioChunkCount++;
+      this.audioByteCount += message.length;
+      if (this.audioChunkCount === 1) {
+        console.log(`[TestAgentStream] First audio chunk received (${message.length} bytes, sttProvider=${this.stt.provider}).`);
+      } else if (this.audioChunkCount % 50 === 0) {
+        console.log(`[TestAgentStream] ${this.audioChunkCount} audio chunks received (${this.audioByteCount} bytes total, sttProvider=${this.stt.provider}).`);
+      }
+      // Server-side RMS barge-in fallback — this path otherwise depends
+      // entirely on the browser's client-side VAD sending {type:"barge_in"};
+      // this is a safety net for when that's slow, missing, or fails. Reuses
+      // lib/telephony/stream-handler.ts's threshold as a starting point —
+      // that value was calibrated against 8kHz mulaw telephony audio, and
+      // browser mic PCM at 16kHz may have different gain/noise-floor
+      // characteristics, so this may need its own tuning if it proves too
+      // trigger-happy or too insensitive in practice; it's strictly a
+      // fallback behind the (usually faster) client-side VAD either way.
+      if (this.isSpeaking) {
+        const rms = computeRmsEnergy(message);
+        if (rms > CONFIG.telephony.bargeInEnergyThreshold) {
+          this.triggerBargeIn(`rms=${rms.toFixed(0)}`);
+        }
+      }
+
+      // It's raw binary audio -> pump to STT, and accumulate for turn-level
+      // acoustic feature extraction.
+      try {
+        this.stt.sendAudio(message);
+      } catch (err) {
+        console.error(`[TestAgentStream] stt.sendAudio threw on chunk ${this.audioChunkCount}:`, err);
+      }
+      this.turnAudioChunks.push(message);
+    } else {
+      // Handle text control messages
+      try {
+        const payload = JSON.parse(message.toString());
+        if (payload.type === "ping") {
+          this.ws.send(JSON.stringify({ type: "pong" }));
+        } else if (payload.type === "barge_in") {
+          // Client-side VAD detected the user talking over the agent's reply.
+          this.triggerBargeIn("client-vad");
+        } else if (payload.type === "set_sensitivity_bias") {
+          const value = Number(payload.value);
+          if (Number.isFinite(value)) {
+            this.sensitivityBias = Math.max(-1, Math.min(1, value));
+            console.log(`[TestAgentStream] Sensitivity bias set to ${this.sensitivityBias}.`);
+          }
+        }
+      } catch (e) {
+        // ignore
+      }
+    }
+  }
+
+  private onClose(code: number, reason: Buffer): void {
+    console.log(`[TestAgentStream] Client disconnected (session ${this.sessionId}), code=${code}, reason="${reason.toString()}", audioChunksReceived=${this.audioChunkCount}.`);
+    this.stt.close();
+    this.currentSpeakStream?.close();
+  }
+
+  private onError(err: Error): void {
+    console.error("[TestAgentStream] Connection error:", err);
+    this.stt.close();
+    this.currentSpeakStream?.close();
+  }
+}
diff --git a/lib/tools/custom.ts b/lib/tools/custom.ts
new file mode 100644
index 0000000..43b623f
--- /dev/null
+++ b/lib/tools/custom.ts
@@ -0,0 +1,90 @@
+import { lookup } from "node:dns/promises";
+import { isIP } from "node:net";
+import { request as httpsRequest } from "node:https";
+import { decrypt } from "../util/crypto";
+import type { ToolDef, ToolCallContext } from "../agent/tools";
+
+export interface CustomToolRow {
+  id: string; tenant_id: string; name: string; description: string; endpoint: string; method: string;
+  input_schema: Record<string, unknown>; headers: Record<string, string>; encrypted_secret: string | null;
+  secret_header: string | null; status: string;
+}
+
+function publicAddress(address: string): boolean {
+  if (isIP(address) === 4) {
+    const [a,b] = address.split(".").map(Number);
+    return !(a===0 || a===10 || a===127 || (a===100&&b>=64&&b<=127) || (a===169&&b===254) || (a===172&&b>=16&&b<=31) || (a===192&&(b===0||b===168||b===88)) || (a===198&&(b===18||b===19||b===51)) || (a===203&&b===0) || a>=224);
+  }
+  const value = address.toLowerCase();
+  if (value.startsWith("::ffff:")) return publicAddress(value.slice(7));
+  return /^[23]/.test(value) && !value.startsWith("2001:db8:");
+}
+
+function validateArgs(schema: Record<string, unknown>, args: Record<string, unknown>) {
+  if (schema.type !== "object" || !schema.properties || typeof schema.properties !== "object") throw new Error("This tool has an invalid input schema.");
+  const properties = schema.properties as Record<string, { type?: string }>;
+  const required = Array.isArray(schema.required) ? schema.required : [];
+  for (const key of required) if (typeof key === "string" && (args[key] === undefined || args[key] === null || args[key] === "")) throw new Error(`Missing required input: ${key}`);
+  for (const [key,value] of Object.entries(args)) {
+    const expected = properties[key]?.type;
+    if (!expected) throw new Error(`Unexpected input: ${key}`);
+    const valid = expected === "string" ? typeof value === "string" : expected === "number" ? typeof value === "number" && Number.isFinite(value) : expected === "integer" ? Number.isInteger(value) : expected === "boolean" ? typeof value === "boolean" : expected === "array" ? Array.isArray(value) : expected === "object" ? typeof value === "object" && value !== null && !Array.isArray(value) : true;
+    if (!valid) throw new Error(`Invalid value for ${key}; expected ${expected}.`);
+    if (typeof value === "string" && value.length > 10000) throw new Error(`Input ${key} is too long.`);
+  }
+}
+
+export function customToolFunctionName(id: string) { return `custom_${id.replaceAll("-", "").slice(0, 24)}`; }
+
+export function customToolDefinitions(rows: CustomToolRow[]): ToolDef[] {
+  return rows.filter((row) => row.status === "active").map((row) => ({ type: "function", function: {
+    name: customToolFunctionName(row.id), description: `[Custom tool: ${row.name}] ${row.description}`.slice(0, 800), parameters: row.input_schema,
+  } }));
+}
+
+export async function executeCustomTool(row: CustomToolRow, args: Record<string, unknown>): Promise<string> {
+  validateArgs(row.input_schema, args);
+  const url = new URL(row.endpoint);
+  if (url.protocol !== "https:" || url.username || url.password || url.hash) throw new Error("Custom tool endpoints must use HTTPS without embedded credentials or fragments.");
+  const addresses = isIP(url.hostname) ? [{ address: url.hostname, family: isIP(url.hostname) }] : await lookup(url.hostname, { all: true, verbatim: true });
+  if (!addresses.length || addresses.some(({address}) => !publicAddress(address))) throw new Error("Custom tool endpoint must resolve only to public IP addresses.");
+  const pinned = addresses[0];
+  const headers: Record<string,string> = { accept: "application/json", ...row.headers };
+  if (row.encrypted_secret && row.secret_header) headers[row.secret_header] = row.secret_header.toLowerCase() === "authorization" ? `Bearer ${decrypt(row.encrypted_secret)}` : decrypt(row.encrypted_secret);
+  const body = row.method === "GET" ? "" : JSON.stringify(args);
+  const target = new URL(url);
+  if (row.method === "GET") for (const [key,value] of Object.entries(args)) target.searchParams.set(key, String(value));
+  return new Promise((resolve, reject) => {
+    const req = httpsRequest({ protocol: "https:", hostname: target.hostname, port: target.port || 443, path: `${target.pathname}${target.search}`, method: row.method, headers: { ...headers, ...(body ? { "content-type": "application/json", "content-length": String(Buffer.byteLength(body)) } : {}) }, servername: isIP(target.hostname) ? undefined : target.hostname, lookup: ((_host: string, options: { all?: boolean }, cb: (...args: unknown[]) => void) => {
+      if (options?.all) cb(null, [{ address: pinned.address, family: pinned.family }]);
+      else cb(null, pinned.address, pinned.family);
+    }) as never }, (res) => {
+      const chunks: Buffer[] = []; let bytes = 0;
+      res.on("data", (chunk: Buffer) => { bytes += chunk.length; if (bytes > 256_000) req.destroy(new Error("Tool response exceeds 256 KB.")); else chunks.push(chunk); });
+      res.on("end", () => { const text = Buffer.concat(chunks).toString("utf8"); if ((res.statusCode ?? 500) < 200 || (res.statusCode ?? 500) >= 300) return reject(new Error(`Tool endpoint returned HTTP ${res.statusCode}: ${text.slice(0,500)}`)); resolve(text.slice(0, 12000) || "Tool completed successfully with an empty response."); });
+      res.on("error", reject);
+    });
+    req.setTimeout(10000, () => req.destroy(new Error("Tool endpoint timed out.")));
+    req.on("error", reject); if (body) req.write(body); req.end();
+  });
+}
+
+export async function getCustomToolsForAgent(enabled: string[], clientId: string): Promise<ToolDef[]> {
+  const ids = enabled.filter((name) => name.startsWith("custom_"));
+  if (!ids.length) return [];
+  const { supabase } = await import("../db/supabase");
+  const { data: tenant } = await supabase.from("tenants").select("id").eq("auth_user_id", clientId).single();
+  if (!tenant) return [];
+  const { data } = await supabase.from("custom_tools").select("*").eq("tenant_id", tenant.id).eq("status", "active");
+  return customToolDefinitions(((data ?? []) as CustomToolRow[]).filter((row) => ids.includes(customToolFunctionName(row.id))));
+}
+
+export async function dispatchCustomTool(name: string, args: Record<string, unknown>, clientId: string) {
+  const { supabase } = await import("../db/supabase");
+  const { data: tenant } = await supabase.from("tenants").select("id").eq("auth_user_id", clientId).single();
+  if (!tenant) throw new Error("Tenant not found.");
+  const { data: rows } = await supabase.from("custom_tools").select("*").eq("tenant_id", tenant.id).eq("status", "active");
+  const row = ((rows ?? []) as CustomToolRow[]).find((item) => customToolFunctionName(item.id) === name);
+  if (!row) throw new Error("Custom tool is no longer available.");
+  return executeCustomTool(row, args);
+}
diff --git a/scripts/test-gnani-language-matrix.ts b/scripts/test-gnani-language-matrix.ts
new file mode 100644
index 0000000..6ae4f5b
--- /dev/null
+++ b/scripts/test-gnani-language-matrix.ts
@@ -0,0 +1,220 @@
+import WebSocket from "ws";
+import { synthesizeGnaniLinear16, type GnaniLanguage } from "../lib/tts/gnani";
+import { supabase } from "../lib/db/supabase";
+
+type Case = { code: GnaniLanguage; label: string; text: string; voice: string; model: string; script?: RegExp };
+
+/** A disposable, synthetic voice round-trip for every Gnani picker choice.
+ * Run with: node --env-file=.env.local --import tsx scripts/test-gnani-language-matrix.ts <agent-id>
+ * It synthesizes one harmless phrase, streams it through the local realtime
+ * server (Gnani STT -> agent LLM -> Gnani streaming TTS), then checks that
+ * the transcript, live LLM reply, and response audio arrived. */
+export const GNANI_LANGUAGE_MATRIX: Case[] = [
+  { code: "hi-IN", label: "Hindi", text: "कृपया मेरी मदद करें", voice: "Shivani", model: "timbre-v3.0", script: /[\u0900-\u097f]/ },
+  { code: "en-IN", label: "English (India)", text: "Please help me today", voice: "Shivani", model: "timbre-v3.0", script: /[A-Za-z]/ },
+  { code: "ta-IN", label: "Tamil", text: "தயவு செய்து எனக்கு உதவுங்கள்", voice: "Shivani", model: "timbre-v3.0", script: /[\u0b80-\u0bff]/ },
+  { code: "te-IN", label: "Telugu", text: "దయచేసి నాకు సహాయం చేయండి", voice: "Shivani", model: "timbre-v3.0", script: /[\u0c00-\u0c7f]/ },
+  { code: "kn-IN", label: "Kannada", text: "ದಯವಿಟ್ಟು ನನಗೆ ಸಹಾಯ ಮಾಡಿ", voice: "Shivani", model: "timbre-v3.0", script: /[\u0c80-\u0cff]/ },
+  { code: "ml-IN", label: "Malayalam", text: "ദയവായി എന്നെ സഹായിക്കൂ", voice: "Shivani", model: "timbre-v3.0", script: /[\u0d00-\u0d7f]/ },
+  { code: "mr-IN", label: "Marathi", text: "कृपया मला मदत करा", voice: "Shivani", model: "timbre-v3.0", script: /[\u0900-\u097f]/ },
+  { code: "pa-IN", label: "Punjabi", text: "ਕਿਰਪਾ ਕਰਕੇ ਮੇਰੀ ਮਦਦ ਕਰੋ", voice: "Shivani", model: "timbre-v3.0", script: /[\u0a00-\u0a7f]/ },
+  { code: "bn-IN", label: "Bengali", text: "দয়া করে আমাকে সাহায্য করুন", voice: "Shivani", model: "timbre-v3.0", script: /[\u0980-\u09ff]/ },
+  { code: "gu-IN", label: "Gujarati", text: "કૃપા કરીને મને મદદ કરો", voice: "Shivani", model: "timbre-v3.0", script: /[\u0a80-\u0aff]/ },
+  { code: "hi-en", label: "Hinglish", text: "Please meri help kijiye", voice: "Poorvi", model: "timbre-v2.5" },
+  { code: "auto", label: "Auto-detect", text: "कृपया मेरी मदद करें", voice: "Shivani", model: "timbre-v3.0", script: /[\u0900-\u097f]/ },
+];
+
+const agentId = process.argv[2];
+if (!agentId) throw new Error("Pass the saved Gnani test agent ID as the first argument.");
+if (!process.env.GNANI_API_KEY) throw new Error("GNANI_API_KEY is required.");
+
+const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
+const INDIC_SCRIPTS: Record<string, RegExp> = {
+  Devanagari: /[\u0900-\u097f]/,
+  Bengali: /[\u0980-\u09ff]/,
+  Gurmukhi: /[\u0a00-\u0a7f]/,
+  Gujarati: /[\u0a80-\u0aff]/,
+  Tamil: /[\u0b80-\u0bff]/,
+  Telugu: /[\u0c00-\u0c7f]/,
+  Kannada: /[\u0c80-\u0cff]/,
+  Malayalam: /[\u0d00-\u0d7f]/,
+  Arabic: /[\u0600-\u06ff]/,
+  Cyrillic: /[\u0400-\u04ff]/,
+  CJK: /[\u4e00-\u9fff]/,
+};
+const TARGET_SCRIPT: Record<GnaniLanguage, string> = {
+  "hi-IN": "Devanagari", "mr-IN": "Devanagari", "en-IN": "Latin", "ta-IN": "Tamil",
+  "te-IN": "Telugu", "kn-IN": "Kannada", "ml-IN": "Malayalam", "pa-IN": "Gurmukhi",
+  "bn-IN": "Bengali", "gu-IN": "Gujarati", "hi-en": "Devanagari", auto: "Devanagari",
+};
+
+function upsample8kTo16k(input: Buffer): Buffer {
+  const output = Buffer.alloc(input.length * 2);
+  for (let offset = 0; offset + 1 < input.length; offset += 2) {
+    const sample = input.readInt16LE(offset);
+    const outOffset = offset * 2;
+    output.writeInt16LE(sample, outOffset);
+    output.writeInt16LE(sample, outOffset + 2);
+  }
+  return output;
+}
+
+async function openCall(): Promise<{ ws: WebSocket; messages: any[] }> {
+  const ws = new WebSocket(`ws://127.0.0.1:${process.env.REALTIME_SERVER_PORT || "3001"}/?agentId=${encodeURIComponent(agentId)}`);
+  const messages: any[] = [];
+  ws.on("message", (data) => {
+    try { messages.push(JSON.parse(data.toString())); } catch { /* ignore non-JSON */ }
+  });
+  await new Promise<void>((resolve, reject) => {
+    const timeout = setTimeout(() => { ws.close(); reject(new Error("Realtime server connection timed out.")); }, 8000);
+    ws.once("open", () => { clearTimeout(timeout); resolve(); });
+    ws.once("error", (error) => { clearTimeout(timeout); ws.close(); reject(error); });
+  });
+  const deadline = Date.now() + 15000;
+  while (Date.now() < deadline && !messages.some((message) => message.type === "system" || message.type === "error")) await wait(100);
+  if (messages.some((message) => message.type === "error")) throw new Error(messages.find((message) => message.type === "error").message);
+  if (!messages.some((message) => message.type === "system")) throw new Error("Gnani STT did not become ready in time.");
+  return { ws, messages };
+}
+
+async function runCase(test: Case): Promise<{ label: string; stt: string; reply: string; llm: string; audioBytes: number; ttsMs: number }> {
+  const voicePersona = `gnani:${test.model}:${test.voice}`;
+  let updated = false;
+  let updateFailure = "unknown error";
+  for (let attempt = 0; attempt < 4 && !updated; attempt++) {
+    try {
+      const { error } = await supabase.from("agents").update({ speech_provider: "gnani", language: test.code, voice_persona: voicePersona }).eq("id", agentId);
+      if (error) updateFailure = error.message;
+      else updated = true;
+    } catch (error) { updateFailure = error instanceof Error ? error.message : String(error); }
+    if (!updated && attempt < 3) await wait(700 * (attempt + 1));
+  }
+  if (!updated) throw new Error(`${test.label}: couldn't set the temporary test voice: ${updateFailure}`);
+  // Each websocket resolves provider/language/voice once when the call starts.
+  await wait(150);
+
+  const ttsStart = Date.now();
+  let sourceAudio: Buffer | null = null;
+  let ttsError: unknown;
+  for (let attempt = 0; attempt < 2 && !sourceAudio; attempt++) {
+    try { sourceAudio = await synthesizeGnaniLinear16(test.text, { voice: test.voice, model: test.model, language: test.code }); }
+    catch (error) { ttsError = error; if (attempt === 0) await wait(600); }
+  }
+  if (!sourceAudio) throw ttsError instanceof Error ? ttsError : new Error(`${test.label}: TTS failed.`);
+  const ttsMs = Date.now() - ttsStart;
+  if (sourceAudio.length < 1000) throw new Error(`${test.label}: TTS returned too little audio (${sourceAudio.length} bytes).`);
+
+  const { ws, messages } = await openCall();
+  try {
+    // Let the agent finish its opening line before sending the synthetic caller.
+    await wait(1200);
+    const audio = upsample8kTo16k(sourceAudio);
+    for (let offset = 0; offset < audio.length; offset += 3200) {
+      if (ws.readyState !== WebSocket.OPEN) throw new Error(`${test.label}: realtime connection closed before the utterance finished.`);
+      ws.send(audio.subarray(offset, Math.min(offset + 3200, audio.length)));
+      await wait(100);
+    }
+    const silence = Buffer.alloc(32000);
+    for (let offset = 0; offset < silence.length; offset += 3200) {
+      ws.send(silence.subarray(offset, offset + 3200));
+      await wait(100);
+    }
+
+    const deadline = Date.now() + 30000;
+    while (Date.now() < deadline && !messages.some((message) => message.type === "turn_end")) await wait(100);
+    // turn_end marks LLM completion; Gnani's request-per-clause TTS can still
+    // be streaming audio. Keep the socket open until audio is quiet for 1.2s.
+    let previousAudioCount = -1;
+    let audioQuietSince = Date.now();
+    const drainDeadline = Date.now() + 8000;
+    while (Date.now() < drainDeadline) {
+      const audioCount = messages.filter((message) => message.type === "reply_audio_chunk").length;
+      if (audioCount !== previousAudioCount) {
+        previousAudioCount = audioCount;
+        audioQuietSince = Date.now();
+      }
+      if (audioCount > 0 && Date.now() - audioQuietSince >= 1200) break;
+      await wait(100);
+    }
+    const transcript = messages.find((message) => message.type === "transcript_final")?.text ?? "";
+    const replyMessage = [...messages].reverse().find((message) => message.type === "reply_text" && message.trace?.agent?.id === agentId);
+    const reply = replyMessage?.text ?? "";
+    const audioBytes = messages.filter((message) => message.type === "reply_audio_chunk").reduce((sum, message) => sum + Buffer.from(message.audio ?? "", "base64").length, 0);
+    if (!transcript) throw new Error(`${test.label}: Gnani STT returned no final transcript.`);
+    if (test.script && !test.script.test(transcript)) throw new Error(`${test.label}: transcript did not use the expected script: ${transcript.slice(0, 100)}`);
+    if (!reply) throw new Error(`${test.label}: agent returned no final text response.`);
+    if (test.script && !test.script.test(reply)) throw new Error(`${test.label}: STT="${transcript.slice(0, 70)}" but agent reply did not match the expected language script: ${reply.slice(0, 100)}`);
+    const targetScript = TARGET_SCRIPT[test.code];
+    const foreignScript = Object.entries(INDIC_SCRIPTS).find(([name, pattern]) => name !== targetScript && pattern.test(reply));
+    if (foreignScript) throw new Error(`${test.label}: reply mixed in ${foreignScript[0]} script: ${reply.slice(0, 120)}`);
+    if (test.code === "mr-IN" && !/(मला|तुम्ही|माझी|करा|आहे|काय|कसली|हवीय|सांगा|नक्की)/.test(reply)) throw new Error(`Marathi language quality failed: STT="${transcript.slice(0, 70)}" reply="${reply.slice(0, 180)}"`);
+    if (!replyMessage.trace?.usedLiveLlm) throw new Error(`${test.label}: agent reply did not come from a live LLM.`);
+    if (replyMessage.trace?.agent?.id !== agentId) throw new Error(`${test.label}: request resolved to a different agent.`);
+    if (audioBytes < 12000) throw new Error(`${test.label}: Gnani streaming TTS returned too little audio (${audioBytes} bytes).`);
+    return { label: test.label, stt: transcript.slice(0, 120), reply: reply.slice(0, 160), llm: replyMessage.trace.llmModel, audioBytes, ttsMs };
+  } finally {
+    ws.close();
+  }
+}
+
+async function main() {
+  let originalAgent: any = null;
+  let loadFailure = "unknown error";
+  for (let attempt = 0; attempt < 4 && !originalAgent; attempt++) {
+    try {
+      const result = await supabase.from("agents").select("speech_provider,language,voice_persona").eq("id", agentId).single();
+      if (result.data) originalAgent = result.data;
+      else if (result.error) loadFailure = result.error.message;
+    } catch (error) { loadFailure = error instanceof Error ? error.message : String(error); }
+    if (!originalAgent && attempt < 3) await wait(700 * (attempt + 1));
+  }
+  if (!originalAgent) throw new Error(`Couldn't load test agent settings: ${loadFailure}`);
+
+  let failures = 0;
+  const filter = process.env.GNANI_LANGUAGE_FILTER?.split(",").map((item) => item.trim()).filter(Boolean);
+  const tests = filter?.length ? GNANI_LANGUAGE_MATRIX.filter((test) => filter.includes(test.code)) : GNANI_LANGUAGE_MATRIX;
+  try {
+    for (const test of tests) {
+      let passed = false;
+      for (let attempt = 0; attempt < 2 && !passed; attempt++) {
+        try {
+          const result = await runCase(test);
+          console.log(`PASS ${result.label} | TTS ${result.ttsMs}ms | STT: ${result.stt} | Agent: ${result.reply} | LLM ${result.llm} | response audio ${result.audioBytes} bytes`);
+          passed = true;
+        } catch (error) {
+          if (attempt === 0) {
+            console.warn(`RETRY ${test.label} | ${error instanceof Error ? error.message : String(error)}`);
+            await wait(1000);
+          } else {
+            failures++;
+            console.error(`FAIL ${test.label} | ${error instanceof Error ? error.message : String(error)}`);
+          }
+        }
+      }
+    }
+  } finally {
+    let restoreError = "unknown error";
+    let restored = false;
+    for (let attempt = 0; attempt < 5 && !restored; attempt++) {
+      try {
+        const { error } = await supabase.from("agents").update({ speech_provider: originalAgent.speech_provider, language: originalAgent.language, voice_persona: originalAgent.voice_persona }).eq("id", agentId);
+        if (error) restoreError = error.message;
+        else restored = true;
+      } catch (error) { restoreError = error instanceof Error ? error.message : String(error); }
+      if (!restored && attempt < 4) await wait(1000 * (attempt + 1));
+    }
+    if (!restored) {
+      failures++;
+      console.error(`FAIL restore agent voice settings | ${restoreError}`);
+    } else {
+      console.log("Restored the agent's saved Gnani voice settings.");
+    }
+  }
+  console.log(`\nGnani language matrix: ${tests.length - failures}/${tests.length} passed.`);
+  if (failures) process.exitCode = 1;
+}
+
+void main().catch((error) => {
+  console.error(`Gnani language matrix failed to start: ${error instanceof Error ? error.message : String(error)}`);
+  process.exitCode = 1;
+});
diff --git a/sql/migration_v33.sql b/sql/migration_v33.sql
new file mode 100644
index 0000000..536ec83
--- /dev/null
+++ b/sql/migration_v33.sql
@@ -0,0 +1,30 @@
+-- Tenant-owned MCP server connections for agent tools.
+CREATE TABLE IF NOT EXISTS public.mcp_connections (
+  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
+  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
+  name TEXT NOT NULL,
+  endpoint TEXT NOT NULL,
+  token_header TEXT NOT NULL DEFAULT 'authorization',
+  encrypted_token TEXT,
+  tools JSONB NOT NULL DEFAULT '[]'::jsonb,
+  protocol_version TEXT NOT NULL DEFAULT '2025-03-26',
+  tools_checked_at TIMESTAMPTZ,
+  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'error')),
+  last_error TEXT,
+  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
+  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
+);
+
+-- Keep the migration safe if an earlier draft of this table was applied.
+ALTER TABLE public.mcp_connections ADD COLUMN IF NOT EXISTS token_header TEXT NOT NULL DEFAULT 'authorization';
+ALTER TABLE public.mcp_connections ADD COLUMN IF NOT EXISTS protocol_version TEXT NOT NULL DEFAULT '2025-03-26';
+ALTER TABLE public.mcp_connections ADD COLUMN IF NOT EXISTS tools_checked_at TIMESTAMPTZ;
+ALTER TABLE public.mcp_connections ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';
+ALTER TABLE public.mcp_connections ADD COLUMN IF NOT EXISTS last_error TEXT;
+
+CREATE INDEX IF NOT EXISTS idx_mcp_connections_tenant ON public.mcp_connections (tenant_id);
+ALTER TABLE public.mcp_connections ENABLE ROW LEVEL SECURITY;
+DROP POLICY IF EXISTS "Tenants can manage their MCP connections" ON public.mcp_connections;
+CREATE POLICY "Tenants can manage their MCP connections" ON public.mcp_connections
+  FOR ALL USING (tenant_id IN (SELECT id FROM public.tenants WHERE auth_user_id = auth.uid()))
+  WITH CHECK (tenant_id IN (SELECT id FROM public.tenants WHERE auth_user_id = auth.uid()));
diff --git a/sql/migration_v34.sql b/sql/migration_v34.sql
new file mode 100644
index 0000000..a349819
--- /dev/null
+++ b/sql/migration_v34.sql
@@ -0,0 +1,25 @@
+-- Reusable tenant tool registry for custom HTTP actions. MCP servers remain
+-- in mcp_connections and built-in hospital actions remain application-owned.
+CREATE TABLE IF NOT EXISTS public.custom_tools (
+  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
+  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
+  name TEXT NOT NULL,
+  description TEXT NOT NULL,
+  endpoint TEXT NOT NULL,
+  method TEXT NOT NULL DEFAULT 'POST' CHECK (method IN ('GET','POST','PUT','PATCH','DELETE')),
+  input_schema JSONB NOT NULL DEFAULT '{"type":"object","properties":{}}'::jsonb,
+  headers JSONB NOT NULL DEFAULT '{}'::jsonb,
+  encrypted_secret TEXT,
+  secret_header TEXT,
+  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','error','disabled')),
+  last_tested_at TIMESTAMPTZ,
+  last_error TEXT,
+  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
+  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
+);
+CREATE INDEX IF NOT EXISTS idx_custom_tools_tenant ON public.custom_tools (tenant_id, created_at DESC);
+ALTER TABLE public.custom_tools ENABLE ROW LEVEL SECURITY;
+DROP POLICY IF EXISTS "Tenants can manage their custom tools" ON public.custom_tools;
+CREATE POLICY "Tenants can manage their custom tools" ON public.custom_tools
+  FOR ALL USING (tenant_id IN (SELECT id FROM public.tenants WHERE auth_user_id = auth.uid()))
+  WITH CHECK (tenant_id IN (SELECT id FROM public.tenants WHERE auth_user_id = auth.uid()));
