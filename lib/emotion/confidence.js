"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.classifyConfidence = classifyConfidence;
/**
 * Classifies a 0–1 confidence score into the SRD-specified categories (FR-7).
 *
 * Ranges:
 *  - High:   >= 0.80
 *  - Medium: >= 0.50 and < 0.80
 *  - Low:    < 0.50
 */
function classifyConfidence(confidence, params) {
    var explanation = "Standard confidence threshold calculation.";
    if ((params === null || params === void 0 ? void 0 : params.lexiconMatch) && (params === null || params === void 0 ? void 0 : params.acousticEnergy) && params.acousticEnergy > 0.8) {
        explanation = "High confidence due to strong lexicon match and high vocal energy.";
    }
    else if (!(params === null || params === void 0 ? void 0 : params.lexiconMatch) && confidence < 0.5) {
        explanation = "Low confidence: weak lexicon match and ambiguous signal.";
    }
    if (confidence >= 0.8)
        return { level: "high", explanation: explanation };
    if (confidence >= 0.5)
        return { level: "medium", explanation: explanation };
    return { level: "low", explanation: explanation };
}
