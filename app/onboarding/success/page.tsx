import Link from "next/link";
import { CheckCircle, ArrowRight, Settings } from "lucide-react";

export const metadata = {
  title: "Agent Created",
  description: "Your VOXERA voice agent is ready to test.",
};

export default async function OnboardingSuccessPage({
  searchParams,
}: {
  searchParams: Promise<{ agentId?: string }>;
}) {
  const { agentId } = await searchParams;
  const testHref = agentId ? `/demo?agentId=${encodeURIComponent(agentId)}` : "/demo";

  return (
    <main className="voxera-admin-dark min-h-screen flex flex-col items-center justify-center bg-[var(--color-bg-base)] text-[var(--color-text-primary)] font-body p-6 text-center">
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-[var(--color-accent-violet)] rounded-full blur-[150px] opacity-10 pointer-events-none" />

      <div className="relative z-10 flex flex-col items-center max-w-lg">
        <div className="w-20 h-20 bg-emerald-950/30 border border-emerald-900/50 rounded-full flex items-center justify-center mb-8">
          <CheckCircle className="w-10 h-10 text-emerald-500" />
        </div>

        <h1 className="font-display font-extrabold text-4xl tracking-tighter text-[var(--color-text-primary)] mb-4">
          Your agent is ready
        </h1>
        <p className="text-[16px] text-[var(--color-text-secondary)] leading-relaxed mb-10">
          It's live with the prompt and knowledge you gave it. Talk to it right now in the live test
          drawer, or head to Agent Builder to keep refining it or set up a real phone number.
        </p>

        <div className="flex flex-col sm:flex-row items-center gap-4">
          <Link
            href={testHref}
            className="group flex items-center gap-2 px-6 py-3 rounded-xl btn-gradient text-[14px] font-semibold text-white"
          >
            Talk to your agent <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-1" />
          </Link>
          <Link
            href="/admin/agents"
            className="flex items-center gap-2 px-6 py-3 rounded-xl border border-[var(--color-border-subtle)] text-[14px] font-semibold text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:border-[var(--color-border-active)] transition-colors"
          >
            <Settings className="w-4 h-4" /> Open Agent Builder
          </Link>
        </div>
      </div>
    </main>
  );
}
