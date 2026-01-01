/**
 * Custom Signal Reduction
 *
 * Provides algorithms for reducing 2D spectral data (mel spectrogram, HPSS,
 * MFCC, etc.) to 1D signals with configurable bin ranges and reduction methods.
 */

// ----------------------------
// Types
// ----------------------------

/**
 * Input format for 2D time-aligned data.
 * Shape: data[timeIndex][featureIndex]
 */
export interface ReductionInput {
  /** 2D data: data[timeIndex][featureIndex] */
  data: Float32Array[];
  /** Time in seconds for each frame */
  times: Float32Array;
}

/**
 * Reduction algorithm identifiers.
 */
export type ReductionAlgorithmId =
  | "mean"
  | "max"
  | "sum"
  | "variance"
  | "amplitude"
  | "spectralFlux"
  | "spectralCentroid"
  | "onsetStrength";

/**
 * Options for bin range selection.
 */
export interface BinRangeOptions {
  /** Low bin index (inclusive). Default: 0 */
  lowBin?: number;
  /** High bin index (exclusive). Default: all bins */
  highBin?: number;
}

/**
 * Options for onset strength algorithm.
 */
export interface OnsetStrengthOptions {
  /** Smoothing window in milliseconds. Default: 10 */
  smoothMs?: number;
  /** Whether to log-compress before differencing. Default: true */
  useLog?: boolean;
  /** Difference method. Default: "rectified" */
  diffMethod?: "rectified" | "abs";
}

/**
 * Options for spectral flux algorithm.
 */
export interface SpectralFluxOptions {
  /** Whether to normalize frames before computing flux. Default: true */
  normalized?: boolean;
}

/**
 * Combined options for reduction.
 */
export interface ReductionOptions {
  /** Bin range selection */
  binRange?: BinRangeOptions;
  /** Onset strength parameters */
  onsetStrength?: OnsetStrengthOptions;
  /** Spectral flux parameters */
  spectralFlux?: SpectralFluxOptions;
}

/**
 * Result of a reduction operation.
 */
export interface ReductionResult {
  /** Frame times in seconds */
  times: Float32Array;
  /** Reduced values per frame */
  values: Float32Array;
  /** Value range for normalization */
  valueRange: { min: number; max: number };
}

// ----------------------------
// Internal Helpers
// ----------------------------

function logCompress(x: number): number {
  return Math.log1p(Math.max(0, x));
}

function movingAverage(values: Float32Array, windowFrames: number): Float32Array {
  if (windowFrames <= 1) return values;

  const n = values.length;
  const out = new Float32Array(n);
  const half = Math.floor(windowFrames / 2);

  // Prefix sums for O(n) moving average
  const prefix = new Float64Array(n + 1);
  prefix[0] = 0;
  for (let i = 0; i < n; i++) {
    prefix[i + 1] = (prefix[i] ?? 0) + (values[i] ?? 0);
  }

  for (let i = 0; i < n; i++) {
    const start = Math.max(0, i - half);
    const end = Math.min(n, i + half + 1);
    const sum = (prefix[end] ?? 0) - (prefix[start] ?? 0);
    const count = Math.max(1, end - start);
    out[i] = sum / count;
  }

  return out;
}

function computeValueRange(values: Float32Array): { min: number; max: number } {
  if (values.length === 0) {
    return { min: 0, max: 0 };
  }

  let min = values[0] ?? 0;
  let max = values[0] ?? 0;

  for (let i = 1; i < values.length; i++) {
    const v = values[i] ?? 0;
    if (v < min) min = v;
    if (v > max) max = v;
  }

  return { min, max };
}

function getBinRange(numBins: number, options?: BinRangeOptions): { low: number; high: number } {
  const low = Math.max(0, options?.lowBin ?? 0);
  const high = Math.min(numBins, options?.highBin ?? numBins);
  return { low, high };
}

// ----------------------------
// Reduction Algorithms
// ----------------------------

/**
 * Mean: Average value across bins per frame.
 */
function reduceMean(input: ReductionInput, options?: ReductionOptions): ReductionResult {
  const nFrames = input.data.length;
  const values = new Float32Array(nFrames);

  for (let t = 0; t < nFrames; t++) {
    const frame = input.data[t];
    if (!frame || frame.length === 0) {
      values[t] = 0;
      continue;
    }

    const { low, high } = getBinRange(frame.length, options?.binRange);
    let sum = 0;
    const count = high - low;

    for (let k = low; k < high; k++) {
      sum += frame[k] ?? 0;
    }

    values[t] = count > 0 ? sum / count : 0;
  }

  return {
    times: input.times,
    values,
    valueRange: computeValueRange(values),
  };
}

