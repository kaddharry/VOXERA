"use client";

import { useEffect, useRef, useState } from "react";

const STATS = [
  { value: "100%", label: "of discharged patients get called — no list falls through the cracks" },
  { value: "24/7", label: "coverage, including nights, weekends, and holidays" },
  { value: "<1 min", label: "from a flagged symptom to a notification on your care team's desk" },
];

export default function Results() {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const obs = new IntersectionObserver(([entry]) => { if (entry.isIntersecting) setVisible(true); }, { threshold: 0.15 });
    if (ref.current) obs.observe(ref.current);
    return () => obs.disconnect();
  }, []);

  return (
    <section id="results" className="vxl-results-section">
      <div ref={ref} className={`vxl-results-head vxl-fade ${visible ? "vxl-visible" : ""}`}>
        <span className="vxl-results-eyebrow">What that looks like in practice</span>
        <h2 className="vxl-results-h2">The follow-up gap, closed.</h2>
      </div>
      <div className="vxl-results-grid">
        {STATS.map((s, i) => (
          <div key={s.value} className={`vxl-results-stat vxl-fade ${visible ? "vxl-visible" : ""}`} style={{ transitionDelay: visible ? `${i * 90}ms` : "0ms" }}>
            <div className="vxl-results-value">{s.value}</div>
            <p className="vxl-results-label">{s.label}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
