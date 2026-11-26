/**
 * The scripted calls used for the per-language test videos (docs/LANGUAGE_TEST_SCRIPTS.md) — the SAME lines, so what a
 * person says on camera is exactly what the automated tests assert on. One block per language; same four moments each.
 */
export interface LanguageScenario {
  id: "english" | "hinglish" | "hindi";
  label: string;
  /** The call-language setting the agent runs with (lib/speech/resolve.ts). */
  language: string;
  /** Moment 1: patient answers "how is the pain from last time?" */
  painAnswer: string;
  /** Moment 2: patient answers about the medicine. */
  medicineAnswers: { taken: string; missed: string };
  /** Moment 3: wants a visit, nothing clinical → the agent must NOT book. */
  routineRequest: string;
  /** Moment 4: genuinely serious → the agent books. */
  seriousComplaint: string;
  /** Moment 4b: a mild complaint — noted, but not enough on its own. */
  mildComplaint: string;
}

export const LANGUAGE_SCENARIOS: LanguageScenario[] = [
  {
    id: "english",
    label: "English",
    language: "en-IN",
    painAnswer: "It's a bit better, but at night it's worse again, around a six out of ten.",
    medicineAnswers: { taken: "Yes, I took my metformin this morning and last night.", missed: "No, I forgot my tablet yesterday and the day before." },
    routineRequest: "Hello, could I get an appointment with the doctor sometime next week? Any day is fine.",
    seriousComplaint: "The pain is unbearable and my leg is swollen and hot. It's getting worse.",
    mildComplaint: "I have a little pain in my knee, nothing much.",
  },
  {
    id: "hinglish",
    label: "Hinglish",
    language: "hi-en",
    painAnswer: "Pehle se thoda better hai, par raat ko phir dard badh jata hai, lagbhag six out of ten.",
    medicineAnswers: { taken: "Haan, maine subah aur raat ko metformin ki goli le li thi.", missed: "Nahi, kal aur parso goli lena bhool gaya." },
    routineRequest: "Hello, mujhe agle hafte doctor se appointment chahiye, koi bhi din chalega.",
    seriousComplaint: "Mujhe bahut dard ho raha hai, sujan bhi badh gayi hai aur bukhar bhi hai.",
    mildComplaint: "Thoda dard hai ghutne mein, bas.",
  },
  {
    id: "hindi",
    label: "Hindi",
    language: "hi-IN",
    painAnswer: "पहले से थोड़ा ठीक है, लेकिन रात को फिर दर्द बढ़ जाता है, लगभग छह नंबर का।",
    medicineAnswers: { taken: "हाँ, मैंने सुबह और रात को मेटफॉर्मिन की गोली ले ली थी।", missed: "नहीं, कल और परसों गोली लेना भूल गया।" },
    routineRequest: "नमस्ते, मुझे अगले हफ्ते डॉक्टर से अपॉइंटमेंट चाहिए, कोई भी दिन चलेगा।",
    seriousComplaint: "मुझे बहुत दर्द है, पैर में सूजन है और बुखार भी है।",
    mildComplaint: "घुटने में थोड़ा दर्द है, बस।",
  },
];
