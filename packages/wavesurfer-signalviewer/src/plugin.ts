/**
 * SignalViewer Plugin for Wavesurfer
 *
 * Renders arbitrary time-indexed signals with correct semantics
 * for non-audio data (positive-only values, custom domains, etc.)
 */

import type {
  Plugin,
  PluginManifest,
  PluginContext,
  PluginInstance,
} from "wavesurfer.js";
import type {
  SignalViewerPluginOptions,
  SignalViewerActions,
  LayerConfig,
  SignalData,
  ViewState,
} from "./types.js";
import { SignalLayer } from "./layer.js";

/**
 * Plugin manifest
 */
const MANIFEST: PluginManifest = {
  id: "signalviewer",
  version: "0.1.0",
  description: "Render arbitrary time-indexed signals with Wavesurfer",
};

/**
 * SignalViewer plugin instance type
 * Use this type when accessing the plugin after registration.
 */
export type SignalViewerPluginInstance = PluginInstance & {
  actions: SignalViewerActions;
};

/**
 * Create a SignalViewer plugin
 */
export function SignalViewerPlugin(
  options: SignalViewerPluginOptions = {}
): Plugin {
  return {
    manifest: MANIFEST,
    initialize(context: PluginContext): PluginInstance {
      const { store, resources, getWrapper, getDuration, getWidth } = context;

      // Configuration
      const height = options.height ?? 100;
      const backgroundColor = options.backgroundColor ?? "transparent";
      const layout = options.layout ?? "overlay";

      // Create container
      const container = document.createElement("div");
      container.className = "wavesurfer-signalviewer";
      container.style.cssText = `
        position: relative;
        width: 100%;
        height: ${height}px;
        overflow: hidden;
        background-color: ${backgroundColor};
      `;

      // Create canvas
      const canvas = document.createElement("canvas");
      canvas.style.cssText =
        "position: absolute; left: 0; top: 0; width: 100%; height: 100%;";
      container.appendChild(canvas);

      const maybeCtx = canvas.getContext("2d");
      if (!maybeCtx) {
        throw new Error("Failed to get 2D canvas context");
      }
      // Store in const to help TypeScript narrow the type
      const ctx: CanvasRenderingContext2D = maybeCtx;

      // Insert after the waveform wrapper
      const wrapper = getWrapper();
      wrapper.parentElement?.insertBefore(container, wrapper.nextSibling);

      // Cleanup on destroy
      resources.addCleanup(() => container.remove());

      // Layer management
      const layers = new Map<string, SignalLayer>();

      // Current view state
      let currentView: ViewState = {
        minPxPerSec: 0,
        scrollLeft: 0,
        containerWidth: 0,
        duration: 0,
      };

      // Pending render flag
      let renderPending = false;

      /**
       * Resize canvas to match container with DPI scaling
       */
      function resizeCanvas(): void {
        const dpr = window.devicePixelRatio || 1;
        const rect = container.getBoundingClientRect();
        canvas.width = rect.width * dpr;
        canvas.height = rect.height * dpr;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      }

      /**
       * Render all layers
       */
      function render(): void {
        if (renderPending) return;
        renderPending = true;

        requestAnimationFrame(() => {
          renderPending = false;
          doRender();
        });
      }

      function doRender(): void {
        const rect = container.getBoundingClientRect();
        const canvasWidth = rect.width;
        const canvasHeight = rect.height;

        if (canvasWidth === 0 || canvasHeight === 0) return;

        // Resize if needed
        const dpr = window.devicePixelRatio || 1;
        if (
          canvas.width !== canvasWidth * dpr ||
          canvas.height !== canvasHeight * dpr
        ) {
          resizeCanvas();
        }

        // Clear canvas
        ctx.clearRect(0, 0, canvasWidth, canvasHeight);

        // Draw background
        if (backgroundColor !== "transparent") {
          ctx.fillStyle = backgroundColor;
          ctx.fillRect(0, 0, canvasWidth, canvasHeight);
        }

        // Get visible layers
        const visibleLayers = Array.from(layers.values()).filter(
          (l) => l.visible
        );
        if (visibleLayers.length === 0) return;

        // Calculate layer heights and offsets
        if (layout === "stacked") {
          // Stacked: each layer gets equal height
          const layerHeight = canvasHeight / visibleLayers.length;
          visibleLayers.forEach((layer, i) => {
            const offsetY = i * layerHeight;
            const effectiveHeight = layer.height ?? layerHeight;
            layer.render(ctx, currentView, effectiveHeight, offsetY);
          });
        } else {
          // Overlay: all layers share the same space
          visibleLayers.forEach((layer) => {
            const effectiveHeight = layer.height ?? canvasHeight;
            const effectiveOffsetY = layer.offsetY ?? 0;
            layer.render(ctx, currentView, effectiveHeight, effectiveOffsetY);
          });
        }

        // Draw grid if enabled
        if (options.showGrid) {
          drawGrid(ctx, currentView, canvasWidth, canvasHeight);
        }
      }

      /**
       * Draw grid lines
       */
      function drawGrid(
        ctx: CanvasRenderingContext2D,
        view: ViewState,
        width: number,
        height: number
      ): void {
        const { minPxPerSec, scrollLeft, duration } = view;
        if (minPxPerSec === 0 || duration === 0) return;

        ctx.save();
        ctx.strokeStyle = "rgba(128, 128, 128, 0.2)";
        ctx.lineWidth = 1;

        // Calculate grid interval (aim for ~50-100px between lines)
        const pxPerGrid = 80;
        let secondsPerGrid = pxPerGrid / minPxPerSec;

        // Snap to nice intervals
        const niceIntervals = [
          0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 5, 10, 30, 60,
        ];
        for (const interval of niceIntervals) {
          if (interval >= secondsPerGrid) {
            secondsPerGrid = interval;
            break;
          }
        }

        // Draw vertical lines
        const startTime = scrollLeft / minPxPerSec;
        const endTime = (scrollLeft + width) / minPxPerSec;
        const firstGridTime =
          Math.ceil(startTime / secondsPerGrid) * secondsPerGrid;

        for (let t = firstGridTime; t <= endTime; t += secondsPerGrid) {
          const x = t * minPxPerSec - scrollLeft;
          ctx.beginPath();
          ctx.moveTo(x, 0);
          ctx.lineTo(x, height);
          ctx.stroke();
        }

        ctx.restore();
      }

      /**
       * Handle hover for tooltip
       */
      function handleHover(event: MouseEvent): void {
        if (!options.onHover) return;

        const rect = container.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const time =
          (x + currentView.scrollLeft) / currentView.minPxPerSec;

        const values: Record<string, number | null> = {};
        for (const [id, layer] of layers) {
          if (layer.visible && layer.tooltip) {
            values[id] = layer.getValueAt(time);
          }
        }

        options.onHover(time, values);
      }

      /**
       * Handle click
       */
      function handleClick(event: MouseEvent): void {
        if (!options.onClick) return;

        const rect = container.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const time =
          (x + currentView.scrollLeft) / currentView.minPxPerSec;

        options.onClick(time);
      }

      // Add event listeners
      container.addEventListener("mousemove", handleHover);
      container.addEventListener("click", handleClick);
      resources.addCleanup(() => {
        container.removeEventListener("mousemove", handleHover);
        container.removeEventListener("click", handleClick);
      });

      // Subscribe to view state changes
      const viewSub = store
        .select((state) => ({
          minPxPerSec: state.view.minPxPerSec,
          scrollLeft: state.view.scrollLeft,
          containerWidth: state.view.containerWidth,
          duration: state.audio.duration,
        }))
        .subscribe((view) => {
          currentView = view;
          render();
        });

      resources.add({ dispose: () => viewSub.unsubscribe() });

      // Observe container resize
      const resizeObserver = new ResizeObserver(() => {
        render();
      });
      resizeObserver.observe(container);
      resources.addCleanup(() => resizeObserver.disconnect());

      // Add initial layers
      if (options.layers) {
        for (const layerConfig of options.layers) {
          layers.set(layerConfig.id, new SignalLayer(layerConfig));
        }
      }

      // Initial render
      requestAnimationFrame(() => {
        currentView = {
          minPxPerSec: getWidth() > 0 ? getWidth() / getDuration() : 100,
          scrollLeft: 0,
          containerWidth: getWidth(),
          duration: getDuration(),
        };
        render();
      });

      // Actions
      const actions: SignalViewerActions = {
        addLayer(config: LayerConfig): void {
          layers.set(config.id, new SignalLayer(config));
          render();
        },

        removeLayer(id: string): void {
          layers.delete(id);
          render();
        },

        updateLayer(id: string, updates: Partial<LayerConfig>): void {
          const layer = layers.get(id);
          if (layer) {
            layer.update(updates);
            render();
          }
        },

        setSignal(id: string, signal: SignalData): void {
          const layer = layers.get(id);
          if (layer) {
            layer.setSignal(signal);
            render();
          }
        },

        getValueAt(id: string, time: number): number | null {
          const layer = layers.get(id);
          return layer?.getValueAt(time) ?? null;
        },

        clearLayers(): void {
          layers.clear();
          render();
        },

        setHeight(newHeight: number): void {
          container.style.height = `${newHeight}px`;
          render();
        },

        render(): void {
          render();
        },
      };

      // Cast to satisfy PluginInstance.actions type
      return { actions: actions as unknown as PluginInstance["actions"] };
    },
  };
}
