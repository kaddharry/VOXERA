"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Activity, CalendarCheck, PhoneCall, Scale, Scissors, Home } from "lucide-react";

type TabId = "healthcare" | "restaurant" | "legal" | "salon" | "realestate";

const tabs: Array<{ id: TabId; label: string }> = [
  { id: "healthcare", label: "Healthcare" },
  { id: "restaurant", label: "Restaurant" },
  { id: "legal", label: "Legal" },
  { id: "salon", label: "Salon" },
  { id: "realestate", label: "Real Estate" },
];

const contentMap: Record<TabId, { tag: string, tagColor: string, title: string, desc: string, bullets: string[], icon: any }> = {
  healthcare: {
    tag: "FLAGSHIP",
    tagColor: "var(--color-accent-cyan)",
    title: "Patient Aftercare & Intake",
    desc: "Clinics use VOXERA to automate post-op recovery checks and handle high-volume inbound appointment queries.",
    bullets: ["Outbound wellness checks 24 hours post-procedure", "Inbound symptom triage with safe nurse escalation", "Direct EMR/Calendar integration for booking"],
    icon: Activity,
  },
  restaurant: {
    tag: "POPULAR",
    tagColor: "var(--color-accent-violet)",
    title: "Friday Night Front Desk",
    desc: "Never miss a booking during rush hour. The agent manages the waitlist and answers menu FAQs.",
    bullets: ["Checks table availability in real time", "Answers questions about dietary restrictions", "Handles large party inquiries and routing"],
    icon: CalendarCheck,
  },
  legal: {
    tag: "NEW",
    tagColor: "var(--color-text-primary)",
    title: "Confidential Lead Intake",
    desc: "Law firms capture inbound prospect calls immediately, running through precise qualification scripts.",
    bullets: ["Gathers case details and contact information", "Schedules initial partner consultations", "Maintains strict script adherence and tone"],
    icon: Scale,
  },
  salon: {
    tag: "ESSENTIAL",
    tagColor: "var(--color-accent-cyan)",
    title: "Stylist Scheduling",
    desc: "Automate the front desk so your stylists can focus on the clients in the chair.",
    bullets: ["Books specific services with specific staff", "Handles rescheduling and cancellation policies", "Sends automated SMS confirmation triggers"],
    icon: Scissors,
  },
  realestate: {
    tag: "GROWTH",
    tagColor: "var(--color-accent-violet)",
    title: "Property Inquiry & Viewing",
    desc: "Filter tire-kickers and immediately capture high-intent buyers calling from yard signs.",
    bullets: ["Answers specific property detail FAQs", "Pre-qualifies budget and timeline", "Books calendar slots for open house viewings"],
    icon: Home,
  },
};

export function UseCaseTabs() {
  const [activeTab, setActiveTab] = useState<TabId>("healthcare");

  const activeContent = contentMap[activeTab];
  const Icon = activeContent.icon;

  return (
    <div className="w-full">
      {/* Tab Bar (Scrollable on mobile) */}
      <div className="flex overflow-x-auto pb-4 mb-8 hide-scrollbar border-b border-[var(--color-border-subtle)]">
        <div className="flex gap-2 mx-auto">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`relative px-5 py-2.5 rounded-full text-[14px] font-semibold whitespace-nowrap transition-colors ${
                activeTab === tab.id ? "text-white" : "text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]"
              }`}
            >
              {activeTab === tab.id && (
                <motion.div
                  layoutId="activeTab"
                  className="absolute inset-0 bg-[var(--color-bg-elevated)] border border-[var(--color-border-active)] rounded-full shadow-[0_0_15px_var(--color-accent-glow)] z-0"
                  transition={{ type: "spring", stiffness: 300, damping: 30 }}
                />
              )}
              <span className="relative z-10">{tab.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Content Area */}
      <div className="bg-[var(--color-bg-elevated)] border border-[var(--color-border-subtle)] rounded-2xl p-6 md:p-10 min-h-[400px] overflow-hidden">
        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 10 }}
            transition={{ duration: 0.25 }}
            className="flex flex-col lg:flex-row gap-10"
          >
            {/* Text Side */}
            <div className="flex-1">
              <div className="mb-6">
                <span 
                  className="font-mono text-[10px] font-bold uppercase tracking-[0.15em] px-3 py-1 rounded-full border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)]"
                  style={{ color: activeContent.tagColor }}
                >
                  {activeContent.tag}
                </span>
              </div>
              <div className="icon-orb mb-6">
                <Icon className="w-6 h-6" />
              </div>
              <h3 className="font-display font-bold text-2xl md:text-3xl text-[var(--color-text-primary)] mb-4">{activeContent.title}</h3>
              <p className="text-[var(--color-text-secondary)] text-[16px] leading-relaxed mb-8">{activeContent.desc}</p>
              
              <ul className="space-y-4">
                {activeContent.bullets.map((bullet, idx) => (
                  <li key={idx} className="flex items-start gap-3">
                    <div className="mt-1 w-1.5 h-1.5 rounded-full bg-[var(--color-accent-cyan)] shadow-[0_0_8px_var(--color-accent-cyan)] shrink-0" />
                    <span className="text-[14px] text-[var(--color-text-primary)]">{bullet}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* Mockup Side */}
            <div className="flex-1 hidden md:flex items-center justify-center relative">
              <div className="absolute inset-0 bg-gradient-to-br from-[var(--color-accent-violet)] to-[var(--color-accent-cyan)] opacity-10 rounded-xl blur-xl" />
              <div className="relative w-full aspect-video bg-[var(--color-bg-surface)] border border-[var(--color-border-subtle)] rounded-xl flex items-center justify-center overflow-hidden shadow-2xl">
                 <div className="flex flex-col items-center opacity-30">
                    <Icon className="w-12 h-12 mb-4" />
                    <span className="font-mono text-[12px] uppercase tracking-widest">{activeTab} Workflow Interface</span>
                 </div>
              </div>
            </div>
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
