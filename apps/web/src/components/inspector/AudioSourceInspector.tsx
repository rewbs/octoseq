"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { Loader2, Pencil, Play, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  MIXDOWN_STREAM_ID,
  audioCache,
  isAudioStream,
  isBandStream,
  replaceStreamAudio,
  runStreamAnalyses,
  runStreamAnalysis,
  useStreamStore,
  type AnalysisId,
  type BandStream,
} from "@/lib/streams";

// All MIR analyses that can be run on an audio source
const ALL_MIR_ANALYSES: AnalysisId[] = [
  "amplitudeEnvelope",
  "onsetEnvelope",
  "spectralFlux",
  "spectralCentroid",
  "melSpectrogram",
  "onsetPeaks",
  "beatCandidates",
  "tempoHypotheses",
  "hpssHarmonic",
  "hpssPercussive",
  "mfcc",
  "mfccDelta",
  "mfccDeltaDelta",
  "cqtHarmonicEnergy",
  "cqtBassPitchMotion",
  "cqtTonalStability",
  // Pitch detection (P1)
  "pitchF0",
  "pitchConfidence",
];

// All analyses available on band streams (STFT, CQT, then events)
const ALL_BAND_ANALYSES: AnalysisId[] = [
  "amplitudeEnvelope",
  "onsetEnvelope",
  "spectralFlux",
  "spectralCentroid",
  "cqtHarmonicEnergy",
  "cqtBassPitchMotion",
  "cqtTonalStability",
  "onsetPeaks",
  "beatCandidates",
];

interface AudioSourceInspectorProps {
  sourceId: string;
}

/**
 * Inspector view for Mixdown or Stem audio sources.
 * Shows MIR analysis controls and stem replacement actions.
 */
