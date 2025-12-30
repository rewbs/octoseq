/**
 * Signal decimation algorithms for efficient rendering
 *
 * Uses LTTB (Largest Triangle Three Buckets) for moderate compression
 * and min-max for high compression ratios.
 */

import type { DecimatedData } from "./types.js";
import { findTimeRange } from "./utils.js";

/**
 * Decimator class for reducing signal point count while preserving visual fidelity
 */
export class Decimator {
  /**
   * Decimate a signal to a target number of points
   *
   * @param times - Time values (must be monotonically increasing)
   * @param values - Signal values
   * @param startTime - Start of visible window
   * @param endTime - End of visible window
   * @param targetPoints - Target number of output points
   * @returns Decimated time and value arrays
   */
  decimate(
    times: Float32Array,
    values: Float32Array,
    startTime: number,
    endTime: number,
    targetPoints: number
  ): DecimatedData {
    // Find the window indices
    const [rawStart, rawEnd] = findTimeRange(times, startTime, endTime);

    // Add padding for interpolation at edges
    const startIdx = Math.max(0, rawStart - 1);
    const endIdx = Math.min(times.length, rawEnd + 1);
    const sourceCount = endIdx - startIdx;

    // If few enough points, return as-is
    if (sourceCount <= targetPoints || targetPoints < 2) {
      return {
        times: times.slice(startIdx, endIdx),
        values: values.slice(startIdx, endIdx),
      };
    }

    // Use min-max if compression ratio > 10:1 (faster, preserves extrema)
    if (sourceCount / targetPoints > 10) {
      return this.minMaxDecimate(times, values, startIdx, endIdx, targetPoints);
    }

    // Use LTTB for moderate decimation (better visual fidelity)
    return this.lttbDecimate(times, values, startIdx, endIdx, targetPoints);
  }

  /**
   * LTTB (Largest Triangle Three Buckets) decimation
   *
   * Best for line plots - preserves overall visual shape.
   * Based on: https://skemman.is/bitstream/1946/15343/3/SS_MSthesis.pdf
   */
  private lttbDecimate(
    times: Float32Array,
    values: Float32Array,
    startIdx: number,
    endIdx: number,
    targetPoints: number
  ): DecimatedData {
    const sourceCount = endIdx - startIdx;
    const outTimes = new Float32Array(targetPoints);
    const outValues = new Float32Array(targetPoints);

    // Always include first point
    outTimes[0] = times[startIdx] ?? 0;
    outValues[0] = values[startIdx] ?? 0;

    // Calculate bucket size
    const bucketSize = (sourceCount - 2) / (targetPoints - 2);

    let a = 0; // Index of previous selected point (relative to output)
    let nextA = 0; // Index of next point to select

    for (let i = 0; i < targetPoints - 2; i++) {
      // Calculate bucket boundaries
      const bucketStart = Math.floor((i + 0) * bucketSize) + 1 + startIdx;
      const bucketEnd = Math.floor((i + 1) * bucketSize) + 1 + startIdx;

      // Calculate average point of next bucket (for triangle calculation)
      const nextBucketStart = Math.floor((i + 1) * bucketSize) + 1 + startIdx;
      const nextBucketEnd = Math.min(
        Math.floor((i + 2) * bucketSize) + 1 + startIdx,
        endIdx
      );

      let avgX = 0;
      let avgY = 0;
      let avgCount = 0;

      for (let j = nextBucketStart; j < nextBucketEnd; j++) {
        avgX += times[j] ?? 0;
        avgY += values[j] ?? 0;
        avgCount++;
      }

      if (avgCount > 0) {
        avgX /= avgCount;
        avgY /= avgCount;
      }

      // Get point A (previously selected)
      const aX = outTimes[a] ?? 0;
      const aY = outValues[a] ?? 0;

      // Find point in current bucket that forms largest triangle with A and avg
      let maxArea = -1;
      let maxIdx = bucketStart;

      for (let j = bucketStart; j < bucketEnd && j < endIdx; j++) {
        const x = times[j] ?? 0;
        const y = values[j] ?? 0;

        // Calculate triangle area (using cross product / 2)
        const area = Math.abs((aX - avgX) * (y - aY) - (aX - x) * (avgY - aY));

        if (area > maxArea) {
          maxArea = area;
          maxIdx = j;
        }
      }

      // Select point with largest triangle
      nextA = i + 1;
      outTimes[nextA] = times[maxIdx] ?? 0;
      outValues[nextA] = values[maxIdx] ?? 0;
      a = nextA;
    }

    // Always include last point
    outTimes[targetPoints - 1] = times[endIdx - 1] ?? 0;
    outValues[targetPoints - 1] = values[endIdx - 1] ?? 0;

    return { times: outTimes, values: outValues };
  }

  /**
   * Min-Max decimation
   *
   * Best for high compression ratios - preserves peaks and valleys.
   * Each bucket outputs two points: the min and max value in that bucket.
   */
  private minMaxDecimate(
    times: Float32Array,
    values: Float32Array,
    startIdx: number,
    endIdx: number,
    targetPoints: number
  ): DecimatedData {
    const sourceCount = endIdx - startIdx;

    // Each bucket produces 2 points (min and max), so use half the target
    const numBuckets = Math.floor(targetPoints / 2);
    const bucketSize = sourceCount / numBuckets;

    // Allocate for 2 points per bucket
    const outTimes = new Float32Array(numBuckets * 2);
    const outValues = new Float32Array(numBuckets * 2);

    let outIdx = 0;

    for (let i = 0; i < numBuckets; i++) {
      const bucketStart = Math.floor(i * bucketSize) + startIdx;
      const bucketEnd = Math.min(
        Math.floor((i + 1) * bucketSize) + startIdx,
        endIdx
      );

      if (bucketStart >= bucketEnd) continue;

      let minVal = Infinity;
      let maxVal = -Infinity;
      let minIdx = bucketStart;
      let maxIdx = bucketStart;

      for (let j = bucketStart; j < bucketEnd; j++) {
        const v = values[j] ?? 0;
        if (v < minVal) {
          minVal = v;
          minIdx = j;
        }
        if (v > maxVal) {
          maxVal = v;
          maxIdx = j;
        }
      }

      // Output in time order
      if (minIdx <= maxIdx) {
        outTimes[outIdx] = times[minIdx] ?? 0;
        outValues[outIdx] = minVal;
        outIdx++;
        outTimes[outIdx] = times[maxIdx] ?? 0;
        outValues[outIdx] = maxVal;
        outIdx++;
      } else {
        outTimes[outIdx] = times[maxIdx] ?? 0;
        outValues[outIdx] = maxVal;
        outIdx++;
        outTimes[outIdx] = times[minIdx] ?? 0;
        outValues[outIdx] = minVal;
        outIdx++;
      }
    }

    // Trim to actual output size
    return {
      times: outTimes.slice(0, outIdx),
      values: outValues.slice(0, outIdx),
    };
  }
}

/** Shared decimator instance */
export const decimator = new Decimator();
