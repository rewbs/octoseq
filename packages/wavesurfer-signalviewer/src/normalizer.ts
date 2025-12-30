/**
 * Signal normalization strategies
 *
 * Converts signal values to a 0-1 range for rendering based on
 * different domain calculation methods.
 */

import type {
  NormalizationMode,
  NormalizationBounds,
  SignalData,
} from "./types.js";
import { percentile } from "./utils.js";

/**
 * Normalizer class for computing and applying signal normalization
 */
export class Normalizer {
  /** Cached bounds per signal+mode combination */
  private boundsCache = new WeakMap<Float32Array, Map<string, NormalizationBounds>>();

  /**
   * Compute normalization bounds for a signal
   */
  computeBounds(signal: SignalData, mode: NormalizationMode): NormalizationBounds {
    const values = signal.kind === "continuous" ? signal.values : signal.strengths;

    // Check cache
    if (values) {
      const modeKey = this.getModeKey(mode);
      const cached = this.boundsCache.get(values)?.get(modeKey);
      if (cached) return cached;
    }

    const bounds = this.calculateBounds(signal, mode);

    // Cache result
    if (values) {
      const modeKey = this.getModeKey(mode);
      let modeMap = this.boundsCache.get(values);
      if (!modeMap) {
        modeMap = new Map();
        this.boundsCache.set(values, modeMap);
      }
      modeMap.set(modeKey, bounds);
    }

    return bounds;
  }

  /**
   * Generate a key for the normalization mode
   */
  private getModeKey(mode: NormalizationMode): string {
    if (typeof mode === "string") return mode;
    if ("percentile" in mode) return `percentile:${mode.percentile[0]}-${mode.percentile[1]}`;
    return "unknown";
  }

  /**
   * Calculate bounds based on mode
   */
  private calculateBounds(
    signal: SignalData,
    mode: NormalizationMode
  ): NormalizationBounds {
    // Handle fixed mode first - uses metadata
    if (mode === "fixed") {
      const domain = signal.meta?.domain;
      if (domain) {
        return { min: domain.min, max: domain.max };
      }
      // Fall back to global if no domain specified
      mode = "global";
    }

    // Handle "none" mode - no normalization, use identity bounds
    if (mode === "none") {
      return { min: 0, max: 1 };
    }

    // Get values array
    const values =
      signal.kind === "continuous" ? signal.values : signal.strengths;
    if (!values || values.length === 0) {
      return { min: 0, max: 1 };
    }

    // Calculate based on mode
    switch (mode) {
      case "global":
        return this.calculateGlobalBounds(values);

      case "robust":
        return this.calculatePercentileBounds(values, 5, 95);

      default:
        if (typeof mode === "object" && "percentile" in mode) {
          return this.calculatePercentileBounds(
            values,
            mode.percentile[0],
            mode.percentile[1]
          );
        }
        return this.calculateGlobalBounds(values);
    }
  }

  /**
   * Calculate global (full range) bounds
   */
  private calculateGlobalBounds(values: Float32Array): NormalizationBounds {
    let min = Infinity;
    let max = -Infinity;

    for (let i = 0; i < values.length; i++) {
      const v = values[i];
      if (v !== undefined) {
        if (v < min) min = v;
        if (v > max) max = v;
      }
    }

    if (!isFinite(min)) min = 0;
    if (!isFinite(max)) max = 1;
    if (min === max) max = min + 1;

    return { min, max };
  }

  /**
   * Calculate percentile-based bounds
   */
  private calculatePercentileBounds(
    values: Float32Array,
    lowPercentile: number,
    highPercentile: number
  ): NormalizationBounds {
    // Sort a copy of the values
    const sorted = new Float32Array(values);
    sorted.sort();

    const min = percentile(sorted, lowPercentile);
    let max = percentile(sorted, highPercentile);

    if (max === min) max = min + 1;

    return { min, max };
  }

  /**
   * Normalize a single value given bounds
   */
  normalize(value: number, bounds: NormalizationBounds): number {
    if (bounds.max === bounds.min) return 0.5;
    return (value - bounds.min) / (bounds.max - bounds.min);
  }

  /**
   * Denormalize a value back to original domain
   */
  denormalize(normalized: number, bounds: NormalizationBounds): number {
    return bounds.min + normalized * (bounds.max - bounds.min);
  }

  /**
   * Clear cached bounds (call when signal data changes)
   */
  clearCache(values?: Float32Array): void {
    if (values) {
      this.boundsCache.delete(values);
    }
  }
}

/** Shared normalizer instance */
export const normalizer = new Normalizer();
