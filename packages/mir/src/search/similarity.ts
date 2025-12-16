import type { MirFingerprintV1 } from "./fingerprintV1";

export type MirFingerprintVectorWeights = {
    /** Weight for mel(mean+variance) block. */
    mel?: number;
    /** Weight for transient/onset scalars block. */
    transient?: number;
    /** Weight for MFCC(mean+variance) block (if present). */
    mfcc?: number;
};

function l2Norm(v: Float32Array): number {
    let sum = 0;
    for (let i = 0; i < v.length; i++) {
        const x = v[i] ?? 0;
        sum += x * x;
    }
    return Math.sqrt(sum);
}

function normaliseL2InPlace(v: Float32Array, eps = 1e-12): void {
    const n = l2Norm(v);
    const d = n > eps ? n : 1;
    for (let i = 0; i < v.length; i++) v[i] = (v[i] ?? 0) / d;
}

function cosineSimilarity(a: Float32Array, b: Float32Array): number {
    if (a.length !== b.length) throw new Error("@octoseq/mir: cosineSimilarity length mismatch");
    let dot = 0;
    let aa = 0;
    let bb = 0;
    for (let i = 0; i < a.length; i++) {
        const x = a[i] ?? 0;
        const y = b[i] ?? 0;
        dot += x * y;
        aa += x * x;
        bb += y * y;
    }
    const denom = Math.sqrt(aa) * Math.sqrt(bb);
    if (denom <= 0) return 0;

    // Map cosine [-1,1] -> [0,1]. With our features it tends to be >= 0 anyway,
    // but we keep the mapping deterministic and bounded.
    const cos = dot / denom;
    const clamped = Math.max(-1, Math.min(1, cos));
    return (clamped + 1) / 2;
}

function pushScaled(dst: number[], src: Float32Array, scale: number) {
    for (let i = 0; i < src.length; i++) dst.push((src[i] ?? 0) * scale);
}

/**
 * Convert a v1 fingerprint into a concatenated feature vector suitable for cosine similarity.
 *
 * Rules:
 * - mel and mfcc blocks are L2-normalised separately (mean+var concatenated per-block)
 * - transient scalars are treated as a small vector and L2-normalised too
 * - blocks are then concatenated with optional weights applied per-block
 */
export function fingerprintToVectorV1(fp: MirFingerprintV1, weights: MirFingerprintVectorWeights = {}): Float32Array {
    const wMel = weights.mel ?? 1;
    const wTrans = weights.transient ?? 1;
    const wMfcc = weights.mfcc ?? 1;

    // --- mel block
    const melBlock = new Float32Array(fp.mel.mean.length + fp.mel.variance.length);
    melBlock.set(fp.mel.mean, 0);
    melBlock.set(fp.mel.variance, fp.mel.mean.length);
    normaliseL2InPlace(melBlock);

    // --- transient block
    const transBlock = new Float32Array([fp.onset.mean, fp.onset.max, fp.onset.peakDensityHz]);
    normaliseL2InPlace(transBlock);

    // --- optional mfcc block
    let mfccBlock: Float32Array | null = null;
    if (fp.mfcc) {
        mfccBlock = new Float32Array(fp.mfcc.mean.length + fp.mfcc.variance.length);
        mfccBlock.set(fp.mfcc.mean, 0);
        mfccBlock.set(fp.mfcc.variance, fp.mfcc.mean.length);
        normaliseL2InPlace(mfccBlock);
    }

    const out: number[] = [];
    pushScaled(out, melBlock, wMel);
    pushScaled(out, transBlock, wTrans);
    if (mfccBlock) pushScaled(out, mfccBlock, wMfcc);

    return new Float32Array(out);
}

export function similarityFingerprintV1(a: MirFingerprintV1, b: MirFingerprintV1, weights: MirFingerprintVectorWeights = {}): number {
    const va = fingerprintToVectorV1(a, weights);
    const vb = fingerprintToVectorV1(b, weights);
    return cosineSimilarity(va, vb);
}
