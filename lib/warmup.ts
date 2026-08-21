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
export async function warmupModels(): Promise<void> {
  const start = Date.now();
  const results = await Promise.allSettled([
    embed("warmup", { isQuery: true }),
    detectTextEmotionLocalONNX("warmup"),
  ]);
  const failed = results.filter((r) => r.status === "rejected");
  if (failed.length > 0) {
    console.warn(
      "[Warmup] Some ONNX models failed to preload (will load lazily on first real use instead):",
      failed.map((f) => (f as PromiseRejectedResult).reason)
    );
  }
  console.log(`[Warmup] ONNX models ready in ${Date.now() - start}ms`);
}
