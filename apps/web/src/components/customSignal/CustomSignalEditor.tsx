"use client";

import { useState } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useCustomSignalStore } from "@/lib/stores/customSignalStore";
import { useCustomSignalActions } from "@/lib/stores/hooks/useCustomSignalActions";
import { useFrequencyBandStore } from "@/lib/stores/frequencyBandStore";
import {
  sourceUsesCoefficientRange,
  SOURCE_2D_LABELS,
  REDUCTION_ALGORITHM_LABELS,
  STABILIZATION_MODE_LABELS,
  ENVELOPE_MODE_LABELS,
  type CustomSignalDefinition,
} from "@/lib/stores/types/customSignal";

interface CustomSignalEditorProps {
  signal: CustomSignalDefinition;
}

/**
 * Read-only display of a custom signal's configuration.
 * Editing is done in the main CustomSignalsPanel.
 */
export function CustomSignalEditor({ signal }: CustomSignalEditorProps) {
  const resultCache = useCustomSignalStore((s) => s.resultCache);
  const { removeSignal, isSourceDataAvailable } = useCustomSignalActions();
  const bandStructure = useFrequencyBandStore((s) => s.structure);

  const [isDeleting, setIsDeleting] = useState(false);

  const hasResult = resultCache.has(signal.id);
  const sourceAvailable = isSourceDataAvailable(
    signal.sourceAudioId,
    signal.source2DFunction
  );

  const handleDelete = () => {
    if (isDeleting) {
      removeSignal(signal.id);
    } else {
      setIsDeleting(true);
      // Reset after 3 seconds if not confirmed
      setTimeout(() => setIsDeleting(false), 3000);
    }
  };

  // Format frequency range for display
  const formatFrequencyRange = (): string => {
    const range = signal.frequencyRange;
    switch (range.kind) {
      case "fullSpectrum":
        return "Full Spectrum";
      case "bandReference": {
        const band = bandStructure?.bands.find((b) => b.id === range.bandId);
        return band ? `Band: ${band.label}` : "Band (not found)";
      }
      case "custom":
        return `${range.lowHz} Hz - ${range.highHz} Hz`;
      case "coefficientRange":
        return `C${range.lowCoef} - C${range.highCoef}`;
    }
  };

  // Get range label based on source type
  const rangeLabel = sourceUsesCoefficientRange(signal.source2DFunction)
    ? "Coefficients"
    : "Frequency Range";

  return (
    <div className="space-y-3">
      {/* Signal name */}
      <div>
        <div className="text-xs text-zinc-500 dark:text-zinc-400 mb-0.5">Name</div>
        <div className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
          {signal.name}
        </div>
      </div>

      {/* Configuration summary */}
      <div className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <div className="text-xs text-zinc-500 dark:text-zinc-400 mb-0.5">Audio Source</div>
          <div className="text-zinc-700 dark:text-zinc-300">
            {signal.sourceAudioId === "mixdown" ? "Mixdown" : signal.sourceAudioId}
          </div>
        </div>

        <div>
          <div className="text-xs text-zinc-500 dark:text-zinc-400 mb-0.5">2D Source</div>
          <div className="text-zinc-700 dark:text-zinc-300">
            {SOURCE_2D_LABELS[signal.source2DFunction]}
          </div>
        </div>

        <div>
          <div className="text-xs text-zinc-500 dark:text-zinc-400 mb-0.5">{rangeLabel}</div>
          <div className="text-zinc-700 dark:text-zinc-300">
            {formatFrequencyRange()}
          </div>
        </div>

        <div>
          <div className="text-xs text-zinc-500 dark:text-zinc-400 mb-0.5">Algorithm</div>
          <div className="text-zinc-700 dark:text-zinc-300">
            {REDUCTION_ALGORITHM_LABELS[signal.reductionAlgorithm]}
          </div>
        </div>
      </div>

      {/* Stabilization provenance */}
      {signal.stabilization && (
        <div className="pt-2 border-t border-zinc-200 dark:border-zinc-700">
          <div className="text-xs text-zinc-500 dark:text-zinc-400 mb-1.5">Stabilization</div>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div>
              <div className="text-xs text-zinc-400 mb-0.5">Noise Reduction</div>
              <div className="text-zinc-700 dark:text-zinc-300">
                {STABILIZATION_MODE_LABELS[signal.stabilization.mode]}
              </div>
            </div>
            <div>
              <div className="text-xs text-zinc-400 mb-0.5">Envelope</div>
              <div className="text-zinc-700 dark:text-zinc-300">
                {ENVELOPE_MODE_LABELS[signal.stabilization.envelopeMode]}
              </div>
            </div>
            {signal.stabilization.envelopeMode === "attackRelease" && (
              <>
                <div>
                  <div className="text-xs text-zinc-400 mb-0.5">Attack</div>
                  <div className="text-zinc-700 dark:text-zinc-300">
                    {signal.stabilization.attackTime ?? 0.01}
                    {signal.stabilization.timeUnit === "beats" ? " beats" : " sec"}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-zinc-400 mb-0.5">Release</div>
                  <div className="text-zinc-700 dark:text-zinc-300">
                    {signal.stabilization.releaseTime ?? 0.1}
                    {signal.stabilization.timeUnit === "beats" ? " beats" : " sec"}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Status indicators */}
      <div className="flex items-center gap-3 text-xs">
        <div className={signal.enabled ? "text-green-600 dark:text-green-400" : "text-zinc-400"}>
          {signal.enabled ? "Enabled" : "Disabled"}
        </div>
        <div className={hasResult ? "text-green-600 dark:text-green-400" : "text-zinc-500 dark:text-zinc-400"}>
          {hasResult ? "Computed" : "Not computed"}
        </div>
        {!sourceAvailable && (
          <div className="text-amber-600 dark:text-amber-400">
            Source unavailable
          </div>
        )}
      </div>

      {/* Timestamps */}
      <div className="text-xs text-zinc-400 dark:text-zinc-500 pt-2 border-t border-zinc-200 dark:border-zinc-700">
        <div>Created: {new Date(signal.createdAt).toLocaleString()}</div>
        <div>Modified: {new Date(signal.modifiedAt).toLocaleString()}</div>
      </div>

      {/* Delete action */}
      <div className="pt-2">
        <Button
          size="sm"
          variant={isDeleting ? "destructive" : "outline"}
          onClick={handleDelete}
          className="w-full"
        >
          <Trash2 className="h-4 w-4 mr-1" />
          {isDeleting ? "Click again to confirm delete" : "Delete Signal"}
        </Button>
      </div>
    </div>
  );
}
