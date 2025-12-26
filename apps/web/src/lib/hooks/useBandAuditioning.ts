"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import { frequencyBoundsAt, type FrequencyBandStructure, type FrequencyBand } from "@octoseq/mir";

// ----------------------------
// Types
// ----------------------------

export type UseBandAuditioningOptions = {
    /** The audio source URL or blob URL to filter. */
    audioUrl: string | null;

    /** Whether auditioning is enabled. */
    enabled: boolean;

    /** The band being soloed (null if none). */
    soloedBandId: string | null;

    /** Muted band IDs (not used for auditioning, but kept for consistency). */
    mutedBandIds: Set<string>;

    /** The frequency band structure. */
    structure: FrequencyBandStructure | null;

    /** Current playhead time in seconds. */
    playheadTimeSec: number;

    /** Whether the main player is currently playing. */
    isMainPlaying: boolean;

    /** Main player volume (0-1). */
    mainVolume: number;

    /** Called to mute/unmute the main audio player. */
    onSetMainMuted?: (muted: boolean) => void;
};

export type UseBandAuditioningResult = {
    /** Whether auditioning is currently active. */
    isAuditioning: boolean;

    /** Play the auditioning audio from the given time. */
    play: (fromTimeSec?: number) => void;

    /** Pause the auditioning audio. */
    pause: () => void;

    /** Toggle play/pause for auditioning. */
    playPause: () => void;

    /** Whether auditioning audio is currently playing. */
    isPlaying: boolean;

    /** Current auditioned frequency bounds. */
    currentBounds: { lowHz: number; highHz: number } | null;
};

// ----------------------------
// Hook
// ----------------------------

