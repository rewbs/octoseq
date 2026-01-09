"use client";

import { useCallback, useMemo, useState, useEffect, useRef } from "react";
import { useShallow } from "zustand/react/shallow";
import { Plus, Sparkles, Loader2, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { pickPeaks, pickPeaksAdaptive, DEFAULT_PEAK_PICKING_PARAMS, type PeakPickingParams } from "@octoseq/mir";
import { useDerivedSignalStore } from "@/lib/stores/derivedSignalStore";
import { useBandMirStore } from "@/lib/stores/bandMirStore";
import { useFrequencyBandStore } from "@/lib/stores/frequencyBandStore";
import { useAuthoredEventStore } from "@/lib/stores/authoredEventStore";
import { useAuthoredEventActions } from "@/lib/stores/hooks/useAuthoredEventActions";
import { usePlaybackStore } from "@/lib/stores/playbackStore";
import { useAudioInputStore } from "@/lib/stores/audioInputStore";
import { useBeatGridStore } from "@/lib/stores/beatGridStore";
import { useMirroredCursorTime } from "@/lib/stores/hooks/useDerivedState";
import { SignalViewer, createContinuousSignal } from "@/components/wavesurfer/SignalViewer";
import type { AuthoredEventProvenance } from "@/lib/stores/types/authoredEvent";
import { cn } from "@/lib/utils";

/**
 * Available signal source types for event extraction.
 */
type SignalSource =
  | { kind: "customSignal"; signalId: string; name: string }
  | { kind: "bandEnvelope"; bandId: string; name: string };

/**
 * Peak picking algorithm choices.
 */
type PeakAlgorithm = "threshold" | "adaptive";

const PEAK_ALGORITHM_LABELS: Record<PeakAlgorithm, string> = {
  threshold: "Fixed Threshold",
  adaptive: "Adaptive",
};

const PEAK_ALGORITHM_DESCRIPTIONS: Record<PeakAlgorithm, string> = {
  threshold: "Detect peaks above a fixed threshold (0-100%)",
  adaptive: "Detect peaks relative to local context (better for varying signals)",
};

interface EventImportPanelProps {
  /** Called when panel should close */
  onClose?: () => void;
}

/**
 * Panel for creating event streams from 1D signals using peak picking.
 * Follows the CustomSignalsPanel pattern with live preview.
 */
export function EventImportPanel({ onClose }: EventImportPanelProps) {
  // Source selection
  const [selectedSourceKey, setSelectedSourceKey] = useState<string>("");

  // Peak picking algorithm and parameters
  const [algorithm, setAlgorithm] = useState<PeakAlgorithm>("threshold");
  const [threshold, setThreshold] = useState(DEFAULT_PEAK_PICKING_PARAMS.threshold);
  const [minDistance, setMinDistance] = useState(DEFAULT_PEAK_PICKING_PARAMS.minDistance);
  const [adaptiveWindow, setAdaptiveWindow] = useState(0.5); // seconds

  // New stream name
  const [newStreamName, setNewStreamName] = useState("");

  // Auto-detect toggle
  const [autoDetect, setAutoDetect] = useState(true);

  // Detection state
  const [isDetecting, setIsDetecting] = useState(false);

  // Playback state for preview
  const viewport = usePlaybackStore((s) => s.viewport);
  const audioDuration = useAudioInputStore((s) => s.getAudioDuration());
  const setCursorTimeSec = usePlaybackStore((s) => s.setCursorTimeSec);
  const cursorTimeSec = useMirroredCursorTime();
  const beatGridState = useBeatGridStore(
    useShallow((s) => ({
      isVisible: s.isVisible,
    }))
  );

  // Get available signals - use useShallow for array/object selectors to avoid infinite loops
  const derivedSignals = useDerivedSignalStore(
    useShallow((s) => s.structure?.signals ?? [])
  );
  const derivedSignalResults = useDerivedSignalStore((s) => s.resultCache);

  const bands = useFrequencyBandStore(
    useShallow((s) => s.structure?.bands ?? [])
  );
  const bandMirCache = useBandMirStore((s) => s.cache);

  const { createManualStream } = useAuthoredEventActions();

  // Build available sources list
  const availableSources = useMemo(() => {
    const sources: SignalSource[] = [];

    // Add computed custom signals
    for (const signal of derivedSignals) {
      if (derivedSignalResults.has(signal.id)) {
        sources.push({
          kind: "customSignal",
          signalId: signal.id,
          name: signal.name,
        });
      }
    }

    // Add band envelopes (amplitude)
    for (const band of bands) {
      const cacheKey = `${band.id}:bandAmplitudeEnvelope` as const;
      if (bandMirCache.has(cacheKey)) {
        sources.push({
          kind: "bandEnvelope",
          bandId: band.id,
          name: `${band.label} Amplitude`,
        });
      }
    }

    return sources;
  }, [derivedSignals, derivedSignalResults, bands, bandMirCache]);

  // Find selected source
  const selectedSource = useMemo(() => {
    if (!selectedSourceKey) return null;
    return availableSources.find((s) => {
      if (s.kind === "customSignal") return s.signalId === selectedSourceKey;
      return s.bandId === selectedSourceKey;
    }) ?? null;
  }, [selectedSourceKey, availableSources]);

  // Get signal data for selected source
  const signalData = useMemo(() => {
    if (!selectedSource) return null;

    if (selectedSource.kind === "customSignal") {
      const result = derivedSignalResults.get(selectedSource.signalId);
      if (!result) return null;
      return { times: result.times, values: result.values };
    } else {
      const cacheKey = `${selectedSource.bandId}:bandAmplitudeEnvelope` as const;
      const result = bandMirCache.get(cacheKey);
      if (!result) return null;
      return {
        times: result.times,
        values: result.values,
      };
    }
  }, [selectedSource, derivedSignalResults, bandMirCache]);

  // Compute peaks from signal (debounced via auto-detect)
  const detectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [peakResult, setPeakResult] = useState<{
    times: Float32Array;
    strengths: Float32Array;
  } | null>(null);

  const runDetection = useCallback(() => {
    if (!signalData) {
      setPeakResult(null);
      return;
    }

    setIsDetecting(true);

    // Run detection in next frame to allow UI update
    requestAnimationFrame(() => {
      const params: PeakPickingParams = {
        threshold,
        minDistance,
      };

      let result;
      if (algorithm === "adaptive") {
        // Convert window size from seconds to samples (approximate)
        // Assume ~100 samples per second as typical for MIR signals
        const windowSamples = Math.max(5, Math.round(adaptiveWindow * 100));
        result = pickPeaksAdaptive(signalData.times, signalData.values, windowSamples, params);
      } else {
        result = pickPeaks(signalData.times, signalData.values, params);
      }

      setPeakResult(result);
      setIsDetecting(false);
    });
  }, [signalData, algorithm, threshold, minDistance, adaptiveWindow]);

  // Auto-detect with debounce when parameters change
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
  }, [autoDetect, signalData, algorithm, threshold, minDistance, adaptiveWindow, runDetection]);

  // Handle source selection
  const handleSourceChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    const value = e.target.value;
    setSelectedSourceKey(value);
    setPeakResult(null);

    // Set default name
    const source = availableSources.find((s) => {
      if (s.kind === "customSignal") return s.signalId === value;
      return s.bandId === value;
    });
    if (source) {
      setNewStreamName(`${source.name} Peaks`);
    }
  }, [availableSources]);

  // Handle create new stream
  const handleCreateStream = useCallback(() => {
    if (!peakResult || peakResult.times.length === 0 || !newStreamName.trim()) {
      return;
    }

    // Create the stream
    const streamId = createManualStream(newStreamName.trim());
    if (!streamId) return;

    // Add events directly via store
    const now = new Date().toISOString();
    const events = [];
    for (let i = 0; i < peakResult.times.length; i++) {
      events.push({
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

    useAuthoredEventStore.getState().addEvents(streamId, events);

    // Reset state
    setSelectedSourceKey("");
    setNewStreamName("");
    setPeakResult(null);
    onClose?.();
  }, [peakResult, newStreamName, createManualStream, onClose]);

  // Create signal for preview with peak markers
  const previewSignal = useMemo(() => {
    if (!signalData) return null;
    return createContinuousSignal(signalData.times, signalData.values);
  }, [signalData]);

  // Create peak events for overlay display
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

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between px-3 pt-3">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-amber-500" />
          <span className="text-sm font-medium">Import Events from Signal</span>
        </div>
      </div>

      {/* Pipeline row: Source → Algorithm → Params */}
      <div className="flex flex-wrap items-center gap-1.5 px-3 py-2 border-y border-zinc-200 dark:border-zinc-700 text-xs text-zinc-500 dark:text-zinc-400 bg-zinc-50 dark:bg-zinc-900/50">
        <span className="text-zinc-400">From</span>
        <select
          value={selectedSourceKey}
          onChange={handleSourceChange}
          className="h-7 px-2 text-xs rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-900 dark:text-zinc-100"
        >
          <option value="">Select signal...</option>
          {availableSources.filter((s) => s.kind === "customSignal").length > 0 && (
            <optgroup label="Custom Signals">
              {availableSources
                .filter((s): s is SignalSource & { kind: "customSignal" } => s.kind === "customSignal")
                .map((source) => (
                  <option key={source.signalId} value={source.signalId}>
                    {source.name}
                  </option>
                ))}
            </optgroup>
          )}
          {availableSources.filter((s) => s.kind === "bandEnvelope").length > 0 && (
            <optgroup label="Band Envelopes">
              {availableSources
                .filter((s): s is SignalSource & { kind: "bandEnvelope" } => s.kind === "bandEnvelope")
                .map((source) => (
                  <option key={source.bandId} value={source.bandId}>
                    {source.name}
                  </option>
                ))}
            </optgroup>
          )}
        </select>

        {selectedSource && (
          <>
            <span className="text-zinc-400">→</span>
            <select
              value={algorithm}
              onChange={(e) => setAlgorithm(e.target.value as PeakAlgorithm)}
              title={PEAK_ALGORITHM_DESCRIPTIONS[algorithm]}
              className="h-7 px-2 text-xs rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-900 dark:text-zinc-100"
            >
              {(["threshold", "adaptive"] as const).map((alg) => (
                <option key={alg} value={alg}>
                  {PEAK_ALGORITHM_LABELS[alg]}
                </option>
              ))}
            </select>
            <span className="text-zinc-400">→</span>
            <span className="text-amber-600 dark:text-amber-400 font-medium">
              Events
            </span>
          </>
        )}
      </div>

      {/* Parameters row */}
      {selectedSource && (
        <div className="px-3 py-2 border-b border-zinc-200 dark:border-zinc-700 flex flex-wrap items-center gap-4">
          {/* Threshold slider */}
          <div className="flex items-center gap-2">
            <label className="text-xs text-zinc-500 dark:text-zinc-400 w-16">
              Threshold
            </label>
            <input
              type="range"
              value={threshold}
              onChange={(e) => setThreshold(parseFloat(e.target.value))}
              min={0.05}
              max={0.95}
              step={0.01}
              className="w-24 h-1.5 bg-zinc-200 dark:bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-amber-500"
            />
            <span className="text-xs text-zinc-600 dark:text-zinc-300 w-10 text-right font-mono">
              {(threshold * 100).toFixed(0)}%
            </span>
          </div>

          {/* Min distance slider */}
          <div className="flex items-center gap-2">
            <label className="text-xs text-zinc-500 dark:text-zinc-400 w-16">
              Min Gap
            </label>
            <input
              type="range"
              value={minDistance}
              onChange={(e) => setMinDistance(parseFloat(e.target.value))}
              min={0.02}
              max={0.5}
              step={0.01}
              className="w-24 h-1.5 bg-zinc-200 dark:bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-amber-500"
            />
            <span className="text-xs text-zinc-600 dark:text-zinc-300 w-12 text-right font-mono">
              {(minDistance * 1000).toFixed(0)}ms
            </span>
          </div>

          {/* Adaptive window (only for adaptive algorithm) */}
          {algorithm === "adaptive" && (
            <div className="flex items-center gap-2">
              <label className="text-xs text-zinc-500 dark:text-zinc-400 w-14">
                Window
              </label>
              <input
                type="range"
                value={adaptiveWindow}
                onChange={(e) => setAdaptiveWindow(parseFloat(e.target.value))}
                min={0.1}
                max={2.0}
                step={0.05}
                className="w-20 h-1.5 bg-zinc-200 dark:bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-amber-500"
              />
              <span className="text-xs text-zinc-600 dark:text-zinc-300 w-10 text-right font-mono">
                {adaptiveWindow.toFixed(2)}s
              </span>
            </div>
          )}

          {/* Auto-detect toggle and manual detect button */}
          <div className="flex items-center gap-2 ml-auto">
            <label className="flex items-center gap-1 cursor-pointer" title="Auto-detect when parameters change">
              <input
                type="checkbox"
                checked={autoDetect}
                onChange={(e) => setAutoDetect(e.target.checked)}
                className="w-3 h-3 accent-amber-500"
              />
              <span className="text-xs text-zinc-400">Auto</span>
            </label>
            <Button
              size="sm"
              variant="ghost"
              onClick={runDetection}
              disabled={isDetecting || !signalData}
              className="h-7 px-2"
            >
              {isDetecting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RotateCcw className="h-3.5 w-3.5" />
              )}
            </Button>
          </div>
        </div>
      )}

      {/* Signal preview with peak overlay */}
      {previewSignal && (
        <div className="px-3">
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-2 text-xs">
              <span className="text-zinc-600 dark:text-zinc-300 font-medium">
                {selectedSource?.name}
              </span>
              {peakResult && (
                <span className="text-amber-600 dark:text-amber-400">
                  {peakResult.times.length} peaks
                </span>
              )}
            </div>
          </div>
          <div className="relative">
            <SignalViewer
              signal={previewSignal}
              viewport={viewport}
              cursorTimeSec={cursorTimeSec}
              onCursorTimeChange={setCursorTimeSec}
              initialHeight={100}
              mode="filled"
              color={{ stroke: "rgb(156, 163, 175)", fill: "rgba(156, 163, 175, 0.2)" }}
              showBeatGrid={beatGridState.isVisible}
              audioDuration={audioDuration ?? 0}
            />
            {/* Peak markers overlay */}
            {peakEvents.length > 0 && viewport && (
              <div className="absolute inset-0 pointer-events-none">
                <svg width="100%" height="100%" className="overflow-visible">
                  {peakEvents.map((peak, i) => {
                    const visibleDuration = viewport.endTime - viewport.startTime;
                    if (visibleDuration <= 0) return null;
                    if (peak.time < viewport.startTime || peak.time > viewport.endTime) return null;
                    const x = ((peak.time - viewport.startTime) / visibleDuration) * 100;
                    return (
                      <line
                        key={i}
                        x1={`${x}%`}
                        y1="0"
                        x2={`${x}%`}
                        y2="100%"
                        stroke="rgb(245, 158, 11)"
                        strokeWidth={2}
                        strokeOpacity={0.5 + peak.strength * 0.5}
                      />
                    );
                  })}
                </svg>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Create Stream action */}
      {peakResult && peakResult.times.length > 0 && (
        <div className="px-3 pb-3 pt-2 border-t border-zinc-200 dark:border-zinc-700">
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={newStreamName}
              onChange={(e) => setNewStreamName(e.target.value)}
              placeholder="Stream name..."
              className="flex-1 h-8 px-2 text-sm rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 dark:text-zinc-100"
            />
            <Button
              size="sm"
              className={cn(
                "h-8",
                "bg-amber-600 hover:bg-amber-700",
                "text-white"
              )}
              onClick={handleCreateStream}
              disabled={!newStreamName.trim()}
            >
              <Plus className="h-4 w-4 mr-1" />
              Create Stream
            </Button>
          </div>
        </div>
      )}

      {/* Empty state */}
      {availableSources.length === 0 && (
        <div className="px-3 pb-3 text-xs text-zinc-500 italic">
          <p>To import events from a signal:</p>
          <ol className="list-decimal ml-4 mt-1 space-y-1">
            <li>Create and compute a Custom Signal, or</li>
            <li>Run band MIR analysis (amplitude envelope)</li>
          </ol>
        </div>
      )}
    </div>
  );
}
