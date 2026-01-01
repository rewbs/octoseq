"use client";

import { useCallback, useState } from "react";
import { Loader2, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getBandId } from "@/lib/nodeTypes";
import { useFrequencyBandStore } from "@/lib/stores/frequencyBandStore";
import { useBandMirActions } from "@/lib/stores/hooks/useBandMirActions";

interface BandInspectorProps {
  nodeId: string;
}

/**
 * Inspector view for an individual frequency band.
 * Shows band properties and MIR analysis controls.
 */
export function BandInspector({ nodeId }: BandInspectorProps) {
  const bandId = getBandId(nodeId);
  const getBandById = useFrequencyBandStore((s) => s.getBandById);
  const {
    runSingleBandAnalysis,
    runBandCqtAnalysis,
    runTypedEventExtraction,
  } = useBandMirActions();

  const [isRunningAll, setIsRunningAll] = useState(false);

  const band = bandId ? getBandById(bandId) : null;

  // Run all band MIR analyses for this band
  const handleRunAllAnalyses = useCallback(async () => {
    if (!bandId) return;

    setIsRunningAll(true);
    try {
      // Run STFT-based band MIR analyses
      await runSingleBandAnalysis(bandId, [
        "bandAmplitudeEnvelope",
        "bandOnsetStrength",
        "bandSpectralFlux",
        "bandSpectralCentroid",
      ]);

      // Run CQT-based band analyses
      await runBandCqtAnalysis([bandId], [
        "bandCqtHarmonicEnergy",
        "bandCqtBassPitchMotion",
        "bandCqtTonalStability",
      ]);

      // Extract events from the band signals
      await runTypedEventExtraction([bandId], [
        "bandOnsetPeaks",
        "bandBeatCandidates",
      ]);
    } catch (error) {
      console.error("Failed to run band analyses:", error);
    } finally {
      setIsRunningAll(false);
    }
  }, [bandId, runSingleBandAnalysis, runBandCqtAnalysis, runTypedEventExtraction]);

  if (!band) {
    return (
      <div className="p-4 text-sm text-zinc-500 dark:text-zinc-400">
        Band not found.
      </div>
    );
  }

  // Get frequency range from the band shape
  const firstSegment = band.frequencyShape[0];
  const lowHz = firstSegment?.lowHzStart ?? 0;
  const highHz = firstSegment?.highHzStart ?? 0;

  const formatHz = (hz: number) => {
    if (hz >= 1000) {
      return `${(hz / 1000).toFixed(1)}kHz`;
    }
    return `${Math.round(hz)}Hz`;
  };

  return (
    <div className="p-2 space-y-4">
      {/* Band Info */}
      <div className="space-y-2">
        <div className="text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wide">
          Band Info
        </div>
        <div className="text-sm space-y-1">
          <div className="flex justify-between">
            <span className="text-zinc-500 dark:text-zinc-400">Name</span>
            <span>{band.label}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-zinc-500 dark:text-zinc-400">Range</span>
            <span>{formatHz(lowHz)} - {formatHz(highHz)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-zinc-500 dark:text-zinc-400">Enabled</span>
            <span>{band.enabled ? "Yes" : "No"}</span>
          </div>
        </div>
      </div>

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
            disabled={isRunningAll}
            onClick={handleRunAllAnalyses}
          >
            {isRunningAll ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Play className="h-4 w-4 mr-2" />
            )}
            {isRunningAll ? "Running analyses..." : "Run All Analyses"}
          </Button>
        </div>
      </div>
    </div>
  );
}