export function useBandAuditioning({
    audioUrl,
    enabled,
    soloedBandId,
    structure,
    playheadTimeSec,
    isMainPlaying,
    mainVolume,
    onSetMainMuted,
}: UseBandAuditioningOptions): UseBandAuditioningResult {
    const audioContextRef = useRef<AudioContext | null>(null);
    const audioElementRef = useRef<HTMLAudioElement | null>(null);
    const sourceNodeRef = useRef<MediaElementAudioSourceNode | null>(null);
    const lowpassRef = useRef<BiquadFilterNode | null>(null);
    const highpassRef = useRef<BiquadFilterNode | null>(null);
    const gainNodeRef = useRef<GainNode | null>(null);

    const [isPlaying, setIsPlaying] = useState(false);
    const [currentBounds, setCurrentBounds] = useState<{ lowHz: number; highHz: number } | null>(null);

    // Get the soloed band
    const soloedBand: FrequencyBand | null =
        soloedBandId && structure
            ? structure.bands.find((b) => b.id === soloedBandId) ?? null
            : null;

    const isAuditioning = enabled && soloedBand !== null;

    // Initialize audio context and nodes
    useEffect(() => {
        if (!isAuditioning || !audioUrl) {
            // Clean up when not auditioning
            if (audioElementRef.current) {
                audioElementRef.current.pause();
                audioElementRef.current.src = "";
                audioElementRef.current = null;
            }
            if (audioContextRef.current) {
                void audioContextRef.current.close();
                audioContextRef.current = null;
            }
            sourceNodeRef.current = null;
            lowpassRef.current = null;
            highpassRef.current = null;
            gainNodeRef.current = null;
            setIsPlaying(false);
            setCurrentBounds(null);
            onSetMainMuted?.(false);
            return;
        }

        // Create audio context
        const ctx = new AudioContext();
        audioContextRef.current = ctx;

        // Create audio element
        const audio = new Audio();
        audio.crossOrigin = "anonymous";
        audio.src = audioUrl;
        audioElementRef.current = audio;

        // Create source node
        const source = ctx.createMediaElementSource(audio);
        sourceNodeRef.current = source;

        // Create filter nodes
        // Highpass filter (removes frequencies below lowHz)
        const highpass = ctx.createBiquadFilter();
        highpass.type = "highpass";
        highpass.frequency.value = 200; // Default, will be updated
        highpass.Q.value = 0.7; // Gentle rolloff
        highpassRef.current = highpass;

        // Lowpass filter (removes frequencies above highHz)
        const lowpass = ctx.createBiquadFilter();
        lowpass.type = "lowpass";
        lowpass.frequency.value = 2000; // Default, will be updated
        lowpass.Q.value = 0.7; // Gentle rolloff
        lowpassRef.current = lowpass;

        // Gain node for volume control
        const gain = ctx.createGain();
        gain.gain.value = mainVolume;
        gainNodeRef.current = gain;

        // Connect: source -> highpass -> lowpass -> gain -> destination
        source.connect(highpass);
        highpass.connect(lowpass);
        lowpass.connect(gain);
        gain.connect(ctx.destination);

        // Mute main audio when auditioning
        onSetMainMuted?.(true);

        // Handle audio element events
        const handlePlay = () => setIsPlaying(true);
        const handlePause = () => setIsPlaying(false);
        const handleEnded = () => setIsPlaying(false);

        audio.addEventListener("play", handlePlay);
        audio.addEventListener("pause", handlePause);
        audio.addEventListener("ended", handleEnded);

        return () => {
            audio.removeEventListener("play", handlePlay);
            audio.removeEventListener("pause", handlePause);
            audio.removeEventListener("ended", handleEnded);

            audio.pause();
            audio.src = "";

            void ctx.close();

            audioContextRef.current = null;
            audioElementRef.current = null;
            sourceNodeRef.current = null;
            lowpassRef.current = null;
            highpassRef.current = null;
            gainNodeRef.current = null;

            onSetMainMuted?.(false);
        };
    }, [isAuditioning, audioUrl, mainVolume, onSetMainMuted]);

    // Update filter frequencies based on band at current time
    useEffect(() => {
        if (!isAuditioning || !soloedBand) {
            setCurrentBounds(null);
            return;
        }

        const bounds = frequencyBoundsAt(soloedBand, playheadTimeSec);
        if (!bounds) {
            setCurrentBounds(null);
            return;
        }

        setCurrentBounds(bounds);

        // Update filter frequencies with smooth transitions
        const ctx = audioContextRef.current;
        const highpass = highpassRef.current;
        const lowpass = lowpassRef.current;

        if (ctx && highpass && lowpass) {
            const currentTime = ctx.currentTime;
            const transitionTime = 0.05; // 50ms transition for smooth frequency changes

            // Clamp frequencies to valid range
            const lowHz = Math.max(20, bounds.lowHz);
            const highHz = Math.min(20000, bounds.highHz);

            highpass.frequency.setTargetAtTime(lowHz, currentTime, transitionTime);
            lowpass.frequency.setTargetAtTime(highHz, currentTime, transitionTime);
        }
    }, [isAuditioning, soloedBand, playheadTimeSec]);

    // Update gain when volume changes
    useEffect(() => {
        const gain = gainNodeRef.current;
        if (gain) {
            gain.gain.value = mainVolume;
        }
    }, [mainVolume]);

    // Play control
    const play = useCallback(
        (fromTimeSec?: number) => {
            const audio = audioElementRef.current;
            const ctx = audioContextRef.current;

            if (!audio || !ctx) return;

            // Resume context if suspended
            if (ctx.state === "suspended") {
                void ctx.resume();
            }

            // Seek if time provided
            if (fromTimeSec !== undefined) {
                audio.currentTime = fromTimeSec;
            }

            void audio.play();
        },
        []
    );

    // Pause control
    const pause = useCallback(() => {
        const audio = audioElementRef.current;
        if (audio) {
            audio.pause();
        }
    }, []);

    // Toggle play/pause
    const playPause = useCallback(() => {
        if (isPlaying) {
            pause();
        } else {
            play();
        }
    }, [isPlaying, play, pause]);

    // Track the last synced time to detect seeks
    const lastSyncedTimeRef = useRef(playheadTimeSec);

    // Sync time with main player (handles seeks during playback and paused state)
    useEffect(() => {
        const audio = audioElementRef.current;
        if (!audio || !isAuditioning) return;

        const timeDelta = Math.abs(playheadTimeSec - lastSyncedTimeRef.current);
        const isSeek = timeDelta > 0.5; // More than 0.5s jump indicates a seek

        if (!isPlaying) {
            // Always sync when paused
            audio.currentTime = playheadTimeSec;
            lastSyncedTimeRef.current = playheadTimeSec;
        } else if (isSeek) {
            // Sync on seek during playback (large time jump)
            audio.currentTime = playheadTimeSec;
            lastSyncedTimeRef.current = playheadTimeSec;
        } else {
            // Normal playback - just update the ref without syncing
            lastSyncedTimeRef.current = playheadTimeSec;
        }
    }, [playheadTimeSec, isAuditioning, isPlaying]);

    // Track playhead in a ref so we can access it without re-running the effect
    const playheadTimeSecRef = useRef(playheadTimeSec);
    useEffect(() => {
        playheadTimeSecRef.current = playheadTimeSec;
    }, [playheadTimeSec]);

    // Sync play state with main player
    useEffect(() => {
        const audio = audioElementRef.current;
        const ctx = audioContextRef.current;
        if (!audio || !ctx || !isAuditioning) return;

        if (isMainPlaying) {
            // Resume context if suspended (required by browsers)
            if (ctx.state === "suspended") {
                void ctx.resume();
            }
            // Sync time before playing (use ref to avoid re-running on every playhead update)
            audio.currentTime = playheadTimeSecRef.current;
            void audio.play().catch(() => {
                // Ignore play errors (e.g., user hasn't interacted yet)
            });
        } else {
            audio.pause();
        }
    }, [isMainPlaying, isAuditioning]);

    return {
        isAuditioning,
        play,
        pause,
        playPause,
        isPlaying,
        currentBounds,
    };
}
