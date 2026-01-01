/**
 * Peak Picking Algorithm
 *
 * Detects local maxima in a 1D signal that exceed a threshold.
 * Used to create event streams from continuous signals.
 */

export interface PeakPickingParams {
  /** Minimum normalized value (0-1) for a peak to be considered. Default: 0.3 */
  threshold: number;
  /** Minimum time between peaks in seconds. Default: 0.1 */
  minDistance: number;
  /** Number of samples to look back for local max comparison. Default: 2 */
  preMax?: number;
  /** Number of samples to look forward for local max comparison. Default: 2 */
  postMax?: number;
}

export interface PeakPickingResult {
  /** Times of detected peaks (seconds) */
  times: Float32Array;
  /** Normalized strength of each peak (0-1, based on normalized value) */
  strengths: Float32Array;
}

/**
 * Default peak picking parameters
 */
export const DEFAULT_PEAK_PICKING_PARAMS: Required<PeakPickingParams> = {
  threshold: 0.3,
  minDistance: 0.1,
  preMax: 2,
  postMax: 2,
};

/**
 * Pick peaks from a continuous signal.
 *
 * @param times - Time values in seconds (Float32Array)
 * @param values - Signal values (Float32Array)
 * @param params - Peak picking parameters
 * @returns Detected peaks with times and strengths
 */
export function pickPeaks(
  times: Float32Array,
  values: Float32Array,
  params: Partial<PeakPickingParams> = {}
): PeakPickingResult {
  const {
    threshold,
    minDistance,
    preMax,
    postMax,
  } = { ...DEFAULT_PEAK_PICKING_PARAMS, ...params };

  if (times.length === 0 || values.length === 0) {
    return {
      times: new Float32Array(0),
      strengths: new Float32Array(0),
    };
  }

  // Find min/max for normalization
  let minVal = values[0]!;
  let maxVal = values[0]!;
  for (let i = 1; i < values.length; i++) {
    const v = values[i]!;
    if (v < minVal) minVal = v;
    if (v > maxVal) maxVal = v;
  }

  const range = maxVal - minVal;
  if (range <= 0) {
    // Constant signal - no peaks
    return {
      times: new Float32Array(0),
      strengths: new Float32Array(0),
    };
  }

  // Normalize function
  const normalize = (v: number) => (v - minVal) / range;

  // Find peaks
  const peakIndices: number[] = [];
  const peakStrengths: number[] = [];

  for (let i = preMax; i < values.length - postMax; i++) {
    const currentVal = values[i]!;
    const normalizedVal = normalize(currentVal);

    // Skip if below threshold
    if (normalizedVal < threshold) continue;

    // Check if local maximum
    let isMax = true;

    // Check pre-samples
    for (let j = 1; j <= preMax; j++) {
      if (values[i - j]! >= currentVal) {
        isMax = false;
        break;
      }
    }

    // Check post-samples
    if (isMax) {
      for (let j = 1; j <= postMax; j++) {
        if (values[i + j]! > currentVal) {
          isMax = false;
          break;
        }
      }
    }

    if (isMax) {
      peakIndices.push(i);
      peakStrengths.push(normalizedVal);
    }
  }

  // Apply minimum distance constraint (keep higher peaks)
  const filteredIndices: number[] = [];
  const filteredStrengths: number[] = [];

  for (let i = 0; i < peakIndices.length; i++) {
    const idx = peakIndices[i]!;
    const time = times[idx]!;
    const strength = peakStrengths[i]!;

    // Check if there's a higher peak within minDistance
    let shouldKeep = true;

    for (let j = 0; j < filteredIndices.length; j++) {
      const prevIdx = filteredIndices[j]!;
      const prevTime = times[prevIdx]!;
      const prevStrength = filteredStrengths[j]!;

      if (Math.abs(time - prevTime) < minDistance) {
        if (strength > prevStrength) {
          // Replace previous peak
          filteredIndices[j] = idx;
          filteredStrengths[j] = strength;
        }
        shouldKeep = false;
        break;
      }
    }

    if (shouldKeep) {
      filteredIndices.push(idx);
      filteredStrengths.push(strength);
    }
  }

  // Convert to output format
  const resultTimes = new Float32Array(filteredIndices.length);
  const resultStrengths = new Float32Array(filteredStrengths.length);

  for (let i = 0; i < filteredIndices.length; i++) {
    resultTimes[i] = times[filteredIndices[i]!]!;
    resultStrengths[i] = filteredStrengths[i]!;
  }

  return {
    times: resultTimes,
    strengths: resultStrengths,
  };
}

/**
 * Result from adaptive peak picking, including the threshold curve for visualization.
 */
export interface AdaptivePeakPickingResult extends PeakPickingResult {
  /** The adaptive threshold curve (normalized 0-1) for visualization */
  thresholdCurve: Float32Array;
  /** Time values corresponding to threshold curve samples */
  thresholdTimes: Float32Array;
}

