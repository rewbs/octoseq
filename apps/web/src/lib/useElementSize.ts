"use client";

import { useEffect, useState } from "react";

/**
 * Small ResizeObserver hook to measure an element.
 * Used to make the heatmap width match the waveform container.
 */
export function useElementSize<T extends HTMLElement>() {
    const [el, setEl] = useState<T | null>(null);
    const [size, setSize] = useState({ width: 0, height: 0 });

    useEffect(() => {
        if (!el) return;

        const update = () => {
            const rect = el.getBoundingClientRect();
            setSize({ width: rect.width, height: rect.height });
        };

        update();

        const ro = new ResizeObserver(() => update());
        ro.observe(el);

        return () => ro.disconnect();
    }, [el]);

    return { ref: setEl, size };
}
