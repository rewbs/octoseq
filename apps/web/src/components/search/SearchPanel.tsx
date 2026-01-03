"use client";

import { useCallback, useMemo, useRef } from "react";
import { useShallow } from "zustand/react/shallow";
import { Button } from "@/components/ui/button";
import {
  useSearchStore,
  useSearchActions,
  useRefinementLabelsAvailable,
  useActiveCandidate,
  useFilteredCandidates,
  useActiveFilteredIndex,
  useNavigationActions,
} from "@/lib/stores";
import { useAudioInputStore } from "@/lib/stores/audioInputStore";
import type { CandidateFilter } from "@/lib/searchRefinement";
import type { WaveSurferPlayerHandle } from "@/components/wavesurfer/WaveSurferPlayer";

export type SearchPrecision = "coarse" | "medium" | "fine";

export type SearchControls = {
  threshold: number;
  precision: SearchPrecision;
  melWeight: number;
  transientWeight: number;
  applySoftmax?: boolean;
};

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

const filterDefs: Array<{ id: CandidateFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "unreviewed", label: "Unreviewed" },
  { id: "accepted", label: "Accepted" },
  { id: "rejected", label: "Rejected" },
];

export type SearchPanelProps = {
  playerRef: React.RefObject<WaveSurferPlayerHandle | null>;
};

