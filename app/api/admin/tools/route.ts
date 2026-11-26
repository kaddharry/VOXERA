import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "../../../../lib/db/server";
import { getTenantIdForUser } from "../../../../lib/db/agents";
import { customToolDefinitions, executeCustomTool, type CustomToolRow } from "../../../../lib/tools/custom";
import { encrypt } from "../../../../lib/util/crypto";
import { APPOINTMENT_TOOLS, CARE_TOOLS, RESERVATION_TOOLS } from "../../../../lib/agent/tools";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const Schema = z.object({ type: z.literal("object"), properties: z.record(z.string(), z.object({ type: z.enum(["string","number","integer","boolean","array","object"]), description: z.string().max(300).optional() })).default({}), required: z.array(z.string()).max(40).default([]) }).refine((schema) => schema.required.every((key) => key in schema.properties), "Required inputs must exist in properties.");
const Form = z.object({
  id: z.string().uuid().optional(), name: z.string().trim().min(1).max(80), description: z.string().trim().min(1).max(500), endpoint: z.string().url().max(1200),
  method: z.enum(["GET","POST","PUT","PATCH","DELETE"]), inputSchema: Schema, headers: z.record(z.string(), z.string().max(1000)).default({}), secret: z.string().max(4000).optional(), secretHeader: z.enum(["authorization","x-api-key","x-auth-token"]).optional(),
});

async function auth() {
  const db = await createClient(); const { data: { user } } = await db.auth.getUser();
  return { db, user, tenantId: user ? await getTenantIdForUser(db, user.id) : null };
}
function publicTool(row: CustomToolRow & Record<string, unknown>) {
  return { id: row.id, functionName: `custom_${row.id.replaceAll("-", "").slice(0,24)}`, name: row.name, description: row.description, endpoint: row.endpoint, method: row.method, inputSchema: row.input_schema, hasSecret: !!row.encrypted_secret, status: row.status, lastTestedAt: row.last_tested_at, lastError: row.last_error };
}
function safeHeaders(headers: Record<string,string>) {
  const entries = Object.entries(headers);
  if (entries.length > 12) throw new Error("Use at most 12 custom headers.");
  for (const [key,value] of entries) if (!/^[a-zA-Z0-9-]{1,64}$/.test(key) || /^(host|content-length|connection|transfer-encoding|authorization|cookie)$/i.test(key) || /[\r\n]/.test(value)) throw new Error(`Header “${key}” is not allowed.`);
}

export async function GET() {
  const { db,user,tenantId } = await auth();
  if (!user) return NextResponse.json({error:"Unauthorized"},{status:401});
  if (!tenantId) return NextResponse.json({tools:[],mcpConnections:[],builtIns:[]});
  const [{data:rows,error},{data:mcp}] = await Promise.all([
    db.from("custom_tools").select("*").eq("tenant_id",tenantId).order("created_at",{ascending:false}),
    db.from("mcp_connections").select("id,name,endpoint,status,tools,tools_checked_at,last_error").eq("tenant_id",tenantId).order("created_at",{ascending:false}),
  ]);
  if(error) return NextResponse.json({error:"Could not load tool registry. Apply migration_v34.sql."},{status:500});
  const builtIns = [...APPOINTMENT_TOOLS.map((tool) => ({ ...tool, category: "Appointments" })), ...CARE_TOOLS.map((tool) => ({ ...tool, category: "Care plan" })), ...RESERVATION_TOOLS.map((tool) => ({ ...tool, category: "Reservations" }))].map((tool) => ({
    id: tool.function.name,
    name: tool.function.name.split("_").map((part) => part[0].toUpperCase() + part.slice(1)).join(" "),
    category: tool.category,
    description: tool.function.description,
    inputSchema: tool.function.parameters,
  }));
  return NextResponse.json({tools:(rows??[]).map((r)=>publicTool(r as CustomToolRow & Record<string,unknown>)),mcpConnections:mcp??[],builtIns});
}

