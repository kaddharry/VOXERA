/**
 * Dimension of the local bge-small embedder (local-embedder.ts). Its own
 * module so embed.ts can know it without importing the model code (and with
 * it the native ONNX runtime) up front.
 */
export const LOCAL_EMBED_DIM = 384;
