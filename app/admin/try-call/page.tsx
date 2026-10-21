import { redirect } from "next/navigation";
import Link from "next/link";
import { PhoneCall } from "lucide-react";
import { createClient } from "../../../lib/db/server";
import { VoiceAgent } from "../../_components/VoiceAgent";

export const metadata = {
  title: "Try a Call — VOXERA",
};

export default async function TryCallPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const sessionId = crypto.randomUUID();

  await supabase.from("call_logs").insert({
    id: sessionId,
    clientId: user.id,
    callerNumber: "Browser Demo",
    status: "active",
    startedAt: Date.now(),
    sessionId,
  });

  return (
    <div className="flex h-full flex-col font-body">
      {/* Compact single-line header — matches the rest of the admin shell;
          the breadcrumb above already names this page. */}
      <header className="flex flex-none items-center gap-2 border-b border-[var(--color-border-subtle)] px-6 py-3 md:px-10">
        <PhoneCall className="h-4 w-4 flex-none text-[var(--color-accent-cyan)]" />
        <span className="text-[13px] font-semibold text-[var(--color-text-primary)]">Test Agent</span>
        <span className="hidden truncate text-[12px] text-[var(--color-text-muted)] sm:inline">
          · speak or type as a caller — this session is live, watch it react on the{" "}
          <Link href="/admin/live_dashboard" className="text-[var(--color-accent-cyan)] hover:underline">
            Live Calls
          </Link>{" "}
          page
        </span>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-6 md:p-10">
        <div className="mx-auto max-w-4xl">
          <VoiceAgent sessionId={sessionId} clientId={user.id} userId={user.id} />
        </div>
      </div>
    </div>
  );
}
