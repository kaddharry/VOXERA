"use client";

import { useEffect, useRef, useState } from "react";

export default function Overview() {
  return (
    <section id="overview" className="vxl-overview-section">
      <IntroBlock />
      <MediaBlock
        image="https://images.unsplash.com/photo-1519540393135-f52583f80e8a?auto=format&fit=crop&w=900&q=80"
        alt="Patient taking a follow-up call at home"
        title="Books follow-ups automatically"
        description="VOXERA checks your discharge schedule, places the call at the right time, and logs the outcome — synced straight to your care platform."
      />
      <MediaBlock
        reverse
        image="https://images.unsplash.com/photo-1576091160501-bbe57469278b?auto=format&fit=crop&w=900&q=80"
        alt="Clinician reviewing a flagged call on their phone"
        title="Flags concerns and routes them instantly"
        description="VOXERA asks the right recovery questions, scores urgency, and routes anything concerning straight to your care team in real time."
      />
    </section>
  );
}

function IntroBlock() {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const obs = new IntersectionObserver(([entry]) => { if (entry.isIntersecting) setVisible(true); }, { threshold: 0.15 });
    if (ref.current) obs.observe(ref.current);
    return () => obs.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className={`vxl-overview-intro vxl-fade ${visible ? "vxl-visible" : ""}`}
    >
      <span className="vxl-overview-eyebrow">VOXERA calls every patient</span>
      <h2 className="vxl-overview-h2">
        A voice agent that runs
        <br />
        your follow-up program
      </h2>
      <p className="vxl-overview-intro-text">
        No more calls that never happen. VOXERA reaches every patient right on
        schedule, day or night, and sounds like a real member of your care team.
      </p>
    </div>
  );
}

function MediaBlock({
  image,
  alt,
  title,
  description,
  reverse,
}: {
  image: string;
  alt: string;
  title: string;
  description: string;
  reverse?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const obs = new IntersectionObserver(([entry]) => { if (entry.isIntersecting) setVisible(true); }, { threshold: 0.15 });
    if (ref.current) obs.observe(ref.current);
    return () => obs.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className={`vxl-overview-block ${reverse ? "vxl-overview-block-reverse" : ""} vxl-fade ${visible ? "vxl-visible" : ""}`}
    >
      <div className="vxl-overview-media">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={image} alt={alt} />
      </div>
      <div className="vxl-overview-text">
        <h3 className="vxl-overview-title">{title}</h3>
        <p className="vxl-overview-desc">{description}</p>
      </div>
    </div>
  );
}
