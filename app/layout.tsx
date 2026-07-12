import type { Metadata } from "next";
import { Bricolage_Grotesque, DM_Sans, JetBrains_Mono } from "next/font/google";
import "./globals.css";

/**
 * HEADING FONT — Bricolage Grotesque
 * Matches the bold, tight geometric grotesque used in Obliq-style designs.
 * Weight 800 for big headings, 700 for section titles.
 */
const bricolage = Bricolage_Grotesque({
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
  weight: ["400", "500", "600", "700", "800"],
});

/**
 * BODY FONT — DM Sans
 * Clean, light, modern grotesque. Pairs perfectly with Bricolage for the
 * airy, SaaS-product look (Obliq style). Use 300–400 for body, 500–600 for UI.
 */
const dmSans = DM_Sans({
  subsets: ["latin"],
  variable: "--font-body",
  display: "swap",
  weight: ["300", "400", "500", "600"],
});

/**
 * MONO FONT — JetBrains Mono
 * Keep for admin portal code/log displays and monospaced UI labels.
 */
const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
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
    <html lang="en" className={`${bricolage.variable} ${dmSans.variable} ${jetbrainsMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        {children}
      </body>
    </html>
  );
}
