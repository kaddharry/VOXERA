# Demo script — hospital aftercare pitch

## What this demo needs to prove

1. The agent adapts its *approach* (tone, pacing, what it leads with) based on the patient's detected emotional state, live — not scripted branching, an actual live signal.
2. The agent only ever states facts that are actually in the patient's record — and when it's not sure, it says so instead of guessing.
3. You can see *why* — which engine detected what, which knowledge source a fact came from, and the fusion/retrieval reasoning behind it, live on screen.

## Setup checklist (do this before you're in front of the panel)

1. **Create the agent** in Agent Builder. Suggested system prompt:

   > You are a hospital aftercare follow-up agent calling a patient named Alex Rivera, 4 days after tibia fracture surgery. Speak warmly and plainly, like a caring nurse checking in — not a script reader. Ask how they're doing, listen for anything concerning, and answer questions about their recovery using their patient record. If something sounds like a red-flag symptom, take it seriously and say so clearly rather than downplaying it. If Alex seems discouraged or down, especially about running or the upcoming marathon, acknowledge that genuinely before moving on — don't rush past it.

2. **Upload `docs/demo-patient-knowledge-base.md`** (this folder) as that agent's knowledge base document.
3. **Restart both servers** (`npm run dev:full` and `npm run server`) so the freshly uploaded document and agent are live — same restart step used all through tonight's fixes.
4. **Open `/presentation`** in its own browser tab/window on the projector machine, select the Alex Rivera agent from the "Testing:" dropdown, and do **one full silent test call** yourself beforehand — confirm audio, confirm the engine panels populate, confirm a knowledge-base fact gets cited correctly. Don't let the first real run of this be in front of the panel.
5. Have a **backup**: a screen recording of that successful test call, in case live mic/audio has a bad moment during the actual presentation (venue wifi, projector audio routing, etc. — these are the failure modes that have nothing to do with the product itself).

## Live call sequence

Say these to the agent roughly in order, pausing to narrate the dashboard between turns. You don't need to hit every line verbatim — the point is triggering each behavior, not reciting a script at the panel.

### 1. Open normally
**Say:** *"Hi, this is Alex."*
**Point at:** the orb reacting to your voice, the transcript populating live, the pipeline stage indicator moving through Listen → Analyze → Speak.
**Say to the panel:** "This connects to the same production pipeline our real hospital calls would run on — nothing here is mocked for the demo."

### 2. Trigger the mood-adaptive approach
**Say (flat, discouraged tone):** *"I'm okay I guess. Kind of down about missing the marathon I've been training for."*
**Point at:** the Text Engine and Acoustic Engine panels lighting up, the fusion callout showing what each engine detected and whether they agreed, the final emotion label.
**Say to the panel:** "Watch the tone shift in the reply — the record confirms Alex is a documented post-op depression risk *because* of the missed race, and the agent leads with that instead of jumping straight to logistics. That's not a canned branch, that's the emotion signal changing what the agent says next."

### 3. Trigger a grounded factual answer with visible citation
**Say:** *"Can you remind me when I can start running again?"*
**Point at:** the "Source of Truth — why this reply" panel, specifically the new explainability detail under the retrieved knowledge-base snippet — the actual similarity/importance numbers, and the "why" reasoning string.
**Say to the panel:** "This is pulling the real return-to-running restriction from Alex's actual record, not improvising — and you can see exactly which fact it pulled from and why it ranked that fact as the right one to use."

### 4. Trigger the red-flag / escalation behavior — the actual business case
**Say:** *"My calf's been getting more swollen today and it feels warmer than yesterday."*
**Point at:** the reply itself (should recognize this as a described DVT red flag from the record and respond with appropriate urgency, not a shrug), and the policy/escalation panel if it fires.
**Say to the panel:** "This is the exact scenario the business case is built on — a symptom a patient might dismiss as 'probably nothing,' but that's a documented red flag in their own record. A human aftercare team costs more per patient than most hospitals can staff for every discharge; this doesn't replace clinical judgment, it catches the call that would otherwise never get made."

### 5. Close
**Say:** *"Okay, thank you — that's helpful."*
**Point at:** the session scorecard (turn count, dominant emotion, any escalations) — the kind of summary a real care team would see after the call, not just during it.

## If something breaks live

- **No audio / mic issue:** fall back to the pre-recorded video immediately, don't troubleshoot live in front of the panel.
- **Agent gives an ungrounded/wrong answer:** this is the one thing worth narrating honestly rather than covering — "this is exactly the class of bug we spent tonight hunting down and fixing; here's the explainability panel that made a *previous* version of this bug obvious," and move on. A panel generally trusts a team more for showing they test rigorously than for a demo that never has a hiccup.
- **Latency feels slow:** the real number (verified tonight) is roughly 1-2 seconds to first sound in normal conditions — if it's noticeably slower live, it's very likely Groq's shared free-tier daily quota being near its limit (a known, explained constraint, not a pipeline bug) — mention that plainly rather than let it look unexplained.
