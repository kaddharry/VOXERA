"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { Menu, X } from "lucide-react";

const NAV_LINKS = [
  { label: "Solutions", href: "#overview" },
  { label: "How it works", href: "#features" },
  { label: "Industries", href: "#industries" },
];

export default function Nav() {
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [bannerOpen, setBannerOpen] = useState(true);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const closeMobile = () => setMobileOpen(false);

  return (
    <>
      {bannerOpen && (
        <div className="vxl-announcement">
          <span className="vxl-announcement-tag">New</span>
          <span>Symptom escalation now flags concerns in under a minute.</span>
          <a href="#features" className="vxl-announcement-link">
            Learn more
          </a>
          <button
            type="button"
            className="vxl-announcement-close"
            onClick={() => setBannerOpen(false)}
            aria-label="Dismiss the announcement"
          >
            <X size={14} />
          </button>
        </div>
      )}

      <nav
        aria-label="Main navigation"
        className={`vxl-nav-bar ${scrolled ? "vxl-nav-scrolled" : ""} ${bannerOpen ? "" : "vxl-nav-no-banner"}`}
      >
        <div className="vxl-nav-left-group">
          <Link href="/" aria-label="Voxera home" className="vxl-logo">
            <Image src="/images/voxera-mark.png" alt="Voxera" width={52} height={40} className="vxl-logo-mark" priority />
          </Link>

          <div className="vxl-nav-links">
            {NAV_LINKS.map(({ label, href }) => (
              <a key={label} href={href} className="vxl-nav-link">
                {label}
              </a>
            ))}
          </div>
        </div>

        <div className="vxl-nav-right">
          <Link href="/login" className="vxl-nav-login">
            Log in
          </Link>
          <Link href="/book-demo" className="vxl-nav-cta">
            Book a demo
          </Link>

          <button
            type="button"
            className="vxl-nav-burger"
            onClick={() => setMobileOpen((o) => !o)}
            aria-label={mobileOpen ? "Close menu" : "Open menu"}
            aria-expanded={mobileOpen}
          >
            {mobileOpen ? <X size={18} /> : <Menu size={18} />}
          </button>
        </div>
      </nav>

      {mobileOpen && (
        <nav className="vxl-nav-mobile-panel">
          {NAV_LINKS.map(({ label, href }) => (
            <a key={label} href={href} className="vxl-nav-mobile-link" onClick={closeMobile}>
              {label}
            </a>
          ))}
          <Link href="/demo" className="vxl-nav-mobile-link" onClick={closeMobile}>
            Hear a sample call
          </Link>
          <Link href="/login" className="vxl-nav-mobile-link" onClick={closeMobile}>
            Log in
          </Link>
          <Link href="/book-demo" className="vxl-nav-cta vxl-nav-mobile-cta" onClick={closeMobile}>
            Book a demo
          </Link>
        </nav>
      )}
    </>
  );
}
