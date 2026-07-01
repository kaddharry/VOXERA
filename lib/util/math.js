"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.dot = dot;
exports.norm = norm;
exports.cosine = cosine;
exports.slope = slope;
exports.variance = variance;
exports.clamp = clamp;
function dot(a, b) {
    var s = 0;
    var n = Math.min(a.length, b.length);
    for (var i = 0; i < n; i++)
        s += a[i] * b[i];
    return s;
}
function norm(a) {
    return Math.sqrt(dot(a, a));
}
function cosine(a, b) {
    var na = norm(a);
    var nb = norm(b);
    if (na === 0 || nb === 0)
        return 0;
    return dot(a, b) / (na * nb);
}
function slope(ys) {
    var n = ys.length;
    if (n < 2)
        return 0;
    var xs = Array.from({ length: n }, function (_, i) { return i; });
    var mx = xs.reduce(function (s, v) { return s + v; }, 0) / n;
    var my = ys.reduce(function (s, v) { return s + v; }, 0) / n;
    var num = 0;
    var den = 0;
    for (var i = 0; i < n; i++) {
        num += (xs[i] - mx) * (ys[i] - my);
        den += Math.pow((xs[i] - mx), 2);
    }
    return den === 0 ? 0 : num / den;
}
function variance(xs) {
    if (xs.length < 2)
        return 0;
    var m = xs.reduce(function (s, v) { return s + v; }, 0) / xs.length;
    return xs.reduce(function (s, v) { return s + Math.pow((v - m), 2); }, 0) / (xs.length - 1);
}
function clamp(x, lo, hi) {
    if (lo === void 0) { lo = 0; }
    if (hi === void 0) { hi = 1; }
    return Math.max(lo, Math.min(hi, x));
}
