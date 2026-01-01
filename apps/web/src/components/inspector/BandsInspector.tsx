"use client";

import { useCallback, useState } from "react";
import { Loader2, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getAudioSourceId } from "@/lib/nodeTypes";
import { FrequencyBandContent } from "@/components/frequencyBand/FrequencyBandContent";
import { useAudioStore } from "@/lib/stores/audioStore";
import { useFrequencyBandStore } from "@/lib/stores/frequencyBandStore";
import { useBandMirActions } from "@/lib/stores/hooks/useBandMirActions";

interface BandsInspectorProps {
  nodeId: string;
}

/**
 * Inspector view for the Bands section under an audio source.
 * Shows band discovery and management controls.
 */
export function BandsInspector({ nodeId }: BandsInspectorProps) {
  const audioDuration = useAudioStore((s) => s.audioDuration);
  const sourceId = getAudioSourceId(nodeId) ?? "mixdown";
  const getBandsForSource = useFrequencyBandStore((s) => s.getBandsForSource);
  const {
    runBandAnalysis,
    runBandCqtAnalysis,
    runTypedEventExtraction,
  } = useBandMirActions();

  const [isRunningAll, setIsRunningAll] = useState(false);

  // Get all bands for this audio source
  const bands = getBandsForSource(sourceId);
  const bandIds = bands.map((b) => b.id);

  // Run all analyses for all bands under this source
  const handleRunAllBandAnalyses = useCallback(async () => {
    if (bandIds.length === 0) return;

    setIsRunningAll(true);
    try {
      // Run STFT-based band MIR analyses for all bands
      await runBandAnalysis(bandIds, [
        "bandAmplitudeEnvelope",
        "bandOnsetStrength",
        "bandSpectralFlux",
        "bandSpectralCentroid",
      ]);

      // Run CQT-based band analyses for all bands
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
    } catch (error) {
      console.error("Failed to run band analyses:", error);
    } finally {
      setIsRunningAll(false);
    }
  }, [bandIds, runBandAnalysis, runBandCqtAnalysis, runTypedEventExtraction]);

  return (
    <div className="p-2 space-y-4">
      {/* Actions Section */}
      {bands.length > 0 && (
        <div className="space-y-2">
          <div className="text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wide">
            Actions
          </div>
          <Button
            variant="outline"
            size="sm"
            className="w-full justify-start"
            disabled={isRunningAll}
            onClick={handleRunAllBandAnalyses}
          >
            {isRunningAll ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Play className="h-4 w-4 mr-2" />
            )}
            {isRunningAll ? "Running analyses..." : `Run All Band Analyses (${bands.length})`}
          </Button>
        </div>
      )}

      {/* Band Management */}
      <FrequencyBandContent
        audioDuration={audioDuration}
        sourceId={sourceId}
      />
    </div>
  );
}
