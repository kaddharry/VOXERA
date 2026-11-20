import { embed } from "./util/embed";
import { detectTextEmotionLocalONNX } from "./emotion/local-onnx-detect";

/**
 * Proactively loads the in-process ONNX models (the bge-small embedder and
 * the 7-class text-emotion classifier) at server startup instead of paying
 * their one-time load cost on whichever live call happens to be first.
 * Both are lazy singletons — per their own header comments, a cold load
 * takes real time (model weights read from disk / decoded) but a WARM
 * inference is single-digit ms. Without this, the very first turn of the
 * very first call on a freshly-started server pays that load cost inline,
 * on the critical path, which is exactly the kind of latency spike a voice
 * call can't absorb.
 *
 * Fire-and-forget from the caller's perspective — server startup shouldn't
 * block on this — but it's kicked off as early in process lifetime as
 * possible so it has the best chance of finishing before the first real
 * call arrives.
 */
export async function warmupModels(opts: { includeVoiceModel?: boolean } = {}): Promise<void> {
  const start = Date.now();
  const includeVoiceModel = opts.includeVoiceModel ?? true;
  const results = await Promise.allSettled([
    embed("warmup", { isQuery: true }),
    detectTextEmotionLocalONNX("warmup"),
    // The trained voice-emotion model (~91MB, ~56s cold load) now runs on
    // every phone turn's diagnostics pass; loaded here so the first call's
    // turns don't all time out waiting for it. Imported lazily, like the
    // others, so a missing native ONNX runtime can't break the importer.
    ...(includeVoiceModel
      ? [import("./emotion/local-audio-classifier").then(({ default: LocalAudioClassifier }) => LocalAudioClassifier.getInstance())]
      : []),
  ]);
  const failed = results.filter((r) => r.status === "rejected");
  const ms = Date.now() - start;
  if (failed.length > 0) {
    console.warn(
      JSON.stringify({
        service: "models",
        event: "model_warmup_failed",
        failed: failed.length,
        of: results.length,
        ms,
        errors: failed.map((f) => String((f as PromiseRejectedResult).reason?.message ?? (f as PromiseRejectedResult).reason).slice(0, 200)),
        note: "these models will be retried on first real use; embeddings fail closed (retrieval degraded) if they still can't load",
      }),
    );
  } else {
    console.info(JSON.stringify({ service: "models", event: "model_warmup_done", models: results.length, ms }));
  }
  console.log(`[Warmup] ONNX models ready in ${ms}ms`);
}
