/**
 * Signal data types for the SignalViewer plugin
 */

/** 1D continuous signal (time-aligned values) */
export interface ContinuousSignal {
  kind: "continuous";
  /** Time in seconds for each sample (must be monotonically increasing) */
  times: Float32Array;
  /** Value at each time */
  values: Float32Array;
  /** Optional metadata about the signal domain */
  meta?: SignalMeta;
}

/** Sparse events (discrete timestamps with optional strength) */
export interface SparseSignal {
  kind: "sparse";
  /** Event times in seconds */
  times: Float32Array;
  /** Optional strength/weight for each event (typically 0-1) */
  strengths?: Float32Array;
  /** Optional metadata */
  meta?: SignalMeta;
}

/** Signal metadata */
export interface SignalMeta {
  /** Expected value range (for fixed normalization) */
  domain?: { min: number; max: number };
  /** Human-readable unit (e.g., "Hz", "dB") */
  unit?: string;
  /** Signal name/label */
  label?: string;
}

/** Union of all signal data types */
export type SignalData = ContinuousSignal | SparseSignal;

/**
 * Rendering configuration types
 */

/** How to render the signal */
export type RenderMode =
  | "line" // Simple polyline
  | "filled" // Filled area from baseline
  | "stepped" // Step function (zero-order hold)
  | "impulses" // Vertical lines at each sample
  | "markers" // Dots/markers at each sample (good for sparse)
  | "heat-strip"; // Color-coded horizontal strip (1D heatmap)

/** Where the baseline sits */
export type BaselineMode =
  | "bottom" // Baseline at bottom (positive-only signals)
  | "center" // Baseline at center (symmetric signals)
  | { y: number }; // Custom baseline in normalized [0,1] space

/** How to normalize values for display */
export type NormalizationMode =
  | "none" // Raw values (clip to canvas)
  | "global" // Min-max over entire signal
  | "robust" // 5th-95th percentile
  | "fixed" // Use meta.domain
  | { percentile: [number, number] }; // Custom percentile range

/** Color configuration */
export interface ColorConfig {
  /** Primary signal color */
  stroke?: string;
  /** Fill color (for filled mode) */
  fill?: string;
  /** Stroke width in pixels */
  strokeWidth?: number;
  /** Opacity (0-1) */
  opacity?: number;
  /** Color map name for heat-strip mode */
  colorMap?: "viridis" | "plasma" | "magma" | "inferno" | "grayscale";
}

/**
 * Layer configuration
 */
export interface LayerConfig {
  /** Unique layer identifier */
  id: string;
  /** Signal data */
  signal: SignalData;
  /** Rendering mode */
  mode: RenderMode;
  /** Baseline position (default: "bottom") */
  baseline?: BaselineMode;
  /** Normalization strategy (default: "global") */
  normalization?: NormalizationMode;
  /** Color/style configuration */
  color?: ColorConfig;
  /** Height in pixels (for stacked layout, default: auto) */
  height?: number;
  /** Vertical offset from top (for manual positioning) */
  offsetY?: number;
  /** Whether to show hover tooltip (default: true) */
  tooltip?: boolean;
  /** Whether layer is visible (default: true) */
  visible?: boolean;
}

/**
 * Plugin options
 */
export interface SignalViewerPluginOptions {
  /** Height of the plugin container in pixels (default: 100) */
  height?: number;
  /** Background color (default: transparent) */
  backgroundColor?: string;
  /** Whether to show gridlines (default: false) */
  showGrid?: boolean;
  /** Initial layers to add */
  layers?: LayerConfig[];
  /** Layout mode: "stacked" = each layer in separate track; "overlay" = all layers share same space */
  layout?: "stacked" | "overlay";
  /** Hover callback with time and values for all layers */
  onHover?: (time: number, values: Record<string, number | null>) => void;
  /** Click callback with time */
  onClick?: (time: number) => void;
}

/**
 * Internal view state (derived from Wavesurfer store)
 */
export interface ViewState {
  /** Pixels per second (zoom level) */
  minPxPerSec: number;
  /** Scroll position in pixels */
  scrollLeft: number;
  /** Container width in pixels */
  containerWidth: number;
  /** Audio duration in seconds */
  duration: number;
}

/**
 * Plugin instance actions
 */
export interface SignalViewerActions {
  /** Add a new layer */
  addLayer: (config: LayerConfig) => void;
  /** Remove a layer by id */
  removeLayer: (id: string) => void;
  /** Update layer configuration */
  updateLayer: (id: string, updates: Partial<LayerConfig>) => void;
  /** Replace signal data for a layer */
  setSignal: (id: string, signal: SignalData) => void;
  /** Get interpolated value at a specific time for a layer */
  getValueAt: (id: string, time: number) => number | null;
  /** Clear all layers */
  clearLayers: () => void;
  /** Set plugin height */
  setHeight: (height: number) => void;
  /** Force re-render */
  render: () => void;
}

/**
 * Decimation result
 */
export interface DecimatedData {
  times: Float32Array;
  values: Float32Array;
}

/**
 * Normalization bounds
 */
export interface NormalizationBounds {
  min: number;
  max: number;
}

/**
 * Point for rendering
 */
export interface RenderPoint {
  x: number;
  y: number;
  /** Original value (for tooltip) */
  value: number;
  /** Original time (for tooltip) */
  time: number;
}
