"use client";

import { useCallback } from "react";
import { useShallow } from "zustand/react/shallow";
import { Button } from "@/components/ui/button";
import {
  useAudioStore,
  useSearchStore,
  useActiveCandidate,
  useFilteredCandidates,
  useActiveFilteredIndex,
  useNavigationActions,
} from "@/lib/stores";
import type { CandidateFilter } from "@/lib/searchRefinement";
import type { WaveSurferPlayerHandle } from "@/components/wavesurfer/WaveSurferPlayer";

export type SearchRefinementPanelProps = {
  playerRef: React.RefObject<WaveSurferPlayerHandle | null>;
};

const filterDefs: Array<{ id: CandidateFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "unreviewed", label: "Unreviewed" },
  { id: "accepted", label: "Accepted" },
  { id: "rejected", label: "Rejected" },
];

/**
 * Panel for reviewing and refining search candidates.
 * Uses stores directly instead of receiving most props.
 */
export function SearchRefinementPanel({ playerRef }: SearchRefinementPanelProps) {
  // Audio store
  const audio = useAudioStore((s) => s.audio);
  const audioFileName = useAudioStore((s) => s.audioFileName);
  const audioSampleRate = useAudioStore((s) => s.audioSampleRate);

  // Search store state
  const {
    candidateFilter,
    addMissingMode,
    loopCandidate,
    autoPlayOnNavigate,
    advanceToNextBest,
    refinement,
  } = useSearchStore(
    useShallow((s) => ({
      candidateFilter: s.candidateFilter,
      addMissingMode: s.addMissingMode,
      loopCandidate: s.loopCandidate,
      autoPlayOnNavigate: s.autoPlayOnNavigate,
      advanceToNextBest: s.advanceToNextBest,
      refinement: s.refinement,
    }))
  );

  // Search store actions
  const { setAddMissingMode, setLoopCandidate, setAutoPlayOnNavigate, setAdvanceToNextBest } = useSearchStore(
    useShallow((s) => ({
      setAddMissingMode: s.setAddMissingMode,
      setLoopCandidate: s.setLoopCandidate,
      setAutoPlayOnNavigate: s.setAutoPlayOnNavigate,
      setAdvanceToNextBest: s.setAdvanceToNextBest,
    }))
  );

  // Derived state
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

  // Copy refinement JSON
  const copyRefinementJson = useCallback(async () => {
    const q = refinement.queryRegion;
    if (!q) return;

    const fileName = audioFileName ?? null;

    const accepted = refinement.candidates
      .filter((c) => c.status === "accepted")
      .map((c) => ({
        id: c.id,
        startSec: c.startSec,
        endSec: c.endSec,
        score: c.score,
        source: c.source,
      }));
    const rejected = refinement.candidates
      .filter((c) => c.status === "rejected")
      .map((c) => ({
        id: c.id,
        startSec: c.startSec,
        endSec: c.endSec,
        score: c.score,
        source: c.source,
      }));
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

  // Computed values
  const disabled = !audio;
  const hasActive = !!activeCandidate;
  const candidatesTotal = refinement.candidates.length;
  const filteredTotal = filteredCandidates.length;
  const stats = refinement.refinementStats;
  const canDeleteManual = activeCandidate?.source === "manual";
  const showJumpToBest = stats.unreviewed > 0;

  return (
    <div className="rounded-md border border-zinc-200 bg-zinc-50 p-2 dark:border-zinc-800 dark:bg-zinc-950">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm font-medium text-zinc-800 dark:text-zinc-100">Search Refinement</div>

        <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-600 dark:text-zinc-300">
          <span className="tabular-nums">
            accepted <code>{stats.accepted}</code> · rejected <code>{stats.rejected}</code> ·
            unreviewed <code>{stats.unreviewed}</code>
          </span>
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap items-center gap-1">
          {filterDefs.map((f) => {
            const active = candidateFilter === f.id;
            return (
              <button
                key={f.id}
                className={`rounded-md px-2 py-1 text-xs ${active
                  ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-black"
                  : "bg-zinc-200 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-100"
                  }`}
                onClick={() => handleFilterChange(f.id)}
                disabled={disabled}
              >
                {f.label}
              </button>
            );
          })}
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Button
            variant={addMissingMode ? "default" : "outline"}
            onClick={() => setAddMissingMode(!addMissingMode)}
            disabled={disabled}
            className={addMissingMode ? "bg-emerald-600 hover:bg-emerald-600/90" : ""}
          >
            {addMissingMode ? "Add mode: ON (M)" : "Add missing match (M)"}
          </Button>
          <Button
            variant="outline"
            onClick={copyRefinementJson}
            disabled={disabled || candidatesTotal === 0}
          >
            Copy refinement JSON
          </Button>
        </div>
      </div>

      <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-3">
        <div className="space-y-1.5 rounded-md border border-zinc-200 bg-white p-1.5 text-xs dark:border-zinc-800 dark:bg-zinc-950">
          <div className="flex items-center justify-between gap-2">
            <span className="text-zinc-600 dark:text-zinc-300">Navigation</span>
            <span className="tabular-nums text-zinc-500">
              {hasActive && filteredTotal > 0 && activeFilteredIndex >= 0
                ? `Candidate ${activeFilteredIndex + 1} / ${filteredTotal}`
                : filteredTotal > 0
                  ? `— / ${filteredTotal}`
                  : "—"}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              onClick={onPrevCandidate}
              disabled={disabled || filteredTotal === 0}
            >
              Previous (← / J)
            </Button>
            <Button
              variant="outline"
              onClick={onNextCandidate}
              disabled={disabled || filteredTotal === 0}
            >
              Next (→ / K)
            </Button>
            {showJumpToBest ? (
              <Button variant="outline" onClick={jumpToBestUnreviewed} disabled={disabled}>
                Best unreviewed (B)
              </Button>
            ) : null}
          </div>

          <div className="text-zinc-500">
            total candidates: <code>{candidatesTotal}</code>
          </div>
        </div>

        <div className="space-y-1.5 rounded-md border border-zinc-200 bg-white p-1.5 text-xs dark:border-zinc-800 dark:bg-zinc-950">
          <div className="flex items-center justify-between gap-2">
            <span className="text-zinc-600 dark:text-zinc-300">Classification</span>
            {hasActive ? (
              <span className="tabular-nums text-zinc-500">
                score{" "}
                <code>
                  {activeCandidate.score == null ? "—" : activeCandidate.score.toFixed(3)}
                </code>{" "}
                · <code>{activeCandidate.source}</code> · <code>{activeCandidate.status}</code>
              </span>
            ) : (
              <span className="text-zinc-500">No candidate selected</span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={acceptActive} disabled={disabled || !hasActive}>
              Accept (A)
            </Button>
            <Button variant="destructive" onClick={rejectActive} disabled={disabled || !hasActive}>
              Reject (R)
            </Button>
            {canDeleteManual ? (
              <Button variant="outline" onClick={deleteActiveManual} disabled={disabled}>
                Delete manual (⌫)
              </Button>
            ) : null}
          </div>

          {hasActive ? (
            <div className="tabular-nums text-zinc-500">
              {activeCandidate.startSec.toFixed(3)}s → {activeCandidate.endSec.toFixed(3)}s
            </div>
          ) : null}
        </div>

        <div className="space-y-1.5 rounded-md border border-zinc-200 bg-white p-1.5 text-xs dark:border-zinc-800 dark:bg-zinc-950">
          <div className="flex items-center justify-between gap-2">
            <span className="text-zinc-600 dark:text-zinc-300">Playback</span>
            <span className="text-zinc-500">Space plays/stops</span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              onClick={playActiveCandidate}
              disabled={disabled || !hasActive}
            >
              Play candidate
            </Button>
            <Button variant="outline" onClick={playQueryRegion} disabled={disabled}>
              Play query (Q)
            </Button>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={loopCandidate}
                onChange={(e) => setLoopCandidate(e.target.checked)}
                disabled={disabled}
              />
              <span className="text-zinc-600 dark:text-zinc-300">Loop candidate</span>
            </label>

            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={autoPlayOnNavigate}
                onChange={(e) => setAutoPlayOnNavigate(e.target.checked)}
                disabled={disabled}
              />
              <span className="text-zinc-600 dark:text-zinc-300">Auto-play on next/prev</span>
            </label>

            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={advanceToNextBest}
                onChange={(e) => setAdvanceToNextBest(e.target.checked)}
                disabled={disabled}
              />
              <span className="text-zinc-600 dark:text-zinc-300">Advance to next best</span>
            </label>
          </div>

          <div className="text-[11px] text-zinc-500">
            Shortcuts: J/K prev/next · A accept · R reject · B best unreviewed · Space play/stop · Q play query · M add
            mode · Delete removes manual
          </div>
        </div>
      </div>
    </div>
  );
}
