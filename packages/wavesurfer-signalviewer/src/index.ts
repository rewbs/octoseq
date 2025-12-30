/**
 * @octoseq/wavesurfer-signalviewer
 *
 * A Wavesurfer plugin for rendering arbitrary time-indexed signals
 * with correct semantics for non-audio data.
 *
 * @example
 * ```typescript
 * import WaveSurfer from "wavesurfer.js";
 * import { SignalViewerPlugin } from "@octoseq/wavesurfer-signalviewer";
 *
 * const wavesurfer = WaveSurfer.create({ container: "#waveform" });
 *
 * const signalViewer = await wavesurfer.registerPluginV8(
 *   SignalViewerPlugin({
 *     height: 100,
 *     layout: "stacked",
 *     layers: [
 *       {
 *         id: "envelope",
 *         signal: {
 *           kind: "continuous",
 *           times: new Float32Array([0, 1, 2, 3]),
 *           values: new Float32Array([0, 0.5, 1, 0.2]),
 *         },
 *         mode: "filled",
 *         baseline: "bottom",
 *         normalization: "global",
 *         color: { stroke: "#f59e0b", fill: "rgba(245, 158, 11, 0.3)" },
 *       },
 *     ],
 *   })
 * );
 *
 * // Add more layers dynamically
 * signalViewer.instance.actions.addLayer({ ... });
 *
 * // Update signal data
 * signalViewer.instance.actions.setSignal("envelope", newSignalData);
 * ```
 */

// Plugin
export { SignalViewerPlugin } from "./plugin.js";
export type { SignalViewerPluginInstance } from "./plugin.js";

// Types
export type {
  // Signal data
  ContinuousSignal,
  SparseSignal,
  SignalData,
  SignalMeta,
  // Configuration
  RenderMode,
  BaselineMode,
  NormalizationMode,
  ColorConfig,
  LayerConfig,
  SignalViewerPluginOptions,
  // Internal types (useful for advanced usage)
  ViewState,
  SignalViewerActions,
  RenderPoint,
  NormalizationBounds,
  DecimatedData,
} from "./types.js";

// Utilities (useful for custom renderers)
export {
  clamp,
  lerp,
  remap,
  binarySearchFloor,
  binarySearchCeil,
  findTimeRange,
  interpolateValue,
  percentile,
  parseColor,
  interpolateColor,
  colorMapValue,
  COLOR_MAPS,
} from "./utils.js";

// Data processing (useful for custom implementations)
export { Decimator, decimator } from "./decimator.js";
export { Normalizer, normalizer } from "./normalizer.js";

// Renderers (useful for extending)
export {
  renderLine,
  getBaselineY,
  renderStepped,
  renderImpulses,
  renderMarkers,
  renderSparseEvents,
  renderHeatStrip,
  renderContinuousHeatStrip,
} from "./renderers/index.js";
export type {
  LineRenderOptions,
  SteppedRenderOptions,
  ImpulseRenderOptions,
  MarkerRenderOptions,
  HeatStripRenderOptions,
} from "./renderers/index.js";

// Layer (useful for extending)
export { SignalLayer } from "./layer.js";
