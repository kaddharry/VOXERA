"use client";

import Nav from "./landing/Nav";
import Hero from "./landing/Hero";
import Overview from "./landing/Overview";
import HoverGallery from "./landing/HoverGallery";
import Features from "./landing/Features";
import Industries from "./landing/Industries";
import FAQ from "./landing/FAQ";
import CTASection from "./landing/CTASection";
import Footer from "./landing/Footer";

export default function LandingPageClient() {
  return (
    <div className="landing">
      <Nav />
      <main>
        <Hero />
        <Overview />
        <HoverGallery />
        <Features />
        <Industries />
        <FAQ />
        <CTASection />
      </main>
      <Footer />
    </div>
  );
}
