"use client";

export type RefinementCandidateStatus = "unreviewed" | "accepted" | "rejected";
export type RefinementCandidateSource = "auto" | "manual";

export type QueryRegion = {
  startSec: number;
  endSec: number;
  startSample: number;
  endSample: number;
};

export type RefinementCandidate = {
  id: string;
  startSec: number;
  endSec: number;
  score: number | null;
  status: RefinementCandidateStatus;
  source: RefinementCandidateSource;
};

export type RefinementStats = {
  accepted: number;
  rejected: number;
  unreviewed: number;
};

export type SearchRefinementState = {
  queryRegion: QueryRegion | null;
  candidates: RefinementCandidate[];
  activeCandidateId: string | null;
  refinementStats: RefinementStats;
};

export type CandidateFilter = "all" | RefinementCandidateStatus;

export function computeRefinementStats(candidates: RefinementCandidate[]): RefinementStats {
  let accepted = 0;
  let rejected = 0;
  let unreviewed = 0;
  for (const c of candidates) {
    if (c.status === "accepted") accepted += 1;
    else if (c.status === "rejected") rejected += 1;
    else unreviewed += 1;
  }
  return { accepted, rejected, unreviewed };
}

export function makeInitialRefinementState(): SearchRefinementState {
  return {
    queryRegion: null,
    candidates: [],
    activeCandidateId: null,
    refinementStats: { accepted: 0, rejected: 0, unreviewed: 0 },
  };
}

export function makeAutoCandidateId(startSec: number, endSec: number, index: number): string {
  // IDs must be stable across re-renders. We derive from deterministic window bounds and a
  // per-run index (post-sort) to avoid collisions when times quantize.
  const startMs = Math.round(startSec * 1000);
  const endMs = Math.round(endSec * 1000);
  return `auto-${startMs}-${endMs}-${index}`;
}

export function isCandidateTextInputTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}
