"use client";

import { useEffect, useState, useRef } from "react";
import { Check, Upload, Sparkles, MessageSquare, Phone, Volume2, ShieldAlert } from "lucide-react";

const VOICE_PERSONAS = [
  { id: "female-friendly", label: "Female · Friendly", model: "aura-asteria-en" },
  { id: "male-formal", label: "Male · Formal", model: "aura-orion-en" },
  { id: "female-formal", label: "Female · Formal", model: "aura-athena-en" },
  { id: "male-friendly", label: "Male · Friendly", model: "aura-arcas-en" },
];

export default function SettingsPage() {
  const [selectedVoice, setSelectedVoice] = useState("female-friendly");
  const [voiceProvider, setVoiceProvider] = useState<string | null>(null);
  const [customVoiceId, setCustomVoiceId] = useState<string | null>(null);
  
  const [greeting, setGreeting] = useState("Welcome to Hotel Paradise. How may I assist you today?");
  
  // Customer Recovery Settings
  const [recoveryEnabled, setRecoveryEnabled] = useState(false);
  const [recoveryTemplate, setRecoveryTemplate] = useState("Hi, we noticed you had a less than stellar experience today. Please let us make it up to you: {{link}}");
  const [recoveryLink, setRecoveryLink] = useState("");
  
  const [cloningStatus, setCloningStatus] = useState<"idle" | "uploading" | "success" | "error">("idle");
  const [cloningError, setCloningError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load settings on mount
  useEffect(() => {
    // 1. Fetch voice settings
    fetch("/api/settings/voice")
      .then((res) => res.json())
      .then((data) => {
        if (data.voice_persona) setSelectedVoice(data.voice_persona);
        if (data.voice_provider) setVoiceProvider(data.voice_provider);
        if (data.custom_voice_id) setCustomVoiceId(data.custom_voice_id);
      })
      .catch((err) => console.error("Failed to load voice settings:", err));

    // 2. Fetch recovery settings
    fetch("/api/settings/recovery")
      .then((res) => res.json())
      .then((data) => {
        if (data.sms_recovery_enabled !== undefined) setRecoveryEnabled(data.sms_recovery_enabled);
        if (data.sms_recovery_template) setRecoveryTemplate(data.sms_recovery_template);
        if (data.sms_recovery_link) setRecoveryLink(data.sms_recovery_link);
        if (data.greeting) setGreeting(data.greeting);
      })
      .catch((err) => console.error("Failed to load recovery settings:", err));
  }, []);

  const handleSaveSettings = async () => {
    try {
      const response = await fetch("/api/settings/recovery", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enabled: recoveryEnabled,
          template: recoveryTemplate,
          link: recoveryLink,
          greeting: greeting,
        }),
      });

      if (!response.ok) throw new Error("Failed to save recovery settings");
      
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      console.error(err);
    }
  };

  const handleVoicePersonaSelect = async (personaId: string) => {
    setSelectedVoice(personaId);
    setVoiceProvider(null);
    setCustomVoiceId(null);
    
    try {
      const formData = new FormData();
      formData.append("action", "select-persona");
      formData.append("persona", personaId);
      await fetch("/api/settings/voice", {
        method: "POST",
        body: formData,
      });
    } catch (err) {
      console.error("Failed to select voice persona:", err);
    }
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setCloningStatus("uploading");
    setCloningError(null);

    const formData = new FormData();
    formData.append("file", file);

    try {
      const response = await fetch("/api/settings/voice", {
        method: "POST",
        body: formData,
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to clone voice");

      setVoiceProvider("elevenlabs");
      setCustomVoiceId(data.voiceId);
      setSelectedVoice("custom");
      setCloningStatus("success");
    } catch (err: any) {
      setCloningStatus("error");
      setCloningError(err.message || "An error occurred during voice cloning");
    }
  };

  const handleClearCustomVoice = async () => {
    setVoiceProvider(null);
    setCustomVoiceId(null);
    setSelectedVoice("female-friendly");

    try {
      const formData = new FormData();
      formData.append("action", "clear");
      await fetch("/api/settings/voice", {
        method: "POST",
        body: formData,
      });
    } catch (err) {
      console.error("Failed to clear custom voice:", err);
    }
  };

  return (
    <div className="p-6 md:p-10 font-body min-h-screen">
      <header className="mb-10">
        <h1 className="font-display text-3xl font-extrabold tracking-tight text-[var(--color-text-primary)]">Settings</h1>
        <p className="text-[15px] text-[var(--color-text-secondary)] mt-2">
          Configure your AI receptionist's voice, greetings, and customer recovery triggers.
        </p>
      </header>

      <div className="max-w-3xl space-y-8">
        {/* Custom Greeting Section */}
        <section className="bg-[var(--color-bg-elevated)] border border-[var(--color-border-subtle)] rounded-2xl p-6 md:p-8 shadow-[0_4px_30px_rgba(0,0,0,0.5)]">
          <div className="flex items-center gap-3 mb-4">
            <MessageSquare className="w-5 h-5 text-[var(--color-accent-cyan)]" />
            <h2 className="text-[14px] font-mono font-bold uppercase tracking-widest text-[var(--color-text-primary)]">Custom Greeting</h2>
          </div>
          <p className="text-[14px] text-[var(--color-text-muted)] mb-4">
            Specify the initial welcome message your AI receptionist will say when answering inbound calls.
          </p>
          <textarea
            value={greeting}
            onChange={(e) => setGreeting(e.target.value)}
            rows={3}
            className="w-full px-4 py-3 bg-[var(--color-bg-surface)] border border-[var(--color-border-subtle)] rounded-xl focus:ring-1 focus:ring-[var(--color-accent-cyan)] focus:border-[var(--color-accent-cyan)] text-[14px] text-[var(--color-text-primary)] transition-colors placeholder:text-[var(--color-text-muted)] resize-none"
            placeholder="Welcome to Hotel Paradise. How may I assist you today?"
          />
        </section>

        {/* Voice Persona Section */}
        <section className="bg-[var(--color-bg-elevated)] border border-[var(--color-border-subtle)] rounded-2xl p-6 md:p-8 shadow-[0_4px_30px_rgba(0,0,0,0.5)]">
          <div className="flex items-center gap-3 mb-4">
            <Volume2 className="w-5 h-5 text-[var(--color-accent-cyan)]" />
            <h2 className="text-[14px] font-mono font-bold uppercase tracking-widest text-[var(--color-text-primary)]">Voice Persona & Cloning</h2>
          </div>
          <p className="text-[14px] text-[var(--color-text-muted)] mb-6">
            Choose a default voice persona or upload a custom audio sample to clone a branded voice.
          </p>
          
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6">
            {VOICE_PERSONAS.map((persona) => (
              <button
                key={persona.id}
                onClick={() => handleVoicePersonaSelect(persona.id)}
                className={`flex items-center gap-3 p-4 rounded-xl border text-left transition-all ${
                  selectedVoice === persona.id
                    ? "border-[var(--color-border-active)] bg-[var(--color-bg-base)] shadow-[0_0_15px_var(--color-accent-glow)]"
                    : "border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] hover:border-[var(--color-border-active)]"
                }`}
              >
                <div
                  className={`w-4 h-4 rounded-full flex-none flex items-center justify-center border ${
                    selectedVoice === persona.id ? "border-[var(--color-accent-cyan)] bg-[var(--color-accent-cyan)]/20" : "border-[var(--color-border-subtle)] bg-[var(--color-bg-base)]"
                  }`}
                >
                  {selectedVoice === persona.id && <div className="w-1.5 h-1.5 rounded-full bg-[var(--color-accent-cyan)]" />}
                </div>
                <div>
                  <div className={`text-[14px] font-semibold ${selectedVoice === persona.id ? 'text-[var(--color-text-primary)]' : 'text-[var(--color-text-secondary)]'}`}>{persona.label}</div>
                  <div className="text-[10px] font-mono text-[var(--color-text-muted)] mt-0.5">{persona.model}</div>
                </div>
              </button>
            ))}

            {/* Custom Voice Card */}
            {customVoiceId && (
              <div
                className={`flex items-center justify-between p-4 rounded-xl border transition-all sm:col-span-2 ${
                  selectedVoice === "custom"
                    ? "border-[var(--color-border-active)] bg-[var(--color-bg-base)] shadow-[0_0_15px_var(--color-accent-glow)]"
                    : "border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)]"
                }`}
              >
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => setSelectedVoice("custom")}
                    className={`w-4 h-4 rounded-full flex-none flex items-center justify-center border ${
                      selectedVoice === "custom" ? "border-[var(--color-accent-cyan)] bg-[var(--color-accent-cyan)]/20" : "border-[var(--color-border-subtle)] bg-[var(--color-bg-base)]"
                    }`}
                  >
                    {selectedVoice === "custom" && <div className="w-1.5 h-1.5 rounded-full bg-[var(--color-accent-cyan)]" />}
                  </button>
                  <div>
                    <div className="text-[14px] font-semibold text-[var(--color-text-primary)] flex items-center gap-2">
                      Custom Voice Persona <Sparkles className="w-3.5 h-3.5 text-yellow-400" />
                    </div>
                    <div className="text-[10px] font-mono text-[var(--color-text-muted)] mt-0.5">
                      {voiceProvider === "elevenlabs" ? "ElevenLabs" : "Deepgram"} ID: {customVoiceId}
                    </div>
                  </div>
                </div>
                <button
                  onClick={handleClearCustomVoice}
                  className="text-[12px] font-semibold text-red-400 hover:text-red-300 transition-colors"
                >
                  Delete Clone
                </button>
              </div>
            )}
          </div>

          {/* Voice Cloning Box */}
          <div className="bg-[var(--color-bg-base)] border border-[var(--color-border-subtle)] rounded-xl p-6">
            <h3 className="text-[13px] font-bold uppercase tracking-wider text-[var(--color-text-primary)] mb-2">Clone a New Branded Voice</h3>
            <p className="text-[13px] text-[var(--color-text-muted)] mb-4">
              Upload a 10-30s audio sample (.mp3, .wav) containing clean speech to clone your custom voice.
            </p>
            
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileUpload}
              accept="audio/*"
              className="hidden"
            />
            
            <div className="flex flex-col sm:flex-row items-center gap-4">
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={cloningStatus === "uploading"}
                className="flex items-center gap-2 px-4 py-2.5 bg-[var(--color-bg-surface)] hover:bg-[var(--color-bg-elevated)] border border-[var(--color-border-subtle)] hover:border-[var(--color-border-active)] text-[13px] font-semibold text-[var(--color-text-primary)] rounded-lg transition-all"
              >
                <Upload className="w-4 h-4" />
                Upload Audio Sample
              </button>

              {cloningStatus === "uploading" && (
                <span className="text-[13px] text-[var(--color-accent-cyan)] font-mono animate-pulse">
                  Cloning voice in progress...
                </span>
              )}
              {cloningStatus === "success" && (
                <span className="text-[13px] text-emerald-400 font-mono flex items-center gap-1 font-semibold">
                  <Check className="w-4 h-4" /> Cloned successfully!
                </span>
              )}
              {cloningStatus === "error" && (
                <span className="text-[13px] text-red-400 font-mono font-semibold">
                  {cloningError || "Cloning failed"}
                </span>
              )}
            </div>
          </div>
        </section>

        {/* Customer Recovery Section */}
        <section className="bg-[var(--color-bg-elevated)] border border-[var(--color-border-subtle)] rounded-2xl p-6 md:p-8 shadow-[0_4px_30px_rgba(0,0,0,0.5)]">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <Phone className="w-5 h-5 text-[var(--color-accent-cyan)]" />
              <h2 className="text-[14px] font-mono font-bold uppercase tracking-widest text-[var(--color-text-primary)]">Customer Recovery</h2>
            </div>
            
            <button
              onClick={() => setRecoveryEnabled(!recoveryEnabled)}
              className={`w-12 h-6 rounded-full transition-all relative ${
                recoveryEnabled ? "bg-[var(--color-accent-cyan)]" : "bg-[var(--color-bg-base)] border border-[var(--color-border-subtle)]"
              }`}
            >
              <div
                className={`w-4 h-4 rounded-full bg-white absolute top-1 transition-all ${
                  recoveryEnabled ? "right-1" : "left-1"
                }`}
              />
            </button>
          </div>
          
          <p className="text-[14px] text-[var(--color-text-muted)] mb-6">
            Automatically trigger a post-call SMS follow-up if a customer ends their call with a negative sentiment or high frustration level.
          </p>

          <div className={`space-y-4 transition-all duration-300 ${recoveryEnabled ? "opacity-100 pointer-events-auto" : "opacity-40 pointer-events-none"}`}>
            <div>
              <label className="block text-[12px] font-bold uppercase tracking-wider text-[var(--color-text-secondary)] mb-2">SMS Message Template</label>
              <textarea
                value={recoveryTemplate}
                onChange={(e) => setRecoveryTemplate(e.target.value)}
                rows={3}
                className="w-full px-4 py-3 bg-[var(--color-bg-surface)] border border-[var(--color-border-subtle)] rounded-xl focus:ring-1 focus:ring-[var(--color-accent-cyan)] focus:border-[var(--color-accent-cyan)] text-[14px] text-[var(--color-text-primary)] transition-colors placeholder:text-[var(--color-text-muted)] resize-none"
                placeholder="We noticed you had a bad experience. Use {{link}} to get in touch."
              />
              <span className="text-[11px] text-[var(--color-text-muted)] mt-1 block">
                Use <code className="font-mono text-cyan-400 bg-cyan-950/20 px-1 py-0.5 rounded">{"{{link}}"}</code> as a placeholder for your support link.
              </span>
            </div>

            <div>
              <label className="block text-[12px] font-bold uppercase tracking-wider text-[var(--color-text-secondary)] mb-2">Support & Feedback Link</label>
              <input
                type="text"
                value={recoveryLink}
                onChange={(e) => setRecoveryLink(e.target.value)}
                className="w-full px-4 py-3 bg-[var(--color-bg-surface)] border border-[var(--color-border-subtle)] rounded-xl focus:ring-1 focus:ring-[var(--color-accent-cyan)] focus:border-[var(--color-accent-cyan)] text-[14px] text-[var(--color-text-primary)] transition-colors placeholder:text-[var(--color-text-muted)]"
                placeholder="https://voxera.ai/support"
              />
            </div>
          </div>
        </section>

        {/* Global Save */}
        <div className="flex items-center gap-4 pt-4">
          <button
            onClick={handleSaveSettings}
            className="px-6 py-2.5 text-[14px] font-semibold text-white btn-gradient rounded-xl transition-all hover:scale-[1.02] shadow-[0_0_15px_var(--color-accent-glow)]"
          >
            Save Settings
          </button>
          {saved && (
            <span className="flex items-center gap-1 text-[13px] text-emerald-400 font-medium font-mono">
              <Check className="w-4 h-4" /> Settings saved successfully
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
