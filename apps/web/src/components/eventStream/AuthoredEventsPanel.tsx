"use client";

import { useMemo, useState, useCallback, useEffect, useRef } from "react";
import { useShallow } from "zustand/react/shallow";
import { Plus, Loader2, RotateCcw, Sparkles, Merge, Replace, HelpCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  pickPeaks,
  pickPeaksAdaptive,
  applyHysteresisGate,
  DEFAULT_PEAK_PICKING_PARAMS,
  type PeakPickingParams,
  type AdaptivePeakPickingResult,
} from "@octoseq/mir";
import { useInterpretationTreeStore } from "@/lib/stores/interpretationTreeStore";
import { usePlaybackStore } from "@/lib/stores/playbackStore";
import { useAudioInputStore } from "@/lib/stores/audioInputStore";
import { useAuthoredEventStore } from "@/lib/stores/authoredEventStore";
import { useAuthoredEventActions } from "@/lib/stores/hooks/useAuthoredEventActions";
import { useBeatGridStore } from "@/lib/stores/beatGridStore";
import { useMirroredCursorTime } from "@/lib/stores/hooks/useDerivedState";
import { useDerivedSignalStore } from "@/lib/stores/derivedSignalStore";
import { useBandMirStore } from "@/lib/stores/bandMirStore";
import { useFrequencyBandStore } from "@/lib/stores/frequencyBandStore";
import { useMirStore, mirTabDefinitions, makeInputMirCacheKey } from "@/lib/stores/mirStore";
import type { MirFunctionId } from "@/components/mir/MirControlPanel";
import { getAuthoredStreamId, getInspectorNodeType } from "@/lib/nodeTypes";
import { SignalViewer, createContinuousSignal } from "@/components/wavesurfer/SignalViewer";
import { EventStreamEditor } from "./EventStreamEditor";
import type { AuthoredEventProvenance, AuthoredEventStream } from "@/lib/stores/types/authoredEvent";
import { cn } from "@/lib/utils";

// ============================================================================
// Types
// ============================================================================

/**
 * Available signal source types for event extraction.
 */
type SignalSource =
  | { kind: "customSignal"; id: string; name: string; groupLabel: string }
  | { kind: "bandMir"; bandId: string; functionId: string; name: string; groupLabel: string }
  | { kind: "mir1d"; inputId: string; functionId: string; name: string; groupLabel: string };

/**
 * Peak picking algorithm choices.
 */
type PeakAlgorithm = "threshold" | "adaptive";

/**
 * Import mode - replace all events or merge with existing.
 */
type ImportMode = "replace" | "merge";

const PEAK_ALGORITHM_LABELS: Record<PeakAlgorithm, string> = {
  threshold: "Fixed Threshold",
  adaptive: "Adaptive",
};

// ============================================================================
// Signal Import Panel Component
// ============================================================================

interface SignalImportPanelProps {
  streamId: string;
  stream: AuthoredEventStream;
  /** Content to render between signal preview and controls (e.g., EventStreamEditor) */
  children?: React.ReactNode;
}

/**
 * Gating mode for proximity filtering
 */
type GatingMode = "simple" | "hysteresis";

