# @octoseq/wavesurfer-signalviewer

A Wavesurfer plugin for rendering arbitrary time-indexed signals with correct semantics for non-audio data.

## Features

- **Non-audio signal support**: Render positive-only signals, custom domains, and various value ranges without assumptions about audio amplitude ranges
- **Multiple render modes**: Line, filled area, stepped, impulses, markers, and heat strip
- **Flexible normalization**: Global, robust (percentile-based), fixed domain, or custom percentile ranges
- **Configurable baselines**: Bottom (for positive-only), center (for symmetric), or custom positions
- **Layout modes**: Overlay multiple signals or stack them vertically
- **Hover inspection**: Get actual numeric values at any time position
- **Decimation**: Efficient rendering of large signals using LTTB and min-max algorithms
- **Grid overlay**: Optional time-aligned grid lines

## Installation

```bash
npm install @octoseq/wavesurfer-signalviewer wavesurfer.js
# or
pnpm add @octoseq/wavesurfer-signalviewer wavesurfer.js
```

## Usage

```typescript
import WaveSurfer from "wavesurfer.js";
import { SignalViewerPlugin } from "@octoseq/wavesurfer-signalviewer";

// Create WaveSurfer instance
const wavesurfer = WaveSurfer.create({
  container: "#waveform",
  url: "audio.mp3",
});

// Register the SignalViewer plugin
const signalViewer = await wavesurfer.registerPluginV8(
  SignalViewerPlugin({
    height: 100,
    layout: "overlay", // or "stacked"
    showGrid: true,
    onHover: (time, values) => {
      console.log(`Time: ${time}s, Values:`, values);
    },
    layers: [
      {
        id: "envelope",
        signal: {
          kind: "continuous",
          times: new Float32Array([0, 1, 2, 3, 4]),
          values: new Float32Array([0, 0.5, 1, 0.7, 0.2]),
          meta: {
            domain: { min: 0, max: 1 },
            label: "Amplitude Envelope",
          },
        },
        mode: "filled",
        baseline: "bottom",
        normalization: "fixed",
        color: {
          stroke: "#f59e0b",
          fill: "rgba(245, 158, 11, 0.3)",
        },
      },
    ],
  })
);

// Add layers dynamically
signalViewer.instance.actions.addLayer({
  id: "onsets",
  signal: {
    kind: "sparse",
    times: new Float32Array([0.5, 1.2, 2.1, 3.0]),
    strengths: new Float32Array([0.8, 1.0, 0.6, 0.9]),
  },
  mode: "impulses",
  color: { stroke: "#ef4444" },
});

// Update signal data
signalViewer.instance.actions.setSignal("envelope", newSignalData);

// Get value at a specific time
const value = signalViewer.instance.actions.getValueAt("envelope", 1.5);
```

## Signal Types

### Continuous Signal

Time-aligned numeric values for line plots:

```typescript
interface ContinuousSignal {
  kind: "continuous";
  times: Float32Array; // Monotonically increasing timestamps
  values: Float32Array; // Value at each timestamp
  meta?: {
    domain?: { min: number; max: number };
    unit?: string;
    label?: string;
  };
}
```

### Sparse Signal

Discrete events with optional strength values:

```typescript
interface SparseSignal {
  kind: "sparse";
  times: Float32Array; // Event timestamps
  strengths?: Float32Array; // Optional strength (0-1)
  meta?: { label?: string };
}
```

## Render Modes

| Mode | Description | Best for |
|------|-------------|----------|
| `line` | Simple polyline | Continuous signals |
| `filled` | Filled area from baseline | Envelopes, energy |
| `stepped` | Step function (zero-order hold) | Quantized/discrete values |
| `impulses` | Vertical lines | Sparse events |
| `markers` | Dots/circles | Sparse events with precise timing |
| `heat-strip` | Color-coded horizontal strip | Dense amplitude data |

## Baseline Modes

| Mode | Description |
|------|-------------|
| `"bottom"` | Baseline at bottom (for positive-only signals) |
| `"center"` | Baseline at center (for symmetric signals like waveforms) |
| `{ y: 0.3 }` | Custom baseline at 30% from bottom |

## Normalization Modes

| Mode | Description |
|------|-------------|
| `"none"` | No normalization (values clipped to canvas) |
| `"global"` | Min-max over entire signal |
| `"robust"` | 5th-95th percentile (ignores outliers) |
| `"fixed"` | Use `meta.domain` from signal |
| `{ percentile: [10, 90] }` | Custom percentile range |

## Plugin Options

```typescript
interface SignalViewerPluginOptions {
  height?: number; // Container height in pixels (default: 100)
  backgroundColor?: string; // Background color (default: transparent)
  showGrid?: boolean; // Show grid lines (default: false)
  layout?: "stacked" | "overlay"; // Layout mode (default: overlay)
  layers?: LayerConfig[]; // Initial layers
  onHover?: (time: number, values: Record<string, number | null>) => void;
  onClick?: (time: number) => void;
}
```

## Layer Configuration

```typescript
interface LayerConfig {
  id: string; // Unique identifier
  signal: SignalData; // Signal data
  mode: RenderMode; // How to render
  baseline?: BaselineMode; // Where baseline sits (default: bottom)
  normalization?: NormalizationMode; // How to normalize (default: global)
  color?: ColorConfig; // Styling
  height?: number; // Layer height (for stacked layout)
  offsetY?: number; // Vertical offset
  tooltip?: boolean; // Show in hover values (default: true)
  visible?: boolean; // Is visible (default: true)
}
```

## Actions API

```typescript
interface SignalViewerActions {
  addLayer(config: LayerConfig): void;
  removeLayer(id: string): void;
  updateLayer(id: string, updates: Partial<LayerConfig>): void;
  setSignal(id: string, signal: SignalData): void;
  getValueAt(id: string, time: number): number | null;
  clearLayers(): void;
  setHeight(height: number): void;
  render(): void; // Force re-render
}
```

## Running the Demo

```bash
cd packages/wavesurfer-signalviewer
pnpm install
pnpm demo
```

## License

MIT
