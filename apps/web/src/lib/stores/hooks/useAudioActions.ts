import { useCallback } from "react";
import { useAudioStore } from "../audioStore";
import { useAudioInputStore } from "../audioInputStore";
import { usePlaybackStore } from "../playbackStore";
import { useMirStore } from "../mirStore";
import { useSearchStore } from "../searchStore";
import { useBandProposalStore } from "../bandProposalStore";
import { useCandidateEventStore } from "../candidateEventStore";
import type { AudioInputOrigin } from "../types/audioInput";

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
    (a: { sampleRate: number; getChannelData: (n: number) => Float32Array }) => {
      const audioStore = useAudioStore.getState();
      const audioInputStore = useAudioInputStore.getState();
      const playbackStore = usePlaybackStore.getState();
      const mirStore = useMirStore.getState();
      const searchStore = useSearchStore.getState();
      const bandProposalStore = useBandProposalStore.getState();

      // Set audio buffer
      audioStore.setAudio(a as AudioBuffer);

      // Get filename: prefer pendingFileName (for URL loads), then fall back to file input
      const pendingFileName = audioStore.pendingFileName;
      const fileName = pendingFileName ?? fileInputRef.current?.files?.[0]?.name ?? null;
      const ch0 = a.getChannelData(0);

      // Clear pending filename after use
      if (pendingFileName) {
        audioStore.setPendingFileName(null);
      }

      // Set metadata
      const duration = ch0.length / a.sampleRate;
      audioStore.setAudioMetadata({
        fileName,
        sampleRate: a.sampleRate,
        totalSamples: ch0.length,
        duration,
      });

      // Initialize audio input store with mixdown
      // Determine origin based on how the audio was loaded
      const origin: AudioInputOrigin = pendingFileName
        ? { kind: "url", url: "", fileName: pendingFileName }
        : { kind: "file", fileName: fileName ?? "Unknown" };

      audioInputStore.updateMixdown({
        audioBuffer: a as AudioBuffer,
        metadata: {
          sampleRate: a.sampleRate,
          totalSamples: ch0.length,
          duration,
        },
        audioUrl: audioStore.audioUrl,
        origin,
        label: fileName ?? "Mixdown",
      });

      // Clear MIR results
      mirStore.clearMirResults();

      // Reset search state
      searchStore.resetSearch();

      // Reset band proposals (F5) — proposals are ephemeral and scoped to the current audio.
      bandProposalStore.reset();

      // Reset candidate events — candidates are ephemeral and scoped to the current audio.
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
