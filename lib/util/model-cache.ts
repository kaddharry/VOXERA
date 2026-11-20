import os from "node:os";
import path from "node:path";

/**
 * Where the in-process ONNX models (@xenova/transformers) keep their
 * downloaded files.
 *
 * Locally this is <project>/.cache/xenova, as before. On Vercel the project
 * folder (/var/task) is read-only and only the temp folder is writable, so
 * the cache goes there: without it, writing a downloaded model fails, and
 * the text-emotion model (which pre-writes a patched tokenizer.json, see
 * local-emotion-classifier.ts) can't load at all.
 */
export const MODEL_CACHE_DIR = process.env.VERCEL
  ? path.join(os.tmpdir(), "xenova")
  : path.resolve(process.cwd(), ".cache", "xenova");
