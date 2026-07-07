"use client";

import { motion } from "framer-motion";
import Link from "next/link";
import Image from "next/image";
import { useState } from "react";
import { Mic, PhoneCall, BarChart3, Shield, Calendar, Brain, Check, ChevronRight } from "lucide-react";

/* ─── Shared animation presets ───────────────────────────────────────────── */
const fadeUp = {
  hidden: { opacity: 0, y: 32 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.65, ease: "easeOut" as const } },
};
const stagger = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.11 } },
};

/* ═══════════════════════════════════════════════════════════════════════════ */
export default function LandingPage() {
  return (
    <div className="landing">
      <LandingNav />
      <HeroSection />
      <ValuePropsRow />
      <HowItWorksSection />
      <TestimonialsSection />
      <TrendingSection />
      <LandingFooter />
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────── */
/* 1. NAVBAR                                                                   */
/* ─────────────────────────────────────────────────────────────────────────── */
function LandingNav() {
  return (
    <header className="lp-nav">
      <div className="lp-nav-inner">
        {/* Logo */}
        <Link href="/" className="lp-logo">
          <span className="lp-logo-icon"><Mic size={17} color="#fff" strokeWidth={2.5} /></span>
          <span className="lp-logo-wordmark">Voxera</span>
        </Link>

        {/* Nav links */}
        <nav className="lp-nav-links">
          {[["Features", "#features"], ["Blog", "#blog"], ["Contact", "#contact"]].map(([label, href]) => (
            <a key={label} href={href} className="lp-nav-link">{label}</a>
          ))}
        </nav>

        {/* CTA */}
        <Link href="/onboarding" className="lp-nav-cta">Get Template</Link>
      </div>
    </header>
  );
}

/* ─────────────────────────────────────────────────────────────────────────── */
/* 2. HERO                                                                     */
/* ─────────────────────────────────────────────────────────────────────────── */
function HeroSection() {
  return (
    <section className="lp-hero">
      {/* Cloud gradient backdrop */}
      <div className="lp-hero-bg" aria-hidden />

      <div className="lp-hero-content">
        {/* Eyebrow pill */}
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.55, ease: "easeOut" }}
          className="lp-eyebrow">
          <span className="lp-eyebrow-icon">✦</span>
          <span className="lp-eyebrow-bold">Get Pro 15%</span>
          <span className="lp-eyebrow-sep" />
          <span className="lp-eyebrow-light">Join the waitlist for an instant offer</span>
        </motion.div>

        {/* H1 */}
        <motion.h1 initial={{ opacity: 0, y: 22 }} animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.65, delay: 0.1, ease: "easeOut" }}
          className="lp-h1">
          AI Phone Agents Powered<br />by Advanced Voice Search
        </motion.h1>

        {/* Sub */}
        <motion.p initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.65, delay: 0.18, ease: "easeOut" }}
          className="lp-hero-sub">
          Train VOXERA on your business knowledge. It answers calls, books appointments,<br className="lp-br" />
          detects caller emotion, and escalates intelligently — 24/7.
        </motion.p>

        {/* CTA */}
        <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.26, ease: "easeOut" }}>
          <Link href="/onboarding" className="lp-cta-btn">
            Get Started Free <ChevronRight size={15} strokeWidth={2.5} />
          </Link>
        </motion.div>
      </div>

      {/* Product screenshot */}
      <motion.div initial={{ opacity: 0, y: 64 }} animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 1.0, delay: 0.3, ease: "easeOut" }}
        className="lp-hero-mockup-wrap">
        <div className="lp-hero-mockup">
          <Image
            src="/images/voxera-creative-platform.png"
            alt="VOXERA Platform Dashboard"
            width={1080}
            height={680}
            priority
            className="lp-hero-mockup-img"
          />
        </div>
      </motion.div>
    </section>
  );
}

/* ─────────────────────────────────────────────────────────────────────────── */
/* 3. THREE VALUE-PROP CARDS                                                   */
/* ─────────────────────────────────────────────────────────────────────────── */
function ValuePropsRow() {
  const cards = [
    {
      cls: "lp-vp-purple",
      title: "Speak Now",
      body: "Initiate AI voice calls by tapping the mic — hands-free and instant.",
    },
    {
      cls: "lp-vp-teal",
      title: "Let AI Do the Work",
      body: "Our AI instantly finds and summarizes content tailored to your business mindset.",
    },
    {
      cls: "lp-vp-lavender",
      title: "Read or Hear It",
      body: "Choose summaries, full reads, or audio — it&apos;s all up to you.",
    },
  ];

  return (
    <section className="lp-vp-section">
      {cards.map((c, i) => (
        <motion.div key={i} className={`lp-vp-card ${c.cls}`}
          initial={{ opacity: 0, y: 24 }} whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }} transition={{ delay: i * 0.1, duration: 0.55, ease: "easeOut" }}>
          <h3 className="lp-vp-title">{c.title}</h3>
          <p className="lp-vp-body" dangerouslySetInnerHTML={{ __html: c.body }} />
        </motion.div>
      ))}
    </section>
  );
}