function SignalImportPanel({ streamId, stream, children }: SignalImportPanelProps) {
  // Source selection
  const [selectedSourceKey, setSelectedSourceKey] = useState<string>("");

  // Peak picking parameters
  const [algorithm, setAlgorithm] = useState<PeakAlgorithm>("threshold");
  const [threshold, setThreshold] = useState(DEFAULT_PEAK_PICKING_PARAMS.threshold);
  const [minDistance, setMinDistance] = useState(DEFAULT_PEAK_PICKING_PARAMS.minDistance);
  const [adaptiveWindow, setAdaptiveWindow] = useState(0.5);

  // Gating mode and hysteresis parameters
  const [gatingMode, setGatingMode] = useState<GatingMode>("simple");
  const [hysteresisOffThreshold, setHysteresisOffThreshold] = useState(0.15); // Release threshold

  // Import mode
  const [importMode, setImportMode] = useState<ImportMode>("merge");
  const [dedupeThresholdMs, setDedupeThresholdMs] = useState(50);

  // Auto-detect toggle
  const [autoDetect, setAutoDetect] = useState(true);
  const [isDetecting, setIsDetecting] = useState(false);

  // Playback state for preview
  const viewport = usePlaybackStore((s) => s.viewport);
  const audioDuration = useAudioInputStore((s) => s.getAudioDuration());
  const setCursorTimeSec = usePlaybackStore((s) => s.setCursorTimeSec);
  const cursorTimeSec = useMirroredCursorTime();
  const beatGridVisible = useBeatGridStore((s) => s.isVisible);
  const bpm = useBeatGridStore((s) => s.selectedHypothesis?.bpm ?? null);

  // Get available signals from various sources (now called derived signals)
  const derivedSignals = useDerivedSignalStore(
    useShallow((s) => s.structure?.signals ?? [])
  );
  const derivedSignalResults = useDerivedSignalStore((s) => s.resultCache);

  const bands = useFrequencyBandStore(
    useShallow((s) => s.structure?.bands ?? [])
  );
  const bandMirCache = useBandMirStore((s) => s.cache);
  const bandCqtCache = useBandMirStore((s) => s.cqtCache);

  const mirResults = useMirStore((s) => s.mirResults);
  const inputMirCache = useMirStore((s) => s.inputMirCache);

  // Build available sources list - comprehensive list of all 1D signals
  const availableSources = useMemo(() => {
    const sources: SignalSource[] = [];

    // Custom Signals
    for (const signal of derivedSignals) {
      if (derivedSignalResults.has(signal.id)) {
        sources.push({
          kind: "customSignal",
          id: signal.id,
          name: signal.name,
          groupLabel: "Custom Signals",
        });
      }
    }

    // Band MIR signals (STFT-based)
    const bandMirFunctions = [
      { id: "bandAmplitudeEnvelope", label: "Amplitude" },
      { id: "bandOnsetStrength", label: "Onset Strength" },
      { id: "bandSpectralFlux", label: "Spectral Flux" },
      { id: "bandSpectralCentroid", label: "Spectral Centroid" },
    ] as const;

    for (const band of bands) {
      for (const fn of bandMirFunctions) {
        const cacheKey = `${band.id}:${fn.id}` as `${string}:${typeof fn.id}`;
        if (bandMirCache.has(cacheKey)) {
          sources.push({
            kind: "bandMir",
            bandId: band.id,
            functionId: fn.id,
            name: `${band.label} ${fn.label}`,
            groupLabel: "Band Signals (STFT)",
          });
        }
      }
    }

    // Band CQT signals
    const bandCqtFunctions = [
      { id: "bandCqtHarmonicEnergy", label: "Harmonic Energy" },
      { id: "bandCqtBassPitchMotion", label: "Bass Pitch Motion" },
      { id: "bandCqtTonalStability", label: "Tonal Stability" },
    ] as const;

    for (const band of bands) {
      for (const fn of bandCqtFunctions) {
        const cacheKey = `${band.id}:${fn.id}` as `${string}:${typeof fn.id}`;
        if (bandCqtCache.has(cacheKey)) {
          sources.push({
            kind: "bandMir",
            bandId: band.id,
            functionId: fn.id,
            name: `${band.label} ${fn.label}`,
            groupLabel: "Band Signals (CQT)",
          });
        }
      }
    }

    // Global MIR 1D outputs
    const mir1dFunctions = mirTabDefinitions.filter((t) => t.kind === "1d");
    for (const fn of mir1dFunctions) {
      const result = mirResults[fn.id];
      if (result && result.kind === "1d") {
        sources.push({
          kind: "mir1d",
          inputId: "mixdown",
          functionId: fn.id,
          name: fn.label.replace(" (1D)", ""),
          groupLabel: "MIR Analysis (Mixdown)",
        });
      }
    }

    // Per-input MIR results
    for (const [key, result] of inputMirCache) {
      if (result.kind === "1d") {
        const [inputId, functionId] = key.split(":") as [string, string];
        if (inputId !== "mixdown") {
          const fnDef = mir1dFunctions.find((f) => f.id === functionId);
          if (fnDef) {
            sources.push({
              kind: "mir1d",
              inputId,
              functionId,
              name: `${inputId} ${fnDef.label.replace(" (1D)", "")}`,
              groupLabel: "MIR Analysis (Stems)",
            });
          }
        }
      }
    }

    return sources;
  }, [derivedSignals, derivedSignalResults, bands, bandMirCache, bandCqtCache, mirResults, inputMirCache]);

  // Group sources by groupLabel
  const groupedSources = useMemo(() => {
    const groups = new Map<string, SignalSource[]>();
    for (const source of availableSources) {
      const existing = groups.get(source.groupLabel) ?? [];
      existing.push(source);
      groups.set(source.groupLabel, existing);
    }
    return groups;
  }, [availableSources]);

  // Find selected source
  const selectedSource = useMemo(() => {
    if (!selectedSourceKey) return null;
    return availableSources.find((s) => {
      if (s.kind === "customSignal") return s.id === selectedSourceKey;
      if (s.kind === "bandMir") return `${s.bandId}:${s.functionId}` === selectedSourceKey;
      if (s.kind === "mir1d") return `${s.inputId}:${s.functionId}` === selectedSourceKey;
      return false;
    }) ?? null;
  }, [selectedSourceKey, availableSources]);

  // Get signal data for selected source
  const signalData = useMemo(() => {
    if (!selectedSource) return null;

    if (selectedSource.kind === "customSignal") {
      const result = derivedSignalResults.get(selectedSource.id);
      if (!result) return null;
      return { times: result.times, values: result.values };
    }

    if (selectedSource.kind === "bandMir") {
      // Try STFT cache first
      const stftKey = `${selectedSource.bandId}:${selectedSource.functionId}` as `${string}:${string}`;
      const stftResult = bandMirCache.get(stftKey as `${string}:${"bandAmplitudeEnvelope" | "bandOnsetStrength" | "bandSpectralFlux" | "bandSpectralCentroid"}`);
      if (stftResult) {
        return { times: stftResult.times, values: stftResult.values };
      }
      // Try CQT cache
      const cqtResult = bandCqtCache.get(stftKey as `${string}:${"bandCqtHarmonicEnergy" | "bandCqtBassPitchMotion" | "bandCqtTonalStability"}`);
      if (cqtResult) {
        return { times: cqtResult.times, values: cqtResult.values };
      }
      return null;
    }

    if (selectedSource.kind === "mir1d") {
      if (selectedSource.inputId === "mixdown") {
        const result = mirResults[selectedSource.functionId as keyof typeof mirResults];
        if (result && result.kind === "1d") {
          return { times: result.times, values: result.values };
        }
      } else {
        const key = makeInputMirCacheKey(selectedSource.inputId, selectedSource.functionId as MirFunctionId);
        const result = inputMirCache.get(key);
        if (result && result.kind === "1d") {
          return { times: result.times, values: result.values };
        }
      }
      return null;
    }

    return null;
  }, [selectedSource, derivedSignalResults, bandMirCache, bandCqtCache, mirResults, inputMirCache]);

  // Peak detection state
  const detectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [peakResult, setPeakResult] = useState<{
    times: Float32Array;
    strengths: Float32Array;
    thresholdCurve?: Float32Array;
    thresholdTimes?: Float32Array;
  } | null>(null);

  const runDetection = useCallback(() => {
    if (!signalData) {
      setPeakResult(null);
      return;
    }

    setIsDetecting(true);

    requestAnimationFrame(() => {
      const params: PeakPickingParams = {
        threshold,
        minDistance: gatingMode === "hysteresis" ? 0 : minDistance, // Hysteresis handles min distance itself
      };

      let result: { times: Float32Array; strengths: Float32Array; thresholdCurve?: Float32Array; thresholdTimes?: Float32Array };

      if (algorithm === "adaptive") {
        const windowSamples = Math.max(5, Math.round(adaptiveWindow * 100));
        // Request threshold curve for visualization
        const adaptiveResult = pickPeaksAdaptive(
          signalData.times,
          signalData.values,
          windowSamples,
          params,
          true // includeThresholdCurve
        ) as AdaptivePeakPickingResult;
        result = adaptiveResult;
      } else {
        result = pickPeaks(signalData.times, signalData.values, params);
      }

      // Apply hysteresis gating if enabled
      if (gatingMode === "hysteresis" && result.times.length > 0) {
        const hysteresisResult = applyHysteresisGate(
          signalData.times,
          signalData.values,
          result.times,
          result.strengths,
          {
            onThreshold: threshold,
            offThreshold: hysteresisOffThreshold,
            minDistance,
          }
        );
        result = {
          ...result,
          times: hysteresisResult.times,
          strengths: hysteresisResult.strengths,
        };
      }

      setPeakResult(result);
      setIsDetecting(false);
    });
  }, [signalData, algorithm, threshold, minDistance, adaptiveWindow, gatingMode, hysteresisOffThreshold]);

  // Auto-detect with debounce
  useEffect(() => {
    if (!autoDetect || !signalData) return;

    if (detectTimeoutRef.current) {
      clearTimeout(detectTimeoutRef.current);
    }

    detectTimeoutRef.current = setTimeout(() => {
      runDetection();
    }, 150);

    return () => {
      if (detectTimeoutRef.current) {
        clearTimeout(detectTimeoutRef.current);
      }
    };
  }, [autoDetect, signalData, algorithm, threshold, minDistance, adaptiveWindow, gatingMode, hysteresisOffThreshold, runDetection]);

  // Handle source selection
  const handleSourceChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    const value = e.target.value;
    setSelectedSourceKey(value);
    setPeakResult(null);
  }, []);

  // Handle import
  const handleImport = useCallback(() => {
    if (!peakResult || peakResult.times.length === 0) return;

    const now = new Date().toISOString();
    const newEvents = [];

    for (let i = 0; i < peakResult.times.length; i++) {
      newEvents.push({
        time: peakResult.times[i]!,
        beatPosition: null as number | null,
        weight: peakResult.strengths[i]!,
        duration: null as number | null,
        payload: null as Record<string, unknown> | null,
        provenance: {
          kind: "manual" as const,
          createdAt: now,
        } satisfies AuthoredEventProvenance,
      });
    }

    if (importMode === "replace") {
      // Clear existing events by removing all, then add new ones
      const existingEventIds = stream.events.map((e) => e.id);
      if (existingEventIds.length > 0) {
        useAuthoredEventStore.getState().removeEvents(streamId, existingEventIds);
      }
      useAuthoredEventStore.getState().addEvents(streamId, newEvents);
    } else {
      // Merge mode - filter out duplicates
      const existingEvents = stream.events;
      const dedupeThresholdSec = dedupeThresholdMs / 1000;

      const filteredNewEvents = newEvents.filter((newEvent) => {
        // Check if any existing event is within the dedupe threshold
        return !existingEvents.some(
          (existing) => Math.abs(existing.time - newEvent.time) < dedupeThresholdSec
        );
      });

      useAuthoredEventStore.getState().addEvents(streamId, filteredNewEvents);
    }

    // Reset source selection
    setSelectedSourceKey("");
    setPeakResult(null);
  }, [peakResult, streamId, stream.events, importMode, dedupeThresholdMs]);

  // Create signal for preview
  const previewSignal = useMemo(() => {
    if (!signalData) return null;
    return createContinuousSignal(signalData.times, signalData.values);
  }, [signalData]);

  // Create peak events for overlay
  const peakEvents = useMemo(() => {
    if (!peakResult) return [];
    const events = [];
    for (let i = 0; i < peakResult.times.length; i++) {
      events.push({
        time: peakResult.times[i]!,
        strength: peakResult.strengths[i]!,
      });
    }
    return events;
  }, [peakResult]);

  // Compute the threshold line position as percentage from bottom (0-100%)
  // For fixed threshold: threshold directly maps to height
  // For adaptive: we show the base threshold level (actual adaptive line varies per-sample)
  const thresholdLinePercent = (1 - threshold) * 100;

  // Compute min gap in beats and frames (assuming 24fps)
  const fps = 24;
  const minGapBeats = bpm ? (minDistance / 60) * bpm : null;
  const minGapFrames = minDistance * fps;

  // Generate adaptive threshold curve path for SVG visualization
  const adaptiveThresholdPath = useMemo(() => {
    if (algorithm !== "adaptive" || !peakResult?.thresholdCurve || !peakResult?.thresholdTimes || !viewport) {
      return null;
    }

    const curve = peakResult.thresholdCurve;
    const times = peakResult.thresholdTimes;
    const visibleDuration = viewport.endTime - viewport.startTime;
    if (visibleDuration <= 0 || curve.length === 0) return null;

    // Downsample for performance - max ~500 points
    const step = Math.max(1, Math.floor(curve.length / 500));
    const points: string[] = [];

    for (let i = 0; i < curve.length; i += step) {
      const t = times[i]!;
      if (t < viewport.startTime || t > viewport.endTime) continue;

      const x = ((t - viewport.startTime) / visibleDuration) * 100;
      const y = (1 - curve[i]!) * 100; // Invert for SVG coordinates
      points.push(`${x},${y}`);
    }

    if (points.length < 2) return null;
    return `M ${points.join(" L ")}`;
  }, [algorithm, peakResult?.thresholdCurve, peakResult?.thresholdTimes, viewport]);

  // Compute hysteresis off-threshold line position
  const hysteresisOffLinePercent = (1 - hysteresisOffThreshold) * 100;

  return (
    <div className="border-t border-zinc-200 dark:border-zinc-700 bg-zinc-100 dark:bg-zinc-900/80">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-zinc-200 dark:border-zinc-700">
        <Sparkles className="h-4 w-4 text-amber-500" />
        <span className="text-sm font-medium">Import Events from Signal</span>
      </div>

      {/* Pipeline row: Source → Algorithm */}
      <div className="flex flex-wrap items-center gap-1.5 px-3 py-2 border-b border-zinc-200 dark:border-zinc-700 text-xs">
        <span className="text-zinc-400">From</span>
        <select
          value={selectedSourceKey}
          onChange={handleSourceChange}
          className="h-7 px-2 text-xs rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-900 dark:text-zinc-100 max-w-50"
        >
          <option value="">Select signal...</option>
          {Array.from(groupedSources.entries()).map(([groupLabel, sources]) => (
            <optgroup key={groupLabel} label={groupLabel}>
              {sources.map((source) => {
                const key = source.kind === "customSignal"
                  ? source.id
                  : source.kind === "bandMir"
                    ? `${source.bandId}:${source.functionId}`
                    : `${source.inputId}:${source.functionId}`;
                return (
                  <option key={key} value={key}>
                    {source.name}
                  </option>
                );
              })}
            </optgroup>
          ))}
        </select>

        {selectedSource && (
          <>
            <span className="text-zinc-400">→</span>
            <div className="relative group">
              <select
                value={algorithm}
                onChange={(e) => setAlgorithm(e.target.value as PeakAlgorithm)}
                className="h-7 px-2 text-xs rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-900 dark:text-zinc-100"
              >
                {(["threshold", "adaptive"] as const).map((alg) => (
                  <option key={alg} value={alg}>
                    {PEAK_ALGORITHM_LABELS[alg]}
                  </option>
                ))}
              </select>
              {/* Algorithm explanation tooltip */}
              <div className="absolute left-0 top-full mt-1 z-10 hidden group-hover:block w-64 p-2 text-xs bg-zinc-800 text-zinc-200 rounded shadow-lg">
                {algorithm === "threshold" ? (
                  <p>
                    <strong>Fixed Threshold:</strong> Detects peaks that exceed a constant
                    normalized level. Works well for signals with consistent amplitude.
                  </p>
                ) : (
                  <p>
                    <strong>Adaptive:</strong> Uses a sliding window to compute local mean
                    and standard deviation, then finds peaks that exceed mean + threshold × std.
                    Better for signals with varying amplitude over time.
                  </p>
                )}
              </div>
            </div>
            <span className="text-zinc-400">→</span>
            <span className="text-amber-600 dark:text-amber-400 font-medium">
              Events
            </span>
          </>
        )}
      </div>

      {/* Parameters row */}
      {selectedSource && (
        <div className="px-3 py-2 border-b border-zinc-200 dark:border-zinc-700 flex flex-wrap items-center gap-4 text-xs">
          {/* Threshold (on-threshold for hysteresis) */}
          <div className="flex items-center gap-2">
            <label className="text-zinc-500 w-16">
              {gatingMode === "hysteresis" ? "On Thresh" : "Threshold"}
            </label>
            <input
              type="range"
              value={threshold}
              onChange={(e) => setThreshold(parseFloat(e.target.value))}
              min={0.05}
              max={0.95}
              step={0.01}
              className="w-20 h-1.5 accent-amber-500"
            />
            <span className="text-zinc-600 dark:text-zinc-300 w-8 font-mono">
              {(threshold * 100).toFixed(0)}%
            </span>
          </div>

          {/* Adaptive window */}
          {algorithm === "adaptive" && (
            <div className="flex items-center gap-2">
              <label className="text-zinc-500 w-12">Window</label>
              <input
                type="range"
                value={adaptiveWindow}
                onChange={(e) => setAdaptiveWindow(parseFloat(e.target.value))}
                min={0.1}
                max={2.0}
                step={0.05}
                className="w-16 h-1.5 accent-amber-500"
              />
              <span className="text-zinc-600 dark:text-zinc-300 w-8 font-mono">
                {adaptiveWindow.toFixed(1)}s
              </span>
            </div>
          )}

          {/* Gating mode toggle */}
          <div className="flex items-center gap-2">
            <div className="relative group">
              <label className="text-zinc-500 flex items-center gap-1">
                Gating
                <HelpCircle className="h-3 w-3 text-zinc-400" />
              </label>
              <div className="absolute left-0 top-full mt-1 z-10 hidden group-hover:block w-56 p-2 text-xs bg-zinc-800 text-zinc-200 rounded shadow-lg">
                <p className="mb-1"><strong>Simple:</strong> Only min gap between peaks.</p>
                <p><strong>Hysteresis:</strong> Signal must drop below off-threshold before
                  a new peak can trigger. Prevents retriggering during sustained high values.</p>
              </div>
            </div>
            <select
              value={gatingMode}
              onChange={(e) => setGatingMode(e.target.value as GatingMode)}
              className="h-6 px-1 text-xs rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-900 dark:text-zinc-100"
            >
              <option value="simple">Simple</option>
              <option value="hysteresis">Hysteresis</option>
            </select>
          </div>

          {/* Hysteresis off-threshold */}
          {gatingMode === "hysteresis" && (
            <div className="flex items-center gap-2">
              <label className="text-zinc-500 w-16">Off Thresh</label>
              <input
                type="range"
                value={hysteresisOffThreshold}
                onChange={(e) => setHysteresisOffThreshold(parseFloat(e.target.value))}
                min={0.01}
                max={threshold - 0.01}
                step={0.01}
                className="w-16 h-1.5 accent-purple-500"
              />
              <span className="text-zinc-600 dark:text-zinc-300 w-8 font-mono">
                {(hysteresisOffThreshold * 100).toFixed(0)}%
              </span>
            </div>
          )}

          {/* Min Gap - always last */}
          <div className="flex items-center gap-2">
            <label className="text-zinc-500 w-14">Min Gap</label>
            <input
              type="range"
              value={minDistance}
              onChange={(e) => setMinDistance(parseFloat(e.target.value))}
              min={0.02}
              max={0.5}
              step={0.01}
              className="w-20 h-1.5 accent-amber-500"
            />
            <span className="text-zinc-600 dark:text-zinc-300 font-mono text-tiny leading-tight">
              {(minDistance * 1000).toFixed(0)}ms
              {minGapBeats !== null && (
                <span className="text-zinc-400"> · {minGapBeats.toFixed(2)}b</span>
              )}
              <span className="text-zinc-400"> · {minGapFrames.toFixed(1)}f</span>
            </span>
          </div>

          {/* Auto + Recompute */}
          <div className="flex items-center gap-2 ml-auto">
            <label className="flex items-center gap-1 cursor-pointer">
              <input
                type="checkbox"
                checked={autoDetect}
                onChange={(e) => setAutoDetect(e.target.checked)}
                className="w-3 h-3 accent-amber-500"
              />
              <span className="text-zinc-400">Auto</span>
            </label>
            <Button
              size="sm"
              variant="ghost"
              onClick={runDetection}
              disabled={isDetecting || !signalData}
              className="h-6 px-2"
            >
              {isDetecting ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <RotateCcw className="h-3 w-3" />
              )}
            </Button>
          </div>
        </div>
      )}

      {/* Signal preview with peaks and threshold line */}
      {previewSignal && (
        <div className="px-3 py-2 border-b border-zinc-200 dark:border-zinc-700">
          <div className="flex items-center justify-between mb-1 text-xs">
            <span className="text-zinc-600 dark:text-zinc-300 font-medium">
              {selectedSource?.name}
            </span>
            {peakResult && (
              <span className="text-amber-600 dark:text-amber-400">
                {peakResult.times.length} peaks detected
              </span>
            )}
          </div>
          <div className="relative">
            <SignalViewer
              signal={previewSignal}
              viewport={viewport}
              cursorTimeSec={cursorTimeSec}
              onCursorTimeChange={setCursorTimeSec}
              initialHeight={80}
              mode="filled"
              color={{ stroke: "rgb(156, 163, 175)", fill: "rgba(156, 163, 175, 0.2)" }}
              showBeatGrid={beatGridVisible}
              audioDuration={audioDuration ?? 0}
            />
            {/* Threshold line overlay */}
            {viewport && (
              <div className="absolute inset-0 pointer-events-none">
                <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible">
                  {/* Adaptive threshold curve OR fixed threshold line */}
                  {algorithm === "adaptive" && adaptiveThresholdPath ? (
                    <>
                      {/* Adaptive threshold curve */}
                      <path
                        d={adaptiveThresholdPath}
                        fill="none"
                        stroke="rgb(168, 85, 247)"
                        strokeWidth={0.5}
                        strokeOpacity={0.8}
                        vectorEffect="non-scaling-stroke"
                      />
                      {/* Label */}
                      <text
                        x="1"
                        y="5"
                        fill="rgb(168, 85, 247)"
                        fontSize="3"
                        opacity={0.8}
                      >
                        adaptive threshold
                      </text>
                    </>
                  ) : (
                    <>
                      {/* Fixed threshold line */}
                      <line
                        x1="0"
                        y1={thresholdLinePercent}
                        x2="100"
                        y2={thresholdLinePercent}
                        stroke="rgb(239, 68, 68)"
                        strokeWidth={0.5}
                        strokeOpacity={0.7}
                        vectorEffect="non-scaling-stroke"
                      />
                      {/* Threshold label */}
                      <text
                        x="1"
                        y={thresholdLinePercent - 1}
                        fill="rgb(239, 68, 68)"
                        fontSize="3"
                        opacity={0.8}
                      >
                        threshold
                      </text>
                    </>
                  )}
                  {/* Hysteresis off-threshold line */}
                  {gatingMode === "hysteresis" && (
                    <>
                      <line
                        x1="0"
                        y1={hysteresisOffLinePercent}
                        x2="100"
                        y2={hysteresisOffLinePercent}
                        stroke="rgb(139, 92, 246)"
                        strokeWidth={0.5}
                        strokeDasharray="1 1"
                        strokeOpacity={0.6}
                        vectorEffect="non-scaling-stroke"
                      />
                      <text
                        x="1"
                        y={hysteresisOffLinePercent - 1}
                        fill="rgb(139, 92, 246)"
                        fontSize="3"
                        opacity={0.7}
                      >
                        off threshold
                      </text>
                    </>
                  )}
                  {/* Peak markers */}
                  {peakEvents.map((peak, i) => {
                    const visibleDuration = viewport.endTime - viewport.startTime;
                    if (visibleDuration <= 0) return null;
                    if (peak.time < viewport.startTime || peak.time > viewport.endTime) return null;
                    const x = ((peak.time - viewport.startTime) / visibleDuration) * 100;
                    return (
                      <line
                        key={i}
                        x1={x}
                        y1="0"
                        x2={x}
                        y2="100"
                        stroke="rgb(245, 158, 11)"
                        strokeWidth={1}
                        strokeOpacity={0.5 + peak.strength * 0.5}
                        vectorEffect="non-scaling-stroke"
                      />
                    );
                  })}
                </svg>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Slot for EventStreamEditor (child content) */}
      {children}

      {/* Import mode and action */}
      {peakResult && peakResult.times.length > 0 && (
        <div className="px-3 py-2 flex items-center gap-3 text-xs">
          {/* Mode toggle */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setImportMode("replace")}
              className={cn(
                "flex items-center gap-1 px-2 py-1 rounded",
                importMode === "replace"
                  ? "bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300"
                  : "text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
              )}
            >
              <Replace className="h-3 w-3" />
              Replace
            </button>
            <button
              type="button"
              onClick={() => setImportMode("merge")}
              className={cn(
                "flex items-center gap-1 px-2 py-1 rounded",
                importMode === "merge"
                  ? "bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300"
                  : "text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
              )}
            >
              <Merge className="h-3 w-3" />
              Merge
            </button>
          </div>

          {/* Dedupe threshold (only for merge) */}
          {importMode === "merge" && (
            <div className="flex items-center gap-2">
              <label className="text-zinc-500">Ignore within</label>
              <input
                type="number"
                value={dedupeThresholdMs}
                onChange={(e) => setDedupeThresholdMs(Math.max(0, parseInt(e.target.value) || 0))}
                className="w-14 h-6 px-1 text-center rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-900"
                min={0}
                max={1000}
              />
              <span className="text-zinc-500">ms of existing</span>
            </div>
          )}

          {/* Import button */}
          <Button
            size="sm"
            className="ml-auto h-7 bg-amber-600 hover:bg-amber-700 text-white"
            onClick={handleImport}
          >
            <Plus className="h-3 w-3 mr-1" />
            {importMode === "replace" ? "Replace Events" : "Add Events"}
          </Button>
        </div>
      )}

      {/* Empty state */}
      {availableSources.length === 0 && (
        <div className="px-3 py-3 text-xs text-zinc-500 italic">
          No 1D signals available. Run MIR analysis or create custom signals first.
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Main Panel Component
// ============================================================================

/**
 * Panel for Authored Event Streams.
 * Shows in main content area when event-streams section or a specific stream is selected.
 */
export function AuthoredEventsPanel() {
  const selectedNodeId = useInterpretationTreeStore((s) => s.selectedNodeId);
  const selectNode = useInterpretationTreeStore((s) => s.selectNode);
  const viewport = usePlaybackStore((s) => s.viewport);
  const setCursorTimeSec = usePlaybackStore((s) => s.setCursorTimeSec);
  const audioDuration = useAudioInputStore((s) => s.getAudioDuration());
  const beatGridVisible = useBeatGridStore((s) => s.isVisible);
  const mirroredCursorTimeSec = useMirroredCursorTime();

  const streams = useAuthoredEventStore(
    useShallow((s) => Array.from(s.streams.values()))
  );
  const { createManualStream } = useAuthoredEventActions();

  // Get the node type and stream ID
  const nodeType = useMemo(
    () => getInspectorNodeType(selectedNodeId),
    [selectedNodeId]
  );
  const streamId = useMemo(
    () => (selectedNodeId ? getAuthoredStreamId(selectedNodeId) : null),
    [selectedNodeId]
  );

  // Get stream from store
  const selectedStream = useAuthoredEventStore(
    useShallow((s) => (streamId ? s.streams.get(streamId) : undefined))
  );

  // Determine what to show
  const isEventStreamsSection =
    selectedNodeId === "event-streams" ||
    selectedNodeId === "event-streams:authored";
  const isStreamSelected = nodeType === "authored-stream" && streamId && selectedStream;

  // Don't render if not relevant
  if (!isEventStreamsSection && !isStreamSelected) {
    return null;
  }

  // Handle create new stream
  const handleCreateStream = () => {
    const newId = createManualStream(`Stream ${streams.length + 1}`);
    if (newId) {
      selectNode(`event-streams:authored:${newId}`);
    }
  };

  // Section view - show list of streams
  if (isEventStreamsSection) {
    return (
      <div className="border-b border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900/50 p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
            Authored Event Streams
          </h2>
          <Button size="sm" variant="outline" onClick={handleCreateStream}>
            <Plus className="h-4 w-4 mr-1" />
            Add Stream
          </Button>
        </div>

        {streams.length === 0 ? (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Event streams let you mark specific moments in time. Create a stream
            and add events manually or import them from 1D signals using peak detection.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {streams.map((stream) => (
              <button
                key={stream.id}
                type="button"
                onClick={() => selectNode(`event-streams:authored:${stream.id}`)}
                className={cn(
                  "px-3 py-1.5 text-sm rounded border transition-colors",
                  stream.isVisible ? "opacity-100" : "opacity-50",
                  "border-zinc-300 dark:border-zinc-600",
                  "bg-white dark:bg-zinc-800",
                  "hover:bg-zinc-100 dark:hover:bg-zinc-700"
                )}
              >
                {stream.name}
                <span className="ml-1.5 text-zinc-400">
                  ({stream.events.length})
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  // Stream view - show editor + import panel
  // Layout: Header → (SignalImportPanel: [signal preview] → [EventStreamEditor child] → [controls])
  if (isStreamSelected && streamId && selectedStream) {
    return (
      <div className="border-b border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900/50">
        {/* Stream name header */}
        <div className="px-3 py-2 border-b border-zinc-200 dark:border-zinc-700 flex items-center justify-between">
          <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
            {selectedStream.name}
          </span>
          <span className="text-xs text-zinc-400">
            {selectedStream.events.length} events
          </span>
        </div>

        {/* Signal import panel with EventStreamEditor as child (renders between signal preview and controls) */}
        <SignalImportPanel streamId={streamId} stream={selectedStream}>
          <EventStreamEditor
            streamId={streamId}
            viewport={viewport}
            cursorTimeSec={mirroredCursorTimeSec}
            onCursorTimeChange={setCursorTimeSec}
            audioDuration={audioDuration ?? 0}
            showBeatGrid={beatGridVisible}
          />
        </SignalImportPanel>
      </div>
    );
  }

  return null;
}