/**
 * Compute the adaptive threshold curve for visualization.
 * This is the normalized threshold that would be used by pickPeaksAdaptive.
 *
 * @param values - Signal values (Float32Array)
 * @param windowSize - Window size for local statistics (in samples)
 * @param thresholdMultiplier - Multiplier for local std (default 1.5)
 * @returns Normalized threshold curve (0-1 range)
 */
export function computeAdaptiveThreshold(
  values: Float32Array,
  windowSize: number = 20,
  thresholdMultiplier: number = 1.5
): Float32Array {
  if (values.length === 0) {
    return new Float32Array(0);
  }

  // Find min/max for normalization
  let minVal = values[0]!;
  let maxVal = values[0]!;
  for (let i = 1; i < values.length; i++) {
    const v = values[i]!;
    if (v < minVal) minVal = v;
    if (v > maxVal) maxVal = v;
  }
  const range = maxVal - minVal;
  if (range <= 0) {
    return new Float32Array(values.length).fill(0.5);
  }

  // Compute adaptive threshold
  const halfWindow = Math.floor(windowSize / 2);
  const thresholdCurve = new Float32Array(values.length);

  for (let i = 0; i < values.length; i++) {
    const start = Math.max(0, i - halfWindow);
    const end = Math.min(values.length, i + halfWindow + 1);
    const windowLen = end - start;

    // Compute local mean
    let sum = 0;
    for (let j = start; j < end; j++) {
      sum += values[j]!;
    }
    const mean = sum / windowLen;

    // Compute local std
    let sumSq = 0;
    for (let j = start; j < end; j++) {
      const diff = values[j]! - mean;
      sumSq += diff * diff;
    }
    const std = Math.sqrt(sumSq / windowLen);

    // Adaptive threshold in original scale
    const adaptiveThresh = mean + thresholdMultiplier * std;

    // Normalize to 0-1 range
    thresholdCurve[i] = Math.max(0, Math.min(1, (adaptiveThresh - minVal) / range));
  }

  return thresholdCurve;
}

/**
 * Pick peaks with adaptive threshold based on local statistics.
 *
 * @param times - Time values in seconds
 * @param values - Signal values
 * @param windowSize - Window size for local statistics (in samples)
 * @param params - Base peak picking parameters (threshold used as multiplier of local std)
 * @param includeThresholdCurve - If true, returns the threshold curve for visualization
 */
export function pickPeaksAdaptive(
  times: Float32Array,
  values: Float32Array,
  windowSize: number = 20,
  params: Partial<PeakPickingParams> = {},
  includeThresholdCurve: boolean = false
): PeakPickingResult | AdaptivePeakPickingResult {
  const {
    threshold,
    minDistance,
    preMax,
    postMax,
  } = { ...DEFAULT_PEAK_PICKING_PARAMS, threshold: 1.5, ...params };

  if (times.length === 0 || values.length === 0) {
    return {
      times: new Float32Array(0),
      strengths: new Float32Array(0),
    };
  }

  // Compute adaptive threshold using local mean + threshold * local std
  const adaptiveThreshold = new Float32Array(values.length);
  const halfWindow = Math.floor(windowSize / 2);

  for (let i = 0; i < values.length; i++) {
    const start = Math.max(0, i - halfWindow);
    const end = Math.min(values.length, i + halfWindow + 1);
    const windowLen = end - start;

    // Compute local mean
    let sum = 0;
    for (let j = start; j < end; j++) {
      sum += values[j]!;
    }
    const mean = sum / windowLen;

    // Compute local std
    let sumSq = 0;
    for (let j = start; j < end; j++) {
      const diff = values[j]! - mean;
      sumSq += diff * diff;
    }
    const std = Math.sqrt(sumSq / windowLen);

    adaptiveThreshold[i] = mean + threshold * std;
  }

  // Find min/max for strength normalization
  let minVal = values[0]!;
  let maxVal = values[0]!;
  for (let i = 1; i < values.length; i++) {
    const v = values[i]!;
    if (v < minVal) minVal = v;
    if (v > maxVal) maxVal = v;
  }
  const range = maxVal - minVal;
  const normalize = range > 0 ? (v: number) => (v - minVal) / range : () => 0.5;

  // Find peaks
  const peakIndices: number[] = [];
  const peakStrengths: number[] = [];

  for (let i = preMax; i < values.length - postMax; i++) {
    const currentVal = values[i]!;

    // Skip if below adaptive threshold
    if (currentVal < adaptiveThreshold[i]!) continue;

    // Check if local maximum
    let isMax = true;

    for (let j = 1; j <= preMax; j++) {
      if (values[i - j]! >= currentVal) {
        isMax = false;
        break;
      }
    }

    if (isMax) {
      for (let j = 1; j <= postMax; j++) {
        if (values[i + j]! > currentVal) {
          isMax = false;
          break;
        }
      }
    }

    if (isMax) {
      peakIndices.push(i);
      peakStrengths.push(normalize(currentVal));
    }
  }

  // Apply minimum distance constraint
  const filteredIndices: number[] = [];
  const filteredStrengths: number[] = [];

  for (let i = 0; i < peakIndices.length; i++) {
    const idx = peakIndices[i]!;
    const time = times[idx]!;
    const strength = peakStrengths[i]!;

    let shouldKeep = true;

    for (let j = 0; j < filteredIndices.length; j++) {
      const prevIdx = filteredIndices[j]!;
      const prevTime = times[prevIdx]!;
      const prevStrength = filteredStrengths[j]!;

      if (Math.abs(time - prevTime) < minDistance) {
        if (strength > prevStrength) {
          filteredIndices[j] = idx;
          filteredStrengths[j] = strength;
        }
        shouldKeep = false;
        break;
      }
    }

    if (shouldKeep) {
      filteredIndices.push(idx);
      filteredStrengths.push(strength);
    }
  }

  // Convert to output format
  const resultTimes = new Float32Array(filteredIndices.length);
  const resultStrengths = new Float32Array(filteredStrengths.length);

  for (let i = 0; i < filteredIndices.length; i++) {
    resultTimes[i] = times[filteredIndices[i]!]!;
    resultStrengths[i] = filteredStrengths[i]!;
  }

  const baseResult: PeakPickingResult = {
    times: resultTimes,
    strengths: resultStrengths,
  };

  if (!includeThresholdCurve) {
    return baseResult;
  }

  // Compute normalized threshold curve for visualization
  const normalizedThreshold = new Float32Array(values.length);
  for (let i = 0; i < values.length; i++) {
    normalizedThreshold[i] = range > 0
      ? Math.max(0, Math.min(1, (adaptiveThreshold[i]! - minVal) / range))
      : 0.5;
  }

  return {
    ...baseResult,
    thresholdCurve: normalizedThreshold,
    thresholdTimes: times,
  } as AdaptivePeakPickingResult;
}

