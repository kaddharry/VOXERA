"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

const CALL_EVENTS = [
  "Confirmed Day-3 recovery check-in with Margaret C.",
  "Reported mild fever — flagged for clinician review",
  "Rescheduled a follow-up call to Thursday",
  "Recovery note added to David O.'s chart",
  "Patient asked a question — escalated to care team",
];

export default function Hero() {
  const [revealed, setRevealed] = useState(false);
  const [initialRevealDone, setInitialRevealDone] = useState(false);
  const [activeEvent, setActiveEvent] = useState(0);
  const [eventVisible, setEventVisible] = useState(false);
  const [scrollY, setScrollY] = useState(0);
  const [windowH, setWindowH] = useState(800);

  useEffect(() => {
    setWindowH(window.innerHeight);
    const t1 = setTimeout(() => {
      setRevealed(true);
      const t2 = setTimeout(() => {
        setEventVisible(true);
        const t3 = setTimeout(() => setInitialRevealDone(true), 1050);
        return () => clearTimeout(t3);
      }, 500);
      return () => clearTimeout(t2);
    }, 80);
    return () => clearTimeout(t1);
  }, []);

  useEffect(() => {
    const handleScroll = () => setScrollY(window.scrollY);
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  useEffect(() => {
    if (!eventVisible) return;
    const interval = setInterval(() => {
      setEventVisible(false);
      const t = setTimeout(() => {
        setActiveEvent((prev) => (prev + 1) % CALL_EVENTS.length);
        setEventVisible(true);
      }, 350);
      return () => clearTimeout(t);
    }, 2800);
    return () => clearInterval(interval);
  }, [eventVisible]);

  const scrollProgress = Math.max(0, Math.min(scrollY / (windowH * 0.4), 1));
  const clipInset = scrollProgress * 28;
  const clipRadius = scrollProgress * 44;

  let clipPathValue: string;
  let clipTransition: string;
  if (!revealed) {
    clipPathValue = "inset(50%)";
    clipTransition = "clip-path 1s cubic-bezier(0.22, 1, 0.36, 1)";
  } else if (!initialRevealDone) {
    clipPathValue = "inset(0%)";
    clipTransition = "clip-path 1s cubic-bezier(0.22, 1, 0.36, 1)";
  } else {
    clipPathValue = `inset(${clipInset}px round ${clipRadius}px)`;
    clipTransition = "none";
  }

  return (
    <div className="vxl-hero-wrapper">
      <section
        className="vxl-hero-panel"
        style={{ clipPath: clipPathValue, transition: clipTransition }}
      >
        <video
          className="vxl-hero-video"
          autoPlay
          loop
          muted
          playsInline
          poster="/videos/hero-1-poster.jpg"
        >
          <source src="/videos/hero-1.mp4" type="video/mp4" />
        </video>
        <div className="vxl-hero-video-overlay" aria-hidden />

        <div className="vxl-hero-orbs" aria-hidden>
          <div
            className="vxl-hero-orb-blur"
            style={{ width: 340, height: 340, top: "-6%", left: "-8%", background: "rgba(255,255,255,0.18)" }}
          />
          <div
            className="vxl-hero-orb-blur"
            style={{ width: 280, height: 280, bottom: "-4%", right: "4%", background: "rgba(199,187,250,0.35)", animationDelay: "-3s" }}
          />
        </div>

        <div
          className="vxl-hero-content"
          style={{
            opacity: revealed ? 1 : 0,
            transform: revealed ? "translateY(0)" : "translateY(22px)",
            transition: "opacity 0.9s cubic-bezier(0.22, 1, 0.36, 1) 0.2s, transform 0.9s cubic-bezier(0.22, 1, 0.36, 1) 0.2s",
          }}
        >
          <h1 className="vxl-hero-h1">
            Every patient followed up.
            <br />
            <em className="vxl-accent">Nothing missed.</em>
          </h1>

          <p className="vxl-hero-sub">
            VOXERA calls patients after discharge, checks on recovery, and flags
            anything that needs a clinician — in a voice that sounds human, every time.
          </p>

          <div className="vxl-hero-notification">
            <div
              className="vxl-hero-notification-inner"
              style={{
                opacity: eventVisible ? 1 : 0,
                transform: eventVisible ? "translateY(0)" : "translateY(8px)",
              }}
            >
              <CheckIcon />
              <span className="vxl-hero-notification-text">{CALL_EVENTS[activeEvent]}</span>
            </div>
          </div>
        </div>

        <div className="vxl-hero-cta-row" style={{ opacity: revealed ? 1 : 0 }}>
          <div className="vxl-hero-cta-glass vxl-hero-cta-buttons">
            <Link href="/book-demo" className="vxl-hero-input-btn" style={{ textDecoration: "none" }}>
              Book a Demo
            </Link>
            <Link href="/demo" className="vxl-hero-secondary-btn" style={{ textDecoration: "none" }}>
              Hear a Sample Call
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}

function CheckIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0 }}>
      <circle cx="8" cy="8" r="7" stroke="rgba(255,255,255,0.4)" strokeWidth="1.2" />
      <path d="M5 8L7 10L11 6" stroke="rgba(255,255,255,0.85)" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