/* ─────────────────────────────────────────────────────────────────────────── */
/* 4. FEATURES + HOW IT WORKS                                                  */
/* ─────────────────────────────────────────────────────────────────────────── */
function HowItWorksSection() {
  const steps = [
    { num: "01", title: "Uniquely Trained", desc: "Upload PDFs, menus, SOPs. VOXERA learns your exact business policies." },
    { num: "02", title: "Clean. Fast. Ad-Free.", desc: "Sub-second responses, no hold music, no upsells — pure answers." },
    { num: "03", title: "No Missed Calls", desc: "24/7 availability. Every call answered, logged, transcribed." },
    { num: "04", title: "Trusted by Businesses", desc: "From clinics to law firms — any workflow, any volume." },
  ];
  const stats = [
    { value: "$33M+", label: "Effortless, Frustration-Free Searching" },
    { value: "70%",   label: "Our Customer Retention" },
    { value: "65%",   label: "Report Feeling More Informed" },
    { value: "45%",   label: "Less Time Wasted Searching" },
  ];
  const features = [
    { icon: <Mic size={20} />,         title: "Voice-First Experience",  desc: "Speak, don't type. Interact naturally with our AI using hands-free voice commands." },
    { icon: <Brain size={20} />,       title: "Smart Memory Search",     desc: "Say what you need — we'll find it. AI understands context and delivers precise results." },
    { icon: <Calendar size={20} />,    title: "Instant Booking",         desc: "Get to the point faster. AI-powered real-time calendar availability and booking." },
    { icon: <BarChart3 size={20} />,   title: "Real-Time Analytics",     desc: "No delays. Enjoy lightning-fast results powered by live emotion scoring." },
  ];
  const tags = ["AI Voice Calls", "AI Generator", "Smart Audio", "API Integration", "Noise Cancellation", "Auto Booking", "Live Emotion AI"];

  return (
    <>
      {/* Features grid + tag cloud */}
      <section id="features" className="lp-features-section">
        <div className="lp-features-inner">
          {/* Left: header + 2×2 grid */}
          <div className="lp-features-left">
            <motion.div initial="hidden" whileInView="visible" viewport={{ once: true }} variants={stagger}>
              <motion.span variants={fadeUp} className="lp-pill-label">Features</motion.span>
              <motion.h2 variants={fadeUp} className="lp-section-h2" style={{ marginTop: 16, marginBottom: 40 }}>
                Learn Smarter, Just by Speaking<br />— Powered by Voice AI
              </motion.h2>
              <motion.div variants={stagger} className="lp-features-grid">
                {features.map((f, i) => (
                  <motion.div key={i} variants={fadeUp} className="lp-feature-card">
                    <span className="lp-feature-icon">{f.icon}</span>
                    <h3 className="lp-feature-title">{f.title}</h3>
                    <p className="lp-feature-desc">{f.desc}</p>
                  </motion.div>
                ))}
              </motion.div>
            </motion.div>
          </div>

          {/* Right: label + tag cloud */}
          <div className="lp-features-right">
            <motion.p initial={{ opacity: 0 }} whileInView={{ opacity: 1 }} viewport={{ once: true }}
              transition={{ duration: 0.6 }} className="lp-features-tagline">
              From Voice Commands to Custom Summaries — It&apos;s All Effortless
            </motion.p>
            <motion.div initial="hidden" whileInView="visible" viewport={{ once: true }} variants={stagger}
              className="lp-tag-cloud">
              {tags.map((tag, i) => (
                <motion.span key={tag} variants={fadeUp}
                  transition={{ delay: i * 0.07 }}
                  className="lp-tag-chip">
                  {tag}
                </motion.span>
              ))}
            </motion.div>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="lp-hiw-section">
        <div className="lp-section-container">
          <motion.div initial="hidden" whileInView="visible" viewport={{ once: true }} variants={stagger}
            className="lp-hiw-header">
            <motion.span variants={fadeUp} className="lp-pill-label">How it works</motion.span>
            <motion.h2 variants={fadeUp} className="lp-section-h2" style={{ marginTop: 16 }}>
              Designed Around Your<br />Business
            </motion.h2>
          </motion.div>

          <motion.div initial="hidden" whileInView="visible" viewport={{ once: true }} variants={stagger}
            className="lp-hiw-grid">
            {steps.map((s, i) => (
              <motion.div key={i} variants={fadeUp} className="lp-hiw-card">
                <div className="lp-hiw-num">{s.num}</div>
                <h3 className="lp-hiw-title">{s.title}</h3>
                <p className="lp-hiw-desc">{s.desc}</p>
              </motion.div>
            ))}
          </motion.div>

          {/* Stats row */}
          <motion.div initial="hidden" whileInView="visible" viewport={{ once: true }} variants={stagger}
            className="lp-stats-row">
            {stats.map((s, i) => (
              <motion.div key={i} variants={fadeUp} className="lp-stat-card">
                <div className="lp-stat-orb">↗</div>
                <div className="lp-stat-value">{s.value}</div>
                <div className="lp-stat-label">{s.label}</div>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>
    </>
  );
}

/* ─────────────────────────────────────────────────────────────────────────── */
/* 5. TESTIMONIALS                                                             */
/* ─────────────────────────────────────────────────────────────────────────── */
function TestimonialsSection() {
  return (
    <section className="lp-testimonials-section">
      <div className="lp-section-container">
        <motion.div initial="hidden" whileInView="visible" viewport={{ once: true }} variants={stagger}
          className="lp-testimonials-header">
          <div>
            <motion.span variants={fadeUp} className="lp-pill-label">How it works</motion.span>
            <motion.h2 variants={fadeUp} className="lp-section-h2" style={{ marginTop: 16 }}>
              What Our Voice AI<br />Users Are Saying
            </motion.h2>
          </div>
          <motion.p variants={fadeUp} className="lp-testimonials-sub">
            See why users love the convenience and intelligence of our voice solutions
          </motion.p>
        </motion.div>

        {/* Bento grid */}
        <motion.div initial="hidden" whileInView="visible" viewport={{ once: true }} variants={stagger}
          className="lp-bento-grid">

          {/* Big purple stat card */}
          <motion.div variants={fadeUp} className="lp-bento-purple">
            <div className="lp-bento-stat-row">
              <div className="lp-bento-big-stat">10X</div>
              <div>
                <div className="lp-bento-stat-label">Revenue Boost</div>
                <div className="lp-bento-logo">LOCDO</div>
              </div>
            </div>
            <p className="lp-bento-quote">
              "With VOXERA, we&apos;ve streamlined our project management, reducing time spent on administrative tasks. It&apos;s user-friendly, and our team is now more efficient than ever."
            </p>
            <div className="lp-bento-author">
              <div className="lp-bento-avatar">JM</div>
              <div>
                <div className="lp-bento-name">John Matthews</div>
                <div className="lp-bento-role">Project Manager</div>
              </div>
              <span className="lp-x-badge">𝕏</span>
            </div>
          </motion.div>

          {/* Small mint stat card */}
          <motion.div variants={fadeUp} className="lp-bento-mint">
            <div className="lp-bento-big-stat lp-mint-stat">2X</div>
            <div className="lp-bento-stat-label lp-mint-label">Increase Efficiency</div>
            <div className="lp-bento-logo lp-mint-logo">logoipsum™</div>
          </motion.div>

          {/* Quote card 1 */}
          <motion.div variants={fadeUp} className="lp-bento-quote-card">
            <p className="lp-bento-quote-text">
              "I love how Velora&apos;s AI Summary saves time by giving instant insights from our complex workflows."
            </p>
            <div className="lp-bento-author">
              <div className="lp-bento-avatar lp-avatar-cyan">EC</div>
              <div>
                <div className="lp-bento-name">Ethan Carter</div>
                <div className="lp-bento-role">Product Designer</div>
              </div>
              <span className="lp-x-badge lp-x-dark">𝕏</span>
            </div>
          </motion.div>

          {/* Quote card 2 */}
          <motion.div variants={fadeUp} className="lp-bento-quote-card">
            <p className="lp-bento-quote-text">
              "Velora&apos;s 2-way translation has been a game-changer for our global team&apos;s seamless communication."
            </p>
            <div className="lp-bento-author">
              <div className="lp-bento-avatar lp-avatar-violet">CR</div>
              <div>
                <div className="lp-bento-name">Carlos Rivera</div>
                <div className="lp-bento-role">Global Project Manager</div>
              </div>
              <span className="lp-x-badge lp-x-dark">𝕏</span>
            </div>
          </motion.div>

          {/* Big quote bottom */}
          <motion.div variants={fadeUp} className="lp-bento-quote-card lp-bento-wide">
            <p className="lp-bento-quote-text">
              "With VOXERA, we&apos;ve streamlined our project management, reducing time spent on administrative tasks. It&apos;s user-friendly, and our team is now more efficient than ever."
            </p>
            <div className="lp-bento-author">
              <div className="lp-bento-avatar">JM</div>
              <div>
                <div className="lp-bento-name">John Matthews</div>
                <div className="lp-bento-role">Project Manager</div>
              </div>
              <span className="lp-x-badge lp-x-dark">𝕏</span>
            </div>
          </motion.div>

          {/* 5X stat */}
          <motion.div variants={fadeUp} className="lp-bento-stat-sm lp-bento-indigo">
            <div className="lp-bento-big-stat">5X</div>
            <div className="lp-bento-stat-label">Team Growth</div>
            <div className="lp-bento-logo" style={{ color: "#4F46E5", marginTop: 12 }}>BOGO</div>
          </motion.div>

          {/* 3X stat */}
          <motion.div variants={fadeUp} className="lp-bento-stat-sm lp-bento-purple-light">
            <div className="lp-bento-big-stat lp-purple-stat">3X</div>
            <div className="lp-bento-stat-label lp-purple-stat">Increased Productivity</div>
            <div className="lp-bento-logo" style={{ color: "#7C3AED", marginTop: 12 }}>🔷 logoipsum</div>
          </motion.div>
        </motion.div>
      </div>
    </section>
  );
}

/* ─────────────────────────────────────────────────────────────────────────── */
/* 6. TRENDING / CTA SECTION                                                   */
/* ─────────────────────────────────────────────────────────────────────────── */
function TrendingSection() {
  return (
    <section className="lp-trending-section">
      <div className="lp-section-container">
        <motion.div initial="hidden" whileInView="visible" viewport={{ once: true }} variants={stagger}
          className="lp-trending-header">
          <motion.span variants={fadeUp} className="lp-pill-label">How it works</motion.span>
          <motion.h2 variants={fadeUp} className="lp-section-h2" style={{ marginTop: 16 }}>
            Discover Trending Topics,<br />Curated by AI for You
          </motion.h2>
        </motion.div>

        {/* Banner card */}
        <motion.div initial={{ opacity: 0, y: 32 }} whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }} transition={{ duration: 0.7, ease: "easeOut" }}
          className="lp-trending-banner">

          <div className="lp-trending-banner-left">
            <h3 className="lp-trending-banner-title">
              Because Your Business Deserves<br />Meaningful Automation.
            </h3>
            <p className="lp-trending-banner-sub">
              When your call volume grows, VOXERA adapts — handling every caller with context, care, and intelligence.
            </p>
            <Link href="/onboarding" className="lp-trending-btn">Learn More →</Link>
          </div>

          {/* Pricing cards floating on the right */}
          <div className="lp-trending-cards">
            {[
              { plan: "Starter", price: "Free", color: "#7C3AED", features: ["1 Agent", "100 mins/mo", "Basic KB"] },
              { plan: "Growth", price: "₹4,999", color: "#059669", features: ["5 Agents", "Unlimited mins", "Emotion AI"] },
            ].map(p => (
              <div key={p.plan} className="lp-price-card">
                <div className="lp-price-plan">{p.plan}</div>
                <div className="lp-price-amount" style={{ color: p.color }}>{p.price}</div>
                {p.features.map(f => (
                  <div key={f} className="lp-price-feature">
                    <Check size={12} color={p.color} />
                    <span>{f}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </motion.div>
      </div>
    </section>
  );
}

/* ─────────────────────────────────────────────────────────────────────────── */
/* 7. FOOTER                                                                   */
/* ─────────────────────────────────────────────────────────────────────────── */
function LandingFooter() {
  return (
    <footer className="lp-footer">
      <div className="lp-footer-inner">
        <div className="lp-footer-logo">
          <span className="lp-logo-icon lp-logo-icon-sm"><Mic size={14} color="#fff" /></span>
          <span className="lp-logo-wordmark" style={{ fontSize: 15 }}>Voxera</span>
        </div>
        <div className="lp-footer-links">
          {["Features", "Pricing", "Blog", "Docs", "Privacy", "Terms"].map(l => (
            <a key={l} href="#" className="lp-footer-link">{l}</a>
          ))}
        </div>
        <p className="lp-footer-copy">© 2026 VOXERA. All rights reserved.</p>
      </div>
    </footer>
  );
}
