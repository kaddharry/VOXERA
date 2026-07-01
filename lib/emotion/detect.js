"use strict";
var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.detectTextEmotion = detectTextEmotion;
exports.detectAudioEmotionStub = detectAudioEmotionStub;
exports.fuseEmotion = fuseEmotion;
var math_1 = require("../util/math");
var confidence_1 = require("./confidence");
var lexicon_1 = require("./lexicon");
// Text emotion detector. Lexicon + caps/punctuation cues.
// Returns a calibrated EmotionSignal. Acts as the RoBERTa stub in §3.1.
function detectTextEmotion(text) {
    var _a, _b, _c, _d, _e;
    var labelScores = {};
    var vadAcc = { v: 0, a: 0, d: 0 };
    var totalW = 0;
    var negLabels = new Set(["frustration", "anger", "distress", "sadness", "fear", "disappointment"]);
    var posLabels = new Set(["joy", "gratitude", "excitement"]);
    var hasNegMatch = false;
    var hasPosMatch = false;
    for (var _i = 0, LEXICON_1 = lexicon_1.LEXICON; _i < LEXICON_1.length; _i++) {
        var entry = LEXICON_1[_i];
        var matches = text.match(entry.kw);
        if (!matches)
            continue;
        var w = entry.w * matches.length;
        labelScores[entry.label] = ((_a = labelScores[entry.label]) !== null && _a !== void 0 ? _a : 0) + w;
        vadAcc.v += entry.vad.v * w;
        vadAcc.a += entry.vad.a * w;
        vadAcc.d += entry.vad.d * w;
        totalW += w;
        if (negLabels.has(entry.label))
            hasNegMatch = true;
        if (posLabels.has(entry.label))
            hasPosMatch = true;
    }
    // Context-aware punctuation: !! and ??? boost arousal in the direction
    // of the already-detected valence, instead of blindly assuming frustration.
    var exclamCount = (text.match(/!{2,}/g) || []).length;
    var questionCount = (text.match(/\?{2,}/g) || []).length;
    if (exclamCount > 0) {
        var arousalBoost = 0.3 * exclamCount;
        vadAcc.a += arousalBoost;
        // If no negative keywords matched, treat !! as positive intensity amplifier
        if (!hasNegMatch) {
            vadAcc.v += 0.2 * exclamCount;
            labelScores["excitement"] = ((_b = labelScores["excitement"]) !== null && _b !== void 0 ? _b : 0) + 0.4 * exclamCount;
        }
        totalW += arousalBoost;
    }
    if (questionCount > 0) {
        vadAcc.a += 0.1 * questionCount;
        labelScores["confusion"] = ((_c = labelScores["confusion"]) !== null && _c !== void 0 ? _c : 0) + 0.3 * questionCount;
        totalW += 0.1 * questionCount;
    }
    // Caps boost arousal.
    var letters = text.replace(/[^A-Za-z]/g, "");
    var capsRatio = letters.length > 0 ? ((_e = (_d = text.match(/[A-Z]/g)) === null || _d === void 0 ? void 0 : _d.length) !== null && _e !== void 0 ? _e : 0) / letters.length : 0;
    if (capsRatio > 0.5 && letters.length > 6) {
        vadAcc.a += 0.4;
        totalW += 0.4;
    }
    var label = "neutral";
    var topScore = 0;
    for (var _f = 0, _g = Object.entries(labelScores); _f < _g.length; _f++) {
        var _h = _g[_f], k = _h[0], v = _h[1];
        if ((v !== null && v !== void 0 ? v : 0) > topScore) {
            topScore = v !== null && v !== void 0 ? v : 0;
            label = k;
        }
    }
    var vad = totalW === 0
        ? { v: 0, a: 0, d: 0 }
        : { v: (0, math_1.clamp)(vadAcc.v / totalW, -1, 1), a: (0, math_1.clamp)(vadAcc.a / totalW, -1, 1), d: (0, math_1.clamp)(vadAcc.d / totalW, -1, 1) };
    // Positivity safety net: if accumulated valence is clearly positive and arousal
    // is high, but the label ended up negative (e.g. due to thin lexicon overlap),
    // correct the label to excitement.
    if (vad.v > 0.2 && vad.a > 0.3 && negLabels.has(label) && hasPosMatch) {
        label = "excitement";
    }
    var intensity = (0, math_1.clamp)(Math.sqrt(vad.v * vad.v + vad.a * vad.a + vad.d * vad.d) / Math.sqrt(3));
    var confidence = (0, math_1.clamp)(totalW === 0 ? 0.5 : Math.min(1, 0.45 + 0.15 * totalW));
    // Mixed emotions safety net: if both positive and negative strong keywords hit,
    // we flag it as mixed so the persona engine can adapt and not just blindly celebrate.
    var isMixed = hasNegMatch && hasPosMatch;
    return {
        label: label,
        intensity: intensity,
        confidence: confidence,
        confidenceCategory: (0, confidence_1.classifyConfidence)(confidence),
        vad: vad,
        source: "text",
        at: Date.now(),
        isMixed: isMixed,
    };
}
// Stub for audio emotion (Wav2Vec2 head). In production, replace with a real
// model call; the rest of the pipeline is indifferent to where the VAD came from.
function detectAudioEmotionStub(_audioMeta) {
    return null;
}
// Late fusion per §3.1: confidence-weighted mix of VAD and label distributions.
function fuseEmotion(text, audio) {
    if (!audio)
        return __assign(__assign({}, text), { source: "fused" });
    var wa = audio.confidence;
    var wt = text.confidence;
    var sum = wa + wt || 1;
    var vad = {
        v: (audio.vad.v * wa + text.vad.v * wt) / sum,
        a: (audio.vad.a * wa + text.vad.a * wt) / sum,
        d: (audio.vad.d * wa + text.vad.d * wt) / sum,
    };
    var label = audio.confidence > text.confidence ? audio.label : text.label;
    var intensity = (0, math_1.clamp)(Math.sqrt(vad.v * vad.v + vad.a * vad.a + vad.d * vad.d) / Math.sqrt(3));
    var confidence = (0, math_1.clamp)((audio.confidence + text.confidence) / 2 + 0.05);
    return { label: label, intensity: intensity, confidence: confidence, confidenceCategory: (0, confidence_1.classifyConfidence)(confidence), vad: vad, source: "fused", at: Date.now() };
}
