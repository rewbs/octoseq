"use client";

import { useEffect, useRef, useState, forwardRef, useImperativeHandle } from "react";
import type WaveSurfer from "wavesurfer.js";
import {
  SignalViewerPlugin,
  type SignalViewerPluginOptions,
  type SignalViewerActions,
  type LayerConfig,
  type ContinuousSignal,
  type SparseSignal,
} from "@octoseq/wavesurfer-signalviewer";

export type WaveSurferSignalViewerHandle = {
  /** Add or update a layer */
  setLayer: (config: LayerConfig) => void;
  /** Remove a layer by id */
  removeLayer: (id: string) => void;
  /** Clear all layers */
  clearLayers: () => void;
  /** Get value at time for a layer */
  getValueAt: (layerId: string, time: number) => number | null;
};

export type WaveSurferSignalViewerProps = {
  /** Reference to the main WaveSurfer instance */
  wavesurfer: WaveSurfer | null;
  /** Initial layers */
  layers?: LayerConfig[];
  /** Plugin options */
  options?: Omit<SignalViewerPluginOptions, "layers">;
};

/**
 * SignalViewer component that registers itself with an existing WaveSurfer instance.
 *
 * Place this component after the main WaveSurferPlayer in the DOM.
 * It will render a synchronized signal visualization below the waveform.
 */
export const WaveSurferSignalViewer = forwardRef<
  WaveSurferSignalViewerHandle,
  WaveSurferSignalViewerProps
>(function WaveSurferSignalViewer({ wavesurfer, layers, options }, ref) {
  const actionsRef = useRef<SignalViewerActions | null>(null);
  const pluginIdRef = useRef<string | null>(null);
  const [isReady, setIsReady] = useState(false);

  // Expose actions via ref
  useImperativeHandle(
    ref,
    () => ({
      setLayer(config: LayerConfig) {
        const actions = actionsRef.current;
        if (!actions) return;

        // Try to update existing, or add new
        try {
          actions.updateLayer(config.id, config);
        } catch {
          actions.addLayer(config);
        }
      },
      removeLayer(id: string) {
        actionsRef.current?.removeLayer(id);
      },
      clearLayers() {
        actionsRef.current?.clearLayers();
      },
      getValueAt(layerId: string, time: number) {
        return actionsRef.current?.getValueAt(layerId, time) ?? null;
      },
    }),
    []
  );

  // Register plugin when wavesurfer is available
  useEffect(() => {
    if (!wavesurfer) return;

    let cancelled = false;

    const initPlugin = async () => {
      try {
        const registration = await wavesurfer.registerPluginV8(
          SignalViewerPlugin({
            height: options?.height ?? 100,
            backgroundColor: options?.backgroundColor ?? "rgba(0, 0, 0, 0.1)",
            showGrid: options?.showGrid ?? false,
            layout: options?.layout ?? "overlay",
            layers: layers,
            onHover: options?.onHover,
            onClick: options?.onClick,
          })
        );

        if (cancelled) {
          await wavesurfer.unregisterPluginV8(registration.manifest.id);
          return;
        }

        pluginIdRef.current = registration.manifest.id;
        actionsRef.current = registration.instance.actions as unknown as SignalViewerActions;
        setIsReady(true);
      } catch (err) {
        console.error("[SignalViewer] Failed to init plugin", err);
      }
    };

    void initPlugin();

    return () => {
      cancelled = true;
      if (pluginIdRef.current && wavesurfer) {
        wavesurfer.unregisterPluginV8(pluginIdRef.current).catch(() => {
          // Ignore cleanup errors
        });
      }
      pluginIdRef.current = null;
      actionsRef.current = null;
      setIsReady(false);
    };
  }, [wavesurfer, options?.height, options?.backgroundColor, options?.showGrid, options?.layout]);

  // Update layers when they change
  useEffect(() => {
    if (!isReady || !actionsRef.current || !layers) return;

    const actions = actionsRef.current;

    // Clear existing and add new
    actions.clearLayers();
    for (const layer of layers) {
      actions.addLayer(layer);
    }
  }, [layers, isReady]);

  // This component doesn't render anything itself - the plugin creates its own DOM
  return null;
});

/**
 * Helper to create a continuous signal from Float32Arrays
 */
export function createContinuousSignal(
  times: Float32Array,
  values: Float32Array,
  meta?: ContinuousSignal["meta"]
): ContinuousSignal {
  return {
    kind: "continuous",
    times,
    values,
    meta,
  };
}

/**
 * Helper to create a sparse signal from Float32Arrays
 */
export function createSparseSignal(
  times: Float32Array,
  strengths?: Float32Array,
  meta?: SparseSignal["meta"]
): SparseSignal {
  return {
    kind: "sparse",
    times,
    strengths,
    meta,
  };
}
