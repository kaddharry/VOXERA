"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { PhoneCall, Loader2, CheckCircle2, XCircle, ArrowRight } from "lucide-react";

interface DemoRequest {
  id: string;
  hospitalName: string;
  phone: string;
  consent: boolean;
  status: "awaiting_account" | "ready" | "calling" | "completed" | "failed" | "cancelled";
}

/**
 * Spec §5.3 steps 4-10: link the request to the now-authenticated account,
 * show a brief review/consent confirmation, place the call, and show
 * status through to completion with a clear next step either way.
 *
 * useSearchParams() requires a Suspense boundary at build time (Next.js
 * prerenders this route and needs a fallback for the client-only read of
 * the URL's ?id= — without this wrapper, `next build` fails outright
 * rather than just warning).
 */
export default function BookDemoConfirmPage() {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen bg-[var(--color-bg-base)] flex items-center justify-center">
          <Loader2 className="w-5 h-5 animate-spin text-[var(--color-text-muted)]" />
        </main>
      }
    >
      <BookDemoConfirmInner />
    </Suspense>
  );
}

function BookDemoConfirmInner() {
  const params = useSearchParams();
  const router = useRouter();
  const id = params.get("id");

  const [request, setRequest] = useState<DemoRequest | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [calling, setCalling] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!id) {
      setError("Missing demo request id.");
      return;
    }
    // Idempotent: links the request to this account if not already linked,
    // then fetches its current state either way.
    fetch(`/api/demo-requests/${id}`, { method: "POST" })
      .then((r) => r.json())
      .then((d) => {
        if (d.request) setRequest(d.request);
        else setError(d.error || "This demo request could not be found.");
      })
      .catch(() => setError("Something went wrong loading your request."));
  }, [id]);

  useEffect(() => {
    if (!id || !request) return;
    if (request.status !== "calling") {
      if (pollRef.current) clearInterval(pollRef.current);
      return;
    }
    pollRef.current = setInterval(() => {
      fetch(`/api/demo-requests/${id}`)
        .then((r) => r.json())
        .then((d) => {
          if (d.request) setRequest(d.request);
        })
        .catch(() => {});
    }, 3000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
    // Deliberately keyed on request?.status, not the whole `request` object
    // — polling should only start/stop on a status transition, not restart
    // every time setRequest replaces the object with an identical status
    // (e.g. the poll's own tick).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, request?.status]);

  async function startCall() {
    if (!id) return;
    setCalling(true);
    setError(null);
    try {
      const res = await fetch(`/api/demo-requests/${id}/call`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to start the demo call.");
        return;
      }
      setRequest((r) => (r ? { ...r, status: "calling" } : r));
    } finally {
      setCalling(false);
    }
  }

  return (
    <main className="min-h-screen bg-[var(--color-bg-base)] font-body text-[var(--color-text-primary)] flex items-center justify-center p-6">
      <div className="w-full max-w-md bg-[var(--color-bg-elevated)] rounded-2xl border border-[var(--color-border-subtle)] shadow-[0_0_40px_var(--color-accent-glow)] p-8">
        {error && !request ? (
          <>
            <p className="text-[14px] text-red-500 mb-4">{error}</p>
            <Link href="/book-demo" className="text-[13px] text-[var(--color-accent-cyan)] font-semibold hover:underline">
              Start a new demo request
            </Link>
          </>
        ) : !request ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="w-5 h-5 animate-spin text-[var(--color-text-muted)]" />
          </div>
        ) : request.status === "ready" ? (
          <>
            <h1 className="font-display font-bold text-xl mb-2">Confirm your demo call</h1>
            <p className="text-[13.5px] text-[var(--color-text-secondary)] mb-6">
              We'll call <span className="font-semibold text-[var(--color-text-primary)]">{request.phone}</span>{" "}
              with a sample conversation for {request.hospitalName}.
            </p>
            {error && <p className="text-[13px] text-red-500 mb-4">{error}</p>}
            <button
              onClick={startCall}
              disabled={calling}
              className="group flex items-center justify-center gap-2 w-full px-4 py-3 text-[14px] font-semibold text-white btn-gradient rounded-xl transition-all hover:scale-[1.01] disabled:opacity-50"
            >
              {calling ? <Loader2 className="w-4 h-4 animate-spin" /> : <PhoneCall className="w-4 h-4" />}
              Call me now
            </button>
          </>
        ) : request.status === "calling" ? (
          <div className="text-center py-6">
            <Loader2 className="w-8 h-8 animate-spin text-[var(--color-accent-violet)] mx-auto mb-4" />
            <h1 className="font-display font-bold text-xl mb-2">Calling {request.phone}…</h1>
            <p className="text-[13.5px] text-[var(--color-text-secondary)]">This page updates automatically once the call ends.</p>
          </div>
        ) : request.status === "completed" ? (
          <div className="text-center py-4">
            <CheckCircle2 className="w-10 h-10 text-emerald-500 mx-auto mb-4" />
            <h1 className="font-display font-bold text-xl mb-2">Demo call complete</h1>
            <p className="text-[13.5px] text-[var(--color-text-secondary)] mb-6">
              Ready to set up VOXERA for {request.hospitalName}?
            </p>
            <button
              onClick={() => router.push("/onboarding")}
              className="group flex items-center justify-center gap-2 w-full px-4 py-3 text-[14px] font-semibold text-white btn-gradient rounded-xl transition-all hover:scale-[1.01]"
            >
              Continue setup <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-1" />
            </button>
          </div>
        ) : (
          <div className="text-center py-4">
            <XCircle className="w-10 h-10 text-red-500 mx-auto mb-4" />
            <h1 className="font-display font-bold text-xl mb-2">The call didn't connect</h1>
            <p className="text-[13.5px] text-[var(--color-text-secondary)] mb-6">
              No charge for this attempt — you can try again or continue setting up your workspace.
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setRequest((r) => (r ? { ...r, status: "ready" } : r))}
                className="flex-1 px-4 py-2.5 rounded-xl bg-[var(--color-bg-surface)] border border-[var(--color-border-subtle)] text-[13.5px] font-semibold text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
              >
                Try again
              </button>
              <button
                onClick={() => router.push("/onboarding")}
                className="flex-1 px-4 py-2.5 rounded-xl btn-gradient text-white text-[13.5px] font-semibold"
              >
                Continue setup
              </button>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
