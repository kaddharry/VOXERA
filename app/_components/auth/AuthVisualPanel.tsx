"use client";

import { GrainGradient } from "@paper-design/shaders-react";
import type { ReactNode } from "react";

export function AuthVisualPanel({
  eyebrow,
  headline,
  subtitle,
}: {
  eyebrow: string;
  headline: ReactNode;
  subtitle: string;
}) {
  return (
    <div className="relative flex min-w-0 min-h-[560px] overflow-hidden rounded-md bg-black p-10 text-white sm:p-14 lg:min-h-0">
      <GrainGradient
        speed={1}
        scale={1}
        rotation={0}
        offsetX={0}
        offsetY={0}
        softness={0.5}
        intensity={0.5}
        noise={0.25}
        shape="corners"
        frame={2854.5}
        colors={["#FFFFFF", "#EF5A00", "#EF5A00", "#FFFFFF"]}
        colorBack="#00000000"
        className="absolute inset-0 bg-black"
      />
      <div className="absolute inset-0 bg-gradient-to-r from-black/70 via-black/35 to-transparent" />

      <div className="relative z-10 flex h-full w-full max-w-[440px] flex-col justify-center">
        <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-white/50">
          {eyebrow}
        </span>
        <h2 className="mt-4 text-[32px] font-semibold leading-[1.1] tracking-[-0.02em] text-white sm:text-[38px]">
          {headline}
        </h2>
        <p className="mt-4 text-[15px] leading-relaxed text-white/55">{subtitle}</p>
      </div>
    </div>
  );
}
