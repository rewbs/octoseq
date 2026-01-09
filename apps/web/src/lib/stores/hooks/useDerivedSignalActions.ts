import { useCallback } from "react";
import {
  reduce2DToSignal,
  hzToFeatureIndex,
  applyPolarity,
  stabilizeSignal,
  computePercentiles,
  applyTransformChain,
  eventsToSignal,
  type ReductionInput,
  type ReductionOptions,
  type MelConversionConfig,
  type StabilizationOptions,
  type TransformContext,
  type TransformStep,
  type EventWindowSpec,
  type EnvelopeShape,
} from "@octoseq/mir";
import { useMirStore } from "../mirStore";
import { useDerivedSignalStore } from "../derivedSignalStore";
import { useConfigStore } from "../configStore";
import { useProjectStore } from "../projectStore";
import { useAuthoredEventStore } from "../authoredEventStore";
import { useAudioInputStore } from "../audioInputStore";
import type {
  DerivedSignalDefinition,
  DerivedSignalResult,
  Source2DFunctionId,
  Source1DGlobalFunctionId,
  Source2D,
  Source1D,
  SourceEvents,
  EventWindow,
} from "../types/derivedSignal";
import type { MirFunctionId } from "@/components/mir/MirControlPanel";
import type { TimeAlignedHeatmapData } from "@/components/heatmap/TimeAlignedHeatmapPixi";
import {
  getCachedResult,
  setCachedResult,
  shouldCache,
  getDefinitionHash,
  invalidateSignal as invalidateSignalCache,
} from "@/lib/cache/derivedSignalCache";

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
 * Convert frequency range spec to bin range for 2D sources.
 */
