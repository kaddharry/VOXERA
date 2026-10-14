"use client";

import Image from "next/image";
import Link from "next/link";

export default function Footer() {
  return (
    <footer className="vxl-footer">
      <div className="vxl-footer-inner">
        <div className="vxl-footer-top">
          <div className="vxl-footer-brand">
            <div className="vxl-footer-brand-row">
              <Image src="/images/voxera-logo.png" alt="Voxera" width={32} height={32} />
            </div>
            <p className="vxl-footer-tagline">
              AI that runs your
              <br />
              patient follow-ups
            </p>
            <Link href="/book-demo" className="vxl-btn-solid vxl-footer-cta">
              Book a Demo
            </Link>
          </div>

          <div className="vxl-footer-links">
            <FooterCol title="Product" links={[{ label: "Features", href: "#features" }, { label: "How it works", href: "#how-it-works" }, { label: "Hear a Sample Call", href: "/demo" }]} />
            <FooterCol title="Company" links={[{ label: "About", href: "#" }, { label: "Careers", href: "#" }, { label: "Contact", href: "#" }]} />
            <FooterCol title="Legal" links={[{ label: "Privacy Policy", href: "#" }, { label: "Terms of Service", href: "#" }]} />
          </div>
        </div>

        <div className="vxl-footer-bottom">
          <span className="vxl-footer-copy">&copy; 2026 Voxera. All rights reserved.</span>
          <span className="vxl-footer-copy">Built for hospitals that never want a follow-up to fall through.</span>
        </div>
      </div>
    </footer>
  );
}

function FooterCol({ title, links }: { title: string; links: { label: string; href: string }[] }) {
  return (
    <div style={{ minWidth: 110 }}>
      <div className="vxl-footer-col-title">{title}</div>
      <div className="vxl-footer-col-links">
        {links.map((link) => (
          <a key={link.label} href={link.href} className="vxl-footer-col-link">
            {link.label}
          </a>
        ))}
      </div>
    </div>
  );
}
