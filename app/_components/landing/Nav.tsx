"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { Menu, X } from "lucide-react";

const NAV_LINKS = [
  { label: "Solutions", href: "#overview" },
  { label: "Industries", href: "#industries" },
];

export default function Nav() {
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const closeMobile = () => setMobileOpen(false);
  const scrolledCls = scrolled ? "vxl-nav-scrolled" : "";

  return (
    <>
      <nav aria-label="Main navigation" className={`vxl-nav-left ${scrolledCls}`}>
        <Link href="/" aria-label="Voxera home" className="vxl-logo">
          <Image src="/images/voxera-logo.png" alt="Voxera" width={22} height={22} className="vxl-logo-mark" priority />
        </Link>

        <div className="vxl-nav-links">
          {NAV_LINKS.map(({ label, href }) => (
            <a key={label} href={href} className="vxl-nav-link">
              {label}
            </a>
          ))}
        </div>

        <button
          type="button"
          className="vxl-nav-burger"
          onClick={() => setMobileOpen((o) => !o)}
          aria-label={mobileOpen ? "Close menu" : "Open menu"}
          aria-expanded={mobileOpen}
        >
          {mobileOpen ? <X size={18} /> : <Menu size={18} />}
        </button>
      </nav>

      <div className={`vxl-nav-right ${scrolledCls}`}>
        <Link href="/book-demo" className="vxl-nav-cta">
          Book a demo
        </Link>
      </div>

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
