import type { MelSpectrogram } from "../dsp/mel";
import type { Features2D } from "../dsp/mfcc";
import { peakPick } from "../dsp/peakPick";

export type MirFingerprintV1 = {
  version: "v1";

  /** Query window time bounds (seconds) – informational/debug only. */
  t0: number;
  t1: number;

  // A) Mel-spectrogram statistics
  mel: {
    /** Mean mel vector across frames (weighted by frame energy, then unit-normalised). */
    mean: Float32Array;
    /** Variance mel vector across frames (weighted by frame energy). */
    variance: Float32Array;
  };

  // B) Transient/activity statistics
  onset: {
    mean: number;
    max: number;
    /** Peaks per second, computed using peakPick() on the onset envelope. */
    peakDensityHz: number;
  };

  // Optional: MFCC statistics (coeffs 1–12, exclude C0)
  mfcc?: {
    mean: Float32Array;
    variance: Float32Array;
  };
};

export type FingerprintFrameWindow = {
  startFrame: number;
  endFrameExclusive: number;
};

function l2Norm(v: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < v.length; i++) {
    const x = v[i] ?? 0;
    sum += x * x;
  }
  return Math.sqrt(sum);
}

function weightedStats(
  frames: Float32Array[], // raw frames
  start: number,
  endExclusive: number,
  dimHint = 0
): { mean: Float32Array; variance: Float32Array } {
  const nFrames = Math.max(0, endExclusive - start);

  // Handle empty window deterministically.
  const first = frames[start];
  const dim = first ? first.length : dimHint;

  const mean = new Float32Array(dim);
  const variance = new Float32Array(dim);

  if (nFrames <= 0 || dim <= 0) return { mean, variance };

  // 1. Calculate weights (L2 norms) and total weight
  const weights = new Float32Array(nFrames);
  const normFrames: Float32Array[] = new Array(nFrames);
  let totalWeight = 0;

  for (let i = 0; i < nFrames; i++) {
    const f = frames[start + i];
    if (!f) {
      normFrames[i] = new Float32Array(dim);
      continue;
    }
    const w = l2Norm(f);
    weights[i] = w;
    totalWeight += w;

    // Normalize frame for shape statistics
    const nf = new Float32Array(dim);
    const d = w > 1e-12 ? w : 1;
    for (let j = 0; j < dim; j++) nf[j] = f[j]! / d;
    normFrames[i] = nf;
  }

  // fallback if all silence
  if (totalWeight <= 1e-12) totalWeight = 1;

  // 2. Weighted Mean
  // Mean = sum(w_i * x_i) / sum(w_i)
  for (let i = 0; i < nFrames; i++) {
    const w = weights[i];
    const nf = normFrames[i];
    if (!w || w <= 0) continue;
    const scale = w / totalWeight;
    for (let j = 0; j < dim; j++) {
      mean[j]! += nf![j]! * scale;
    }
  }

  // 3. Weighted Variance
  // Var = sum(w_i * (x_i - mean)^2) / sum(w_i)
  for (let i = 0; i < nFrames; i++) {
    const w = weights[i];
    const nf = normFrames[i];
    if (!w || w <= 0) continue;
    const scale = w / totalWeight;
    for (let j = 0; j < dim; j++) {
      const diff = nf![j]! - mean[j]!;
      variance[j]! += diff * diff * scale;
    }
  }

  return { mean, variance };
}

function findFrameWindow(times: Float32Array, t0: number, t1: number): FingerprintFrameWindow {
  // times are frame-center times; we include frames where t is within [t0,t1].
  let start = 0;
  while (start < times.length && (times[start] ?? 0) < t0) start++;

  let end = start;
  while (end < times.length && (times[end] ?? 0) <= t1) end++;

  return { startFrame: start, endFrameExclusive: Math.max(start, end) };
}

/**
 * Compute a deterministic v1 fingerprint for a time region [t0, t1].
 *
 * Loudness independence:
 * - Uses energy-weighted statistics. Loud frames contribute more to the shape.
 * - Resulting mean vector is effectively the average energy distribution direction.
 */