export function SearchPanel({ playerRef }: SearchPanelProps) {
  const userSetUseRefinementRef = useRef(false);

  // Audio store
  const audio = useAudioInputStore((s) => s.getAudio());
  const audioFileName = useAudioInputStore((s) => s.getAudioFileName());
  const audioSampleRate = useAudioInputStore((s) => s.getAudioSampleRate());

  // Search store state
  const {
    searchControls,
    useRefinementSearch,
    refinement,
    candidateFilter,
    addMissingMode,
    loopCandidate,
    autoPlayOnNavigate,
    searchResult,
    searchDirty,
    isSearchRunning,
  } = useSearchStore(
    useShallow((s) => ({
      searchControls: s.searchControls,
      useRefinementSearch: s.useRefinementSearch,
      refinement: s.refinement,
      candidateFilter: s.candidateFilter,
      addMissingMode: s.addMissingMode,
      loopCandidate: s.loopCandidate,
      autoPlayOnNavigate: s.autoPlayOnNavigate,
      searchResult: s.searchResult,
      searchDirty: s.searchDirty,
      isSearchRunning: s.isSearchRunning,
    }))
  );

  // Search action
  const { runSearch } = useSearchActions();

  // Search store actions
  const {
    setSearchControls,
    setUseRefinementSearch,
    setAddMissingMode,
    setLoopCandidate,
    setAutoPlayOnNavigate,
  } = useSearchStore(
    useShallow((s) => ({
      setSearchControls: s.setSearchControls,
      setUseRefinementSearch: s.setUseRefinementSearch,
      setAddMissingMode: s.setAddMissingMode,
      setLoopCandidate: s.setLoopCandidate,
      setAutoPlayOnNavigate: s.setAutoPlayOnNavigate,
    }))
  );

  // Derived state
  const refinementAvailable = useRefinementLabelsAvailable();
  const activeCandidate = useActiveCandidate();
  const filteredCandidates = useFilteredCandidates();
  const activeFilteredIndex = useActiveFilteredIndex();

  // Navigation actions
  const {
    onPrevCandidate,
    onNextCandidate,
    playActiveCandidate,
    playQueryRegion,
    acceptActive,
    rejectActive,
    deleteActiveManual,
    jumpToBestUnreviewed,
    handleFilterChange,
  } = useNavigationActions({ playerRef });

  // Computed values
  const disabled = !audio || !refinement.queryRegion;
  const hasActive = !!activeCandidate;
  const candidatesTotal = refinement.candidates.length;
  const filteredTotal = filteredCandidates.length;
  const stats = refinement.refinementStats;
  const canDeleteManual = activeCandidate?.source === "manual";
  const showJumpToBest = stats.unreviewed > 0;

  const selectionDurationSec = refinement.queryRegion
    ? Math.max(0, Math.abs(refinement.queryRegion.endSec - refinement.queryRegion.startSec))
    : null;

  const thresholdPct = Math.round(searchControls.threshold * 100);
  const refinementOn = !!useRefinementSearch && !!refinementAvailable;
  const thresholdLabel = refinementOn ? "Confidence" : "Similarity";

  const hopMs = useMemo(() => {
    const dur = selectionDurationSec ?? 0;
    const base =
      searchControls.precision === "fine"
        ? 0.005
        : searchControls.precision === "medium"
          ? 0.02
          : 0.05;
    const scaled = dur > 2 ? base * 1.5 : base;
    return Math.round(scaled * 1000);
  }, [searchControls.precision, selectionDurationSec]);

  const handleChange = (next: SearchControls) => {
    setSearchControls(next);
  };

  const handleUseRefinementChange = (next: boolean) => {
    userSetUseRefinementRef.current = true;
    setUseRefinementSearch(next);
  };

  // Copy refinement JSON
  const copyRefinementJson = useCallback(async () => {
    const q = refinement.queryRegion;
    if (!q) return;

    const fileName = audioFileName ?? null;
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
      meta: { audioFileName: fileName, sampleRate: audioSampleRate, selectionDurationSec: Math.max(0, q.endSec - q.startSec) },
    };

    try {
      await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
    } catch {
      window.prompt("Copy refinement JSON:", JSON.stringify(payload, null, 2));
    }
  }, [audioFileName, audioSampleRate, refinement.candidates, refinement.queryRegion]);

  return (
    <div className="rounded-md border border-zinc-200 bg-zinc-50 p-1.5 text-xs dark:border-zinc-800 dark:bg-zinc-950">
      {/* Row 1: Search button + Threshold + Precision + Checkboxes */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        {/* Search button */}
        <div className="flex items-center gap-2">
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
            className="h-6"
          >
            Search
          </Button>
          {searchDirty && searchResult ? (
            <span className="text-amber-600 dark:text-amber-400">
              Params changed
            </span>
          ) : null}
          {isSearchRunning ? (
            <span className="inline-flex items-center gap-1 text-zinc-600 dark:text-zinc-300">
              <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" />
              Running…
            </span>
          ) : null}
        </div>

        <label className="flex items-center gap-1.5">
          <span className="text-zinc-600 dark:text-zinc-300 w-16">{thresholdLabel}</span>
          <input
            type="range"
            min={60}
            max={95}
            step={1}
            value={thresholdPct}
            onChange={(e) => handleChange({ ...searchControls, threshold: clamp01(Number(e.target.value) / 100) })}
            disabled={disabled}
            className="w-24"
          />
          <span className="w-8 text-right tabular-nums text-zinc-600 dark:text-zinc-300">{thresholdPct}%</span>
        </label>

        <label className="flex items-center gap-1.5">
          <span className="text-zinc-600 dark:text-zinc-300">Precision</span>
          <select
            value={searchControls.precision}
            onChange={(e) => handleChange({ ...searchControls, precision: e.target.value as SearchPrecision })}
            disabled={disabled}
            className="rounded border border-zinc-200 bg-white px-1.5 py-0.5 text-xs dark:border-zinc-800 dark:bg-zinc-950"
          >
            <option value="coarse">Coarse</option>
            <option value="medium">Medium</option>
            <option value="fine">Fine</option>
          </select>
          <span className="text-zinc-500">≈{hopMs}ms</span>
        </label>

        <label className="flex items-center gap-1">
          <input
            type="checkbox"
            checked={!!searchControls.applySoftmax}
            onChange={(e) => handleChange({ ...searchControls, applySoftmax: e.target.checked })}
            disabled={disabled || refinementOn}
            className="h-3 w-3"
          />
          <span className="text-zinc-600 dark:text-zinc-300">Softmax</span>
        </label>

        <label className="flex items-center gap-1">
          <input
            type="checkbox"
            checked={!!useRefinementSearch}
            onChange={(e) => handleUseRefinementChange(e.target.checked)}
            disabled={disabled || !refinementAvailable}
            className="h-3 w-3"
          />
          <span className="text-zinc-600 dark:text-zinc-300">Use refinement</span>
          {!refinementAvailable && <span className="text-zinc-400">(label to enable)</span>}
        </label>

        <details className="text-xs">
          <summary className="cursor-pointer text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300">Weights</summary>
          <div className="absolute z-10 mt-1 rounded border border-zinc-200 bg-white p-2 shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
            <label className="flex items-center gap-1.5 mb-1">
              <span className="text-zinc-600 dark:text-zinc-300 w-20">Mel</span>
              <input type="range" min={0} max={200} step={5} value={Math.round(searchControls.melWeight * 100)} onChange={(e) => handleChange({ ...searchControls, melWeight: Number(e.target.value) / 100 })} disabled={disabled} className="w-20" />
              <span className="w-8 tabular-nums">{searchControls.melWeight.toFixed(2)}</span>
            </label>
            <label className="flex items-center gap-1.5">
              <span className="text-zinc-600 dark:text-zinc-300 w-20">Transient</span>
              <input type="range" min={0} max={200} step={5} value={Math.round(searchControls.transientWeight * 100)} onChange={(e) => handleChange({ ...searchControls, transientWeight: Number(e.target.value) / 100 })} disabled={disabled} className="w-20" />
              <span className="w-8 tabular-nums">{searchControls.transientWeight.toFixed(2)}</span>
            </label>
          </div>
        </details>
      </div>

      {/* Divider */}
      <div className="my-1.5 border-t border-zinc-200 dark:border-zinc-800" />

      {/* Row 2: Filter + Stats + Navigation + Classification + Playback */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {/* Filter buttons */}
        <div className="flex items-center gap-0.5">
          {filterDefs.map((f) => {
            const active = candidateFilter === f.id;
            return (
              <button
                key={f.id}
                className={`rounded px-1.5 py-0.5 text-xs ${active ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-black" : "bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"}`}
                onClick={() => handleFilterChange(f.id)}
                disabled={!audio}
              >
                {f.label}
              </button>
            );
          })}
        </div>

        {/* Stats */}
        <span className="tabular-nums text-zinc-500">
          <span className="text-green-600 dark:text-green-400">{stats.accepted}✓</span>{" "}
          <span className="text-red-600 dark:text-red-400">{stats.rejected}✗</span>{" "}
          <span>{stats.unreviewed}?</span>
        </span>

        {/* Navigation */}
        <div className="flex items-center gap-1">
          <Button size="sm" variant="outline" onClick={onPrevCandidate} disabled={!audio || filteredTotal === 0} className="h-6 px-2 text-xs">
            ← Prev
          </Button>
          <span className="tabular-nums text-zinc-500 min-w-16 text-center">
            {hasActive && activeFilteredIndex >= 0 ? `${activeFilteredIndex + 1}/${filteredTotal}` : filteredTotal > 0 ? `—/${filteredTotal}` : "—"}
          </span>
          <Button size="sm" variant="outline" onClick={onNextCandidate} disabled={!audio || filteredTotal === 0} className="h-6 px-2 text-xs">
            Next →
          </Button>
          {showJumpToBest && (
            <Button size="sm" variant="outline" onClick={jumpToBestUnreviewed} disabled={!audio} className="h-6 px-2 text-xs">
              Best
            </Button>
          )}
        </div>

        {/* Classification */}
        <div className="flex items-center gap-1">
          <Button size="sm" onClick={acceptActive} disabled={!audio || !hasActive} className="h-6 px-2 text-xs bg-green-600 hover:bg-green-700">
            Accept(A)
          </Button>
          <Button size="sm" variant="destructive" onClick={rejectActive} disabled={!audio || !hasActive} className="h-6 px-2 text-xs">
            Reject(R)
          </Button>
          {canDeleteManual && (
            <Button size="sm" variant="outline" onClick={deleteActiveManual} disabled={!audio} className="h-6 px-2 text-xs">
              Del
            </Button>
          )}
        </div>

        {/* Playback */}
        <div className="flex items-center gap-1">
          <Button size="sm" variant="outline" onClick={playActiveCandidate} disabled={!audio || !hasActive} className="h-6 px-2 text-xs">
            ▶ Cand
          </Button>
          <Button size="sm" variant="outline" onClick={playQueryRegion} disabled={!audio} className="h-6 px-2 text-xs">
            ▶ Query
          </Button>
        </div>

        {/* Toggles */}
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1">
            <input type="checkbox" checked={loopCandidate} onChange={(e) => setLoopCandidate(e.target.checked)} disabled={!audio} className="h-3 w-3" />
            <span className="text-zinc-600 dark:text-zinc-300">Loop</span>
          </label>
          <label className="flex items-center gap-1">
            <input type="checkbox" checked={autoPlayOnNavigate} onChange={(e) => setAutoPlayOnNavigate(e.target.checked)} disabled={!audio} className="h-3 w-3" />
            <span className="text-zinc-600 dark:text-zinc-300">Auto-play</span>
          </label>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1 ml-auto">
          <Button
            size="sm"
            variant={addMissingMode ? "default" : "outline"}
            onClick={() => setAddMissingMode(!addMissingMode)}
            disabled={!audio}
            className={`h-6 px-2 text-xs ${addMissingMode ? "bg-emerald-600 hover:bg-emerald-700" : ""}`}
          >
            {addMissingMode ? "Add:ON" : "+Add(M)"}
          </Button>
          <Button size="sm" variant="outline" onClick={copyRefinementJson} disabled={!audio || candidatesTotal === 0} className="h-6 px-2 text-xs">
            Copy JSON
          </Button>
        </div>
      </div>

      {/* Row 3: Active candidate info (compact) */}
      {hasActive && (
        <div className="mt-1 flex items-center gap-2 text-zinc-500 tabular-nums">
          <span>
            {activeCandidate.startSec.toFixed(2)}s–{activeCandidate.endSec.toFixed(2)}s
          </span>
          <span>score: {activeCandidate.score?.toFixed(3) ?? "—"}</span>
          <span>{activeCandidate.source}/{activeCandidate.status}</span>
        </div>
      )}
    </div>
  );
}
