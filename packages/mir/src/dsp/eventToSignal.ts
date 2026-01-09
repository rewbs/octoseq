/**
 * Event to Signal Conversion
 *
 * Converts discrete event streams (onsets, beats, authored events)
 * into continuous 1D signals for use in derived signal pipelines.
 *
 * Reducer algorithms:
 * - eventCount: Count events per window
 * - eventDensity: Normalized count (events per second)
 * - weightedSum: Sum of event weights per window
 * - weightedMean: Mean of event weights per window
 * - envelope: Generate continuous envelope from events
 */

// ============================================================================
// TYPES
// ============================================================================

/**
 * A discrete event with time and optional weight.
 */
export interface DiscreteEvent {
  /** Event time in seconds. */
  time: number;
  /** Event weight (default 1.0). */
  weight?: number;
  /** Optional duration in seconds. */
  duration?: number;
}

/**
 * Window specification for event aggregation.
 */
export type EventWindowSpec =
  | { kind: "seconds"; windowSize: number }
  | { kind: "samples"; windowSize: number };

/**
 * Envelope shape for event-to-signal conversion.
 */
export type EnvelopeShape =
  | { kind: "impulse" }
  | { kind: "gaussian"; widthMs: number }
  | { kind: "attackDecay"; attackMs: number; decayMs: number }
  | { kind: "gate" }; // Uses event duration

/**
 * Options for event-to-signal conversion.
 */
export interface EventToSignalOptions {
  /** Sample rate for output signal (samples per second). */
  sampleRate: number;
  /** Total duration in seconds. */
  duration: number;
  /** Whether to normalize output to 0-1 range. */
  normalize?: boolean;
}

/**
 * Result of event-to-signal conversion.
 */
export interface EventSignalResult {
  /** Signal values. */
  values: Float32Array;
  /** Time points in seconds. */
  times: Float32Array;
  /** Value range before normalization. */
  rawRange: { min: number; max: number };
}

// ============================================================================
// ENVELOPE GENERATORS
// ============================================================================

/**
 * Generate a Gaussian envelope centered at a given sample.
 */
function generateGaussianEnvelope(
  centerSample: number,
  widthSamples: number,
  numSamples: number
): Float32Array {
  const envelope = new Float32Array(numSamples);
  const sigma = widthSamples / 4; // 4 sigma covers ~95% of the bell
  const twoSigmaSq = 2 * sigma * sigma;

  const startSample = Math.max(0, Math.floor(centerSample - widthSamples));
  const endSample = Math.min(numSamples, Math.ceil(centerSample + widthSamples));

  for (let i = startSample; i < endSample; i++) {
    const diff = i - centerSample;
    envelope[i] = Math.exp(-(diff * diff) / twoSigmaSq);
  }

  return envelope;
}

/**
 * Generate an attack-decay envelope starting at a given sample.
 */
function generateAttackDecayEnvelope(
  startSample: number,
  attackSamples: number,
  decaySamples: number,
  numSamples: number
): Float32Array {
  const envelope = new Float32Array(numSamples);

  // Attack phase
  const attackEnd = Math.min(numSamples, startSample + attackSamples);
  for (let i = startSample; i < attackEnd; i++) {
    if (i >= 0) {
      const t = (i - startSample) / attackSamples;
      envelope[i] = t;
    }
  }

  // Decay phase
  const decayStart = startSample + attackSamples;
  const decayEnd = Math.min(numSamples, decayStart + decaySamples);
  for (let i = decayStart; i < decayEnd; i++) {
    if (i >= 0) {
      const t = (i - decayStart) / decaySamples;
      envelope[i] = 1 - t;
    }
  }

  return envelope;
}

/**
 * Generate a gate envelope (rectangular) for an event with duration.
 */
function generateGateEnvelope(
  startSample: number,
  durationSamples: number,
  numSamples: number
): Float32Array {
  const envelope = new Float32Array(numSamples);

  const endSample = Math.min(numSamples, startSample + durationSamples);
  for (let i = Math.max(0, startSample); i < endSample; i++) {
    envelope[i] = 1;
  }

  return envelope;
}

// ============================================================================
// REDUCER IMPLEMENTATIONS
// ============================================================================

/**
 * Count events per window (sliding window approach).
 */
