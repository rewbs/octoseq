"use client";

import { useEffect, useMemo, useRef } from "react";

import { Application, Sprite, Texture } from "pixi.js";

export type TimeAlignedHeatmapData = {
    /** Shape: [timeIndex][featureIndex] */
    data: Float32Array[];
    /** Seconds for each timeIndex. Must align 1:1 with `data.length`. */
    times: Float32Array;
};

export type TimeAlignedHeatmapProps = {
    input: TimeAlignedHeatmapData | null;

    /** Visible time range in seconds, driven externally (WaveSurfer is the source-of-truth). */
    startTime: number;
    endTime: number;

    width: number;
    height: number;

    /** Optional: if provided, clamps to a fixed scale. */
    valueRange?: { min: number; max: number };

    /** Optional display label for the Y axis. */
    yLabel?: string;
};

function clamp01(x: number): number {
    return x < 0 ? 0 : x > 1 ? 1 : x;
}

/**
 * Simple grayscale colour map.
 * (We keep it intentionally basic for diagnostic/introspection usage.)
 */
function grey(v01: number): [number, number, number, number] {
    const v = Math.round(clamp01(v01) * 255);
    return [v, v, v, 255];
}

function lowerBound(times: Float32Array, t: number): number {
    // First index i where times[i] >= t
    let lo = 0;
    let hi = times.length;
    while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if ((times[mid] ?? 0) < t) lo = mid + 1;
        else hi = mid;
    }
    return lo;
}

function upperBound(times: Float32Array, t: number): number {
    // First index i where times[i] > t
    let lo = 0;
    let hi = times.length;
    while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if ((times[mid] ?? 0) <= t) lo = mid + 1;
        else hi = mid;
    }
    return lo;
}

/**
 * Generic, time-aligned 2D heatmap viewer using PixiJS.
 *
 * Rendering assumptions / decisions:
 * - Input data is [frame][feature]. We render a bitmap where:
 *   - X = time (mapped via `times`)
 *   - Y = feature index (0..nFeatures-1)
 * - We only render the *visible* time window for performance.
 * - We do not interpolate time; each pixel column samples the nearest frame.
 *   (This keeps mapping simple and avoids inventing new time values.)
 */
