/**
 * Audio Source Store — playback authority, keyed by StreamId.
 *
 * Carries forward the proven design from the legacy audioInputStore:
 * - Playback wants URLs. Analysis wants PCM. Authority wants one owner.
 * - WaveSurfer loads audio by URL only; `currentSource` is the single source of
 *   truth for what is playing, with an explicit resolution lifecycle
 *   (pending → resolving → ready | failed) driven by useAudioSourceResolver.
 *
 * What changed: sources are keyed by StreamId from the unified stream model, and
 * decoded/raw audio bytes live in the non-reactive caches (audioCache/rawFileCache),
 * never here.
 */

import { create } from "zustand";
import { devtools } from "zustand/middleware";
import { MIXDOWN_STREAM_ID, type StreamId } from "./types";

// ----------------------------
// AudioSource types
// ----------------------------

/**
 * Status of an AudioSource's URL resolution.
 * - pending: source set but URL not yet requested
 * - resolving: URL fetch/creation in progress
 * - ready: URL available for playback
 * - failed: resolution failed (see error field)
 */
export type AudioSourceStatus = "pending" | "resolving" | "ready" | "failed";

interface AudioSourceBase {
  /** The stream this source plays. */
  id: StreamId;
  status: AudioSourceStatus;
  /** Playback URL. Set when status is 'ready'. */
  url?: string;
  /** Error message. Set when status is 'failed'. */
  error?: string;
}

/** Audio from a local file (File API); URL via URL.createObjectURL(). */
export interface LocalAudioSource extends AudioSourceBase {
  type: "local";
  file: File;
}

/** Audio from cloud storage (R2); URL via pre-signed download. */
export interface RemoteAudioSource extends AudioSourceBase {
  type: "remote";
  cloudAssetId: string;
}

/** Audio generated in-app (e.g. mixdown from stems). */
export interface GeneratedAudioSource extends AudioSourceBase {
  type: "generated";
  generatedFrom: StreamId[];
}

export type AudioSource = LocalAudioSource | RemoteAudioSource | GeneratedAudioSource;

// ----------------------------
// Store
// ----------------------------

interface AudioSourceState {
  /** The single source of truth for what audio is playing. Null = nothing loaded. */
  currentSource: AudioSource | null;

  /** Which stream's waveform is displayed in the main player. */
  displayedStreamId: StreamId;

  /** File name for URL-based loads, set before decode, cleared after. */
  pendingFileName: string | null;

  /** Callback to open the audio file picker. Registered by the page on mount. */
  triggerFileInput: (() => void) | null;
}

interface AudioSourceActions {
  /** Set a new playback source (typically with status "pending"). */
  setCurrentSource: (source: AudioSource | null) => void;

  /** Update the resolution status of the current source. */
  updateSourceStatus: (status: AudioSourceStatus, url?: string, error?: string) => void;

  setDisplayedStream: (id: StreamId) => void;
  setPendingFileName: (name: string | null) => void;
  setTriggerFileInput: (fn: (() => void) | null) => void;

  /** URL of the current source if it is ready, else null. */
  getCurrentUrl: () => string | null;

  reset: () => void;
}

const initialState: AudioSourceState = {
  currentSource: null,
  displayedStreamId: MIXDOWN_STREAM_ID,
  pendingFileName: null,
  triggerFileInput: null,
};

export const useAudioSourceStore = create<AudioSourceState & AudioSourceActions>()(
  devtools(
    (set, get) => ({
      ...initialState,

      setCurrentSource: (source) =>
        set({ currentSource: source }, false, "setCurrentSource"),

      updateSourceStatus: (status, url, error) =>
        set(
          (state) => {
            if (!state.currentSource) return state;
            return {
              currentSource: { ...state.currentSource, status, url, error },
            };
          },
          false,
          "updateSourceStatus"
        ),

      setDisplayedStream: (id) => set({ displayedStreamId: id }, false, "setDisplayedStream"),

      setPendingFileName: (name) => set({ pendingFileName: name }, false, "setPendingFileName"),

      setTriggerFileInput: (fn) => set({ triggerFileInput: fn }, false, "setTriggerFileInput"),

      getCurrentUrl: () => {
        const source = get().currentSource;
        return source?.status === "ready" && source.url ? source.url : null;
      },

      reset: () =>
        set(
          { ...initialState, triggerFileInput: get().triggerFileInput },
          false,
          "reset"
        ),
    }),
    { name: "AudioSourceStore" }
  )
);
