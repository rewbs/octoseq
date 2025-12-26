"use client";

import { useMemo } from "react";
import { keyframesFromBand, type FrequencyBandStructure } from "@octoseq/mir";
import { type BandSnapMode } from "@/lib/stores/frequencyBandStore";

// ----------------------------
// Beat Time Type (local definition)
// ----------------------------

export type BeatTimeInfo = {
    timeSec: number;
    bar: number;
    beatInBar: number;
};

// ----------------------------
// Types
// ----------------------------

export type SnapTarget = {
    time: number;
    type: "beat" | "frame" | "keyframe";
    label?: string;
};

export type UseSnapTargetsOptions = {
    /** Current snap mode. */
    snapMode: BandSnapMode;

    /** Frequency band structure for keyframe snap targets. */
    structure: FrequencyBandStructure | null;

    /** Beat grid for beat snap targets. */
    beats: BeatTimeInfo[] | null;

    /** Frame times for frame snap targets (e.g., spectrogram frame boundaries). */
    frameTimes?: number[] | null;

    /** Visible time range for filtering targets. */
    startTime: number;
    endTime: number;
};

export type UseSnapTargetsResult = {
    /** All snap targets in the visible range. */
    targets: SnapTarget[];

    /** Find the nearest snap target within tolerance. */
    findSnapTarget: (time: number, toleranceSec: number) => SnapTarget | null;

    /** Snap a time value to the nearest target. */
    snapTime: (time: number, toleranceSec: number) => number;
};

// ----------------------------
// Hook
// ----------------------------

export function useSnapTargets({
    snapMode,
    structure,
    beats,
    frameTimes,
    startTime,
    endTime,
}: UseSnapTargetsOptions): UseSnapTargetsResult {
    // Build snap targets based on mode
    const targets = useMemo(() => {
        if (snapMode === "none") return [];

        const result: SnapTarget[] = [];
        const margin = (endTime - startTime) * 0.1; // 10% margin for nearby targets

        if (snapMode === "beats" && beats) {
            for (const beat of beats) {
                if (beat.timeSec >= startTime - margin && beat.timeSec <= endTime + margin) {
                    result.push({
                        time: beat.timeSec,
                        type: "beat",
                        label: beat.beatInBar === 1 ? `Bar ${beat.bar}` : `${beat.bar}.${beat.beatInBar}`,
                    });
                }
            }
        }

        if (snapMode === "frames" && frameTimes) {
            for (const frameTime of frameTimes) {
                if (frameTime >= startTime - margin && frameTime <= endTime + margin) {
                    result.push({
                        time: frameTime,
                        type: "frame",
                    });
                }
            }
        }

        if (snapMode === "keyframes" && structure) {
            for (const band of structure.bands) {
                if (!band.enabled) continue;
                const keyframes = keyframesFromBand(band);
                for (const kf of keyframes) {
                    if (kf.time >= startTime - margin && kf.time <= endTime + margin) {
                        // Avoid duplicate times
                        if (!result.some((t) => Math.abs(t.time - kf.time) < 0.001)) {
                            result.push({
                                time: kf.time,
                                type: "keyframe",
                                label: band.label,
                            });
                        }
                    }
                }
            }
        }

        // Sort by time
        result.sort((a, b) => a.time - b.time);

        return result;
    }, [snapMode, structure, beats, frameTimes, startTime, endTime]);

    // Find the nearest snap target within tolerance
    const findSnapTarget = useMemo(() => {
        return (time: number, toleranceSec: number): SnapTarget | null => {
            if (targets.length === 0) return null;

            let nearestTarget: SnapTarget | null = null;
            let nearestDistance = Infinity;

            for (const target of targets) {
                const distance = Math.abs(target.time - time);
                if (distance < toleranceSec && distance < nearestDistance) {
                    nearestTarget = target;
                    nearestDistance = distance;
                }
            }

            return nearestTarget;
        };
    }, [targets]);

    // Snap a time value to the nearest target
    const snapTime = useMemo(() => {
        return (time: number, toleranceSec: number): number => {
            const target = findSnapTarget(time, toleranceSec);
            return target ? target.time : time;
        };
    }, [findSnapTarget]);

    return {
        targets,
        findSnapTarget,
        snapTime,
    };
}

// ----------------------------
// Helpers
// ----------------------------

/**
 * Convert pixel distance to time tolerance based on viewport.
 */
export function pixelsToTimeTolerance(
    pixels: number,
    viewportWidth: number,
    startTime: number,
    endTime: number
): number {
    const timeRange = endTime - startTime;
    if (viewportWidth <= 0 || timeRange <= 0) return 0;
    return (pixels / viewportWidth) * timeRange;
}
