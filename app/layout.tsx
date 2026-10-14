import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { TestAgentDrawer } from "./_components/TestAgentDrawer";

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

export const metadata: Metadata = {
  title: "VOXERA — AI Phone Agents That Actually Perform",
  description: "Deploy AI voice agents that answer calls, book appointments, and detect caller emotion in real time. Built for modern businesses.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${lora.variable} ${dmSans.variable} ${dmMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        {children}
        <TestAgentDrawer />
      </body>
    </html>
  );
}