export function fingerprintV1(params: {
  t0: number;
  t1: number;
  mel: MelSpectrogram;
  onsetEnvelope: { times: Float32Array; values: Float32Array };
  mfcc?: Features2D; // { times, values: Float32Array[] }
  peakPick?: {
    minIntervalSec?: number;
    threshold?: number;
    adaptiveFactor?: number;
  };
}): MirFingerprintV1 {
  const { t0, t1, mel, onsetEnvelope, mfcc } = params;

  const tt0 = Math.min(t0, t1);
  const tt1 = Math.max(t0, t1);
  const dur = Math.max(1e-6, tt1 - tt0);

  const melDimHint = mel.melBands.find((f) => f?.length)?.length ?? 0;

  // --- Mel stats
  const melWindow = findFrameWindow(mel.times, tt0, tt1);
  // Be careful not to slice/copy excessively, but here we need array of arrays for helper
  // melBands is Array<Float32Array>
  const melStats = weightedStats(mel.melBands, melWindow.startFrame, melWindow.endFrameExclusive, melDimHint);

  // --- Onset stats (1D)
  // NOTE: onsetEnvelope times should align with mel.times (as computed today), but
  // we don't assume perfect equality; we window by time.
  let onsetSum = 0;
  let onsetMax = -Infinity;
  let onsetN = 0;
  for (let i = 0; i < onsetEnvelope.times.length; i++) {
    const t = onsetEnvelope.times[i] ?? 0;
    if (t < tt0 || t > tt1) continue;
    const v = onsetEnvelope.values[i] ?? 0;
    onsetSum += v;
    onsetN++;
    if (v > onsetMax) onsetMax = v;
  }
  const onsetMean = onsetN > 0 ? onsetSum / onsetN : 0;
  const onsetMaxSafe = Number.isFinite(onsetMax) ? onsetMax : 0;

  // Peaks per second
  const peaks = peakPick(onsetEnvelope.times, onsetEnvelope.values, {
    minIntervalSec: params.peakPick?.minIntervalSec,
    threshold: params.peakPick?.threshold,
    adaptive: params.peakPick?.adaptiveFactor
      ? { method: "meanStd", factor: params.peakPick.adaptiveFactor }
      : undefined,
    strict: true,
  });
  const peaksInWindow = peaks.filter((p) => p.time >= tt0 && p.time <= tt1);
  const peakDensityHz = peaksInWindow.length / dur;

  // --- Optional MFCC (coeffs 1..12)
  let mfccStats: MirFingerprintV1["mfcc"] | undefined;
  const mfccDimHint = mfcc?.values.find((f) => f?.length)?.length ?? 0;

  if (mfcc) {
    const mfccWindow = findFrameWindow(mfcc.times, tt0, tt1);

    // Exclude C0 and clamp to 1..12 inclusive.
    // We must pre-process standard frames to slices for weightedStats to consume.
    // Or we just consume them and slice inside?
    // weightedStats takes Float32Array[].
    const mfccFramesSliced: Float32Array[] = [];
    for (let i = mfccWindow.startFrame; i < mfccWindow.endFrameExclusive; i++) {
      const full = mfcc.values[i] ?? new Float32Array(0);
      const start = Math.min(1, full.length);
      const end = Math.min(13, full.length);
      mfccFramesSliced.push(full.subarray(start, end));
    }

    const s = weightedStats(mfccFramesSliced, 0, mfccFramesSliced.length, mfccDimHint ? Math.max(0, mfccDimHint - 1) : 0);
    mfccStats = { mean: s.mean, variance: s.variance };
  }

  return {
    version: "v1",
    t0: tt0,
    t1: tt1,
    mel: {
      mean: melStats.mean,
      variance: melStats.variance,
    },
    onset: {
      mean: onsetMean,
      max: onsetMaxSafe,
      peakDensityHz,
    },
    ...(mfccStats ? { mfcc: mfccStats } : {}),
  };
}
