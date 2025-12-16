"use client";

import { useEffect, useRef } from "react";

import type { WaveSurferViewport } from "./types";

export type ClickableWaveformOverlayProps = {
    viewport: WaveSurferViewport | null;
    height: number;

    onClickTime?: (timeSec: number) => void;
};

/**
 * Transparent overlay that maps click x->time and notifies parent.
 *
 * This lets us implement click-to-seek without tightly coupling marker components
 * to the WaveSurfer instance.
 */
export function ClickableWaveformOverlay({ viewport, height, onClickTime }: ClickableWaveformOverlayProps) {
    const ref = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        const el = ref.current;
        if (!el || !viewport || !onClickTime) return;

        const onClick = (evt: MouseEvent) => {
            const rect = el.getBoundingClientRect();
            const span = viewport.endTime - viewport.startTime;
            if (span <= 0) return;
            const x = Math.max(0, Math.min(rect.width, evt.clientX - rect.left));
            const t = viewport.startTime + (x / rect.width) * span;
            onClickTime(Math.max(0, t));
        };

        el.addEventListener("click", onClick);
        return () => el.removeEventListener("click", onClick);
    }, [viewport, onClickTime]);

    return (
        <div
            ref={ref}
            className="absolute left-0 top-0"
            style={{ width: viewport?.containerWidthPx ?? 0, height, cursor: onClickTime ? "pointer" : "default" }}
        />
    );
}
