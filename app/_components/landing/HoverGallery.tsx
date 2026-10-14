"use client";

import { useState } from "react";

const PANELS = [
  { label: "Understands your hospital's policies", img: "https://images.unsplash.com/photo-1556745757-8d76bdb6984b?auto=format&fit=crop&w=900&q=80" },
  { label: "Calls every patient", img: "https://images.unsplash.com/photo-1506784983877-45594efa4cbe?auto=format&fit=crop&w=900&q=80" },
  { label: "Books follow-ups", img: "https://images.unsplash.com/photo-1521791136064-7986c2920216?auto=format&fit=crop&w=900&q=80" },
  { label: "Flags symptoms", img: "https://images.unsplash.com/photo-1586282391129-76a6df230234?auto=format&fit=crop&w=900&q=80" },
  { label: "Connects to your EHR", img: "https://images.unsplash.com/photo-1498050108023-c5249f4df085?auto=format&fit=crop&w=900&q=80" },
];

const INTEGRATIONS = [
  { name: "Google Calendar", icon: "https://cdn.jsdelivr.net/npm/simple-icons@v13/icons/googlecalendar.svg" },
  { name: "Calendly", icon: "https://cdn.jsdelivr.net/npm/simple-icons@v13/icons/calendly.svg" },
  { name: "Twilio", icon: "https://cdn.jsdelivr.net/npm/simple-icons@v13/icons/twilio.svg" },
  { name: "Slack", icon: "https://cdn.jsdelivr.net/npm/simple-icons@v13/icons/slack.svg" },
  { name: "Salesforce", icon: "https://cdn.jsdelivr.net/npm/simple-icons@v13/icons/salesforce.svg" },
  { name: "HubSpot", icon: "https://cdn.jsdelivr.net/npm/simple-icons@v13/icons/hubspot.svg" },
];

export default function HoverGallery() {
  const [active, setActive] = useState(0);

  return (
    <section className="vxl-gallery-section">
      <div className="vxl-gallery-head">
        <h2 className="vxl-gallery-h2">Here&rsquo;s how VOXERA helps, every time</h2>
        <p className="vxl-gallery-sub">Hover a panel to see each step your voice agent takes on every single call.</p>
      </div>

      <div className="vxl-gallery-row">
        {PANELS.map((panel, i) => (
          <div
            key={panel.label}
            className={`vxl-gallery-panel ${active === i ? "vxl-gallery-active" : ""}`}
            onMouseEnter={() => setActive(i)}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={panel.img} alt="" />
            <div className="vxl-gallery-panel-overlay" />
            <div className="vxl-gallery-panel-label">
              <span className="vxl-gallery-panel-bar" />
              <span className="vxl-gallery-panel-text">{panel.label}</span>
            </div>
          </div>
        ))}
      </div>

      <div className="vxl-integrations">
        <div className="vxl-integrations-label">Connects to the tools you already use</div>
        <div className="vxl-integrations-row">
          {INTEGRATIONS.map((tool) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={tool.name} src={tool.icon} alt={tool.name} title={tool.name} />
          ))}
        </div>
      </div>
    </section>
  );
}
