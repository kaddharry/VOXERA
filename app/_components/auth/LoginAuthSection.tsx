"use client";

import Image from "next/image";
import Link from "next/link";
import { FieldBox } from "./FieldBox";
import { AuthVisualPanel } from "./AuthVisualPanel";

type LoginAuthSectionProps = {
  action: (formData: FormData) => void;
  demoRequestId?: string;
  error?: string;
  message?: string;
};

export default function LoginAuthSection({ action, demoRequestId, error, message }: LoginAuthSectionProps) {
  return (
    <section className="min-h-screen bg-[#050505] p-3 text-white antialiased [font-synthesis:none]">
      <div className="grid min-w-0 grid-cols-1 gap-3 min-h-[calc(100vh-1.5rem)] lg:grid-cols-[0.92fr_1.08fr]">
        <div className="flex min-w-0 items-center rounded-md border border-white/10 bg-[#0a0a0a] px-6 py-12 sm:px-10 lg:px-16">
          <div className="mx-auto w-full max-w-[380px]">
            <Link href="/" className="inline-flex items-center gap-2">
              <Image src="/images/voxera-mark.png" alt="" width={22} height={17} className="object-contain" />
              <span className="text-[14px] font-semibold tracking-tight text-white">VOXERA</span>
            </Link>

            <div className="mt-10">
              <h1 className="text-[26px] font-semibold tracking-[-0.02em] sm:text-[28px]">
                Welcome back
              </h1>
              <p className="mt-2 text-[14px] text-white/50">
                Sign in to keep your AI receptionist running
              </p>
            </div>

            {error && (
              <div className="mt-6 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-[13px] text-red-300">
                {error}
              </div>
            )}
            {message && (
              <div className="mt-6 rounded-lg border border-orange-400/30 bg-orange-400/10 p-3 text-[13px] text-orange-200">
                {message}
              </div>
            )}

            <form className="mt-8 space-y-3" action={action}>
              {demoRequestId && <input type="hidden" name="demoRequestId" value={demoRequestId} />}

              <FieldBox id="email" name="email" type="email" label="Email" autoComplete="email" required />
              <FieldBox
                id="password"
                name="password"
                type="password"
                label="Password"
                autoComplete="current-password"
                required
              />

              <button
                type="submit"
                className="mt-5 flex h-12 w-full items-center justify-center rounded-lg bg-white text-[15px] font-semibold text-black transition-colors hover:bg-white/85"
              >
                Sign in
              </button>
            </form>

            <p className="mt-6 text-[13px] text-white/40">
              New to VOXERA?{" "}
              <Link
                href={demoRequestId ? `/signup?demoRequestId=${encodeURIComponent(demoRequestId)}` : "/signup"}
                className="font-medium text-white/70 underline underline-offset-2"
              >
                Create a workspace
              </Link>
            </p>
          </div>
        </div>

        <AuthVisualPanel
          eyebrow="Voxera · AI Receptionist"
          headline={<>Every call answered.</>}
          subtitle="Your AI receptionist picks up, qualifies, and books every caller — so nothing slips through."
        />
      </div>
    </section>
  );
}
