import { create } from "zustand";
import { devtools } from "zustand/middleware";
import type { AudioBufferLike } from "@octoseq/mir";

interface AudioState {
  audio: AudioBufferLike | null;
  audioFileName: string | null;
  audioSampleRate: number | null;
  audioTotalSamples: number | null;
  audioDuration: number;
}

interface AudioActions {
  setAudio: (audio: AudioBufferLike | null) => void;
  setAudioMetadata: (meta: {
    fileName: string | null;
    sampleRate: number;
    totalSamples: number;
    duration: number;
  }) => void;
  resetAudio: () => void;
}

export type AudioStore = AudioState & AudioActions;

const initialState: AudioState = {
  audio: null,
  audioFileName: null,
  audioSampleRate: null,
  audioTotalSamples: null,
  audioDuration: 0,
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

      resetAudio: () => set(initialState, false, "resetAudio"),
    }),
    { name: "audio-store" }
  )
);
