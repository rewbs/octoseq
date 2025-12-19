"use client";

import { useCallback, useEffect, useRef, type MouseEvent } from "react";
import { useShallow } from "zustand/react/shallow";

import { Github } from "lucide-react";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Button } from "@/components/ui/button";

import { HeatmapPlayheadOverlay } from "@/components/heatmap/HeatmapPlayheadOverlay";
import { TimeAlignedHeatmapPixi } from "@/components/heatmap/TimeAlignedHeatmapPixi";
import { MirConfigModal } from "@/components/mir/MirConfigModal";
import { SyncedWaveSurferSignal } from "@/components/wavesurfer/SyncedWaveSurferSignal";
import { ViewportOverlayMarkers } from "@/components/wavesurfer/ViewportOverlayMarkers";
import { WaveSurferPlayer, type WaveSurferPlayerHandle } from "@/components/wavesurfer/WaveSurferPlayer";
import { VisualiserPanel } from "@/components/visualiser/VisualiserPanel";
import { SearchPanel } from "@/components/search/SearchPanel";
import { DebugPanel } from "@/components/panels/DebugPanel";
import { useElementSize } from "@/lib/useElementSize";
import { computeRefinementStats } from "@/lib/searchRefinement";
import { useKeyboardShortcuts } from "@/lib/hooks/useKeyboardShortcuts";
import type { MirFunctionId } from "@/components/mir/MirControlPanel";

// Stores and hooks
import {
  useAudioStore,
  usePlaybackStore,
  useConfigStore,
  useMirStore,
  useSearchStore,
  useMirActions,
  useSearchActions,
  useNavigationActions,
  useAudioActions,
  useCandidatesById,
  useActiveCandidate,
  useSearchSignal,
  useHasSearchResult,
  useRefinementLabelsAvailable,
  useTabDefs,
  useTabResult,
  useDisplayedHeatmap,
  useHeatmapValueRange,
  useHeatmapYAxisLabel,
  useVisibleRange,
  useMirroredCursorTime,
} from "@/lib/stores";

