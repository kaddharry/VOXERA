"use client";

import { useMemo, useRef, useState } from "react";
import { Search, Play, Pause, Loader2, Check } from "lucide-react";
import { GNANI_VOICES, type GnaniVoice } from "@/lib/tts/gnani-voices";

const PREVIEW_TEXT = "Namaste! Yeh ek quick preview hai meri voice ka.";

/** Props carry both `voice` and `model` since Gnani voices are model-specific
 * (a voice id alone is ambiguous between timbre-v2.5 and timbre-v3.0, see
 * lib/tts/gnani-voices.ts). `language` filters the list — Timbre v3.0 voices
 * speak every language so they're always shown; Timbre v2.5 voices only
 * speak their one preferred language. */
export function GnaniVoicePicker({
  voice,
  model,
  language,
  onChange,
}: {
  voice: string;
  model: string;
  language: string;
  onChange: (voice: string, model: string) => void;
}) {
  const [search, setSearch] = useState("");
  const [gender, setGender] = useState<"all" | "female" | "male">("all");
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const voices = useMemo(() => {
    const q = search.trim().toLowerCase();
    return GNANI_VOICES.filter((v) => {
      if (v.language !== "all" && v.language !== language) return false;
      if (gender !== "all" && v.gender !== gender) return false;
      if (q && !v.id.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [search, gender, language]);

  const stopPreview = () => {
    audioRef.current?.pause();
    audioRef.current = null;
    setPlayingId(null);
  };

  const preview = async (v: GnaniVoice) => {
    const key = `${v.model}:${v.id}`;
    if (playingId === key) {
      stopPreview();
      return;
    }
    stopPreview();
    setLoadingId(key);
    try {
      const res = await fetch("/api/tts/gnani", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: PREVIEW_TEXT, voice: v.id, model: v.model, language }),
      });
      if (!res.ok) throw new Error("Preview failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.onended = () => {
        setPlayingId(null);
        URL.revokeObjectURL(url);
      };
      setPlayingId(key);
      await audio.play();
    } catch {
      setPlayingId(null);
    } finally {
      setLoadingId(null);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search voices by name…"
            className="w-full pl-8 pr-3 py-2 bg-[var(--color-bg-surface)] border border-[var(--color-border-subtle)] rounded-lg text-[12.5px] text-[var(--color-text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-accent-violet)]"
          />
        </div>
        <select
          value={gender}
          onChange={(e) => setGender(e.target.value as typeof gender)}
          className="px-3 py-2 bg-[var(--color-bg-surface)] border border-[var(--color-border-subtle)] rounded-lg text-[12.5px] text-[var(--color-text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-accent-violet)]"
        >
          <option value="all">Any gender</option>
          <option value="female">Female</option>
          <option value="male">Male</option>
        </select>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-80 overflow-y-auto pr-1">
        {voices.length === 0 && (
          <div className="col-span-full text-center text-[12.5px] text-[var(--color-text-muted)] py-8">
            No voices match your filters.
          </div>
        )}
        {voices.map((v) => {
          const key = `${v.model}:${v.id}`;
          const selected = voice === v.id && model === v.model;
          const isLoading = loadingId === key;
          const isPlaying = playingId === key;
          return (
            <div
              key={key}
              className={`flex items-center gap-2.5 px-3 py-2.5 rounded-xl border transition-all ${
                selected
                  ? "border-[var(--color-border-active)] bg-[var(--color-bg-base)] shadow-[0_0_10px_var(--color-accent-glow)]"
                  : "border-[var(--color-border-subtle)] hover:border-[var(--color-border-active)]"
              }`}
            >
              <button
                type="button"
                onClick={() => preview(v)}
                disabled={isLoading}
                title={isPlaying ? "Stop preview" : "Preview this voice"}
                className="flex-none w-7 h-7 rounded-full flex items-center justify-center bg-[var(--color-bg-surface)] text-[var(--color-text-secondary)] hover:text-[var(--color-accent-cyan)] transition-colors disabled:opacity-50"
              >
                {isLoading ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : isPlaying ? (
                  <Pause className="w-3.5 h-3.5" />
                ) : (
                  <Play className="w-3.5 h-3.5 ml-0.5" />
                )}
              </button>

              <button type="button" onClick={() => onChange(v.id, v.model)} className="min-w-0 flex-1 text-left">
                <div className="flex items-center gap-1.5">
                  <span className="text-[13px] font-semibold text-[var(--color-text-primary)] truncate">{v.id}</span>
                  <span className="text-[10.5px] text-[var(--color-text-muted)] flex-none">· {v.model === "timbre-v3.0" ? "all languages" : v.language}</span>
                </div>
                <div className="text-[10.5px] text-[var(--color-text-muted)] truncate capitalize">
                  {v.gender} · {v.model}
                </div>
              </button>

              {selected && <Check className="w-4 h-4 text-[var(--color-accent-cyan)] flex-none" />}
            </div>
          );
        })}
      </div>
    </div>
  );
}