function rangeSpec2DToBinRange(
  range: Source2D["range"],
  numBins: number,
  melConfig: MelConversionConfig | null
): { lowBin: number; highBin: number } | undefined {
  switch (range.kind) {
    case "fullSpectrum":
      return undefined; // Use all bins

    case "bandReference":
      // TODO: Look up band from frequencyBandStore and get Hz range
      // For now, fall back to full spectrum
      console.warn("Band reference not yet implemented for derived signals");
      return undefined;

    case "frequencyRange":
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
 * Build reduction options from 2D source reducer params.
 */
function buildReductionOptions(
  source: Source2D,
  binRange?: { lowBin: number; highBin: number }
): ReductionOptions {
  const params = source.reducerParams;
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
 * Map Source1DGlobalFunctionId to MirFunctionId.
 */
function source1DToMirFunction(source: Source1DGlobalFunctionId): MirFunctionId {
  switch (source) {
    case "amplitudeEnvelope":
      return "amplitudeEnvelope";
    case "spectralCentroid":
      return "spectralCentroid";
    case "spectralFlux":
      return "spectralFlux";
    case "onsetEnvelope":
      return "onsetEnvelope";
    case "cqtHarmonicEnergy":
      return "cqtHarmonicEnergy";
    case "cqtBassPitchMotion":
      return "cqtBassPitchMotion";
    case "cqtTonalStability":
      return "cqtTonalStability";
  }
}

/**
 * Convert TransformChain to MIR TransformStep array.
 * The types should match directly.
 */
function convertTransformChain(
  transforms: DerivedSignalDefinition["transforms"]
): TransformStep[] {
  return transforms as TransformStep[];
}

/**
 * Estimate sample rate from times array.
 */
function estimateSampleRate(times: Float32Array): number {
  if (times.length < 2) return 100; // Default
  const dt = times[1]! - times[0]!;
  return dt > 0 ? 1 / dt : 100;
}

/**
 * Hook that provides derived signal computation actions.
 */
export function useDerivedSignalActions() {
  /**
   * Compute a derived signal from a 2D source.
   */
  const compute2DSignal = useCallback(
    async (
      definition: DerivedSignalDefinition,
      source: Source2D
    ): Promise<DerivedSignalResult | null> => {
      const mirStore = useMirStore.getState();
      const configStore = useConfigStore.getState();

      // Get the 2D MIR result
      const mirFunctionId = source2DToMirFunction(source.functionId);
      const mirResult = mirStore.getInputMirResult(source.audioSourceId, mirFunctionId);

      if (!mirResult || mirResult.kind !== "2d") {
        console.warn(
          `No 2D MIR result available for ${source.audioSourceId}:${mirFunctionId}`
        );
        return null;
      }

      const heatmapData: TimeAlignedHeatmapData = mirResult.raw;

      // Get mel config for frequency conversion (only for mel-based sources)
      let melConfig: MelConversionConfig | null = null;
      if (isMelBased(source.functionId)) {
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
        console.warn("Empty 2D data for derived signal computation");
        return null;
      }

      // Convert range to bin range
      const binRange = rangeSpec2DToBinRange(source.range, numBins, melConfig);

      // Build reduction input
      const input: ReductionInput = {
        data: heatmapData.data,
        times: heatmapData.times,
      };

      // Build reduction options
      const options = buildReductionOptions(source, binRange);

      // Run reduction
      const reductionResult = reduce2DToSignal(input, source.reducer, options);

      // Estimate sample rate for transforms
      const sampleRate = estimateSampleRate(reductionResult.times);

      // Apply transform chain (if any)
      const transformContext: TransformContext = {
        sampleRate,
        times: reductionResult.times,
      };
      const transformSteps = convertTransformChain(definition.transforms);
      let transformedValues = transformSteps.length > 0
        ? applyTransformChain(reductionResult.values, transformSteps, transformContext)
        : reductionResult.values;

      // Apply polarity interpretation (after reduction, before stabilization)
      // Check if there's a polarity transform in the chain, otherwise default to signed
      const polarityTransform = definition.transforms.find((t) => t.kind === "polarity");
      const polarityMode = polarityTransform?.mode ?? "signed";
      let postReductionValues = applyPolarity(transformedValues, polarityMode);

      // Apply stabilization if configured
      const stabilization = definition.stabilization;
      const needsStabilization =
        stabilization &&
        (stabilization.mode !== "none" || stabilization.envelopeMode !== "raw");

      let finalValues = postReductionValues;
      let rawValues: Float32Array | undefined;

      if (needsStabilization && stabilization) {
        // Keep post-transform values for comparison
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
      const result: DerivedSignalResult = {
        definitionId: definition.id,
        status: "computed",
        times: reductionResult.times,
        values: finalValues,
        rawValues,
        valueRange: { min, max },
        percentileRange,
        computedAt: new Date().toISOString(),
      };

      return result;
    },
    []
  );

  /**
   * Compute a derived signal from a 1D source.
   */
  const compute1DSignal = useCallback(
    async (
      definition: DerivedSignalDefinition,
      source: Source1D
    ): Promise<DerivedSignalResult | null> => {
      const mirStore = useMirStore.getState();
      const derivedSignalStore = useDerivedSignalStore.getState();

      let sourceValues: Float32Array;
      let sourceTimes: Float32Array;

      // Get source data based on reference type
      switch (source.signalRef.type) {
        case "mir": {
          const mirFunctionId = source1DToMirFunction(source.signalRef.functionId);
          const mirResult = mirStore.getInputMirResult(
            source.signalRef.audioSourceId,
            mirFunctionId
          );
          if (!mirResult || mirResult.kind !== "1d") {
            console.warn(
              `No 1D MIR result available for ${source.signalRef.audioSourceId}:${mirFunctionId}`
            );
            return null;
          }
          sourceValues = mirResult.values;
          sourceTimes = mirResult.times;
          break;
        }

        case "band": {
          // TODO: Get band MIR result
          console.warn("Band 1D source not yet implemented");
          return null;
        }

        case "derived": {
          // Get from another derived signal (chaining)
          const sourceResult = derivedSignalStore.getSignalResult(source.signalRef.signalId);
          if (!sourceResult) {
            console.warn(
              `Source derived signal not computed: ${source.signalRef.signalId}`
            );
            return null;
          }
          sourceValues = sourceResult.values;
          sourceTimes = sourceResult.times;
          break;
        }

        default:
          return null;
      }

      // Estimate sample rate for transforms
      const sampleRate = estimateSampleRate(sourceTimes);

      // Apply transform chain
      const transformContext: TransformContext = {
        sampleRate,
        times: sourceTimes,
      };
      const transformSteps = convertTransformChain(definition.transforms);
      let transformedValues = transformSteps.length > 0
        ? applyTransformChain(sourceValues, transformSteps, transformContext)
        : new Float32Array(sourceValues);

      // Apply polarity
      const polarityTransform = definition.transforms.find((t) => t.kind === "polarity");
      const polarityMode = polarityTransform?.mode ?? "signed";
      let postTransformValues = applyPolarity(transformedValues, polarityMode);

      // Apply stabilization if configured
      const stabilization = definition.stabilization;
      const needsStabilization =
        stabilization &&
        (stabilization.mode !== "none" || stabilization.envelopeMode !== "raw");

      let finalValues = postTransformValues;
      let rawValues: Float32Array | undefined;

      if (needsStabilization && stabilization) {
        rawValues = postTransformValues;
        const stabOptions: StabilizationOptions = {
          mode: stabilization.mode,
          envelopeMode: stabilization.envelopeMode,
          attackTimeSec: stabilization.attackTime,
          releaseTimeSec: stabilization.releaseTime,
        };
        finalValues = stabilizeSignal(postTransformValues, sourceTimes, stabOptions);
      }

      // Compute value range
      let min = 0;
      let max = 0;
      if (finalValues.length > 0) {
        min = finalValues[0]!;
        max = finalValues[0]!;
        for (let i = 1; i < finalValues.length; i++) {
          const v = finalValues[i]!;
          if (v < min) min = v;
          if (v > max) max = v;
        }
      }

      // Compute percentile range
      const percentiles = computePercentiles(finalValues, [5, 95]);
      const percentileRange = {
        p5: percentiles[5] ?? min,
        p95: percentiles[95] ?? max,
      };

      return {
        definitionId: definition.id,
        status: "computed",
        times: sourceTimes,
        values: finalValues,
        rawValues,
        valueRange: { min, max },
        percentileRange,
        computedAt: new Date().toISOString(),
      };
    },
    []
  );

  /**
   * Compute a derived signal from events.
   */
  const computeEventSignal = useCallback(
    async (
      definition: DerivedSignalDefinition,
      source: SourceEvents
    ): Promise<DerivedSignalResult | null> => {
      const mirStore = useMirStore.getState();
      const authoredEventStore = useAuthoredEventStore.getState();
      const audioInputStore = useAudioInputStore.getState();

      // Get audio duration for signal generation
      const audioDuration = audioInputStore.getAudioDuration();
      if (audioDuration <= 0) {
        console.warn("No audio duration available for event signal");
        return null;
      }

      // Sample rate for event signals (use a reasonable default)
      const sampleRate = 100; // 100 Hz for event-derived signals

      // Gather events based on stream reference
      type EventItem = { time: number; weight?: number; duration?: number };
      let events: EventItem[] = [];

      switch (source.streamRef.type) {
        case "candidateOnsets": {
          // Get onset peaks from MIR results
          const onsetResult = mirStore.getInputMirResult(
            source.streamRef.audioSourceId,
            "onsetPeaks"
          );
          if (onsetResult && onsetResult.kind === "events") {
            events = onsetResult.events.map((e: { time: number; strength: number }) => ({
              time: e.time,
              weight: e.strength,
            }));
          }
          break;
        }

        case "candidateBeats": {
          // Get beat candidates from MIR results
          const beatResult = mirStore.getInputMirResult(
            source.streamRef.audioSourceId,
            "beatCandidates"
          );
          if (beatResult && beatResult.kind === "events") {
            events = beatResult.events.map((e: { time: number; strength: number }) => ({
              time: e.time,
              weight: e.strength,
            }));
          }
          break;
        }

        case "authoredEvents": {
          const stream = authoredEventStore.getStream(source.streamRef.streamId);
          if (stream) {
            events = stream.events.map((e) => ({
              time: e.time,
              weight: e.weight ?? 1,
              duration: e.duration ?? undefined, // Convert null to undefined
            }));
          }
          break;
        }

        case "bandOnsetPeaks":
        case "bandBeatCandidates": {
          // TODO: Implement band event sources
          console.warn("Band event sources not yet implemented");
          return null;
        }

        default:
          return null;
      }

      if (events.length === 0) {
        console.warn("No events found for event signal");
        // Continue with empty signal
      }

      // Build event-to-signal parameters
      // Convert EventWindow to EventWindowSpec (only "seconds" is supported in MIR)
      const eventWindow = source.reducerParams.window ?? { kind: "seconds", windowSize: 0.5 };
      const windowSpec: EventWindowSpec = eventWindow.kind === "seconds"
        ? { kind: "seconds", windowSize: eventWindow.windowSize }
        : { kind: "seconds", windowSize: 0.5 }; // Fallback for "beats"

      const eventShape = source.reducerParams.envelopeShape ?? {
        kind: "attackDecay",
        attackMs: 5,
        decayMs: 100,
      };
      const envelopeShape: EnvelopeShape = eventShape.kind === "impulse"
        ? { kind: "impulse" }
        : eventShape.kind === "gaussian"
          ? { kind: "gaussian", widthMs: eventShape.widthMs }
          : { kind: "attackDecay", attackMs: eventShape.attackMs, decayMs: eventShape.decayMs };

      // Convert events and run through reducer
      const eventResult = eventsToSignal(
        events,
        {
          reducer: source.reducer,
          window: windowSpec,
          envelopeShape,
        },
        {
          sampleRate,
          duration: audioDuration,
          normalize: false,
        }
      );

      // Apply transform chain
      const transformContext: TransformContext = {
        sampleRate,
        times: eventResult.times,
      };
      const transformSteps = convertTransformChain(definition.transforms);
      let transformedValues = transformSteps.length > 0
        ? applyTransformChain(eventResult.values, transformSteps, transformContext)
        : eventResult.values;

      // Apply polarity
      const polarityTransform = definition.transforms.find((t) => t.kind === "polarity");
      const polarityMode = polarityTransform?.mode ?? "signed";
      let postTransformValues = applyPolarity(transformedValues, polarityMode);

      // Apply stabilization if configured
      const stabilization = definition.stabilization;
      const needsStabilization =
        stabilization &&
        (stabilization.mode !== "none" || stabilization.envelopeMode !== "raw");

      let finalValues = postTransformValues;
      let rawValues: Float32Array | undefined;

      if (needsStabilization && stabilization) {
        rawValues = postTransformValues;
        const stabOptions: StabilizationOptions = {
          mode: stabilization.mode,
          envelopeMode: stabilization.envelopeMode,
          attackTimeSec: stabilization.attackTime,
          releaseTimeSec: stabilization.releaseTime,
        };
        finalValues = stabilizeSignal(postTransformValues, eventResult.times, stabOptions);
      }

      // Compute value range
      let min = 0;
      let max = 0;
      if (finalValues.length > 0) {
        min = finalValues[0]!;
        max = finalValues[0]!;
        for (let i = 1; i < finalValues.length; i++) {
          const v = finalValues[i]!;
          if (v < min) min = v;
          if (v > max) max = v;
        }
      }

      // Compute percentile range
      const percentiles = computePercentiles(finalValues, [5, 95]);
      const percentileRange = {
        p5: percentiles[5] ?? min,
        p95: percentiles[95] ?? max,
      };

      return {
        definitionId: definition.id,
        status: "computed",
        times: eventResult.times,
        values: finalValues,
        rawValues,
        valueRange: { min, max },
        percentileRange,
        computedAt: new Date().toISOString(),
      };
    },
    []
  );

  /**
   * Compute a single derived signal from its definition.
   */
  const computeSignal = useCallback(
    async (definition: DerivedSignalDefinition): Promise<DerivedSignalResult | null> => {
      const derivedSignalStore = useDerivedSignalStore.getState();
      const projectStore = useProjectStore.getState();

      // Check if already computing
      if (derivedSignalStore.computingSignalId === definition.id) {
        return null;
      }

      // Mark as computing
      derivedSignalStore.setComputingSignal(definition.id);

      try {
        let result: DerivedSignalResult | null = null;

        // Dispatch based on source kind
        switch (definition.source.kind) {
          case "2d":
            result = await compute2DSignal(definition, definition.source);
            break;

          case "1d":
            result = await compute1DSignal(definition, definition.source);
            break;

          case "events":
            result = await computeEventSignal(definition, definition.source);
            break;
        }

        if (result) {
          // Store in cache
          derivedSignalStore.setCachedResult(definition.id, result);

          // Sync to project
          const structure = derivedSignalStore.getStructureForProject();
          if (structure) {
            projectStore.syncDerivedSignals(structure);
          }
        }

        return result;
      } finally {
        // Clear computing state
        derivedSignalStore.setComputingSignal(null);
      }
    },
    [compute2DSignal, compute1DSignal, computeEventSignal]
  );

  /**
   * Compute all enabled derived signals.
   */
  const computeAllSignals = useCallback(async (): Promise<void> => {
    const derivedSignalStore = useDerivedSignalStore.getState();
    const enabledSignals = derivedSignalStore.getEnabledSignals();

    // Get computation order from dependency graph
    const computationOrder = derivedSignalStore.getComputationOrder();

    // Filter to only enabled signals, maintaining dependency order
    const enabledIds = new Set(enabledSignals.map((s) => s.id));
    const sortedSignalIds = computationOrder
      ? computationOrder.filter((id) => enabledIds.has(id))
      : enabledSignals.map((s) => s.id);

    for (const signalId of sortedSignalIds) {
      const definition = derivedSignalStore.getSignalById(signalId);
      if (!definition) continue;

      // Skip if already cached
      if (derivedSignalStore.getSignalResult(signalId)) {
        continue;
      }

      await computeSignal(definition);
    }
  }, [computeSignal]);

  /**
   * Recompute a specific signal (invalidate cache first).
   */
  const recomputeSignal = useCallback(
    async (signalId: string): Promise<DerivedSignalResult | null> => {
      const derivedSignalStore = useDerivedSignalStore.getState();
      const definition = derivedSignalStore.getSignalById(signalId);

      if (!definition) {
        return null;
      }

      // Invalidate cache (cascades to dependents)
      derivedSignalStore.invalidateResult(signalId);

      // Recompute
      return computeSignal(definition);
    },
    [computeSignal]
  );

  /**
   * Invalidate and recompute all signals.
   */
  const recomputeAllSignals = useCallback(async (): Promise<void> => {
    const derivedSignalStore = useDerivedSignalStore.getState();

    // Invalidate all
    derivedSignalStore.invalidateAllResults();

    // Recompute all enabled
    await computeAllSignals();
  }, [computeAllSignals]);

  /**
   * Add a new derived signal with default settings.
   */
  const addSignal = useCallback(
    (partial?: Partial<Omit<DerivedSignalDefinition, "id" | "createdAt" | "modifiedAt">>) => {
      const derivedSignalStore = useDerivedSignalStore.getState();
      const projectStore = useProjectStore.getState();

      const signalId = derivedSignalStore.addSignal(partial ?? {});

      // Sync to project
      const structure = derivedSignalStore.getStructureForProject();
      if (structure) {
        projectStore.syncDerivedSignals(structure);
      }

      return signalId;
    },
    []
  );

  /**
   * Update a derived signal definition.
   */
  const updateSignal = useCallback(
    (id: string, updates: Partial<Omit<DerivedSignalDefinition, "id">>) => {
      const derivedSignalStore = useDerivedSignalStore.getState();
      const projectStore = useProjectStore.getState();

      derivedSignalStore.updateSignal(id, updates);

      // Sync to project
      const structure = derivedSignalStore.getStructureForProject();
      if (structure) {
        projectStore.syncDerivedSignals(structure);
      }
    },
    []
  );

  /**
   * Remove a derived signal.
   */
  const removeSignal = useCallback((id: string) => {
    const derivedSignalStore = useDerivedSignalStore.getState();
    const projectStore = useProjectStore.getState();

    derivedSignalStore.removeSignal(id);

    // Sync to project
    const structure = derivedSignalStore.getStructureForProject();
    projectStore.syncDerivedSignals(structure);
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