export default function Home() {
  // ===== REFS (stay in component) =====
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const playerRef = useRef<WaveSurferPlayerHandle | null>(null);
  const lastSelectionRef = useRef<{ startSec: number; endSec: number } | null>(null);
  const userSetUseRefinementRef = useRef(false);

  // ===== STORE STATE =====
  // Audio store
  const audio = useAudioStore((s) => s.audio);
  const audioSampleRate = useAudioStore((s) => s.audioSampleRate);
  const audioTotalSamples = useAudioStore((s) => s.audioTotalSamples);
  const audioDuration = useAudioStore((s) => s.audioDuration);

  // Playback store
  const playheadTimeSec = usePlaybackStore((s) => s.playheadTimeSec);
  const isAudioPlaying = usePlaybackStore((s) => s.isAudioPlaying);
  const viewport = usePlaybackStore((s) => s.viewport);
  const waveformSeekTo = usePlaybackStore((s) => s.waveformSeekTo);
  const {
    setPlayheadTimeSec,
    setCursorTimeSec,
    setIsAudioPlaying,
    setViewport,
    setWaveformSeekTo,
    normalizeViewport,
  } = usePlaybackStore(
    useShallow((s) => ({
      setPlayheadTimeSec: s.setPlayheadTimeSec,
      setCursorTimeSec: s.setCursorTimeSec,
      setIsAudioPlaying: s.setIsAudioPlaying,
      setViewport: s.setViewport,
      setWaveformSeekTo: s.setWaveformSeekTo,
      normalizeViewport: s.normalizeViewport,
    }))
  );

  // Config store - only what's needed in page.tsx
  const heatmapScheme = useConfigStore((s) => s.heatmapScheme);
  const setIsConfigOpen = useConfigStore((s) => s.setIsConfigOpen);
  const setIsDebugOpen = useConfigStore((s) => s.setIsDebugOpen);

  // MIR store
  const mirResults = useMirStore((s) => s.mirResults);
  const isRunning = useMirStore((s) => s.isRunning);
  const visualTab = useMirStore((s) => s.visualTab);
  const { setSelected, setVisualTab } = useMirStore(
    useShallow((s) => ({
      setSelected: s.setSelected,
      setVisualTab: s.setVisualTab,
    }))
  );

  // Search store
  const searchControls = useSearchStore((s) => s.searchControls);
  const searchResult = useSearchStore((s) => s.searchResult);
  const searchDirty = useSearchStore((s) => s.searchDirty);
  const isSearchRunning = useSearchStore((s) => s.isSearchRunning);
  const refinement = useSearchStore((s) => s.refinement);
  const addMissingMode = useSearchStore((s) => s.addMissingMode);
  const {
    setSearchResult,
    setSearchDirty,
    setRefinement,
    setCandidateFilter,
    setAddMissingMode,
    setUseRefinementSearch,
    addManualCandidate,
    updateManualCandidate,
  } = useSearchStore(
    useShallow((s) => ({
      setSearchResult: s.setSearchResult,
      setSearchDirty: s.setSearchDirty,
      setRefinement: s.setRefinement,
      setCandidateFilter: s.setCandidateFilter,
      setAddMissingMode: s.setAddMissingMode,
      setUseRefinementSearch: s.setUseRefinementSearch,
      addManualCandidate: s.addManualCandidate,
      updateManualCandidate: s.updateManualCandidate,
    }))
  );

  // ===== ACTION HOOKS =====
  const { runAnalysis, cancelAnalysis } = useMirActions();
  const { runSearch } = useSearchActions();
  const { handleAudioDecoded, triggerFileInput } = useAudioActions({ fileInputRef });
  const {
    onPrevCandidate,
    onNextCandidate,
    playQueryRegion,
    togglePlayShortcut,
    acceptActive,
    rejectActive,
    deleteActiveManual,
    jumpToBestUnreviewed,
  } = useNavigationActions({ playerRef });

  // ===== DERIVED STATE HOOKS =====
  const candidatesById = useCandidatesById();
  const activeCandidate = useActiveCandidate();
  const searchSignal = useSearchSignal();
  const hasSearchResult = useHasSearchResult();
  const refinementLabelsAvailable = useRefinementLabelsAvailable();
  const tabDefs = useTabDefs();
  const tabResult = useTabResult();
  const displayedHeatmap = useDisplayedHeatmap();
  const heatmapValueRange = useHeatmapValueRange();
  const heatmapYAxisLabel = useHeatmapYAxisLabel();
  const visibleRange = useVisibleRange();
  const mirroredCursorTimeSec = useMirroredCursorTime();

  // ===== COMPUTED VALUES =====
  const canRun = !!audio;

  // ===== KEYBOARD SHORTCUTS =====
  useKeyboardShortcuts({
    onPrevCandidate,
    onNextCandidate,
    onAccept: acceptActive,
    onReject: rejectActive,
    onTogglePlay: togglePlayShortcut,
    onPlayQuery: playQueryRegion,
    onToggleAddMissingMode: () => setAddMissingMode(!addMissingMode),
    onDeleteManual: deleteActiveManual,
    onJumpToBestUnreviewed: jumpToBestUnreviewed,
    canDeleteManual: activeCandidate?.source === "manual",
  });

  // ===== EFFECTS =====
  // Auto-enable refinement when labels available
  useEffect(() => {
    if (userSetUseRefinementRef.current) return;
    setUseRefinementSearch(refinementLabelsAvailable);
  }, [refinementLabelsAvailable, setUseRefinementSearch]);

  // Mark search as stale when inputs change
  useEffect(() => {
    const query = refinement.queryRegion
      ? { startSec: refinement.queryRegion.startSec, endSec: refinement.queryRegion.endSec }
      : null;
    const prev = lastSelectionRef.current;
    const selectionChanged =
      (prev?.startSec ?? null) !== (query?.startSec ?? null) ||
      (prev?.endSec ?? null) !== (query?.endSec ?? null);
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
        if (
          prevState.candidates.length === 0 &&
          prevState.activeCandidateId == null &&
          prevState.queryRegion == null
        )
          return prevState;
        return {
          queryRegion: null,
          candidates: [],
          activeCandidateId: null,
          refinementStats: { accepted: 0, rejected: 0, unreviewed: 0 },
        };
      });
      return;
    }

    if (selectionChanged) {
      setSearchResult(null);
      setWaveformSeekTo(null);
      setCandidateFilter("all");
      setAddMissingMode(false);
      userSetUseRefinementRef.current = false;
      setUseRefinementSearch(false);
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
    setSearchResult,
    setWaveformSeekTo,
    setSearchDirty,
    setCandidateFilter,
    setAddMissingMode,
    setUseRefinementSearch,
    setRefinement,
  ]);

  // Ensure the selected tab exists
  useEffect(() => {
    if (tabDefs.find((t) => t.id === visualTab)) return;
    const fallback = tabDefs.find((t) => t.hasData) ?? tabDefs[0];
    if (fallback) setVisualTab(fallback.id);
  }, [tabDefs, visualTab, setVisualTab]);

  // ===== EVENT HANDLERS =====
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

  const handleRegionChange = useCallback(
    (r: { startSec: number; endSec: number } | null) => {
      if (!r) {
        setWaveformSeekTo(null);
        setRefinement({
          queryRegion: null,
          candidates: [],
          activeCandidateId: null,
          refinementStats: { accepted: 0, rejected: 0, unreviewed: 0 },
        });
        return;
      }
      if (!audioSampleRate || !audioTotalSamples) return;
      const startSec = Math.min(r.startSec, r.endSec);
      const endSec = Math.max(r.startSec, r.endSec);
      const startSample = Math.max(
        0,
        Math.min(audioTotalSamples, Math.floor(startSec * audioSampleRate))
      );
      const endSample = Math.max(
        startSample,
        Math.min(audioTotalSamples, Math.floor(endSec * audioSampleRate))
      );
      setRefinement((prevState) => ({
        ...prevState,
        queryRegion: { startSec, endSec, startSample, endSample },
      }));
    },
    [audioSampleRate, audioTotalSamples, setRefinement, setWaveformSeekTo]
  );

  // ===== SIZE HOOKS =====
  const { ref: heatmapHostRef, size: heatmapHostSize } = useElementSize<HTMLDivElement>();
  const { ref: eventsHostRef, size: eventsHostSize } = useElementSize<HTMLDivElement>();

  // ===== RENDER =====
  return (
    <div className="page-bg px-20 flex flex-col min-h-screen items-center bg-zinc-50 font-sans dark:bg-zinc-950">
      <main className="main-bg w-full bg-white p-2 shadow dark:bg-zinc-950">
        <section>
          <div className="space-y-1.5">
            <WaveSurferPlayer
              ref={playerRef}
              fileInputRef={fileInputRef}
              cursorTimeSec={mirroredCursorTimeSec}
              onCursorTimeChange={setCursorTimeSec}
              viewport={viewport}
              seekToTimeSec={waveformSeekTo}
              onIsPlayingChange={setIsAudioPlaying}
              candidateCurveKind={searchResult?.curveKind}
              queryRegion={
                refinement.queryRegion
                  ? { startSec: refinement.queryRegion.startSec, endSec: refinement.queryRegion.endSec }
                  : null
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
                addManualCandidate({
                  id: c.id,
                  startSec: c.startSec,
                  endSec: c.endSec,
                  score: 1.0,
                  status: "accepted",
                  source: "manual",
                });
                setWaveformSeekTo(c.startSec);
              }}
              onManualCandidateUpdate={(u) => {
                updateManualCandidate(u);
              }}
              onAudioDecoded={handleAudioDecoded}
              onViewportChange={(vp) => setViewport(normalizeViewport(vp, audioDuration))}
              onPlaybackTime={(t) => setPlayheadTimeSec(t)}
              onRegionChange={handleRegionChange}
              toolbarLeft={
                <Button
                  className={`${!audio ? "animate-pulse-glow-red" : ""}`}
                  size="sm"
                  onClick={triggerFileInput}
                >
                  {!audio ? "Load audio" : "Change audio"}
                </Button>
              }
              toolbarRight={
                <div className="flex flex-wrap items-center gap-2 border-l border-zinc-300 dark:border-zinc-700 pl-2 ml-1">
                  <select
                    value={visualTab}
                    onChange={(e) => {
                      const id = e.target.value;
                      setVisualTab(id as MirFunctionId | "search");
                      if (id !== "search") setSelected(id as MirFunctionId);
                    }}
                    className="rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100"
                  >
                    {tabDefs.map(({ id, label, hasData }) => (
                      <option key={id} value={id}>
                        {label} {hasData ? "✓" : ""}
                      </option>
                    ))}
                  </select>

                  {visualTab !== 'search' && <>
                    <Button
                      onClick={() => void runAnalysis()}
                      disabled={!canRun || isRunning}
                      size="sm"
                      variant="default"
                    >
                      {isRunning ? "Analysing..." : "Analyse"}
                    </Button>
                    {isRunning && (
                      <Button onClick={cancelAnalysis} size="sm" variant="outline">
                        Cancel
                      </Button>
                    )}
                  </>}
                  {visualTab === 'search' && <div className="flex flex-wrap items-center gap-2">
                    <Button
                      size="sm"
                      onClick={() => {
                        if (refinement.queryRegion)
                          void runSearch(refinement.queryRegion, searchControls).catch((e) => {
                            if ((e as Error)?.message === "cancelled") return;
                            console.error("[SEARCH] failed", e);
                          });
                      }}
                      disabled={!audio || !refinement.queryRegion || isSearchRunning}
                    >
                      Search
                    </Button>
                    {searchDirty && searchResult ? (
                      <span className="text-xs text-amber-600 dark:text-amber-400">
                        Parameters changed — rerun search
                      </span>
                    ) : null}
                    {isSearchRunning ? (
                      <span className="inline-flex items-center gap-1 text-xs text-zinc-600 dark:text-zinc-300">
                        <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" />
                        Running search…
                      </span>
                    ) : null}
                  </div>}
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setIsConfigOpen(true)}
                    >
                      Configure
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setIsDebugOpen(true)}
                    >
                      Debug
                    </Button>
                  </div>
                </div>
              }
            />

            <div className="mt-1.5">

              {visualTab === "search" ? (
                hasSearchResult ? (
                  <div className="space-y-2">
                    <SyncedWaveSurferSignal
                      data={searchSignal!}
                      times={searchResult!.times}
                      viewport={viewport}
                      cursorTimeSec={mirroredCursorTimeSec}
                      onCursorTimeChange={setCursorTimeSec}
                      overlayThreshold={searchControls.threshold}
                    />
                  </div>
                ) : (
                  <p className="text-sm text-zinc-500">Select an audio segment and run search to see the similarity curve.</p>
                )
              ) : (
                <>
                  {visualTab === "spectralCentroid" ||
                    visualTab === "spectralFlux" ||
                    visualTab === "onsetEnvelope" ? (
                    tabResult?.kind === "1d" && tabResult.fn === visualTab ? (
                      <SyncedWaveSurferSignal
                        data={tabResult.values}
                        times={tabResult.times}
                        viewport={viewport}
                        cursorTimeSec={mirroredCursorTimeSec}
                        onCursorTimeChange={setCursorTimeSec}
                      />
                    ) : (
                      <p className="text-sm text-zinc-500">Run {visualTab} to view output.</p>
                    )
                  ) : null}

                  {visualTab === "onsetPeaks" ? (
                    tabResult?.kind === "events" && tabResult.fn === "onsetPeaks" ? (
                      <div
                        className="relative rounded-md border border-zinc-300 bg-white p-1 dark:border-zinc-700 dark:bg-zinc-950"
                        ref={eventsHostRef}
                        onMouseMove={handleCursorHoverFromViewport}
                        onMouseLeave={handleCursorLeave}
                      >
                        <ViewportOverlayMarkers
                          viewport={viewport}
                          events={tabResult.events}
                          height={180}
                        />
                        <HeatmapPlayheadOverlay
                          viewport={viewport}
                          timeSec={mirroredCursorTimeSec}
                          height={180}
                          widthPx={eventsHostSize.width}
                        />
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
                      <div
                        ref={heatmapHostRef}
                        onMouseMove={handleCursorHoverFromViewport}
                        onMouseLeave={handleCursorLeave}
                      >
                        <TimeAlignedHeatmapPixi
                          input={displayedHeatmap}
                          startTime={visibleRange.startTime}
                          endTime={visibleRange.endTime}
                          width={Math.floor(heatmapHostSize.width || 0)}
                          valueRange={heatmapValueRange}
                          yLabel={heatmapYAxisLabel}
                          colorScheme={heatmapScheme}
                        />
                      </div>
                    ) : (
                      <p className="text-sm text-zinc-500">Run {visualTab} to view output.</p>
                    )
                  ) : null}
                </>
              )}
            </div>
          </div>
          {visualTab === "search" && <SearchPanel playerRef={playerRef} />}
          <VisualiserPanel
            audio={audio}
            playbackTime={playheadTimeSec}
            audioDuration={audioDuration}
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            mirResults={mirResults as any}
            searchSignal={searchSignal}
            isPlaying={isAudioPlaying}
          />

        </section>
        <MirConfigModal />
        <DebugPanel />

      </main>

      <footer className="mt-6 flex items-center justify-center pb-4 text-xs text-zinc-500 dark:text-zinc-400 divide-x-2 divide-zinc-300 dark:divide-zinc-700">
        <p>&nbsp;</p>
        <p className="px-5">vibe-assisted with a range of models; use at your own risk.</p>
        <a
          href="https://github.com/rewbs/octoseq"
          target="_blank"
          rel="noopener noreferrer"
          className="px-5 flex items-center gap-1 transition-colors hover:text-zinc-900 dark:hover:text-zinc-200"
        >
          <Github className="h-4 w-4" />
          code
        </a>
        <div className="px-5">
          <ThemeToggle />
        </div>
        <p>&nbsp;</p>
      </footer>
    </div>
  );
}
