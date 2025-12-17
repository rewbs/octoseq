"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type MouseEvent, type RefObject } from "react";

import WaveSurfer from "wavesurfer.js";
import Timeline from "wavesurfer.js/dist/plugins/timeline.esm.js";
import Regions from "wavesurfer.js/dist/plugins/regions.esm.js";

import { Button } from "@/components/ui/button";


import type { AudioBufferLike } from "@octoseq/mir";

import type { RefinementCandidate } from "@/lib/searchRefinement";
import type { WaveSurferViewport } from "./types";

// Minimal typing to avoid depending on WaveSurfer's internal plugin registry.
type RegionLike = {
  id: string;
  start: number;
  end: number;
  element?: HTMLElement | null;
  remove: () => void;
  setOptions: (opts: {
    start?: number;
    end?: number;
    color?: string;
    drag?: boolean;
    resize?: boolean;
    resizeStart?: boolean;
    resizeEnd?: boolean;
  }) => void;
};

type RegionsPluginLike = {
  on: (evt: string, cb: (region: RegionLike, ...rest: unknown[]) => void) => void;
  un: (evt: string, cb: (region: RegionLike, ...rest: unknown[]) => void) => void;
  getRegions: () => RegionLike[];
  addRegion: (options: { id?: string; start: number; end: number; color?: string; drag?: boolean; resize?: boolean }) => RegionLike;
  clearRegions: () => void;
  enableDragSelection: (options: { id?: string; color?: string; drag?: boolean; resize?: boolean }, threshold?: number) => () => void;
};

const QUERY_REGION_ID = "query";

export type WaveSurferPlayerHandle = {
  playPause: () => void;
  pause: () => void;
  stop: () => void;
  playSegment: (opts: { startSec: number; endSec: number; loop?: boolean }) => void;
  isPlaying: () => boolean;
  loadAudio: (file: File) => Promise<void>;
};

type WaveSurferPlayerProps = {
  height?: number;
  fileInputRef?: RefObject<HTMLInputElement | null>;
  cursorTimeSec?: number | null;
  onCursorTimeChange?: (timeSec: number | null) => void;
  /** Current viewport (for mapping mirrored cursor overlay). */
  viewport?: WaveSurferViewport | null;

  /**
   * Optional: allow parent to seek playback.
   * We keep this minimal (time-only) and implement it by calling ws.setTime().
   */
  seekToTimeSec?: number | null;

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

  /** Playback state change. */
  onPlayingChange?: (isPlaying: boolean) => void;

  /**
   * Region selection (single active region).
   * Called whenever the user creates/updates a region.
   */
  onRegionChange?: (region: { startSec: number; endSec: number } | null) => void;

  /** Query selection state from the parent (null clears the query region). */
  queryRegion?: { startSec: number; endSec: number } | null;

  /** Candidate match regions (auto + manual). */
  candidates?: RefinementCandidate[];
  activeCandidateId?: string | null;
  /** Drives candidate styling + score labeling (similarity vs confidence). */
  candidateCurveKind?: "similarity" | "confidence";

  /** "Add missing match" mode: drag-to-create adds a manual (accepted) candidate. */
  addMissingMode?: boolean;
  onSelectCandidateId?: (candidateId: string | null) => void;
  onManualCandidateCreate?: (candidate: { id: string; startSec: number; endSec: number }) => void;
  onManualCandidateUpdate?: (candidate: { id: string; startSec: number; endSec: number }) => void;

  /** Optional: map waveform clicks to an external seek handler. */
  onWaveformClick?: (timeSec: number) => void;
  onConfigClick?: () => void;
  onDebugClick?: () => void;
};

/**
 * Simple WaveSurfer.js (v7) player with:
 * - local file loading
 * - zoom (minPxPerSec)
 * - horizontal scroll + autoscroll
 * - timeline plugin
 */