/**
 * Max: Maximum value across bins per frame.
 */
function reduceMax(input: ReductionInput, options?: ReductionOptions): ReductionResult {
  const nFrames = input.data.length;
  const values = new Float32Array(nFrames);

  for (let t = 0; t < nFrames; t++) {
    const frame = input.data[t];
    if (!frame || frame.length === 0) {
      values[t] = 0;
      continue;
    }

    const { low, high } = getBinRange(frame.length, options?.binRange);
    let max = -Infinity;

    for (let k = low; k < high; k++) {
      const v = frame[k] ?? 0;
      if (v > max) max = v;
    }

    values[t] = max === -Infinity ? 0 : max;
  }

  return {
    times: input.times,
    values,
    valueRange: computeValueRange(values),
  };
}

/**
 * Sum: Sum of bin values per frame.
 */
function reduceSum(input: ReductionInput, options?: ReductionOptions): ReductionResult {
  const nFrames = input.data.length;
  const values = new Float32Array(nFrames);

  for (let t = 0; t < nFrames; t++) {
    const frame = input.data[t];
    if (!frame || frame.length === 0) {
      values[t] = 0;
      continue;
    }

    const { low, high } = getBinRange(frame.length, options?.binRange);
    let sum = 0;

    for (let k = low; k < high; k++) {
      sum += frame[k] ?? 0;
    }

    values[t] = sum;
  }

  return {
    times: input.times,
    values,
    valueRange: computeValueRange(values),
  };
}

/**
 * Variance: Variance of bin values per frame.
 */
function reduceVariance(input: ReductionInput, options?: ReductionOptions): ReductionResult {
  const nFrames = input.data.length;
  const values = new Float32Array(nFrames);

  for (let t = 0; t < nFrames; t++) {
    const frame = input.data[t];
    if (!frame || frame.length === 0) {
      values[t] = 0;
      continue;
    }

    const { low, high } = getBinRange(frame.length, options?.binRange);
    const count = high - low;

    if (count <= 1) {
      values[t] = 0;
      continue;
    }

    // Compute mean
    let sum = 0;
    for (let k = low; k < high; k++) {
      sum += frame[k] ?? 0;
    }
    const mean = sum / count;

    // Compute variance
    let variance = 0;
    for (let k = low; k < high; k++) {
      const d = (frame[k] ?? 0) - mean;
      variance += d * d;
    }

    values[t] = variance / count;
  }

  return {
    times: input.times,
    values,
    valueRange: computeValueRange(values),
  };
}

/**
 * Amplitude: Sum of magnitudes (energy envelope).
 * Same as sum but semantically represents amplitude envelope.
 */
function reduceAmplitude(input: ReductionInput, options?: ReductionOptions): ReductionResult {
  // Amplitude is conceptually the same as sum for magnitude data
  return reduceSum(input, options);
}

/**
 * Spectral Flux: L1 distance between consecutive (optionally normalized) frames.
 */
function reduceSpectralFlux(input: ReductionInput, options?: ReductionOptions): ReductionResult {
  const nFrames = input.data.length;
  const values = new Float32Array(nFrames);
  const normalized = options?.spectralFlux?.normalized ?? true;

  if (nFrames === 0) {
    return {
      times: input.times,
      values,
      valueRange: { min: 0, max: 0 },
    };
  }

  // First frame has no previous
  values[0] = 0;
  let prevNorm: Float32Array | null = null;

  for (let t = 0; t < nFrames; t++) {
    const frame = input.data[t];
    if (!frame || frame.length === 0) {
      values[t] = 0;
      prevNorm = null;
      continue;
    }

    const { low, high } = getBinRange(frame.length, options?.binRange);

    // Extract and optionally normalize
    let curNorm: Float32Array;

    if (normalized) {
      let sum = 0;
      for (let k = low; k < high; k++) {
        sum += frame[k] ?? 0;
      }

      if (sum <= 0) {
        values[t] = 0;
        prevNorm = null;
        continue;
      }

      const inv = 1 / sum;
      curNorm = new Float32Array(high - low);
      for (let k = low; k < high; k++) {
        curNorm[k - low] = (frame[k] ?? 0) * inv;
      }
    } else {
      curNorm = new Float32Array(high - low);
      for (let k = low; k < high; k++) {
        curNorm[k - low] = frame[k] ?? 0;
      }
    }

    if (!prevNorm || prevNorm.length !== curNorm.length) {
      values[t] = 0;
      prevNorm = curNorm;
      continue;
    }

    // L1 distance
    let flux = 0;
    for (let k = 0; k < curNorm.length; k++) {
      flux += Math.abs((curNorm[k] ?? 0) - (prevNorm[k] ?? 0));
    }

    values[t] = flux;
    prevNorm = curNorm;
  }

  return {
    times: input.times,
    values,
    valueRange: computeValueRange(values),
  };
}

