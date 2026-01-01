import { useCallback } from "react";
import {
  reduce2DToSignal,
  hzToFeatureIndex,
  applyPolarity,
  stabilizeSignal,
  computePercentiles,
  type ReductionInput,
  type ReductionOptions,
  type MelConversionConfig,
  type StabilizationOptions,
} from "@octoseq/mir";
import { useMirStore } from "../mirStore";
import { useCustomSignalStore } from "../customSignalStore";
import { useConfigStore } from "../configStore";
import { useProjectStore } from "../projectStore";
import type {
  CustomSignalDefinition,
  CustomSignalResult,
  Source2DFunctionId,
  FrequencyRangeSpec,
  ReductionAlgorithmParams,
} from "../types/customSignal";
import type { MirFunctionId } from "@/components/mir/MirControlPanel";
import type { TimeAlignedHeatmapData } from "@/components/heatmap/TimeAlignedHeatmapPixi";

/**
 * Map Source2DFunctionId to MirFunctionId.
 * They happen to be the same but we keep this explicit for type safety.
 */
function source2DToMirFunction(source: Source2DFunctionId): MirFunctionId {
  switch (source) {
    case "melSpectrogram":
      return "melSpectrogram";
    case "hpssHarmonic":
      return "hpssHarmonic";
    case "hpssPercussive":
      return "hpssPercussive";
    case "mfcc":
      return "mfcc";
    case "mfccDelta":
      return "mfccDelta";
    case "mfccDeltaDelta":
      return "mfccDeltaDelta";
  }
}

/**
 * Check if source is mel-based (uses Hz for frequency range).
 */
function isMelBased(source: Source2DFunctionId): boolean {
  return (
    source === "melSpectrogram" ||
    source === "hpssHarmonic" ||
    source === "hpssPercussive"
  );
}

/**
 * Convert frequency range spec to bin range.
 */
function frequencyRangeToBinRange(
  range: FrequencyRangeSpec,
  numBins: number,
  melConfig: MelConversionConfig | null
): { lowBin: number; highBin: number } | undefined {
  switch (range.kind) {
    case "fullSpectrum":
      return undefined; // Use all bins

    case "bandReference":
      // TODO: Look up band from frequencyBandStore and get Hz range
      // For now, fall back to full spectrum
      console.warn("Band reference not yet implemented for custom signals");
      return undefined;

    case "custom":
      if (!melConfig) {
        // Can't convert Hz to bins without mel config
        return undefined;
      }
      const lowIndex = hzToFeatureIndex(range.lowHz, melConfig);
      const highIndex = hzToFeatureIndex(range.highHz, melConfig);
      return {
        lowBin: Math.max(0, Math.floor(lowIndex)),
        highBin: Math.min(numBins, Math.ceil(highIndex)),
      };

    case "coefficientRange":
      // Direct coefficient indices (for MFCC)
      return {
        lowBin: Math.max(0, range.lowCoef),
        highBin: Math.min(numBins, range.highCoef),
      };
  }
}

/**
 * Build reduction options from algorithm params.
 */
function buildReductionOptions(
  params: ReductionAlgorithmParams,
  binRange?: { lowBin: number; highBin: number }
): ReductionOptions {
  return {
    binRange: binRange
      ? { lowBin: binRange.lowBin, highBin: binRange.highBin }
      : undefined,
    onsetStrength: {
      smoothMs: params.smoothMs ?? 10,
      useLog: params.useLog ?? true,
      diffMethod: params.diffMethod ?? "rectified",
    },
    spectralFlux: {
      normalized: params.normalized ?? true,
    },
  };
}

/**
 * Hook that provides custom signal computation actions.
 */
