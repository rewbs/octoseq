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
    <div className={`flex items-center gap-3 text-xs ${disabled ? "opacity-30 pointer-events-none" : ""}`}>
      {/* 1. Filters */}
      <div className="flex items-center gap-1 rounded bg-zinc-100 p-0.5 dark:bg-zinc-900">
        {filterDefs.map((f) => {
          const active = filter === f.id;
          return (
            <button
              key={f.id}
              className={`rounded px-2 py-0.5 text-xs font-medium transition-colors ${active
                ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-zinc-100"
                : "text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-300"
                }`}
              onClick={() => onFilterChange(f.id)}
              disabled={disabled}
            >
              {f.label === "All" ? "All" : f.label === "Unreviewed" ? `Unreviewed (${stats.unreviewed})` : f.label}
            </button>
          );
        })}
      </div>

      <div className="h-4 w-px bg-zinc-200 dark:bg-zinc-800" />

      {/* 2. Candidate Nav & Actions */}
      <div className="flex items-center gap-2">
        <div className="flex items-center bg-white rounded border border-zinc-200 dark:bg-zinc-900 dark:border-zinc-800">
          <Button variant="ghost" size="icon" className="h-7 w-7 rounded-none" onClick={onPrev} disabled={disabled || filteredTotal === 0} title="Previous (J)">
            ←
          </Button>
          <span className="px-2 tabular-nums text-zinc-500 border-x border-zinc-100 dark:border-zinc-800 min-w-12 text-center text-[10px]">
            {activeFilteredIndex + 1} / {filteredTotal}
          </span>
          <Button variant="ghost" size="icon" className="h-7 w-7 rounded-none" onClick={onNext} disabled={disabled || filteredTotal === 0} title="Next (K)">
            →
          </Button>
        </div>

        <Button
          size="sm"
          variant="outline"
          className={`h-7 px-3 text-xs ${activeCandidate?.status === "accepted" ? "bg-emerald-50 border-emerald-200 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-900/20 dark:border-emerald-800 dark:text-emerald-400" : ""}`}
          onClick={onAccept}
          disabled={disabled || !hasActive}
          title="Accept (A)"
        >
          Accept
        </Button>
        <Button
          size="sm"
          variant="outline"
          className={`h-7 px-3 text-xs ${activeCandidate?.status === "rejected" ? "bg-red-50 border-red-200 text-red-700 hover:bg-red-100 dark:bg-red-900/20 dark:border-red-800 dark:text-red-400" : ""}`}
          onClick={onReject}
          disabled={disabled || !hasActive}
          title="Reject (R)"
        >
          Reject
        </Button>
      </div>

      <div className="h-4 w-px bg-zinc-200 dark:bg-zinc-800" />

      {/* 3. Playback */}
      <div className="flex items-center gap-1">
        <Button variant="outline" size="sm" className="h-7 px-2 text-xs gap-1.5" onClick={onPlayCandidate} disabled={disabled || !hasActive} title="Play Candidate (Space)">
          <span>▶ Match</span>
        </Button>
        <Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-zinc-500" onClick={onPlayQuery} disabled={disabled} title="Play Query (Q)">
          ▶ Query
        </Button>
      </div>

      <label className="flex items-center gap-1.5 cursor-pointer text-[10px] text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-300">
        <input
          type="checkbox"
          checked={loopCandidate}
          onChange={(e) => onLoopCandidateChange(e.target.checked)}
          disabled={disabled}
          className="rounded-sm w-3 h-3 text-zinc-600"
        />
        Loop
      </label>

      <label className="flex items-center gap-1.5 cursor-pointer text-[10px] text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-300" title="Auto-advance on Accept/Reject">
        <input
          type="checkbox"
          checked={autoPlayOnNavigate}
          onChange={(e) => onAutoPlayOnNavigateChange(e.target.checked)}
          disabled={disabled}
          className="rounded-sm w-3 h-3 text-zinc-600"
        />
        Auto-play
      </label>

      {/* Spacer */}
      <div className="flex-1" />

      {/* 4. Utils */}
      <div className="flex items-center gap-1">
        {onJumpToBestUnreviewed && (
          <Button size="sm" variant="ghost" className="h-7 w-7 text-zinc-400 hover:text-indigo-600" onClick={onJumpToBestUnreviewed} disabled={disabled} title="Jump to Best Unreviewed">
            ✨
          </Button>
        )}
        <Button
          size="sm"
          variant={addMissingMode ? "default" : "ghost"}
          onClick={onToggleAddMissingMode}
          disabled={disabled}
          className={`h-7 text-xs ${addMissingMode ? "bg-emerald-600 hover:bg-emerald-700" : "text-zinc-400 hover:text-zinc-700"}`}
          title="Add Missing Match (M)"
        >
          {addMissingMode ? "Add Mode ON" : "+ Add"}
        </Button>

        {canDeleteManual && (
          <Button size="sm" variant="ghost" className="h-7 w-7 text-zinc-400 hover:text-red-600" onClick={onDeleteManual} disabled={disabled} title="Delete Manual Region">
            ⌫
          </Button>
        )}

        <Button size="sm" variant="ghost" className="h-7 w-7 text-zinc-400" onClick={onCopyJson} disabled={disabled || candidatesTotal === 0} title="Copy JSON">
          📋
        </Button>
      </div>
    </div>
  );
}

