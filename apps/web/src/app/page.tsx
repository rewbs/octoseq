"use client";

import { useMemo, useRef, useState } from "react";

import {
  type AudioBufferLike,
  type MirAudioPayload,
  type MirFunctionId as MirLibFunctionId,
  type MirResult as MirLibResult,
  type MirRunRequest,
  normaliseForWaveform,
} from "@octoseq/mir";

import { prepareHpssSpectrogramForHeatmap, prepareMfccForHeatmap } from "@/lib/mirDisplayTransforms";
import { runMir } from "@octoseq/mir/runner/runMir";

import { HeatmapPlayheadOverlay } from "@/components/heatmap/HeatmapPlayheadOverlay";
import { TimeAlignedHeatmapPixi, type TimeAlignedHeatmapData } from "@/components/heatmap/TimeAlignedHeatmapPixi";
import { MirControlPanel, type MirFunctionId } from "@/components/mir/MirControlPanel";
import { SyncedWaveSurferSignal } from "@/components/wavesurfer/SyncedWaveSurferSignal";
import { ViewportOverlayMarkers } from "@/components/wavesurfer/ViewportOverlayMarkers";
import { WaveSurferPlayer } from "@/components/wavesurfer/WaveSurferPlayer";
import type { WaveSurferViewport } from "@/components/wavesurfer/types";
import { MirWorkerClient, type MirWorkerJob } from "@/lib/mirWorkerClient";
import { useElementSize } from "@/lib/useElementSize";

type UiMirResult =
  | { kind: "none" }
  | { kind: "1d"; times: Float32Array; values: Float32Array }
  | { kind: "2d"; fn: MirFunctionId; raw: TimeAlignedHeatmapData }
  | { kind: "events"; times: Float32Array; events: Array<{ time: number; strength: number; index: number }> };

