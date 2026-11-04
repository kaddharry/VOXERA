"use client";

import { HelpCircle, TrendingDown } from "lucide-react";
import { GlassCard } from "@/app/_components/GlassCard";
import type { CallInsights } from "@/lib/insights/call-insights";

/**
 * "What the agent can learn from this call" — the post-call findings from
 * lib/insights/analyze-call.ts: questions the agent couldn't answer, and the
 * moments the patient's mood got worse after an agent reply.
 */
export function CallInsightsCard({ insights }: { insights: CallInsights }) {
  const { knowledgeGaps, emotionalFailurePoints } = insights;
  const nothing = knowledgeGaps.length === 0 && emotionalFailurePoints.length === 0;

  return (
    <GlassCard className="p-5">
      <h3 className="text-[13px] font-bold text-[var(--color-text-primary)]">What the agent can learn from this call</h3>
      {nothing ? (
        <p className="mt-1.5 text-[13px] text-[var(--color-text-muted)]">
          No unanswered questions, and the patient&apos;s mood never got worse after one of the agent&apos;s replies.
        </p>
      ) : (
        <div className="mt-3 space-y-5">
          {emotionalFailurePoints.length > 0 && (
            <section>
              <h4 className="mb-2 flex items-center gap-1.5 text-[12px] font-bold uppercase tracking-wide text-red-400">
                <TrendingDown className="h-3.5 w-3.5" /> Emotional failure points ({emotionalFailurePoints.length})
              </h4>
              <ul className="space-y-3">
                {emotionalFailurePoints.map((f) => (
                  <li key={f.turn} className="rounded-xl border border-red-500/25 bg-red-500/5 p-3.5 text-[13px]">
                    <p className="mb-2 font-semibold text-[var(--color-text-primary)]">{f.whatWentWrong}</p>
                    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-[var(--color-text-secondary)]">
                      <dt className="text-[var(--color-text-muted)]">Patient ({f.before.label})</dt>
                      <dd>&ldquo;{f.patientBefore}&rdquo;</dd>
                      <dt className="text-[var(--color-text-muted)]">Agent replied</dt>
                      <dd>&ldquo;{f.agentReply}&rdquo;</dd>
                      <dt className="text-[var(--color-text-muted)]">Patient then ({f.after.label})</dt>
                      <dd>&ldquo;{f.patientAfter}&rdquo;</dd>
                    </dl>
                    <p className="mt-2 text-[11.5px] text-[var(--color-text-muted)]">
                      Turn {f.turn} · mood {f.before.valence} → {f.after.valence}
                      {f.reviewed ? "" : " · not reviewed by AI"}
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {knowledgeGaps.length > 0 && (
            <section>
              <h4 className="mb-2 flex items-center gap-1.5 text-[12px] font-bold uppercase tracking-wide text-amber-400">
                <HelpCircle className="h-3.5 w-3.5" /> Knowledge gaps ({knowledgeGaps.length})
              </h4>
              <ul className="space-y-3">
                {knowledgeGaps.map((g) => (
                  <li key={g.turn} className="rounded-xl border border-amber-500/25 bg-amber-500/5 p-3.5 text-[13px]">
                    <p className="font-semibold text-[var(--color-text-primary)]">&ldquo;{g.question}&rdquo;</p>
                    <p className="mt-1.5 text-[var(--color-text-secondary)]">
                      <span className="text-[var(--color-text-muted)]">Agent replied: </span>&ldquo;{g.agentReply}&rdquo;
                    </p>
                    <p className="mt-2 text-[11.5px] text-[var(--color-text-muted)]">
                      Turn {g.turn}
                      {g.topic ? ` · topic: ${g.topic}` : ""}
                      {g.reviewed ? "" : " · not reviewed by AI"}
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </GlassCard>
  );
}
