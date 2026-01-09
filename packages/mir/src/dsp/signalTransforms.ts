/**
 * Signal Transforms
 *
 * Transform chain implementation for derived signals.
 * All transforms are pure functions that operate on Float32Array values.
 *
 * Transform categories:
 * - Smooth: movingAverage, exponential, gaussian
 * - Normalize: minMax, robust, zScore
 * - Scale: linear scaling with offset
 * - Polarity: signed, magnitude
 * - Clamp: min/max bounds
 * - Remap: input range to output range with curve
 */

// ============================================================================
// TYPES
// ============================================================================

/**
 * Base transform type.
 */
interface TransformBase {
  kind: string;
}

/**
 * Smooth with moving average.
 */
export interface TransformSmoothMovingAverage extends TransformBase {
  kind: "smooth";
  method: "movingAverage";
  windowMs: number;
}

/**
 * Smooth with exponential filter.
 */
export interface TransformSmoothExponential extends TransformBase {
  kind: "smooth";
  method: "exponential";
  timeConstantMs: number;
}

/**
 * Smooth with Gaussian kernel.
 */
export interface TransformSmoothGaussian extends TransformBase {
  kind: "smooth";
  method: "gaussian";
  windowMs: number;
}

/**
 * All smoothing transform types.
 */
export type TransformSmooth =
  | TransformSmoothMovingAverage
  | TransformSmoothExponential
  | TransformSmoothGaussian;

/**
 * Normalize to 0-1 range using min/max.
 */
export interface TransformNormalizeMinMax extends TransformBase {
  kind: "normalize";
  method: "minMax";
  targetMin?: number; // Default: 0
  targetMax?: number; // Default: 1
}

/**
 * Normalize using robust percentile range.
 */
export interface TransformNormalizeRobust extends TransformBase {
  kind: "normalize";
  method: "robust";
  percentileLow?: number; // Default: 5
  percentileHigh?: number; // Default: 95
  targetMin?: number; // Default: 0
  targetMax?: number; // Default: 1
}

/**
 * Normalize using z-score (mean and std dev).
 */
export interface TransformNormalizeZScore extends TransformBase {
  kind: "normalize";
  method: "zScore";
}

/**
 * All normalization transform types.
 */
export type TransformNormalize =
  | TransformNormalizeMinMax
  | TransformNormalizeRobust
  | TransformNormalizeZScore;

/**
 * Linear scale and offset.
 */
export interface TransformScale extends TransformBase {
  kind: "scale";
  scale: number;
  offset: number;
}

/**
 * Polarity mode.
 */
export interface TransformPolarity extends TransformBase {
  kind: "polarity";
  mode: "signed" | "magnitude";
}

/**
 * Clamp to bounds.
 */
export interface TransformClamp extends TransformBase {
  kind: "clamp";
  min?: number;
  max?: number;
}

/**
 * Remap from input range to output range.
 */
export interface TransformRemap extends TransformBase {
  kind: "remap";
  inputMin: number;
  inputMax: number;
  outputMin: number;
  outputMax: number;
  curve?: "linear" | "ease" | "easeIn" | "easeOut";
}

/**
 * Union of all transform step types.
 */
export type TransformStep =
  | TransformSmooth
  | TransformNormalize
  | TransformScale
  | TransformPolarity
  | TransformClamp
  | TransformRemap;

/**
 * A chain of transforms to apply in sequence.
 */
export type TransformChain = TransformStep[];

/**
 * Context for transform chain execution.
 */
export interface TransformContext {
  /** Sample rate of the signal (samples per second). */
  sampleRate: number;
  /** Time points in seconds (optional, for time-aware transforms). */
  times?: Float32Array;
}

// ============================================================================
// SMOOTHING IMPLEMENTATIONS
// ============================================================================

/**
 * Apply moving average smoothing.
 */