export function TimeAlignedHeatmapPixi({ input, startTime, endTime, width, height, valueRange, yLabel }: TimeAlignedHeatmapProps) {
    const containerRef = useRef<HTMLDivElement | null>(null);

    const appRef = useRef<Application | null>(null);
    const spriteRef = useRef<Sprite | null>(null);
    const initDoneRef = useRef(false);

    // Keep latest render inputs in refs so we can trigger a render once Pixi finishes async init.
    const inputRef = useRef<TimeAlignedHeatmapData | null>(null);
    const startTimeRef = useRef(0);
    const endTimeRef = useRef(0);
    const widthRef = useRef(0);
    const heightRef = useRef(0);
    const rangeRef = useRef<{ min: number; max: number }>({ min: 0, max: 1 });

    // Track unmount to avoid updating Pixi after teardown.
    const aliveRef = useRef(true);

    // Callable ref so we can trigger a render from async init without "use before declare".
    const renderNowRef = useRef<() => void>(() => { });

    useEffect(() => {
        aliveRef.current = true;
        return () => {
            aliveRef.current = false;
        };
    }, []);

    // Create / destroy Pixi app.
    useEffect(() => {
        const host = containerRef.current;
        if (!host) return;

        const app = new Application();
        appRef.current = app;

        let destroyed = false;

        // Track init so cleanup can await it (avoids races under React StrictMode).
        initDoneRef.current = false;
        const initPromise = (async () => {
            try {
                initDoneRef.current = false;
                // Pixi v8 prefers async init.
                // We disable autoStart so the renderer doesn't tick/render until the
                // stage is fully created and attached.
                await app.init({
                    width,
                    height,
                    backgroundAlpha: 0,
                    antialias: false,
                    autoDensity: true,
                    resolution: window.devicePixelRatio || 1,
                    autoStart: false,
                });

                if (destroyed) return;

                host.appendChild(app.canvas);

                const sprite = new Sprite(Texture.EMPTY);
                spriteRef.current = sprite;
                sprite.width = width;
                sprite.height = height;
                app.stage.addChild(sprite);

                // Now safe to start ticking.
                initDoneRef.current = true;
                app.start();

                // If analysis finished before Pixi init, render once now.
                // (This fixes the "need to click Run Analysis twice" UX.)
                renderNowRef.current();
            } catch {
                // If init fails (WebGL unavailable, etc.), we fail "blank".
                // This widget is diagnostic; we prefer not crashing the app.
            }
        })();

        return () => {
            destroyed = true;

            // Clear refs first so any in-flight async bitmap updates no-op.
            spriteRef.current = null;
            const toDestroy = appRef.current;
            appRef.current = null;

            void initPromise.finally(() => {
                // In React dev (StrictMode), effects may mount/unmount rapidly.
                // Guard destroy so we don't throw if Pixi didn't fully init.
                try {
                    toDestroy?.stop();
                    const canvas = toDestroy?.canvas;
                    if (canvas?.parentElement) canvas.parentElement.removeChild(canvas);
                    toDestroy?.destroy(true);
                } catch {
                    // ignore
                }
            });
        };
        // width/height changes recreate app for simplicity.
    }, [width, height]);

    const computedRange = useMemo(() => {
        if (!input) return { min: 0, max: 1 };
        if (valueRange) return valueRange;

        // For visualisation we want a stable-ish range per render call; we compute min/max
        // over just the visible window to avoid outliers in offscreen data dominating.
        const { data, times } = input;
        const i0 = Math.max(0, lowerBound(times, startTime));
        const i1 = Math.min(data.length, upperBound(times, endTime));

        let min = Infinity;
        let max = -Infinity;

        for (let i = i0; i < i1; i++) {
            const row = data[i];
            if (!row) continue;
            for (let j = 0; j < row.length; j++) {
                const v = row[j] ?? 0;
                if (v < min) min = v;
                if (v > max) max = v;
            }
        }

        if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) {
            return { min: 0, max: 1 };
        }

        return { min, max };
    }, [input, valueRange, startTime, endTime]);

    function renderNow() {
        const app = appRef.current;
        const sprite = spriteRef.current;
        if (!app || !sprite) return;
        if (!aliveRef.current) return;
        if (!initDoneRef.current) {
            console.debug("[Heatmap] skip render: pixi init not done yet");
            return;
        }

        const curInput = inputRef.current;
        const curStartTime = startTimeRef.current;
        const curEndTime = endTimeRef.current;
        const curWidth = widthRef.current;
        const curHeight = heightRef.current;
        const range = rangeRef.current;

        // Avoid Pixi rendering while we hot-swap textures.
        app.stop();

        if (!curInput || curInput.data.length === 0 || curInput.times.length === 0) {
            console.debug("[Heatmap] no input/times", {
                hasInput: !!curInput,
                frames: curInput?.data.length ?? 0,
                times: curInput?.times.length ?? 0,
            });
            sprite.texture = Texture.EMPTY;
            app.start();
            return;
        }

        const { data, times } = curInput;
        const nFrames = data.length;
        const nFeatures = data[0]?.length ?? 0;

        console.debug("[Heatmap] render request", {
            startTime: curStartTime,
            endTime: curEndTime,
            frames: nFrames,
            nFeatures,
            t0: times[0],
            tN: times[times.length - 1],
            width: curWidth,
            height: curHeight,
        });

        if (nFeatures <= 0 || curWidth <= 0 || curHeight <= 0) {
            console.warn("[Heatmap] invalid dimensions", { nFeatures, curWidth, curHeight });
            sprite.texture = Texture.EMPTY;
            app.start();
            return;
        }

        const frame0 = Math.max(0, lowerBound(times, curStartTime));
        const frame1 = Math.min(nFrames, upperBound(times, curEndTime));
        if (frame1 <= frame0) {
            console.warn("[Heatmap] empty visible window", {
                frame0,
                frame1,
                startTime: curStartTime,
                endTime: curEndTime,
                t0: times[0],
                tN: times[times.length - 1],
            });
            sprite.texture = Texture.EMPTY;
            app.start();
            return;
        }

        const inv = 1 / (range.max - range.min);

        const w = Math.max(1, Math.floor(curWidth));
        const h = Math.max(1, Math.floor(curHeight));
        const pixels = new Uint8Array(w * h * 4);

        for (let x = 0; x < w; x++) {
            const a = w <= 1 ? 0 : x / (w - 1);
            const frame = Math.min(frame1 - 1, frame0 + Math.round(a * (frame1 - frame0 - 1)));
            const row = data[frame] ?? new Float32Array(nFeatures);

            for (let y = 0; y < h; y++) {
                const fj = h <= 1 ? 0 : Math.round(((h - 1 - y) / (h - 1)) * (nFeatures - 1));
                const v = row[fj] ?? 0;
                const v01 = clamp01((v - range.min) * inv);
                const [r, g, b, a255] = grey(v01);

                const idx = (y * w + x) * 4;
                pixels[idx] = r;
                pixels[idx + 1] = g;
                pixels[idx + 2] = b;
                pixels[idx + 3] = a255;
            }
        }

        const imageData = new ImageData(new Uint8ClampedArray(pixels.buffer), w, h);
        void createImageBitmap(imageData).then((bmp) => {
            if (!aliveRef.current) return;
            if (!appRef.current || !spriteRef.current) return;

            const tex = Texture.from(bmp);
            spriteRef.current.texture = tex;
            spriteRef.current.width = curWidth;
            spriteRef.current.height = curHeight;

            appRef.current?.render();
            appRef.current?.start();

            console.debug("[Heatmap] rendered", { frame0, frame1, w, h, rangeMin: range.min, rangeMax: range.max });
        });
    }

    // Keep callable ref in sync.
    useEffect(() => {
        renderNowRef.current = renderNow;
    });

    // Keep refs in sync and render on updates.
    useEffect(() => {
        inputRef.current = input;
        startTimeRef.current = startTime;
        endTimeRef.current = endTime;
        widthRef.current = width;
        heightRef.current = height;
        rangeRef.current = computedRange;

        renderNow();
    }, [input, startTime, endTime, width, height, computedRange]);

    return (
        <div className="w-full">
            <div className="rounded-xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-950">
                <div
                    ref={(el) => {
                        containerRef.current = el;
                    }}
                    style={{ width, height }}
                />
            </div>
            <p className="mt-2 text-xs text-zinc-500">
                2D heatmap view (PixiJS, time-synchronised)
                {yLabel ? (
                    <>
                        {" "}
                        <span className="text-zinc-400">— Y axis: {yLabel}</span>
                    </>
                ) : null}
            </p>
        </div>
    );
}