export default function Home() {
  const [audio, setAudio] = useState<AudioBufferLike | null>(null);
  const [viewport, setViewport] = useState<WaveSurferViewport | null>(null);
  const [playheadTimeSec, setPlayheadTimeSec] = useState(0);
  const [audioDuration, setAudioDuration] = useState<number>(0);

  const [selected, setSelected] = useState<MirFunctionId>("spectralCentroid");
  const [isRunning, setIsRunning] = useState(false);

  const [mirResult, setMirResult] = useState<UiMirResult>({ kind: "none" });

  const canRun = !!audio;

  // Debug toggles for validating worker + GPU pathways.
  const [debug, setDebug] = useState(false);
  const [useWorker, setUseWorker] = useState(true);
  const [enableGpu, setEnableGpu] = useState(false);

  // Minimal config UI state (keep intentionally small / non-dynamic)
  const [onsetSmoothMs, setOnsetSmoothMs] = useState(30);
  const [peakMinIntervalMs, setPeakMinIntervalMs] = useState(120);
  const [hpssTimeMedian, setHpssTimeMedian] = useState(17);
  const [hpssFreqMedian, setHpssFreqMedian] = useState(17);
  const [mfccNCoeffs, setMfccNCoeffs] = useState(13);

  // Display-only toggles (must not trigger re-analysis)
  const [showDcBin, setShowDcBin] = useState(false);
  const [showMfccC0, setShowMfccC0] = useState(false);

  const [lastTimings, setLastTimings] = useState<{
    workerTotalMs?: number;
    cpuMs?: number;
    gpuMs?: number;
    totalMs?: number;
    backend?: string;
    usedGpu?: boolean;
  } | null>(null);

  const workerRef = useRef<MirWorkerClient | null>(null);
  const activeJobRef = useRef<MirWorkerJob | null>(null);

  if (!workerRef.current && typeof window !== "undefined") {
    workerRef.current = new MirWorkerClient();
  }

  async function runAnalysis() {
    if (!audio) return;

    // Cancel any in-flight job before starting a new one.
    if (activeJobRef.current) {
      activeJobRef.current.cancel();
      activeJobRef.current = null;
    }

    setIsRunning(true);
    setLastTimings(null);

    const ch0 = audio.getChannelData(0);
    // Copy into a standalone typed array so we can transfer its ArrayBuffer into the worker.
    // (AudioBuffer channel data is a view into WebAudio memory and is not transferable.)
    const payload: MirAudioPayload = {
      sampleRate: audio.sampleRate,
      mono: new Float32Array(ch0),
    };

    const request: MirRunRequest = {
      fn: selected as unknown as MirLibFunctionId,
      spectrogram: {
        fftSize: 2048,
        hopSize: 512,
        window: "hann",
      },
      mel: {
        nMels: 64,
      },
      backend: enableGpu ? "gpu" : "cpu",

      onset: { smoothMs: onsetSmoothMs },
      peakPick: { minIntervalSec: peakMinIntervalMs / 1000 },
      hpss: { timeMedian: hpssTimeMedian, freqMedian: hpssFreqMedian },
      mfcc: { nCoeffs: mfccNCoeffs },
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
          // no gpu ctx on main thread for now; worker path validates WebGPU.
          strictGpu: false,
        });
      }

      const meta = result.meta;
      setLastTimings({
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

        setMirResult({
          kind: "1d",
          times: result.times,
          values: norm,
        });
        return;
      }

      if (result.kind === "events") {
        setMirResult({
          kind: "events",
          times: result.times,
          events: result.events,
        });
        return;
      }

      // 2d
      // Store *raw* numeric MIR outputs.
      // Display transforms are applied separately so toggles can update instantly
      // without triggering re-analysis.
      setMirResult({
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
      setIsRunning(false);
    }
  }

  function cancelAnalysis() {
    if (activeJobRef.current) {
      activeJobRef.current.cancel();
      activeJobRef.current = null;
    }
  }

  const visibleRange = useMemo(() => {
    // If we don't have a viewport yet (e.g. before first scroll interaction),
    // fall back to the full audio duration so visualisations have a non-empty window.
    if (!viewport) {
      return { startTime: 0, endTime: audioDuration };
    }
    return { startTime: viewport.startTime, endTime: viewport.endTime };
  }, [viewport, audioDuration]);

  const displayedHeatmap = useMemo<TimeAlignedHeatmapData | null>(() => {
    if (mirResult.kind !== "2d") return null;

    const { raw, fn } = mirResult;

    const displayData =
      fn === "hpssHarmonic" || fn === "hpssPercussive"
        ? prepareHpssSpectrogramForHeatmap(raw.data, { showDc: showDcBin, useDb: true, minDb: -80, maxDb: 0 })
        : fn === "mfcc" || fn === "mfccDelta" || fn === "mfccDeltaDelta"
          ? prepareMfccForHeatmap(raw.data, { showC0: showMfccC0 })
          : raw.data;

    return { data: displayData, times: raw.times };
  }, [mirResult, showDcBin, showMfccC0]);

  const heatmapValueRange = useMemo(() => {
    if (mirResult.kind !== "2d") return undefined;
    const fn = mirResult.fn;

    // For HPSS + MFCC we pre-normalise to [0,1], so use a fixed colormap range.
    if (fn === "hpssHarmonic" || fn === "hpssPercussive" || fn === "mfcc" || fn === "mfccDelta" || fn === "mfccDeltaDelta") {
      return { min: 0, max: 1 };
    }

    return undefined;
  }, [mirResult]);

  const heatmapYAxisLabel = useMemo(() => {
    if (mirResult.kind !== "2d") return "feature index";
    const fn = mirResult.fn;

    // MFCC coefficients are DCT basis weights (not frequency bins).
    if (fn === "mfcc" || fn === "mfccDelta" || fn === "mfccDeltaDelta") return "MFCC index";

    return "frequency bin";
  }, [mirResult]);

  const { ref: heatmapHostRef, size: heatmapHostSize } = useElementSize<HTMLDivElement>();

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 font-sans dark:bg-black">
      <main className="w-full max-w-4xl rounded-2xl bg-white p-10 shadow-sm dark:bg-black">
        <h1 className="text-3xl font-semibold tracking-tight text-black dark:text-zinc-50">Octoseq</h1>

        <section className="mt-10">
          <h2 className="text-lg font-semibold text-black dark:text-zinc-50">MIR</h2>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">Configure and run @octoseq/mir analyses.</p>

          <div className="mt-4 space-y-3">
            <MirControlPanel
              selected={selected}
              onSelectedChange={setSelected}
              onRun={() => void runAnalysis()}
              onCancel={() => cancelAnalysis()}
              disabled={!canRun}
              isRunning={isRunning}
            />

            <details className="rounded-md border border-zinc-200 bg-zinc-50 p-3 text-sm dark:border-zinc-800 dark:bg-zinc-950">
              <summary className="cursor-pointer select-none text-zinc-700 dark:text-zinc-200">Config</summary>
              <div className="mt-3 grid grid-cols-1 gap-3">
                <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                  <label className="inline-flex items-center gap-2">
                    <input type="checkbox" checked={showDcBin} onChange={(e) => setShowDcBin(e.target.checked)} />
                    <span className="text-xs text-zinc-600 dark:text-zinc-300">Show DC bin (spectrogram display)</span>
                  </label>

                  <label className="inline-flex items-center gap-2">
                    <input type="checkbox" checked={showMfccC0} onChange={(e) => setShowMfccC0(e.target.checked)} />
                    <span className="text-xs text-zinc-600 dark:text-zinc-300">Show MFCC C0 (display)</span>
                  </label>
                </div>
                <label className="grid grid-cols-[180px,1fr,60px] items-center gap-2">
                  <span className="text-xs text-zinc-600 dark:text-zinc-300">Onset smoothing (ms)</span>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={5}
                    value={onsetSmoothMs}
                    onChange={(e) => setOnsetSmoothMs(Number(e.target.value))}
                  />
                  <span className="text-right text-xs tabular-nums text-zinc-600 dark:text-zinc-300">{onsetSmoothMs}</span>
                </label>

                <label className="grid grid-cols-[180px,1fr,60px] items-center gap-2">
                  <span className="text-xs text-zinc-600 dark:text-zinc-300">Peak min interval (ms)</span>
                  <input
                    type="range"
                    min={20}
                    max={400}
                    step={10}
                    value={peakMinIntervalMs}
                    onChange={(e) => setPeakMinIntervalMs(Number(e.target.value))}
                  />
                  <span className="text-right text-xs tabular-nums text-zinc-600 dark:text-zinc-300">{peakMinIntervalMs}</span>
                </label>

                <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                  <label className="grid grid-cols-[180px,1fr] items-center gap-2">
                    <span className="text-xs text-zinc-600 dark:text-zinc-300">HPSS timeMedian</span>
                    <input
                      type="number"
                      min={1}
                      step={2}
                      value={hpssTimeMedian}
                      onChange={(e) => setHpssTimeMedian(Math.max(1, Math.floor(Number(e.target.value)) | 1))}
                      className="rounded border border-zinc-200 bg-white px-2 py-1 text-sm dark:border-zinc-800 dark:bg-zinc-950"
                    />
                  </label>
                  <label className="grid grid-cols-[180px,1fr] items-center gap-2">
                    <span className="text-xs text-zinc-600 dark:text-zinc-300">HPSS freqMedian</span>
                    <input
                      type="number"
                      min={1}
                      step={2}
                      value={hpssFreqMedian}
                      onChange={(e) => setHpssFreqMedian(Math.max(1, Math.floor(Number(e.target.value)) | 1))}
                      className="rounded border border-zinc-200 bg-white px-2 py-1 text-sm dark:border-zinc-800 dark:bg-zinc-950"
                    />
                  </label>
                </div>

                <label className="grid grid-cols-[180px,1fr] items-center gap-2">
                  <span className="text-xs text-zinc-600 dark:text-zinc-300">MFCC nCoeffs</span>
                  <input
                    type="number"
                    min={1}
                    max={40}
                    step={1}
                    value={mfccNCoeffs}
                    onChange={(e) => setMfccNCoeffs(Math.max(1, Math.floor(Number(e.target.value))))}
                    className="rounded border border-zinc-200 bg-white px-2 py-1 text-sm dark:border-zinc-800 dark:bg-zinc-950"
                  />
                </label>

                <p className="text-xs text-zinc-500">Config applies in both worker and main-thread modes.</p>
              </div>
            </details>

            <details className="rounded-md border border-zinc-200 bg-zinc-50 p-3 text-sm dark:border-zinc-800 dark:bg-zinc-950">
              <summary className="cursor-pointer select-none text-zinc-700 dark:text-zinc-200">Debug</summary>
              <div className="mt-3 grid grid-cols-1 gap-2">
                <label className="inline-flex items-center gap-2">
                  <input type="checkbox" checked={debug} onChange={(e) => setDebug(e.target.checked)} />
                  <span>Verbose worker logs</span>
                </label>
                <label className="inline-flex items-center gap-2">
                  <input type="checkbox" checked={useWorker} onChange={(e) => setUseWorker(e.target.checked)} />
                  <span>Use Web Worker (non-blocking)</span>
                </label>
                <label className="inline-flex items-center gap-2">
                  <input type="checkbox" checked={enableGpu} onChange={(e) => setEnableGpu(e.target.checked)} />
                  <span>Enable WebGPU stage (mel projection + onset envelope)</span>
                </label>

                <div className="mt-2 text-xs text-zinc-600 dark:text-zinc-300">
                  <div>worker: <code>{String(useWorker)}</code></div>
                  <div>gpu enabled: <code>{String(enableGpu)}</code></div>
                  <div>
                    timings: {lastTimings ? (
                      <pre className="mt-1 whitespace-pre-wrap rounded bg-white p-2 dark:bg-black">{JSON.stringify(lastTimings, null, 2)}</pre>
                    ) : (
                      <span className="text-zinc-500">(no run yet)</span>
                    )}
                  </div>

                  {mirResult.kind === "2d" && (
                    <div className="mt-2 text-xs text-zinc-600 dark:text-zinc-300">
                      raw shape: <code>{mirResult.raw.data.length}</code> frames ×{" "}
                      <code>{mirResult.raw.data[0]?.length ?? 0}</code>
                      {" "}features
                      {displayedHeatmap ? (
                        <>
                          <br />
                          display shape: <code>{displayedHeatmap.data.length}</code> frames ×{" "}
                          <code>{displayedHeatmap.data[0]?.length ?? 0}</code>
                          {" "}features
                        </>
                      ) : null}
                    </div>
                  )}
                </div>
              </div>
            </details>
          </div>
        </section>

        <section className="mt-10">
          <h2 className="text-lg font-semibold text-black dark:text-zinc-50">Waveform</h2>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
            Load a local audio file. The main waveform is the source-of-truth for zoom/scroll viewport.
          </p>

          <div className="mt-4">
            <WaveSurferPlayer
              onAudioDecoded={(a) => {
                setAudio(a);
                const ch0 = a.getChannelData(0);
                setAudioDuration(ch0.length / a.sampleRate);
                setMirResult({ kind: "none" });
              }}
              onViewportChange={(vp) => setViewport(vp)}
              onPlaybackTime={(t) => setPlayheadTimeSec(t)}
            />
          </div>

          {/* MIR visualisation: intentionally adjacent to waveform (no headings/whitespace between). */}
          {mirResult.kind === "1d" && (
            <div className="-mt-1">
              <SyncedWaveSurferSignal data={mirResult.values} times={mirResult.times} viewport={viewport} />
            </div>
          )}

          {mirResult.kind === "events" && (
            <div className="-mt-1">
              <div className="relative rounded-xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-950">
                <ViewportOverlayMarkers viewport={viewport} events={mirResult.events} height={80} />
              </div>
            </div>
          )}

          {mirResult.kind === "2d" && (
            <div className="-mt-1" ref={heatmapHostRef}>
              <div className="relative">
                <TimeAlignedHeatmapPixi
                  input={displayedHeatmap}
                  startTime={visibleRange.startTime}
                  endTime={visibleRange.endTime}
                  width={Math.floor(heatmapHostSize.width || 0)}
                  height={240}
                  valueRange={heatmapValueRange}
                  yLabel={heatmapYAxisLabel}
                />
                <HeatmapPlayheadOverlay viewport={viewport} playheadTimeSec={playheadTimeSec} height={240} />
              </div>
            </div>
          )}
        </section>

        <p className="mt-10 text-sm text-zinc-500">
          This page wires MIR outputs into visualisation components. The main WaveSurfer viewport drives sync.
        </p>
      </main>
    </div>
  );
}
