import type { Metadata } from "next";
import localFont from "next/font/local";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { GeistPixelLine } from "geist/font/pixel";
import "@fontsource-variable/inter";
import "./globals.css";
import { TestAgentDrawer } from "./_components/TestAgentDrawer";
import { createClient } from "../lib/db/server";

/**
 * Fonts are vendored locally (app/fonts/) rather than fetched from Google
 * Fonts at build/dev time via next/font/google — that remote fetch was
 * flaky in some environments (Turbopack "Module not found:
 * @vercel/turbopack-next/internal/font/google/font" when the CDN request
 * failed), breaking page renders entirely.
 *
 * The whole app — landing, admin, demo, auth — now shares one font system
 * (Lora display / DM Sans body / DM Mono mono, vendored from the Dialio
 * reference), so these three loaders own the canonical --font-display,
 * --font-body and --font-mono variables directly. They used to be split
 * (Bricolage Grotesque + JetBrains Mono for admin/console, Lora + DM Mono
 * under separate --font-landing-* variables for the landing page only);
 * that split is gone now that every surface uses the same type system.
 */

/**
 * DISPLAY FONT — Lora
 * Serif headlines everywhere, including the italic cut for emphasised
 * phrases ("Nothing missed.", "your front desk").
 */
const lora = localFont({
  src: [
    { path: "./fonts/lora.woff2", weight: "400 700", style: "normal" },
    { path: "./fonts/lora-italic.woff2", weight: "400 700", style: "italic" },
  ],
  variable: "--font-display",
  display: "swap",
});

/**
 * BODY FONT — DM Sans
 */
const dmSans = localFont({
  src: "./fonts/dm-sans.woff2",
  variable: "--font-body",
  display: "swap",
  weight: "300 600",
});

/**
 * MONO FONT — DM Mono
 * Small mono labels (card eyebrows, timestamps, code/log displays).
 */
const dmMono = localFont({
  src: "./fonts/dm-mono.woff2",
  variable: "--font-mono",
  display: "swap",
  weight: "400",
});

/**
 * LANDING PAGE FONTS — the real giga.ai type system, not a lookalike.
 * Geist Sans / Geist Mono / Geist Pixel Line are Vercel's own typefaces
 * (SIL Open Font License, via the `geist` npm package — self-hosted, no
 * runtime fetch), which is what giga.ai's own stylesheet actually loads
 * (confirmed from its computed styles: --sans: "Geist", --mono: "Geist
 * Mono", and its hero h1's font-family is literally "Geist Pixel Line,
 * Geist Mono, monospace"). Inter Variable (also OFL, self-hosted via
 * @fontsource-variable/inter) is giga's body copy face. These three replace
 * the earlier Bricolage Grotesque guess — overriding --font-display,
 * --font-mono and --font-body inside .landing only (see globals.css); the
 * rest of the app keeps Lora/DM Sans/DM Mono untouched.
 */

export const metadata: Metadata = {
  title: "VOXERA — AI Phone Agents That Actually Perform",
  description: "Deploy AI voice agents that answer calls, book appointments, and detect caller emotion in real time. Built for modern businesses.",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // The floating "Talk to the agent" test drawer is a tool for testing an
  // agent you've built — it has no purpose for a signed-out visitor on the
  // public landing/auth/demo pages, where it was previously shown
  // unconditionally and just read as clutter.
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  return (
    <html lang="en" className={`${lora.variable} ${dmSans.variable} ${dmMono.variable} ${GeistSans.variable} ${GeistMono.variable} ${GeistPixelLine.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        {children}
        {user && <TestAgentDrawer />}
      </body>
    </html>
  );
}