export function AudioSourceInspector({ sourceId }: AudioSourceInspectorProps) {
  const streams = useStreamStore((s) => s.streams);
  const renameStream = useStreamStore((s) => s.renameStream);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const labelInputRef = useRef<HTMLInputElement>(null);
  const [isRunningAll, setIsRunningAll] = useState(false);
  const [isReplacing, setIsReplacing] = useState(false);
  const [isEditingLabel, setIsEditingLabel] = useState(false);
  const [editLabelValue, setEditLabelValue] = useState("");

  const isStem = sourceId !== MIXDOWN_STREAM_ID;
  const stream = streams.get(sourceId) ?? null;
  const hasAudio = stream != null && audioCache.has(sourceId);

  // Get bands for this audio source
  const bands = useMemo(
    () =>
      [...streams.values()]
        .filter((s): s is BandStream => isBandStream(s) && s.parentId === sourceId)
        .sort((a, b) => a.sortOrder - b.sortOrder),
    [streams, sourceId]
  );
  const bandIds = useMemo(() => bands.map((b) => b.id), [bands]);

  // Run all MIR analyses for this audio source and its bands
  const handleRunAllAnalyses = useCallback(async () => {
    if (!audioCache.has(sourceId)) return;

    setIsRunningAll(true);
    try {
      // First run audio source MIR analyses
      await runStreamAnalyses([sourceId], ALL_MIR_ANALYSES, { force: true });

      // Then cascade to band analyses if there are bands
      if (bandIds.length > 0) {
        await runStreamAnalyses(bandIds, ALL_BAND_ANALYSES);
      }
    } catch (error) {
      console.error("Failed to run analyses:", error);
    } finally {
      setIsRunningAll(false);
    }
  }, [sourceId, bandIds]);

  // Handle file selection for stem replacement
  const handleFileSelect = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file || !isStem) return;

      setIsReplacing(true);
      try {
        const audioContext = new AudioContext();
        const arrayBuffer = await file.arrayBuffer();
        const audioBuffer = await audioContext.decodeAudioData(arrayBuffer.slice(0));

        // Create blob URL for playback
        const blob = new Blob([arrayBuffer], { type: file.type });
        const audioUrl = URL.createObjectURL(blob);

        const current = useStreamStore.getState().getStream(sourceId);
        if (current && isAudioStream(current)) {
          // Revoke old blob URL if it exists
          if (current.audio.url) {
            URL.revokeObjectURL(current.audio.url);
          }

          // Replace the stem with new audio (invalidates the stream's analyses
          // and those of its dependent bands)
          replaceStreamAudio(
            sourceId,
            {
              ...current.audio,
              origin: { kind: "file", fileName: file.name },
              url: audioUrl,
              fileName: file.name,
              durationSec: audioBuffer.duration,
              sampleRate: audioBuffer.sampleRate,
              channels: audioBuffer.numberOfChannels,
            },
            {
              sampleRate: audioBuffer.sampleRate,
              numberOfChannels: audioBuffer.numberOfChannels,
              getChannelData: (channel: number) => audioBuffer.getChannelData(channel),
            }
          );

          // Run analyses on the replaced stem
          await runStreamAnalysis(sourceId, "onsetEnvelope");
          await runStreamAnalysis(sourceId, "spectralFlux");
        }
      } catch (error) {
        console.error("Failed to replace stem:", error);
      } finally {
        setIsReplacing(false);
        if (fileInputRef.current) {
          fileInputRef.current.value = "";
        }
      }
    },
    [isStem, sourceId]
  );

  const handleStartEditLabel = useCallback(() => {
    setEditLabelValue(stream?.label ?? "");
    setIsEditingLabel(true);
    // Focus the input after state update
    setTimeout(() => labelInputRef.current?.focus(), 0);
  }, [stream?.label]);

  const handleSaveLabel = useCallback(() => {
    const trimmed = editLabelValue.trim();
    if (trimmed && trimmed !== stream?.label) {
      renameStream(sourceId, trimmed);
    }
    setIsEditingLabel(false);
  }, [editLabelValue, stream?.label, renameStream, sourceId]);

  const handleCancelEditLabel = useCallback(() => {
    setIsEditingLabel(false);
    setEditLabelValue(stream?.label ?? "");
  }, [stream?.label]);

  return (
    <div className="p-2 space-y-4">
      {/* Label Section - for stems, show editable label */}
      {isStem && (
        <div className="space-y-2">
          <div className="text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wide">
            Label
          </div>
          {isEditingLabel ? (
            <Input
              ref={labelInputRef}
              type="text"
              value={editLabelValue}
              onChange={(e) => setEditLabelValue(e.target.value)}
              onBlur={handleSaveLabel}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSaveLabel();
                if (e.key === "Escape") handleCancelEditLabel();
              }}
              className="h-8 text-sm"
            />
          ) : (
            <button
              type="button"
              onClick={handleStartEditLabel}
              className="w-full flex items-center justify-between px-2 py-1.5 text-sm text-left rounded border border-transparent hover:border-zinc-300 dark:hover:border-zinc-600 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
            >
              <span className="truncate">{stream?.label}</span>
              <Pencil className="h-3 w-3 text-zinc-400 shrink-0 ml-2" />
            </button>
          )}
          <div className="text-xs text-zinc-400 dark:text-zinc-500">
            Use in scripts: inputs.stems[&quot;{stream?.label}&quot;]
          </div>
        </div>
      )}

      {/* Actions Section */}
      <div className="space-y-2">
        <div className="text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wide">
          Actions
        </div>
        <div className="flex flex-col gap-2">
          <Button
            variant="outline"
            size="sm"
            className="w-full justify-start"
            disabled={!hasAudio || isRunningAll}
            onClick={handleRunAllAnalyses}
          >
            {isRunningAll ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Play className="h-4 w-4 mr-2" />
            )}
            {isRunningAll
              ? "Running analyses..."
              : bands.length > 0
                ? `Run All Analyses (+${bands.length} bands)`
                : "Run All Analyses"}
          </Button>

          {isStem && (
            <>
              <Button
                variant="outline"
                size="sm"
                className="w-full justify-start"
                disabled={isReplacing}
                onClick={() => fileInputRef.current?.click()}
              >
                {isReplacing ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4 mr-2" />
                )}
                {isReplacing ? "Replacing..." : "Replace Stem"}
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept="audio/*"
                className="hidden"
                onChange={handleFileSelect}
              />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
