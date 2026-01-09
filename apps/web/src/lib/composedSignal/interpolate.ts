/**
 * Interpolation utilities for Composed Signals.
 *
 * These functions handle:
 * - Sampling keyframe curves at arbitrary beat positions
 * - Applying easing functions between nodes
 * - Generating curve points for rendering
 * - Snapping to beat grid
 */

import type {
  ComposedSignalNode,
  InterpolationType,
} from "@/lib/stores/types/composedSignal";
import type { SubBeatDivision } from "@/lib/stores/beatGridStore";

/**
 * Apply an easing function to a normalized t value [0, 1].
 */
export function applyEasing(t: number, interp: InterpolationType): number {
  // Clamp t to [0, 1]
  const clampedT = Math.max(0, Math.min(1, t));

  switch (interp) {
    case "linear":
      return clampedT;

    case "hold":
      // Step function - always use previous value until we reach the next node
      return 0;

    case "ease_in":
      // Quadratic ease in: t^2
      return clampedT * clampedT;

    case "ease_out":
      // Quadratic ease out: t(2-t)
      return clampedT * (2 - clampedT);

    case "ease_in_out":
      // Quadratic ease in/out
      return clampedT < 0.5
        ? 2 * clampedT * clampedT
        : -1 + (4 - 2 * clampedT) * clampedT;

    case "exponential_in":
      // Exponential ease in
      return clampedT === 0 ? 0 : Math.pow(2, 10 * (clampedT - 1));

    case "exponential_out":
      // Exponential ease out
      return clampedT === 1 ? 1 : 1 - Math.pow(2, -10 * clampedT);

    default:
      return clampedT;
  }
}

/**
 * Sample a composed signal at a specific beat position.
 * Returns the interpolated value between surrounding nodes.
 *
 * @param nodes - Array of keyframe nodes (will be sorted internally)
 * @param timeBeats - The beat position to sample at
 * @param valueMin - Minimum output value (default 0)
 * @param valueMax - Maximum output value (default 1)
 * @returns Interpolated value at the given beat position
 */
export function sampleComposedSignal(
  nodes: ComposedSignalNode[],
  timeBeats: number,
  valueMin: number = 0,
  valueMax: number = 1
): number {
  if (nodes.length === 0) {
    return valueMin;
  }

  // Sort nodes by time (should already be sorted, but ensure consistency)
  const sorted = [...nodes].sort((a, b) => a.time_beats - b.time_beats);

  // Before first node - return first node's value
  if (timeBeats <= sorted[0]!.time_beats) {
    return sorted[0]!.value * (valueMax - valueMin) + valueMin;
  }

  // After last node - return last node's value
  const lastNode = sorted[sorted.length - 1]!;
  if (timeBeats >= lastNode.time_beats) {
    return lastNode.value * (valueMax - valueMin) + valueMin;
  }

  // Find surrounding nodes
  let prevNode = sorted[0]!;
  let nextNode = sorted[1]!;

  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i]!.time_beats > timeBeats) {
      prevNode = sorted[i - 1]!;
      nextNode = sorted[i]!;
      break;
    }
  }

  // Calculate normalized position between nodes [0, 1]
  const duration = nextNode.time_beats - prevNode.time_beats;
  const t = duration > 0 ? (timeBeats - prevNode.time_beats) / duration : 0;

  // Apply easing function
  const easedT = applyEasing(t, prevNode.interp_to_next);

  // Interpolate between values
  const rawValue = prevNode.value + (nextNode.value - prevNode.value) * easedT;

  // Scale to output range
  return rawValue * (valueMax - valueMin) + valueMin;
}

/**
 * Point on an interpolation curve (for rendering).
 */
export interface CurvePoint {
  beat: number;
  value: number;
}

/**
 * Generate points for drawing the interpolation curve between two nodes.
 * Used for canvas/PixiJS rendering.
 *
 * @param startNode - Starting keyframe
 * @param endNode - Ending keyframe
 * @param resolution - Number of segments (default 20)
 * @returns Array of points along the curve
 */
