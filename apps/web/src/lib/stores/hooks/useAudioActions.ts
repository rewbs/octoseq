import { useCallback } from "react";
import type { AudioBufferLike } from "@octoseq/mir";
import { usePlaybackStore } from "../playbackStore";
import { useMirStore } from "../mirStore";
import { useSearchStore } from "../searchStore";
import { useBandProposalStore } from "../bandProposalStore";
import { useCandidateEventStore } from "../candidateEventStore";
import { loadMixdown, useAudioSourceStore, type AudioOrigin } from "@/lib/streams";

interface AudioActionsOptions {
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  onAudioLoaded?: () => void;
}

/**
 * Hook that provides audio-related actions.
 * Handles audio decoding and resetting state when new audio is loaded.
 */
export function useAudioActions({ fileInputRef, onAudioLoaded }: AudioActionsOptions) {
  const handleAudioDecoded = useCallback(
    (a: AudioBufferLike) => {
      const audioSourceStore = useAudioSourceStore.getState();
      const playbackStore = usePlaybackStore.getState();
      const searchStore = useSearchStore.getState();

      // Get filename: prefer pendingFileName (for URL loads), then fall back to file input
      const pendingFileName = audioSourceStore.pendingFileName;
      const fileName = pendingFileName ?? fileInputRef.current?.files?.[0]?.name ?? null;
      const ch0 = a.getChannelData(0);

      // Clear pending filename after use
      if (pendingFileName) {
        audioSourceStore.setPendingFileName(null);
      }

      const duration = ch0.length / a.sampleRate;

      // Get the current audio URL from the audio source (set by WaveSurfer before decode)
      const audioUrl = audioSourceStore.getCurrentUrl();

      // Determine origin based on how the audio was loaded
      const origin: AudioOrigin = pendingFileName
        ? { kind: "url", url: "", fileName: pendingFileName }
        : { kind: "file", fileName: fileName ?? "Unknown" };

      // Initialize/replace the mixdown stream. This also caches the PCM and
      // invalidates analyses for the mixdown and its dependent bands.
      loadMixdown({
        audio: {
          origin,
          url: audioUrl,
          fileName: fileName ?? undefined,
          durationSec: duration,
          sampleRate: a.sampleRate,
          channels: a.numberOfChannels,
        },
        buffer: a,
        label: fileName ?? "Mixdown",
      });

      // Reset legacy stores still in use (deleted in later Phase 1 tasks)
      useMirStore.getState().clearMirResults();
      searchStore.resetSearch();
      useBandProposalStore.getState().reset();
      useCandidateEventStore.getState().reset();

      // Reset playback state
      playbackStore.setWaveformSeekTo(null);
      playbackStore.setIsAudioPlaying(false);

      // Reset search-specific flags
      searchStore.setLoopCandidate(false);
      searchStore.setAutoPlayOnNavigate(false);

      // Trigger callback after audio is loaded
      onAudioLoaded?.();
    },
    [fileInputRef, onAudioLoaded]
  );

  const triggerFileInput = useCallback(() => {
    fileInputRef.current?.click();
  }, [fileInputRef]);

  return {
    handleAudioDecoded,
    triggerFileInput,
  };
}
