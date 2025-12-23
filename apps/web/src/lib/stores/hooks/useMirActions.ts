import { useCallback, useRef } from "react";
import type { MirAudioPayload, MirRunRequest, MirResult as MirLibResult, MirFunctionId as MirLibFunctionId } from "@octoseq/mir";
import { normaliseForWaveform } from "@octoseq/mir";
import { runMir } from "@octoseq/mir/runner/runMir";
import { useAudioStore } from "../audioStore";
import { useMirStore } from "../mirStore";
import { useConfigStore } from "../configStore";
import { MirWorkerClient, type MirWorkerJob } from "@/lib/mirWorkerClient";
import type { UiMirResult } from "../types";
import type { MirFunctionId } from "@/components/mir/MirControlPanel";

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

  const runAnalysis = useCallback(async (fnOverride?: MirFunctionId) => {
    const { audio } = useAudioStore.getState();
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

    // Cancel any in-flight job before starting a new one.
    if (activeJobRef.current) {
      activeJobRef.current.cancel();
      activeJobRef.current = null;
    }

    mirStore.setIsRunning(true);
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

      if (result.kind === "1d") {
        const norm = normaliseForWaveform(result.values, {
          center: selected === "spectralCentroid",
          min: selected === "spectralFlux" ? -1 : undefined,
          max: selected === "spectralFlux" ? 1 : undefined,
        });

        const r: UiMirResult = {
          kind: "1d",
          fn: selected,
          times: result.times,
          values: norm,
        };
        mirStore.setMirResult(selected, r);
        mirStore.setVisualTab(selected);
        return;
      }

      if (result.kind === "events") {
        const r: UiMirResult = {
          kind: "events",
          fn: selected,
          times: result.times,
          events: result.events,
        };
        mirStore.setMirResult(selected, r);
        mirStore.setVisualTab(selected);
        return;
      }

      if (result.kind === "beatCandidates") {
        // Convert beat candidates to the events format for UI rendering.
        // Beat candidates have a 'source' field but otherwise match the events structure.
        const r: UiMirResult = {
          kind: "events",
          fn: selected,
          times: result.times,
          events: result.candidates.map((c, i) => ({
            time: c.time,
            strength: c.strength,
            index: i,
          })),
        };
        mirStore.setMirResult(selected, r);
        mirStore.setVisualTab(selected);
        return;
      }

      if (result.kind === "tempoHypotheses") {
        const r: UiMirResult = {
          kind: "tempoHypotheses",
          fn: selected,
          hypotheses: result.hypotheses,
          inputCandidateCount: result.inputCandidateCount,
        };
        mirStore.setMirResult(selected, r);
        mirStore.setVisualTab(selected);
        return;
      }

      // 2d
      const r: UiMirResult = {
        kind: "2d",
        fn: selected,
        raw: {
          data: result.data,
          times: result.times,
        },
      };
      mirStore.setMirResult(selected, r);
      mirStore.setVisualTab(selected);
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
    }
  }, []);

  const cancelAnalysis = useCallback(() => {
    if (activeJobRef.current) {
      activeJobRef.current.cancel();
      activeJobRef.current = null;
    }
  }, []);

  const ALL_MIR_FUNCTIONS: MirFunctionId[] = [
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
  ];

  const runAllAnalyses = useCallback(async () => {
    const { audio } = useAudioStore.getState();
    if (!audio) return;

    for (const fn of ALL_MIR_FUNCTIONS) {
      await runAnalysis(fn);
    }
  }, [runAnalysis]);

  return { runAnalysis, runAllAnalyses, cancelAnalysis };
}