export function eventCount(
  events: DiscreteEvent[],
  windowSpec: EventWindowSpec,
  options: EventToSignalOptions
): EventSignalResult {
  const { sampleRate, duration, normalize = false } = options;
  const numSamples = Math.ceil(duration * sampleRate);
  const values = new Float32Array(numSamples);
  const times = new Float32Array(numSamples);

  // Generate time array
  for (let i = 0; i < numSamples; i++) {
    times[i] = i / sampleRate;
  }

  const windowSamples =
    windowSpec.kind === "seconds"
      ? Math.ceil(windowSpec.windowSize * sampleRate)
      : windowSpec.windowSize;

  const halfWindow = Math.floor(windowSamples / 2);

  // Sort events by time
  const sortedEvents = [...events].sort((a, b) => a.time - b.time);

  // Count events in each window
  for (let i = 0; i < numSamples; i++) {
    const windowStart = (i - halfWindow) / sampleRate;
    const windowEnd = (i + halfWindow) / sampleRate;

    let count = 0;
    for (const event of sortedEvents) {
      if (event.time >= windowStart && event.time < windowEnd) {
        count++;
      }
      // Early exit if past window
      if (event.time >= windowEnd) break;
    }
    values[i] = count;
  }

  // Compute range
  let min = 0;
  let max = 0;
  if (values.length > 0) {
    min = values[0]!;
    max = values[0]!;
    for (let i = 1; i < values.length; i++) {
      const v = values[i]!;
      if (v < min) min = v;
      if (v > max) max = v;
    }
  }

  // Normalize if requested
  if (normalize && max > min) {
    const range = max - min;
    for (let i = 0; i < values.length; i++) {
      values[i] = (values[i]! - min) / range;
    }
  }

  return { values, times, rawRange: { min, max } };
}

/**
 * Event density: events per second in each window.
 */
export function eventDensity(
  events: DiscreteEvent[],
  windowSpec: EventWindowSpec,
  options: EventToSignalOptions
): EventSignalResult {
  const result = eventCount(events, windowSpec, { ...options, normalize: false });

  const windowSeconds =
    windowSpec.kind === "seconds"
      ? windowSpec.windowSize
      : windowSpec.windowSize / options.sampleRate;

  // Convert count to density
  for (let i = 0; i < result.values.length; i++) {
    result.values[i] = result.values[i]! / windowSeconds;
  }

  // Recompute range
  let min = 0;
  let max = 0;
  if (result.values.length > 0) {
    min = result.values[0]!;
    max = result.values[0]!;
    for (let i = 1; i < result.values.length; i++) {
      const v = result.values[i]!;
      if (v < min) min = v;
      if (v > max) max = v;
    }
  }

  // Normalize if requested
  if (options.normalize && max > min) {
    const range = max - min;
    for (let i = 0; i < result.values.length; i++) {
      result.values[i] = (result.values[i]! - min) / range;
    }
  }

  return { ...result, rawRange: { min, max } };
}

/**
 * Weighted sum of events per window.
 */
export function weightedSum(
  events: DiscreteEvent[],
  windowSpec: EventWindowSpec,
  options: EventToSignalOptions
): EventSignalResult {
  const { sampleRate, duration, normalize = false } = options;
  const numSamples = Math.ceil(duration * sampleRate);
  const values = new Float32Array(numSamples);
  const times = new Float32Array(numSamples);

  // Generate time array
  for (let i = 0; i < numSamples; i++) {
    times[i] = i / sampleRate;
  }

  const windowSamples =
    windowSpec.kind === "seconds"
      ? Math.ceil(windowSpec.windowSize * sampleRate)
      : windowSpec.windowSize;

  const halfWindow = Math.floor(windowSamples / 2);

  // Sort events by time
  const sortedEvents = [...events].sort((a, b) => a.time - b.time);

  // Sum weights in each window
  for (let i = 0; i < numSamples; i++) {
    const windowStart = (i - halfWindow) / sampleRate;
    const windowEnd = (i + halfWindow) / sampleRate;

    let sum = 0;
    for (const event of sortedEvents) {
      if (event.time >= windowStart && event.time < windowEnd) {
        sum += event.weight ?? 1;
      }
      if (event.time >= windowEnd) break;
    }
    values[i] = sum;
  }

  // Compute range
  let min = 0;
  let max = 0;
  if (values.length > 0) {
    min = values[0]!;
    max = values[0]!;
    for (let i = 1; i < values.length; i++) {
      const v = values[i]!;
      if (v < min) min = v;
      if (v > max) max = v;
    }
  }

  // Normalize if requested
  if (normalize && max > min) {
    const range = max - min;
    for (let i = 0; i < values.length; i++) {
      values[i] = (values[i]! - min) / range;
    }
  }

  return { values, times, rawRange: { min, max } };
}

/**
 * Weighted mean of events per window.
 */