function smoothMovingAverage(
  values: Float32Array,
  windowMs: number,
  sampleRate: number
): Float32Array {
  const windowSamples = Math.max(1, Math.round((windowMs / 1000) * sampleRate)) | 1;
  if (windowSamples <= 1) return values;

  const n = values.length;
  const result = new Float32Array(n);
  const halfWindow = Math.floor(windowSamples / 2);

  for (let i = 0; i < n; i++) {
    const start = Math.max(0, i - halfWindow);
    const end = Math.min(n, i + halfWindow + 1);
    let sum = 0;
    for (let j = start; j < end; j++) {
      sum += values[j]!;
    }
    result[i] = sum / (end - start);
  }

  return result;
}

/**
 * Apply exponential smoothing (first-order IIR filter).
 */
function smoothExponential(
  values: Float32Array,
  timeConstantMs: number,
  sampleRate: number
): Float32Array {
  const n = values.length;
  if (n === 0) return values;

  const result = new Float32Array(n);
  const dt = 1 / sampleRate;
  const alpha = 1 - Math.exp(-dt / (timeConstantMs / 1000));

  result[0] = values[0]!;
  for (let i = 1; i < n; i++) {
    result[i] = result[i - 1]! + alpha * (values[i]! - result[i - 1]!);
  }

  return result;
}

/**
 * Apply Gaussian smoothing.
 */
function smoothGaussian(
  values: Float32Array,
  windowMs: number,
  sampleRate: number
): Float32Array {
  const windowSamples = Math.max(1, Math.round((windowMs / 1000) * sampleRate));
  if (windowSamples <= 1) return values;

  const n = values.length;
  const result = new Float32Array(n);
  const sigma = windowSamples / 4;
  const halfWindow = Math.floor(windowSamples / 2);

  // Precompute Gaussian kernel
  const kernel = new Float32Array(windowSamples);
  let kernelSum = 0;
  for (let i = 0; i < windowSamples; i++) {
    const x = i - halfWindow;
    kernel[i] = Math.exp(-(x * x) / (2 * sigma * sigma));
    kernelSum += kernel[i]!;
  }
  // Normalize kernel
  for (let i = 0; i < windowSamples; i++) {
    kernel[i] = kernel[i]! / kernelSum;
  }

  // Apply convolution
  for (let i = 0; i < n; i++) {
    let sum = 0;
    let weightSum = 0;
    for (let j = 0; j < windowSamples; j++) {
      const idx = i - halfWindow + j;
      if (idx >= 0 && idx < n) {
        sum += values[idx]! * kernel[j]!;
        weightSum += kernel[j]!;
      }
    }
    result[i] = weightSum > 0 ? sum / weightSum : values[i]!;
  }

  return result;
}

// ============================================================================
// NORMALIZATION IMPLEMENTATIONS
// ============================================================================

/**
 * Normalize using min/max.
 */
function normalizeMinMax(
  values: Float32Array,
  targetMin: number = 0,
  targetMax: number = 1
): Float32Array {
  const n = values.length;
  if (n === 0) return values;

  // Find min and max
  let min = values[0]!;
  let max = values[0]!;
  for (let i = 1; i < n; i++) {
    const v = values[i]!;
    if (v < min) min = v;
    if (v > max) max = v;
  }

  // Avoid division by zero
  if (max === min) {
    const result = new Float32Array(n);
    result.fill((targetMin + targetMax) / 2);
    return result;
  }

  // Normalize
  const result = new Float32Array(n);
  const sourceRange = max - min;
  const targetRange = targetMax - targetMin;
  for (let i = 0; i < n; i++) {
    result[i] = targetMin + ((values[i]! - min) / sourceRange) * targetRange;
  }

  return result;
}

/**
 * Normalize using robust percentile range.
 */