export async function POST(request: NextRequest) {
  const {db,user,tenantId}=await auth(); if(!user)return NextResponse.json({error:"Unauthorized"},{status:401}); if(!tenantId)return NextResponse.json({error:"No tenant found"},{status:404});
  const rawBody=await request.json().catch(()=>null) as (Record<string,unknown>&{sampleInput?:unknown})|null;
  const parsed=Form.safeParse(rawBody); if(!parsed.success)return NextResponse.json({error:"Invalid custom tool configuration.",issues:parsed.error.issues},{status:400});
  const body=parsed.data; const action=request.nextUrl.searchParams.get("action");
  try {
    safeHeaders(body.headers);
    if(body.secret && !process.env.CREDENTIALS_ENCRYPTION_KEY) throw new Error("Set CREDENTIALS_ENCRYPTION_KEY before saving credentials.");
    const update={tenant_id:tenantId,name:body.name,description:body.description,endpoint:body.endpoint,method:body.method,input_schema:body.inputSchema,headers:body.headers, ...(body.secret?{encrypted_secret:encrypt(body.secret),secret_header:body.secretHeader??"authorization"}:{})};
    if(action==="test") {
      if(!body.id) return NextResponse.json({error:"Save this tool before running a connection test."},{status:400});
      const {data:row,error}=await db.from("custom_tools").select("*").eq("id",body.id).eq("tenant_id",tenantId).single();
      if(error||!row)return NextResponse.json({error:"Tool not found."},{status:404});
      const candidate={...(row as CustomToolRow),...update,encrypted_secret:body.secret?encrypt(body.secret):(row as CustomToolRow).encrypted_secret,secret_header:body.secretHeader??(row as CustomToolRow).secret_header};
      const sampleInput=z.record(z.string(),z.unknown()).safeParse(rawBody?.sampleInput??{});
      if(!sampleInput.success)return NextResponse.json({error:"Sample input must be a JSON object."},{status:400});
      const output=await executeCustomTool(candidate, sampleInput.data);
      await db.from("custom_tools").update({last_tested_at:new Date().toISOString(),last_error:null,status:"active"}).eq("id",body.id).eq("tenant_id",tenantId);
      return NextResponse.json({success:true,output});
    }
    const query=body.id ? db.from("custom_tools").update({...update,updated_at:new Date().toISOString()}).eq("id",body.id).eq("tenant_id",tenantId).select("*").single() : db.from("custom_tools").insert(update).select("*").single();
    const {data,error}=await query; if(error||!data) return NextResponse.json({error:"Could not save tool."},{status:500});
    return NextResponse.json({tool:publicTool(data as CustomToolRow & Record<string,unknown>)},{status:body.id?200:201});
  } catch(error) {
    const message=error instanceof Error?error.message:"Tool operation failed.";
    if(action==="test"&&body.id) await db.from("custom_tools").update({last_tested_at:new Date().toISOString(),last_error:message.slice(0,500)}).eq("id",body.id).eq("tenant_id",tenantId);
    return NextResponse.json({error:message},{status:400});
  }
}

export async function PATCH(request:NextRequest) {
  const {db,user,tenantId}=await auth(); if(!user)return NextResponse.json({error:"Unauthorized"},{status:401}); if(!tenantId)return NextResponse.json({error:"No tenant found"},{status:404});
  const parsed=z.object({id:z.string().uuid(),status:z.enum(["active","disabled"])}).safeParse(await request.json().catch(()=>null)); if(!parsed.success)return NextResponse.json({error:"Invalid tool update."},{status:400});
  const {error}=await db.from("custom_tools").update({status:parsed.data.status,updated_at:new Date().toISOString()}).eq("id",parsed.data.id).eq("tenant_id",tenantId); if(error)return NextResponse.json({error:"Could not update tool."},{status:500}); return NextResponse.json({success:true});
}

export async function DELETE(request:NextRequest) {
  const {db,user,tenantId}=await auth(); if(!user)return NextResponse.json({error:"Unauthorized"},{status:401}); if(!tenantId)return NextResponse.json({error:"No tenant found"},{status:404});
  const id=request.nextUrl.searchParams.get("id"); if(!id||!z.string().uuid().safeParse(id).success)return NextResponse.json({error:"Valid tool id is required."},{status:400});
  const {error}=await db.from("custom_tools").delete().eq("id",id).eq("tenant_id",tenantId); if(error)return NextResponse.json({error:"Could not remove tool."},{status:500}); return NextResponse.json({success:true});
}