export function weightedMean(
  events: DiscreteEvent[],
  windowSpec: EventWindowSpec,
  options: EventToSignalOptions
): EventSignalResult {
  const { sampleRate, duration, normalize = false } = options;
  const numSamples = Math.ceil(duration * sampleRate);
  const values = new Float32Array(numSamples);
  const times = new Float32Array(numSamples);

  // Generate time array
  for (let i = 0; i < numSamples; i++) {
    times[i] = i / sampleRate;
  }

  const windowSamples =
    windowSpec.kind === "seconds"
      ? Math.ceil(windowSpec.windowSize * sampleRate)
      : windowSpec.windowSize;

  const halfWindow = Math.floor(windowSamples / 2);

  // Sort events by time
  const sortedEvents = [...events].sort((a, b) => a.time - b.time);

  // Compute weighted mean in each window
  for (let i = 0; i < numSamples; i++) {
    const windowStart = (i - halfWindow) / sampleRate;
    const windowEnd = (i + halfWindow) / sampleRate;

    let sum = 0;
    let count = 0;
    for (const event of sortedEvents) {
      if (event.time >= windowStart && event.time < windowEnd) {
        sum += event.weight ?? 1;
        count++;
      }
      if (event.time >= windowEnd) break;
    }
    values[i] = count > 0 ? sum / count : 0;
  }

  // Compute range
  let min = 0;
  let max = 0;
  if (values.length > 0) {
    min = values[0]!;
    max = values[0]!;
    for (let i = 1; i < values.length; i++) {
      const v = values[i]!;
      if (v < min) min = v;
      if (v > max) max = v;
    }
  }

  // Normalize if requested
  if (normalize && max > min) {
    const range = max - min;
    for (let i = 0; i < values.length; i++) {
      values[i] = (values[i]! - min) / range;
    }
  }

  return { values, times, rawRange: { min, max } };
}

/**
 * Generate continuous envelope from events.
 * Each event contributes an envelope shape to the output.
 */
export function eventEnvelope(
  events: DiscreteEvent[],
  shape: EnvelopeShape,
  options: EventToSignalOptions
): EventSignalResult {
  const { sampleRate, duration, normalize = false } = options;
  const numSamples = Math.ceil(duration * sampleRate);
  const values = new Float32Array(numSamples);
  const times = new Float32Array(numSamples);

  // Generate time array
  for (let i = 0; i < numSamples; i++) {
    times[i] = i / sampleRate;
  }

  // Generate envelope for each event and sum
  for (const event of events) {
    const eventSample = Math.floor(event.time * sampleRate);
    const weight = event.weight ?? 1;
    let envelope: Float32Array;

    switch (shape.kind) {
      case "impulse":
        // Single sample impulse
        if (eventSample >= 0 && eventSample < numSamples) {
          values[eventSample] = values[eventSample]! + weight;
        }
        continue;

      case "gaussian":
        const widthSamples = (shape.widthMs / 1000) * sampleRate;
        envelope = generateGaussianEnvelope(eventSample, widthSamples, numSamples);
        break;

      case "attackDecay":
        const attackSamples = (shape.attackMs / 1000) * sampleRate;
        const decaySamples = (shape.decayMs / 1000) * sampleRate;
        envelope = generateAttackDecayEnvelope(eventSample, attackSamples, decaySamples, numSamples);
        break;

      case "gate":
        const durationSamples = event.duration
          ? event.duration * sampleRate
          : sampleRate * 0.1; // Default 100ms
        envelope = generateGateEnvelope(eventSample, durationSamples, numSamples);
        break;

      default:
        continue;
    }

    // Add weighted envelope to output
    for (let i = 0; i < numSamples; i++) {
      values[i] = values[i]! + envelope[i]! * weight;
    }
  }

  // Compute range
  let min = 0;
  let max = 0;
  if (values.length > 0) {
    min = values[0]!;
    max = values[0]!;
    for (let i = 1; i < values.length; i++) {
      const v = values[i]!;
      if (v < min) min = v;
      if (v > max) max = v;
    }
  }

  // Normalize if requested
  if (normalize && max > min) {
    const range = max - min;
    for (let i = 0; i < values.length; i++) {
      values[i] = (values[i]! - min) / range;
    }
  }

  return { values, times, rawRange: { min, max } };
}

// ============================================================================
// MAIN CONVERSION FUNCTION
// ============================================================================

/**
 * Convert events to signal using specified reducer.
 */
export type EventReducer = "eventCount" | "eventDensity" | "weightedSum" | "weightedMean" | "envelope";

export interface EventToSignalParams {
  /** Reducer algorithm. */
  reducer: EventReducer;
  /** Window spec for count/density/sum/mean reducers. */
  window?: EventWindowSpec;
  /** Envelope shape for envelope reducer. */
  envelopeShape?: EnvelopeShape;
}

export function eventsToSignal(
  events: DiscreteEvent[],
  params: EventToSignalParams,
  options: EventToSignalOptions
): EventSignalResult {
  const defaultWindow: EventWindowSpec = { kind: "seconds", windowSize: 0.5 };
  const defaultShape: EnvelopeShape = { kind: "attackDecay", attackMs: 5, decayMs: 100 };

  switch (params.reducer) {
    case "eventCount":
      return eventCount(events, params.window ?? defaultWindow, options);

    case "eventDensity":
      return eventDensity(events, params.window ?? defaultWindow, options);

    case "weightedSum":
      return weightedSum(events, params.window ?? defaultWindow, options);

    case "weightedMean":
      return weightedMean(events, params.window ?? defaultWindow, options);

    case "envelope":
      return eventEnvelope(events, params.envelopeShape ?? defaultShape, options);

    default:
      throw new Error(`Unknown event reducer: ${params.reducer}`);
  }
}
