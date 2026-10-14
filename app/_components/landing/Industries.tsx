"use client";

import { useEffect, useRef, useState } from "react";
import { Building2, Stethoscope, Home, Users, Video, HeartPulse } from "lucide-react";

const INDUSTRIES = [
  { icon: <Building2 size={20} />, title: "Hospitals", desc: "Calls every discharged patient on schedule and flags anything that needs a clinician." },
  { icon: <Stethoscope size={20} />, title: "Outpatient Clinics", desc: "Confirms appointments, checks on recovery, and reduces no-shows automatically." },
  { icon: <Home size={20} />, title: "Home Health", desc: "Checks in between visits so nothing falls through the cracks between appointments." },
  { icon: <Users size={20} />, title: "Skilled Nursing", desc: "Follows up after transfers and surfaces concerns to the care team fast." },
  { icon: <Video size={20} />, title: "Telehealth", desc: "Extends your care team's reach with calls that feel personal, not automated." },
  { icon: <HeartPulse size={20} />, title: "Specialty Practices", desc: "Runs structured follow-up protocols for post-procedure recovery." },
];

export default function Industries() {
  const ref = useRef<HTMLElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const obs = new IntersectionObserver(([entry]) => { if (entry.isIntersecting) setVisible(true); }, { threshold: 0.1 });
    if (ref.current) obs.observe(ref.current);
    return () => obs.disconnect();
  }, []);

  return (
    <section ref={ref} id="industries" className="vxl-industries-section">
      <div
        className="vxl-industries-head"
        style={{
          opacity: visible ? 1 : 0,
          transform: visible ? "translateY(0)" : "translateY(20px)",
          transition: "opacity 0.6s ease, transform 0.6s ease",
        }}
      >
        <h2 className="vxl-industries-h2">Built for every care setting</h2>
        <p className="vxl-industries-sub">VOXERA adapts its voice, script, and workflows to whatever your care team needs.</p>
      </div>

      <div className="vxl-industries-grid">
        {INDUSTRIES.map((ind, i) => (
          <div
            key={ind.title}
            className="vxl-industry-card"
            style={{
              opacity: visible ? 1 : 0,
              transform: visible ? "translateY(0)" : "translateY(24px)",
              transition: `opacity 0.55s ease ${i * 0.08}s, transform 0.55s ease ${i * 0.08}s`,
            }}
          >
            <div className="vxl-industry-icon">{ind.icon}</div>
            <h3 className="vxl-industry-title">{ind.title}</h3>
            <p className="vxl-industry-desc">{ind.desc}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
