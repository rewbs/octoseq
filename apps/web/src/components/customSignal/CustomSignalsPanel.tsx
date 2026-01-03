"use client";

import { useMemo, useState, useCallback, useEffect, useRef, type MouseEvent } from "react";
import { useShallow } from "zustand/react/shallow";
import { Plus, Loader2, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { hzToFeatureIndex, computeLocalStats, type MelConversionConfig } from "@octoseq/mir";
import { useCustomSignalStore } from "@/lib/stores/customSignalStore";
import { useCustomSignalActions } from "@/lib/stores/hooks/useCustomSignalActions";
import { useInterpretationTreeStore } from "@/lib/stores/interpretationTreeStore";
import { usePlaybackStore } from "@/lib/stores/playbackStore";
import { useAudioInputStore } from "@/lib/stores/audioInputStore";
import { useFrequencyBandStore } from "@/lib/stores/frequencyBandStore";
import { useBeatGridStore } from "@/lib/stores/beatGridStore";
import { useMirroredCursorTime } from "@/lib/stores/hooks/useDerivedState";
import { getCustomSignalId } from "@/lib/nodeTypes";
import { SignalViewer, createContinuousSignal } from "@/components/wavesurfer/SignalViewer";
import { TimeAlignedHeatmapPixi } from "@/components/heatmap/TimeAlignedHeatmapPixi";
import { HeatmapPlayheadOverlay } from "@/components/heatmap/HeatmapPlayheadOverlay";
import { BeatGridOverlay } from "@/components/wavesurfer/BeatGridOverlay";
import { useElementSize } from "@/lib/useElementSize";
import type { WaveSurferViewport } from "@/components/wavesurfer/types";
import { useConfigStore } from "@/lib/stores/configStore";
import { prepareHpssSpectrogramForHeatmap, prepareMfccForHeatmap } from "@/lib/mirDisplayTransforms";
import { AudioSourceSelector } from "./AudioSourceSelector";
import { Source2DSelector } from "./Source2DSelector";
import { FrequencyRangeEditor } from "./FrequencyRangeEditor";
import { ReductionAlgorithmSelector } from "./ReductionAlgorithmSelector";
import { StabilizationEditor } from "./StabilizationEditor";
import {
  sourceUsesCoefficientRange,
  SOURCE_2D_SHORT_LABELS,
  REDUCTION_ALGORITHM_SHORT_LABELS,
  POLARITY_MODE_LABELS,
  POLARITY_MODE_DESCRIPTIONS,
  getDefaultStabilizationSettings,
  type CustomSignalDefinition,
  type FrequencyRangeSpec,
  type StabilizationSettings,
  type PolarityMode,
} from "@/lib/stores/types/customSignal";

/**
 * Generate a descriptive signal title based on configuration.
 * e.g., "Sub Bass Energy" or "MFCC (3-6) Variance"
 */
function getSignalDescription(signal: CustomSignalDefinition): string {
  const source = SOURCE_2D_SHORT_LABELS[signal.source2DFunction];
  const algo = REDUCTION_ALGORITHM_SHORT_LABELS[signal.reductionAlgorithm];

  let range = "";
  if (signal.frequencyRange.kind === "custom") {
    range = ` ${signal.frequencyRange.lowHz}–${signal.frequencyRange.highHz}Hz`;
  } else if (signal.frequencyRange.kind === "coefficientRange") {
    range = ` C${signal.frequencyRange.lowCoef}–${signal.frequencyRange.highCoef}`;
  } else if (signal.frequencyRange.kind === "bandReference") {
    range = " (band)";
  }

  return `${source}${range} → ${algo}`;
}

/**
 * Calculate the range overlay position as percentage of height.
 * Returns { bottomPct, heightPct } where:
 * - bottomPct is the distance from the bottom (0% = bottom, 100% = top)
 * - heightPct is the height of the selected region
 *
 * For frequency ranges (Hz), uses melConfig.nMels as the divisor.
 * For coefficient ranges, uses numBins (actual data dimension).
 */
function calculateRangeOverlay(
  frequencyRange: FrequencyRangeSpec,
  numBins: number,
  bands: { id: string; frequencyShape: { lowHzStart?: number; highHzStart?: number }[] }[],
  melConfig: MelConversionConfig
): { bottomPct: number; heightPct: number } | null {
  // For frequency-based ranges, normalize by melConfig.nMels (matches hzToFeatureIndex output)
  const freqNorm = melConfig.nMels - 1;

  switch (frequencyRange.kind) {
    case "fullSpectrum":
      return null; // No overlay for full spectrum

    case "bandReference": {
      const band = bands.find((b) => b.id === frequencyRange.bandId);
      if (!band || band.frequencyShape.length === 0) return null;
      // Use first segment's start values as the display bounds
      const lowHz = band.frequencyShape[0]?.lowHzStart ?? 0;
      const highHz = band.frequencyShape[0]?.highHzStart ?? melConfig.fMax;
      // Convert Hz to feature indices (0 to nMels-1 range)
      const lowIdx = hzToFeatureIndex(lowHz, melConfig);
      const highIdx = hzToFeatureIndex(highHz, melConfig);
      const bottomPct = (lowIdx / freqNorm) * 100;
      const topPct = (highIdx / freqNorm) * 100;
      return { bottomPct, heightPct: topPct - bottomPct };
    }

    case "custom": {
      const lowHz = frequencyRange.lowHz;
      const highHz = frequencyRange.highHz;
      // Convert Hz to feature indices (0 to nMels-1 range)
      const lowIdx = hzToFeatureIndex(lowHz, melConfig);
      const highIdx = hzToFeatureIndex(highHz, melConfig);
      const bottomPct = (lowIdx / freqNorm) * 100;
      const topPct = (highIdx / freqNorm) * 100;
      return { bottomPct, heightPct: topPct - bottomPct };
    }

    case "coefficientRange": {
      // For MFCC coefficients, directly use indices with numBins
      const lowCoef = frequencyRange.lowCoef;
      const highCoef = frequencyRange.highCoef;
      // Coefficients are indexed from bottom to top (C0 at bottom)
      const bottomPct = (lowCoef / numBins) * 100;
      const topPct = (highCoef / numBins) * 100;
      return { bottomPct, heightPct: topPct - bottomPct };
    }
  }
}

/**
 * Main panel for Custom Signals display in the main content area.
 * Shows 2D heatmap source, signal editor, and computed 1D result.
 */
export function CustomSignalsPanel() {
  const { ref: heatmapContainerRef, size: heatmapSize } = useElementSize<HTMLDivElement>();

  const selectedNodeId = useInterpretationTreeStore((s) => s.selectedNodeId);
  const selectNode = useInterpretationTreeStore((s) => s.selectNode);
  const structure = useCustomSignalStore((s) => s.structure);
  const resultCache = useCustomSignalStore((s) => s.resultCache);
  const computingSignalId = useCustomSignalStore((s) => s.computingSignalId);
  const selectSignal = useCustomSignalStore((s) => s.selectSignal);
  const viewport = usePlaybackStore((s) => s.viewport);
  const audioDuration = useAudioInputStore((s) => s.getAudioDuration());
  const heatmapScheme = useConfigStore((s) => s.heatmapScheme);
  const showDcBin = useConfigStore((s) => s.showDcBin);
  const showMfccC0 = useConfigStore((s) => s.showMfccC0);
  const getMelConfig = useConfigStore((s) => s.getMelConfig);

  // Get mel config for frequency calculations - memoize to avoid recalc on every render
  // Use 8000 Hz as default fMax to match typical web audio / data computation defaults
  const melConfig: MelConversionConfig = useMemo(() => {
    const cfg = getMelConfig();
    return {
      nMels: cfg.nMels,
      fMin: cfg.fMin ?? 0,
      fMax: cfg.fMax ?? 8000,
    };
  }, [getMelConfig]);
  const bandStructure = useFrequencyBandStore((s) => s.structure);
  const bands = bandStructure?.bands ?? [];
  const setCursorTimeSec = usePlaybackStore((s) => s.setCursorTimeSec);
  const playheadTimeSec = usePlaybackStore((s) => s.playheadTimeSec);
  const cursorTimeSec = useMirroredCursorTime();

  // Use cursor time when hovering, otherwise use playhead time during playback
  const displayTimeSec = cursorTimeSec ?? playheadTimeSec;
  const beatGridState = useBeatGridStore(
    useShallow((s) => ({
      activeBeatGrid: s.activeBeatGrid,
      isVisible: s.isVisible,
    }))
  );

  // Extract start/end time from viewport
  const startTime = viewport?.startTime ?? 0;
  const endTime = viewport?.endTime ?? (audioDuration ?? 0);

  // Create viewport object for beat grid overlay
  const heatmapViewport: WaveSurferViewport | null = useMemo(() => {
    if (!heatmapSize.width || endTime <= startTime) return null;
    const duration = endTime - startTime;
    return {
      startTime,
      endTime,
      containerWidthPx: heatmapSize.width,
      totalWidthPx: heatmapSize.width,
      minPxPerSec: heatmapSize.width / duration,
    };
  }, [startTime, endTime, heatmapSize.width]);

  // Handle cursor hover on heatmap
  const handleHeatmapMouseMove = (evt: MouseEvent<HTMLElement>) => {
    if (!viewport || !heatmapSize.width) return;
    const rect = evt.currentTarget.getBoundingClientRect();
    const span = endTime - startTime;
    if (span <= 0) return;
    const x = Math.max(0, Math.min(rect.width, evt.clientX - rect.left));
    const t = startTime + (x / rect.width) * span;
    const clamped = audioDuration ? Math.min(audioDuration, Math.max(0, t)) : Math.max(0, t);
    setCursorTimeSec(clamped);
  };

  const handleHeatmapMouseLeave = () => setCursorTimeSec(null);

  // Drag state for frequency/coefficient range editing
  const [dragState, setDragState] = useState<{
    type: "body" | "top" | "bottom";
    startY: number;
    mode: "frequency" | "coefficient";
    startLow: number;  // Hz for frequency, index for coefficient
    startHigh: number; // Hz for frequency, index for coefficient
  } | null>(null);

  // Toggle for showing pre-stabilized vs stabilized signal
  const [showRawSignal, setShowRawSignal] = useState(false);

  const {
    addSignal,
    updateSignal,
    recomputeSignal,
    isSourceDataAvailable,
    getSource2DData,
  } = useCustomSignalActions();

  // Get the selected signal ID from the tree node
  const signalId = selectedNodeId ? getCustomSignalId(selectedNodeId) : null;
  const isCustomSignalsSection = selectedNodeId === "custom-signals";

  // Find the selected signal definition
  const signals = structure?.signals ?? [];
  const signal = signalId ? signals.find((s) => s.id === signalId) : null;

  // Get cached result for the selected signal
  const result = signal ? resultCache.get(signal.id) : null;

  // Get 2D source data for visualization with display transforms applied
  const source2DData = useMemo(() => {
    if (!signal) return null;
    const rawData = getSource2DData(signal.sourceAudioId, signal.source2DFunction);
    if (!rawData) return null;

    // Apply display transforms to match main heatmap view
    const source = signal.source2DFunction;
    let displayData = rawData.data;

    if (source === "hpssHarmonic" || source === "hpssPercussive") {
      displayData = prepareHpssSpectrogramForHeatmap(rawData.data, {
        showDc: showDcBin,
        useDb: true,
        minDb: -80,
        maxDb: 0,
      });
    } else if (source === "mfcc" || source === "mfccDelta" || source === "mfccDeltaDelta") {
      displayData = prepareMfccForHeatmap(rawData.data, { showC0: showMfccC0 });
    }

    return { data: displayData, times: rawData.times };
  }, [signal, getSource2DData, showDcBin, showMfccC0]);

  // Get value range for the heatmap (normalized sources use [0,1])
  const heatmapValueRange = useMemo(() => {
    if (!signal) return undefined;
    const source = signal.source2DFunction;
    // For HPSS + MFCC we pre-normalise to [0,1], so use a fixed colormap range.
    if (
      source === "hpssHarmonic" ||
      source === "hpssPercussive" ||
      source === "mfcc" ||
      source === "mfccDelta" ||
      source === "mfccDeltaDelta"
    ) {
      return { min: 0, max: 1 };
    }
    return undefined;
  }, [signal]);

  // Calculate frequency/coefficient range overlay position
  const rangeOverlay = useMemo(() => {
    if (!signal || !source2DData) return null;
    // Skip for fullSpectrum - no overlay needed
    if (signal.frequencyRange.kind === "fullSpectrum") return null;

    const numBins = source2DData.data[0]?.length ?? 128;
    return calculateRangeOverlay(
      signal.frequencyRange,
      numBins,
      bands,
      melConfig
    );
  }, [signal, source2DData, bands, melConfig]);

  // Check if range is editable (custom Hz or coefficient range)
  const isEditableRange =
    signal?.frequencyRange.kind === "custom" ||
    signal?.frequencyRange.kind === "coefficientRange";

  // Handle drag start on range overlay (frequency or coefficient)
  const handleOverlayMouseDown = useCallback(
    (evt: MouseEvent<HTMLDivElement>, type: "body" | "top" | "bottom") => {
      if (!signal) return;
      const range = signal.frequencyRange;

      if (range.kind === "custom") {
        evt.preventDefault();
        evt.stopPropagation();
        setDragState({
          type,
          startY: evt.clientY,
          mode: "frequency",
          startLow: range.lowHz,
          startHigh: range.highHz,
        });
      } else if (range.kind === "coefficientRange") {
        evt.preventDefault();
        evt.stopPropagation();
        setDragState({
          type,
          startY: evt.clientY,
          mode: "coefficient",
          startLow: range.lowCoef,
          startHigh: range.highCoef,
        });
      }
    },
    [signal]
  );

  // Get number of bins/coefficients for drag calculations
  const numBins = source2DData?.data[0]?.length ?? 128;

  // Handle drag move (attached to window)
  useEffect(() => {
    if (!dragState || !signal) return;

    const handleMouseMove = (evt: globalThis.MouseEvent) => {
      const deltaY = evt.clientY - dragState.startY;
      // Negative deltaY means moving up = higher value

      if (dragState.mode === "frequency") {
        // Convert delta pixels to Hz change
        const hzPerPixel = (melConfig.fMax - melConfig.fMin) / (heatmapSize.height - 24);
        const deltaHz = -deltaY * hzPerPixel;

        let newLowHz = dragState.startLow;
        let newHighHz = dragState.startHigh;

        if (dragState.type === "body") {
          newLowHz = Math.max(0, Math.min(melConfig.fMax - (dragState.startHigh - dragState.startLow), dragState.startLow + deltaHz));
          newHighHz = newLowHz + (dragState.startHigh - dragState.startLow);
        } else if (dragState.type === "top") {
          newHighHz = Math.max(dragState.startLow + 100, Math.min(melConfig.fMax, dragState.startHigh + deltaHz));
        } else if (dragState.type === "bottom") {
          newLowHz = Math.max(0, Math.min(dragState.startHigh - 100, dragState.startLow + deltaHz));
        }

        updateSignal(signal.id, {
          frequencyRange: { kind: "custom", lowHz: Math.round(newLowHz), highHz: Math.round(newHighHz) },
        });
      } else {
        // Coefficient mode - convert pixels to coefficient indices
        const coefPerPixel = numBins / (heatmapSize.height - 24);
        const deltaCoef = -deltaY * coefPerPixel;

        let newLowCoef = dragState.startLow;
        let newHighCoef = dragState.startHigh;

        if (dragState.type === "body") {
          newLowCoef = Math.max(0, Math.min(numBins - (dragState.startHigh - dragState.startLow), dragState.startLow + deltaCoef));
          newHighCoef = newLowCoef + (dragState.startHigh - dragState.startLow);
        } else if (dragState.type === "top") {
          newHighCoef = Math.max(dragState.startLow + 1, Math.min(numBins, dragState.startHigh + deltaCoef));
        } else if (dragState.type === "bottom") {
          newLowCoef = Math.max(0, Math.min(dragState.startHigh - 1, dragState.startLow + deltaCoef));
        }

        updateSignal(signal.id, {
          frequencyRange: { kind: "coefficientRange", lowCoef: Math.round(newLowCoef), highCoef: Math.round(newHighCoef) },
        });
      }
    };

    const handleMouseUp = () => {
      setDragState(null);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [dragState, signal, heatmapSize.height, numBins, melConfig, updateSignal]);

  const isComputing = signal ? computingSignalId === signal.id : false;
  const sourceAvailable = signal
    ? isSourceDataAvailable(signal.sourceAudioId, signal.source2DFunction)
    : false;

  const handleAddSignal = () => {
    const newId = addSignal({ name: `Signal ${signals.length + 1}` });
    selectNode(`custom-signals:${newId}`);
    selectSignal(newId);
  };

  const handleUpdate = (updates: Partial<CustomSignalDefinition>) => {
    if (signal) {
      updateSignal(signal.id, updates);
    }
  };

  const handleCompute = async () => {
    if (signal) {
      await recomputeSignal(signal.id);
    }
  };

  // Auto-recompute with debounce
  const recomputeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSignalConfigRef = useRef<string | null>(null);

  useEffect(() => {
    if (!signal || !signal.autoRecompute || !sourceAvailable) return;

    // Create a config fingerprint to detect changes
    const configFingerprint = JSON.stringify({
      sourceAudioId: signal.sourceAudioId,
      source2DFunction: signal.source2DFunction,
      frequencyRange: signal.frequencyRange,
      reductionAlgorithm: signal.reductionAlgorithm,
      algorithmParams: signal.algorithmParams,
      stabilization: signal.stabilization,
    });

    // Skip if config hasn't changed
    if (configFingerprint === lastSignalConfigRef.current) return;
    lastSignalConfigRef.current = configFingerprint;

    // Clear existing timeout
    if (recomputeTimeoutRef.current) {
      clearTimeout(recomputeTimeoutRef.current);
    }

    // Debounced recompute (300ms)
    recomputeTimeoutRef.current = setTimeout(() => {
      recomputeSignal(signal.id);
    }, 300);

    return () => {
      if (recomputeTimeoutRef.current) {
        clearTimeout(recomputeTimeoutRef.current);
      }
    };
  }, [signal, sourceAvailable, recomputeSignal]);

  // Compute local stats for viewport
  const localStats = useMemo(() => {
    if (!result || !viewport) return null;
    return computeLocalStats(
      result.values,
      result.times,
      viewport.startTime,
      viewport.endTime
    );
  }, [result, viewport]);

  // Check if signal is "dirty" (config changed since last compute)
  const isDirty = useMemo(() => {
    if (!signal || !result) return false;
    // Compare modifiedAt with computedAt
    return new Date(signal.modifiedAt) > new Date(result.computedAt);
  }, [signal, result]);

  // If no custom signals section is selected, don't render
  if (!isCustomSignalsSection && !signalId) {
    return null;
  }

  // Section view - show list of signals with add button
  if (isCustomSignalsSection) {
    return (
      <div className="border-b border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900/50 p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
            Custom Signals
          </h2>
          <Button size="sm" variant="outline" onClick={handleAddSignal}>
            <Plus className="h-4 w-4 mr-1" />
            Add Signal
          </Button>
        </div>
        {signals.length === 0 ? (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Custom signals let you extract 1D signals from 2D spectral data
            (mel spectrogram, HPSS, MFCC) with configurable frequency ranges
            and reduction algorithms.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {signals.map((s) => {
              const hasResult = resultCache.has(s.id);
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => {
                    selectNode(`custom-signals:${s.id}`);
                    selectSignal(s.id);
                  }}
                  className={`px-3 py-1.5 text-sm rounded border transition-colors ${
                    !s.enabled ? "opacity-50" : ""
                  } ${
                    hasResult
                      ? "border-green-300 dark:border-green-700 bg-green-50 dark:bg-green-950/30"
                      : "border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800"
                  } hover:bg-zinc-100 dark:hover:bg-zinc-700`}
                >
                  {s.name}
                  {hasResult && (
                    <span className="ml-1.5 text-green-600 dark:text-green-400">
                      ✓
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  // Individual signal view
  if (!signal) {
    return (
      <div className="border-b border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900/50 p-4">
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Signal not found.
        </p>
      </div>
    );
  }

  return (
    <div className="border-b border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900/50">
      {/* Header row: Name + Auto/Recompute controls */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-200 dark:border-zinc-700">
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={signal.name}
            onChange={(e) => handleUpdate({ name: e.target.value })}
            className="text-sm font-medium text-zinc-700 dark:text-zinc-300 bg-transparent border-b border-transparent hover:border-zinc-300 dark:hover:border-zinc-600 focus:border-blue-500 dark:focus:border-blue-400 focus:outline-none px-0.5 min-w-20"
            placeholder="Signal name"
          />
          {isDirty && !signal.autoRecompute && (
            <span className="text-xs text-amber-500 dark:text-amber-400">•</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {!sourceAvailable && (
            <span className="text-xs text-amber-600 dark:text-amber-400">
              No source
            </span>
          )}
          <label className="flex items-center gap-1 cursor-pointer" title="Auto-recompute when settings change">
            <input
              type="checkbox"
              checked={signal.autoRecompute}
              onChange={(e) => handleUpdate({ autoRecompute: e.target.checked })}
              className="w-3 h-3 accent-blue-500"
            />
            <span className="text-xs text-zinc-400">Auto</span>
          </label>
          <Button
            size="sm"
            variant={isDirty && !signal.autoRecompute ? "default" : "ghost"}
            onClick={handleCompute}
            disabled={isComputing || !sourceAvailable}
            className="h-7 px-2"
          >
            {isComputing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RotateCcw className="h-3.5 w-3.5" />
            )}
          </Button>
        </div>
      </div>

      {/* Pipeline row: compact horizontal selectors */}
      <div className="flex flex-wrap items-center gap-1.5 px-3 py-2 border-b border-zinc-200 dark:border-zinc-700 text-xs text-zinc-500 dark:text-zinc-400">
        <span className="text-zinc-400">From</span>
        <AudioSourceSelector
          value={signal.sourceAudioId}
          onChange={(v) => handleUpdate({ sourceAudioId: v })}
          compact
        />
        <span className="text-zinc-400">→</span>
        <Source2DSelector
          value={signal.source2DFunction}
          onChange={(v) => {
            const updates: Partial<CustomSignalDefinition> = {
              source2DFunction: v,
            };
            // Reset frequency range when switching between frequency and coefficient modes
            const wasCoefMode = sourceUsesCoefficientRange(signal.source2DFunction);
            const isCoefMode = sourceUsesCoefficientRange(v);
            if (wasCoefMode !== isCoefMode) {
              updates.frequencyRange = { kind: "fullSpectrum" };
            }
            handleUpdate(updates);
          }}
          compact
        />
        <span className="text-zinc-400">→</span>
        <FrequencyRangeEditor
          value={signal.frequencyRange}
          onChange={(v) => handleUpdate({ frequencyRange: v })}
          mode={sourceUsesCoefficientRange(signal.source2DFunction) ? "coefficient" : "frequency"}
          numCoefficients={numBins}
          compact
        />
        <span className="text-zinc-400">→</span>
        <ReductionAlgorithmSelector
          algorithm={signal.reductionAlgorithm}
          params={signal.algorithmParams}
          onAlgorithmChange={(v) => handleUpdate({ reductionAlgorithm: v })}
          onParamsChange={(v) => handleUpdate({ algorithmParams: v })}
          compact
        />
      </div>

      {/* Polarity, Stabilization, and algorithm params */}
      <div className="px-3 py-2 border-b border-zinc-200 dark:border-zinc-700 flex flex-wrap items-start gap-4">
        {/* Polarity mode selector */}
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-zinc-500 dark:text-zinc-400">Polarity:</span>
          <select
            value={signal.polarityMode ?? "signed"}
            onChange={(e) => handleUpdate({ polarityMode: e.target.value as PolarityMode })}
            title={POLARITY_MODE_DESCRIPTIONS[signal.polarityMode ?? "signed"]}
            className="h-7 px-1.5 text-xs rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-900 dark:text-zinc-100"
          >
            {(["signed", "magnitude"] as const).map((mode) => (
              <option key={mode} value={mode}>
                {POLARITY_MODE_LABELS[mode]}
              </option>
            ))}
          </select>
        </div>
        <StabilizationEditor
          value={signal.stabilization ?? getDefaultStabilizationSettings()}
          onChange={(v: StabilizationSettings) => handleUpdate({ stabilization: v })}
        />
        {/* Algorithm-specific params inline */}
        {signal.reductionAlgorithm === "onsetStrength" && (
          <div className="flex items-center gap-2 text-xs">
            <span className="text-zinc-400">Smooth:</span>
            <input
              type="number"
              value={signal.algorithmParams.smoothMs ?? 10}
              onChange={(e) => handleUpdate({ algorithmParams: { ...signal.algorithmParams, smoothMs: Number(e.target.value) } })}
              className="w-12 h-6 px-1 text-xs text-center rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-900 dark:text-zinc-100"
              min={0}
              max={500}
            />
            <span className="text-zinc-400">ms</span>
            <label className="flex items-center gap-1 cursor-pointer ml-2">
              <input
                type="checkbox"
                checked={signal.algorithmParams.useLog ?? true}
                onChange={(e) => handleUpdate({ algorithmParams: { ...signal.algorithmParams, useLog: e.target.checked } })}
                className="w-3 h-3 accent-blue-500"
              />
              <span className="text-zinc-400">Log</span>
            </label>
          </div>
        )}
        {signal.reductionAlgorithm === "spectralFlux" && (
          <div className="flex items-center gap-2 text-xs">
            <label className="flex items-center gap-1 cursor-pointer">
              <input
                type="checkbox"
                checked={signal.algorithmParams.normalized ?? true}
                onChange={(e) => handleUpdate({ algorithmParams: { ...signal.algorithmParams, normalized: e.target.checked } })}
                className="w-3 h-3 accent-blue-500"
              />
              <span className="text-zinc-400">Normalized</span>
            </label>
          </div>
        )}
      </div>

      {/* 2D Heatmap visualization - no header, just badge on hover */}
      {source2DData && (
        <div className="px-3 py-2 border-b border-zinc-200 dark:border-zinc-700">
          <div
            ref={heatmapContainerRef}
            className="relative rounded overflow-hidden border border-zinc-200 dark:border-zinc-700"
            onMouseMove={handleHeatmapMouseMove}
            onMouseLeave={handleHeatmapMouseLeave}
          >
            <TimeAlignedHeatmapPixi
              input={source2DData}
              startTime={startTime}
              endTime={endTime}
              width={heatmapSize.width}
              initialHeight={120}
              valueRange={heatmapValueRange}
              colorScheme={heatmapScheme}
              showBeatGrid={beatGridState.isVisible}
              audioDuration={audioDuration ?? 0}
            />
            {/* Beat grid overlay */}
            {heatmapViewport && audioDuration && (
              <div className="absolute inset-0 pointer-events-none z-10" style={{ padding: "4px" }}>
                <BeatGridOverlay
                  viewport={heatmapViewport}
                  beatGrid={beatGridState.activeBeatGrid}
                  audioDuration={audioDuration}
                  height={heatmapSize.height - 24}
                  isVisible={beatGridState.isVisible}
                />
              </div>
            )}
            {/* Playhead/cursor overlay */}
            {heatmapViewport && (
              <div className="absolute inset-0 pointer-events-none z-10" style={{ padding: "4px" }}>
                <HeatmapPlayheadOverlay
                  viewport={heatmapViewport}
                  timeSec={displayTimeSec}
                  height={heatmapSize.height - 24}
                  widthPx={heatmapSize.width}
                />
              </div>
            )}
            {/* Frequency/coefficient range overlay - interactive when editable */}
            {rangeOverlay && (
              <div
                className="absolute inset-0 z-20 pointer-events-none"
                style={{ padding: "4px" }}
              >
                {/* Inner container matching heatmap drawing area */}
                <div
                  className="relative w-full"
                  style={{ height: heatmapSize.height - 24 }}
                >
                  {/* Range selection box - positioned from top (high freq = top, low freq = bottom) */}
                  <div
                    className={`absolute left-0 right-0 ${dragState ? "select-none" : ""}`}
                    style={{
                      // Top position = 100% - bottomPct - heightPct (invert for top-down positioning)
                      top: `${100 - rangeOverlay.bottomPct - rangeOverlay.heightPct}%`,
                      height: `${rangeOverlay.heightPct}%`,
                    }}
                  >
                    {/* Top edge drag handle */}
                    {isEditableRange && (
                      <div
                        className="absolute top-0 left-0 right-0 h-0.5 cursor-ns-resize bg-cyan-400 hover:bg-cyan-300 transition-colors pointer-events-auto"
                        onMouseDown={(e) => handleOverlayMouseDown(e, "top")}
                      />
                    )}
                    {/* Body drag area */}
                    <div
                      className={`absolute inset-0 border-y-2 border-cyan-400 bg-cyan-400/20 ${
                        isEditableRange ? "hover:bg-cyan-400/30 transition-colors pointer-events-auto cursor-move" : ""
                      }`}
                      style={{ top: isEditableRange ? "2px" : 0, bottom: isEditableRange ? "2px" : 0 }}
                      onMouseDown={(e) => isEditableRange && handleOverlayMouseDown(e, "body")}
                    />
                    {/* Bottom edge drag handle */}
                    {isEditableRange && (
                      <div
                        className="absolute bottom-0 left-0 right-0 h-0.5 cursor-ns-resize bg-cyan-400 hover:bg-cyan-300 transition-colors pointer-events-auto"
                        onMouseDown={(e) => handleOverlayMouseDown(e, "bottom")}
                      />
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 1D Result visualization */}
      {result && (
        <div className="px-3 py-2">
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-2 text-xs">
              {/* Dynamic contextual title */}
              <span className="text-zinc-600 dark:text-zinc-300 font-medium">
                {signal.name}
              </span>
              <span className="text-zinc-400 dark:text-zinc-500">
                {getSignalDescription(signal)}
              </span>
              {/* Inline pre/post toggle */}
              {result.rawValues && (
                <span className="text-zinc-400 ml-1">
                  ·
                  <button
                    type="button"
                    onClick={() => setShowRawSignal(!showRawSignal)}
                    className={`ml-1 px-1 py-0.5 rounded text-xs ${
                      showRawSignal
                        ? "bg-zinc-200 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-300"
                        : "text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300"
                    }`}
                  >
                    {showRawSignal ? "Stabilized" : "Raw"}
                  </button>
                </span>
              )}
            </div>
            {/* Local stats - compact */}
            {localStats && (
              <div className="text-xs text-zinc-400 dark:text-zinc-500 font-mono" title="Viewport statistics">
                {localStats.min.toFixed(2)}–{localStats.max.toFixed(2)}
                <span className="text-zinc-300 dark:text-zinc-600 mx-1">|</span>
                <span className="text-zinc-500" title="5th-95th percentile">
                  p5-95: {localStats.p5.toFixed(2)}–{localStats.p95.toFixed(2)}
                </span>
              </div>
            )}
          </div>
          <SignalViewer
            signal={createContinuousSignal(
              result.times,
              showRawSignal && result.rawValues ? result.rawValues : result.values
            )}
            viewport={viewport}
            cursorTimeSec={cursorTimeSec}
            onCursorTimeChange={setCursorTimeSec}
            initialHeight={80}
            mode="filled"
            color={showRawSignal && result.rawValues
              ? { stroke: "rgb(156, 163, 175)", fill: "rgba(156, 163, 175, 0.3)" }
              : { stroke: "rgb(124, 58, 237)", fill: "rgba(124, 58, 237, 0.3)" }
            }
            showBeatGrid={beatGridState.isVisible}
            audioDuration={audioDuration ?? 0}
          />
        </div>
      )}

      {/* Empty state when no result */}
      {!result && !source2DData && (
        <div className="px-3 py-4 text-center text-xs text-zinc-500 dark:text-zinc-400">
          {sourceAvailable
            ? "Press ⟳ to compute signal"
            : "Run MIR analysis first"}
        </div>
      )}
    </div>
  );
}