/**
 * Spectral Centroid: Weighted center of mass in bin space.
 * Returns bin index (not Hz - caller can convert if needed).
 */
function reduceSpectralCentroid(input: ReductionInput, options?: ReductionOptions): ReductionResult {
  const nFrames = input.data.length;
  const values = new Float32Array(nFrames);

  for (let t = 0; t < nFrames; t++) {
    const frame = input.data[t];
    if (!frame || frame.length === 0) {
      values[t] = 0;
      continue;
    }

    const { low, high } = getBinRange(frame.length, options?.binRange);

    let num = 0;
    let den = 0;

    for (let k = low; k < high; k++) {
      const m = frame[k] ?? 0;
      if (m > 0) {
        num += k * m;
        den += m;
      }
    }

    values[t] = den > 0 ? num / den : 0;
  }

  return {
    times: input.times,
    values,
    valueRange: computeValueRange(values),
  };
}

/**
 * Onset Strength: Temporal derivative with optional log compression and smoothing.
 */
function reduceOnsetStrength(input: ReductionInput, options?: ReductionOptions): ReductionResult {
  const nFrames = input.data.length;
  const values = new Float32Array(nFrames);

  const useLog = options?.onsetStrength?.useLog ?? true;
  const smoothMs = options?.onsetStrength?.smoothMs ?? 10;
  const diffMethod = options?.onsetStrength?.diffMethod ?? "rectified";

  if (nFrames === 0) {
    return {
      times: input.times,
      values,
      valueRange: { min: 0, max: 0 },
    };
  }

  // First frame has no previous
  values[0] = 0;

  for (let t = 1; t < nFrames; t++) {
    const cur = input.data[t];
    const prev = input.data[t - 1];

    if (!cur || !prev || cur.length === 0 || prev.length === 0) {
      values[t] = 0;
      continue;
    }

    const { low, high } = getBinRange(cur.length, options?.binRange);
    let sum = 0;
    let binsWithData = 0;

    for (let k = low; k < high; k++) {
      let a = cur[k] ?? 0;
      let b = prev[k] ?? 0;

      if (a > 0 || b > 0) {
        binsWithData++;

        if (useLog) {
          a = logCompress(a);
          b = logCompress(b);
        }

        const d = a - b;
        sum += diffMethod === "abs" ? Math.abs(d) : Math.max(0, d);
      }
    }

    values[t] = binsWithData > 0 ? sum / binsWithData : 0;
  }

  // Apply smoothing
  if (smoothMs > 0 && nFrames >= 2) {
    const dt = (input.times[1] ?? 0) - (input.times[0] ?? 0);
    if (dt > 0) {
      const windowFrames = Math.max(1, Math.round((smoothMs / 1000) / dt));
      const smoothed = movingAverage(values, windowFrames | 1);
      return {
        times: input.times,
        values: smoothed,
        valueRange: computeValueRange(smoothed),
      };
    }
  }

  return {
    times: input.times,
    values,
    valueRange: computeValueRange(values),
  };
}

// ----------------------------
// Main API
// ----------------------------

/**
 * Reduce 2D time-aligned data to a 1D signal using the specified algorithm.
 *
 * @param input - 2D input data (frames x bins)
 * @param algorithm - Reduction algorithm to use
 * @param options - Algorithm options including bin range selection
 * @returns Reduction result with times, values, and value range
 */
