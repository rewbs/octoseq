import { useCallback, useRef } from "react";
import type { MirAudioPayload } from "@octoseq/mir";
import { useAudioInputStore } from "../audioInputStore";
import { useSearchStore } from "../searchStore";
import { usePlaybackStore } from "../playbackStore";
import { useConfigStore } from "../configStore";
import { MirWorkerClient, type MirWorkerSearchJob } from "@/lib/mirWorkerClient";
import { precisionToHopSec } from "@/lib/searchHopMapping";
import {
  computeRefinementStats,
  makeAutoCandidateId,
  type RefinementCandidate,
} from "@/lib/searchRefinement";
import type { SearchControls } from "@/components/search/SearchControlsPanel";

/**
 * Hook that provides search actions with worker management.
 */
export function useSearchActions() {
  const workerRef = useRef<MirWorkerClient | null>(null);
  const activeSearchJobRef = useRef<MirWorkerSearchJob | null>(null);

  // Lazy init worker
  if (!workerRef.current && typeof window !== "undefined") {
    workerRef.current = new MirWorkerClient();
  }

  const runSearch = useCallback(
    async (region: { startSec: number; endSec: number }, controls: SearchControls) => {
      const audio = useAudioInputStore.getState().getAudio();
      if (!audio) return;
      if (!workerRef.current) throw new Error("worker not initialised");

      const searchStore = useSearchStore.getState();
      const playbackStore = usePlaybackStore.getState();
      const configStore = useConfigStore.getState();

      const { refinement, useRefinementSearch } = searchStore;
      const { enableGpu, debug } = configStore;

      const t0 = Math.min(region.startSec, region.endSec);
      const t1 = Math.max(region.startSec, region.endSec);
      const dur = Math.max(1e-3, t1 - t0);

      // Cancel any in-flight search before starting a new one.
      if (activeSearchJobRef.current) {
        activeSearchJobRef.current.cancel();
        activeSearchJobRef.current = null;
      }

      // Keep human labels when re-running search
      searchStore.setRefinement((prevState) => {
        const preserved = prevState.candidates
          .filter((c) => c.source === "manual" || c.status !== "unreviewed")
          .sort((a, b) => a.startSec - b.startSec);
        const nextActive = preserved.some((c) => c.id === prevState.activeCandidateId)
          ? prevState.activeCandidateId
          : null;
        return {
          ...prevState,
          candidates: preserved,
          activeCandidateId: nextActive,
          refinementStats: computeRefinementStats(preserved),
        };
      });

      // Build transferable audio payload
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

      const spectrogramConfig = configStore.getSpectrogramConfig();
      const melConfig = configStore.getMelConfig();
      const onsetConfig = configStore.getOnsetConfig();
      const mfccConfig = configStore.getMfccConfig();

      searchStore.setIsSearchRunning(true);

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
          features: {
            spectrogram: spectrogramConfig,
            mel: melConfig,
            onset: onsetConfig,
            mfcc: mfccConfig,
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
        searchStore.setSearchResult(res);

        searchStore.setRefinement((prevState) => {
          const preserved = prevState.candidates.filter(
            (c) => c.source === "manual" || c.status !== "unreviewed"
          );
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
          const resultCandidates = [...res.candidates].sort(
            (a, b) => a.windowStartSec - b.windowStartSec
          );

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

          const nextCandidates = [...preservedUpdated, ...newAuto].sort(
            (a, b) => a.startSec - b.startSec
          );

          const stillActive =
            prevState.activeCandidateId != null &&
            nextCandidates.some((c) => c.id === prevState.activeCandidateId);
          const nextActive = stillActive
            ? prevState.activeCandidateId
            : nextCandidates.find((c) => c.status === "unreviewed")?.id ??
              nextCandidates[0]?.id ??
              null;

          const nextActiveCandidate = nextActive
            ? nextCandidates.find((c) => c.id === nextActive) ?? null
            : null;
          if (nextActiveCandidate) {
            playbackStore.setWaveformSeekTo(nextActiveCandidate.startSec);
          }

          return {
            ...prevState,
            candidates: nextCandidates,
            activeCandidateId: nextActive,
            refinementStats: computeRefinementStats(nextCandidates),
          };
        });

        searchStore.setSearchDirty(false);
        searchStore.setAddMissingMode(true);
      } finally {
        searchStore.setIsSearchRunning(false);
        if (activeSearchJobRef.current?.id === job.id) {
          activeSearchJobRef.current = null;
        }
      }
    },
    []
  );

  const cancelSearch = useCallback(() => {
    if (activeSearchJobRef.current) {
      activeSearchJobRef.current.cancel();
      activeSearchJobRef.current = null;
    }
  }, []);

  return { runSearch, cancelSearch };
}
