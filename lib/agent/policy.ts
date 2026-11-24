import type { EmotionContext, PolicyDirectives } from "../types";

export function decidePolicy(emotion: EmotionContext): PolicyDirectives {
  const directives: PolicyDirectives = {
    acknowledgeFirst: false,
    pace: "normal",
    allowUpsell: true,
    escalate: "none",
    notes: [],
  };

  // FR-18: Sustained negativity — repeated frustration + high intensity = immediate human escalation
  // Covers "3+ consecutive angry/sad turns → escalate" (SRD FR-18, Sprint 2)
  if (
    emotion.flags.repeated_frustration &&
    emotion.flags.increasing_distress &&
    emotion.current.intensity > 0.7
  ) {
    directives.acknowledgeFirst = true;
    directives.pace = "slow";
    directives.allowUpsell = false;
    directives.escalate = "human";
    directives.safetyScript =
      "Immediately offer to connect the caller to a human specialist. Do not attempt to resolve this yourself.";
    directives.notes.push(
      "SUSTAINED NEGATIVITY: repeated frustration + increasing distress + high intensity — escalate to human NOW."
    );
    return directives;
  }

  if (emotion.flags.increasing_distress || emotion.current.label === "distress") {
    directives.acknowledgeFirst = true;
    directives.pace = "slow";
    directives.allowUpsell = false;
    directives.escalate = emotion.current.intensity > 0.8 ? "human" : "tier2";
    directives.safetyScript = "Offer to connect to a human specialist. Prioritize user safety.";
    directives.notes.push("User shows escalating distress — acknowledge, slow down, escalate.");
    return directives;
  }

  if (emotion.flags.repeated_frustration || emotion.current.label === "frustration") {
    directives.acknowledgeFirst = true;
    directives.pace = "slow";
    directives.allowUpsell = false;
    directives.escalate = "tier2";
    directives.notes.push("Repeated frustration — acknowledge first, no upsell, offer concrete next step.");
    return directives;
  }

  if (emotion.current.label === "anger") {
    directives.acknowledgeFirst = true;
    directives.pace = "slow";
    directives.allowUpsell = false;
    // High-intensity anger escalates to human directly
    directives.escalate = emotion.current.intensity > 0.75 ? "tier2" : "none";
    directives.notes.push("Anger detected — lead with acknowledgement; avoid defensive language.");
    return directives;
  }

  if (emotion.flags.affect_oscillation || emotion.current.label === "confusion") {
    directives.pace = "slow";
    directives.notes.push("User seems confused — shorter turns, one question at a time, confirm understanding.");
    return directives;
  }

  if (emotion.current.label === "joy" || emotion.current.label === "gratitude") {
    directives.notes.push("Positive affect — brief acknowledgement, allow upsell if relevant.");
    return directives;
  }

  return directives;
}


export function policyToPrompt(d: PolicyDirectives, alreadyOfferedHandoff = false): string {
  const parts = [
    `Pace: ${d.pace}.`,
    d.acknowledgeFirst ? "Open with a genuine acknowledgement of the user's feeling BEFORE any procedural content." : "",
    d.allowUpsell ? "" : "Do NOT upsell or suggest paid add-ons.",
    d.escalate !== "none"
      ? alreadyOfferedHandoff
        ? "Escalation is still active, but you already offered to bring someone in earlier this session (see " +
          "STM) — do NOT repeat that offer again. Just keep talking with the caller normally and stay on what " +
          "they're actually saying. Only mention the hand-off again if the caller asks about it or explicitly agrees."
        : "Escalation required: tell the caller ONCE that you're letting the care team know so someone can follow " +
          "up with them (e.g. \"I'll let our care team know so a nurse can follow up with you\"). You cannot transfer " +
          "the call, so never offer to \"connect\" or \"grab\" someone live. If you can book a visit with your tools, offer " +
          "that too. NEVER say the words \"tier\", \"tier 2\", \"tier2\", \"specialist\", or \"escalate\" — internal terms."
      : "",
    d.safetyScript ? `Safety: ${d.safetyScript}` : "",
    ...d.notes.map((n) => `Note: ${n}`),
  ].filter(Boolean);
  return parts.join("\n");
}