export function reduce2DToSignal(
  input: ReductionInput,
  algorithm: ReductionAlgorithmId,
  options?: ReductionOptions
): ReductionResult {
  switch (algorithm) {
    case "mean":
      return reduceMean(input, options);
    case "max":
      return reduceMax(input, options);
    case "sum":
      return reduceSum(input, options);
    case "variance":
      return reduceVariance(input, options);
    case "amplitude":
      return reduceAmplitude(input, options);
    case "spectralFlux":
      return reduceSpectralFlux(input, options);
    case "spectralCentroid":
      return reduceSpectralCentroid(input, options);
    case "onsetStrength":
      return reduceOnsetStrength(input, options);
    default:
      // Exhaustive check
      const _exhaustive: never = algorithm;
      throw new Error(`Unknown reduction algorithm: ${_exhaustive}`);
  }
}

/**
 * Get human-readable label for a reduction algorithm.
 */
export function getReductionAlgorithmLabel(algorithm: ReductionAlgorithmId): string {
  switch (algorithm) {
    case "mean":
      return "Mean";
    case "max":
      return "Maximum";
    case "sum":
      return "Sum";
    case "variance":
      return "Variance";
    case "amplitude":
      return "Amplitude Envelope";
    case "spectralFlux":
      return "Spectral Flux";
    case "spectralCentroid":
      return "Spectral Centroid";
    case "onsetStrength":
      return "Onset Strength";
    default:
      return String(algorithm);
  }
}

/**
 * Get description for a reduction algorithm.
 */
export function getReductionAlgorithmDescription(algorithm: ReductionAlgorithmId): string {
  switch (algorithm) {
    case "mean":
      return "Average value across all bins per frame";
    case "max":
      return "Maximum value across all bins per frame";
    case "sum":
      return "Sum of all bin values per frame";
    case "variance":
      return "Variance of bin values per frame";
    case "amplitude":
      return "Sum of magnitudes (energy envelope)";
    case "spectralFlux":
      return "Change between consecutive frames";
    case "spectralCentroid":
      return "Weighted center frequency";
    case "onsetStrength":
      return "Temporal derivative for onset detection";
    default:
      return "";
  }
}

// ----------------------------
// Polarity Types
// ----------------------------

/**
 * Polarity interpretation mode.
 * - "signed": Preserve direction (signal can be positive or negative)
 * - "magnitude": Activity level only (always positive, uses absolute value)
 */
export type PolarityMode = "signed" | "magnitude";

/**
 * Apply polarity interpretation to a signal.
 * Called after reduction, before stabilization.
 *
 * @param values - Input signal values
 * @param mode - Polarity mode to apply
 * @returns Transformed signal values
 */
export function applyPolarity(values: Float32Array, mode: PolarityMode): Float32Array {
  if (mode === "signed") {
    // No transformation needed
    return values;
  }

  // Magnitude mode: apply absolute value
  const result = new Float32Array(values.length);
  for (let i = 0; i < values.length; i++) {
    result[i] = Math.abs(values[i] ?? 0);
  }
  return result;
}

// ----------------------------
// Stabilization Types
// ----------------------------

/**
 * Stabilization mode presets.
 */
export type StabilizationMode = "none" | "light" | "medium" | "heavy";

/**
 * Envelope mode for signal shaping.
 */
export type EnvelopeMode = "raw" | "attackRelease";

/**
 * Options for signal stabilization.
 */
export interface StabilizationOptions {
  /** Smoothing intensity preset. */
  mode: StabilizationMode;
  /** Envelope shaping mode. */
  envelopeMode: EnvelopeMode;
  /** Attack time in seconds (only for attackRelease mode). */
  attackTimeSec?: number;
  /** Release time in seconds (only for attackRelease mode). */
  releaseTimeSec?: number;
}

// ----------------------------
// Stabilization Implementation
// ----------------------------

/**
 * Get smoothing window size for a stabilization mode.
 * Returns window size in number of frames.
 */
function getStabilizationWindowFrames(mode: StabilizationMode, frameTime: number): number {
  // Map mode to smoothing time in seconds
  const smoothingTimes: Record<StabilizationMode, number> = {
    none: 0,
    light: 0.01,    // 10ms
    medium: 0.03,   // 30ms
    heavy: 0.1,     // 100ms
  };

  const smoothMs = smoothingTimes[mode] * 1000;
  if (smoothMs <= 0 || frameTime <= 0) return 1;

  return Math.max(1, Math.round((smoothMs / 1000) / frameTime)) | 1; // Ensure odd
}

/**
 * Apply attack/release envelope following.
 * Attack: how fast the signal can rise
 * Release: how fast the signal can fall
 */
