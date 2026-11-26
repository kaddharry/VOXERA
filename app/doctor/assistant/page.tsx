"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Send } from "lucide-react";
import { Card, ErrorNote, Loading, Pill, btnGhost, btnPrimary, fmtDateTime, inputCls, send, useApi } from "../../../components/doctor/ui";

interface Turn { role: "doctor" | "assistant"; content: string }
interface Proposal { title: string; instruction: string }
interface Req { id: string; title: string; proposed_instruction: string; status: "pending" | "approved" | "rejected" | "withdrawn"; review_note: string | null; created_at: string; patientName?: string | null }

const TONE = { pending: "warn", approved: "ok", rejected: "bad", withdrawn: "default" } as const;

function AssistantInner() {
  const search = useSearchParams();
  const patients = useApi<{ patients: Array<{ id: string; name: string }> }>("/api/doctor/patients");
  const mine = useApi<{ requests: Req[] }>("/api/doctor/instruction-requests");
  const [patientId, setPatientId] = useState(search.get("patientId") ?? "");
  const [turns, setTurns] = useState<Turn[]>([{ role: "assistant", content: "Tell me what you want the phone agent to do on calls — for example: “Ask Mr. Rao whether the swelling near the stitches has gone down, every call.” I'll turn it into an instruction your hospital admin can approve." }]);
  const [text, setText] = useState("");
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [thinking, setThinking] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => { endRef.current?.scrollIntoView({ block: "end" }); }, [turns, thinking]);

  async function ask() {
    const message = text.trim();
    if (!message || thinking) return;
    const next = [...turns, { role: "doctor" as const, content: message }];
    setTurns(next); setText(""); setThinking(true); setErr(null); setNotice(null);
    const r = await send<{ reply: string; proposal: Proposal | null }>("/api/doctor/assistant", "POST", { messages: next.filter((t, i) => i > 0 || t.role === "doctor"), patientId: patientId || null });
    setThinking(false);
    if (!r.ok) return setErr(r.data.error ?? "The assistant couldn't answer.");
    setTurns((t) => [...t, { role: "assistant", content: r.data.reply }]);
    if (r.data.proposal) setProposal(r.data.proposal);
  }

  async function submit() {
    if (!proposal) return;
    setErr(null);
    const doctorMessage = turns.filter((t) => t.role === "doctor").map((t) => t.content).join("\n");
    const r = await send("/api/doctor/instruction-requests", "POST", { title: proposal.title, doctorMessage, proposedInstruction: proposal.instruction, patientId: patientId || null, transcript: turns });
    if (!r.ok) return setErr(r.data.error ?? "Could not submit.");
    setNotice("Submitted. Your hospital admin will review it — it only reaches the agent once approved.");
    setProposal(null);
    setTurns((t) => [t[0]]);
    await mine.reload();
  }

  async function withdraw(id: string) {
    const r = await send(`/api/doctor/instruction-requests/${id}`, "DELETE");
    if (!r.ok) setErr(r.data.error ?? "Could not withdraw.");
    await mine.reload();
  }

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div><h1 className="text-[22px] font-semibold">Agent assistant</h1><p className="text-[13px] text-[var(--color-text-muted)]">Chat to write an instruction for the voice agent. A hospital admin approves it before any patient hears it.</p></div>
      <Card>
        <div className="mb-3 flex flex-wrap items-center gap-2 text-[13px]">
          <span className="text-[var(--color-text-muted)]">Applies to</span>
          <select className={`${inputCls} max-w-xs`} value={patientId} onChange={(e) => { setPatientId(e.target.value); setProposal(null); }} aria-label="Patient scope">
            <option value="">All my patients</option>
            {patients.data?.patients.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        <div className="max-h-[22rem] space-y-3 overflow-y-auto rounded-lg border border-[var(--color-border-subtle)] p-3" role="log" aria-live="polite">
          {turns.map((t, i) => (
            <div key={i} className={`flex ${t.role === "doctor" ? "justify-end" : ""}`}>
              <p className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-3.5 py-2 text-[13px] ${t.role === "doctor" ? "bg-[var(--color-accent-violet)] text-white" : "bg-[var(--color-bg-elevated)]"}`}>{t.content}</p>
            </div>
          ))}
          {thinking && <p className="text-[12.5px] text-[var(--color-text-muted)]">Thinking…</p>}
          <div ref={endRef} />
        </div>
        <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); void ask(); }}>
          <input className={inputCls} value={text} onChange={(e) => setText(e.target.value)} placeholder="What should the agent do?" aria-label="Message the assistant" />
          <button className={`${btnPrimary} flex items-center gap-1.5`} disabled={thinking || !text.trim()}><Send className="h-3.5 w-3.5" /> Send</button>
        </form>
        <div className="mt-3 space-y-2"><ErrorNote message={err} />{notice && <p role="status" className="text-[13px] text-emerald-300">{notice}</p>}</div>
      </Card>

      {proposal && (
        <Card title="Proposed instruction">
          <div className="space-y-2">
            <input className={inputCls} value={proposal.title} onChange={(e) => setProposal({ ...proposal, title: e.target.value })} aria-label="Title" />
            <textarea className={inputCls} rows={3} value={proposal.instruction} onChange={(e) => setProposal({ ...proposal, instruction: e.target.value })} aria-label="Instruction" />
            <p className="text-[12px] text-[var(--color-text-muted)]">The agent still follows its safety rules: it won&apos;t diagnose, prescribe or change doses, and escalates emergencies to the care team.</p>
            <div className="flex gap-2"><button className={btnPrimary} onClick={submit}>Submit for admin approval</button><button className={btnGhost} onClick={() => setProposal(null)}>Discard</button></div>
          </div>
        </Card>
      )}

      <Card title="My requests">
        {mine.loading && !mine.data ? <Loading /> : mine.data?.requests.length ? (
          <ul className="divide-y divide-[var(--color-border-subtle)]">
            {mine.data.requests.map((r) => (
              <li key={r.id} className="space-y-1 py-3 text-[13px]">
                <div className="flex flex-wrap items-center justify-between gap-2"><span className="font-medium">{r.title} <span className="font-normal text-[var(--color-text-muted)]">· {r.patientName ? `for ${r.patientName}` : "all my patients"} · {fmtDateTime(r.created_at)}</span></span><Pill tone={TONE[r.status]}>{r.status}</Pill></div>
                <p className="text-[12.5px] text-[var(--color-text-secondary)]">{r.proposed_instruction}</p>
                {r.review_note && <p className="text-[12.5px] text-[var(--color-text-muted)]">Admin: {r.review_note}</p>}
                {(r.status === "pending" || r.status === "approved") && <button className="text-[12.5px] text-[var(--color-text-muted)] hover:text-red-400" onClick={() => withdraw(r.id)}>{r.status === "pending" ? "Withdraw" : "Switch off"}</button>}
              </li>
            ))}
          </ul>
        ) : <p className="text-[13px] text-[var(--color-text-muted)]">No requests yet.</p>}
      </Card>
    </div>
  );
}

export default function DoctorAssistantPage() {
  return <Suspense fallback={<Loading />}><AssistantInner /></Suspense>;
}
