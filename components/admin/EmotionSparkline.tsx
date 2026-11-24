"use client";

export interface EmotionPoint {
  ts: number;
  v: number;
  a: number;
  intensity: number;
  label: string;
}

function getBarColor(label: string) {
  switch (label) {
    case "anger":
    case "frustration":
    case "distress":
    case "pain":
      return "bg-red-500";
    case "worry":
    case "fear":
    case "confusion":
    case "disappointment":
      return "bg-amber-500";
    case "joy":
    case "gratitude":
    case "excitement":
    case "relief":
      return "bg-emerald-500";
    default:
      return "bg-cyan-500";
  }
}

export function EmotionSparkline({ history }: { history: EmotionPoint[] }) {
  if (history.length === 0) {
    return (
      <div className="text-xs text-slate-500 italic px-1">
        Emotion trend will appear here as the call progresses…
      </div>
    );
  }

  return (
    <div>
      <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
        Emotion Trend (this call)
      </h3>
      <div className="flex items-end gap-[2px] h-16 bg-slate-950 rounded-lg p-2 border border-slate-800 overflow-hidden">
        {history.map((point, idx) => (
          <div
            key={idx}
            title={`${point.label} · intensity ${(point.intensity * 100).toFixed(0)}%`}
            className={`flex-1 min-w-[3px] rounded-sm transition-all ${getBarColor(point.label)}`}
            style={{ height: `${Math.max(6, point.intensity * 100)}%`, opacity: 0.85 }}
          />
        ))}
      </div>
      <div className="flex justify-between text-[10px] text-slate-600 mt-1 font-mono">
        <span>start</span>
        <span>now</span>
      </div>
    </div>
  );
}
