/**
 * Band Editing Store — ephemeral UI state for band authoring.
 *
 * Band DEFINITIONS live in streamStore as BandStream records; band selection is
 * streamStore.selectedStreamId. This store holds only the transient editing UI
 * state that used to be mixed into frequencyBandStore: hover, drag, snapping,
 * solo/mute audition flags, and the sidebar toggle. None of it is persisted.
 */

import { create } from "zustand";
import { devtools } from "zustand/middleware";
import type { StreamId } from "./types";

/** Snap mode for time alignment during editing. */
export type BandSnapMode = "none" | "beats" | "frames" | "keyframes";

/** Drag interaction state during direct manipulation. */
export type BandDragState = {
  bandId: StreamId;
  mode: "low-edge" | "high-edge" | "body" | "keyframe-time";
  /** Initial value at drag start (Hz or time depending on mode). */
  startValue: number;
  /** Initial mouse Y/X position at drag start. */
  startPosition: number;
} | null;

interface BandEditingState {
  /** Whether the user is actively editing bands. */
  isEditing: boolean;
  /** Currently hovered band (visual feedback). */
  hoveredBandId: StreamId | null;
  /** Currently hovered keyframe time (visual feedback). */
  hoveredKeyframeTime: number | null;
  /** Active drag operation. */
  dragState: BandDragState;
  /** Time snapping mode during editing. */
  snapMode: BandSnapMode;
  /** Band soloed for audio auditioning (null = no solo). */
  soloedBandId: StreamId | null;
  /** Bands muted in displays (visual only, not audio filtering). */
  mutedBandIds: Set<StreamId>;
  /** Whether the band sidebar panel is open. */
  sidebarOpen: boolean;
  /** Whether the band signal viewer is expanded. */
  signalViewerExpanded: boolean;
  /** Whether the band event viewer is expanded. */
  eventViewerExpanded: boolean;
  /** Bands whose event overlays are hidden (default: shown). */
  hiddenEventBandIds: Set<StreamId>;
}

interface BandEditingActions {
  setIsEditing: (editing: boolean) => void;
  setHoveredBand: (id: StreamId | null) => void;
  setHoveredKeyframeTime: (time: number | null) => void;
  setDragState: (state: BandDragState) => void;
  setSnapMode: (mode: BandSnapMode) => void;
  setSoloedBand: (id: StreamId | null) => void;
  toggleMutedBand: (id: StreamId) => void;
  setSidebarOpen: (open: boolean) => void;
  setSignalViewerExpanded: (expanded: boolean) => void;
  setEventViewerExpanded: (expanded: boolean) => void;
  toggleEventVisibility: (id: StreamId) => void;
  isEventVisible: (id: StreamId) => boolean;
  reset: () => void;
}

const initialState: BandEditingState = {
  isEditing: false,
  hoveredBandId: null,
  hoveredKeyframeTime: null,
  dragState: null,
  snapMode: "none",
  soloedBandId: null,
  mutedBandIds: new Set(),
  sidebarOpen: false,
  signalViewerExpanded: true,
  eventViewerExpanded: true,
  hiddenEventBandIds: new Set(),
};

export const useBandEditingStore = create<BandEditingState & BandEditingActions>()(
  devtools(
    (set, get) => ({
      ...initialState,

      setIsEditing: (isEditing) => set({ isEditing }, false, "setIsEditing"),
      setHoveredBand: (hoveredBandId) => set({ hoveredBandId }, false, "setHoveredBand"),
      setHoveredKeyframeTime: (hoveredKeyframeTime) =>
        set({ hoveredKeyframeTime }, false, "setHoveredKeyframeTime"),
      setDragState: (dragState) => set({ dragState }, false, "setDragState"),
      setSnapMode: (snapMode) => set({ snapMode }, false, "setSnapMode"),
      setSoloedBand: (soloedBandId) => set({ soloedBandId }, false, "setSoloedBand"),
      toggleMutedBand: (id) =>
        set(
          (state) => {
            const mutedBandIds = new Set(state.mutedBandIds);
            if (mutedBandIds.has(id)) mutedBandIds.delete(id);
            else mutedBandIds.add(id);
            return { mutedBandIds };
          },
          false,
          "toggleMutedBand"
        ),
      setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }, false, "setSidebarOpen"),
      setSignalViewerExpanded: (signalViewerExpanded) =>
        set({ signalViewerExpanded }, false, "setSignalViewerExpanded"),
      setEventViewerExpanded: (eventViewerExpanded) =>
        set({ eventViewerExpanded }, false, "setEventViewerExpanded"),
      toggleEventVisibility: (id) =>
        set(
          (state) => {
            const hiddenEventBandIds = new Set(state.hiddenEventBandIds);
            if (hiddenEventBandIds.has(id)) hiddenEventBandIds.delete(id);
            else hiddenEventBandIds.add(id);
            return { hiddenEventBandIds };
          },
          false,
          "toggleEventVisibility"
        ),
      isEventVisible: (id) => !get().hiddenEventBandIds.has(id),
      reset: () =>
        set(
          { ...initialState, mutedBandIds: new Set(), hiddenEventBandIds: new Set() },
          false,
          "reset"
        ),
    }),
    { name: "BandEditingStore" }
  )
);
