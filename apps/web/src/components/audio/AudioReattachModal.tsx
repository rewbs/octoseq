"use client";

import { useCallback, useRef, useState } from "react";
import { FileAudio, Check, X, RefreshCw, AlertCircle } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { useProjectStore } from "@/lib/stores/projectStore";
import {
  MIXDOWN_STREAM_ID,
  isAudioStream,
  loadMixdown,
  replaceStreamAudio,
  runStreamAnalyses,
  useStreamStore,
  type AnalysisId,
  type AudioStream,
} from "@/lib/streams";
import type { AudioBufferLike } from "@octoseq/mir";

// All analyses to run after re-attaching audio
const ALL_ANALYSES: AnalysisId[] = [
  "amplitudeEnvelope",
  "spectralCentroid",
  "spectralFlux",
  "melSpectrogram",
  "onsetEnvelope",
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
  "pitchF0",
  "pitchConfidence",
  "activity",
];

interface AudioReattachModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Modal for re-attaching missing audio files when loading a project.
 * Lists all audio references and allows selecting replacement files.
 */
export function AudioReattachModal({ open, onOpenChange }: AudioReattachModalProps) {
  const project = useProjectStore((s) => s.activeProject);
  const audioLoadStatus = useProjectStore((s) => s.audioLoadStatus);
  const audioLoadErrors = useProjectStore((s) => s.audioLoadErrors);
  const setAudioLoadStatus = useProjectStore((s) => s.setAudioLoadStatus);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [activeRefId, setActiveRefId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // Get all audio streams (mixdown first, then stems in order)
  const audioRefs: AudioStream[] = (project?.streams ?? [])
    .filter(isAudioStream)
    .sort((a, b) => a.sortOrder - b.sortOrder);

  const handleSelectFile = useCallback((ref: AudioStream) => {
    setActiveRefId(ref.id);
    fileInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file || !activeRefId) return;

      setIsLoading(true);

      try {
        setAudioLoadStatus(activeRefId, "loading");

        // Decode the audio file
        const audioContext = new AudioContext();
        const arrayBuffer = await file.arrayBuffer();
        const audioBuffer = await audioContext.decodeAudioData(arrayBuffer.slice(0));
        await audioContext.close();

        // Create blob URL for playback
        const blob = new Blob([arrayBuffer], { type: file.type || "audio/wav" });
        const audioUrl = URL.createObjectURL(blob);

        // Create AudioBufferLike from decoded audio
        const bufferLike: AudioBufferLike = {
          sampleRate: audioBuffer.sampleRate,
          numberOfChannels: audioBuffer.numberOfChannels,
          getChannelData: (channel: number) => audioBuffer.getChannelData(channel),
        };

        if (activeRefId === MIXDOWN_STREAM_ID) {
          loadMixdown({
            audio: {
              origin: { kind: "file", fileName: file.name },
              url: audioUrl,
              fileName: file.name,
              durationSec: audioBuffer.duration,
              sampleRate: audioBuffer.sampleRate,
              channels: audioBuffer.numberOfChannels,
            },
            buffer: bufferLike,
            label: file.name,
          });
        } else {
          // For stems, replace the existing stream's audio
          const existingStem = useStreamStore.getState().getStream(activeRefId);
          if (existingStem && isAudioStream(existingStem)) {
            if (existingStem.audio.url) {
              URL.revokeObjectURL(existingStem.audio.url);
            }
            replaceStreamAudio(
              activeRefId,
              {
                ...existingStem.audio,
                origin: { kind: "file", fileName: file.name },
                url: audioUrl,
                fileName: file.name,
                durationSec: audioBuffer.duration,
                sampleRate: audioBuffer.sampleRate,
                channels: audioBuffer.numberOfChannels,
              },
              bufferLike
            );
          }
        }

        setAudioLoadStatus(activeRefId, "loaded");

        // Trigger MIR analyses for the re-attached audio
        runStreamAnalyses([activeRefId], ALL_ANALYSES);
      } catch (error) {
        console.error("Failed to load audio:", error);
        setAudioLoadStatus(
          activeRefId,
          "failed",
          error instanceof Error ? error.message : "Unknown error"
        );
      } finally {
        setIsLoading(false);
        setActiveRefId(null);
        if (fileInputRef.current) {
          fileInputRef.current.value = "";
        }
      }
    },
    [activeRefId, setAudioLoadStatus]
  );

  const getStatusIcon = (refId: string) => {
    const status = audioLoadStatus.get(refId);
    switch (status) {
      case "loaded":
        return <Check className="h-4 w-4 text-green-600 dark:text-green-400" />;
      case "loading":
        return <RefreshCw className="h-4 w-4 text-blue-600 dark:text-blue-400 animate-spin" />;
      case "failed":
        return <X className="h-4 w-4 text-red-600 dark:text-red-400" />;
      default:
        return <AlertCircle className="h-4 w-4 text-amber-600 dark:text-amber-400" />;
    }
  };

  const getStatusLabel = (refId: string) => {
    const status = audioLoadStatus.get(refId);
    const error = audioLoadErrors.get(refId);
    switch (status) {
      case "loaded":
        return "Loaded";
      case "loading":
        return "Loading...";
      case "failed":
        return error ? `Failed: ${error}` : "Failed";
      default:
        return "Missing";
    }
  };

  // Count still-missing audio
  const missingCount = audioRefs.filter((ref) => {
    const status = audioLoadStatus.get(ref.id);
    return !status || status === "pending" || status === "failed";
  }).length;

  return (
    <Modal title="Re-attach Audio Files" open={open} onOpenChange={onOpenChange}>
      <div className="space-y-4">
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Select replacement files for audio that could not be loaded from their original
          locations.
        </p>

        <div className="space-y-2 max-h-80 overflow-y-auto">
          {audioRefs.map((ref) => {
            const status = audioLoadStatus.get(ref.id);
            const isThisLoading = isLoading && activeRefId === ref.id;

            return (
              <div
                key={ref.id}
                className="flex items-center gap-3 p-3 rounded-md border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/50"
              >
                <div className="shrink-0">{getStatusIcon(ref.id)}</div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <FileAudio className="h-4 w-4 text-zinc-400 shrink-0" />
                    <span className="text-sm font-medium truncate">{ref.label}</span>
                    <span className="text-xs px-1.5 py-0.5 rounded bg-zinc-200 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-300 shrink-0">
                      {ref.kind}
                    </span>
                  </div>
                  <div className="text-xs text-zinc-500 dark:text-zinc-400 truncate mt-0.5">
                    {ref.audio.origin.kind === "file"
                      ? ref.audio.origin.fileName
                      : ref.audio.origin.kind === "url"
                        ? ref.audio.origin.fileName ?? ref.audio.origin.url
                        : "Unknown source"}
                  </div>
                  <div className="text-xs text-zinc-400 dark:text-zinc-500 mt-0.5">
                    {getStatusLabel(ref.id)}
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleSelectFile(ref)}
                  disabled={isThisLoading || status === "loading"}
                >
                  {status === "loaded" ? "Replace" : "Select File"}
                </Button>
              </div>
            );
          })}
        </div>

        <div className="flex items-center justify-between pt-2 border-t border-zinc-200 dark:border-zinc-700">
          <span className="text-sm text-zinc-500 dark:text-zinc-400">
            {missingCount === 0
              ? "All audio files loaded"
              : `${missingCount} file${missingCount > 1 ? "s" : ""} still missing`}
          </span>
          <Button onClick={() => onOpenChange(false)}>Done</Button>
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="audio/*"
        className="hidden"
        onChange={handleFileChange}
      />
    </Modal>
  );
}
