import { create } from "zustand";
import { devtools } from "zustand/middleware";
import type { WaveSurferViewport } from "@/components/wavesurfer/types";

interface PlaybackState {
  playheadTimeSec: number;
  cursorTimeSec: number | null;
  isAudioPlaying: boolean;
  viewport: WaveSurferViewport | null;
  waveformSeekTo: number | null;
}

interface PlaybackActions {
  setPlayheadTimeSec: (t: number) => void;
  setCursorTimeSec: (t: number | null) => void;
  setIsAudioPlaying: (playing: boolean) => void;
  setViewport: (vp: WaveSurferViewport | null) => void;
  setWaveformSeekTo: (timeSec: number | null) => void;
  normalizeViewport: (vp: WaveSurferViewport, audioDuration: number) => WaveSurferViewport;
}

export type PlaybackStore = PlaybackState & PlaybackActions;

const initialState: PlaybackState = {
  playheadTimeSec: 0,
  cursorTimeSec: null,
  isAudioPlaying: false,
  viewport: null,
  waveformSeekTo: null,
};

export const usePlaybackStore = create<PlaybackStore>()(
  devtools(
    (set) => ({
      ...initialState,

      setPlayheadTimeSec: (t) => set({ playheadTimeSec: t }, false, "setPlayheadTimeSec"),

      setCursorTimeSec: (t) => set({ cursorTimeSec: t }, false, "setCursorTimeSec"),

      setIsAudioPlaying: (playing) => set({ isAudioPlaying: playing }, false, "setIsAudioPlaying"),

      setViewport: (vp) => set({ viewport: vp }, false, "setViewport"),

      setWaveformSeekTo: (timeSec) => set({ waveformSeekTo: timeSec }, false, "setWaveformSeekTo"),

      normalizeViewport: (vp, audioDuration) => {
        const start = Math.max(0, Math.min(audioDuration || Infinity, vp.startTime));
        const endRaw = Math.max(start, vp.endTime);
        const end = audioDuration ? Math.min(audioDuration, endRaw) : endRaw;
        return {
          ...vp,
          startTime: start,
          endTime: end,
        };
      },
    }),
    { name: "playback-store" }
  )
);

/**
 * Get the mirrored cursor time (cursor if available, otherwise playhead).
 * Clamped to valid range.
 */
export function getMirroredCursorTime(
  cursorTimeSec: number | null,
  playheadTimeSec: number,
  audioDuration: number
): number {
  const t = cursorTimeSec ?? playheadTimeSec;
  if (!Number.isFinite(t)) return 0;
  if (audioDuration) return Math.min(audioDuration, Math.max(0, t));
  return Math.max(0, t);
}
