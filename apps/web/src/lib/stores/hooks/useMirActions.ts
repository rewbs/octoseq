import { useCallback, useRef } from "react";
import type { AudioBufferLike, MirAudioPayload, MirRunRequest, MirResult as MirLibResult, MirFunctionId as MirLibFunctionId } from "@octoseq/mir";
import { normaliseForWaveform } from "@octoseq/mir";
import { runMir } from "@octoseq/mir/runner/runMir";
import { useAudioInputStore } from "../audioInputStore";
import { useMirStore } from "../mirStore";
import { useConfigStore } from "../configStore";
import { MirWorkerClient, type MirWorkerJob } from "@/lib/mirWorkerClient";
import type { UiMirResult } from "../types";
import type { MirFunctionId } from "@/components/mir/MirControlPanel";
import { MIXDOWN_ID } from "../types/audioInput";

/**
 * Hook that provides MIR analysis actions with worker management.
 */
export function useMirActions() {
  const workerRef = useRef<MirWorkerClient | null>(null);
  const activeJobRef = useRef<MirWorkerJob | null>(null);

  // Lazy init worker
  if (!workerRef.current && typeof window !== "undefined") {
    workerRef.current = new MirWorkerClient();
  }

  /**
   * Run MIR analysis.
   * @param fnOverride - Optional function ID to run (defaults to mirStore.selected)
   * @param inputId - Optional input ID to analyze (defaults to mixdown/main audio)
   * @param cacheKey - Optional cache key for storing results (defaults to inputId). Used for bands.
   */
  const runAnalysis = useCallback(async (fnOverride?: MirFunctionId, inputId?: string, cacheKey?: string) => {
    // Determine which audio to analyze
    const effectiveInputId = inputId ?? MIXDOWN_ID;
    // Use cacheKey if provided, otherwise use the input ID
    const effectiveCacheKey = cacheKey ?? effectiveInputId;
    let audio: AudioBufferLike | null = null;

    // Get audio from audioInputStore (works for both stems and mixdowns)
    const audioInputStore = useAudioInputStore.getState();
    const audioInput = audioInputStore.getInputById(effectiveInputId);
    if (audioInput?.audioBuffer) {
      audio = audioInput.audioBuffer;
    } else if (effectiveInputId === MIXDOWN_ID) {
      // Convenience fallback for mixdown
      audio = audioInputStore.getAudio();
    }

    if (!audio) return;

    const mirStore = useMirStore.getState();
    const configStore = useConfigStore.getState();

    const selected = fnOverride ?? mirStore.selected;
    const { useWorker, enableGpu, debug } = configStore;

    const spectrogramConfig = configStore.getSpectrogramConfig();
    const melConfig = configStore.getMelConfig();
    const onsetConfig = configStore.getOnsetConfig();
    const peakPickConfig = configStore.getPeakPickConfig();
    const hpssConfig = configStore.getHpssConfig();
    const mfccConfig = configStore.getMfccConfig();
    const tempoHypothesesConfig = configStore.getTempoHypothesesConfig();
    const cqtConfig = configStore.getCqtConfig();

    // Cancel any in-flight job before starting a new one.
    if (activeJobRef.current) {
      activeJobRef.current.cancel();
      activeJobRef.current = null;
    }

    mirStore.setIsRunning(true);
    mirStore.setRunningAnalysis(selected);
    mirStore.setLastTimings(null);

    const ch0 = audio.getChannelData(0);
    // Copy into a standalone typed array so we can transfer its ArrayBuffer into the worker.
    const payload: MirAudioPayload = {
      sampleRate: audio.sampleRate,
      mono: new Float32Array(ch0),
    };

    const request: MirRunRequest = {
      fn: selected as unknown as MirLibFunctionId,
      spectrogram: spectrogramConfig,
      mel: melConfig,
      backend: enableGpu ? "gpu" : "cpu",
      onset: onsetConfig,
      peakPick: peakPickConfig,
      hpss: hpssConfig,
      mfcc: mfccConfig,
      tempoHypotheses: tempoHypothesesConfig,
      cqt: cqtConfig,
    };

    try {
      let result: MirLibResult;
      let workerTotalMs: number | undefined;

      if (useWorker) {
        if (!workerRef.current) throw new Error("worker not initialised");

        workerRef.current.init(enableGpu);

        const job = workerRef.current.run(payload, request, {
          enableGpu,
          debug,
        });

        activeJobRef.current = job;

        result = await job.promise;
        workerTotalMs = await job.workerTotalMs;
      } else {
        // Main-thread runner (kept for comparison / fallback).
        result = await runMir(payload, request, {
          strictGpu: false,
        });
      }

      const meta = result.meta;
      mirStore.setLastTimings({
        workerTotalMs,
        cpuMs: meta.timings.cpuMs,
        gpuMs: meta.timings.gpuMs,
        totalMs: meta.timings.totalMs,
        backend: meta.backend,
        usedGpu: meta.usedGpu,
      });

      // Helper to store result (both in legacy store and per-input cache)
      const storeResult = (r: UiMirResult) => {
        // Always store in per-input cache using the cache key (which may differ from input ID for bands)
        mirStore.setInputMirResult(effectiveCacheKey, selected, r);

        // For backward compatibility, also store in legacy mirResults if this is the mixdown
        if (effectiveInputId === MIXDOWN_ID) {
          mirStore.setMirResult(selected, r);
        }

        mirStore.setVisualTab(selected);
      };

      if (result.kind === "1d") {
        const norm = normaliseForWaveform(result.values, {
          center: selected === "spectralCentroid",
          min: selected === "spectralFlux" ? -1 : undefined,
          max: selected === "spectralFlux" ? 1 : undefined,
        });

        storeResult({
          kind: "1d",
          fn: selected,
          times: result.times,
          values: norm,
        });
        return;
      }

      if (result.kind === "events") {
        storeResult({
          kind: "events",
          fn: selected,
          times: result.times,
          events: result.events,
        });
        return;
      }

      if (result.kind === "beatCandidates") {
        // Convert beat candidates to the events format for UI rendering.
        // Beat candidates have a 'source' field but otherwise match the events structure.
        storeResult({
          kind: "events",
          fn: selected,
          times: result.times,
          events: result.candidates.map((c, i) => ({
            time: c.time,
            strength: c.strength,
            index: i,
          })),
        });
        return;
      }

      if (result.kind === "tempoHypotheses") {
        storeResult({
          kind: "tempoHypotheses",
          fn: selected,
          hypotheses: result.hypotheses,
          inputCandidateCount: result.inputCandidateCount,
        });
        return;
      }

      // 2d
      storeResult({
        kind: "2d",
        fn: selected,
        raw: {
          data: result.data,
          times: result.times,
        },
      });
    } catch (e) {
      // If cancelled, do not treat as an error.
      if ((e as Error)?.message === "cancelled") {
        return;
      }
      console.error("[MIR] run failed", e);
      throw e;
    } finally {
      activeJobRef.current = null;
      mirStore.setIsRunning(false);
      mirStore.setRunningAnalysis(null);
    }
  }, []);

  const cancelAnalysis = useCallback(() => {
    if (activeJobRef.current) {
      activeJobRef.current.cancel();
      activeJobRef.current = null;
    }
  }, []);

  const ALL_MIR_FUNCTIONS: MirFunctionId[] = [
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
  ];

  const runAllAnalyses = useCallback(async () => {
    const audio = useAudioInputStore.getState().getAudio();
    if (!audio) return;

    for (const fn of ALL_MIR_FUNCTIONS) {
      await runAnalysis(fn);
    }
  }, [runAnalysis]);

  /**
   * Run all MIR analyses for a specific audio input.
   * @param inputId - The input ID to analyze
   */
  const runAllAnalysesForInput = useCallback(async (inputId: string) => {
    const audioInput = useAudioInputStore.getState().getInputById(inputId);
    if (!audioInput?.audioBuffer) return;

    for (const fn of ALL_MIR_FUNCTIONS) {
      await runAnalysis(fn, inputId);
    }
  }, [runAnalysis]);

  return { runAnalysis, runAllAnalyses, runAllAnalysesForInput, cancelAnalysis };
}
