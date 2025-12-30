/**
 * SignalLayer class
 *
 * Encapsulates a signal with its configuration, caching, and rendering logic.
 */

import type {
  LayerConfig,
  SignalData,
  ViewState,
  RenderPoint,
  NormalizationBounds,
  DecimatedData,
  BaselineMode,
  ColorConfig,
  RenderMode,
  NormalizationMode,
} from "./types.js";
import { decimator } from "./decimator.js";
import { normalizer } from "./normalizer.js";
import { interpolateValue, clamp } from "./utils.js";
import {
  renderLine,
  renderStepped,
  renderImpulses,
  renderMarkers,
  renderSparseEvents,
  renderHeatStrip,
  getBaselineY,
} from "./renderers/index.js";

/**
 * Default layer configuration values
 */
const DEFAULTS = {
  mode: "line" as RenderMode,
  baseline: "bottom" as BaselineMode,
  normalization: "global" as NormalizationMode,
  color: {
    stroke: "#3b82f6",
    fill: "rgba(59, 130, 246, 0.3)",
    strokeWidth: 1.5,
    opacity: 1,
  } as ColorConfig,
  visible: true,
  tooltip: true,
} as const;

/**
 * Cache for decimated data
 */
interface DecimationCache {
  data: DecimatedData;
  startTime: number;
  endTime: number;
  targetPoints: number;
}

/**
 * SignalLayer manages a single signal visualization
 */
export class SignalLayer {
  readonly id: string;

  private _signal: SignalData;
  private _mode: RenderMode;
  private _baseline: BaselineMode;
  private _normalization: NormalizationMode;
  private _color: ColorConfig;
  private _height?: number;
  private _offsetY?: number;
  private _visible: boolean;
  private _tooltip: boolean;

  private decimationCache: DecimationCache | null = null;
  private boundsCache: NormalizationBounds | null = null;

  constructor(config: LayerConfig) {
    this.id = config.id;
    this._signal = config.signal;
    this._mode = config.mode ?? DEFAULTS.mode;
    this._baseline = config.baseline ?? DEFAULTS.baseline;
    this._normalization = config.normalization ?? DEFAULTS.normalization;
    this._color = { ...DEFAULTS.color, ...config.color };
    this._height = config.height;
    this._offsetY = config.offsetY;
    this._visible = config.visible ?? DEFAULTS.visible;
    this._tooltip = config.tooltip ?? DEFAULTS.tooltip;
  }

  // Getters
  get signal(): SignalData {
    return this._signal;
  }
  get mode(): RenderMode {
    return this._mode;
  }
  get baseline(): BaselineMode {
    return this._baseline;
  }
  get normalization(): NormalizationMode {
    return this._normalization;
  }
  get color(): ColorConfig {
    return this._color;
  }
  get height(): number | undefined {
    return this._height;
  }
  get offsetY(): number | undefined {
    return this._offsetY;
  }
  get visible(): boolean {
    return this._visible;
  }
  get tooltip(): boolean {
    return this._tooltip;
  }

  /**
   * Update layer configuration
   */
  update(updates: Partial<LayerConfig>): void {
    if (updates.signal !== undefined) {
      this._signal = updates.signal;
      this.invalidateCache();
    }
    if (updates.mode !== undefined) {
      this._mode = updates.mode;
    }
    if (updates.baseline !== undefined) {
      this._baseline = updates.baseline;
    }
    if (updates.normalization !== undefined) {
      this._normalization = updates.normalization;
      this.boundsCache = null;
    }
    if (updates.color !== undefined) {
      this._color = { ...this._color, ...updates.color };
    }
    if (updates.height !== undefined) {
      this._height = updates.height;
    }
    if (updates.offsetY !== undefined) {
      this._offsetY = updates.offsetY;
    }
    if (updates.visible !== undefined) {
      this._visible = updates.visible;
    }
    if (updates.tooltip !== undefined) {
      this._tooltip = updates.tooltip;
    }
  }

  /**
   * Set signal data
   */
  setSignal(signal: SignalData): void {
    this._signal = signal;
    this.invalidateCache();
  }

  /**
   * Invalidate all caches
   */
  invalidateCache(): void {
    this.decimationCache = null;
    this.boundsCache = null;
  }

  /**
   * Get normalization bounds
   */
  getBounds(): NormalizationBounds {
    if (!this.boundsCache) {
      this.boundsCache = normalizer.computeBounds(this._signal, this._normalization);
    }
    return this.boundsCache;
  }

  /**
   * Get interpolated value at a specific time
   */
  getValueAt(time: number): number | null {
    if (this._signal.kind === "sparse") {
      // For sparse signals, return strength at nearest event
      const times = this._signal.times;
      const strengths = this._signal.strengths;

      // Find closest event within a small tolerance
      const tolerance = 0.05; // 50ms
      for (let i = 0; i < times.length; i++) {
        const t = times[i];
        if (t !== undefined && Math.abs(t - time) < tolerance) {
          return strengths?.[i] ?? 1;
        }
      }
      return null;
    }

    // For continuous signals, interpolate
    return interpolateValue(this._signal.times, this._signal.values, time);
  }