function applyAttackRelease(
  values: Float32Array,
  times: Float32Array,
  attackTimeSec: number,
  releaseTimeSec: number
): Float32Array {
  const n = values.length;
  if (n === 0) return values;

  const out = new Float32Array(n);
  out[0] = values[0] ?? 0;

  for (let i = 1; i < n; i++) {
    const dt = (times[i] ?? 0) - (times[i - 1] ?? 0);
    if (dt <= 0) {
      out[i] = values[i] ?? 0;
      continue;
    }

    const current = values[i] ?? 0;
    const prev = out[i - 1] ?? 0;

    if (current > prev) {
      // Rising - apply attack time constant
      if (attackTimeSec > 0) {
        const alpha = 1 - Math.exp(-dt / attackTimeSec);
        out[i] = prev + alpha * (current - prev);
      } else {
        out[i] = current;
      }
    } else {
      // Falling - apply release time constant
      if (releaseTimeSec > 0) {
        const alpha = 1 - Math.exp(-dt / releaseTimeSec);
        out[i] = prev + alpha * (current - prev);
      } else {
        out[i] = current;
      }
    }
  }

  return out;
}

/**
 * Apply stabilization to a signal.
 *
 * @param values - Input signal values
 * @param times - Frame times in seconds
 * @param options - Stabilization options
 * @returns Stabilized signal values
 */
export function stabilizeSignal(
  values: Float32Array,
  times: Float32Array,
  options: StabilizationOptions
): Float32Array {
  if (values.length === 0) return values;

  let result = values;

  // Step 1: Apply smoothing based on mode
  if (options.mode !== "none" && times.length >= 2) {
    const dt = (times[1] ?? 0) - (times[0] ?? 0);
    if (dt > 0) {
      const windowFrames = getStabilizationWindowFrames(options.mode, dt);
      if (windowFrames > 1) {
        result = movingAverage(result, windowFrames);
      }
    }
  }

  // Step 2: Apply envelope shaping
  if (options.envelopeMode === "attackRelease") {
    const attackSec = options.attackTimeSec ?? 0.01;
    const releaseSec = options.releaseTimeSec ?? 0.1;
    result = applyAttackRelease(result, times, attackSec, releaseSec);
  }

  return result;
}

// ----------------------------
// Statistics Helpers
// ----------------------------

/**
 * Compute percentile values from a signal.
 *
 * @param values - Signal values
 * @param percentiles - Array of percentiles to compute (0-100)
 * @returns Object mapping percentile to value
 */
export function computePercentiles(
  values: Float32Array,
  percentiles: number[]
): Record<number, number> {
  if (values.length === 0) {
    return Object.fromEntries(percentiles.map((p) => [p, 0]));
  }

  // Sort a copy
  const sorted = Float32Array.from(values).sort((a, b) => a - b);
  const n = sorted.length;

  const result: Record<number, number> = {};

  for (const p of percentiles) {
    const clamped = Math.max(0, Math.min(100, p));
    const index = (clamped / 100) * (n - 1);
    const lower = Math.floor(index);
    const upper = Math.min(lower + 1, n - 1);
    const frac = index - lower;

    // Linear interpolation
    result[p] = (sorted[lower] ?? 0) * (1 - frac) + (sorted[upper] ?? 0) * frac;
  }

  return result;
}

/**
 * Compute local (viewport) statistics for a signal.
 *
 * @param values - Signal values
 * @param times - Frame times in seconds
 * @param startTime - Viewport start time
 * @param endTime - Viewport end time
 * @returns Statistics within the viewport
 */
export function computeLocalStats(
  values: Float32Array,
  times: Float32Array,
  startTime: number,
  endTime: number
): { min: number; max: number; p5: number; p95: number } {
  // Find frames within viewport
  const indices: number[] = [];
  for (let i = 0; i < times.length; i++) {
    const t = times[i] ?? 0;
    if (t >= startTime && t <= endTime) {
      indices.push(i);
    }
  }

  if (indices.length === 0) {
    return { min: 0, max: 0, p5: 0, p95: 0 };
  }

  // Extract values in viewport
  const viewportValues = new Float32Array(indices.length);
  for (let i = 0; i < indices.length; i++) {
    viewportValues[i] = values[indices[i] ?? 0] ?? 0;
  }

  // Compute stats
  const range = computeValueRange(viewportValues);
  const percentiles = computePercentiles(viewportValues, [5, 95]);

  return {
    min: range.min,
    max: range.max,
    p5: percentiles[5] ?? 0,
    p95: percentiles[95] ?? 0,
  };
}
