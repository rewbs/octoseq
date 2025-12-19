import { create } from "zustand";
import { devtools } from "zustand/middleware";
import type { SearchControls } from "@/components/search/SearchControlsPanel";
import {
  type CandidateFilter,
  type RefinementCandidate,
  type SearchRefinementState,
  computeRefinementStats,
  makeInitialRefinementState,
} from "@/lib/searchRefinement";
import type { SearchResult } from "./types";

interface SearchState {
  // Search controls
  searchControls: SearchControls;
  searchResult: SearchResult | null;
  searchDirty: boolean;
  isSearchRunning: boolean;

  // Refinement state
  refinement: SearchRefinementState;
  candidateFilter: CandidateFilter;
  addMissingMode: boolean;
  loopCandidate: boolean;
  autoPlayOnNavigate: boolean;
  advanceToNextBest: boolean;
  useRefinementSearch: boolean;
}

interface SearchActions {
  // Search control actions
  setSearchControls: (controls: SearchControls) => void;
  updateSearchControls: (update: Partial<SearchControls>) => void;
  setSearchResult: (result: SearchResult | null) => void;
  setSearchDirty: (dirty: boolean) => void;
  setIsSearchRunning: (running: boolean) => void;

  // Refinement actions
  setRefinement: (
    update: SearchRefinementState | ((prev: SearchRefinementState) => SearchRefinementState)
  ) => void;
  setCandidateFilter: (filter: CandidateFilter) => void;
  setAddMissingMode: (mode: boolean) => void;
  toggleAddMissingMode: () => void;
  setLoopCandidate: (loop: boolean) => void;
  setAutoPlayOnNavigate: (auto: boolean) => void;
  setAdvanceToNextBest: (advance: boolean) => void;
  setUseRefinementSearch: (use: boolean) => void;

  // Candidate management actions
  setActiveCandidateId: (id: string | null) => void;
  updateCandidateStatus: (id: string, status: "accepted" | "rejected") => void;
  addManualCandidate: (candidate: RefinementCandidate) => void;
  updateManualCandidate: (update: { id: string; startSec: number; endSec: number }) => void;
  deleteManualCandidate: (id: string) => void;

  // Reset actions
  resetSearch: () => void;
  resetRefinement: () => void;
}

export type SearchStore = SearchState & SearchActions;

const initialSearchControls: SearchControls = {
  threshold: 0.75,
  precision: "medium",
  melWeight: 1,
  transientWeight: 1,
  applySoftmax: false,
};

const initialState: SearchState = {
  searchControls: initialSearchControls,
  searchResult: null,
  searchDirty: false,
  isSearchRunning: false,
  refinement: makeInitialRefinementState(),
  candidateFilter: "all",
  addMissingMode: false,
  loopCandidate: false,
  autoPlayOnNavigate: true,
  advanceToNextBest: true,
  useRefinementSearch: false,
};

export const useSearchStore = create<SearchStore>()(
  devtools(
    (set, get) => ({
      ...initialState,

      // Search control actions
      setSearchControls: (controls) => set({ searchControls: controls }, false, "setSearchControls"),

      updateSearchControls: (update) =>
        set(
          (state) => ({ searchControls: { ...state.searchControls, ...update } }),
          false,
          "updateSearchControls"
        ),

      setSearchResult: (result) => set({ searchResult: result }, false, "setSearchResult"),

      setSearchDirty: (dirty) => set({ searchDirty: dirty }, false, "setSearchDirty"),

      setIsSearchRunning: (running) => set({ isSearchRunning: running }, false, "setIsSearchRunning"),

      // Refinement actions
      setRefinement: (update) =>
        set(
          (state) => ({
            refinement: typeof update === "function" ? update(state.refinement) : update,
          }),
          false,
          "setRefinement"
        ),

      setCandidateFilter: (filter) => set({ candidateFilter: filter }, false, "setCandidateFilter"),

      setAddMissingMode: (mode) => set({ addMissingMode: mode }, false, "setAddMissingMode"),

      toggleAddMissingMode: () =>
        set((state) => ({ addMissingMode: !state.addMissingMode }), false, "toggleAddMissingMode"),

      setLoopCandidate: (loop) => set({ loopCandidate: loop }, false, "setLoopCandidate"),

      setAutoPlayOnNavigate: (auto) => set({ autoPlayOnNavigate: auto }, false, "setAutoPlayOnNavigate"),

      setAdvanceToNextBest: (advance) => set({ advanceToNextBest: advance }, false, "setAdvanceToNextBest"),

      setUseRefinementSearch: (use) => set({ useRefinementSearch: use }, false, "setUseRefinementSearch"),

      // Candidate management actions
      setActiveCandidateId: (id) =>
        set(
          (state) => ({
            refinement: { ...state.refinement, activeCandidateId: id },
          }),
          false,
          "setActiveCandidateId"
        ),

      updateCandidateStatus: (id, status) =>
        set(
          (state) => {
            const updated = state.refinement.candidates.map((c) =>
              c.id === id ? { ...c, status } : c
            );
            return {
              refinement: {
                ...state.refinement,
                candidates: updated,
                refinementStats: computeRefinementStats(updated),
              },
            };
          },
          false,
          "updateCandidateStatus"
        ),

      addManualCandidate: (candidate) =>
        set(
          (state) => {
            if (state.refinement.candidates.some((x) => x.id === candidate.id)) {
              return state;
            }
            const nextCandidates = [...state.refinement.candidates, candidate].sort(
              (a, b) => a.startSec - b.startSec
            );
            return {
              refinement: {
                ...state.refinement,
                candidates: nextCandidates,
                activeCandidateId: candidate.id,
                refinementStats: computeRefinementStats(nextCandidates),
              },
            };
          },
          false,
          "addManualCandidate"
        ),

      updateManualCandidate: (update) =>
        set(
          (state) => {
            const startSec = Math.min(update.startSec, update.endSec);
            const endSec = Math.max(update.startSec, update.endSec);
            const nextCandidates = state.refinement.candidates
              .map((c) => {
                if (c.id !== update.id) return c;
                if (c.source !== "manual") return c;
                return { ...c, startSec, endSec };
              })
              .sort((a, b) => a.startSec - b.startSec);
            return {
              refinement: {
                ...state.refinement,
                candidates: nextCandidates,
                refinementStats: computeRefinementStats(nextCandidates),
              },
            };
          },
          false,
          "updateManualCandidate"
        ),

      deleteManualCandidate: (id) =>
        set(
          (state) => {
            const candidate = state.refinement.candidates.find((c) => c.id === id);
            if (!candidate || candidate.source !== "manual") return state;

            const updated = state.refinement.candidates.filter((c) => c.id !== id);
            const nextActiveId =
              state.refinement.activeCandidateId === id
                ? updated[0]?.id ?? null
                : state.refinement.activeCandidateId;

            return {
              refinement: {
                ...state.refinement,
                candidates: updated,
                activeCandidateId: nextActiveId,
                refinementStats: computeRefinementStats(updated),
              },
            };
          },
          false,
          "deleteManualCandidate"
        ),

      // Reset actions
      resetSearch: () =>
        set(
          {
            searchResult: null,
            searchDirty: false,
            isSearchRunning: false,
            candidateFilter: "all",
            addMissingMode: false,
            useRefinementSearch: false,
            refinement: makeInitialRefinementState(),
          },
          false,
          "resetSearch"
        ),

      resetRefinement: () =>
        set(
          {
            refinement: makeInitialRefinementState(),
          },
          false,
          "resetRefinement"
        ),
    }),
    { name: "search-store" }
  )
);
