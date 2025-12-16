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

import { Button } from "@/components/ui/button";
import { prepareHpssSpectrogramForHeatmap, prepareMfccForHeatmap } from "@/lib/mirDisplayTransforms";
import { runMir } from "@octoseq/mir/runner/runMir";

import { HeatmapPlayheadOverlay } from "@/components/heatmap/HeatmapPlayheadOverlay";
import { TimeAlignedHeatmapPixi, type TimeAlignedHeatmapData, type HeatmapColorScheme } from "@/components/heatmap/TimeAlignedHeatmapPixi";
import { MirControlPanel, type MirFunctionId } from "@/components/mir/MirControlPanel";
import { SyncedWaveSurferSignal } from "@/components/wavesurfer/SyncedWaveSurferSignal";
import { ViewportOverlayMarkers } from "@/components/wavesurfer/ViewportOverlayMarkers";
import { WaveSurferPlayer, type WaveSurferPlayerHandle } from "@/components/wavesurfer/WaveSurferPlayer";
import type { WaveSurferViewport } from "@/components/wavesurfer/types";
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

type UiMirResult =
  | { kind: "none" }
  | { kind: "1d"; fn: MirFunctionId; times: Float32Array; values: Float32Array }
  | { kind: "2d"; fn: MirFunctionId; raw: TimeAlignedHeatmapData }
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

  const [mirResults, setMirResults] = useState<Partial<Record<MirFunctionId, UiMirResult>>>({});

  const canRun = !!audio;

  // Debug toggles for validating worker + GPU pathways.
  const [debug, setDebug] = useState(false);
  const [useWorker, setUseWorker] = useState(true);
  const [enableGpu, setEnableGpu] = useState(true);
  const [heatmapScheme, setHeatmapScheme] = useState<HeatmapColorScheme>("grayscale");

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

        const r: UiMirResult = {
          kind: "1d",
          fn: selected,
          times: result.times,
          values: norm,
        };
        setMirResults((prev) => ({ ...prev, [selected]: r }));
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

	  const activeCandidateGroupLogit = useMemo(() => {
	    if (!searchResult || !activeCandidate) return null;
	    const startMs = Math.round(activeCandidate.startSec * 1000);
	    const endMs = Math.round(activeCandidate.endSec * 1000);
	    const match = searchResult.candidates.find(
	      (c) => Math.round(c.windowStartSec * 1000) === startMs && Math.round(c.windowEndSec * 1000) === endMs
	    );
	    return match?.explain?.groupLogit ?? null;
	  }, [activeCandidate, searchResult]);

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
      { id: "search", label: "Similarity", hasData: hasSearchResult },
      ...mirTabsWithAvailability,
    ];
  }, [hasSearchResult, mirResults, mirTabs]);

  useEffect(() => {
    // Ensure the selected tab id exists; prefer similarity first.
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

  const usesMel =
    selected === "melSpectrogram" ||
    selected === "onsetEnvelope" ||
    selected === "onsetPeaks" ||
    selected === "mfcc" ||
    selected === "mfccDelta" ||
    selected === "mfccDeltaDelta";
  const usesOnset = selected === "onsetEnvelope" || selected === "onsetPeaks";
  const usesPeakPick = selected === "onsetPeaks";
  const usesHpss = selected === "hpssHarmonic" || selected === "hpssPercussive";
  const usesMfcc = selected === "mfcc" || selected === "mfccDelta" || selected === "mfccDeltaDelta";
  const usesHeatmapFn =
    selected === "melSpectrogram" ||
    selected === "hpssHarmonic" ||
    selected === "hpssPercussive" ||
    selected === "mfcc" ||
    selected === "mfccDelta" ||
    selected === "mfccDeltaDelta";

  const visibleRange = useMemo(() => {
    // If we don't have a viewport yet (e.g. before first scroll interaction),
    // fall back to the full audio duration so visualisations have a non-empty window.
    if (!viewport) {
      return { startTime: 0, endTime: audioDuration };
    }
    return { startTime: viewport.startTime, endTime: viewport.endTime };
  }, [viewport, audioDuration]);

  const tabResult = visualTab !== "search" ? mirResults[visualTab as MirFunctionId] : undefined;

  const displayedHeatmap = useMemo<TimeAlignedHeatmapData | null>(() => {
    if (!tabResult || tabResult.kind !== "2d") return null;

    const { raw, fn } = tabResult;

    const displayData =
      fn === "hpssHarmonic" || fn === "hpssPercussive"
        ? prepareHpssSpectrogramForHeatmap(raw.data, { showDc: showDcBin, useDb: true, minDb: -80, maxDb: 0 })
        : fn === "mfcc" || fn === "mfccDelta" || fn === "mfccDeltaDelta"
          ? prepareMfccForHeatmap(raw.data, { showC0: showMfccC0 })
          : raw.data;

    return { data: displayData, times: raw.times };
  }, [tabResult, showDcBin, showMfccC0]);

  const heatmapValueRange = useMemo(() => {
    if (!tabResult || tabResult.kind !== "2d") return undefined;
    const fn = tabResult.fn;

    // For HPSS + MFCC we pre-normalise to [0,1], so use a fixed colormap range.
    if (fn === "hpssHarmonic" || fn === "hpssPercussive" || fn === "mfcc" || fn === "mfccDelta" || fn === "mfccDeltaDelta") {
      return { min: 0, max: 1 };
    }

    return undefined;
  }, [tabResult]);

  const heatmapYAxisLabel = useMemo(() => {
    if (!tabResult || tabResult.kind !== "2d") return "feature index";
    const fn = tabResult.fn;

    // MFCC coefficients are DCT basis weights (not frequency bins).
    if (fn === "mfcc" || fn === "mfccDelta" || fn === "mfccDeltaDelta") return "MFCC index";

    return "frequency bin";
  }, [tabResult]);

  const { ref: heatmapHostRef, size: heatmapHostSize } = useElementSize<HTMLDivElement>();
  const { ref: eventsHostRef, size: eventsHostSize } = useElementSize<HTMLDivElement>();

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 font-sans dark:bg-black">
      <main className="w-full max-w-[1600px] rounded-2xl bg-white p-10 shadow-sm dark:bg-black">
        <h1 className="text-3xl font-semibold tracking-tight text-black dark:text-zinc-50">Octoseq</h1>

        <div className="mt-6 flex flex-col gap-3 rounded-xl border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-950 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-sm text-zinc-700 dark:text-zinc-200">
            Load a local audio file to drive the analyses below.
          </div>
          <Button className="w-full sm:w-auto" onClick={() => fileInputRef.current?.click()}>
            Load audio file
          </Button>
        </div>

        <section className="mt-10">
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
              <div className="mt-3 space-y-4">
                <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                  <label className="grid grid-cols-[160px,1fr] items-center gap-2">
                    <span className="text-xs text-zinc-600 dark:text-zinc-300">FFT size (power of 2)</span>
                    <input
                      type="number"
                      min={64}
                      step={64}
                      value={fftSize}
                      onChange={(e) => setFftSize(Math.max(64, Math.floor(Number(e.target.value)) || 64))}
                      className="rounded border border-zinc-200 bg-white px-2 py-1 text-sm dark:border-zinc-800 dark:bg-zinc-950"
                    />
                  </label>
                  <label className="grid grid-cols-[160px,1fr] items-center gap-2">
                    <span className="text-xs text-zinc-600 dark:text-zinc-300">Hop size</span>
                    <input
                      type="number"
                      min={1}
                      step={16}
                      value={hopSize}
                      onChange={(e) => setHopSize(Math.max(1, Math.floor(Number(e.target.value)) || 1))}
                      className="rounded border border-zinc-200 bg-white px-2 py-1 text-sm dark:border-zinc-800 dark:bg-zinc-950"
                    />
                  </label>
                </div>

                {usesMel && (
                  <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                    <label className="grid grid-cols-[160px,1fr] items-center gap-2">
                      <span className="text-xs text-zinc-600 dark:text-zinc-300">Mel bands (nMels)</span>
                      <input
                        type="number"
                        min={1}
                        max={256}
                        step={1}
                        value={melBands}
                        onChange={(e) => setMelBands(Math.max(1, Math.floor(Number(e.target.value)) || 1))}
                        className="rounded border border-zinc-200 bg-white px-2 py-1 text-sm dark:border-zinc-800 dark:bg-zinc-950"
                      />
                    </label>
                    <label className="grid grid-cols-[160px,1fr] items-center gap-2">
                      <span className="text-xs text-zinc-600 dark:text-zinc-300">Mel fMin (Hz)</span>
                      <input
                        type="number"
                        min={0}
                        step={10}
                        value={melFMin}
                        onChange={(e) => setMelFMin(e.target.value)}
                        placeholder="default"
                        className="rounded border border-zinc-200 bg-white px-2 py-1 text-sm dark:border-zinc-800 dark:bg-zinc-950"
                      />
                    </label>
                    <label className="grid grid-cols-[160px,1fr] items-center gap-2">
                      <span className="text-xs text-zinc-600 dark:text-zinc-300">Mel fMax (Hz)</span>
                      <input
                        type="number"
                        min={0}
                        step={10}
                        value={melFMax}
                        onChange={(e) => setMelFMax(e.target.value)}
                        placeholder="default (Nyquist)"
                        className="rounded border border-zinc-200 bg-white px-2 py-1 text-sm dark:border-zinc-800 dark:bg-zinc-950"
                      />
                    </label>
                  </div>
                )}

                {usesOnset && (
                  <div className="space-y-2">
                    <label className="grid grid-cols-[180px,1fr,60px] items-center gap-2">
                      <span className="text-xs text-zinc-600 dark:text-zinc-300">Onset smoothing (ms)</span>
                      <input
                        type="range"
                        min={0}
                        max={200}
                        step={5}
                        value={onsetSmoothMs}
                        onChange={(e) => setOnsetSmoothMs(Number(e.target.value))}
                      />
                      <span className="text-right text-xs tabular-nums text-zinc-600 dark:text-zinc-300">{onsetSmoothMs}</span>
                    </label>

                    <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                      <label className="grid grid-cols-[160px,1fr] items-center gap-2">
                        <span className="text-xs text-zinc-600 dark:text-zinc-300">Diff method</span>
                        <select
                          value={onsetDiffMethod}
                          onChange={(e) => setOnsetDiffMethod(e.target.value as typeof onsetDiffMethod)}
                          className="rounded-md border border-zinc-200 bg-white px-2 py-1 text-sm dark:border-zinc-800 dark:bg-zinc-950"
                        >
                          <option value="rectified">Rectified (positive only)</option>
                          <option value="abs">Absolute</option>
                        </select>
                      </label>
                      <label className="inline-flex items-center gap-2">
                        <input type="checkbox" checked={onsetUseLog} onChange={(e) => setOnsetUseLog(e.target.checked)} />
                        <span className="text-xs text-zinc-600 dark:text-zinc-300">Log-compress differences</span>
                      </label>
                    </div>
                  </div>
                )}

                {usesPeakPick && (
                  <div className="space-y-2">
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

                    <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
                      <label className="grid grid-cols-[140px,1fr] items-center gap-2">
                        <span className="text-xs text-zinc-600 dark:text-zinc-300">Peak threshold</span>
                        <input
                          type="number"
                          step={0.01}
                          value={peakThreshold}
                          onChange={(e) => setPeakThreshold(e.target.value)}
                          placeholder="auto"
                          className="rounded border border-zinc-200 bg-white px-2 py-1 text-sm dark:border-zinc-800 dark:bg-zinc-950"
                        />
                      </label>
                      <label className="grid grid-cols-[140px,1fr] items-center gap-2">
                        <span className="text-xs text-zinc-600 dark:text-zinc-300">Adaptive factor</span>
                        <input
                          type="number"
                          step={0.1}
                          value={peakAdaptiveFactor}
                          onChange={(e) => setPeakAdaptiveFactor(e.target.value)}
                          placeholder="blank = off"
                          className="rounded border border-zinc-200 bg-white px-2 py-1 text-sm dark:border-zinc-800 dark:bg-zinc-950"
                        />
                      </label>
                    </div>
                  </div>
                )}

                {usesHpss && (
                  <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                    <label className="grid grid-cols-[160px,1fr] items-center gap-2">
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
                    <label className="grid grid-cols-[160px,1fr] items-center gap-2">
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
                )}

                {usesMfcc && (
                  <label className="grid grid-cols-[180px,1fr] items-center gap-2">
                    <span className="text-xs text-zinc-600 dark:text-zinc-300">MFCC nCoeffs</span>
                    <input
                      type="number"
                      min={1}
                      max={40}
                      step={1}
                      value={mfccNCoeffs}
                      onChange={(e) => setMfccNCoeffs(Math.max(1, Math.floor(Number(e.target.value)) || 1))}
                      className="rounded border border-zinc-200 bg-white px-2 py-1 text-sm dark:border-zinc-800 dark:bg-zinc-950"
                    />
                  </label>
                )}

                {(usesHpss || usesMfcc) && (
                  <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                    {usesHpss && (
                      <label className="inline-flex items-center gap-2">
                        <input type="checkbox" checked={showDcBin} onChange={(e) => setShowDcBin(e.target.checked)} />
                        <span className="text-xs text-zinc-600 dark:text-zinc-300">Show DC bin (spectrogram display)</span>
                      </label>
                    )}
                    {usesMfcc && (
                      <label className="inline-flex items-center gap-2">
                        <input type="checkbox" checked={showMfccC0} onChange={(e) => setShowMfccC0(e.target.checked)} />
                        <span className="text-xs text-zinc-600 dark:text-zinc-300">Show MFCC C0 (display)</span>
                      </label>
                    )}
                  </div>
                )}

                {usesHeatmapFn && (
                  <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                    <label className="grid grid-cols-[160px,1fr] items-center gap-2">
                      <span className="text-xs text-zinc-600 dark:text-zinc-300">Heatmap colour scheme</span>
                      <select
                        value={heatmapScheme}
                        onChange={(e) => setHeatmapScheme(e.target.value as HeatmapColorScheme)}
                        className="rounded-md border border-zinc-200 bg-white px-2 py-1 text-sm dark:border-zinc-800 dark:bg-zinc-950"
                      >
                        <option value="grayscale">Grayscale</option>
                        <option value="viridis">Viridis</option>
                        <option value="plasma">Plasma</option>
                        <option value="magma">Magma</option>
                      </select>
                    </label>
                  </div>
                )}

                <p className="text-xs text-zinc-500">Config applies only to the currently selected MIR function.</p>
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

                  {tabResult?.kind === "2d" && (
                    <div className="mt-2 text-xs text-zinc-600 dark:text-zinc-300">
                      raw shape: <code>{tabResult.raw.data.length}</code> frames ×{" "}
                      <code>{tabResult.raw.data[0]?.length ?? 0}</code>
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
          <div className="space-y-4">
	            <div className="flex flex-col gap-2 rounded-xl border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-950">
	              <SearchControlsPanel
	                value={searchControls}
	                onChange={(next) => setSearchControls(next)}
	                disabled={!audio || !refinement.queryRegion}
                  useRefinement={useRefinementSearch}
                  onUseRefinementChange={(next) => {
                    userSetUseRefinementRef.current = true;
                    setUseRefinementSearch(next);
                  }}
                  refinementAvailable={refinementLabelsAvailable}
	                selectionDurationSec={
	                  refinement.queryRegion ? Math.max(0, Math.abs(refinement.queryRegion.endSec - refinement.queryRegion.startSec)) : null
	                }
	              />
	              <div className="flex flex-wrap items-center gap-2">
	                <Button
	                  onClick={() => {
	                    if (refinement.queryRegion)
	                      void runSearch(refinement.queryRegion, searchControls).catch((e) => {
	                        if ((e as Error)?.message === "cancelled") return;
	                        console.error("[SEARCH] failed", e);
	                      });
	                  }}
	                  disabled={!audio || !refinement.queryRegion || isSearchRunning}
	                >
	                  Run search
	                </Button>
	                <Button
	                  variant="outline"
	                  onClick={() => {
	                    if (refinement.queryRegion)
	                      void runSearch(refinement.queryRegion, searchControls).catch((e) => {
	                        if ((e as Error)?.message === "cancelled") return;
	                        console.error("[SEARCH] failed", e);
	                      });
	                  }}
	                  disabled={!audio || !refinement.queryRegion || isSearchRunning}
	                >
	                  Recompute features &amp; search
	                </Button>
                {searchDirty && searchResult ? (
                  <span className="text-xs text-amber-600 dark:text-amber-400">Parameters changed — rerun search</span>
                ) : null}
                {isSearchRunning ? (
                  <span className="inline-flex items-center gap-1 text-xs text-zinc-600 dark:text-zinc-300">
                    <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" />
                    Running search…
                  </span>
                ) : null}
              </div>
              <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                Search is manual: adjust selection/controls then click Run search to recompute features and similarity.
              </p>
              {searchResult && (
                <div className="rounded-md border border-zinc-200 bg-white p-2 text-xs text-zinc-700 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-200">
                  <div>
                    <span className="text-zinc-500">Search timings</span>: fp <code>{searchResult.timings.fingerprintMs.toFixed(1)}ms</code>, scan{" "}
                    <code>{searchResult.timings.scanMs.toFixed(1)}ms</code>
                    {searchResult.timings.modelMs != null ? (
                      <>
                        , model <code>{searchResult.timings.modelMs.toFixed(1)}ms</code>
                      </>
                    ) : null}
                    , total <code>{searchResult.timings.totalMs.toFixed(1)}ms</code>
                  </div>
                  <div>
                    <span className="text-zinc-500">Curve</span>: <code>{searchResult.curveKind}</code> · model{" "}
                    <code>{searchResult.model.kind}</code> · pos <code>{searchResult.model.positives}</code> · neg{" "}
                    <code>{searchResult.model.negatives}</code>
	                  </div>
	                  {searchResult.model.weightL2 ? (
	                    <div>
	                      <span className="text-zinc-500">Model weight L2</span>: mel <code>{searchResult.model.weightL2.mel.toFixed(3)}</code> (fg{" "}
	                      <code>{searchResult.model.weightL2.melForeground.toFixed(3)}</code>
	                      {searchResult.model.weightL2.melContrast != null ? (
	                        <>
	                          , ct <code>{searchResult.model.weightL2.melContrast.toFixed(3)}</code>
	                        </>
	                      ) : null}
	                      ), onset <code>{searchResult.model.weightL2.onset.toFixed(3)}</code> (fg{" "}
	                      <code>{searchResult.model.weightL2.onsetForeground.toFixed(3)}</code>
	                      {searchResult.model.weightL2.onsetContrast != null ? (
	                        <>
	                          , ct <code>{searchResult.model.weightL2.onsetContrast.toFixed(3)}</code>
	                        </>
	                      ) : null}
	                      )
	                      {searchResult.model.weightL2.mfcc != null && searchResult.model.weightL2.mfccForeground != null ? (
	                        <>
	                          , mfcc <code>{searchResult.model.weightL2.mfcc.toFixed(3)}</code> (fg{" "}
	                          <code>{searchResult.model.weightL2.mfccForeground.toFixed(3)}</code>
	                          {searchResult.model.weightL2.mfccContrast != null ? (
	                            <>
	                              , ct <code>{searchResult.model.weightL2.mfccContrast.toFixed(3)}</code>
	                            </>
	                          ) : null}
	                          )
	                        </>
	                      ) : null}
	                    </div>
	                  ) : null}
	                  <div>
	                    <span className="text-zinc-500">Window / hop</span>: <code>{searchResult.meta.windowSec.toFixed(3)}s</code> window,{" "}
	                    <code>{Math.round(searchResult.meta.hopSec * 1000)}ms</code> hop; scanned <code>{searchResult.meta.scannedWindows}</code>, skipped{" "}
                    <code>{searchResult.meta.skippedWindows}</code>
                  </div>
	                  <div>
	                    <span className="text-zinc-500">Candidates</span>: <code>{searchResult.candidates.length}</code>
	                  </div>
		                  {refinement.activeCandidateId ? (
		                    <div>
		                      <span className="text-zinc-500">Active</span>:{" "}
		                      <code>{refinement.activeCandidateId}</code>
		                    </div>
		                  ) : null}
		                  {activeCandidateGroupLogit ? (
		                    <div>
		                      <span className="text-zinc-500">Active group logit</span>: total{" "}
		                      <code>{activeCandidateGroupLogit.logit.toFixed(3)}</code> (bias{" "}
		                      <code>{activeCandidateGroupLogit.bias.toFixed(3)}</code>, mel{" "}
		                      <code>{activeCandidateGroupLogit.mel.toFixed(3)}</code>, onset{" "}
		                      <code>{activeCandidateGroupLogit.onset.toFixed(3)}</code>
		                      {activeCandidateGroupLogit.mfcc != null ? (
		                        <>
		                          , mfcc <code>{activeCandidateGroupLogit.mfcc.toFixed(3)}</code>
		                        </>
		                      ) : null}
		                      )
		                    </div>
		                  ) : null}
		                </div>
			              )}
			            </div>

		            {refinement.candidates.length > 0 ? (
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
		                disabled={!audio}
		              />
		            ) : null}

		            <WaveSurferPlayer
		              ref={playerRef}
		              fileInputRef={fileInputRef}
		              cursorTimeSec={mirroredCursorTimeSec}
		              onCursorTimeChange={setCursorTimeSec}
		              viewport={viewport}
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
		                  const manualCandidate = {
		                    id: c.id,
		                    startSec: c.startSec,
		                    endSec: c.endSec,
		                    score: 1.0,
		                    status: "accepted",
		                    source: "manual",
		                  } satisfies RefinementCandidate;
		                  const nextCandidates = [...prevState.candidates, manualCandidate].sort((a, b) => a.startSec - b.startSec);
		                  return {
		                    ...prevState,
		                    candidates: nextCandidates,
		                    activeCandidateId: c.id,
		                    refinementStats: computeRefinementStats(nextCandidates),
		                  };
		                });
		                setWaveformSeekTo(c.startSec);
		              }}
		              onManualCandidateUpdate={(u) => {
		                setRefinement((prevState) => {
		                  const startSec = Math.min(u.startSec, u.endSec);
		                  const endSec = Math.max(u.startSec, u.endSec);
		                  const nextCandidates = prevState.candidates
		                    .map((c) => {
		                    if (c.id !== u.id) return c;
		                    if (c.source !== "manual") return c;
		                    return { ...c, startSec, endSec };
		                  })
		                    .sort((a, b) => a.startSec - b.startSec);
		                  return { ...prevState, candidates: nextCandidates, refinementStats: computeRefinementStats(nextCandidates) };
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
	                setRefinement((prevState) => ({
	                  ...prevState,
		                  queryRegion: { startSec, endSec, startSample, endSample },
		                }));
		              }}
		            />

            <div className="mt-2">
              <div className="mb-3 flex flex-wrap items-center gap-2">
                {tabDefs.map(({ id, label, hasData }) => {
                  const active = visualTab === id;
                  const base = "rounded-md px-3 py-1 text-sm transition-colors";
                  const styles = active
                    ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-black"
                    : "bg-zinc-200 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-100";
                  return (
                    <button
                      key={id}
                      className={`${base} ${styles} ${hasData ? "" : "opacity-60"}`}
                      onClick={() => setVisualTab(id)}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>

              {visualTab === "search" ? (
                hasSearchResult ? (
                  <div className="space-y-2">
                    <SyncedWaveSurferSignal
                      data={searchSignal}
                      times={searchResult!.times}
                      viewport={viewport}
                      cursorTimeSec={mirroredCursorTimeSec}
                      onCursorTimeChange={setCursorTimeSec}
                      height={200}
                      overlayThreshold={searchControls.threshold}
                    />
                    <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                      {searchResult?.curveKind === "confidence"
                        ? "Track-wide confidence curve (0–1, normalised for display). Peaks above the threshold become candidates."
                        : "Track-wide similarity curve (0–1, normalised for display). Peaks above the threshold become candidates."}
                    </p>
                  </div>
                ) : (
                  <p className="text-sm text-zinc-500">Run a search to see the similarity curve.</p>
                )
              ) : (
                <>
                  {visualTab === "spectralCentroid" || visualTab === "spectralFlux" || visualTab === "onsetEnvelope" ? (
                    tabResult?.kind === "1d" && tabResult.fn === visualTab ? (
                      <div className="-mt-1">
                        <SyncedWaveSurferSignal
                          data={tabResult.values}
                          times={tabResult.times}
                          viewport={viewport}
                          cursorTimeSec={mirroredCursorTimeSec}
                          onCursorTimeChange={setCursorTimeSec}
                          height={200}
                        />
                      </div>
                    ) : (
                      <p className="text-sm text-zinc-500">Run {visualTab} to view output.</p>
                    )
                  ) : null}

                  {visualTab === "onsetPeaks" ? (
                    tabResult?.kind === "events" && tabResult.fn === "onsetPeaks" ? (
                      <div className="-mt-1">
                        <div
                          className="relative rounded-xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-950"
                          ref={eventsHostRef}
                          onMouseMove={handleCursorHoverFromViewport}
                          onMouseLeave={handleCursorLeave}
                        >
                          <ViewportOverlayMarkers viewport={viewport} events={tabResult.events} height={180} />
                          <HeatmapPlayheadOverlay viewport={viewport} timeSec={mirroredCursorTimeSec} height={180} widthPx={eventsHostSize.width} />
                        </div>
                      </div>
                    ) : (
                      <p className="text-sm text-zinc-500">Run Onset Peaks to view output.</p>
                    )
                  ) : null}

                  {visualTab === "melSpectrogram" ||
                  visualTab === "hpssHarmonic" ||
                  visualTab === "hpssPercussive" ||
                  visualTab === "mfcc" ||
                  visualTab === "mfccDelta" ||
                  visualTab === "mfccDeltaDelta" ? (
                    tabResult?.kind === "2d" && tabResult.fn === visualTab ? (
                      <div className="-mt-1" ref={heatmapHostRef}>
                        <div className="relative" onMouseMove={handleCursorHoverFromViewport} onMouseLeave={handleCursorLeave}>
                          <TimeAlignedHeatmapPixi
                            input={displayedHeatmap}
                            startTime={visibleRange.startTime}
                            endTime={visibleRange.endTime}
                            width={Math.floor(heatmapHostSize.width || 0)}
                            height={320}
                            valueRange={heatmapValueRange}
                            yLabel={heatmapYAxisLabel}
                            colorScheme={heatmapScheme}
                          />
                          <HeatmapPlayheadOverlay viewport={viewport} timeSec={mirroredCursorTimeSec} height={320} widthPx={heatmapHostSize.width} />
                        </div>
                      </div>
                    ) : (
                      <p className="text-sm text-zinc-500">Run {visualTab} to view output.</p>
                    )
                  ) : null}
                </>
              )}
            </div>
          </div>
        </section>

      </main>
    </div>
  );
}
