"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState, type MouseEvent, type RefObject } from "react";
import { useHotkeys } from "react-hotkeys-hook";
import { HOTKEY_SCOPE_APP } from "@/lib/hotkeys";

import WaveSurfer from "wavesurfer.js";
import Timeline from "wavesurfer.js/dist/plugins/timeline.esm.js";
import Regions from "wavesurfer.js/dist/plugins/regions.esm.js";
import { GripHorizontal, Play, Pause, X, Loader2, AlertCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useAudioInputStore } from "@/lib/stores/audioInputStore";
import { useBeatGridStore, SUB_BEAT_DIVISIONS } from "@/lib/stores/beatGridStore";
import { useConfigStore } from "@/lib/stores/configStore";
import { useMusicalTimeStore } from "@/lib/stores/musicalTimeStore";

const MIN_HEIGHT = 80;
const MAX_HEIGHT = 1200;
const DEFAULT_HEIGHT = 150;

const getScrollContainer = (ws: WaveSurfer | null) => {
  const wrapper = ws?.getWrapper?.();
  return wrapper?.parentElement ?? null;
};

import type { AudioBufferLike } from "@octoseq/mir";

import type { RefinementCandidate } from "@/lib/searchRefinement";
import type { WaveSurferViewport } from "./types";
import { AnalysisOverlay } from "./AnalysisOverlay";

