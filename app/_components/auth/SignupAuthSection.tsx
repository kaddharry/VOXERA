"use client";

import Image from "next/image";
import Link from "next/link";
import { FieldBox } from "./FieldBox";
import { AuthVisualPanel } from "./AuthVisualPanel";

type SignupAuthSectionProps = {
  action: (formData: FormData) => void;
  demoRequestId?: string;
  error?: string;
};

export default function SignupAuthSection({ action, demoRequestId, error }: SignupAuthSectionProps) {
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
                Create your workspace
              </h1>
              <p className="mt-2 text-[14px] text-white/50">
                Set up VOXERA for your business in minutes
              </p>
            </div>

            {error && (
              <div className="mt-6 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-[13px] text-red-300">
                {error}
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
                autoComplete="new-password"
                required
                minLength={6}
              />

              <button
                type="submit"
                className="mt-5 flex h-12 w-full items-center justify-center rounded-lg bg-white text-[15px] font-semibold text-black transition-colors hover:bg-white/85"
              >
                Create workspace
              </button>
            </form>

            <p className="mt-6 text-[13px] text-white/40">
              Already have an account?{" "}
              <Link
                href={demoRequestId ? `/login?demoRequestId=${encodeURIComponent(demoRequestId)}` : "/login"}
                className="font-medium text-white/70 underline underline-offset-2"
              >
                Sign in
              </Link>
            </p>
          </div>
        </div>

        <AuthVisualPanel
          eyebrow="Voxera · AI Receptionist"
          headline={<>Never miss a call again.</>}
          subtitle="Set up your AI receptionist once — it handles every call, every time, from here on."
        />
      </div>
    </section>
  );
}
