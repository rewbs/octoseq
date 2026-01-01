"use client";

import { useCallback, useRef, useState } from "react";
import { Loader2, Play, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAudioInputStore } from "@/lib/stores/audioInputStore";
import { useMirStore } from "@/lib/stores/mirStore";
import { useFrequencyBandStore } from "@/lib/stores/frequencyBandStore";
import { useMirActions } from "@/lib/stores/hooks/useMirActions";
import { useBandMirActions } from "@/lib/stores/hooks/useBandMirActions";
import { MIXDOWN_ID } from "@/lib/stores/types/audioInput";
import type { MirFunctionId } from "@/components/mir/MirControlPanel";

// All MIR analyses that can be run on an audio source
const ALL_MIR_ANALYSES: MirFunctionId[] = [
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
];

interface AudioSourceInspectorProps {
  sourceId: string;
}

/**
 * Inspector view for Mixdown or Stem audio sources.
 * Shows MIR analysis controls and stem replacement actions.
 */
export function AudioSourceInspector({ sourceId }: AudioSourceInspectorProps) {
  const getInputById = useAudioInputStore((s) => s.getInputById);
  const replaceStem = useAudioInputStore((s) => s.replaceStem);
  const invalidateInputMir = useMirStore((s) => s.invalidateInputMir);
  const getBandsForSource = useFrequencyBandStore((s) => s.getBandsForSource);
  const { runAnalysis } = useMirActions();
  const {
    runBandAnalysis,
    runBandCqtAnalysis,
    runTypedEventExtraction,
  } = useBandMirActions();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isRunningAll, setIsRunningAll] = useState(false);
  const [isReplacing, setIsReplacing] = useState(false);

  const isStem = sourceId !== MIXDOWN_ID;
  const audioInput = getInputById(sourceId);

  // Get bands for this audio source
  const bands = getBandsForSource(sourceId);
  const bandIds = bands.map((b) => b.id);

  // Run all MIR analyses for this audio source and its bands
  const handleRunAllAnalyses = useCallback(async () => {
    if (!audioInput?.audioBuffer) return;

    setIsRunningAll(true);
    try {
      // First run audio source MIR analyses
      for (const analysisId of ALL_MIR_ANALYSES) {
        await runAnalysis(analysisId, sourceId);
      }

      // Then cascade to band analyses if there are bands
      if (bandIds.length > 0) {
        // Run STFT-based band MIR analyses
        await runBandAnalysis(bandIds, [
          "bandAmplitudeEnvelope",
          "bandOnsetStrength",
          "bandSpectralFlux",
          "bandSpectralCentroid",
        ]);

        // Run CQT-based band analyses
        await runBandCqtAnalysis(bandIds, [
          "bandCqtHarmonicEnergy",
          "bandCqtBassPitchMotion",
          "bandCqtTonalStability",
        ]);

        // Extract events from the band signals
        await runTypedEventExtraction(bandIds, [
          "bandOnsetPeaks",
          "bandBeatCandidates",
        ]);
      }
    } catch (error) {
      console.error("Failed to run analyses:", error);
    } finally {
      setIsRunningAll(false);
    }
  }, [audioInput, runAnalysis, sourceId, bandIds, runBandAnalysis, runBandCqtAnalysis, runTypedEventExtraction]);

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

        // Invalidate old MIR results for this stem
        invalidateInputMir(sourceId);

        // Replace the stem with new audio
        replaceStem(sourceId, {
          audioBuffer: {
            sampleRate: audioBuffer.sampleRate,
            numberOfChannels: audioBuffer.numberOfChannels,
            getChannelData: (channel: number) => audioBuffer.getChannelData(channel),
          },
          metadata: {
            sampleRate: audioBuffer.sampleRate,
            totalSamples: audioBuffer.length,
            duration: audioBuffer.duration,
          },
          audioUrl,
        });

        // Run analyses on the replaced stem
        await runAnalysis("onsetEnvelope", sourceId);
        await runAnalysis("spectralFlux", sourceId);
      } catch (error) {
        console.error("Failed to replace stem:", error);
      } finally {
        setIsReplacing(false);
        if (fileInputRef.current) {
          fileInputRef.current.value = "";
        }
      }
    },
    [isStem, sourceId, replaceStem, invalidateInputMir, runAnalysis]
  );

  return (
    <div className="p-2 space-y-4">
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
            disabled={!audioInput?.audioBuffer || isRunningAll}
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
