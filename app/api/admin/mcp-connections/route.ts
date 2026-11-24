import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "../../../../lib/db/server";
import { getTenantIdForUser } from "../../../../lib/db/agents";
import { discoverMCPTools, makeFunctionName, validateMCPEndpoint, type MCPConnection } from "../../../../lib/mcp/client";
import { encrypt } from "../../../../lib/util/crypto";
import { dispatchMCPTool } from "../../../../lib/mcp/client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const CreateSchema = z.object({
  name: z.string().trim().min(1).max(80),
  endpoint: z.string().url().max(500),
  token: z.string().max(2000).optional(),
  tokenHeader: z.enum(["authorization", "x-api-key", "x-auth-token"]).optional(),
});

async function auth() {
  const db = await createClient();
  const { data: { user } } = await db.auth.getUser();
  if (!user) return { db, user: null, tenantId: null };
  return { db, user, tenantId: await getTenantIdForUser(db, user.id) };
}

function publicConnection(row: MCPConnection) {
  return {
    id: row.id,
    name: row.name,
    endpoint: row.endpoint,
    hasToken: !!row.encrypted_token,
    protocolVersion: row.protocol_version ?? "2025-03-26",
    status: row.status,
    toolsCheckedAt: row.tools_checked_at,
    lastError: (row as MCPConnection & { last_error?: string }).last_error ?? null,
    tools: (row.tools ?? []).map((tool) => ({
      id: makeFunctionName(row.id, tool.name),
      name: tool.name,
      description: tool.description ?? "",
      inputSchema: tool.inputSchema ?? { type: "object", properties: {} },
    })),
  };
}

export async function GET() {
  const { db, user, tenantId } = await auth();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!tenantId) return NextResponse.json({ connections: [] });
  const { data, error } = await db.from("mcp_connections").select("*").eq("tenant_id", tenantId).order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: "Could not load MCP connections." }, { status: 500 });
  return NextResponse.json({ connections: (data ?? []).map((row) => publicConnection(row as MCPConnection)) });
}

export async function POST(request: NextRequest) {
  const { db, user, tenantId } = await auth();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!tenantId) return NextResponse.json({ error: "No tenant found" }, { status: 404 });
  const rawBody = await request.json().catch(() => null) as Record<string, unknown> | null;
  const parsed = CreateSchema.safeParse(rawBody);
  if (rawBody?.action === "test") {
    const test = z.object({ action:z.literal("test"), id:z.string().uuid(), toolName:z.string().min(1).max(128), arguments:z.record(z.string(),z.unknown()).default({}) }).safeParse(rawBody);
    if(!test.success)return NextResponse.json({error:"Invalid MCP test request."},{status:400});
    const {data:connection,error}=await db.from("mcp_connections").select("*").eq("id",test.data.id).eq("tenant_id",tenantId).eq("status","active").single();
    if(error||!connection)return NextResponse.json({error:"Active MCP connection not found."},{status:404});
    if(!((connection.tools??[]) as Array<{name:string}>).some((tool)=>tool.name===test.data.toolName))return NextResponse.json({error:"Tool is not in the latest discovered catalog. Refresh tools first."},{status:400});
    try {
      const {makeFunctionName}=await import("../../../../lib/mcp/client");
      const output=await dispatchMCPTool(makeFunctionName(test.data.id,test.data.toolName),test.data.arguments,user.id);
      return NextResponse.json({success:true,output});
    } catch(error) {return NextResponse.json({error:error instanceof Error?error.message:"MCP tool test failed."},{status:400});}
  }
  if (!parsed.success) return NextResponse.json({ error: "Invalid MCP connection", issues: parsed.error.issues }, { status: 400 });
  if (parsed.data.token && !process.env.CREDENTIALS_ENCRYPTION_KEY) {
    return NextResponse.json({ error: "Set CREDENTIALS_ENCRYPTION_KEY before saving MCP credentials." }, { status: 503 });
  }
  try {
    await validateMCPEndpoint(parsed.data.endpoint);
    const encryptedToken = parsed.data.token ? encrypt(parsed.data.token) : null;
    const discovered = await discoverMCPTools({ endpoint: parsed.data.endpoint, encrypted_token: encryptedToken, token_header: parsed.data.tokenHeader ?? "authorization" });
    const { data, error } = await db.from("mcp_connections").insert({
      tenant_id: tenantId,
      name: parsed.data.name,
      endpoint: parsed.data.endpoint,
      token_header: parsed.data.tokenHeader ?? "authorization",
      encrypted_token: encryptedToken,
      tools: discovered.tools,
      protocol_version: discovered.protocolVersion,
      tools_checked_at: new Date().toISOString(),
      status: "active",
      last_error: null,
    }).select("*").single();
    if (error || !data) throw new Error(error?.message ?? "Could not save MCP connection.");
    return NextResponse.json({ connection: publicConnection(data as MCPConnection) }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "MCP connection failed.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function PATCH(request: NextRequest) {
  const { db, user, tenantId } = await auth();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!tenantId) return NextResponse.json({ error: "No tenant found" }, { status: 404 });
  const body = z.object({ id: z.string().uuid() }).safeParse(await request.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "Connection id is required." }, { status: 400 });
  const { data: row, error } = await db.from("mcp_connections").select("*").eq("id", body.data.id).eq("tenant_id", tenantId).single();
  if (error || !row) return NextResponse.json({ error: "Connection not found." }, { status: 404 });
  try {
    const discovered = await discoverMCPTools(row as MCPConnection);
    const { data, error: updateError } = await db.from("mcp_connections").update({ tools: discovered.tools, protocol_version: discovered.protocolVersion, tools_checked_at: new Date().toISOString(), status: "active", last_error: null, updated_at: new Date().toISOString() }).eq("id", body.data.id).eq("tenant_id", tenantId).select("*").single();
    if (updateError || !data) throw new Error(updateError?.message ?? "Could not refresh tools.");
    return NextResponse.json({ connection: publicConnection(data as MCPConnection) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "MCP refresh failed.";
    await db.from("mcp_connections").update({ status: "error", last_error: message.slice(0, 500), updated_at: new Date().toISOString() }).eq("id", body.data.id).eq("tenant_id", tenantId);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(request: NextRequest) {
  const { db, user, tenantId } = await auth();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!tenantId) return NextResponse.json({ error: "No tenant found" }, { status: 404 });
  const id = request.nextUrl.searchParams.get("id");
  if (!id || !z.string().uuid().safeParse(id).success) return NextResponse.json({ error: "Valid connection id is required." }, { status: 400 });
  const { error } = await db.from("mcp_connections").delete().eq("id", id).eq("tenant_id", tenantId);
  if (error) return NextResponse.json({ error: "Could not remove MCP connection." }, { status: 500 });
  return NextResponse.json({ success: true });
}
