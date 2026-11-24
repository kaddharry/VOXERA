/**
 * Hand-labelled emotion test set: what a patient or caller actually says on a hospital call, in the four ways
 * they say it (English, Hindi in Devanagari, Hinglish in Roman letters, Punjabi in Gurmukhi).
 * Ground truth is the emotion a careful human listener would name from the WORDS alone.
 * Used by the regression test and by scripts/emotion-eval.ts (accuracy + confusion matrix).
 */
export type Lang = "en" | "hi" | "hinglish" | "pa";
export interface Case { text: string; label: string; lang: Lang }

const c = (label: string, lang: Lang, ...texts: string[]): Case[] => texts.map((text) => ({ text, label, lang }));

export const DATASET: Case[] = [
  // ── neutral ─────────────────────────────────────────────────────────────
  ...c("neutral", "en", "My name is Hardik and my date of birth is the twelfth of March.", "I will come to the clinic at ten o'clock.", "Yes, this is Vikas speaking.", "I take the tablets after dinner.", "Can you tell me the clinic address?", "I'm calling about my appointment on Thursday."),
  ...c("neutral", "hi", "मेरा नाम हार्दिक है।", "मैं कल सुबह दस बजे आऊँगा।"),
  ...c("neutral", "hinglish", "mera appointment kal ka hai", "main dinner ke baad tablet leta hoon", "clinic ka address bata dijiye"),
  ...c("neutral", "pa", "ਮੇਰਾ ਨਾਮ ਹਰਦੀਪ ਹੈ।"),

  // ── calm ────────────────────────────────────────────────────────────────
  ...c("calm", "en", "I'm feeling relaxed and comfortable today.", "Everything is fine, no rush at all.", "I slept well and I feel peaceful.", "Take your time, I'm in no hurry."),
  ...c("calm", "hi", "मैं आज बहुत शांत और आराम से हूँ।", "सब ठीक है, कोई जल्दी नहीं है।"),
  ...c("calm", "hinglish", "aaj main bahut relaxed feel kar raha hoon", "sab theek hai, koi tension nahi hai"),
  ...c("calm", "pa", "ਮੈਂ ਅੱਜ ਬਹੁਤ ਸ਼ਾਂਤ ਮਹਿਸੂਸ ਕਰ ਰਿਹਾ ਹਾਂ।"),

  // ── joy ─────────────────────────────────────────────────────────────────
  ...c("joy", "en", "I'm so happy, I got discharged today!", "That's wonderful, I feel great!", "I'm really glad, I'm feeling much better and cheerful.", "What a lovely day, I'm so happy!", "Great, my reports are all normal, I'm delighted."),
  ...c("joy", "hi", "मैं बहुत खुश हूँ, आज मैं पूरी तरह ठीक हो गया।", "वाह, बहुत अच्छा लग रहा है!"),
  ...c("joy", "hinglish", "main bahut khush hoon, reports sab normal aaye", "bahut accha lag raha hai aaj", "yaar maza aa gaya, ekdum mast feel ho raha hai"),
  ...c("joy", "pa", "ਮੈਂ ਬਹੁਤ ਖੁਸ਼ ਹਾਂ, ਅੱਜ ਮੈਂ ਠੀਕ ਹੋ ਗਿਆ!"),

  // ── excitement ──────────────────────────────────────────────────────────
  ...c("excitement", "en", "I can't wait for tomorrow, I'm so excited to go home!", "Oh wow, this is amazing news, I'm thrilled!", "Yes! I finally get to start walking again, I'm pumped!", "I'm super excited about the surgery results!"),
  ...c("excitement", "hi", "मैं बहुत उत्साहित हूँ, कल घर जाना है!", "वाह! यह तो कमाल की खबर है!!"),
  ...c("excitement", "hinglish", "main bahut excited hoon, kal ghar jaana hai!", "arre wah, kya baat hai, maza aa gaya, bahut excited!"),
  ...c("excitement", "pa", "ਮੈਂ ਬਹੁਤ ਉਤਸ਼ਾਹਿਤ ਹਾਂ, ਕੱਲ੍ਹ ਘਰ ਜਾਣਾ ਹੈ!"),

  // ── gratitude ───────────────────────────────────────────────────────────
  ...c("gratitude", "en", "Thank you so much, you've been really helpful.", "I really appreciate your help, doctor, thank you.", "Thanks a lot for calling and checking on me.", "I'm very grateful to the nurses for taking such good care.", "Thank you, that really means a lot to me."),
  ...c("gratitude", "hi", "आपका बहुत-बहुत धन्यवाद, आपने बहुत मदद की।", "मैं आपका शुक्रगुज़ार हूँ, डॉक्टर साहब।"),
  ...c("gratitude", "hinglish", "bahut bahut shukriya aapne meri itni help ki", "thank you so much ji, aapka ehsaan rahega", "dhanyavad doctor sahab, aapne bahut dhyan rakha"),
  ...c("gratitude", "pa", "ਤੁਹਾਡਾ ਬਹੁਤ ਬਹੁਤ ਧੰਨਵਾਦ, ਤੁਸੀਂ ਬਹੁਤ ਮਦਦ ਕੀਤੀ।"),

  // ── relief ──────────────────────────────────────────────────────────────
  ...c("relief", "en", "Oh thank god, the pain is finally gone.", "What a relief, the test came back negative.", "I'm so relieved the fever is down, I was really worried.", "Phew, I was afraid it was serious but it's fine."),
  ...c("relief", "hi", "शुक्र है भगवान का, दर्द आख़िरकार चला गया।", "चलो राहत मिली, रिपोर्ट ठीक आई।"),
  ...c("relief", "hinglish", "thank god, finally bukhar utar gaya, bahut rahat mili", "phew, main dar gaya tha par sab theek nikla"),
  ...c("relief", "pa", "ਸ਼ੁਕਰ ਹੈ ਰੱਬ ਦਾ, ਦਰਦ ਹੁਣ ਚਲਾ ਗਿਆ, ਬਹੁਤ ਰਾਹਤ ਮਿਲੀ।"),

  // ── surprise ────────────────────────────────────────────────────────────
  ...c("surprise", "en", "Wait, what? I didn't expect the results so soon!", "Oh really? I had no idea the surgery was already done!", "Wow, I'm shocked, that's completely unexpected.", "Seriously? They discharged me already?"),
  ...c("surprise", "hi", "अरे क्या? मुझे तो बिल्कुल उम्मीद नहीं थी!", "सच में? मुझे तो पता ही नहीं था!"),
  ...c("surprise", "hinglish", "arre kya? mujhe toh bilkul expect nahi tha!", "sach mein? itni jaldi report aa gayi?"),
  ...c("surprise", "pa", "ਹੈਂ? ਸੱਚੀਂ? ਮੈਨੂੰ ਤਾਂ ਬਿਲਕੁਲ ਉਮੀਦ ਨਹੀਂ ਸੀ!"),

  // ── confusion ───────────────────────────────────────────────────────────
  ...c("confusion", "en", "I don't understand, which tablet should I take first?", "Sorry, I'm confused about the timing of the appointment.", "Wait, can you explain that again? I didn't get it.", "I'm not sure what the doctor meant by that."),
  ...c("confusion", "hi", "मुझे समझ नहीं आया, पहले कौन सी गोली लेनी है?", "माफ़ कीजिए, मैं कन्फ़्यूज़ हूँ, दोबारा बताइए।"),
  ...c("confusion", "hinglish", "mujhe samajh nahi aaya, pehle kaunsi tablet leni hai?", "main confuse ho gaya, aap phir se explain kar sakte hain?"),
  ...c("confusion", "pa", "ਮੈਨੂੰ ਸਮਝ ਨਹੀਂ ਆਇਆ, ਪਹਿਲਾਂ ਕਿਹੜੀ ਗੋਲੀ ਲੈਣੀ ਹੈ?"),

  // ── worry ───────────────────────────────────────────────────────────────
  ...c("worry", "en", "I'm worried the swelling might be something serious.", "I'm a bit anxious about tomorrow's test.", "I keep thinking something might go wrong with the surgery.", "I'm nervous about the results, what if it's bad?"),
  ...c("worry", "hi", "मुझे चिंता हो रही है कि कहीं कुछ गंभीर तो नहीं।", "मैं कल की जाँच को लेकर थोड़ा घबराया हुआ हूँ।"),
  ...c("worry", "hinglish", "mujhe tension ho rahi hai ki kuch serious toh nahi hai", "main thoda nervous hoon kal ke test ko leke"),
  ...c("worry", "pa", "ਮੈਨੂੰ ਚਿੰਤਾ ਹੋ ਰਹੀ ਹੈ ਕਿ ਕੁਝ ਗੰਭੀਰ ਤਾਂ ਨਹੀਂ।"),

  // ── fear ────────────────────────────────────────────────────────────────
  ...c("fear", "en", "I'm scared, what if I don't wake up after the operation?", "I'm really afraid I might have cancer.", "I'm terrified of needles, please don't do it.", "I'm frightened, my heart is racing and I feel something bad will happen."),
  ...c("fear", "hi", "मुझे बहुत डर लग रहा है, ऑपरेशन के बाद अगर कुछ हो गया तो?", "मैं बहुत डरा हुआ हूँ, कहीं कैंसर न हो।"),
  ...c("fear", "hinglish", "mujhe bahut darr lag raha hai, operation ke baad kuch ho gaya toh?", "main bahut dara hua hoon, injection se bahut darr lagta hai"),
  ...c("fear", "pa", "ਮੈਨੂੰ ਬਹੁਤ ਡਰ ਲੱਗ ਰਿਹਾ ਹੈ, ਆਪ੍ਰੇਸ਼ਨ ਤੋਂ ਬਾਅਦ ਕੁਝ ਹੋ ਗਿਆ ਤਾਂ?"),

  // ── sadness ─────────────────────────────────────────────────────────────
  ...c("sadness", "en", "I feel so low and lonely since I came home.", "I've been crying a lot, I just feel empty.", "I miss my wife so much, nothing feels the same.", "I'm sad that I can't play with my grandchildren anymore."),
  ...c("sadness", "hi", "घर आने के बाद से मुझे बहुत उदासी और अकेलापन महसूस हो रहा है।", "मैं बहुत रोया, अंदर से खाली-खाली लगता है।"),
  ...c("sadness", "hinglish", "main bahut udaas hoon aur akela feel kar raha hoon", "mera dil bahut bhaari hai, kuch accha nahi lagta"),
  ...c("sadness", "pa", "ਮੈਂ ਬਹੁਤ ਉਦਾਸ ਹਾਂ ਤੇ ਇਕੱਲਾ ਮਹਿਸੂਸ ਕਰਦਾ ਹਾਂ।"),

  // ── distress (acute crisis, needs help now) ─────────────────────────────
  ...c("distress", "en", "Please help me, I can't take this anymore, I feel like giving up!", "I'm in a panic, I can't breathe and I don't know what to do!", "I can't cope, everything is falling apart, please somebody help!", "I want to end everything, I can't go on."),
  ...c("distress", "hi", "प्लीज़ मेरी मदद कीजिए, मुझसे अब बर्दाश्त नहीं होता, मैं टूट गया हूँ!", "मुझे साँस नहीं आ रही, मैं घबरा गया हूँ, कोई बचाओ!"),
  ...c("distress", "hinglish", "please meri help karo, mujhse ab bardasht nahi hota, main toot gaya hoon!", "mujhe saans nahi aa rahi, main panic mein hoon, jaldi madad karo!"),
  ...c("distress", "pa", "ਕਿਰਪਾ ਕਰਕੇ ਮੇਰੀ ਮਦਦ ਕਰੋ, ਮੈਥੋਂ ਹੋਰ ਬਰਦਾਸ਼ਤ ਨਹੀਂ ਹੁੰਦਾ!"),

  // ── pain (physical) ─────────────────────────────────────────────────────
  ...c("pain", "en", "My knee hurts a lot when I climb the stairs.", "I have a sharp pain in my chest since morning.", "The pain in my stomach is getting worse.", "My back is aching badly and I can't sleep."),
  ...c("pain", "hi", "सीढ़ियाँ चढ़ते समय मेरे घुटने में बहुत दर्द होता है।", "सुबह से मेरे सीने में तेज़ दर्द हो रहा है।"),
  ...c("pain", "hinglish", "mere ghutne mein bahut dard ho raha hai", "pet mein tej dard hai aur badh raha hai", "kamar mein bahut dard hai, neend nahi aati"),
  ...c("pain", "pa", "ਮੇਰੇ ਗੋਡੇ ਵਿੱਚ ਬਹੁਤ ਦਰਦ ਹੋ ਰਿਹਾ ਹੈ।"),

  // ── disappointment ──────────────────────────────────────────────────────
  ...c("disappointment", "en", "I was hoping the swelling would be gone by now, but it isn't.", "I'm disappointed, I expected to feel better after the treatment.", "That's a pity, I really wanted to go home today.", "I thought the new medicine would work, it's let me down."),
  ...c("disappointment", "hi", "मुझे उम्मीद थी कि सूजन कम हो जाएगी, पर निराशा हाथ लगी।", "मैं निराश हूँ, इलाज के बाद भी आराम नहीं मिला।"),
  ...c("disappointment", "hinglish", "mujhe umeed thi ki ab tak theek ho jaunga, par nirasha hui", "yeh sunke bahut bura laga, main kuch aur expect kar raha tha"),
  ...c("disappointment", "pa", "ਮੈਂ ਨਿਰਾਸ਼ ਹਾਂ, ਇਲਾਜ ਤੋਂ ਬਾਅਦ ਵੀ ਆਰਾਮ ਨਹੀਂ ਮਿਲਿਆ।"),

  // ── frustration ─────────────────────────────────────────────────────────
  ...c("frustration", "en", "This is the third time I'm calling and nobody has fixed the problem!", "Why does the appointment keep getting rescheduled? It's so annoying.", "I'm fed up with waiting, this is taking forever.", "Ugh, I've explained this twice already, why don't you understand?"),
  ...c("frustration", "hi", "यह तीसरी बार है जब मैं फ़ोन कर रहा हूँ और कोई हल नहीं निकला!", "मैं इंतज़ार करते-करते तंग आ गया हूँ।"),
  ...c("frustration", "hinglish", "yeh teesri baar hai jab main call kar raha hoon, koi solution nahi mila!", "main wait kar karke tang aa gaya hoon, bahut irritating hai"),
  ...c("frustration", "pa", "ਇਹ ਤੀਜੀ ਵਾਰ ਹੈ, ਮੈਂ ਉਡੀਕ ਕਰ ਕਰ ਕੇ ਤੰਗ ਆ ਗਿਆ ਹਾਂ।"),

  // ── anger ───────────────────────────────────────────────────────────────
  ...c("anger", "en", "This is unacceptable! Your staff was rude to my mother and I'm furious!", "I'm very angry, you people wasted my whole day!", "How dare you charge me twice, I will file a complaint!", "Stop lying to me, I'm sick of your useless hospital!"),
  ...c("anger", "hi", "यह बिल्कुल बर्दाश्त नहीं है! आपके स्टाफ ने मेरी माँ से बदतमीज़ी की, मुझे बहुत गुस्सा आ रहा है!", "आपने मेरा पूरा दिन बर्बाद कर दिया, मैं शिकायत करूँगा!"),
  ...c("anger", "hinglish", "yeh bilkul bardasht nahi hai! mujhe bahut gussa aa raha hai, main complaint karunga!", "tumhare staff ne meri maa se badtameezi ki, sharam karo!"),
  ...c("anger", "pa", "ਇਹ ਬਿਲਕੁਲ ਬਰਦਾਸ਼ਤ ਨਹੀਂ ਹੈ, ਮੈਨੂੰ ਬਹੁਤ ਗੁੱਸਾ ਆ ਰਿਹਾ ਹੈ!"),
];

export const LABELS = [...new Set(DATASET.map((d) => d.label))];
