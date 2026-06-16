"use client";

import { useEffect, useState } from "react";

const VOICE_PERSONAS = [
  { id: "female-friendly", label: "Female · Friendly", model: "aura-asteria-en" },
  { id: "male-formal", label: "Male · Formal", model: "aura-orion-en" },
  { id: "female-formal", label: "Female · Formal", model: "aura-athena-en" },
  { id: "male-friendly", label: "Male · Friendly", model: "aura-arcas-en" },
];

export default function SettingsPage() {
  const [selectedVoice, setSelectedVoice] = useState("female-friendly");
  const [greeting, setGreeting] = useState("Welcome to Hotel Paradise. How may I assist you today?");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    // Load saved settings from localStorage
    const savedVoice = localStorage.getItem("voxera_voice_persona");
    const savedGreeting = localStorage.getItem("voxera_greeting");
    if (savedVoice) setSelectedVoice(savedVoice);
    if (savedGreeting) setGreeting(savedGreeting);
  }, []);

  const handleSave = () => {
    localStorage.setItem("voxera_voice_persona", selectedVoice);
    localStorage.setItem("voxera_greeting", greeting);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="p-8 font-sans text-gray-900 bg-white min-h-screen">
      <header className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
        <p className="text-gray-500 mt-2">
          Configure your AI receptionist's voice, tone, and greeting message.
        </p>
      </header>

      <div className="max-w-2xl space-y-8">
        {/* Voice Persona Section */}
        <section className="bg-gray-50 border border-gray-200 rounded-xl p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Voice Persona (FR-25)</h2>
          <p className="text-sm text-gray-500 mb-4">
            Select the voice and tone your AI receptionist will use when speaking to customers.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {VOICE_PERSONAS.map((persona) => (
              <button
                key={persona.id}
                onClick={() => setSelectedVoice(persona.id)}
                className={`flex items-center gap-3 p-4 rounded-lg border-2 text-left transition-all ${
                  selectedVoice === persona.id
                    ? "border-blue-500 bg-blue-50"
                    : "border-gray-200 bg-white hover:border-gray-300"
                }`}
              >
                <div
                  className={`w-3 h-3 rounded-full flex-none ${
                    selectedVoice === persona.id ? "bg-blue-500" : "bg-gray-300"
                  }`}
                />
                <div>
                  <div className="font-medium text-gray-900">{persona.label}</div>
                  <div className="text-xs text-gray-500 font-mono">{persona.model}</div>
                </div>
              </button>
            ))}
          </div>
        </section>

        {/* Custom Greeting Section */}
        <section className="bg-gray-50 border border-gray-200 rounded-xl p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Custom Greeting</h2>
          <p className="text-sm text-gray-500 mb-4">
            The first thing your AI receptionist says when answering a call.
          </p>
          <textarea
            value={greeting}
            onChange={(e) => setGreeting(e.target.value)}
            rows={3}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg shadow-sm focus:ring-blue-500 focus:border-blue-500 text-sm text-gray-900 bg-white"
            placeholder="Welcome to Hotel Paradise. How may I assist you today?"
          />
        </section>

        {/* Save Button */}
        <div className="flex items-center gap-4">
          <button
            onClick={handleSave}
            className="px-6 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
          >
            Save Settings
          </button>
          {saved && (
            <span className="text-sm text-green-600 font-medium">Settings saved!</span>
          )}
        </div>
      </div>
    </div>
  );
}