export const WaveSurferPlayer = forwardRef<WaveSurferPlayerHandle, WaveSurferPlayerProps>(function WaveSurferPlayer(
  {
    height = 128,
    onAudioDecoded,
    onViewportChange,
    onPlaybackTime,
    onPlayingChange,
    onRegionChange,
    queryRegion,
    candidates,
    activeCandidateId,
    candidateCurveKind,
    addMissingMode,
    onSelectCandidateId,
    onManualCandidateCreate,
    onManualCandidateUpdate,
    fileInputRef,
    cursorTimeSec,
    onCursorTimeChange,
    viewport,
    seekToTimeSec,
    onWaveformClick,
    onConfigClick,
    onDebugClick,
  }: WaveSurferPlayerProps,
  ref
) {
  const wsRef = useRef<WaveSurfer | null>(null);
  const zoomRef = useRef(0);
  const isPlayingRef = useRef(false);
  const segmentPlaybackRef = useRef<{ startSec: number; endSec: number; loop: boolean } | null>(null);
  const lastPlaybackEmitRef = useRef<{ atMs: number; timeSec: number }>({ atMs: 0, timeSec: -Infinity });
  const onAudioDecodedRef = useRef<WaveSurferPlayerProps["onAudioDecoded"]>(onAudioDecoded);
  const onViewportChangeRef = useRef<WaveSurferPlayerProps["onViewportChange"]>(onViewportChange);
  const onPlaybackTimeRef = useRef<WaveSurferPlayerProps["onPlaybackTime"]>(onPlaybackTime);
  const onPlayingChangeRef = useRef<WaveSurferPlayerProps["onPlayingChange"]>(onPlayingChange);
  const onRegionChangeRef = useRef<WaveSurferPlayerProps["onRegionChange"]>(onRegionChange);
  const seekToTimeSecRef = useRef<WaveSurferPlayerProps["seekToTimeSec"]>(seekToTimeSec);
  const onWaveformClickRef = useRef<WaveSurferPlayerProps["onWaveformClick"]>(onWaveformClick);
  const onSelectCandidateIdRef = useRef<WaveSurferPlayerProps["onSelectCandidateId"]>(onSelectCandidateId);
  const onManualCandidateCreateRef = useRef<WaveSurferPlayerProps["onManualCandidateCreate"]>(onManualCandidateCreate);
  const onManualCandidateUpdateRef = useRef<WaveSurferPlayerProps["onManualCandidateUpdate"]>(onManualCandidateUpdate);
  const addMissingModeRef = useRef<boolean>(!!addMissingMode);
  const candidatesRef = useRef<RefinementCandidate[]>(candidates ?? []);
  const activeCandidateIdRef = useRef<string | null>(activeCandidateId ?? null);
  const regionsPluginRef = useRef<RegionsPluginLike | null>(null);
  const disableDragSelectionRef = useRef<(() => void) | null>(null);
  const queryRegionRef = useRef<RegionLike | null>(null);
  const programmaticCreatesRef = useRef<Set<string>>(new Set());
  const programmaticUpdatesRef = useRef<Set<string>>(new Set());



  useEffect(() => {
    onAudioDecodedRef.current = onAudioDecoded;
    onViewportChangeRef.current = onViewportChange;
    onPlaybackTimeRef.current = onPlaybackTime;
    onPlayingChangeRef.current = onPlayingChange;
    onRegionChangeRef.current = onRegionChange;
    onWaveformClickRef.current = onWaveformClick;
    onSelectCandidateIdRef.current = onSelectCandidateId;
    onManualCandidateCreateRef.current = onManualCandidateCreate;
    onManualCandidateUpdateRef.current = onManualCandidateUpdate;
    addMissingModeRef.current = !!addMissingMode;
    candidatesRef.current = candidates ?? [];
    activeCandidateIdRef.current = activeCandidateId ?? null;
  }, [
    onAudioDecoded,
    onViewportChange,
    onPlaybackTime,
    onPlayingChange,
    onRegionChange,
    onWaveformClick,
    onSelectCandidateId,
    onManualCandidateCreate,
    onManualCandidateUpdate,
    addMissingMode,
    candidates,
    activeCandidateId,
    cursorTimeSec,
  ]);

  // Global hotkey: Shift+Space to play from cursor (hover position)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === "Space" && e.shiftKey) {
        e.preventDefault();

        // Reset any segment constraints
        segmentPlaybackRef.current = null;

        const ws = wsRef.current;
        if (!ws) return;

        // Play from hover cursor if available, otherwise just play from current pos
        // (ignoring any active region loops).
        if (cursorTimeSec != null && Number.isFinite(cursorTimeSec)) {
          ws.setTime(cursorTimeSec);
        }
        void ws.play();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [cursorTimeSec]);

  useEffect(() => {
    // Treat seeks as a one-shot "command" from the parent.
    // IMPORTANT: do *not* update this ref from the callback-ref effect above,
    // otherwise frequent parent re-renders would re-arm the same seek endlessly.
    seekToTimeSecRef.current = seekToTimeSec;
  }, [seekToTimeSec]);

  const objectUrlRef = useRef<string | null>(null);
  const fallbackFileInputRef = useRef<HTMLInputElement | null>(null);
  const pickerRef = fileInputRef ?? fallbackFileInputRef;

  const [containerEl, setContainerEl] = useState<HTMLDivElement | null>(null);
  const [timelineEl, setTimelineEl] = useState<HTMLDivElement | null>(null);

  const [isReady, setIsReady] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [zoom, setZoom] = useState(0);

  // Region selection debug readout (for trust + tuning).
  const [activeRegion, setActiveRegion] = useState<{
    startSec: number;
    endSec: number;
    durationSec: number;
    startSample: number;
    durationSamples: number;
  } | null>(null);

  function cleanupObjectUrl() {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
  }

  async function onPickFile(file: File) {
    const ws = wsRef.current;
    if (!ws) return;

    // New audio invalidates all regions (query + candidates); clear proactively so UI never shows stale marks.
    regionsPluginRef.current?.clearRegions();
    queryRegionRef.current = null;
    programmaticCreatesRef.current.clear();
    programmaticUpdatesRef.current.clear();
    segmentPlaybackRef.current = null;
    isPlayingRef.current = false;
    setActiveRegion(null);
    onRegionChangeRef.current?.(null);
    onSelectCandidateIdRef.current?.(null);

    cleanupObjectUrl();
    const url = URL.createObjectURL(file);
    objectUrlRef.current = url;

    setIsReady(false);
    setIsPlaying(false);
    setZoom(0);

    await ws.load(url);
  }

  useImperativeHandle(
    ref,
    () => ({
      playPause: () => {
        // User intent: "normal" play/pause should not be constrained to a previously reviewed segment.
        segmentPlaybackRef.current = null;
        void wsRef.current?.playPause();
      },
      pause: () => {
        segmentPlaybackRef.current = null;
        wsRef.current?.pause();
      },
      stop: () => {
        segmentPlaybackRef.current = null;
        const ws = wsRef.current;
        if (!ws) return;
        ws.pause();
        ws.seekTo(0);
      },
      playSegment: ({ startSec, endSec, loop }) => {
        const ws = wsRef.current;
        if (!ws) return;

        const dur = ws.getDuration() || 0;
        const startRaw = Math.min(startSec, endSec);
        const endRaw = Math.max(startSec, endSec);
        const start = Math.max(0, Math.min(dur || Infinity, startRaw));
        const end = Math.max(start, Math.min(dur || Infinity, endRaw));

        // Keep non-zero so one-shot playback is audible on very small selections.
        const safeEnd = end > start ? end : Math.min(dur || Infinity, start + 0.01);

        segmentPlaybackRef.current = { startSec: start, endSec: safeEnd, loop: !!loop };

        // Prefer WaveSurfer's own segment playback (start,end) so we don't fight internal timing/stopAtPosition.
        void ws.play(start, safeEnd);

        // Center view to the segment start for quick A/B comparisons.
        const scrollContainer = (ws.getRenderer() as unknown as { scrollContainer?: HTMLElement })?.scrollContainer;
        const minPxPerSec = zoomRef.current;
        if (scrollContainer && minPxPerSec > 0) {
          const targetPx = start * minPxPerSec;
          const left = Math.max(0, targetPx - scrollContainer.clientWidth / 2);
          const maxLeft = Math.max(0, scrollContainer.scrollWidth - scrollContainer.clientWidth);
          scrollContainer.scrollLeft = Math.min(maxLeft, left);
        }
      },
      isPlaying: () => isPlayingRef.current,
      loadAudio: (file: File) => onPickFile(file),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  useEffect(() => {
    if (!containerEl || !timelineEl) return;

    // Region selection plugin (kept as an explicit ref so we don't rely on
    // WaveSurfer's internal plugin registry types).
    const regions = Regions.create();

    // Create WS instance (once refs exist).
    const ws = WaveSurfer.create({
      container: containerEl,
      height,
      waveColor: "#62626b",
      progressColor: "#787666",
      cursorColor: "#d40f37",
      barWidth: 0,
      barGap: 0,
      barRadius: 0,
      cursorWidth: 2,
      normalize: true,
      autoScroll: false,
      autoCenter: false,
      // Important: allow region drag selection; plain click still seeks by default.
      dragToSeek: false,
      interact: true,
      minPxPerSec: 0,
      plugins: [
        Timeline.create({
          container: timelineEl,
        }),
        regions,
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

      const startTimeRaw = minPxPerSec > 0 ? (scrollContainer?.scrollLeft ?? 0) / minPxPerSec : 0;
      const startTime = Math.max(0, startTimeRaw);
      const endTimeRaw = minPxPerSec > 0 ? startTime + containerWidthPx / minPxPerSec : duration;
      const endTime = Math.max(startTime, Math.min(duration, endTimeRaw));

      onViewportChangeRef.current?.({
        startTime,
        endTime,
        containerWidthPx,
        totalWidthPx: scrollContainer?.scrollWidth ?? 0,
        minPxPerSec,
      });
    };
    const onPlay = () => {
      isPlayingRef.current = true;
      setIsPlaying(true);
    };
    const onPause = () => {
      isPlayingRef.current = false;
      setIsPlaying(false);
    };
    const onFinish = () => {
      const seg = segmentPlaybackRef.current;
      if (!seg) return;

      if (seg.loop) {
        // Looping segments are a core part of rapid triage; restart immediately.
        void ws.play(seg.startSec, seg.endSec);
        return;
      }

      // One-shot segment playback is done; return to normal (unconstrained) playback.
      segmentPlaybackRef.current = null;
    };
    const onInteraction = () => {
      // WaveSurfer emits this on click/drag; map to time via API to avoid DOM overlays blocking region selection.
      const t = ws.getCurrentTime();
      if (Number.isFinite(t)) onWaveformClickRef.current?.(t);
    };

    const onScroll = (startTime: number, endTime: number, leftPx: number, rightPx: number) => {
      // The WaveSurfer v7 'scroll' event gives us the current visible time range
      // and pixel bounds within the scroll container.
      // This is the source-of-truth for all time-aligned visualisations.
      //
      // Note: WaveSurfer's internal scroll width is based on scrollContainer, not wrapper.
      const scrollContainer = (ws.getRenderer() as unknown as { scrollContainer?: HTMLElement })?.scrollContainer;

      const duration = ws.getDuration() || 0;
      const clampedStart = Math.max(0, startTime);
      const clampedEnd = Math.max(clampedStart, Math.min(duration, endTime));

      onViewportChangeRef.current?.({
        startTime: clampedStart,
        endTime: clampedEnd,
        containerWidthPx: Math.max(0, rightPx - leftPx),
        totalWidthPx: scrollContainer?.scrollWidth ?? 0,
        minPxPerSec: zoomRef.current,
      });
    };

    const regionsPlugin = regions as unknown as RegionsPluginLike;
    regionsPluginRef.current = regionsPlugin;

    // Important: enable drag-selection immediately once the Regions plugin exists.
    // We still reconfigure it when `addMissingMode` changes, but without this initial
    // enable the first render would never allow selection (the toggle effect only
    // runs when the mode changes).
    disableDragSelectionRef.current?.();
    disableDragSelectionRef.current = regionsPlugin.enableDragSelection(
      addMissingModeRef.current
        ? {
          // Manual add mode: green-ish so new regions read as "accepted".
          color: "rgba(34, 197, 94, 0.22)",
          drag: true,
          resize: true,
        }
        : {
          // Normal mode: query selection (single region).
          id: QUERY_REGION_ID,
          color: "rgba(212, 175, 55, 0.18)", // translucent gold
          drag: true,
          resize: true,
        },
      2
    );

    const updateQueryRegion = (startSec: number, endSec: number) => {
      const decoded = ws.getDecodedData();
      const sr = decoded?.sampleRate ?? 0;
      const start = Math.max(0, Math.min(startSec, endSec));
      const end = Math.max(start, Math.max(startSec, endSec));
      const durationSec = end - start;

      const startSample = sr > 0 ? Math.floor(start * sr) : 0;
      const durationSamples = sr > 0 ? Math.floor(durationSec * sr) : 0;

      const regionInfo = { startSec: start, endSec: end, durationSec, startSample, durationSamples };
      setActiveRegion(regionInfo);
      onRegionChangeRef.current?.({ startSec: start, endSec: end });
    };

    const onRegionCreated = (r: RegionLike) => {
      // Ignore regions created by our own reconciliation pass (auto candidates).
      if (programmaticCreatesRef.current.has(r.id)) {
        programmaticCreatesRef.current.delete(r.id);
        return;
      }

      // "Add missing match" mode: drag selection creates a new manual candidate region.
      if (addMissingModeRef.current) {
        // Keep manual regions editable so users can fine-tune boundaries immediately.
        r.setOptions({ drag: true, resize: true });
        onManualCandidateCreateRef.current?.({ id: r.id, startSec: r.start, endSec: r.end });
        onSelectCandidateIdRef.current?.(r.id);
        return;
      }

      // Otherwise: treat drag selection as the query region (single region with fixed ID).
      if (r.id === QUERY_REGION_ID) {
        for (const other of regionsPlugin.getRegions()) {
          if (other.id === QUERY_REGION_ID && other !== r) other.remove();
        }
        queryRegionRef.current = r;
        r.setOptions({ color: "rgba(212, 175, 55, 0.18)", drag: true, resize: true });
        if (r.element) r.element.style.border = "2px solid rgba(212, 175, 55, 0.55)";
        updateQueryRegion(r.start, r.end);
      }
    };

    const onRegionUpdated = (r: RegionLike) => {
      if (programmaticUpdatesRef.current.has(r.id)) {
        programmaticUpdatesRef.current.delete(r.id);
        return;
      }

      if (r.id === QUERY_REGION_ID) {
        queryRegionRef.current = r;
        // Redundant setOptions called during drag causes glitches/shrinking.
        // The region is already configured correctly on creation/selection.
        updateQueryRegion(r.start, r.end);
        return;
      }

      const candidate = candidatesRef.current.find((c) => c.id === r.id);
      if (candidate?.source === "manual") {
        onManualCandidateUpdateRef.current?.({ id: r.id, startSec: r.start, endSec: r.end });
      }
    };

    const onRegionRemoved = (r: RegionLike) => {
      if (r.id !== QUERY_REGION_ID) return;

      // Query replacements can briefly create/remove regions during drag selection.
      // Only clear if *no* query region remains.
      const stillHasQuery = regionsPlugin.getRegions().some((rr) => rr.id === QUERY_REGION_ID);
      if (!stillHasQuery) {
        queryRegionRef.current = null;
        setActiveRegion(null);
        onRegionChangeRef.current?.(null);
      }
    };

    const onRegionClicked = (r: RegionLike, evt?: unknown) => {
      const e = evt as MouseEvent | undefined;
      e?.preventDefault?.();
      e?.stopPropagation?.();

      if (r.id === QUERY_REGION_ID) return;
      const candidate = candidatesRef.current.find((c) => c.id === r.id);
      if (!candidate) return;
      onSelectCandidateIdRef.current?.(candidate.id);
    };

    regionsPlugin.on("region-created", onRegionCreated);
    regionsPlugin.on("region-updated", onRegionUpdated);
    regionsPlugin.on("region-removed", onRegionRemoved);
    regionsPlugin.on("region-clicked", onRegionClicked);

    ws.on("ready", onReady);
    ws.on("play", onPlay);
    ws.on("pause", onPause);
    ws.on("finish", onFinish);
    ws.on("scroll", onScroll);
    ws.on("interaction", onInteraction);

    let raf = 0;
    const tick = () => {
      // Best-effort: WaveSurfer v7 provides getCurrentTime().
      // We drive this from an rAF loop while mounted.
      const nowMs = performance.now();
      const t = ws.getCurrentTime() || 0;
      const last = lastPlaybackEmitRef.current;
      if (Math.abs(t - last.timeSec) >= 0.1 || nowMs - last.atMs >= 33) {
        lastPlaybackEmitRef.current = { atMs: nowMs, timeSec: t };
        onPlaybackTimeRef.current?.(t);
      }

      // Optional external seek.
      const seek = seekToTimeSecRef.current;
      if (seek != null && Number.isFinite(seek)) {
        // An explicit seek cancels any previously armed segment loop / stop position.
        segmentPlaybackRef.current = null;

        const dur = ws.getDuration() || 0;
        const clamped = Math.max(0, Math.min(dur, seek));
        ws.setTime(clamped);

        // Also pan so the seek target is visible even when not playing.
        const scrollContainer = (ws.getRenderer() as unknown as { scrollContainer?: HTMLElement })?.scrollContainer;
        const minPxPerSec = zoomRef.current;
        if (scrollContainer && minPxPerSec > 0) {
          const targetPx = clamped * minPxPerSec;
          const left = Math.max(0, targetPx - scrollContainer.clientWidth / 2);
          const maxLeft = Math.max(0, scrollContainer.scrollWidth - scrollContainer.clientWidth);
          scrollContainer.scrollLeft = Math.min(maxLeft, left);
        }
        seekToTimeSecRef.current = null;
      }

      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      cleanupObjectUrl();

      disableDragSelectionRef.current?.();
      disableDragSelectionRef.current = null;
      regionsPlugin.un("region-created", onRegionCreated);
      regionsPlugin.un("region-updated", onRegionUpdated);
      regionsPlugin.un("region-removed", onRegionRemoved);
      regionsPlugin.un("region-clicked", onRegionClicked);

      ws.un("scroll", onScroll);
      ws.un("interaction", onInteraction);
      ws.un("finish", onFinish);
      try {
        ws.destroy();
      } catch (e) {
        // Ignore "signal is aborted" errors during destroy
        console.warn("[WaveSurfer] destroy error suppressed", e);
      }
      wsRef.current = null;
      regionsPluginRef.current = null;
      queryRegionRef.current = null;
      setIsReady(false);
      setIsPlaying(false);
      setActiveRegion(null);
    };
  }, [containerEl, timelineEl, height]);

  useEffect(() => {
    const regionsPlugin = regionsPluginRef.current;
    if (!regionsPlugin) return;

    disableDragSelectionRef.current?.();

    disableDragSelectionRef.current = regionsPlugin.enableDragSelection(
      addMissingMode
        ? {
          // Manual add mode: green-ish so new regions read as "accepted".
          color: "rgba(34, 197, 94, 0.22)",
          drag: true,
          resize: true,
        }
        : {
          // Normal mode: query selection (single region).
          id: QUERY_REGION_ID,
          color: "rgba(212, 175, 55, 0.18)", // translucent gold
          drag: true,
          resize: true,
        },
      2 // keep threshold tiny so short clicks still seek
    );

    return () => {
      disableDragSelectionRef.current?.();
      disableDragSelectionRef.current = null;
    };
  }, [addMissingMode]);

  useEffect(() => {
    zoomRef.current = zoom;

    const ws = wsRef.current;
    if (!ws) return;

    // Avoid zooming if audio isn't loaded yet to prevent "No audio loaded" runtime error.
    const duration = ws.getDuration();
    if (duration > 0) {
      try {
        ws.zoom(zoom);
      } catch (e) {
        console.warn("[WaveSurfer] zoom error suppressed", e);
      }
    }

    // WaveSurfer only emits 'scroll' on actual scroll/drag.
    // After zoom changes we synthesize a viewport update using the same
    // mapping WaveSurfer uses internally:
    //   scrollWidthPx = durationSec * minPxPerSec
    //   startTimeSec = scrollLeftPx / minPxPerSec
    const scrollContainer = (ws.getRenderer() as unknown as { scrollContainer?: HTMLElement })?.scrollContainer;
    if (!scrollContainer) return;

    // Use the duration we fetched earlier
    // const duration = ws.getDuration() || 0;
    const minPxPerSec = zoom;

    const scrollLeftPx = scrollContainer.scrollLeft || 0;
    const containerWidthPx = scrollContainer.clientWidth || 0;

    const startTimeRaw = minPxPerSec > 0 ? scrollLeftPx / minPxPerSec : 0;
    const startTime = Math.max(0, startTimeRaw);
    const endTimeRaw = startTime + (minPxPerSec > 0 ? containerWidthPx / minPxPerSec : duration);
    const endTime = Math.max(startTime, Math.min(duration, endTimeRaw));

    onViewportChangeRef.current?.({
      startTime,
      endTime,
      containerWidthPx,
      totalWidthPx: scrollContainer.scrollWidth || 0,
      minPxPerSec,
    });
  }, [zoom]);

  useEffect(() => {
    const regionsPlugin = regionsPluginRef.current;
    if (!regionsPlugin) return;

    const list = candidates ?? [];
    const desiredIds = new Set(list.map((c) => c.id));

    const byId = new Map(regionsPlugin.getRegions().map((r) => [r.id, r]));

    const getFill = (c: RefinementCandidate): string => {
      if (c.status === "accepted") return c.source === "manual" ? "rgba(34, 197, 94, 0.28)" : "rgba(34, 197, 94, 0.22)";
      if (c.status === "rejected") return "rgba(239, 68, 68, 0.12)";
      // Unreviewed: neutral for baseline similarity search, blue-tinted for refined confidence.
      return candidateCurveKind === "confidence" && c.source === "auto"
        ? "rgba(59, 130, 246, 0.16)"
        : "rgba(148, 163, 184, 0.16)";
    };

    const applyElementStyle = (region: RegionLike, c: RefinementCandidate, isActive: boolean) => {
      const el = region.element;
      if (!el) return;

      const scoreLabel = candidateCurveKind === "confidence" ? "Confidence" : "Score";

      // UX: auto candidate regions should not block query drag-selection.
      // We still allow manual regions to be edited (drag/resize) and clicked.
      el.style.pointerEvents = c.source === "manual" ? "auto" : "none";
      el.style.boxShadow = isActive
        ? "0 0 0 2px rgba(59, 130, 246, 0.75), 0 0 0 6px rgba(59, 130, 246, 0.18)"
        : "";
      el.style.opacity = c.status === "rejected" ? "0.45" : "1";
      el.style.border = c.source === "manual" ? "2px dashed rgba(34, 197, 94, 0.55)" : "";
      el.title =
        c.score == null
          ? `Manual match\n${c.startSec.toFixed(3)}s → ${c.endSec.toFixed(3)}s`
          : `${scoreLabel}: ${c.score.toFixed(3)}\n${c.startSec.toFixed(3)}s → ${c.endSec.toFixed(3)}s`;
    };

    for (const c of list) {
      const editable = c.source === "manual";
      const fill = getFill(c);

      let region = byId.get(c.id);
      if (!region) {
        programmaticCreatesRef.current.add(c.id);
        region = regionsPlugin.addRegion({
          id: c.id,
          start: c.startSec,
          end: c.endSec,
          color: fill,
          drag: editable,
          resize: editable,
        });
        byId.set(c.id, region);
      } else {
        const startDelta = Math.abs(region.start - c.startSec);
        const endDelta = Math.abs(region.end - c.endSec);
        const needsTimeUpdate = startDelta > 1e-3 || endDelta > 1e-3;

        if (needsTimeUpdate) programmaticUpdatesRef.current.add(c.id);

        region.setOptions({
          ...(needsTimeUpdate ? { start: c.startSec, end: c.endSec } : {}),
          color: fill,
          drag: editable,
          resize: editable,
        });
      }

      applyElementStyle(region, c, c.id === (activeCandidateId ?? null));
    }

    for (const r of regionsPlugin.getRegions()) {
      if (r.id === QUERY_REGION_ID) continue;
      if (desiredIds.has(r.id)) continue;
      r.remove();
    }
  }, [candidates, activeCandidateId, candidateCurveKind]);

  useEffect(() => {
    if (queryRegion !== null) return;
    const regionsPlugin = regionsPluginRef.current;
    if (!regionsPlugin) return;

    for (const r of regionsPlugin.getRegions()) {
      if (r.id === QUERY_REGION_ID) r.remove();
    }
    queryRegionRef.current = null;
  }, [queryRegion]);

  // ... (moved up)

  function togglePlay() {
    // User intent: the player controls are "track playback", not segment playback.
    segmentPlaybackRef.current = null;
    void wsRef.current?.playPause();
  }

  function stop() {
    const ws = wsRef.current;
    if (!ws) return;
    segmentPlaybackRef.current = null;
    ws.pause();
    ws.seekTo(0);
  }

  const handleCursorHover = (evt: MouseEvent<HTMLDivElement>) => {
    if (!onCursorTimeChange || !viewport) return;
    const rect = evt.currentTarget.getBoundingClientRect();
    const span = viewport.endTime - viewport.startTime;
    if (span <= 0) return;

    const pxPerSec = rect.width > 0 ? rect.width / span : viewport.minPxPerSec;
    if (!pxPerSec || pxPerSec <= 0) return;

    const x = Math.max(0, Math.min(rect.width, evt.clientX - rect.left));
    const t = viewport.startTime + x / pxPerSec;
    onCursorTimeChange(Math.max(0, t));
  };

  const handleCursorLeave = () => {
    onCursorTimeChange?.(null);
  };

  return (
    <div className="w-full">
      <div className="flex flex-wrap items-center gap-3">
        <label className="inline-flex items-center gap-2">
          <span className="text-sm text-zinc-600 dark:text-zinc-300">Audio file</span>
          <input
            type="file"
            accept="audio/*"
            className="block text-sm"
            ref={pickerRef}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onPickFile(f);
            }}
          />
          <Button
            variant="outline"
            size="sm"
            className="h-9 px-2 text-xs"
            onClick={onConfigClick}
            title="Analysis Configuration"
          >
            Config
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-9 px-2 text-xs"
            onClick={onDebugClick}
            title="Debug Info"
          >
            Debug
          </Button>
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
            max={1000}
            step={10}
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
            disabled={!isReady}
          />
          <span className="w-12 text-right text-sm tabular-nums text-zinc-600 dark:text-zinc-300">
            {zoom}
          </span>
        </div>
        {/* Compact Region Debug Readout */}
        {activeRegion && (
          <div className="flex items-center gap-3 text-[10px] text-zinc-500 font-mono ml-auto lg:ml-0 lg:order-last">
            <span>
              <span className="text-zinc-400">Range:</span> {activeRegion.startSec.toFixed(3)}s - {activeRegion.endSec.toFixed(3)}s
            </span>
            <span className="hidden sm:inline">
              <span className="text-zinc-400">Dur:</span> {activeRegion.durationSec.toFixed(3)}s
            </span>
            <span className="hidden md:inline">
              <span className="text-zinc-400">Samples:</span> {activeRegion.startSample} - {activeRegion.startSample + activeRegion.durationSamples}
            </span>
          </div>
        )}
      </div>

      <div
        className={`mt-4 rounded-xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-950 ${addMissingMode ? "ring-2 ring-emerald-500 ring-offset-2 ring-offset-white dark:ring-offset-zinc-950" : ""
          }`}
      >
        <div ref={setTimelineEl} className="w-full" />
        <div className="relative">
          {addMissingMode ? (
            <div className="pointer-events-none absolute right-2 top-2 rounded bg-emerald-500/15 px-2 py-1 text-[11px] font-medium text-emerald-700 dark:text-emerald-300">
              Add missing match mode
            </div>
          ) : null}
          <div
            ref={setContainerEl}
            className="w-full overflow-x-auto"
            onMouseMove={handleCursorHover}
            onMouseLeave={handleCursorLeave}
          />
        </div>
      </div>

      {!isReady && <p className="mt-3 text-sm text-zinc-500">Choose an audio file to load it.</p>}

      {/* Intentionally no footer text here; MIR visualisation sits directly under waveform. */}
    </div>
  );
});
