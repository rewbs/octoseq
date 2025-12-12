"use client";

import { useEffect, useRef } from "react";

import WaveSurfer from "wavesurfer.js";

import type { WaveSurferViewport } from "./types";

export type SyncedWaveSurferSignalProps = {
    /** Time-aligned signal to render as a pseudo-waveform (already normalised to [-1,1] or [0,1]). */
    data: Float32Array;

    /** Time (seconds) for each data sample. Must be aligned 1:1 with `data`. */
    times: Float32Array;

    /** Viewport from the main WaveSurfer instance (source-of-truth). */
    viewport: WaveSurferViewport | null;

    height?: number;
};

/**
 * Read-only, time-synchronised waveform renderer for 1D MIR features.
 *
 * Implementation note:
 * WebAudio enforces a minimum AudioBuffer sampleRate (~3000Hz).
 * MIR features are low-rate, so we upsample into a display-only buffer at 3000Hz
 * using a simple step-hold driven by the provided MIR `times` array.
 *
 * We then drive zoom/scroll from the main viewport.
 */
export function SyncedWaveSurferSignal({ data, times, viewport, height = 96 }: SyncedWaveSurferSignalProps) {
    const wsRef = useRef<WaveSurfer | null>(null);
    const containerRef = useRef<HTMLDivElement | null>(null);

    // Lint rule in this repo discourages setState within effects.
    // This component doesn't need to re-render on readiness, so we track it in a ref.
    const readyRef = useRef(false);

    // Important: viewport updates frequently (scroll/zoom). We MUST NOT recreate WaveSurfer
    // on every viewport change; instead we keep the latest viewport in a ref.
    const viewportRef = useRef<WaveSurferViewport | null>(viewport);
    useEffect(() => {
        viewportRef.current = viewport;
    }, [viewport]);

    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        const ws = WaveSurfer.create({
            container,
            height,
            waveColor: "#7c3aed", // violet-600
            progressColor: "#c4b5fd", // violet-300
            cursorColor: "#d4af37",
            normalize: false,
            autoScroll: false,
            autoCenter: false,
            interact: false,
            dragToSeek: false,
            minPxPerSec: 0,
        });

        wsRef.current = ws;

        const onReady = () => {
            readyRef.current = true;

            // If viewport already exists, apply it now (no React state needed).
            const vp = viewportRef.current;
            const scrollContainer = (ws.getRenderer() as unknown as { scrollContainer?: HTMLElement })?.scrollContainer;
            if (scrollContainer && vp?.minPxPerSec) {
                ws.zoom(vp.minPxPerSec);
                scrollContainer.scrollLeft = vp.startTime * vp.minPxPerSec;
            }

            console.debug("[MIR-1D] wavesurfer ready", {
                hasViewport: !!vp,
                minPxPerSec: vp?.minPxPerSec,
            });
        };
        ws.on("ready", onReady);

        return () => {
            readyRef.current = false;
            ws.destroy();
            wsRef.current = null;
        };
    }, [height]);

    useEffect(() => {
        const ws = wsRef.current;
        if (!ws) return;
        if (data.length === 0 || times.length === 0) {
            console.warn("[MIR-1D] empty data/times", { data: data.length, times: times.length });
            return;
        }
        if (data.length !== times.length) {
            console.warn("[MIR-1D] data/times length mismatch", { data: data.length, times: times.length });
            return;
        }

        console.debug("[MIR-1D] build display buffer", {
            frames: data.length,
            t0: times[0],
            tN: times[times.length - 1],
        });

        // WebAudio AudioBuffer enforces a minimum sampleRate (~3000Hz in browsers).
        // Our MIR features are typically low-rate (e.g. ~86 frames/sec), so we
        // upsample into a display buffer at a valid sampleRate using a simple
        // step-hold (nearest-frame) mapping driven by the provided `times`.
        //
        // This preserves *time alignment* without inventing new feature times.
        const duration = Math.max(0, times[times.length - 1] ?? 0);
        const displaySampleRate = 3000;
        const displayLength = Math.max(1, Math.ceil(duration * displaySampleRate));

        const out = new Float32Array(displayLength);

        // Walk through display samples and advance the frame index as time increases.
        // `times` are frame-center times; we treat each frame's value as constant
        // until the next frame time.
        let frame = 0;
        for (let i = 0; i < displayLength; i++) {
            const t = i / displaySampleRate;
            while (frame + 1 < times.length && (times[frame + 1] ?? 0) <= t) frame++;
            out[i] = data[frame] ?? 0;
        }

        // IMPORTANT: WaveSurfer v7 does not expose a public `loadDecodedBuffer()` API.
        // The supported way to visualise non-audio signals is to pass *precomputed peaks*
        // plus an explicit duration.
        //
        // By providing `peaks` we avoid any audio decoding. WaveSurfer internally creates
        // a synthetic AudioBuffer from peaks+duration and then renders it.
        // This is ideal for 1D MIR features.
        const peaks: Array<Float32Array> = [out];
        const dummyBlob = new Blob([], { type: "application/octet-stream" });

        console.debug("[MIR-1D] ws.loadBlob(peaks)", {
            duration,
            peaksLength: out.length,
            peaksMin: Math.min(...Array.from(out)),
            peaksMax: Math.max(...Array.from(out)),
        });

        void ws.loadBlob(dummyBlob, peaks, duration)
            .then(() => {
                console.debug("[MIR-1D] ws.loadBlob(peaks) ready", {
                    decodedDuration: ws.getDuration(),
                });
            })
            .catch((err) => {
                console.error("[MIR-1D] ws.loadBlob(peaks) failed", err);
            });
    }, [data, times]);

    useEffect(() => {
        const ws = wsRef.current;
        const container = containerRef.current;
        if (!ws || !container || !viewport) return;
        if (!readyRef.current) return;

        // Keep zoom consistent.
        ws.zoom(viewport.minPxPerSec);

        // Map visible time window -> scrollLeft in pixels.
        // We prefer using the shared minPxPerSec mapping so we don't rely on
        // WaveSurfer's internal duration being exactly the same as the main audio.
        //
        // This keeps time alignment tight:
        //   scrollLeftPx = startTimeSec * minPxPerSec
        const scrollContainer = (ws.getRenderer() as unknown as { scrollContainer?: HTMLElement })?.scrollContainer;
        if (!scrollContainer) return;

        if (viewport.minPxPerSec > 0) {
            scrollContainer.scrollLeft = viewport.startTime * viewport.minPxPerSec;
        } else {
            scrollContainer.scrollLeft = 0;
        }
    }, [viewport]);

    return (
        <div className="w-full">
            <div className="rounded-xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-950">
                <div
                    ref={(el) => {
                        containerRef.current = el;
                    }}
                    className="w-full overflow-x-hidden"
                />
            </div>
            <p className="mt-2 text-xs text-zinc-500">1D feature view (time-synchronised)</p>
        </div>
    );
}
