import { useCallback } from "react";
import { useSearchStore } from "../searchStore";
import { usePlaybackStore } from "../playbackStore";
import { computeRefinementStats, type RefinementCandidate } from "@/lib/searchRefinement";
import type { WaveSurferPlayerHandle } from "@/components/wavesurfer/WaveSurferPlayer";

interface NavigationActionsOptions {
  playerRef: React.RefObject<WaveSurferPlayerHandle | null>;
}

/**
 * Hook that provides navigation actions for search refinement.
 * Encapsulates logic for navigating, accepting, rejecting candidates.
 */
export function useNavigationActions({ playerRef }: NavigationActionsOptions) {
  const navigateCandidate = useCallback(
    (dir: -1 | 1) => {
      const searchStore = useSearchStore.getState();
      const playbackStore = usePlaybackStore.getState();
      const { refinement, candidateFilter, loopCandidate, autoPlayOnNavigate } = searchStore;

      // Get filtered candidates
      const filteredCandidates =
        candidateFilter === "all"
          ? refinement.candidates
          : refinement.candidates.filter((c) => c.status === candidateFilter);

      if (filteredCandidates.length === 0) return;

      // Find current index
      const idx = refinement.activeCandidateId
        ? filteredCandidates.findIndex((c) => c.id === refinement.activeCandidateId)
        : -1;

      const nextIndex =
        idx === -1
          ? dir === 1
            ? 0
            : filteredCandidates.length - 1
          : (idx + dir + filteredCandidates.length) % filteredCandidates.length;

      const next = filteredCandidates[nextIndex];
      if (!next) return;

      searchStore.setRefinement((prevState) => ({
        ...prevState,
        activeCandidateId: next.id,
      }));

      if (autoPlayOnNavigate) {
        playerRef.current?.playSegment({
          startSec: next.startSec,
          endSec: next.endSec,
          loop: loopCandidate,
        });
      } else {
        playbackStore.setWaveformSeekTo(next.startSec);
      }
    },
    [playerRef]
  );

  const onPrevCandidate = useCallback(() => navigateCandidate(-1), [navigateCandidate]);
  const onNextCandidate = useCallback(() => navigateCandidate(1), [navigateCandidate]);

  const playActiveCandidate = useCallback(() => {
    const searchStore = useSearchStore.getState();
    const { refinement, loopCandidate } = searchStore;

    if (!refinement.activeCandidateId) return;
    const activeCandidate = refinement.candidates.find(
      (c) => c.id === refinement.activeCandidateId
    );
    if (!activeCandidate) return;

    playerRef.current?.playSegment({
      startSec: activeCandidate.startSec,
      endSec: activeCandidate.endSec,
      loop: loopCandidate,
    });
  }, [playerRef]);

  const playQueryRegion = useCallback(() => {
    const { refinement } = useSearchStore.getState();
    const q = refinement.queryRegion;
    if (!q) return;
    playerRef.current?.playSegment({ startSec: q.startSec, endSec: q.endSec, loop: false });
  }, [playerRef]);

  const togglePlayShortcut = useCallback(() => {
    const player = playerRef.current;
    if (!player) return;

    const searchStore = useSearchStore.getState();
    const { refinement, loopCandidate } = searchStore;

    if (refinement.activeCandidateId) {
      const activeCandidate = refinement.candidates.find(
        (c) => c.id === refinement.activeCandidateId
      );
      if (activeCandidate) {
        if (player.isPlaying()) player.pause();
        else
          player.playSegment({
            startSec: activeCandidate.startSec,
            endSec: activeCandidate.endSec,
            loop: loopCandidate,
          });
        return;
      }
    }

    player.playPause();
  }, [playerRef]);

  const setActiveStatus = useCallback(
    (status: "accepted" | "rejected") => {
      const searchStore = useSearchStore.getState();
      const playbackStore = usePlaybackStore.getState();
      const { refinement, candidateFilter, loopCandidate, autoPlayOnNavigate, advanceToNextBest } = searchStore;

      if (!refinement.activeCandidateId) return;
      const current = refinement.candidates.find((c) => c.id === refinement.activeCandidateId);
      if (!current) return;

      // Get filtered candidates
      const filteredCandidates =
        candidateFilter === "all"
          ? refinement.candidates
          : refinement.candidates.filter((c) => c.status === candidateFilter);

      let next: RefinementCandidate | null = null;

      if (advanceToNextBest) {
        // Find next best unreviewed candidate (highest score among unreviewed)
        let best: RefinementCandidate | null = null;
        for (const c of refinement.candidates) {
          if (c.id === current.id) continue; // Skip current
          if (c.status !== "unreviewed") continue;
          if (c.score == null) continue;
          if (!best || (best.score ?? -Infinity) < c.score) best = c;
        }
        next = best;
      } else if (filteredCandidates.length > 1) {
        // Fall back to chronological (next in filtered list)
        const idx = filteredCandidates.findIndex((c) => c.id === current.id);
        const nextIndex = idx === -1 ? 0 : (idx + 1) % filteredCandidates.length;
        next = filteredCandidates[nextIndex] ?? null;
        if (next?.id === current.id) next = null;
      }

      searchStore.setRefinement((prevState) => {
        const updated = prevState.candidates.map((c) =>
          c.id === current.id ? { ...c, status } : c
        );
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
          playerRef.current?.playSegment({
            startSec: next.startSec,
            endSec: next.endSec,
            loop: loopCandidate,
          });
        } else {
          playbackStore.setWaveformSeekTo(next.startSec);
        }
      }
    },
    [playerRef]
  );

  const acceptActive = useCallback(() => setActiveStatus("accepted"), [setActiveStatus]);
  const rejectActive = useCallback(() => setActiveStatus("rejected"), [setActiveStatus]);

  const deleteActiveManual = useCallback(() => {
    const searchStore = useSearchStore.getState();
    const playbackStore = usePlaybackStore.getState();
    const { refinement, candidateFilter } = searchStore;

    if (!refinement.activeCandidateId) return;
    const activeCandidate = refinement.candidates.find(
      (c) => c.id === refinement.activeCandidateId
    );
    if (!activeCandidate || activeCandidate.source !== "manual") return;

    const id = activeCandidate.id;

    // Get filtered candidates
    const filteredCandidates =
      candidateFilter === "all"
        ? refinement.candidates
        : refinement.candidates.filter((c) => c.status === candidateFilter);

    const filteredWithout = filteredCandidates.filter((c) => c.id !== id);
    const idx = filteredCandidates.findIndex((c) => c.id === id);
    const next =
      filteredWithout.length > 0
        ? filteredWithout[Math.min(Math.max(0, idx), filteredWithout.length - 1)]
        : null;

    searchStore.setRefinement((prevState) => {
      const updated = prevState.candidates.filter((c) => c.id !== id);
      const nextActive = next?.id ?? (candidateFilter === "all" ? updated[0]?.id ?? null : null);
      return {
        ...prevState,
        candidates: updated,
        activeCandidateId: nextActive,
        refinementStats: computeRefinementStats(updated),
      };
    });

    if (next) playbackStore.setWaveformSeekTo(next.startSec);
  }, []);

  const jumpToBestUnreviewed = useCallback(() => {
    const searchStore = useSearchStore.getState();
    const playbackStore = usePlaybackStore.getState();
    const { refinement, loopCandidate, autoPlayOnNavigate } = searchStore;

    let best: RefinementCandidate | null = null;
    for (const c of refinement.candidates) {
      if (c.status !== "unreviewed") continue;
      if (c.score == null) continue;
      if (!best || (best.score ?? -Infinity) < c.score) best = c;
    }
    if (!best) return;

    searchStore.setRefinement((prevState) => ({ ...prevState, activeCandidateId: best.id }));

    if (autoPlayOnNavigate) {
      playerRef.current?.playSegment({
        startSec: best.startSec,
        endSec: best.endSec,
        loop: loopCandidate,
      });
    } else {
      playbackStore.setWaveformSeekTo(best.startSec);
    }
  }, [playerRef]);

  const handleFilterChange = useCallback(
    (nextFilter: "all" | "unreviewed" | "accepted" | "rejected") => {
      const searchStore = useSearchStore.getState();
      const playbackStore = usePlaybackStore.getState();
      const { refinement, loopCandidate, autoPlayOnNavigate } = searchStore;

      searchStore.setCandidateFilter(nextFilter);

      const list =
        nextFilter === "all"
          ? refinement.candidates
          : refinement.candidates.filter((c) => c.status === nextFilter);

      if (list.length === 0) {
        searchStore.setRefinement((prevState) => ({ ...prevState, activeCandidateId: null }));
        return;
      }

      const first = list[0];
      if (!first) return;

      const stillValid =
        refinement.activeCandidateId != null &&
        list.some((c) => c.id === refinement.activeCandidateId);
      const nextActiveId =
        stillValid && refinement.activeCandidateId ? refinement.activeCandidateId : first.id;

      searchStore.setRefinement((prevState) => ({ ...prevState, activeCandidateId: nextActiveId }));

      const candidatesById = new Map(refinement.candidates.map((c) => [c.id, c]));
      const c = nextActiveId ? candidatesById.get(nextActiveId) : null;
      if (c) {
        if (autoPlayOnNavigate) {
          playerRef.current?.playSegment({
            startSec: c.startSec,
            endSec: c.endSec,
            loop: loopCandidate,
          });
        } else {
          playbackStore.setWaveformSeekTo(c.startSec);
        }
      }
    },
    [playerRef]
  );

  return {
    navigateCandidate,
    onPrevCandidate,
    onNextCandidate,
    playActiveCandidate,
    playQueryRegion,
    togglePlayShortcut,
    setActiveStatus,
    acceptActive,
    rejectActive,
    deleteActiveManual,
    jumpToBestUnreviewed,
    handleFilterChange,
  };
}
