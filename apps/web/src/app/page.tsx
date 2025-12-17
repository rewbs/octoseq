"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from "react";

import {
  type AudioBufferLike,
  type MirAudioPayload,
  type MirFunctionId as MirLibFunctionId,
  type MirResult as MirLibResult,
  type MirRunRequest,
  normaliseForWaveform,
} from "@octoseq/mir";

import { Github } from "lucide-react";
import { Button } from "@/components/ui/button";
import { HeatmapPlayheadOverlay } from "@/components/heatmap/HeatmapPlayheadOverlay";
import { type HeatmapColorScheme, TimeAlignedHeatmapPixi } from "@/components/heatmap/TimeAlignedHeatmapPixi";
import { MirControlPanel, type MirFunctionId } from "@/components/mir/MirControlPanel";
import { SyncedWaveSurferSignal } from "@/components/wavesurfer/SyncedWaveSurferSignal";
import { ViewportOverlayMarkers } from "@/components/wavesurfer/ViewportOverlayMarkers";
import { WaveSurferPlayer, type WaveSurferPlayerHandle } from "@/components/wavesurfer/WaveSurferPlayer";
import { VisualiserPanel } from "@/components/visualiser/VisualiserPanel";
import type { WaveSurferViewport } from "@/components/wavesurfer/types";
import { runMir } from "@octoseq/mir/runner/runMir";
import { MirWorkerClient, type MirWorkerJob, type MirWorkerSearchJob } from "@/lib/mirWorkerClient";
import { useElementSize } from "@/lib/useElementSize";
import { SearchControlsPanel, type SearchControls } from "@/components/search/SearchControlsPanel";
import { SearchRefinementPanel } from "@/components/search/SearchRefinementPanel";
import { precisionToHopSec } from "@/lib/searchHopMapping";
import type { SearchCandidateOverlayEvent } from "@/components/wavesurfer/ViewportOverlaySearchCandidates";
import {
  type CandidateFilter,
  type RefinementCandidate,
  type SearchRefinementState,
  computeRefinementStats,
  isCandidateTextInputTarget,
  makeAutoCandidateId,
  makeInitialRefinementState,
} from "@/lib/searchRefinement";

import { MirConfigModal } from "@/components/mir/MirConfigModal";
import { DebugPanel } from "@/components/common/DebugPanel";

type UiMirResult =
  | { kind: "none" }
  | { kind: "1d"; fn: MirFunctionId; times: Float32Array; values: Float32Array }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  | { kind: "2d"; fn: MirFunctionId; raw: any }
  | { kind: "events"; fn: MirFunctionId; times: Float32Array; events: Array<{ time: number; strength: number; index: number }> };

