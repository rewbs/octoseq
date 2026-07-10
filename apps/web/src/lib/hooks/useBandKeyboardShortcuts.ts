"use client";

import { useCallback } from "react";
import { useHotkeys } from "react-hotkeys-hook";
import { useShallow } from "zustand/react/shallow";
import { HOTKEY_SCOPE_APP } from "@/lib/hotkeys";
import {
  MIXDOWN_STREAM_ID,
  addBand,
  toFrequencyBand,
  updateBandShape,
  useBandEditingStore,
  useStreamStore,
  type BandSnapMode,
} from "@/lib/streams";
import { createConstantBand, removeKeyframe } from "@octoseq/mir";

// ----------------------------
// Types
// ----------------------------

export type UseBandKeyboardShortcutsOptions = {
  /** Whether keyboard shortcuts are enabled. */
  enabled?: boolean;

  /** Audio duration for creating new bands. */
  audioDuration: number;
};

// ----------------------------
// Hook
// ----------------------------

export function useBandKeyboardShortcuts({
  enabled = true,
  audioDuration,
}: UseBandKeyboardShortcutsOptions) {
  const { selectedBandId, selectBand } = useStreamStore(
    useShallow((s) => ({
      selectedBandId: s.selectedStreamId,
      selectBand: s.selectStream,
    }))
  );
  const { hoveredKeyframeTime, snapMode, setSnapMode } = useBandEditingStore(
    useShallow((s) => ({
      hoveredKeyframeTime: s.hoveredKeyframeTime,
      snapMode: s.snapMode,
      setSnapMode: s.setSnapMode,
    }))
  );

  // B: Toggle band sidebar
  const toggleSidebar = useCallback(() => {
    const editing = useBandEditingStore.getState();
    editing.setSidebarOpen(!editing.sidebarOpen);
  }, []);

  useHotkeys(
    "b",
    toggleSidebar,
    {
      enabled,
      scopes: [HOTKEY_SCOPE_APP],
      preventDefault: true,
    },
    [toggleSidebar, enabled]
  );

  // N: Add new band (under the mixdown, matching the legacy default source)
  const canAddBand = enabled && audioDuration > 0;
  const onAddBand = useCallback(() => {
    if (audioDuration <= 0) return;
    const bandCount = useStreamStore.getState().getBands().length;
    const template = createConstantBand(`Band ${bandCount + 1}`, 200, 2000, audioDuration, {
      sortOrder: bandCount,
    });
    const newId = addBand({
      parentId: MIXDOWN_STREAM_ID,
      label: template.label,
      frequencyShape: template.frequencyShape,
      timeScope: template.timeScope,
      provenance: template.provenance,
    });
    selectBand(newId);
  }, [audioDuration, selectBand]);

  useHotkeys(
    "n",
    onAddBand,
    {
      enabled: canAddBand,
      scopes: [HOTKEY_SCOPE_APP],
      preventDefault: true,
    },
    [onAddBand, canAddBand]
  );

  // D/Delete/Backspace: Delete hovered keyframe
  const canDeleteKeyframe = enabled && !!selectedBandId && hoveredKeyframeTime !== null;
  const onDeleteKeyframe = useCallback(() => {
    if (!selectedBandId || hoveredKeyframeTime === null) return;
    const stream = useStreamStore.getState().getStream(selectedBandId);
    if (!stream || stream.kind !== "band") return;
    const updatedBand = removeKeyframe(toFrequencyBand(stream), hoveredKeyframeTime);
    updateBandShape(selectedBandId, { frequencyShape: updatedBand.frequencyShape });
  }, [selectedBandId, hoveredKeyframeTime]);

  useHotkeys(
    "d",
    onDeleteKeyframe,
    {
      enabled: canDeleteKeyframe,
      scopes: [HOTKEY_SCOPE_APP],
      preventDefault: true,
    },
    [onDeleteKeyframe, canDeleteKeyframe]
  );

  useHotkeys(
    "delete, backspace",
    onDeleteKeyframe,
    {
      enabled: canDeleteKeyframe,
      scopes: [HOTKEY_SCOPE_APP],
      preventDefault: true,
    },
    [onDeleteKeyframe, canDeleteKeyframe]
  );

  // S: Cycle snap mode
  const onCycleSnapMode = useCallback(() => {
    const modes: BandSnapMode[] = ["none", "beats", "frames", "keyframes"];
    const currentIndex = modes.indexOf(snapMode);
    const nextIndex = (currentIndex + 1) % modes.length;
    setSnapMode(modes[nextIndex]!);
  }, [snapMode, setSnapMode]);

  useHotkeys(
    "s",
    onCycleSnapMode,
    {
      enabled,
      scopes: [HOTKEY_SCOPE_APP],
      preventDefault: true,
    },
    [onCycleSnapMode, enabled]
  );

  // Escape: Deselect band
  const canDeselectBand = enabled && !!selectedBandId;
  useHotkeys(
    "escape",
    () => selectBand(null),
    {
      enabled: canDeselectBand,
      scopes: [HOTKEY_SCOPE_APP],
      preventDefault: true,
    },
    [selectBand, canDeselectBand]
  );
}