function normalizeRobust(
  values: Float32Array,
  percentileLow: number = 5,
  percentileHigh: number = 95,
  targetMin: number = 0,
  targetMax: number = 1
): Float32Array {
  const n = values.length;
  if (n === 0) return values;

  // Sort for percentile computation
  const sorted = Array.from(values).sort((a, b) => a - b);
  const lowIdx = Math.floor((percentileLow / 100) * (n - 1));
  const highIdx = Math.floor((percentileHigh / 100) * (n - 1));
  const pLow = sorted[lowIdx]!;
  const pHigh = sorted[highIdx]!;

  // Avoid division by zero
  if (pHigh === pLow) {
    const result = new Float32Array(n);
    result.fill((targetMin + targetMax) / 2);
    return result;
  }

  // Normalize and clamp
  const result = new Float32Array(n);
  const sourceRange = pHigh - pLow;
  const targetRange = targetMax - targetMin;
  for (let i = 0; i < n; i++) {
    const normalized = (values[i]! - pLow) / sourceRange;
    const clamped = Math.max(0, Math.min(1, normalized));
    result[i] = targetMin + clamped * targetRange;
  }

  return result;
}

/**
 * Normalize using z-score.
 */
function normalizeZScore(values: Float32Array): Float32Array {
  const n = values.length;
  if (n === 0) return values;

  // Compute mean
  let sum = 0;
  for (let i = 0; i < n; i++) {
    sum += values[i]!;
  }
  const mean = sum / n;

  // Compute standard deviation
  let variance = 0;
  for (let i = 0; i < n; i++) {
    const diff = values[i]! - mean;
    variance += diff * diff;
  }
  const stdDev = Math.sqrt(variance / n);

  // Avoid division by zero
  if (stdDev === 0) {
    const result = new Float32Array(n);
    result.fill(0);
    return result;
  }

  // Normalize
  const result = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    result[i] = (values[i]! - mean) / stdDev;
  }

  return result;
}

// ============================================================================
// OTHER TRANSFORM IMPLEMENTATIONS
// ============================================================================

/**
 * Apply linear scale and offset.
 */
function applyScale(
  values: Float32Array,
  scale: number,
  offset: number
): Float32Array {
  const n = values.length;
  const result = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    result[i] = values[i]! * scale + offset;
  }
  return result;
}

/**
 * Apply polarity transformation.
 */
function applyPolarityTransform(
  values: Float32Array,
  mode: "signed" | "magnitude"
): Float32Array {
  if (mode === "signed") {
    return values;
  }

  const n = values.length;
  const result = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    result[i] = Math.abs(values[i]!);
  }
  return result;
}

/**
 * Apply clamping to bounds.
 */
function applyClamp(
  values: Float32Array,
  min?: number,
  max?: number
): Float32Array {
  const n = values.length;
  const result = new Float32Array(n);

  for (let i = 0; i < n; i++) {
    let v = values[i]!;
    if (min !== undefined && v < min) v = min;
    if (max !== undefined && v > max) v = max;
    result[i] = v;
  }

  return result;
}

/**
 * Apply remap with optional curve.
 */
function applyRemap(
  values: Float32Array,
  inputMin: number,
  inputMax: number,
  outputMin: number,
  outputMax: number,
  curve: "linear" | "ease" | "easeIn" | "easeOut" = "linear"
): Float32Array {
  const n = values.length;
  const result = new Float32Array(n);
  const inputRange = inputMax - inputMin;
  const outputRange = outputMax - outputMin;

  // Avoid division by zero
  if (inputRange === 0) {
    result.fill((outputMin + outputMax) / 2);
    return result;
  }

  for (let i = 0; i < n; i++) {
    // Normalize to 0-1
    let t = (values[i]! - inputMin) / inputRange;
    t = Math.max(0, Math.min(1, t)); // Clamp

    // Apply curve
    switch (curve) {
      case "easeIn":
        t = t * t;
        break;
      case "easeOut":
        t = 1 - (1 - t) * (1 - t);
        break;
      case "ease":
        t = t < 0.5
          ? 2 * t * t
          : 1 - Math.pow(-2 * t + 2, 2) / 2;
        break;
      // linear: no change
    }

    // Map to output range
    result[i] = outputMin + t * outputRange;
  }

  return result;
}

// ============================================================================
// TRANSFORM CHAIN EXECUTION
// ============================================================================

/**
 * Apply a single transform step.
 */
