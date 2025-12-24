"use client";

import { useEffect, useRef, useCallback } from "react";

/**
 * Options for the metronome hook.
 */
export type UseMetronomeOptions = {
    /** Whether the metronome is enabled. */
    enabled: boolean;
    /** Whether audio is currently playing. */
    isPlaying: boolean;
    /** Current playhead time in seconds. */
    playheadTimeSec: number;
    /** BPM of the beat grid. */
    bpm: number;
    /** Phase offset in seconds (first beat time). */
    phaseOffset: number;
    /** User nudge offset in seconds. */
    userNudge: number;
    /** Volume level 0-1. Default: 0.3 */
    volume?: number;
    /** Click frequency in Hz. Default: 1000 */
    frequency?: number;
    /** Click duration in seconds. Default: 0.05 */
    clickDuration?: number;
};

/**
 * Hook that plays metronome clicks synchronized to a beat grid.
 * Uses Web Audio API for precise timing.
 */
export function useMetronome({
    enabled,
    isPlaying,
    playheadTimeSec,
    bpm,
    phaseOffset,
    userNudge,
    volume = 0.3,
    frequency = 1000,
    clickDuration = 0.05,
}: UseMetronomeOptions) {
    const audioContextRef = useRef<AudioContext | null>(null);
    const lastBeatIndexRef = useRef<number>(-1);
    const isInitializedRef = useRef(false);

    // Initialize AudioContext on first interaction
    const initAudioContext = useCallback(() => {
        if (!audioContextRef.current) {
            audioContextRef.current = new AudioContext();
        }
        if (audioContextRef.current.state === "suspended") {
            audioContextRef.current.resume();
        }
        isInitializedRef.current = true;
    }, []);

    // Play a click sound
    const playClick = useCallback(() => {
        const ctx = audioContextRef.current;
        if (!ctx || ctx.state !== "running") return;

        const now = ctx.currentTime;

        // Create oscillator for the click
        const oscillator = ctx.createOscillator();
        oscillator.type = "sine";
        oscillator.frequency.value = frequency;

        // Create gain node for envelope
        const gainNode = ctx.createGain();
        gainNode.gain.setValueAtTime(volume, now);
        gainNode.gain.exponentialRampToValueAtTime(0.001, now + clickDuration);

        // Connect and play
        oscillator.connect(gainNode);
        gainNode.connect(ctx.destination);

        oscillator.start(now);
        oscillator.stop(now + clickDuration);
    }, [frequency, volume, clickDuration]);

    // Main effect: track beats and play clicks
    useEffect(() => {
        if (!enabled || !isPlaying || bpm <= 0) {
            // Reset when disabled or stopped
            lastBeatIndexRef.current = -1;
            return;
        }

        // Initialize audio context if needed (requires user interaction)
        if (!isInitializedRef.current) {
            initAudioContext();
        }

        const period = 60 / bpm;
        const effectivePhase = phaseOffset + userNudge;

        // Calculate current beat index
        const timeSincePhase = playheadTimeSec - effectivePhase;
        const currentBeatIndex = Math.floor(timeSincePhase / period);

        // Play click when we cross into a new beat
        if (currentBeatIndex !== lastBeatIndexRef.current && currentBeatIndex >= 0) {
            // Only play if this is a forward progression (not seeking backwards)
            if (currentBeatIndex > lastBeatIndexRef.current || lastBeatIndexRef.current === -1) {
                playClick();
            }
            lastBeatIndexRef.current = currentBeatIndex;
        }
    }, [enabled, isPlaying, playheadTimeSec, bpm, phaseOffset, userNudge, initAudioContext, playClick]);

    // Reset beat tracking when playback stops
    useEffect(() => {
        if (!isPlaying) {
            lastBeatIndexRef.current = -1;
        }
    }, [isPlaying]);

    // Cleanup AudioContext on unmount
    useEffect(() => {
        return () => {
            if (audioContextRef.current) {
                audioContextRef.current.close();
                audioContextRef.current = null;
            }
        };
    }, []);

    return {
        /** Initialize audio context (call on user interaction if needed). */
        initAudioContext,
    };
}
