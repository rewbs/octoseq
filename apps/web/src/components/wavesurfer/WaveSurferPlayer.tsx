"use client";

import { useEffect, useRef, useState } from "react";

import WaveSurfer from "wavesurfer.js";
import Timeline from "wavesurfer.js/dist/plugins/timeline.esm.js";

import { Button } from "@/components/ui/button";

import type { AudioBufferLike } from "@octoseq/mir";

import type { WaveSurferViewport } from "./types";

type WaveSurferPlayerProps = {
    height?: number;

    /**
     * Called once WaveSurfer has decoded the audio.
     * We expose it in the minimal shape expected by @octoseq/mir.
     */
    onAudioDecoded?: (audio: AudioBufferLike) => void;

    /**
     * Main viewport source-of-truth for time synchronisation.
     * Uses WaveSurfer's `scroll` event.
     */
    onViewportChange?: (viewport: WaveSurferViewport) => void;

    /** Playback position in seconds (for driving playhead overlays elsewhere). */
    onPlaybackTime?: (timeSec: number) => void;
};

/**
 * Simple WaveSurfer.js (v7) player with:
 * - local file loading
 * - zoom (minPxPerSec)
 * - horizontal scroll + autoscroll
 * - timeline plugin
 */
export function WaveSurferPlayer({ height = 128, onAudioDecoded, onViewportChange, onPlaybackTime }: WaveSurferPlayerProps) {
    const wsRef = useRef<WaveSurfer | null>(null);
    const zoomRef = useRef(0);
    const onAudioDecodedRef = useRef<WaveSurferPlayerProps["onAudioDecoded"]>(onAudioDecoded);
    const onViewportChangeRef = useRef<WaveSurferPlayerProps["onViewportChange"]>(onViewportChange);
    const onPlaybackTimeRef = useRef<WaveSurferPlayerProps["onPlaybackTime"]>(onPlaybackTime);

    useEffect(() => {
        onAudioDecodedRef.current = onAudioDecoded;
        onViewportChangeRef.current = onViewportChange;
        onPlaybackTimeRef.current = onPlaybackTime;
    }, [onAudioDecoded, onViewportChange, onPlaybackTime]);

    const objectUrlRef = useRef<string | null>(null);

    const [containerEl, setContainerEl] = useState<HTMLDivElement | null>(null);
    const [timelineEl, setTimelineEl] = useState<HTMLDivElement | null>(null);

    const [isReady, setIsReady] = useState(false);
    const [isPlaying, setIsPlaying] = useState(false);
    const [zoom, setZoom] = useState(0);

    function cleanupObjectUrl() {
        if (objectUrlRef.current) {
            URL.revokeObjectURL(objectUrlRef.current);
            objectUrlRef.current = null;
        }
    }

    useEffect(() => {
        if (!containerEl || !timelineEl) return;

        // Create WS instance (once refs exist).
        const ws = WaveSurfer.create({
            container: containerEl,
            height,
            waveColor: "#52525b", // zinc-600
            progressColor: "#d4af37", // gold
            cursorColor: "#d4af37",
            barWidth: 2,
            barGap: 1,
            barRadius: 2,
            normalize: true,
            autoScroll: true,
            autoCenter: true,
            dragToSeek: true,
            minPxPerSec: 0,
            plugins: [
                Timeline.create({
                    container: timelineEl,
                }),
            ],
        });

        wsRef.current = ws;

        const onReady = () => {
            setIsReady(true);

            // Expose decoded audio to the app layer for MIR analysis.
            // WaveSurfer decodes to a WebAudio AudioBuffer; we adapt it to the
            // minimal AudioBufferLike shape that @octoseq/mir expects.
            const cb = onAudioDecodedRef.current;
            if (cb) {
                const decoded = ws.getDecodedData();
                if (decoded) {
                    cb({
                        sampleRate: decoded.sampleRate,
                        numberOfChannels: decoded.numberOfChannels,
                        getChannelData: (ch: number) => decoded.getChannelData(ch),
                    });
                }
            }

            // WaveSurfer doesn't necessarily emit a 'scroll' event until the user interacts.
            // We synthesise an initial viewport here so downstream visualisations have
            // a non-empty visible time range immediately.
            const scrollContainer = (ws.getRenderer() as unknown as { scrollContainer?: HTMLElement })?.scrollContainer;
            const duration = ws.getDuration() || 0;
            const minPxPerSec = zoomRef.current;
            const containerWidthPx = scrollContainer?.clientWidth ?? 0;

            const startTime = minPxPerSec > 0 ? (scrollContainer?.scrollLeft ?? 0) / minPxPerSec : 0;
            const endTime = minPxPerSec > 0 ? startTime + containerWidthPx / minPxPerSec : duration;

            onViewportChangeRef.current?.({
                startTime,
                endTime: Math.min(duration, endTime),
                containerWidthPx,
                totalWidthPx: scrollContainer?.scrollWidth ?? 0,
                minPxPerSec,
            });
        };
        const onPlay = () => setIsPlaying(true);
        const onPause = () => setIsPlaying(false);

        const onScroll = (startTime: number, endTime: number, leftPx: number, rightPx: number) => {
            // The WaveSurfer v7 'scroll' event gives us the current visible time range
            // and pixel bounds within the scroll container.
            // This is the source-of-truth for all time-aligned visualisations.
            //
            // Note: WaveSurfer's internal scroll width is based on scrollContainer, not wrapper.
            const scrollContainer = (ws.getRenderer() as unknown as { scrollContainer?: HTMLElement })?.scrollContainer;

            onViewportChangeRef.current?.({
                startTime,
                endTime,
                containerWidthPx: Math.max(0, rightPx - leftPx),
                totalWidthPx: scrollContainer?.scrollWidth ?? 0,
                minPxPerSec: zoomRef.current,
            });
        };

        ws.on("ready", onReady);
        ws.on("play", onPlay);
        ws.on("pause", onPause);
        ws.on("scroll", onScroll);

        let raf = 0;
        const tick = () => {
            // Best-effort: WaveSurfer v7 provides getCurrentTime().
            // We drive this from an rAF loop while mounted.
            onPlaybackTimeRef.current?.(ws.getCurrentTime() || 0);
            raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);

        return () => {
            cancelAnimationFrame(raf);
            cleanupObjectUrl();
            ws.un("scroll", onScroll);
            ws.destroy();
            wsRef.current = null;
            setIsReady(false);
            setIsPlaying(false);
        };
    }, [containerEl, timelineEl, height]);

    useEffect(() => {
        zoomRef.current = zoom;

        const ws = wsRef.current;
        if (!ws) return;
        ws.zoom(zoom);

        // WaveSurfer only emits 'scroll' on actual scroll/drag.
        // After zoom changes we synthesize a viewport update using the same
        // mapping WaveSurfer uses internally:
        //   scrollWidthPx = durationSec * minPxPerSec
        //   startTimeSec = scrollLeftPx / minPxPerSec
        const scrollContainer = (ws.getRenderer() as unknown as { scrollContainer?: HTMLElement })?.scrollContainer;
        if (!scrollContainer) return;

        const duration = ws.getDuration() || 0;
        const minPxPerSec = zoom;

        const scrollLeftPx = scrollContainer.scrollLeft || 0;
        const containerWidthPx = scrollContainer.clientWidth || 0;

        const startTime = minPxPerSec > 0 ? scrollLeftPx / minPxPerSec : 0;
        const endTime = startTime + (minPxPerSec > 0 ? containerWidthPx / minPxPerSec : duration);

        onViewportChangeRef.current?.({
            startTime,
            endTime: Math.min(duration, endTime),
            containerWidthPx,
            totalWidthPx: scrollContainer.scrollWidth || 0,
            minPxPerSec,
        });
    }, [zoom]);

    async function onPickFile(file: File) {
        const ws = wsRef.current;
        if (!ws) return;

        cleanupObjectUrl();
        const url = URL.createObjectURL(file);
        objectUrlRef.current = url;

        setIsReady(false);
        setIsPlaying(false);
        setZoom(0);

        await ws.load(url);
    }

    function togglePlay() {
        wsRef.current?.playPause();
    }

    function stop() {
        const ws = wsRef.current;
        if (!ws) return;
        ws.pause();
        ws.seekTo(0);
    }

    return (
        <div className="w-full">
            <div className="flex flex-wrap items-center gap-3">
                <label className="inline-flex items-center gap-2">
                    <span className="text-sm text-zinc-600 dark:text-zinc-300">Audio file</span>
                    <input
                        type="file"
                        accept="audio/*"
                        className="block text-sm"
                        onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (f) void onPickFile(f);
                        }}
                    />
                </label>

                <Button onClick={togglePlay} disabled={!isReady}>
                    {isPlaying ? "Pause" : "Play"}
                </Button>
                <Button variant="outline" onClick={stop} disabled={!isReady}>
                    Stop
                </Button>

                <div className="flex items-center gap-2">
                    <span className="text-sm text-zinc-600 dark:text-zinc-300">Zoom</span>
                    <input
                        type="range"
                        min={0}
                        max={400}
                        step={10}
                        value={zoom}
                        onChange={(e) => setZoom(Number(e.target.value))}
                        disabled={!isReady}
                    />
                    <span className="w-12 text-right text-sm tabular-nums text-zinc-600 dark:text-zinc-300">
                        {zoom}
                    </span>
                </div>
            </div>

            <div className="mt-4 rounded-xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-950">
                <div ref={setTimelineEl} className="w-full" />
                <div ref={setContainerEl} className="w-full overflow-x-auto" />
            </div>

            {!isReady && <p className="mt-3 text-sm text-zinc-500">Choose an audio file to load it.</p>}

            {/* Intentionally no footer text here; MIR visualisation sits directly under waveform. */}
        </div>
    );
}
