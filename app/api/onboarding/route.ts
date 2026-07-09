import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/db/server";
import { processOnboarding } from "@/lib/db/onboarding";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const supabaseServer = await createClient();
    const { data: { user }, error: authErr } = await supabaseServer.auth.getUser();

    // If user is not logged in, we reject the request. 
    // In a full flow, they might sign up during onboarding. For now, we require login.
    if (!user || authErr) {
      return NextResponse.json(
        { error: "You must be logged in to save onboarding progress." },
        { status: 401 }
      );
    }

    const body = await req.json();

    if (!body.businessName || !body.industry || !body.workflow) {
      return NextResponse.json(
        { error: "Missing required fields: businessName, industry, or workflow." },
        { status: 400 }
      );
    }

    const result = await processOnboarding(user.id, {
      businessName: body.businessName,
      industry: body.industry,
      workflow: body.workflow,
      callGoal: body.callGoal || "",
      escalation: body.escalation || "",

      openingTime: body.openingTime || "",
      closingTime: body.closingTime || "",
      
      language: body.language || "English",
      tone: body.tone || "Professional",
      greeting: body.greeting || "",
    });

    return NextResponse.json(result);
  } catch (err: any) {
    console.error("[Onboarding API Error]", err);
    return NextResponse.json(
      { error: err.message || "Internal server error" },
      { status: 500 }
    );
  }
}