export function generateCurvePoints(
  startNode: ComposedSignalNode,
  endNode: ComposedSignalNode,
  resolution: number = 20
): CurvePoint[] {
  const points: CurvePoint[] = [];

  for (let i = 0; i <= resolution; i++) {
    const t = i / resolution;
    const beat =
      startNode.time_beats + t * (endNode.time_beats - startNode.time_beats);
    const easedT = applyEasing(t, startNode.interp_to_next);
    const value = startNode.value + (endNode.value - startNode.value) * easedT;
    points.push({ beat, value });
  }

  return points;
}

/**
 * Generate all curve points for a signal (for rendering the full envelope).
 *
 * @param nodes - Array of keyframe nodes
 * @param resolution - Points per segment
 * @returns Array of curve points for the entire signal
 */
export function generateFullCurve(
  nodes: ComposedSignalNode[],
  resolution: number = 20
): CurvePoint[] {
  if (nodes.length === 0) return [];
  if (nodes.length === 1) {
    return [{ beat: nodes[0]!.time_beats, value: nodes[0]!.value }];
  }

  const sorted = [...nodes].sort((a, b) => a.time_beats - b.time_beats);
  const allPoints: CurvePoint[] = [];

  for (let i = 0; i < sorted.length - 1; i++) {
    const segmentPoints = generateCurvePoints(
      sorted[i]!,
      sorted[i + 1]!,
      resolution
    );
    // Avoid duplicate points at segment boundaries
    if (i > 0 && segmentPoints.length > 0) {
      segmentPoints.shift();
    }
    allPoints.push(...segmentPoints);
  }

  return allPoints;
}

/**
 * Snap a beat position to the nearest grid line.
 *
 * @param beatPosition - Current beat position
 * @param subdivision - Beat subdivision (1 = whole beats, 2 = half beats, etc.)
 * @param enabled - Whether snapping is enabled
 * @returns Snapped beat position
 */
export function snapToGrid(
  beatPosition: number,
  subdivision: SubBeatDivision,
  enabled: boolean
): number {
  if (!enabled || subdivision === 1) {
    return beatPosition;
  }

  const gridSize = 1 / subdivision;
  return Math.round(beatPosition / gridSize) * gridSize;
}

/**
 * Find the nearest grid position to a beat position.
 * Returns the grid position and distance.
 */
export function findNearestGridPosition(
  beatPosition: number,
  subdivision: SubBeatDivision
): { position: number; distance: number } {
  const gridSize = 1 / subdivision;
  const snapped = Math.round(beatPosition / gridSize) * gridSize;
  return {
    position: snapped,
    distance: Math.abs(beatPosition - snapped),
  };
}

/**
 * Pre-sample a composed signal to a Float32Array.
 * Used for exporting to the visualiser.
 *
 * @param nodes - Keyframe nodes
 * @param sampleRate - Samples per second
 * @param durationSeconds - Total duration in seconds
 * @param bpm - Beats per minute (for time conversion)
 * @param valueMin - Minimum output value
 * @param valueMax - Maximum output value
 * @returns Float32Array of sampled values
 */
export function sampleToArray(
  nodes: ComposedSignalNode[],
  sampleRate: number,
  durationSeconds: number,
  bpm: number,
  valueMin: number = 0,
  valueMax: number = 1
): Float32Array {
  const numSamples = Math.ceil(durationSeconds * sampleRate);
  const samples = new Float32Array(numSamples);

  for (let i = 0; i < numSamples; i++) {
    const timeSeconds = i / sampleRate;
    const timeBeats = (timeSeconds * bpm) / 60;
    samples[i] = sampleComposedSignal(nodes, timeBeats, valueMin, valueMax);
  }

  return samples;
}

/**
 * Convert a beat position to seconds.
 */
export function beatsToSeconds(beats: number, bpm: number): number {
  return (beats * 60) / bpm;
}

/**
 * Convert seconds to beat position.
 */
export function secondsToBeats(seconds: number, bpm: number): number {
  return (seconds * bpm) / 60;
}
