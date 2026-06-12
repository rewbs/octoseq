"use client";

import { useCallback, useMemo, useState } from "react";
import { Loader2, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getAudioSourceId } from "@/lib/nodeTypes";
import { FrequencyBandContent } from "@/components/frequencyBand/FrequencyBandContent";
import {
  isAudioStream,
  isBandStream,
  runStreamAnalyses,
  useStreamStore,
  type BandStream,
} from "@/lib/streams";

interface BandsInspectorProps {
  nodeId: string;
}

/**
 * Inspector view for the Bands section under an audio source.
 * Shows band discovery and management controls.
 */
export function BandsInspector({ nodeId }: BandsInspectorProps) {
  const sourceId = getAudioSourceId(nodeId) ?? "mixdown";

  // Get the audio duration for this specific source
  const streams = useStreamStore((s) => s.streams);
  const audioDuration = useMemo(() => {
    const stream = streams.get(sourceId);
    return stream && isAudioStream(stream) ? stream.audio.durationSec : 0;
  }, [streams, sourceId]);

  const [isRunningAll, setIsRunningAll] = useState(false);

  // Get all bands for this audio source
  const bands = useMemo(
    () =>
      [...streams.values()]
        .filter((s): s is BandStream => isBandStream(s) && s.parentId === sourceId)
        .sort((a, b) => a.sortOrder - b.sortOrder),
    [streams, sourceId]
  );
  const bandIds = useMemo(() => bands.map((b) => b.id), [bands]);

  // Run all analyses for all bands under this source
  const handleRunAllBandAnalyses = useCallback(async () => {
    if (bandIds.length === 0) return;

    setIsRunningAll(true);
    try {
      // Run all band analyses (STFT, CQT, then event extraction — grouped by family)
      await runStreamAnalyses(bandIds, [
        "amplitudeEnvelope",
        "onsetEnvelope",
        "spectralFlux",
        "spectralCentroid",
        "cqtHarmonicEnergy",
        "cqtBassPitchMotion",
        "cqtTonalStability",
        "onsetPeaks",
        "beatCandidates",
      ]);
    } catch (error) {
      console.error("Failed to run band analyses:", error);
    } finally {
      setIsRunningAll(false);
    }
  }, [bandIds]);

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