export function applyTransformStep(
  values: Float32Array,
  step: TransformStep,
  context: TransformContext
): Float32Array {
  switch (step.kind) {
    case "smooth":
      switch (step.method) {
        case "movingAverage":
          return smoothMovingAverage(values, step.windowMs, context.sampleRate);
        case "exponential":
          return smoothExponential(values, step.timeConstantMs, context.sampleRate);
        case "gaussian":
          return smoothGaussian(values, step.windowMs, context.sampleRate);
        default:
          return values;
      }

    case "normalize":
      switch (step.method) {
        case "minMax":
          return normalizeMinMax(values, step.targetMin, step.targetMax);
        case "robust":
          return normalizeRobust(
            values,
            step.percentileLow,
            step.percentileHigh,
            step.targetMin,
            step.targetMax
          );
        case "zScore":
          return normalizeZScore(values);
        default:
          return values;
      }

    case "scale":
      return applyScale(values, step.scale, step.offset);

    case "polarity":
      return applyPolarityTransform(values, step.mode);

    case "clamp":
      return applyClamp(values, step.min, step.max);

    case "remap":
      return applyRemap(
        values,
        step.inputMin,
        step.inputMax,
        step.outputMin,
        step.outputMax,
        step.curve
      );

    default:
      return values;
  }
}

/**
 * Apply a chain of transforms to a signal.
 */
export function applyTransformChain(
  values: Float32Array,
  chain: TransformChain,
  context: TransformContext
): Float32Array {
  let result = values;

  for (const step of chain) {
    result = applyTransformStep(result, step, context);
  }

  return result;
}

// ============================================================================
// TRANSFORM UTILITIES
// ============================================================================

/**
 * Get human-readable label for a transform step.
 */
export function getTransformLabel(step: TransformStep): string {
  switch (step.kind) {
    case "smooth":
      switch (step.method) {
        case "movingAverage":
          return `Smooth (${step.windowMs}ms avg)`;
        case "exponential":
          return `Smooth (${step.timeConstantMs}ms exp)`;
        case "gaussian":
          return `Smooth (${step.windowMs}ms gauss)`;
        default:
          return "Smooth";
      }

    case "normalize":
      switch (step.method) {
        case "minMax":
          return `Normalize (${step.targetMin ?? 0}-${step.targetMax ?? 1})`;
        case "robust":
          return `Normalize (robust ${step.percentileLow ?? 5}-${step.percentileHigh ?? 95}%)`;
        case "zScore":
          return "Normalize (z-score)";
        default:
          return "Normalize";
      }

    case "scale":
      return step.offset !== 0
        ? `Scale (×${step.scale} + ${step.offset})`
        : `Scale (×${step.scale})`;

    case "polarity":
      return step.mode === "magnitude" ? "Magnitude" : "Signed";

    case "clamp":
      if (step.min !== undefined && step.max !== undefined) {
        return `Clamp (${step.min}-${step.max})`;
      } else if (step.min !== undefined) {
        return `Clamp (≥${step.min})`;
      } else if (step.max !== undefined) {
        return `Clamp (≤${step.max})`;
      }
      return "Clamp";

    case "remap":
      return `Remap (${step.inputMin}-${step.inputMax} → ${step.outputMin}-${step.outputMax})`;

    default:
      return "Unknown";
  }
}

/**
 * Create a default transform step for a kind.
 */
export function createDefaultTransform(
  kind: TransformStep["kind"]
): TransformStep | null {
  switch (kind) {
    case "smooth":
      return { kind: "smooth", method: "movingAverage", windowMs: 10 };
    case "normalize":
      return { kind: "normalize", method: "minMax", targetMin: 0, targetMax: 1 };
    case "scale":
      return { kind: "scale", scale: 1, offset: 0 };
    case "polarity":
      return { kind: "polarity", mode: "signed" };
    case "clamp":
      return { kind: "clamp", min: 0, max: 1 };
    case "remap":
      return { kind: "remap", inputMin: 0, inputMax: 1, outputMin: 0, outputMax: 1 };
    default:
      return null;
  }
}
