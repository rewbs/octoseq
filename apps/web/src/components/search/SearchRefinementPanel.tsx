"use client";

import type { CandidateFilter, RefinementCandidate, RefinementStats } from "@/lib/searchRefinement";

import { Button } from "@/components/ui/button";

export type SearchRefinementPanelProps = {
  filter: CandidateFilter;
  onFilterChange: (next: CandidateFilter) => void;

  candidatesTotal: number;
  filteredTotal: number;
  activeFilteredIndex: number; // -1 when none/invalid
  activeCandidate: RefinementCandidate | null;

  stats: RefinementStats;

  onPrev: () => void;
  onNext: () => void;
  onAccept: () => void;
  onReject: () => void;

  onPlayCandidate: () => void;
  onPlayQuery: () => void;
  loopCandidate: boolean;
  onLoopCandidateChange: (next: boolean) => void;
  autoPlayOnNavigate: boolean;
  onAutoPlayOnNavigateChange: (next: boolean) => void;

  addMissingMode: boolean;
  onToggleAddMissingMode: () => void;

  canDeleteManual: boolean;
  onDeleteManual: () => void;

  onJumpToBestUnreviewed?: () => void;
  onCopyJson: () => void;

  disabled?: boolean;
};

const filterDefs: Array<{ id: CandidateFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "unreviewed", label: "Unreviewed" },
  { id: "accepted", label: "Accepted" },
  { id: "rejected", label: "Rejected" },
];

export function SearchRefinementPanel({
  filter,
  onFilterChange,
  candidatesTotal,
  filteredTotal,
  activeFilteredIndex,
  activeCandidate,
  stats,
  onPrev,
  onNext,
  onAccept,
  onReject,
  onPlayCandidate,
  onPlayQuery,
  loopCandidate,
  onLoopCandidateChange,
  autoPlayOnNavigate,
  onAutoPlayOnNavigateChange,
  addMissingMode,
  onToggleAddMissingMode,
  canDeleteManual,
  onDeleteManual,
  onJumpToBestUnreviewed,
  onCopyJson,
  disabled,
}: SearchRefinementPanelProps) {
  const hasActive = !!activeCandidate;

  return (
    <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-950">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm font-medium text-zinc-800 dark:text-zinc-100">Review</div>

        <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-600 dark:text-zinc-300">
          <span className="tabular-nums">
            accepted <code>{stats.accepted}</code> · rejected <code>{stats.rejected}</code> · unreviewed{" "}
            <code>{stats.unreviewed}</code>
          </span>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap items-center gap-1">
          {filterDefs.map((f) => {
            const active = filter === f.id;
            return (
              <button
                key={f.id}
                className={`rounded-md px-2 py-1 text-xs ${active
                    ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-black"
                    : "bg-zinc-200 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-100"
                  }`}
                onClick={() => onFilterChange(f.id)}
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
            onClick={onToggleAddMissingMode}
            disabled={disabled}
            className={addMissingMode ? "bg-emerald-600 hover:bg-emerald-600/90" : ""}
          >
            {addMissingMode ? "Add mode: ON (M)" : "Add missing match (M)"}
          </Button>
          <Button variant="outline" onClick={onCopyJson} disabled={disabled || candidatesTotal === 0}>
            Copy refinement JSON
          </Button>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
        <div className="space-y-2 rounded-md border border-zinc-200 bg-white p-2 text-xs dark:border-zinc-800 dark:bg-zinc-950">
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
            <Button variant="outline" onClick={onPrev} disabled={disabled || filteredTotal === 0}>
              Previous (← / J)
            </Button>
            <Button variant="outline" onClick={onNext} disabled={disabled || filteredTotal === 0}>
              Next (→ / K)
            </Button>
            {onJumpToBestUnreviewed ? (
              <Button variant="outline" onClick={onJumpToBestUnreviewed} disabled={disabled}>
                Best unreviewed
              </Button>
            ) : null}
          </div>

          <div className="text-zinc-500">
            total candidates: <code>{candidatesTotal}</code>
          </div>
        </div>

        <div className="space-y-2 rounded-md border border-zinc-200 bg-white p-2 text-xs dark:border-zinc-800 dark:bg-zinc-950">
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
            <Button onClick={onAccept} disabled={disabled || !hasActive}>
              Accept (A)
            </Button>
            <Button variant="destructive" onClick={onReject} disabled={disabled || !hasActive}>
              Reject (R)
            </Button>
            {canDeleteManual ? (
              <Button variant="outline" onClick={onDeleteManual} disabled={disabled}>
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

        <div className="space-y-2 rounded-md border border-zinc-200 bg-white p-2 text-xs dark:border-zinc-800 dark:bg-zinc-950">
          <div className="flex items-center justify-between gap-2">
            <span className="text-zinc-600 dark:text-zinc-300">Playback</span>
            <span className="text-zinc-500">Space plays/stops</span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" onClick={onPlayCandidate} disabled={disabled || !hasActive}>
              Play candidate
            </Button>
            <Button variant="outline" onClick={onPlayQuery} disabled={disabled}>
              Play query (Q)
            </Button>
          </div>

          <div className="flex flex-wrap items-center gap-4">
            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={loopCandidate}
                onChange={(e) => onLoopCandidateChange(e.target.checked)}
                disabled={disabled}
              />
              <span className="text-zinc-600 dark:text-zinc-300">Loop candidate</span>
            </label>

            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={autoPlayOnNavigate}
                onChange={(e) => onAutoPlayOnNavigateChange(e.target.checked)}
                disabled={disabled}
              />
              <span className="text-zinc-600 dark:text-zinc-300">Auto-play on next/prev</span>
            </label>
          </div>

          <div className="text-[11px] text-zinc-500">
            Shortcuts: J/K prev/next · A accept · R reject · Space play/stop · Q play query · M add mode · Delete removes manual
          </div>
        </div>
      </div>
    </div>
  );
}

