"use client";

import { CursorGlow } from "./CursorGlow";
import Nav from "./landing/Nav";
import Hero from "./landing/Hero";
import LiveDemo from "./landing/LiveDemo";
import Overview from "./landing/Overview";
import HoverGallery from "./landing/HoverGallery";
import Results from "./landing/Results";
import Features from "./landing/Features";
import Industries from "./landing/Industries";
import FAQ from "./landing/FAQ";
import CTASection from "./landing/CTASection";
import Footer from "./landing/Footer";

export default function LandingPageClient() {
  return (
    <div className="landing">
      <CursorGlow />
      <Nav />
      <main>
        <Hero />
        <LiveDemo />
        <Overview />
        <HoverGallery />
        <Results />
        <Features />
        <Industries />
        <FAQ />
        <CTASection />
      </main>
      <Footer />
    </div>
  );
}
