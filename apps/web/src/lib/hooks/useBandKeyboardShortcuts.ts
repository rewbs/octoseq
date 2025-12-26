"use client";

import { useCallback } from "react";
import { useHotkeys } from "react-hotkeys-hook";
import { useShallow } from "zustand/react/shallow";
import { HOTKEY_SCOPE_APP } from "@/lib/hotkeys";
import { useFrequencyBandStore, type BandSnapMode } from "@/lib/stores/frequencyBandStore";
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
    const {
        structure,
        selectedBandId,
        hoveredKeyframeTime,
        snapMode,
        toggleSidebar,
        selectBand,
        addBand,
        updateBand,
        setSnapMode,
        getBandById,
    } = useFrequencyBandStore(useShallow((s) => ({
        structure: s.structure,
        selectedBandId: s.selectedBandId,
        hoveredKeyframeTime: s.hoveredKeyframeTime,
        snapMode: s.snapMode,
        toggleSidebar: s.toggleSidebar,
        selectBand: s.selectBand,
        addBand: s.addBand,
        updateBand: s.updateBand,
        setSnapMode: s.setSnapMode,
        getBandById: s.getBandById,
    })));

    // B: Toggle band sidebar
    useHotkeys("b", toggleSidebar, {
        enabled,
        scopes: [HOTKEY_SCOPE_APP],
        preventDefault: true,
    }, [toggleSidebar, enabled]);

    // N: Add new band
    const canAddBand = enabled && audioDuration > 0;
    const onAddBand = useCallback(() => {
        if (audioDuration <= 0) return;
        const bandCount = structure?.bands.length ?? 0;
        const newBand = createConstantBand(
            `Band ${bandCount + 1}`,
            200,
            2000,
            audioDuration,
            { sortOrder: bandCount }
        );
        const newId = addBand(newBand);
        selectBand(newId);
    }, [audioDuration, structure, addBand, selectBand]);

    useHotkeys("n", onAddBand, {
        enabled: canAddBand,
        scopes: [HOTKEY_SCOPE_APP],
        preventDefault: true,
    }, [onAddBand, canAddBand]);

    // D/Delete/Backspace: Delete hovered keyframe
    const canDeleteKeyframe = enabled && !!selectedBandId && hoveredKeyframeTime !== null;
    const onDeleteKeyframe = useCallback(() => {
        if (!selectedBandId || hoveredKeyframeTime === null) return;
        const band = getBandById(selectedBandId);
        if (!band) return;
        const updatedBand = removeKeyframe(band, hoveredKeyframeTime);
        updateBand(selectedBandId, { frequencyShape: updatedBand.frequencyShape });
    }, [selectedBandId, hoveredKeyframeTime, getBandById, updateBand]);

    useHotkeys("d", onDeleteKeyframe, {
        enabled: canDeleteKeyframe,
        scopes: [HOTKEY_SCOPE_APP],
        preventDefault: true,
    }, [onDeleteKeyframe, canDeleteKeyframe]);

    useHotkeys("delete, backspace", onDeleteKeyframe, {
        enabled: canDeleteKeyframe,
        scopes: [HOTKEY_SCOPE_APP],
        preventDefault: true,
    }, [onDeleteKeyframe, canDeleteKeyframe]);

    // S: Cycle snap mode
    const onCycleSnapMode = useCallback(() => {
        const modes: BandSnapMode[] = ["none", "beats", "frames", "keyframes"];
        const currentIndex = modes.indexOf(snapMode);
        const nextIndex = (currentIndex + 1) % modes.length;
        setSnapMode(modes[nextIndex]!);
    }, [snapMode, setSnapMode]);

    useHotkeys("s", onCycleSnapMode, {
        enabled,
        scopes: [HOTKEY_SCOPE_APP],
        preventDefault: true,
    }, [onCycleSnapMode, enabled]);

    // Escape: Deselect band
    const canDeselectBand = enabled && !!selectedBandId;
    useHotkeys("escape", () => selectBand(null), {
        enabled: canDeselectBand,
        scopes: [HOTKEY_SCOPE_APP],
        preventDefault: true,
    }, [selectBand, canDeselectBand]);
}
