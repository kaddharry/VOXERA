# Per-language test scripts (for the test videos)

The same call is run in **English**, **Hinglish** and **Hindi**. The lines below are the exact ones in
`__tests__/fixtures/language-scenarios.ts`, which `__tests__/agent/language-scenarios.test.ts` asserts on automatically
(severity decision, booking decision, medicine detection, care-plan prompt, language detection) — so the on-camera result and the
automated result are the same thing.

> **Videos have to be recorded by a person** against a running deployment (microphone + a phone or the *Test Agent* page).
> This document is the script and shot list; it does not contain recordings.

## Before recording
* A hospital account with: one doctor (e.g. Dr. Rao) with working hours, one patient assigned to her, an agent with `book_appointment`,
  `check_appointment_availability` and `record_medication_adherence` enabled, and the language set on the agent (see each section).
* The patient has **Metformin 500 mg, twice a day** prescribed (Doctor portal → patient → Prescribe).
* A previous completed call whose summary has *pain: lower back, 6/10* (run one short call first and say "my lower back hurts, about six out of ten",
  or insert it from the Calls page of a seeded account). The next call must then **open by asking about that pain**.
* Screen layout for every take: left = the call (Test Agent or phone), right = *Calls & Insights → Live* (so the emotion and tool events show), then the doctor dashboard at the end.

## The four moments (same in every language)
| # | Moment | What you say | Expected |
|---|---|---|---|
| 1 | **Pain from last call** | (agent opens) → answer the pain question | Agent's FIRST question is how the back pain is now. Asked once. |
| 2 | **Medicine** | taken → missed (two takes) | Agent asks about Metformin, one question; records `taken` / `missed`; after two misses the doctor sees an alert. |
| 3 | **Routine request** | ask for a visit, nothing clinical | Agent does **not** book; says the team will arrange it. A low-priority alert appears. No appointment row. |
| 4 | **Serious complaint** | describe severe, worsening symptoms | Agent checks availability and **books**; the appointment shows severity *serious* on the doctor's calendar. |
| 4b | (optional) mild complaint | "a little pain in the knee" | Not booked (unless the patient is high-risk). |

Then, on the doctor dashboard (not language-specific): the new visit is ranked above the routine one; cancel the routine one with a reason.

## English — `en-IN` (agent language: English or Auto)
1. Pain answer: *"It's a bit better, but at night it's worse again, around a six out of ten."*
2. Medicine: *"Yes, I took my metformin this morning and last night."* → then a second take: *"No, I forgot my tablet yesterday and the day before."*
3. Routine: *"Hello, could I get an appointment with the doctor sometime next week? Any day is fine."*
4. Serious: *"The pain is unbearable and my leg is swollen and hot. It's getting worse."*
4b. Mild: *"I have a little pain in my knee, nothing much."*

## Hinglish — `hi-en` (agent language: Hinglish, or Auto)
Reply language must stay Roman-letter Hinglish for the whole call.
1. Pain answer: *"Pehle se thoda better hai, par raat ko phir dard badh jata hai, lagbhag six out of ten."*
2. Medicine: *"Haan, maine subah aur raat ko metformin ki goli le li thi."* → *"Nahi, kal aur parso goli lena bhool gaya."*
3. Routine: *"Hello, mujhe agle hafte doctor se appointment chahiye, koi bhi din chalega."*
4. Serious: *"Mujhe bahut dard ho raha hai, sujan bhi badh gayi hai aur bukhar bhi hai."*
4b. Mild: *"Thoda dard hai ghutne mein, bas."*

## Hindi — `hi-IN` (agent language: Hindi, or Auto)
Reply language must stay Devanagari Hindi for the whole call.
1. Pain answer: *"पहले से थोड़ा ठीक है, लेकिन रात को फिर दर्द बढ़ जाता है, लगभग छह नंबर का।"*
2. Medicine: *"हाँ, मैंने सुबह और रात को मेटफॉर्मिन की गोली ले ली थी।"* → *"नहीं, कल और परसों गोली लेना भूल गया।"*
3. Routine: *"नमस्ते, मुझे अगले हफ्ते डॉक्टर से अपॉइंटमेंट चाहिए, कोई भी दिन चलेगा।"*
4. Serious: *"मुझे बहुत दर्द है, पैर में सूजन है और बुखार भी है।"*
4b. Mild: *"घुटने में थोड़ा दर्द है, बस।"*

## Shot list (per language, ~3 minutes)
1. Title card: language + date. Show the agent's language setting.
2. Start the call; the agent opens by asking about the back pain. (**Moment 1**)
3. Answer; agent moves to Metformin. Take A: "taken". Show the event `record_medication_adherence → taken` in the live panel. (**Moment 2**)
4. New call, Take B: "missed" twice. Cut to the doctor dashboard → *Medication not being taken* shows the patient.
5. New call: routine request → agent declines to book (**Moment 3**). Cut to *Alerts*: the low-priority "Appointment requested (routine)".
6. New call: serious complaint → agent books. Cut to the doctor's *Appointments*: severity **serious**, priority score. (**Moment 4**)
7. Close-up on the language: confirm the replies stayed in the call's language throughout.

## Pass / fail checklist (per language)
- [ ] First question of the call is about the previous pain (and is not repeated).
- [ ] One question per turn; no list of all medicines at once.
- [ ] `record_medication_adherence` appears in the event log with the right status.
- [ ] Routine request → no booking, polite hand-off, low alert.
- [ ] Serious complaint → booking succeeds, severity *serious*.
- [ ] Reply language/script never switches mid-call.
- [ ] Emergency words (*chest pain / saans nahi aa rahi / सीने में दर्द*) trigger the existing escalation, not a booking flow.
