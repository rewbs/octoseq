import { create } from "zustand";
import { devtools } from "zustand/middleware";
import type { AudioBufferLike } from "@octoseq/mir";

interface AudioState {
  audio: AudioBufferLike | null;
  audioFileName: string | null;
  audioSampleRate: number | null;
  audioTotalSamples: number | null;
  audioDuration: number;
  /** URL for the current audio (blob URL or direct URL) for auditioning */
  audioUrl: string | null;
  /** Used to pass filename when loading from URL (not file input) */
  pendingFileName: string | null;
}

interface AudioActions {
  setAudio: (audio: AudioBufferLike | null) => void;
  setAudioMetadata: (meta: {
    fileName: string | null;
    sampleRate: number;
    totalSamples: number;
    duration: number;
  }) => void;
  setAudioUrl: (url: string | null) => void;
  setPendingFileName: (fileName: string | null) => void;
  resetAudio: () => void;
}

export type AudioStore = AudioState & AudioActions;

const initialState: AudioState = {
  audio: null,
  audioFileName: null,
  audioSampleRate: null,
  audioTotalSamples: null,
  audioDuration: 0,
  audioUrl: null,
  pendingFileName: null,
};

export const useAudioStore = create<AudioStore>()(
  devtools(
    (set) => ({
      ...initialState,

      setAudio: (audio) => set({ audio }, false, "setAudio"),

      setAudioMetadata: (meta) =>
        set(
          {
            audioFileName: meta.fileName,
            audioSampleRate: meta.sampleRate,
            audioTotalSamples: meta.totalSamples,
            audioDuration: meta.duration,
          },
          false,
          "setAudioMetadata"
        ),

      setAudioUrl: (url) => set({ audioUrl: url }, false, "setAudioUrl"),

      setPendingFileName: (fileName) =>
        set({ pendingFileName: fileName }, false, "setPendingFileName"),

      resetAudio: () => set(initialState, false, "resetAudio"),
    }),
    { name: "audio-store" }
  )
);