export default function Home() {
  const [audio, setAudio] = useState<AudioBufferLike | null>(null);
  const [audioFileName, setAudioFileName] = useState<string | null>(null);
  const [audioSampleRate, setAudioSampleRate] = useState<number | null>(null);
  const [audioTotalSamples, setAudioTotalSamples] = useState<number | null>(null);
  const [viewport, setViewport] = useState<WaveSurferViewport | null>(null);
  const [playheadTimeSec, setPlayheadTimeSec] = useState(0);
  const [cursorTimeSec, setCursorTimeSec] = useState<number | null>(null);
  const [audioDuration, setAudioDuration] = useState<number>(0);

  const [refinement, setRefinement] = useState<SearchRefinementState>(() => makeInitialRefinementState());
  const [candidateFilter, setCandidateFilter] = useState<CandidateFilter>("all");
  const [addMissingMode, setAddMissingMode] = useState(false);
  const [loopCandidate, setLoopCandidate] = useState(false);
  const [autoPlayOnNavigate, setAutoPlayOnNavigate] = useState(false);
  const [useRefinementSearch, setUseRefinementSearch] = useState(false);
  const userSetUseRefinementRef = useRef(false);

  const [searchControls, setSearchControls] = useState<SearchControls>({
    threshold: 0.75,
    precision: "medium",
    melWeight: 1,
    transientWeight: 1,
    applySoftmax: false,
  });

  const [searchResult, setSearchResult] = useState<{
    times: Float32Array;
    scores: Float32Array;
    curveKind: "similarity" | "confidence";
    model: {
      kind: "baseline" | "prototype" | "logistic";
      positives: number;
      negatives: number;
      weightL2?: {
        mel: number;
        melForeground: number;
        melContrast?: number;
        onset: number;
        onsetForeground: number;
        onsetContrast?: number;
        mfcc?: number;
        mfccForeground?: number;
        mfccContrast?: number;
      };
      training?: { iterations: number; finalLoss: number };
    };
    candidates: SearchCandidateOverlayEvent[];
    timings: { fingerprintMs: number; scanMs: number; modelMs?: number; totalMs: number };
    meta: { windowSec: number; hopSec: number; skippedWindows: number; scannedWindows: number };
  } | null>(null);

  const [waveformSeekTo, setWaveformSeekTo] = useState<number | null>(null);
  const [searchDirty, setSearchDirty] = useState(false);
  const [isSearchRunning, setIsSearchRunning] = useState(false);
  const [visualTab, setVisualTab] = useState<"search" | MirFunctionId>("search");
  const lastSelectionRef = useRef<{ startSec: number; endSec: number } | null>(null);

  const [selected, setSelected] = useState<MirFunctionId>("spectralCentroid");
  const [isRunning, setIsRunning] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);

  // Config modal state
  const [isConfigOpen, setIsConfigOpen] = useState(false);
  const [isDebugOpen, setIsDebugOpen] = useState(false);

  const [mirResults, setMirResults] = useState<Partial<Record<MirFunctionId, UiMirResult>>>({});
  const [lastRunTimings, setLastRunTimings] = useState<{ totalMs: number;[key: string]: number } | null>(null);

  const canRun = !!audio;

  // Debug toggles for validating worker + GPU pathways.
  const [debug, setDebug] = useState(false);
  const [useWorker, setUseWorker] = useState(true);
  const [enableGpu, setEnableGpu] = useState(true);
  const [heatmapScheme, setHeatmapScheme] = useState<HeatmapColorScheme>("magma");

  // Minimal config UI state (keep intentionally small / non-dynamic)
  const [fftSize, setFftSize] = useState(512);
  const [hopSize, setHopSize] = useState(128);

  const [melBands, setMelBands] = useState(64);
  const [melFMin, setMelFMin] = useState<string>("");
  const [melFMax, setMelFMax] = useState<string>("");

  const [onsetSmoothMs, setOnsetSmoothMs] = useState(30);
  const [onsetDiffMethod, setOnsetDiffMethod] = useState<"rectified" | "abs">("rectified");
  const [onsetUseLog, setOnsetUseLog] = useState(false);

  const [peakMinIntervalMs, setPeakMinIntervalMs] = useState(120);
  const [peakThreshold, setPeakThreshold] = useState<string>("");
  const [peakAdaptiveFactor, setPeakAdaptiveFactor] = useState<string>("");

  const [hpssTimeMedian, setHpssTimeMedian] = useState(17);
  const [hpssFreqMedian, setHpssFreqMedian] = useState(17);

  const [mfccNCoeffs, setMfccNCoeffs] = useState(13);

  // Display-only toggles (must not trigger re-analysis)
  const [showDcBin, setShowDcBin] = useState(false);
  const [showMfccC0, setShowMfccC0] = useState(false);


  const workerRef = useRef<MirWorkerClient | null>(null);
  const activeJobRef = useRef<MirWorkerJob | null>(null);
  const activeSearchJobRef = useRef<MirWorkerSearchJob | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const playerRef = useRef<WaveSurferPlayerHandle | null>(null);

  if (!workerRef.current && typeof window !== "undefined") {
    workerRef.current = new MirWorkerClient();
  }

  async function runAnalysis() {
    if (!audio) return;

    const parseOptionalNumber = (v: string): number | undefined => {
      if (v.trim() === "") return undefined;
      const n = Number(v);
      return Number.isFinite(n) ? n : undefined;
    };

    const melConfig = {
      nMels: melBands,
      fMin: parseOptionalNumber(melFMin),
      fMax: parseOptionalNumber(melFMax),
    };

    const spectrogramConfig = {
      fftSize,
      hopSize: Math.min(hopSize, fftSize),
      window: "hann" as const,
    };

    // Cancel any in-flight job before starting a new one.
    if (activeJobRef.current) {
      activeJobRef.current.cancel();
      activeJobRef.current = null;
    }

    setIsRunning(true);

    const ch0 = audio.getChannelData(0);
    // Copy into a standalone typed array so we can transfer its ArrayBuffer into the worker.
    // (AudioBuffer channel data is a view into WebAudio memory and is not transferable.)
    const payload: MirAudioPayload = {
      sampleRate: audio.sampleRate,
      mono: new Float32Array(ch0),
    };

    const request: MirRunRequest = {
      fn: selected as unknown as MirLibFunctionId,
      spectrogram: spectrogramConfig,
      mel: melConfig,
      backend: enableGpu ? "gpu" : "cpu",

      onset: { smoothMs: onsetSmoothMs, diffMethod: onsetDiffMethod, useLog: onsetUseLog },
      peakPick: {
        minIntervalSec: peakMinIntervalMs / 1000,
        threshold: parseOptionalNumber(peakThreshold),
        adaptiveFactor: parseOptionalNumber(peakAdaptiveFactor),
      },
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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        setLastRunTimings((result as any).timings || (workerTotalMs ? { totalMs: workerTotalMs } : null));
      } else {
        // Main-thread runner (kept for comparison / fallback).
        result = await runMir(payload, request, {
          // no gpu ctx on main thread for now; worker path validates WebGPU.
          strictGpu: false,
        });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        setLastRunTimings((result as any).timings || null);
      }

      const meta = result.meta;

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
        setMirResults((prev) => ({ ...prev, [selected]: r }));
        setVisualTab(selected);
        return;
      }

      if (result.kind === "events") {
        const r: UiMirResult = {
          kind: "events",
          fn: selected,
          times: result.times,
          events: result.events,
        };
        setMirResults((prev) => ({ ...prev, [selected]: r }));
        setVisualTab(selected);
        return;
      }

      // 2d
      // Store *raw* numeric MIR outputs.
      // Display transforms are applied separately so toggles can update instantly
      // without triggering re-analysis.
      const r: UiMirResult = {
        kind: "2d",
        fn: selected,
        raw: {
          data: result.data,
          times: result.times,
        },
      };
      setMirResults((prev) => ({ ...prev, [selected]: r }));
      setVisualTab(selected);
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

  const runSearch = async (region: { startSec: number; endSec: number }, controls: SearchControls) => {
    if (!audio) return;
    if (!workerRef.current) throw new Error("worker not initialised");

    const t0 = Math.min(region.startSec, region.endSec);
    const t1 = Math.max(region.startSec, region.endSec);
    const dur = Math.max(1e-3, t1 - t0);

    // Cancel any in-flight search before starting a new one.
    if (activeSearchJobRef.current) {
      activeSearchJobRef.current.cancel();
      activeSearchJobRef.current = null;
    }
    // Keep human labels when re-running search:
    // - manual matches
    // - accepted/rejected auto candidates
    // Unreviewed auto candidates are replaced by the new run.
    setRefinement((prevState) => {
      const preserved = prevState.candidates
        .filter((c) => c.source === "manual" || c.status !== "unreviewed")
        .sort((a, b) => a.startSec - b.startSec);
      const nextActive = preserved.some((c) => c.id === prevState.activeCandidateId) ? prevState.activeCandidateId : null;
      return {
        ...prevState,
        candidates: preserved,
        activeCandidateId: nextActive,
        refinementStats: computeRefinementStats(preserved),
      };
    });

    // Build transferable audio payload (same as analysis path).
    const ch0 = audio.getChannelData(0);
    const payload: MirAudioPayload = {
      sampleRate: audio.sampleRate,
      mono: new Float32Array(ch0),
    };

    const hopSec = precisionToHopSec(controls.precision, dur);

    const refinementLabels = refinement.candidates
      .filter((c) => c.status === "accepted" || c.status === "rejected")
      .map((c) => ({
        t0: c.startSec,
        t1: c.endSec,
        status: c.status === "accepted" ? ("accepted" as const) : ("rejected" as const),
        source: c.source,
      }));
    const hasAnyLabels = refinementLabels.length > 0;

    workerRef.current.init(enableGpu);

    setIsSearchRunning(true);
    const job = workerRef.current.search(
      payload,
      {
        query: { t0, t1 },
        search: {
          hopSec,
          threshold: controls.threshold,
          skipOverlap: true,
          weights: {
            mel: controls.melWeight,
            transient: controls.transientWeight,
          },
          applySoftmax: controls.applySoftmax,
        },
        // Keep feature config consistent with the current UI settings so search matches what users see.
        features: {
          spectrogram: { fftSize, hopSize: Math.min(hopSize, fftSize), window: "hann" },
          mel: {
            nMels: melBands,
            fMin: melFMin.trim() === "" ? undefined : Number(melFMin),
            fMax: melFMax.trim() === "" ? undefined : Number(melFMax),
          },
          onset: { smoothMs: onsetSmoothMs, diffMethod: onsetDiffMethod, useLog: onsetUseLog },
          mfcc: { nCoeffs: mfccNCoeffs },
        },
        refinement: {
          enabled: useRefinementSearch && hasAnyLabels,
          includeQueryAsPositive: true,
          labels: refinementLabels,
        },
      },
      { enableGpu, strictGpu: false, debug }
    );

    activeSearchJobRef.current = job;

    try {
      const res = await job.promise;
      setSearchResult(res);
      setRefinement((prevState) => {
        const preserved = prevState.candidates.filter((c) => c.source === "manual" || c.status !== "unreviewed");
        const preservedUpdated = preserved.map((c) => ({ ...c }));

        const overlapRatio = (a0: number, a1: number, b0: number, b1: number): number => {
          const start = Math.max(Math.min(a0, a1), Math.min(b0, b1));
          const end = Math.min(Math.max(a0, a1), Math.max(b0, b1));
          const overlap = Math.max(0, end - start);
          const durA = Math.max(1e-6, Math.abs(a1 - a0));
          const durB = Math.max(1e-6, Math.abs(b1 - b0));
          return overlap / Math.min(durA, durB);
        };

        const matchThreshold = 0.9;
        const usedPreserved = new Set<number>();

        const newAuto: RefinementCandidate[] = [];
        const resultCandidates = [...res.candidates].sort((a, b) => a.windowStartSec - b.windowStartSec);

        for (let idx = 0; idx < resultCandidates.length; idx++) {
          const c = resultCandidates[idx];
          if (!c) continue;

          const startSec = c.windowStartSec;
          const endSec = c.windowEndSec;

          // Preserve any existing manual / accepted / rejected candidate that overlaps strongly.
          let bestIndex = -1;
          let bestRatio = 0;
          for (let i = 0; i < preservedUpdated.length; i++) {
            if (usedPreserved.has(i)) continue;
            const p = preservedUpdated[i];
            if (!p) continue;
            const ratio = overlapRatio(startSec, endSec, p.startSec, p.endSec);
            if (ratio > bestRatio) {
              bestRatio = ratio;
              bestIndex = i;
            }
          }

          if (bestIndex >= 0 && bestRatio >= matchThreshold) {
            usedPreserved.add(bestIndex);
            const p = preservedUpdated[bestIndex];
            if (p && p.source !== "manual") {
              preservedUpdated[bestIndex] = { ...p, startSec, endSec, score: c.score };
            }
            continue;
          }

          newAuto.push({
            id: makeAutoCandidateId(startSec, endSec, idx),
            startSec,
            endSec,
            score: c.score,
            status: "unreviewed",
            source: "auto",
          });
        }

        const nextCandidates = [...preservedUpdated, ...newAuto].sort((a, b) => a.startSec - b.startSec);

        const stillActive = prevState.activeCandidateId != null && nextCandidates.some((c) => c.id === prevState.activeCandidateId);
        const nextActive =
          stillActive
            ? prevState.activeCandidateId
            : nextCandidates.find((c) => c.status === "unreviewed")?.id ?? nextCandidates[0]?.id ?? null;

        const nextActiveCandidate = nextActive ? nextCandidates.find((c) => c.id === nextActive) ?? null : null;
        if (nextActiveCandidate) setWaveformSeekTo(nextActiveCandidate.startSec);

        return {
          ...prevState,
          candidates: nextCandidates,
          activeCandidateId: nextActive,
          refinementStats: computeRefinementStats(nextCandidates),
        };
      });
      setSearchDirty(false);

      // UX improvement: auto-enable "Add missing match" mode so subsequent interactions
      // add candidates rather than resetting the search.
      setAddMissingMode(true);
    } finally {
      setIsSearchRunning(false);
      if (activeSearchJobRef.current?.id === job.id) activeSearchJobRef.current = null;
    }
  };

  // Mark search as stale when inputs change; user must click Run Search explicitly.
  useEffect(() => {
    const query = refinement.queryRegion ? { startSec: refinement.queryRegion.startSec, endSec: refinement.queryRegion.endSec } : null;
    const prev = lastSelectionRef.current;
    const selectionChanged =
      (prev?.startSec ?? null) !== (query?.startSec ?? null) || (prev?.endSec ?? null) !== (query?.endSec ?? null);
    lastSelectionRef.current = query;

    if (!query || !audio) {
      setSearchResult(null);
      setWaveformSeekTo(null);
      setSearchDirty(false);
      setCandidateFilter("all");
      setAddMissingMode(false);
      userSetUseRefinementRef.current = false;
      setUseRefinementSearch(false);
      setRefinement((prevState) => {
        if (prevState.candidates.length === 0 && prevState.activeCandidateId == null && prevState.queryRegion == null) return prevState;
        return makeInitialRefinementState();
      });
      return;
    }

    if (selectionChanged) {
      setSearchResult(null);
      setWaveformSeekTo(null);
      setIsSearchRunning(false);
      setCandidateFilter("all");
      setAddMissingMode(false);
      userSetUseRefinementRef.current = false;
      setUseRefinementSearch(false);
      // Query changes invalidate review state; keep this strict so exports always match the query.
      setRefinement((prevState) => ({
        ...prevState,
        candidates: [],
        activeCandidateId: null,
        refinementStats: computeRefinementStats([]),
      }));
    }

    setSearchDirty(true);
  }, [
    refinement.queryRegion,
    searchControls,
    audio,
    enableGpu,
    debug,
    fftSize,
    hopSize,
    melBands,
    melFMin,
    melFMax,
    onsetSmoothMs,
    onsetDiffMethod,
    onsetUseLog,
    mfccNCoeffs,
  ]);

  const mirroredCursorTimeSec = (() => {
    const t = cursorTimeSec ?? playheadTimeSec;
    if (!Number.isFinite(t)) return 0;
    if (audioDuration) return Math.min(audioDuration, Math.max(0, t));
    return Math.max(0, t);
  })();

  const searchSignal = useMemo(() => {
    if (!searchResult) return null;
    return normaliseForWaveform(searchResult.scores, { min: 0, max: 1 });
  }, [searchResult]);

  const hasSearchResult = !!(searchResult && searchSignal);

  const refinementLabelsAvailable = refinement.refinementStats.accepted + refinement.refinementStats.rejected > 0;
  useEffect(() => {
    if (userSetUseRefinementRef.current) return;
    setUseRefinementSearch(refinementLabelsAvailable);
  }, [refinementLabelsAvailable]);

  const candidatesById = useMemo(() => {
    return new Map(refinement.candidates.map((c) => [c.id, c]));
  }, [refinement.candidates]);

  const activeCandidate = useMemo(() => {
    if (!refinement.activeCandidateId) return null;
    return candidatesById.get(refinement.activeCandidateId) ?? null;
  }, [candidatesById, refinement.activeCandidateId]);



  const filteredCandidates = useMemo(() => {
    if (candidateFilter === "all") return refinement.candidates;
    return refinement.candidates.filter((c) => c.status === candidateFilter);
  }, [candidateFilter, refinement.candidates]);

  const activeFilteredIndex = useMemo(() => {
    if (!refinement.activeCandidateId) return -1;
    return filteredCandidates.findIndex((c) => c.id === refinement.activeCandidateId);
  }, [filteredCandidates, refinement.activeCandidateId]);

  const navigateCandidate = useCallback(
    (dir: -1 | 1) => {
      if (filteredCandidates.length === 0) return;
      const idx = activeFilteredIndex;
      const nextIndex =
        idx === -1
          ? dir === 1
            ? 0
            : filteredCandidates.length - 1
          : (idx + dir + filteredCandidates.length) % filteredCandidates.length;
      const next = filteredCandidates[nextIndex];
      if (!next) return;

      setRefinement((prevState) => ({ ...prevState, activeCandidateId: next.id }));

      if (autoPlayOnNavigate) {
        playerRef.current?.playSegment({ startSec: next.startSec, endSec: next.endSec, loop: loopCandidate });
      } else {
        setWaveformSeekTo(next.startSec);
      }
    },
    [activeFilteredIndex, autoPlayOnNavigate, filteredCandidates, loopCandidate]
  );

  const onPrevCandidate = useCallback(() => navigateCandidate(-1), [navigateCandidate]);
  const onNextCandidate = useCallback(() => navigateCandidate(1), [navigateCandidate]);

  const playActiveCandidate = useCallback(() => {
    if (!activeCandidate) return;
    playerRef.current?.playSegment({ startSec: activeCandidate.startSec, endSec: activeCandidate.endSec, loop: loopCandidate });
  }, [activeCandidate, loopCandidate]);

  const playQueryRegion = useCallback(() => {
    const q = refinement.queryRegion;
    if (!q) return;
    playerRef.current?.playSegment({ startSec: q.startSec, endSec: q.endSec, loop: false });
  }, [refinement.queryRegion]);

  const togglePlayShortcut = useCallback(() => {
    const player = playerRef.current;
    if (!player) return;

    if (activeCandidate) {
      if (player.isPlaying()) player.pause();
      else player.playSegment({ startSec: activeCandidate.startSec, endSec: activeCandidate.endSec, loop: loopCandidate });
      return;
    }

    player.playPause();
  }, [activeCandidate, loopCandidate]);

  const setActiveStatus = useCallback(
    (status: "accepted" | "rejected") => {
      const current = activeCandidate;
      if (!current) return;

      // UX: Accept/Reject advances to the next candidate in the current filter for rapid triage.
      let next: RefinementCandidate | null = null;
      if (filteredCandidates.length > 1) {
        const idx = filteredCandidates.findIndex((c) => c.id === current.id);
        const nextIndex = idx === -1 ? 0 : (idx + 1) % filteredCandidates.length;
        next = filteredCandidates[nextIndex] ?? null;
        if (next?.id === current.id) next = null;
      }

      setRefinement((prevState) => {
        const updated = prevState.candidates.map((c) => (c.id === current.id ? { ...c, status } : c));
        const nextActive = candidateFilter === "all" ? next?.id ?? current.id : next?.id ?? null;
        return {
          ...prevState,
          candidates: updated,
          activeCandidateId: nextActive,
          refinementStats: computeRefinementStats(updated),
        };
      });

      if (next) {
        if (autoPlayOnNavigate) {
          playerRef.current?.playSegment({ startSec: next.startSec, endSec: next.endSec, loop: loopCandidate });
        } else {
          setWaveformSeekTo(next.startSec);
        }
      }
    },
    [activeCandidate, autoPlayOnNavigate, candidateFilter, filteredCandidates, loopCandidate]
  );

  const acceptActive = useCallback(() => setActiveStatus("accepted"), [setActiveStatus]);
  const rejectActive = useCallback(() => setActiveStatus("rejected"), [setActiveStatus]);

  const deleteActiveManual = useCallback(() => {
    if (!activeCandidate || activeCandidate.source !== "manual") return;
    const id = activeCandidate.id;

    const filteredWithout = filteredCandidates.filter((c) => c.id !== id);
    const idx = filteredCandidates.findIndex((c) => c.id === id);
    const next = filteredWithout.length > 0 ? filteredWithout[Math.min(Math.max(0, idx), filteredWithout.length - 1)] : null;

    setRefinement((prevState) => {
      const updated = prevState.candidates.filter((c) => c.id !== id);
      const nextActive = next?.id ?? (candidateFilter === "all" ? updated[0]?.id ?? null : null);
      return {
        ...prevState,
        candidates: updated,
        activeCandidateId: nextActive,
        refinementStats: computeRefinementStats(updated),
      };
    });

    if (next) setWaveformSeekTo(next.startSec);
  }, [activeCandidate, candidateFilter, filteredCandidates]);

  const jumpToBestUnreviewed = useCallback(() => {
    let best: RefinementCandidate | null = null;
    for (const c of refinement.candidates) {
      if (c.status !== "unreviewed") continue;
      if (c.score == null) continue;
      if (!best || (best.score ?? -Infinity) < c.score) best = c;
    }
    if (!best) return;
    setRefinement((prevState) => ({ ...prevState, activeCandidateId: best.id }));
    if (autoPlayOnNavigate) {
      playerRef.current?.playSegment({ startSec: best.startSec, endSec: best.endSec, loop: loopCandidate });
    } else {
      setWaveformSeekTo(best.startSec);
    }
  }, [autoPlayOnNavigate, loopCandidate, refinement.candidates]);

  const handleFilterChange = useCallback(
    (nextFilter: CandidateFilter) => {
      setCandidateFilter(nextFilter);

      const list = nextFilter === "all" ? refinement.candidates : refinement.candidates.filter((c) => c.status === nextFilter);
      if (list.length === 0) {
        setRefinement((prevState) => ({ ...prevState, activeCandidateId: null }));
        return;
      }

      const first = list[0];
      if (!first) return;

      const stillValid = refinement.activeCandidateId != null && list.some((c) => c.id === refinement.activeCandidateId);
      const nextActiveId = stillValid && refinement.activeCandidateId ? refinement.activeCandidateId : first.id;

      setRefinement((prevState) => ({ ...prevState, activeCandidateId: nextActiveId }));

      const c = nextActiveId ? candidatesById.get(nextActiveId) : null;
      if (c) {
        if (autoPlayOnNavigate) {
          playerRef.current?.playSegment({ startSec: c.startSec, endSec: c.endSec, loop: loopCandidate });
        } else {
          setWaveformSeekTo(c.startSec);
        }
      }
    },
    [autoPlayOnNavigate, candidatesById, loopCandidate, refinement.activeCandidateId, refinement.candidates]
  );

  const copyRefinementJson = useCallback(async () => {
    const q = refinement.queryRegion;
    if (!q) return;

    const fileName = audioFileName ?? fileInputRef.current?.files?.[0]?.name ?? null;

    const accepted = refinement.candidates
      .filter((c) => c.status === "accepted")
      .map((c) => ({ id: c.id, startSec: c.startSec, endSec: c.endSec, score: c.score, source: c.source }));
    const rejected = refinement.candidates
      .filter((c) => c.status === "rejected")
      .map((c) => ({ id: c.id, startSec: c.startSec, endSec: c.endSec, score: c.score, source: c.source }));
    const manualMatches = refinement.candidates
      .filter((c) => c.source === "manual")
      .map((c) => ({ id: c.id, startSec: c.startSec, endSec: c.endSec, status: c.status }));

    const payload = {
      queryRegion: q,
      accepted,
      rejected,
      manualMatches,
      meta: {
        audioFileName: fileName,
        sampleRate: audioSampleRate,
        selectionDurationSec: Math.max(0, q.endSec - q.startSec),
      },
    };

    const text = JSON.stringify(payload, null, 2);
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      window.prompt("Copy refinement JSON:", text);
    }
  }, [audioFileName, audioSampleRate, refinement.candidates, refinement.queryRegion]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (isCandidateTextInputTarget(e.target)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      const key = e.key;
      const lower = key.toLowerCase();

      if (key === "ArrowLeft" || lower === "j") {
        e.preventDefault();
        onPrevCandidate();
        return;
      }
      if (key === "ArrowRight" || lower === "k") {
        e.preventDefault();
        onNextCandidate();
        return;
      }
      if (lower === "a") {
        e.preventDefault();
        acceptActive();
        return;
      }
      if (lower === "r") {
        e.preventDefault();
        rejectActive();
        return;
      }
      if (key === " ") {
        e.preventDefault();
        togglePlayShortcut();
        return;
      }
      if (lower === "q") {
        e.preventDefault();
        playQueryRegion();
        return;
      }
      if (lower === "m") {
        e.preventDefault();
        setAddMissingMode((v) => !v);
        return;
      }
      if ((key === "Delete" || key === "Backspace") && activeCandidate?.source === "manual") {
        e.preventDefault();
        deleteActiveManual();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    acceptActive,
    activeCandidate?.source,
    deleteActiveManual,
    onNextCandidate,
    onPrevCandidate,
    playQueryRegion,
    rejectActive,
    togglePlayShortcut,
  ]);

  const mirTabs: Array<{ id: MirFunctionId; label: string; kind: "1d" | "events" | "2d" }> = useMemo(
    () => [
      { id: "spectralCentroid", label: "Spectral Centroid (1D)", kind: "1d" },
      { id: "spectralFlux", label: "Spectral Flux (1D)", kind: "1d" },
      { id: "onsetEnvelope", label: "Onset Envelope (1D)", kind: "1d" },
      { id: "onsetPeaks", label: "Onset Peaks (events)", kind: "events" },
      { id: "melSpectrogram", label: "Mel Spectrogram (2D)", kind: "2d" },
      { id: "hpssHarmonic", label: "HPSS Harmonic (2D)", kind: "2d" },
      { id: "hpssPercussive", label: "HPSS Percussive (2D)", kind: "2d" },
      { id: "mfcc", label: "MFCC (2D)", kind: "2d" },
      { id: "mfccDelta", label: "MFCC Delta (2D)", kind: "2d" },
      { id: "mfccDeltaDelta", label: "MFCC Delta-Delta (2D)", kind: "2d" },
    ],
    []
  );

  const tabDefs: Array<{ id: typeof visualTab; label: string; hasData: boolean }> = useMemo(() => {
    const mirTabsWithAvailability = mirTabs.map((t) => ({
      ...t,
      hasData: !!mirResults[t.id],
    }));

    return [
      ...mirTabsWithAvailability,
      { id: "search", label: "Similarity", hasData: hasSearchResult },
    ];
  }, [hasSearchResult, mirResults, mirTabs]);

  useEffect(() => {
    // Ensure the selected tab id exists; prefer spectralCentroid first (first MIR tab).
    if (tabDefs.find((t) => t.id === visualTab)) return;
    const fallback = tabDefs.find((t) => t.hasData) ?? tabDefs[0];
    if (fallback) setVisualTab(fallback.id);
  }, [tabDefs, visualTab]);

  const normaliseViewport = (vp: WaveSurferViewport): WaveSurferViewport => {
    const start = Math.max(0, Math.min(audioDuration || Infinity, vp.startTime));
    const endRaw = Math.max(start, vp.endTime);
    const end = audioDuration ? Math.min(audioDuration, endRaw) : endRaw;
    return {
      ...vp,
      startTime: start,
      endTime: end,
    };
  };

  const handleCursorHoverFromViewport = (evt: MouseEvent<HTMLElement>) => {
    if (!viewport || viewport.minPxPerSec <= 0) return;
    const rect = evt.currentTarget.getBoundingClientRect();
    const span = viewport.endTime - viewport.startTime;
    if (span <= 0) return;
    const pxPerSec = rect.width > 0 ? rect.width / span : viewport.minPxPerSec;
    if (!pxPerSec || pxPerSec <= 0) return;
    const x = Math.max(0, Math.min(rect.width, evt.clientX - rect.left));
    const t = viewport.startTime + x / pxPerSec;
    const clamped = audioDuration ? Math.min(audioDuration, Math.max(0, t)) : Math.max(0, t);
    setCursorTimeSec(clamped);
  };

  const handleCursorLeave = () => setCursorTimeSec(null);

  const tabResult = visualTab !== "search" ? mirResults[visualTab as MirFunctionId] : undefined;

  const { ref: eventsHostRef, size: eventsHostSize } = useElementSize<HTMLDivElement>();
  const { ref: heatmapHostRef, size: heatmapHostSize } = useElementSize<HTMLDivElement>();

  // Helper to sync tab click with MIR selection
  const handleTabClick = (id: string) => {
    setVisualTab(id as MirFunctionId | "search");
    // If it's an MIR function, select it for analysis
    if (id !== 'search') {
      setSelected(id as MirFunctionId);
    }
  };

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-zinc-100 font-sans text-zinc-900 dark:bg-zinc-900 dark:text-zinc-100">
      <header className="flex-none flex items-center justify-between border-b border-zinc-200 bg-white px-4 py-2 dark:border-zinc-800 dark:bg-zinc-950 h-12">
        <div className="flex items-center gap-1.5 px-4 text-xs font-medium text-zinc-900 dark:text-zinc-100">
          <div className="h-2 w-2 rounded-full bg-indigo-500" />
          <span className="hidden sm:inline">Octoseq</span>
        </div>

        <div className="flex items-center gap-2">
          {/* Load Audio Button (Hidden file input) */}
          <input
            type="file"
            accept="audio/*"
            className="hidden"
            ref={fileInputRef}
            onChange={(e) => {
              if (playerRef.current) {
                const f = e.target.files?.[0];
                if (f) playerRef.current.loadAudio(f);
              }
            }}
          />
          <Button
            size="sm"
            variant={!audio ? "default" : "outline"}
            className={`h-7 text-xs ${!audio ? "animate-pulse bg-blue-600 hover:bg-blue-700 text-white" : ""}`}
            onClick={() => fileInputRef.current?.click()}
          >
            Load Audio
          </Button>

          <a
            href="https://github.com/rewbs/octoseq"
            target="_blank"
            rel="noopener noreferrer"
            className="ml-2 flex items-center gap-1.5 text-zinc-500 transition-colors hover:text-zinc-900 dark:hover:text-zinc-200"
          >
            <Github className="h-3.5 w-3.5" />
          </a>
        </div>
      </header>

      {/* Main Content Area - Flex Column */}
      <div className="flex flex-1 flex-col min-h-0 relative">

        {/* Visualiser Section - 50% split */}
        <div className={`relative min-h-0 bg-black transition-all duration-300 ease-in-out flex-1`}>
          <VisualiserPanel
            audio={audio}
            playbackTime={mirroredCursorTimeSec}
            audioDuration={audioDuration}
            mirResults={mirResults as Record<string, number[]>}
            similarityCurve={searchSignal}
            className="w-full h-full"
            isPlaying={isPlaying}
          />
        </div>

        {/* Expanded Search Controls & Review Toolbar */}
        {visualTab === "search" && (
          <div className="flex-none border-b border-gray-200 bg-white p-2 dark:border-gray-800 dark:bg-zinc-950">
            <div className="flex items-center gap-4 overflow-x-auto">
              <SearchControlsPanel
                value={searchControls}
                onChange={setSearchControls}
                disabled={isSearchRunning || !audio}
                selectionDurationSec={
                  refinement.queryRegion ? refinement.queryRegion.endSec - refinement.queryRegion.startSec : null
                }
                useRefinement={useRefinementSearch}
                onUseRefinementChange={userSetUseRefinementRef.current || refinementLabelsAvailable ? setUseRefinementSearch : undefined}
                refinementAvailable={refinementLabelsAvailable}
              />

              <div className="flex flex-col items-center justify-center gap-1">
                <Button
                  size="sm"
                  className={`h-8 px-4 text-xs font-medium shadow-none ${isSearchRunning
                    ? "bg-zinc-100 text-zinc-400 dark:bg-zinc-800"
                    : "bg-indigo-600 text-white hover:bg-indigo-700 dark:bg-indigo-600 dark:hover:bg-indigo-500"
                    }`}
                  onClick={() => {
                    if (refinement.queryRegion)
                      void runSearch(refinement.queryRegion, searchControls).catch((e) => {
                        if ((e as Error)?.message === "cancelled") return;
                        console.error("[SEARCH] failed", e);
                      });
                  }}
                  disabled={isSearchRunning || !audio || !refinement.queryRegion}
                >
                  {isSearchRunning ? "..." : "Run Search"}
                </Button>
                {searchDirty && searchResult ? (
                  <span className="text-[10px] text-amber-600 dark:text-amber-400 font-medium whitespace-nowrap">
                    Has changes
                  </span>
                ) : null}
              </div>

              <div className="h-8 w-px bg-zinc-200 dark:bg-zinc-800" />

              <div className="flex-1 min-w-0">
                <SearchRefinementPanel
                  filter={candidateFilter}
                  onFilterChange={handleFilterChange}
                  candidatesTotal={refinement.candidates.length}
                  filteredTotal={filteredCandidates.length}
                  activeFilteredIndex={activeFilteredIndex}
                  activeCandidate={activeCandidate}
                  stats={refinement.refinementStats}
                  onPrev={onPrevCandidate}
                  onNext={onNextCandidate}
                  onAccept={acceptActive}
                  onReject={rejectActive}
                  onPlayCandidate={playActiveCandidate}
                  onPlayQuery={playQueryRegion}
                  loopCandidate={loopCandidate}
                  onLoopCandidateChange={setLoopCandidate}
                  autoPlayOnNavigate={autoPlayOnNavigate}
                  onAutoPlayOnNavigateChange={setAutoPlayOnNavigate}
                  addMissingMode={addMissingMode}
                  onToggleAddMissingMode={() => setAddMissingMode((v) => !v)}
                  canDeleteManual={activeCandidate?.source === "manual"}
                  onDeleteManual={deleteActiveManual}
                  onJumpToBestUnreviewed={refinement.refinementStats.unreviewed > 0 ? jumpToBestUnreviewed : undefined}
                  onCopyJson={copyRefinementJson}
                  disabled={!audio || !hasSearchResult}
                />
              </div>
            </div>
          </div>
        )}

        {/* Bottom Section - Waveform & Signals - 50% split */}
        <div className="flex-1 min-h-0 flex flex-col border-t border-gray-800 bg-zinc-50 dark:bg-zinc-950 overflow-hidden">

          {/* Signal Toolbar / Tabs */}
          <div className="flex-none h-12 border-b border-gray-200 dark:border-gray-800 flex items-center px-4 gap-2 bg-white dark:bg-black justify-between">
            <div className="flex items-center gap-2 overflow-x-auto">
              {tabDefs.map(({ id, label, hasData }) => {
                const active = visualTab === id;
                const base = "whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-medium transition-colors";
                const styles = active
                  ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-black"
                  : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700";
                return (
                  <button
                    key={id}
                    className={`${base} ${styles} ${hasData ? "" : "opacity-60"}`}
                    onClick={() => handleTabClick(id)}
                  >
                    {label}
                  </button>
                );
              })}
            </div>

            {/* Analysis Controls (Only for MIR tabs) */}
            {visualTab !== 'search' && audio && (
              <div className="flex items-center gap-2 border-l border-zinc-200 pl-4 dark:border-zinc-800">
                <MirControlPanel
                  selected={selected}
                  onSelectedChange={setSelected}
                  isRunning={isRunning}
                  onRun={() => void runAnalysis()}
                  onCancel={() => cancelAnalysis()}
                  config={{
                    fftSize,
                    setFftSize,
                    hopSize,
                    setHopSize,
                    melBands,
                    setMelBands,
                    melFMin,
                    setMelFMin,
                    melFMax,
                    setMelFMax,
                    onsetSmoothMs,
                    setOnsetSmoothMs,
                    onsetDiffMethod,
                    setOnsetDiffMethod,
                    onsetUseLog,
                    setOnsetUseLog,
                    peakMinIntervalMs,
                    setPeakMinIntervalMs,
                    peakThreshold,
                    setPeakThreshold,
                    peakAdaptiveFactor,
                    setPeakAdaptiveFactor,
                    hpssTimeMedian,
                    setHpssTimeMedian,
                    hpssFreqMedian,
                    setHpssFreqMedian,
                    mfccNCoeffs,
                    setMfccNCoeffs,
                    showDcBin,
                    setShowDcBin,
                    showMfccC0,
                    setShowMfccC0,
                  }}
                  disabled={!canRun}
                />
              </div>
            )}
          </div>

          {/* Scrollable Content (Waveform + Signal) */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {/* Main Waveform */}
            <div className="relative">
              <WaveSurferPlayer
                ref={playerRef}
                fileInputRef={fileInputRef}
                cursorTimeSec={mirroredCursorTimeSec}
                onCursorTimeChange={setCursorTimeSec}
                viewport={viewport}
                onPlayingChange={setIsPlaying}
                onConfigClick={() => setIsConfigOpen(true)}
                onDebugClick={() => setIsDebugOpen(true)}
                seekToTimeSec={waveformSeekTo}
                candidateCurveKind={searchResult?.curveKind}
                queryRegion={
                  refinement.queryRegion ? { startSec: refinement.queryRegion.startSec, endSec: refinement.queryRegion.endSec } : null
                }
                candidates={refinement.candidates}
                activeCandidateId={refinement.activeCandidateId}
                addMissingMode={addMissingMode}
                onSelectCandidateId={(candidateId) => {
                  setRefinement((prevState) => ({ ...prevState, activeCandidateId: candidateId }));
                  const c = candidateId ? candidatesById.get(candidateId) : null;
                  if (c) setWaveformSeekTo(c.startSec);
                }}
                onManualCandidateCreate={(c) => {
                  setRefinement((prevState) => {
                    if (prevState.candidates.some((x) => x.id === c.id)) return prevState;
                    const manual = { ...c, score: 1.0, status: "accepted", source: "manual" } as RefinementCandidate;
                    const next = [...prevState.candidates, manual].sort((a, b) => a.startSec - b.startSec);
                    return { ...prevState, candidates: next, activeCandidateId: c.id, refinementStats: computeRefinementStats(next) };
                  });
                  setWaveformSeekTo(c.startSec);
                }}
                onManualCandidateUpdate={(u) => {
                  setRefinement((prev) => {
                    const startSec = Math.min(u.startSec, u.endSec);
                    const endSec = Math.max(u.startSec, u.endSec);
                    const next = prev.candidates.map(c => c.id === u.id && c.source === 'manual' ? { ...c, startSec, endSec } : c).sort((a, b) => a.startSec - b.startSec);
                    return { ...prev, candidates: next, refinementStats: computeRefinementStats(next) };
                  });
                }}
                onAudioDecoded={(a) => {
                  setAudio(a);
                  setAudioFileName(fileInputRef.current?.files?.[0]?.name ?? null);
                  const ch0 = a.getChannelData(0);
                  setAudioDuration(ch0.length / a.sampleRate);
                  setAudioSampleRate(a.sampleRate);
                  setAudioTotalSamples(ch0.length);
                  setMirResults({});
                  setSearchResult(null);
                  setWaveformSeekTo(null);
                  setCandidateFilter("all");
                  setAddMissingMode(false);
                  setLoopCandidate(false);
                  setAutoPlayOnNavigate(false);
                  userSetUseRefinementRef.current = false;
                  setUseRefinementSearch(false);
                  setRefinement(makeInitialRefinementState());
                }}
                onViewportChange={(vp) => setViewport(normaliseViewport(vp))}
                onPlaybackTime={(t) => setPlayheadTimeSec(t)}
                onRegionChange={(r) => {
                  if (!r) {
                    setWaveformSeekTo(null);
                    setRefinement(makeInitialRefinementState());
                    return;
                  }
                  if (!audioSampleRate || !audioTotalSamples) return;
                  const startSec = Math.min(r.startSec, r.endSec);
                  const endSec = Math.max(r.startSec, r.endSec);
                  const startSample = Math.max(0, Math.min(audioTotalSamples, Math.floor(startSec * audioSampleRate)));
                  const endSample = Math.max(startSample, Math.min(audioTotalSamples, Math.floor(endSec * audioSampleRate)));
                  setRefinement((prev) => ({ ...prev, queryRegion: { startSec, endSec, startSample, endSample } }));
                }}
              />
            </div>

            {/* Secondary Signal Visualisation (Search Results / Feature Curves) */}
            {visualTab === "search" ? (
              hasSearchResult ? (
                <div className="space-y-2">
                  <SyncedWaveSurferSignal
                    data={searchSignal}
                    times={searchResult!.times}
                    viewport={viewport}
                    cursorTimeSec={mirroredCursorTimeSec}
                    onCursorTimeChange={setCursorTimeSec}
                    height={120}
                    overlayThreshold={searchControls.threshold}
                  />
                  <p className="text-[10px] text-zinc-500">
                    {searchResult?.curveKind === "confidence" ? "Confidence Curve" : "Similarity Curve"}
                  </p>
                </div>
              ) : (
                <div className="h-32 flex items-center justify-center text-zinc-400 text-sm border border-dashed border-zinc-700 rounded">
                  Select an audio region to search
                </div>
              )
            ) : (
              <>
                {/* Feature Views */}
                {(visualTab === "spectralCentroid" || visualTab === "spectralFlux" || visualTab === "onsetEnvelope") &&
                  tabResult?.kind === "1d" && tabResult.fn === visualTab && (
                    <SyncedWaveSurferSignal
                      data={tabResult.values}
                      times={tabResult.times}
                      viewport={viewport}
                      cursorTimeSec={mirroredCursorTimeSec}
                      onCursorTimeChange={setCursorTimeSec}
                      height={120}
                    />
                  )}
                {/* Events */}
                {visualTab === "onsetPeaks" && tabResult?.kind === "events" && tabResult.fn === "onsetPeaks" && (
                  <div className="relative h-[120px] bg-zinc-100 dark:bg-zinc-900 rounded" ref={eventsHostRef} onMouseMove={handleCursorHoverFromViewport} onMouseLeave={handleCursorLeave}>
                    <ViewportOverlayMarkers viewport={viewport} events={tabResult.events} height={120} />
                    <HeatmapPlayheadOverlay viewport={viewport} timeSec={mirroredCursorTimeSec} height={120} widthPx={eventsHostSize.width} />
                  </div>
                )}
                {/* 2D Heatmaps */}
                {(visualTab === "melSpectrogram" || visualTab === "hpssHarmonic" || visualTab === "hpssPercussive" || visualTab === "mfcc") &&
                  tabResult?.kind === "2d" && tabResult.fn === visualTab && (
                    <div ref={heatmapHostRef} className="relative h-[200px] w-full rounded bg-zinc-900 overflow-hidden">
                      <TimeAlignedHeatmapPixi
                        input={{ data: tabResult.raw.data, times: tabResult.raw.times }}
                        startTime={viewport?.startTime ?? 0}
                        endTime={viewport?.endTime ?? 10}
                        width={heatmapHostSize.width || 800}
                        height={200}
                        colorScheme={heatmapScheme}
                      />
                      <HeatmapPlayheadOverlay viewport={viewport} timeSec={mirroredCursorTimeSec} height={200} />
                    </div>
                  )}
              </>
            )}
          </div>
        </div>

        <MirConfigModal
          open={isConfigOpen}
          onOpenChange={setIsConfigOpen}
          config={{
            fftSize, setFftSize,
            hopSize, setHopSize,
            melBands, setMelBands,
            melFMin, setMelFMin,
            melFMax, setMelFMax,
            onsetSmoothMs, setOnsetSmoothMs,
            onsetDiffMethod, setOnsetDiffMethod,
            onsetUseLog, setOnsetUseLog,
            peakMinIntervalMs, setPeakMinIntervalMs,
            peakThreshold, setPeakThreshold,
            peakAdaptiveFactor, setPeakAdaptiveFactor,
            hpssTimeMedian, setHpssTimeMedian,
            hpssFreqMedian, setHpssFreqMedian,
            mfccNCoeffs, setMfccNCoeffs,
            showDcBin, setShowDcBin,
            showMfccC0, setShowMfccC0,
          }}
        />

        <DebugPanel
          isOpen={isDebugOpen}
          onClose={() => setIsDebugOpen(false)}
          stats={{
            timings: lastRunTimings ?? searchResult?.timings,
            audio: {
              sampleRate: audioSampleRate,
              totalSamples: audioTotalSamples,
              duration: audioDuration,
            }
          }}
          debug={debug}
          setDebug={setDebug}
          useWorker={useWorker}
          setUseWorker={setUseWorker}
          enableGpu={enableGpu}
          setEnableGpu={setEnableGpu}
        />
      </div>
    </div>
  );
}