export function useCustomSignalActions() {
  /**
   * Compute a single custom signal from its definition.
   */
  const computeSignal = useCallback(async (definition: CustomSignalDefinition): Promise<CustomSignalResult | null> => {
    const mirStore = useMirStore.getState();
    const customSignalStore = useCustomSignalStore.getState();
    const configStore = useConfigStore.getState();
    const projectStore = useProjectStore.getState();

    // Check if already computing
    if (customSignalStore.computingSignalId === definition.id) {
      return null;
    }

    // Mark as computing
    customSignalStore.setComputingSignal(definition.id);

    try {
      // Get the 2D MIR result
      const mirFunctionId = source2DToMirFunction(definition.source2DFunction);
      const mirResult = mirStore.getInputMirResult(definition.sourceAudioId, mirFunctionId);

      if (!mirResult || mirResult.kind !== "2d") {
        console.warn(
          `No 2D MIR result available for ${definition.sourceAudioId}:${mirFunctionId}`
        );
        return null;
      }

      const heatmapData: TimeAlignedHeatmapData = mirResult.raw;

      // Get mel config for frequency conversion (only for mel-based sources)
      let melConfig: MelConversionConfig | null = null;
      if (isMelBased(definition.source2DFunction)) {
        const cfg = configStore.getMelConfig();
        melConfig = {
          nMels: cfg.nMels,
          fMin: cfg.fMin ?? 20,
          fMax: cfg.fMax ?? 8000,
        };
      }

      // Determine number of bins from first frame
      const numBins = heatmapData.data[0]?.length ?? 0;
      if (numBins === 0) {
        console.warn("Empty 2D data for custom signal computation");
        return null;
      }

      // Convert frequency range to bin range
      const binRange = frequencyRangeToBinRange(
        definition.frequencyRange,
        numBins,
        melConfig
      );

      // Build reduction input
      const input: ReductionInput = {
        data: heatmapData.data,
        times: heatmapData.times,
      };

      // Build reduction options
      const options = buildReductionOptions(definition.algorithmParams, binRange);

      // Run reduction
      const reductionResult = reduce2DToSignal(
        input,
        definition.reductionAlgorithm,
        options
      );

      // Apply polarity interpretation (after reduction, before stabilization)
      const polarityMode = definition.polarityMode ?? "signed";
      let postReductionValues = applyPolarity(reductionResult.values, polarityMode);

      // Apply stabilization if configured
      const stabilization = definition.stabilization;
      const needsStabilization =
        stabilization &&
        (stabilization.mode !== "none" || stabilization.envelopeMode !== "raw");

      let finalValues = postReductionValues;
      let rawValues: Float32Array | undefined;

      if (needsStabilization && stabilization) {
        // Keep post-reduction (pre-stabilization) values for comparison
        rawValues = postReductionValues;

        // Build stabilization options
        const stabOptions: StabilizationOptions = {
          mode: stabilization.mode,
          envelopeMode: stabilization.envelopeMode,
          attackTimeSec: stabilization.attackTime,
          releaseTimeSec: stabilization.releaseTime,
        };

        // Apply stabilization
        finalValues = stabilizeSignal(
          postReductionValues,
          reductionResult.times,
          stabOptions
        );
      }

      // Compute value range for stabilized signal
      let min = finalValues[0] ?? 0;
      let max = finalValues[0] ?? 0;
      for (let i = 1; i < finalValues.length; i++) {
        const v = finalValues[i] ?? 0;
        if (v < min) min = v;
        if (v > max) max = v;
      }

      // Compute percentile range
      const percentiles = computePercentiles(finalValues, [5, 95]);
      const percentileRange = {
        p5: percentiles[5] ?? min,
        p95: percentiles[95] ?? max,
      };

      // Create result
      const result: CustomSignalResult = {
        definitionId: definition.id,
        times: reductionResult.times,
        values: finalValues,
        rawValues,
        valueRange: { min, max },
        percentileRange,
        computedAt: new Date().toISOString(),
      };

      // Store in cache
      customSignalStore.setCachedResult(definition.id, result);

      // Sync to project
      const structure = customSignalStore.getStructureForProject();
      if (structure) {
        projectStore.syncCustomSignals(structure);
      }

      return result;
    } finally {
      // Clear computing state
      customSignalStore.setComputingSignal(null);
    }
  }, []);

  /**
   * Compute all enabled custom signals.
   */
  const computeAllSignals = useCallback(async (): Promise<void> => {
    const customSignalStore = useCustomSignalStore.getState();
    const enabledSignals = customSignalStore.getEnabledSignals();

    for (const definition of enabledSignals) {
      // Skip if already cached
      if (customSignalStore.getSignalResult(definition.id)) {
        continue;
      }

      await computeSignal(definition);
    }
  }, [computeSignal]);

  /**
   * Recompute a specific signal (invalidate cache first).
   */
  const recomputeSignal = useCallback(
    async (signalId: string): Promise<CustomSignalResult | null> => {
      const customSignalStore = useCustomSignalStore.getState();
      const definition = customSignalStore.getSignalById(signalId);

      if (!definition) {
        return null;
      }

      // Invalidate cache
      customSignalStore.invalidateResult(signalId);

      // Recompute
      return computeSignal(definition);
    },
    [computeSignal]
  );

  /**
   * Invalidate and recompute all signals.
   */
  const recomputeAllSignals = useCallback(async (): Promise<void> => {
    const customSignalStore = useCustomSignalStore.getState();

    // Invalidate all
    customSignalStore.invalidateAllResults();

    // Recompute all enabled
    await computeAllSignals();
  }, [computeAllSignals]);

  /**
   * Add a new custom signal with default settings.
   */
  const addSignal = useCallback(
    (partial?: Partial<Omit<CustomSignalDefinition, "id" | "createdAt" | "modifiedAt">>) => {
      const customSignalStore = useCustomSignalStore.getState();
      const projectStore = useProjectStore.getState();

      const signalId = customSignalStore.addSignal(partial ?? {});

      // Sync to project
      const structure = customSignalStore.getStructureForProject();
      if (structure) {
        projectStore.syncCustomSignals(structure);
      }

      return signalId;
    },
    []
  );

  /**
   * Update a custom signal definition.
   */
  const updateSignal = useCallback(
    (id: string, updates: Partial<Omit<CustomSignalDefinition, "id">>) => {
      const customSignalStore = useCustomSignalStore.getState();
      const projectStore = useProjectStore.getState();

      customSignalStore.updateSignal(id, updates);

      // Sync to project
      const structure = customSignalStore.getStructureForProject();
      if (structure) {
        projectStore.syncCustomSignals(structure);
      }
    },
    []
  );

  /**
   * Remove a custom signal.
   */
  const removeSignal = useCallback((id: string) => {
    const customSignalStore = useCustomSignalStore.getState();
    const projectStore = useProjectStore.getState();

    customSignalStore.removeSignal(id);

    // Sync to project
    const structure = customSignalStore.getStructureForProject();
    projectStore.syncCustomSignals(structure);
  }, []);

  /**
   * Check if source 2D data is available for a signal.
   */
  const isSourceDataAvailable = useCallback(
    (sourceAudioId: string, source2D: Source2DFunctionId): boolean => {
      const mirStore = useMirStore.getState();
      const mirFunctionId = source2DToMirFunction(source2D);
      const result = mirStore.getInputMirResult(sourceAudioId, mirFunctionId);
      return result !== null && result.kind === "2d";
    },
    []
  );

  /**
   * Get the 2D data for preview.
   */
  const getSource2DData = useCallback(
    (
      sourceAudioId: string,
      source2D: Source2DFunctionId
    ): TimeAlignedHeatmapData | null => {
      const mirStore = useMirStore.getState();
      const mirFunctionId = source2DToMirFunction(source2D);
      const result = mirStore.getInputMirResult(sourceAudioId, mirFunctionId);

      if (result && result.kind === "2d") {
        return result.raw;
      }

      return null;
    },
    []
  );

  return {
    // Computation
    computeSignal,
    computeAllSignals,
    recomputeSignal,
    recomputeAllSignals,

    // CRUD
    addSignal,
    updateSignal,
    removeSignal,

    // Queries
    isSourceDataAvailable,
    getSource2DData,
  };
}