  /**
   * Get decimated data for current view
   */
  private getDecimatedData(
    startTime: number,
    endTime: number,
    targetPoints: number
  ): DecimatedData {
    // Check cache
    if (
      this.decimationCache &&
      this.decimationCache.startTime === startTime &&
      this.decimationCache.endTime === endTime &&
      this.decimationCache.targetPoints === targetPoints
    ) {
      return this.decimationCache.data;
    }

    // For sparse signals, no decimation
    if (this._signal.kind === "sparse") {
      return {
        times: this._signal.times,
        values: this._signal.strengths ?? new Float32Array(this._signal.times.length).fill(1),
      };
    }

    // Decimate continuous signal
    const data = decimator.decimate(
      this._signal.times,
      this._signal.values,
      startTime,
      endTime,
      targetPoints
    );

    // Cache result
    this.decimationCache = { data, startTime, endTime, targetPoints };

    return data;
  }

  /**
   * Render the layer to a canvas context
   */
  render(
    ctx: CanvasRenderingContext2D,
    view: ViewState,
    layerHeight: number,
    layerOffsetY: number
  ): void {
    if (!this._visible) return;

    const { minPxPerSec, scrollLeft, containerWidth, duration } = view;

    // Calculate visible time range
    const startTime = scrollLeft / minPxPerSec;
    const endTime = Math.min((scrollLeft + containerWidth) / minPxPerSec, duration);

    if (startTime >= endTime) return;

    // Calculate target points (2 points per pixel for smooth lines)
    const targetPoints = Math.min(containerWidth * 2, 4000);

    // Get decimated data
    const { times, values } = this.getDecimatedData(startTime, endTime, targetPoints);

    if (times.length === 0) return;

    // Get normalization bounds
    const bounds = this.getBounds();

    // Time to X conversion
    const timeToX = (time: number): number => {
      return (time * minPxPerSec) - scrollLeft;
    };

    // Render based on mode
    if (this._signal.kind === "sparse") {
      this.renderSparse(ctx, times, values, timeToX, layerHeight, layerOffsetY);
    } else {
      this.renderContinuous(ctx, times, values, bounds, timeToX, layerHeight, layerOffsetY);
    }
  }

  /**
   * Render sparse signal (events)
   */
  private renderSparse(
    ctx: CanvasRenderingContext2D,
    times: Float32Array,
    strengths: Float32Array,
    timeToX: (time: number) => number,
    layerHeight: number,
    layerOffsetY: number
  ): void {
    ctx.save();
    ctx.translate(0, layerOffsetY);

    if (this._mode === "markers") {
      // Convert to render points
      const points: RenderPoint[] = [];
      for (let i = 0; i < times.length; i++) {
        const time = times[i];
        const strength = strengths[i] ?? 1;
        if (time !== undefined) {
          const x = timeToX(time);
          // Y position based on strength
          const y = layerHeight * (1 - strength);
          points.push({ x, y, value: strength, time });
        }
      }
      renderMarkers(ctx, points, {
        color: this._color,
        canvasHeight: layerHeight,
      });
    } else {
      // Default: impulses/vertical lines
      renderSparseEvents(ctx, times, strengths, timeToX, {
        color: this._color,
        canvasHeight: layerHeight,
      });
    }

    ctx.restore();
  }

  /**
   * Render continuous signal
   */
  private renderContinuous(
    ctx: CanvasRenderingContext2D,
    times: Float32Array,
    values: Float32Array,
    bounds: NormalizationBounds,
    timeToX: (time: number) => number,
    layerHeight: number,
    layerOffsetY: number
  ): void {
    ctx.save();
    ctx.translate(0, layerOffsetY);

    // Convert to render points
    const points: RenderPoint[] = [];
    const baselineY = getBaselineY(this._baseline, layerHeight);

    for (let i = 0; i < times.length; i++) {
      const time = times[i];
      const value = values[i];

      if (time === undefined || value === undefined) continue;

      const x = timeToX(time);
      const normalized = normalizer.normalize(value, bounds);

      // Y position depends on baseline mode
      let y: number;
      if (this._baseline === "bottom") {
        // Bottom baseline: 0 = bottom, 1 = top
        y = layerHeight * (1 - clamp(normalized, 0, 1));
      } else if (this._baseline === "center") {
        // Center baseline: 0 = center, ±0.5 extends up/down
        const centered = clamp(normalized, 0, 1) - 0.5;
        y = layerHeight * (0.5 - centered);
      } else {
        // Custom baseline
        const customY = typeof this._baseline === "object" ? this._baseline.y : 0;
        const scaledValue = clamp(normalized, 0, 1);
        y = layerHeight * (1 - customY) - scaledValue * layerHeight * (1 - customY);
      }

      points.push({ x, y, value, time });
    }

    // Render based on mode
    switch (this._mode) {
      case "line":
        renderLine(ctx, points, {
          color: this._color,
          baseline: this._baseline,
          mode: "line",
          canvasHeight: layerHeight,
        });
        break;

      case "filled":
        renderLine(ctx, points, {
          color: this._color,
          baseline: this._baseline,
          mode: "filled",
          canvasHeight: layerHeight,
        });
        break;

      case "stepped":
        renderStepped(ctx, points, {
          color: this._color,
          baseline: this._baseline,
          filled: false,
          canvasHeight: layerHeight,
        });
        break;

      case "impulses":
        renderImpulses(ctx, points, {
          color: this._color,
          baseline: this._baseline,
          canvasHeight: layerHeight,
        });
        break;

      case "markers":
        renderMarkers(ctx, points, {
          color: this._color,
          canvasHeight: layerHeight,
        });
        break;

      case "heat-strip":
        renderHeatStrip(
          ctx,
          points.map((p) => ({
            x: p.x,
            normalized: normalizer.normalize(p.value, bounds),
          })),
          {
            color: this._color,
            canvasHeight: layerHeight,
          }
        );
        break;
    }

    ctx.restore();
  }
}