// Minimal typing to avoid depending on WaveSurfer's internal plugin registry.
type RegionLike = {
  id: string;
  start: number;
  end: number;
  element?: HTMLElement | null;
  remove: () => void;
  update: (opts: {
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
  getRegions: () => RegionLike[];
  addRegion: (options: { id?: string; start: number; end: number; color?: string; drag?: boolean; resize?: boolean }) => RegionLike;
  clearRegions: () => void;
  getRegion: (id: string) => RegionLike | undefined;
};

const QUERY_REGION_ID = "query";
const ZOOM_PREVIEW_REGION_ID = "zoom-preview";

export type WaveSurferPlayerHandle = {
  playPause: () => void;
  pause: () => void;
  stop: () => void;
  playSegment: (opts: { startSec: number; endSec: number; loop?: boolean }) => void;
  isPlaying: () => boolean;
  /** Load audio from a URL (e.g., for demo files). Sets pendingFileName in store before loading. */
  loadUrl: (url: string, fileName: string) => Promise<void>;
};

type WaveSurferPlayerProps = {
  /** Initial height (defaults to DEFAULT_HEIGHT). Component manages its own height state for resizing. */
  initialHeight?: number;
  fileInputRef?: RefObject<HTMLInputElement | null>;
  cursorTimeSec?: number | null;
  onCursorTimeChange?: (timeSec: number | null) => void;
  /** Current viewport (for mapping mirrored cursor overlay). */
  viewport?: WaveSurferViewport | null;
  /** Additional content to render on the left side of the toolbar. */
  toolbarLeft?: React.ReactNode;
  /** Additional content to render on the right side of the toolbar. */
  toolbarRight?: React.ReactNode;

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

  /**
   * Region selection (single active region).
   * Called whenever the user creates/updates a region.
   */
  onRegionChange?: (region: { startSec: number; endSec: number } | null) => void;

  /** Called when user clears the region selection. */
  onClearRegion?: () => void;

  /** Query selection state from the parent (null clears the query region). */
  queryRegion?: { startSec: number; endSec: number } | null;

  /** Candidate match regions (auto + manual). */
  candidates?: RefinementCandidate[];
  activeCandidateId?: string | null;
  /** Drives candidate styling + score labeling (similarity vs confidence). */
  candidateCurveKind?: "similarity" | "confidence";

  /** "Add missing match" mode: drag-to-create adds a manual (accepted) candidate. */
  addMissingMode?: boolean;
  /** When true, region selection creates a query for similarity search. When false, region selection zooms to the area. */
  searchModeActive?: boolean;
  onSelectCandidateId?: (candidateId: string | null) => void;
  onManualCandidateCreate?: (candidate: { id: string; startSec: number; endSec: number }) => void;
  onManualCandidateUpdate?: (candidate: { id: string; startSec: number; endSec: number }) => void;

  /** Optional: map waveform clicks to an external seek handler. */
  onWaveformClick?: (timeSec: number) => void;

  /** Notifies parent when playback state changes (play/pause). */
  onIsPlayingChange?: (isPlaying: boolean) => void;

  /** Whether MIR analysis is currently running (shows overlay). */
  isAnalysing?: boolean;
  /** Human-readable name of the current analysis for the overlay. */
  analysisName?: string;
  /** Duration of the last completed analysis in milliseconds. */
  lastAnalysisMs?: number;
  /** Backend used for last analysis (e.g., "cpu" or "gpu"). */
  analysisBackend?: string;
  /** Additional overlay content to render over the waveform. */
  overlayContent?: React.ReactNode;

  /** Mute the main audio output (for band auditioning). */
  muted?: boolean;

  /** Called when user clicks on the BPM display (to navigate to tempo view). */
  onBpmClick?: () => void;

  /**
   * External audio source URL. When provided and changes, the waveform will load this URL.
   * Used for switching between mixdown and stem audio display.
   */
  displayAudioUrl?: string | null;

  /**
   * Called when a file is picked from the file input, before WaveSurfer decodes it.
   * Use this to trigger cloud upload with the original file bytes.
   */
  onFilePicked?: (file: File) => void;
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
    initialHeight = DEFAULT_HEIGHT,
    onAudioDecoded,
    onViewportChange,
    onPlaybackTime,
    onRegionChange,
    onClearRegion,
    queryRegion,
    candidates,
    activeCandidateId,
    candidateCurveKind,
    addMissingMode,
    searchModeActive,
    onSelectCandidateId,
    onManualCandidateCreate,
    onManualCandidateUpdate,
    fileInputRef,
    cursorTimeSec,
    onCursorTimeChange,
    viewport,
    seekToTimeSec,
    onWaveformClick,
    onIsPlayingChange,
    toolbarLeft,
    toolbarRight,
    isAnalysing,
    analysisName,
    lastAnalysisMs,
    analysisBackend,
    overlayContent,
    muted,
    onBpmClick,
    displayAudioUrl,
    onFilePicked,
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
  const onRegionChangeRef = useRef<WaveSurferPlayerProps["onRegionChange"]>(onRegionChange);
  const seekToTimeSecRef = useRef<WaveSurferPlayerProps["seekToTimeSec"]>(seekToTimeSec);
  const onWaveformClickRef = useRef<WaveSurferPlayerProps["onWaveformClick"]>(onWaveformClick);
  const onSelectCandidateIdRef = useRef<WaveSurferPlayerProps["onSelectCandidateId"]>(onSelectCandidateId);
  const onManualCandidateCreateRef = useRef<WaveSurferPlayerProps["onManualCandidateCreate"]>(onManualCandidateCreate);
  const onManualCandidateUpdateRef = useRef<WaveSurferPlayerProps["onManualCandidateUpdate"]>(onManualCandidateUpdate);
  const addMissingModeRef = useRef<boolean>(!!addMissingMode);
  const searchModeActiveRef = useRef<boolean>(!!searchModeActive);
  const candidatesRef = useRef<RefinementCandidate[]>(candidates ?? []);
  const activeCandidateIdRef = useRef<string | null>(activeCandidateId ?? null);
  const regionsPluginRef = useRef<RegionsPluginLike | null>(null);
  const queryRegionRef = useRef<RegionLike | null>(null);
  const onIsPlayingChangeRef = useRef<WaveSurferPlayerProps["onIsPlayingChange"]>(onIsPlayingChange);
  const setPlayheadTimeRef = useRef<(t: number) => void>(() => { });
  const setZoomRef = useRef<(z: number) => void>(() => { });

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
        const scrollContainer = getScrollContainer(ws);
        const minPxPerSec = zoomRef.current;
        if (scrollContainer && minPxPerSec > 0) {
          const targetPx = start * minPxPerSec;
          const left = Math.max(0, targetPx - scrollContainer.clientWidth / 2);
          const maxLeft = Math.max(0, scrollContainer.scrollWidth - scrollContainer.clientWidth);
          scrollContainer.scrollLeft = Math.min(maxLeft, left);
        }
      },
      isPlaying: () => isPlayingRef.current,
      loadUrl: async (url: string, fileName: string) => {
        void fileName; // Unused - kept for API compatibility
        const ws = wsRef.current;
        if (!ws) return;

        // Note: This method is deprecated. Use setCurrentAudioSource instead.
        // For URL loading, create a RemoteAudioSource or fetch the file first.

        // Clear existing refs (similar to onPickFile)
        regionsPluginRef.current?.clearRegions();
        queryRegionRef.current = null;
        segmentPlaybackRef.current = null;
        isPlayingRef.current = false;
        onRegionChangeRef.current?.(null);
        onSelectCandidateIdRef.current?.(null);
        onIsPlayingChangeRef.current?.(false);

        // Load from URL - state updates (isReady, isPlaying, zoom) happen via event handlers
        // For blob URLs, fetch and use loadBlob() to avoid range request issues
        if (url.startsWith("blob:")) {
          const response = await fetch(url);
          const blob = await response.blob();
          ws.loadBlob(blob);
        } else {
          await ws.load(url);
        }
      },
    }),
    []
  );

  useEffect(() => {
    onAudioDecodedRef.current = onAudioDecoded;
    onViewportChangeRef.current = onViewportChange;
    onPlaybackTimeRef.current = onPlaybackTime;
    onRegionChangeRef.current = onRegionChange;
    onIsPlayingChangeRef.current = onIsPlayingChange;
    onWaveformClickRef.current = onWaveformClick;
    onSelectCandidateIdRef.current = onSelectCandidateId;
    onManualCandidateCreateRef.current = onManualCandidateCreate;
    onManualCandidateUpdateRef.current = onManualCandidateUpdate;
    addMissingModeRef.current = !!addMissingMode;
    searchModeActiveRef.current = !!searchModeActive;
    candidatesRef.current = candidates ?? [];
    activeCandidateIdRef.current = activeCandidateId ?? null;
  }, [
    onManualCandidateCreate,
    onManualCandidateUpdate,
    addMissingMode,
    searchModeActive,
    candidates,
    activeCandidateId,
    cursorTimeSec,
    onIsPlayingChange,
    onAudioDecoded,
    onViewportChange,
    onPlaybackTime,
    onRegionChange,
    onWaveformClick,
    onSelectCandidateId,
  ]);

  // Global hotkey: Shift+Space to play from cursor (hover position).
  // Scoped so it can be disabled while the script editor is focused.
  useHotkeys(
    "shift+space",
    () => {
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
    },
    { preventDefault: true, scopes: [HOTKEY_SCOPE_APP] },
    [cursorTimeSec]
  );

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

  const [isReady, setIsReady] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [zoom, setZoom] = useState(0);
  const [regionsReady, setRegionsReady] = useState(false);
  const [playheadTime, setPlayheadTime] = useState(0);

  // Get beat grid, config, and sample rate for playhead display
  const activeBeatGrid = useBeatGridStore((s) => s.activeBeatGrid);
  const selectedHypothesis = useBeatGridStore((s) => s.selectedHypothesis);
  const subBeatDivision = useBeatGridStore((s) => s.subBeatDivision);
  const setSubBeatDivision = useBeatGridStore((s) => s.setSubBeatDivision);
  const hopSize = useConfigStore((s) => s.hopSize);
  const sampleRate = useAudioInputStore((s) => s.getAudioSampleRate());
  const getBeatPositionAt = useMusicalTimeStore((s) => s.getBeatPositionAt);
  const musicalTimeStructure = useMusicalTimeStore((s) => s.structure);

  // ==========================================================================
  // AudioSource: Single Source of Truth for Playback
  // ==========================================================================
  // WaveSurfer loads audio by URL only. currentAudioSource is the single
  // authority on what audio is playing.
  // ==========================================================================
  const currentAudioSource = useAudioInputStore((s) => s.currentAudioSource);
  const currentAudioSourceRef = useRef(currentAudioSource);
  const lastLoadedSourceIdRef = useRef<string | null>(null);

  // Keep the refs updated for callback functions
  useEffect(() => {
    setPlayheadTimeRef.current = setPlayheadTime;
    setZoomRef.current = setZoom;
  }, []);

  // Keep currentAudioSource ref updated
  useEffect(() => {
    currentAudioSourceRef.current = currentAudioSource;
  }, [currentAudioSource]);

  // ==========================================================================
  // AudioSource Loading Effect
  // ==========================================================================
  // Load audio from currentAudioSource when it becomes ready.
  // This is the single entry point for WaveSurfer audio loading.
  useEffect(() => {
    const ws = wsRef.current;
    if (!ws) return;

    // No source or not ready - nothing to load
    if (!currentAudioSource || currentAudioSource.status !== "ready" || !currentAudioSource.url) {
      return;
    }

    // Already loaded this source - skip
    if (currentAudioSource.id === lastLoadedSourceIdRef.current) {
      return;
    }

    // New source to load
    const sourceId = currentAudioSource.id;
    const sourceType = currentAudioSource.type;
    const url = currentAudioSource.url;

    console.log(`[WaveSurfer] Loading audio source: ${sourceId} (${sourceType})`);

    // Clear state before loading new audio
    regionsPluginRef.current?.clearRegions();
    queryRegionRef.current = null;
    segmentPlaybackRef.current = null;
    isPlayingRef.current = false;
    onRegionChangeRef.current?.(null);
    onSelectCandidateIdRef.current?.(null);
    onIsPlayingChangeRef.current?.(false);

    // Mark this source as loaded (before async load to prevent double-loading)
    lastLoadedSourceIdRef.current = sourceId;

    // Load the audio - onReady event will update UI state
    // For blob URLs, fetch and use loadBlob() to avoid range request issues
    if (url.startsWith("blob:")) {
      void (async () => {
        try {
          const response = await fetch(url);
          const blob = await response.blob();
          ws.loadBlob(blob);
        } catch (err) {
          console.error("[WaveSurfer] Failed to load blob URL:", err);
        }
      })();
    } else {
      void ws.load(url);
    }
  }, [currentAudioSource]);

  // Track the last loaded display URL to avoid redundant loads
  const lastDisplayAudioUrlRef = useRef<string | null>(null);
  // Flag to distinguish display URL loads from file picker loads
  // Display URL loads should NOT trigger onAudioDecoded (we're just switching display, not loading new audio)
  const isDisplayUrlLoadRef = useRef(false);
  // Track current displayAudioUrl prop so we can check it when WaveSurfer is first created
  const displayAudioUrlRef = useRef<string | null | undefined>(displayAudioUrl);

  // Keep displayAudioUrl ref updated for access in WaveSurfer creation effect
  useEffect(() => {
    displayAudioUrlRef.current = displayAudioUrl;
  }, [displayAudioUrl]);

  // Handle external audio source switching (for stem/mixdown switching)
  useEffect(() => {
    const ws = wsRef.current;
    if (!ws) return;
    if (!displayAudioUrl) return;

    // Avoid reloading the same URL
    if (displayAudioUrl === lastDisplayAudioUrlRef.current) return;

    // Skip if this URL is already being loaded via currentAudioSource
    // This prevents double-loading when cloud assets set both
    const source = currentAudioSourceRef.current;
    if (source?.status === "ready" && source?.url === displayAudioUrl) {
      return;
    }

    lastDisplayAudioUrlRef.current = displayAudioUrl;

    // Mark this as a display URL load - should not trigger onAudioDecoded
    isDisplayUrlLoadRef.current = true;

    // Clear state before loading new audio
    regionsPluginRef.current?.clearRegions();
    queryRegionRef.current = null;
    segmentPlaybackRef.current = null;
    isPlayingRef.current = false;
    onRegionChangeRef.current?.(null);
    onSelectCandidateIdRef.current?.(null);
    onIsPlayingChangeRef.current?.(false);

    // Load the new audio URL
    // For blob URLs, fetch and use loadBlob() to avoid range request issues
    if (displayAudioUrl.startsWith("blob:")) {
      void (async () => {
        try {
          const response = await fetch(displayAudioUrl);
          const blob = await response.blob();
          ws.loadBlob(blob);
        } catch (err) {
          console.error("[WaveSurfer] Failed to load blob URL from displayAudioUrl:", err);
        }
      })();
    } else {
      void ws.load(displayAudioUrl);
    }
  }, [displayAudioUrl]);

  // Region selection debug readout (for trust + tuning).
  const [activeRegion, setActiveRegion] = useState<{
    startSec: number;
    endSec: number;
    durationSec: number;
    startSample: number;
    durationSamples: number;
  } | null>(null);

  // Resizable height state
  const [panelHeight, setPanelHeight] = useState(initialHeight);
  const isResizingRef = useRef(false);
  const startYRef = useRef(0);
  const startHeightRef = useRef(0);

  const handleResizeStart = useCallback((e: MouseEvent) => {
    e.preventDefault();
    isResizingRef.current = true;
    startYRef.current = e.clientY;
    startHeightRef.current = panelHeight;
    document.body.style.cursor = 'ns-resize';
    document.body.style.userSelect = 'none';
  }, [panelHeight]);

  useEffect(() => {
    const handleMouseMove = (e: globalThis.MouseEvent) => {
      if (!isResizingRef.current) return;
      const delta = e.clientY - startYRef.current;
      const newHeight = Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, startHeightRef.current + delta));
      setPanelHeight(newHeight);
    };

    const handleMouseUp = () => {
      if (isResizingRef.current) {
        isResizingRef.current = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      }
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  // Apply muted state to WaveSurfer volume
  useEffect(() => {
    const ws = wsRef.current;
    if (!ws) return;
    ws.setVolume(muted ? 0 : 1);
  }, [muted]);

  function cleanupObjectUrl() {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
  }

  useEffect(() => {
    if (!containerEl) return;

    // Create WS instance (once refs exist).
    const ws = WaveSurfer.create({
      container: containerEl,
      height: initialHeight,
      waveColor: "#62626b",
      progressColor: "#787666",
      cursorColor: "#d40f37",
      barWidth: 0,
      barGap: 0,
      barRadius: 0,
      cursorWidth: 2,
      normalize: true,
      autoScroll: true,
      autoCenter: false,
      // Important: allow region drag selection; plain click still seeks by default.
      dragToSeek: false,
      interact: true,
      minPxPerSec: 0,
    });

    wsRef.current = ws;

    let cancelled = false;
    let cleanupRegionInteractions: (() => void) | null = null;

    const getTimeFromClientX = (clientX: number) => {
      const scrollContainer = getScrollContainer(ws);
      if (!scrollContainer) return null;
      const rect = scrollContainer.getBoundingClientRect();
      const duration = ws.getDuration() || 0;
      if (!duration) return null;
      const totalWidth = scrollContainer.scrollWidth || rect.width;
      if (!totalWidth) return null;
      const x = Math.max(0, Math.min(totalWidth, clientX - rect.left + scrollContainer.scrollLeft));
      return (x / totalWidth) * duration;
    };

    const onReady = () => {
      setIsReady(true);

      // =======================================================================
      // DESIGN: onAudioDecoded is for MIR analysis, not playback.
      // - Local sources: Call onAudioDecoded (file picker loads need MIR)
      // - Remote/Generated sources: Don't call (already decoded elsewhere)
      // - Display URL loads: Don't call (just switching display, no new audio)
      // =======================================================================
      const source = currentAudioSourceRef.current;
      const isDisplayUrlLoad = isDisplayUrlLoadRef.current;
      isDisplayUrlLoadRef.current = false; // Reset for next load

      // Call onAudioDecoded only for local file sources (not remote/generated/display-switching)
      const shouldCallOnDecoded = source?.type === "local" && !isDisplayUrlLoad;

      if (shouldCallOnDecoded) {
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
      }

      // WaveSurfer doesn't necessarily emit a 'scroll' event until the user interacts.
      // We synthesise an initial viewport here so downstream visualisations have
      // a non-empty visible time range immediately.
      const scrollContainer = getScrollContainer(ws);
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
      onIsPlayingChangeRef.current?.(true);
    };
    const onPause = () => {
      isPlayingRef.current = false;
      setIsPlaying(false);
      onIsPlayingChangeRef.current?.(false);
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
      // The WaveSurfer 'scroll' event gives us the current visible time range
      // and pixel bounds within the scroll container.
      // This is the source-of-truth for all time-aligned visualisations.
      const scrollContainer = getScrollContainer(ws);
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

    const setupRegionInteractions = (regionsPlugin: RegionsPluginLike) => {
      const scrollContainer = getScrollContainer(ws);
      if (!scrollContainer) return null;

      let dragRegionId: string | null = null;
      let dragMode: "create" | "move" | "resize-start" | "resize-end" | null = null;
      let dragStartTime = 0;
      let dragStartClientX = 0;
      let dragInitialStart = 0;
      let dragInitialEnd = 0;
      let dragPointerOffset = 0;
      let dragMoved = false;
      let suppressClick = false;
      const dragThresholdPx = 2;

      const getRegionById = (id: string | null) => (id ? regionsPlugin.getRegion(id) ?? null : null);

      const applyQueryRegionStyle = (region: RegionLike) => {
        if (!region.element) return;
        region.element.style.border = "2px solid rgba(212, 175, 55, 0.55)";
      };

      const ensureRegionElementMeta = (region: RegionLike) => {
        if (!region.element) return;
        region.element.dataset.regionId = region.id;
      };

      const handlePointerDown = (evt: PointerEvent) => {
        if (evt.button !== 0) return;
        suppressClick = false;
        const target = evt.target as HTMLElement | null;
        const regionEl = target?.closest?.("[data-region-id]") as HTMLElement | null;
        const regionId = regionEl?.dataset?.regionId ?? null;
        const region = getRegionById(regionId);
        const candidate = regionId ? candidatesRef.current.find((c) => c.id === regionId) : null;
        const isManual = candidate?.source === "manual";
        const isQuery = regionId === QUERY_REGION_ID;
        const allowEdit = isManual || (!addMissingModeRef.current && isQuery);

        dragMoved = false;
        dragStartClientX = evt.clientX;

        if (region && regionEl && allowEdit) {
          const t = getTimeFromClientX(evt.clientX);
          if (t == null) return;
          const rect = regionEl.getBoundingClientRect();
          const edgeThreshold = 6;
          const offsetX = evt.clientX - rect.left;
          if (offsetX <= edgeThreshold) {
            dragMode = "resize-start";
          } else if (rect.width - offsetX <= edgeThreshold) {
            dragMode = "resize-end";
          } else {
            dragMode = "move";
          }
          dragRegionId = region.id;
          dragInitialStart = region.start;
          dragInitialEnd = region.end;
          dragPointerOffset = t - region.start;
          return;
        }

        dragMode = "create";
        dragRegionId = null;
        const t = getTimeFromClientX(evt.clientX);
        if (t == null) {
          dragMode = null;
          return;
        }
        dragStartTime = t;
      };

      const handlePointerMove = (evt: PointerEvent) => {
        if (!dragMode) return;
        const t = getTimeFromClientX(evt.clientX);
        if (t == null) return;

        if (dragMode === "create") {
          const distancePx = Math.abs(evt.clientX - dragStartClientX);
          if (!dragMoved && distancePx < dragThresholdPx) return;
          dragMoved = true;

          const start = Math.min(dragStartTime, t);
          const end = Math.max(dragStartTime, t);
          if (!dragRegionId) {
            // Determine which type of region to create based on mode
            const isZoomMode = !addMissingModeRef.current && !searchModeActiveRef.current;

            if (isZoomMode) {
              // Zoom mode: create a temporary preview region
              for (const other of regionsPlugin.getRegions()) {
                if (other.id === ZOOM_PREVIEW_REGION_ID) other.remove();
              }
              dragRegionId = ZOOM_PREVIEW_REGION_ID;
            } else if (!addMissingModeRef.current) {
              // Search mode: create query region
              for (const other of regionsPlugin.getRegions()) {
                if (other.id === QUERY_REGION_ID) other.remove();
              }
              dragRegionId = QUERY_REGION_ID;
            }

            // Determine color based on mode
            let regionColor: string;
            if (addMissingModeRef.current) {
              regionColor = "rgba(34, 197, 94, 0.22)"; // Green for manual candidate
            } else if (isZoomMode) {
              regionColor = "rgba(59, 130, 246, 0.25)"; // Blue for zoom preview
            } else {
              regionColor = "rgba(212, 175, 55, 0.18)"; // Gold for query region
            }

            const region = regionsPlugin.addRegion({
              id: dragRegionId ?? undefined,
              start,
              end,
              color: regionColor,
              drag: !isZoomMode, // Disable drag for zoom preview
              resize: !isZoomMode, // Disable resize for zoom preview
            });
            dragRegionId = region.id;
            ensureRegionElementMeta(region);
            if (region.id === QUERY_REGION_ID) applyQueryRegionStyle(region);
          }

          const region = getRegionById(dragRegionId);
          if (region) {
            region.update({ start, end });
            if (region.id === QUERY_REGION_ID) {
              queryRegionRef.current = region;
              updateQueryRegion(region.start, region.end);
            }
          }
          return;
        }

        const region = getRegionById(dragRegionId);
        if (!region) return;

        const distancePx = Math.abs(evt.clientX - dragStartClientX);
        if (!dragMoved && distancePx < dragThresholdPx) return;
        dragMoved = true;
        if (dragMode === "move") {
          const duration = ws.getDuration() || 0;
          const regionDuration = dragInitialEnd - dragInitialStart;
          const nextStart = Math.max(0, Math.min(duration - regionDuration, t - dragPointerOffset));
          const nextEnd = nextStart + regionDuration;
          region.update({ start: nextStart, end: nextEnd });
          return;
        }

        if (dragMode === "resize-start") {
          const nextStart = Math.min(t, dragInitialEnd);
          region.update({ start: Math.max(0, nextStart) });
          return;
        }

        if (dragMode === "resize-end") {
          const nextEnd = Math.max(t, dragInitialStart);
          region.update({ end: Math.max(0, nextEnd) });
        }
      };

      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const handlePointerUp = (evt: PointerEvent) => {
        if (!dragMode) return;
        const region = getRegionById(dragRegionId);
        const wasCreate = dragMode === "create";
        const wasDrag = dragMoved;

        dragMode = null;
        dragRegionId = null;
        dragMoved = false;

        if (wasDrag) {
          suppressClick = true;
          window.setTimeout(() => {
            suppressClick = false;
          }, 0);
        }

        if (!region) return;

        if (wasCreate && wasDrag) {
          if (addMissingModeRef.current) {
            onManualCandidateCreateRef.current?.({ id: region.id, startSec: region.start, endSec: region.end });
            onSelectCandidateIdRef.current?.(region.id);
          } else if (region.id === ZOOM_PREVIEW_REGION_ID) {
            // Zoom mode: zoom to the selected region and remove the preview
            const regionStart = region.start;
            const regionEnd = region.end;
            const regionDuration = regionEnd - regionStart;

            // Remove the preview region
            region.remove();

            // Calculate and apply zoom
            const scrollContainer = getScrollContainer(ws);
            if (scrollContainer && regionDuration > 0) {
              const containerWidth = scrollContainer.clientWidth || 800;
              // Add some padding (10% on each side)
              const paddedDuration = regionDuration * 1.2;
              const newZoom = Math.min(10000, Math.round(containerWidth / paddedDuration));

              // Update both the ref and React state so the slider reflects the new zoom
              zoomRef.current = newZoom;
              setZoomRef.current(newZoom);

              // Scroll to center the region after zoom is applied
              requestAnimationFrame(() => {
                const scrollContainer = getScrollContainer(ws);
                if (scrollContainer) {
                  const regionCenter = (regionStart + regionEnd) / 2;
                  const targetPx = regionCenter * newZoom;
                  const left = Math.max(0, targetPx - scrollContainer.clientWidth / 2);
                  const maxLeft = Math.max(0, scrollContainer.scrollWidth - scrollContainer.clientWidth);
                  scrollContainer.scrollLeft = Math.min(maxLeft, left);
                }
              });
            }
          } else if (region.id === QUERY_REGION_ID) {
            queryRegionRef.current = region;
            applyQueryRegionStyle(region);
            updateQueryRegion(region.start, region.end);
          }
          return;
        }

        const candidate = candidatesRef.current.find((c) => c.id === region.id);
        if (candidate?.source === "manual") {
          onManualCandidateUpdateRef.current?.({ id: region.id, startSec: region.start, endSec: region.end });
        } else if (region.id === QUERY_REGION_ID && wasDrag) {
          queryRegionRef.current = region;
          updateQueryRegion(region.start, region.end);
        }
      };

      const handleRegionClick = (evt: globalThis.MouseEvent) => {
        if (suppressClick) return;
        const target = evt.target as HTMLElement | null;
        const regionEl = target?.closest?.("[data-region-id]") as HTMLElement | null;
        const regionId = regionEl?.dataset?.regionId ?? null;
        if (!regionId || regionId === QUERY_REGION_ID) return;
        const candidate = candidatesRef.current.find((c) => c.id === regionId);
        if (!candidate) return;
        evt.preventDefault();
        evt.stopPropagation();
        onSelectCandidateIdRef.current?.(candidate.id);
      };

      scrollContainer.addEventListener("pointerdown", handlePointerDown);
      window.addEventListener("pointermove", handlePointerMove);
      window.addEventListener("pointerup", handlePointerUp);
      scrollContainer.addEventListener("click", handleRegionClick);

      return () => {
        scrollContainer.removeEventListener("pointerdown", handlePointerDown);
        window.removeEventListener("pointermove", handlePointerMove);
        window.removeEventListener("pointerup", handlePointerUp);
        scrollContainer.removeEventListener("click", handleRegionClick);
      };
    };

    const initPlugins = async () => {
      try {
        const regionsRegistration = await ws.registerPluginV8(Regions({}));
        if (cancelled) {
          await ws.unregisterPluginV8(regionsRegistration.manifest.id);
          return;
        }

        const regionsPlugin = regionsRegistration.instance.actions as RegionsPluginLike | undefined;
        if (regionsPlugin) {
          regionsPluginRef.current = regionsPlugin;
          cleanupRegionInteractions = setupRegionInteractions(regionsPlugin);
          if (!cancelled) setRegionsReady(true);
        }
      } catch (err) {
        console.error("[WaveSurfer] Failed to init regions plugin", err);
      }

      try {
        await ws.registerPluginV8(Timeline({}));
      } catch (err) {
        console.error("[WaveSurfer] Failed to init timeline plugin", err);
      }
    };

    void initPlugins();

    ws.on("ready", onReady);
    ws.on("play", onPlay);
    ws.on("pause", onPause);
    ws.on("finish", onFinish);
    ws.on("scroll", onScroll);
    ws.on("interaction", onInteraction);

    // Check if there's a pending displayAudioUrl that was set before WaveSurfer was created.
    // This handles the race condition when loading cloud projects where displayAudioUrl
    // is set before the WaveSurfer instance exists.
    // Skip if currentAudioSource will handle the loading.
    const pendingUrl = displayAudioUrlRef.current;
    const source = currentAudioSourceRef.current;
    const sourceWillLoad = source?.status === "ready" && source?.url;
    if (pendingUrl && pendingUrl !== lastDisplayAudioUrlRef.current && !sourceWillLoad) {
      lastDisplayAudioUrlRef.current = pendingUrl;
      isDisplayUrlLoadRef.current = true;
      // For blob URLs, fetch and use loadBlob() to avoid range request issues
      if (pendingUrl.startsWith("blob:")) {
        void (async () => {
          try {
            const response = await fetch(pendingUrl);
            const blob = await response.blob();
            ws.loadBlob(blob);
          } catch (err) {
            console.error("[WaveSurfer] Failed to load blob URL on init:", err);
          }
        })();
      } else {
        void ws.load(pendingUrl);
      }
    }

    let raf = 0;
    const tick = () => {
      // Best-effort: WaveSurfer provides getCurrentTime().
      // We drive this from an rAF loop while mounted.
      const nowMs = performance.now();
      const t = ws.getCurrentTime() || 0;
      const last = lastPlaybackEmitRef.current;
      if (Math.abs(t - last.timeSec) >= 0.1 || nowMs - last.atMs >= 33) {
        lastPlaybackEmitRef.current = { atMs: nowMs, timeSec: t };
        onPlaybackTimeRef.current?.(t);
        setPlayheadTimeRef.current(t);
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
        const scrollContainer = getScrollContainer(ws);
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

      cancelled = true;
      cleanupRegionInteractions?.();
      cleanupRegionInteractions = null;

      ws.un("scroll", onScroll);
      ws.un("interaction", onInteraction);
      ws.un("finish", onFinish);
      ws.destroy();
      wsRef.current = null;
      regionsPluginRef.current = null;
      queryRegionRef.current = null;
      setIsReady(false);
      setIsPlaying(false);
      setActiveRegion(null);
      setRegionsReady(false);
    };
  }, [containerEl, initialHeight]);

  // Update WaveSurfer height dynamically without recreating
  useEffect(() => {
    const ws = wsRef.current;
    if (!ws) return;
    ws.setOptions({ height: panelHeight });
  }, [panelHeight]);

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
    const scrollContainer = getScrollContainer(ws);
    if (!scrollContainer) return;

    const duration = ws.getDuration() || 0;
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
    if (!regionsPlugin || !regionsReady) return;

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

      el.dataset.regionId = region.id;

      // UX: auto candidate regions should not block query drag-selection.
      // We still allow manual regions to be edited (drag/resize) and clicked.
      el.style.pointerEvents = c.source === "manual" ? "auto" : "none";
      el.style.cursor = c.source === "manual" ? "grab" : "default";
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

        region.update({
          ...(needsTimeUpdate ? { start: c.startSec, end: c.endSec } : {}),
          color: fill,
        });
      }

      applyElementStyle(region, c, c.id === (activeCandidateId ?? null));
    }

    for (const r of regionsPlugin.getRegions()) {
      if (r.id === QUERY_REGION_ID) continue;
      if (desiredIds.has(r.id)) continue;
      r.remove();
    }
  }, [candidates, activeCandidateId, candidateCurveKind, regionsReady]);

  useEffect(() => {
    if (queryRegion !== null) return;
    const regionsPlugin = regionsPluginRef.current;
    if (!regionsPlugin || !regionsReady) return;

    for (const r of regionsPlugin.getRegions()) {
      if (r.id === QUERY_REGION_ID) r.remove();
    }
    queryRegionRef.current = null;
  }, [queryRegion, regionsReady]);

  function onPickFile(file: File) {
    // =======================================================================
    // DESIGN: File picker just notifies parent. Loading is handled by the
    // currentAudioSource flow: parent sets LocalAudioSource -> resolver
    // creates blob URL -> WaveSurfer effect loads when ready.
    // =======================================================================

    // Notify parent that a file was picked
    // Parent will set currentAudioSource, which triggers the loading flow
    onFilePicked?.(file);

    // Note: State clearing happens in the currentAudioSource loading effect
    // when the new source is loaded. We don't need to do it here.
  }

  function togglePlay() {
    // User intent: the player controls are "track playback", not segment playback.
    segmentPlaybackRef.current = null;
    void wsRef.current?.playPause();
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
    <div className="w-full ">
      {/* Hidden file input for programmatic triggering */}
      <input
        type="file"
        accept="audio/*"
        className="sr-only"
        ref={pickerRef}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void onPickFile(f);
        }}
      />

      <div className="flex items-center gap-2 p-2 rounded-md w-full ">
        {/* Additional toolbar content from parent (left) */}
        {toolbarLeft}
        <div className="flex gap-2 border-l border-zinc-300 dark:border-zinc-700 pl-2 ml-1">
          <Button size="sm" className="w-20" onClick={togglePlay} disabled={!isReady}>
            {isPlaying ? <><Pause />Pause</> : <><Play />Play</>}
          </Button>
          {/* Stop button disabled for now to reduce UI clutter */}
          {/* <Button size="sm" variant="outline" onClick={stop} disabled={!isReady}>
            <>Stop</>
          </Button> */}
        </div>

        <div className="flex items-center gap-1 border-l border-zinc-300 dark:border-zinc-700 pl-2 ml-1">
          <span className="text-sm text-zinc-600 dark:text-zinc-300">Zoom</span>
          <input
            type="range"
            min={0}
            max={100}
            step={1}
            value={(() => {
              // Convert zoom value back to slider position (inverse of log scale)
              if (zoom <= 0) return 0;
              const k = 6; // Curvature factor
              const maxZoom = 10000;
              return Math.log(1 + zoom * (Math.exp(k) - 1) / maxZoom) / k * 100;
            })()}
            onChange={(e) => {
              // Convert slider position to zoom using log scale
              const sliderValue = Number(e.target.value) / 100; // 0-1
              const k = 6; // Curvature factor - higher = more log-like
              const maxZoom = 10000;
              const newZoom = maxZoom * (Math.exp(k * sliderValue) - 1) / (Math.exp(k) - 1);
              setZoom(Math.round(newZoom));
            }}
            disabled={!isReady}
          />
          <span className="w-10 text-right text-sm tabular-nums text-zinc-600 dark:text-zinc-300">
            {(zoom / 100).toFixed(0)}%
          </span>
        </div>

        {/* BPM display and sub-beat division */}
        {(activeBeatGrid || selectedHypothesis || musicalTimeStructure) && (
          <div className="flex items-center gap-2 border-l border-zinc-300 dark:border-zinc-700 pl-2 ml-1">
            <button
              type="button"
              onClick={onBpmClick}
              className="text-sm font-medium tabular-nums text-green-600 dark:text-green-400 hover:text-green-700 dark:hover:text-green-300 hover:underline cursor-pointer"
              title="Go to Tempo Hypotheses"
            >
              {(() => {
                // Priority: Musical Time segment at playhead > Beat Grid > Selected Hypothesis
                const segment = musicalTimeStructure?.segments?.find(
                  (s) => playheadTime >= s.startTime && playheadTime < s.endTime
                );
                if (segment) return `${segment.bpm.toFixed(1)} BPM`;
                if (activeBeatGrid) return `${activeBeatGrid.bpm.toFixed(1)} BPM`;
                if (selectedHypothesis) return `${selectedHypothesis.bpm.toFixed(1)} BPM`;
                return "— BPM";
              })()}
            </button>
            <select
              value={subBeatDivision}
              onChange={(e) => setSubBeatDivision(Number(e.target.value) as typeof subBeatDivision)}
              className="text-xs bg-zinc-100 dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-600 rounded px-1.5 py-0.5 text-zinc-700 dark:text-zinc-300"
              title="Sub-beat division"
            >
              {SUB_BEAT_DIVISIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Region info or playhead position - inline display */}
        <div className="flex items-center gap-3 text-xs text-zinc-600 dark:text-zinc-300 border-l border-zinc-300 dark:border-zinc-700 pl-2 ml-1">
          {activeRegion ? (
            <div className="flex items-center gap-1">
              <span className="text-zinc-500">Selected:</span>
              <span className="tabular-nums">{`${activeRegion.startSec.toFixed(3)}s`}</span>
              <span className="text-zinc-400">→</span>
              <span className="tabular-nums">{`${activeRegion.endSec.toFixed(3)}s`}</span>
              <span className="tabular-nums">({`${activeRegion.durationSec.toFixed(3)}s`})</span>
              {searchModeActive && onClearRegion && (
                <button
                  onClick={() => {
                    // Clear the query region from WaveSurfer
                    const regionsPlugin = regionsPluginRef.current;
                    if (regionsPlugin) {
                      for (const r of regionsPlugin.getRegions()) {
                        if (r.id === QUERY_REGION_ID) r.remove();
                      }
                    }
                    queryRegionRef.current = null;
                    setActiveRegion(null);
                    onClearRegion();
                  }}
                  className="ml-1 p-0.5 rounded hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
                  title="Clear selection"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-1">
              <span className="tabular-nums">{playheadTime.toFixed(3)}s</span>
              <span className="text-zinc-400">|</span>
              <span className="tabular-nums">
                frame {sampleRate && sampleRate > 0 && hopSize > 0 ? (playheadTime * sampleRate / hopSize).toFixed(2) : "—"}
              </span>
              <span className="text-zinc-400">|</span>
              <span className="tabular-nums">
                {(() => {
                  // Priority: Musical Time > Beat Grid > Selected Hypothesis
                  const beatPos = getBeatPositionAt(playheadTime);
                  if (beatPos) {
                    return <>beat {(beatPos.beatPosition + 1).toFixed(2)}</>;
                  }
                  if (activeBeatGrid) {
                    return <>beat {(((playheadTime - (activeBeatGrid.phaseOffset + activeBeatGrid.userNudge)) * activeBeatGrid.bpm / 60) + 1).toFixed(2)}</>;
                  }
                  if (selectedHypothesis) {
                    return <>beat {((playheadTime * selectedHypothesis.bpm / 60) + 1).toFixed(2)}</>;
                  }
                  return "beat —";
                })()}
              </span>
            </div>
          )}
        </div>

        {/* Additional toolbar content from parent */}
        {toolbarRight}
      </div>

      <div
        className={`mt-1.5 rounded-md border border-zinc-200 bg-white p-1 dark:border-zinc-800 dark:bg-zinc-950 ${addMissingMode ? "ring-2 ring-emerald-500 ring-offset-1 ring-offset-white dark:ring-offset-zinc-950" : ""
          }`}
      >
        <div className="relative">
          {addMissingMode ? (
            <div className="pointer-events-none absolute right-2 top-2 rounded bg-emerald-500/15 px-2 py-1 text-[11px] font-medium text-emerald-700 dark:text-emerald-300">
              Add missing match mode
            </div>
          ) : null}
          <AnalysisOverlay
            isAnalysing={!!isAnalysing}
            analysisName={analysisName}
            lastAnalysisMs={lastAnalysisMs}
            backend={analysisBackend}
          />
          {overlayContent}
          <div
            ref={setContainerEl}
            className="w-full overflow-x-auto"
            style={{ overscrollBehaviorX: "contain" }}
            onMouseMove={handleCursorHover}
            onMouseLeave={handleCursorLeave}
          />
        </div>

        {/* Resize Handle */}
        <div
          onMouseDown={handleResizeStart}
          className="flex items-center justify-center h-2 cursor-ns-resize hover:bg-zinc-200/50 dark:hover:bg-zinc-700/50 transition-colors group"
        >
          <GripHorizontal className="w-5 h-2 text-zinc-400 group-hover:text-zinc-600 dark:text-zinc-600 dark:group-hover:text-zinc-400" />
        </div>
      </div>

      {/* Audio source status feedback */}
      {!isReady && (
        <div className="mt-2 text-sm">
          {currentAudioSource?.status === "pending" || currentAudioSource?.status === "resolving" ? (
            <div className="flex items-center gap-2 text-blue-600 dark:text-blue-400">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>
                {currentAudioSource.status === "pending" ? "Preparing audio..." : "Loading audio..."}
              </span>
            </div>
          ) : currentAudioSource?.status === "failed" ? (
            <div className="flex items-center gap-2 text-red-600 dark:text-red-400">
              <AlertCircle className="h-4 w-4" />
              <span>Failed to load audio{currentAudioSource.error ? `: ${currentAudioSource.error}` : ""}</span>
            </div>
          ) : (
            <p className="text-zinc-500">Choose an audio file to load it.</p>
          )}
        </div>
      )}

      {/* Intentionally no footer text here; MIR visualisation sits directly under waveform. */}
    </div>
  );
});