/**
 * Hysteresis gate parameters for peak filtering.
 */
export interface HysteresisGateParams {
  /** Upper threshold (0-1) - signal must exceed this to trigger "on" state */
  onThreshold: number;
  /** Lower threshold (0-1) - signal must fall below this to trigger "off" state */
  offThreshold: number;
  /** Minimum time between peaks in seconds */
  minDistance: number;
}

/**
 * Apply hysteresis gating to peaks.
 * Peaks are only kept if the signal has dropped below offThreshold since the last peak.
 * This prevents multiple triggers during sustained high-value regions.
 *
 * @param times - Time values of the original signal
 * @param values - Values of the original signal (for checking hysteresis)
 * @param peakTimes - Times of detected peaks
 * @param peakStrengths - Strengths of detected peaks
 * @param params - Hysteresis gate parameters
 * @returns Filtered peaks after hysteresis gating
 */
export function applyHysteresisGate(
  times: Float32Array,
  values: Float32Array,
  peakTimes: Float32Array,
  peakStrengths: Float32Array,
  params: HysteresisGateParams
): PeakPickingResult {
  const { onThreshold, offThreshold, minDistance } = params;

  if (peakTimes.length === 0) {
    return { times: new Float32Array(0), strengths: new Float32Array(0) };
  }

  // Normalize values to 0-1 range
  let minVal = values[0]!;
  let maxVal = values[0]!;
  for (let i = 1; i < values.length; i++) {
    const v = values[i]!;
    if (v < minVal) minVal = v;
    if (v > maxVal) maxVal = v;
  }
  const range = maxVal - minVal;
  const normalize = range > 0 ? (v: number) => (v - minVal) / range : () => 0.5;

  // Build time-to-index lookup (approximate)
  const getIndexForTime = (t: number): number => {
    // Binary search for closest time
    let lo = 0;
    let hi = times.length - 1;
    while (lo < hi) {
      const mid = Math.floor((lo + hi) / 2);
      if (times[mid]! < t) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }
    return lo;
  };

  const filteredTimes: number[] = [];
  const filteredStrengths: number[] = [];
  let lastPeakTime = -Infinity;
  let gateOpen = true; // Start with gate open

  for (let i = 0; i < peakTimes.length; i++) {
    const peakTime = peakTimes[i]!;
    const peakStrength = peakStrengths[i]!;

    // Check if we've met the minimum distance requirement
    if (peakTime - lastPeakTime < minDistance) {
      continue;
    }

    // If gate is closed, check if signal has dropped below offThreshold since last peak
    if (!gateOpen) {
      const startIdx = getIndexForTime(lastPeakTime);
      const endIdx = getIndexForTime(peakTime);

      // Check if signal dropped below offThreshold at any point
      for (let j = startIdx; j < endIdx && j < values.length; j++) {
        if (normalize(values[j]!) < offThreshold) {
          gateOpen = true;
          break;
        }
      }
    }

    // If gate is open and peak exceeds onThreshold, keep it
    if (gateOpen && peakStrength >= onThreshold) {
      filteredTimes.push(peakTime);
      filteredStrengths.push(peakStrength);
      lastPeakTime = peakTime;
      gateOpen = false; // Close gate after peak
    }
  }

  return {
    times: new Float32Array(filteredTimes),
    strengths: new Float32Array(filteredStrengths),
  };
}
