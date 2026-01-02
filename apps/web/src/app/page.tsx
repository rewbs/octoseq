"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { useShallow } from "zustand/react/shallow";

import { Github } from "lucide-react";
import Image from "next/image";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";

import { HeatmapWithBandOverlay } from "@/components/frequencyBand";
import { InterpretationTreePanel } from "@/components/interpretationTree";
import { BandMirSignalViewer, BandEventViewer, useBandAmplitudeData } from "@/components/bandMir";
import { MissingAudioBanner } from "@/components/audio/MissingAudioBanner";
import { AudioReattachModal } from "@/components/audio/AudioReattachModal";
import { MirConfigModal } from "@/components/mir/MirConfigModal";
import { SignalViewer, createContinuousSignal } from "@/components/wavesurfer/SignalViewer";
import { SparseEventsViewer } from "@/components/wavesurfer/SparseEventsViewer";
import { BeatGridOverlay } from "@/components/wavesurfer/BeatGridOverlay";
import { BeatMarkingOverlay } from "@/components/wavesurfer/BeatMarkingOverlay";
import { TempoHypothesesViewer, type SignalOption } from "@/components/tempo/TempoHypothesesViewer";
import { MusicalTimePanel } from "@/components/tempo/MusicalTimePanel";
import { WaveSurferPlayer, type WaveSurferPlayerHandle } from "@/components/wavesurfer/WaveSurferPlayer";
import { VisualiserPanel } from "@/components/visualiser/VisualiserPanel";
import { CustomSignalsPanel } from "@/components/customSignal/CustomSignalsPanel";
import { MeshAssetsPanel } from "@/components/meshAssets";
import { AuthoredEventsPanel } from "@/components/eventStream";
import { SearchPanel } from "@/components/search/SearchPanel";
import { DebugPanel } from "@/components/panels/DebugPanel";
import { useElementSize } from "@/lib/useElementSize";
import { computeRefinementStats } from "@/lib/searchRefinement";
import { useKeyboardShortcuts } from "@/lib/hooks/useKeyboardShortcuts";
import { useMetronome } from "@/lib/hooks/useMetronome";
import { useBandAuditioning } from "@/lib/hooks/useBandAuditioning";
import { useUnsavedChangesWarning } from "@/lib/hooks/useUnsavedChangesWarning";
import { DemoAudioModal } from "@/components/DemoAudioModal";
import type { MirFunctionId } from "@/components/mir/MirControlPanel";
import { mirTabDefinitions } from "@/lib/stores/mirStore";
import { computePhaseHypotheses, type BeatCandidate } from "@octoseq/mir";

import {
  SignInButton,
  SignUpButton,
  SignedIn,
  SignedOut,
  UserButton,
} from '@clerk/nextjs';

// Stores and hooks
import {
  useAudioStore,
  useAudioInputStore,
  usePlaybackStore,
  useConfigStore,
  useMirStore,
  useSearchStore,
  useBeatGridStore,
  useMusicalTimeStore,
  useManualTempoStore,
  useFrequencyBandStore,
  useBandMirStore,
  setupBandMirInvalidation,
  useMirActions,
  useNavigationActions,
  useAudioActions,
  useBandMirActions,
  useCandidatesById,
  useActiveCandidate,
  useSearchSignal,
  useHasSearchResult,
  useRefinementLabelsAvailable,
  useDebugSignals,
  useTabDefs,
  useTabResult,
  useDisplayedHeatmap,
  useHeatmapValueRange,
  useHeatmapYAxisLabel,
  useVisibleRange,
  useMirroredCursorTime,
  useInterpretationTreeStore,
} from "@/lib/stores";
import { getInspectorNodeType } from "@/lib/nodeTypes";

export default function Home() {
  // ===== REFS (stay in component) =====
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const playerRef = useRef<WaveSurferPlayerHandle | null>(null);
  const lastSelectionRef = useRef<{ startSec: number; endSec: number } | null>(null);
  const userSetUseRefinementRef = useRef(false);

  // ===== STORE STATE =====
  // Audio store
  const audio = useAudioStore((s) => s.audio);
  const audioSampleRate = useAudioStore((s) => s.audioSampleRate);
  const audioTotalSamples = useAudioStore((s) => s.audioTotalSamples);
  const audioDuration = useAudioStore((s) => s.audioDuration);

  // Audio input store (for waveform switching and stem checks)
  const activeDisplayUrl = useAudioInputStore((s) => s.getActiveDisplayUrl());
  const hasStems = useAudioInputStore((s) => s.hasStems());
  const clearStems = useAudioInputStore((s) => s.clearStems);
  const setTriggerFileInput = useAudioInputStore((s) => s.setTriggerFileInput);

  // Playback store
  const playheadTimeSec = usePlaybackStore((s) => s.playheadTimeSec);
  const isAudioPlaying = usePlaybackStore((s) => s.isAudioPlaying);
  const viewport = usePlaybackStore((s) => s.viewport);
  const waveformSeekTo = usePlaybackStore((s) => s.waveformSeekTo);
  const {
    setPlayheadTimeSec,
    setCursorTimeSec,
    setIsAudioPlaying,
    setViewport,
    setWaveformSeekTo,
    normalizeViewport,
  } = usePlaybackStore(
    useShallow((s) => ({
      setPlayheadTimeSec: s.setPlayheadTimeSec,
      setCursorTimeSec: s.setCursorTimeSec,
      setIsAudioPlaying: s.setIsAudioPlaying,
      setViewport: s.setViewport,
      setWaveformSeekTo: s.setWaveformSeekTo,
      normalizeViewport: s.normalizeViewport,
    }))
  );

  // Config store - only what's needed in page.tsx
  const heatmapScheme = useConfigStore((s) => s.heatmapScheme);
  const setIsConfigOpen = useConfigStore((s) => s.setIsConfigOpen);
  const setIsDebugOpen = useConfigStore((s) => s.setIsDebugOpen);

  // MIR store
  const mirResults = useMirStore((s) => s.mirResults);
  const isRunning = useMirStore((s) => s.isRunning);
  const runningAnalysis = useMirStore((s) => s.runningAnalysis);
  const lastTimings = useMirStore((s) => s.lastTimings);
  const visualTab = useMirStore((s) => s.visualTab);
  const setVisualTab = useMirStore((s) => s.setVisualTab);

  // Search store
  const searchControls = useSearchStore((s) => s.searchControls);
  const searchResult = useSearchStore((s) => s.searchResult);
  const refinement = useSearchStore((s) => s.refinement);
  const addMissingMode = useSearchStore((s) => s.addMissingMode);
  const {
    setSearchResult,
    setSearchDirty,
    setRefinement,
    setCandidateFilter,
    setAddMissingMode,
    setUseRefinementSearch,
    addManualCandidate,
    updateManualCandidate,
  } = useSearchStore(
    useShallow((s) => ({
      setSearchResult: s.setSearchResult,
      setSearchDirty: s.setSearchDirty,
      setRefinement: s.setRefinement,
      setCandidateFilter: s.setCandidateFilter,
      setAddMissingMode: s.setAddMissingMode,
      setUseRefinementSearch: s.setUseRefinementSearch,
      addManualCandidate: s.addManualCandidate,
      updateManualCandidate: s.updateManualCandidate,
    }))
  );

  // Beat grid store
  const beatGridState = useBeatGridStore(
    useShallow((s) => ({
      selectedHypothesis: s.selectedHypothesis,
      phaseHypotheses: s.phaseHypotheses,
      activePhaseIndex: s.activePhaseIndex,
      activeBeatGrid: s.activeBeatGrid,
      userNudge: s.userNudge,
      isLocked: s.isLocked,
      isVisible: s.isVisible,
      metronomeEnabled: s.metronomeEnabled,
      config: s.config,
    }))
  );
  const {
    selectHypothesis: selectBeatGridHypothesis,
    updateSelectedBpm,
    setPhaseHypotheses,
    cyclePhase,
    nudgePhase,
    resetNudge,
    setLocked: setBeatGridLocked,
    toggleVisibility: toggleBeatGridVisibility,
    toggleMetronome,
    clear: clearBeatGrid,
    canPromote: canPromoteBeatGrid,
    getPromotableGrid,
  } = useBeatGridStore(
    useShallow((s) => ({
      selectHypothesis: s.selectHypothesis,
      updateSelectedBpm: s.updateSelectedBpm,
      setPhaseHypotheses: s.setPhaseHypotheses,
      cyclePhase: s.cyclePhase,
      nudgePhase: s.nudgePhase,
      resetNudge: s.resetNudge,
      setLocked: s.setLocked,
      toggleVisibility: s.toggleVisibility,
      toggleMetronome: s.toggleMetronome,
      clear: s.clear,
      canPromote: s.canPromote,
      getPromotableGrid: s.getPromotableGrid,
    }))
  );

  // Musical time store (B4)
  const musicalTimeStructure = useMusicalTimeStore((s) => s.structure);
  const musicalTimeSelectedSegmentId = useMusicalTimeStore((s) => s.selectedSegmentId);
  const {
    setAudioIdentity,
    promoteGrid,
    selectSegment: selectMusicalTimeSegment,
    removeSegment: removeMusicalTimeSegment,
    splitSegmentAt: splitMusicalTimeSegmentAt,
    updateBoundary: updateMusicalTimeBoundary,
    clearStructure: clearMusicalTime,
    reset: resetMusicalTime,
  } = useMusicalTimeStore(
    useShallow((s) => ({
      setAudioIdentity: s.setAudioIdentity,
      promoteGrid: s.promoteGrid,
      selectSegment: s.selectSegment,
      removeSegment: s.removeSegment,
      splitSegmentAt: s.splitSegmentAt,
      updateBoundary: s.updateBoundary,
      clearStructure: s.clearStructure,
      reset: s.reset,
    }))
  );

  // Manual tempo store
  const manualHypotheses = useManualTempoStore((s) => s.hypotheses);
  const beatMarkingActive = useManualTempoStore((s) => s.beatMarkingActive);
  const beatMark1 = useManualTempoStore((s) => s.beatMark1);
  const beatMark2 = useManualTempoStore((s) => s.beatMark2);
  const {
    createManualHypothesis,
    duplicateHypothesis,
    updateHypothesisBpm,
    deleteHypothesis: deleteManualHypothesis,
    recordTap,
    clear: clearManualTempo,
    startBeatMarking,
    stopBeatMarking,
    placeBeatMark,
    updateBeatMark,
    resetBeatMarks,
    getMarkedBpm,
  } = useManualTempoStore(
    useShallow((s) => ({
      createManualHypothesis: s.createManualHypothesis,
      duplicateHypothesis: s.duplicateHypothesis,
      updateHypothesisBpm: s.updateHypothesisBpm,
      deleteHypothesis: s.deleteHypothesis,
      recordTap: s.recordTap,
      clear: s.clear,
      startBeatMarking: s.startBeatMarking,
      stopBeatMarking: s.stopBeatMarking,
      placeBeatMark: s.placeBeatMark,
      updateBeatMark: s.updateBeatMark,
      resetBeatMarks: s.resetBeatMarks,
      getMarkedBpm: s.getMarkedBpm,
    }))
  );

  // Frequency band store
  const hasBands = useFrequencyBandStore((s) => (s.structure?.bands.length ?? 0) > 0);
  const setFrequencyBandAudioIdentity = useFrequencyBandStore((s) => s.setAudioIdentity);
  const { structure: bandStructure, soloedBandId, mutedBandIds } = useFrequencyBandStore(
    useShallow((s) => ({
      structure: s.structure,
      soloedBandId: s.soloedBandId,
      mutedBandIds: s.mutedBandIds,
    }))
  );
  // Subscribe to band MIR cache for tempo signal options refresh
  const bandMirCacheSize = useBandMirStore((s) => s.cache.size);
  // No-op callback - components report progress but we don't display it
  const handleBandWaveformsReadyChange = useCallback(
    () => { },
    []
  ) as (status: { ready: number; total: number }) => void;

  // Audio URL for band auditioning
  const audioUrl = useAudioStore((s) => s.audioUrl);

  // Tree selection state - to hide main viz when custom signals or event streams is selected
  const selectedNodeId = useInterpretationTreeStore((s) => s.selectedNodeId);
  const selectedNodeType = useMemo(() => getInspectorNodeType(selectedNodeId), [selectedNodeId]);
  const isCustomSignalSelected = selectedNodeType === "custom-signals-section" || selectedNodeType === "custom-signal";
  const isEventStreamsSelected = selectedNodeType === "event-streams-section" || selectedNodeType === "authored-stream";

  // ===== ACTION HOOKS =====
  const { runAllAnalyses } = useMirActions();
  const { runBandAnalysis } = useBandMirActions();
  const { handleAudioDecoded, triggerFileInput } = useAudioActions({
    fileInputRef,
    onAudioLoaded: runAllAnalyses,
  });
  const {
    onPrevCandidate,
    onNextCandidate,
    playQueryRegion,
    togglePlayShortcut,
    acceptActive,
    rejectActive,
    deleteActiveManual,
    jumpToBestUnreviewed,
  } = useNavigationActions({ playerRef });

  // ===== METRONOME =====
  const activePhaseOffset = beatGridState.phaseHypotheses[beatGridState.activePhaseIndex]?.phaseOffset ?? 0;
  useMetronome({
    enabled: beatGridState.metronomeEnabled,
    isPlaying: isAudioPlaying,
    playheadTimeSec,
    bpm: beatGridState.selectedHypothesis?.bpm ?? 0,
    phaseOffset: activePhaseOffset,
    userNudge: beatGridState.userNudge,
  });

  // ===== BAND AUDITIONING =====
  const [mainPlayerMuted, setMainPlayerMuted] = useState(false);
  useBandAuditioning({
    audioUrl,
    enabled: true,
    soloedBandId,
    mutedBandIds,
    structure: bandStructure,
    playheadTimeSec,
    isMainPlaying: isAudioPlaying,
    mainVolume: 1,
    onSetMainMuted: setMainPlayerMuted,
  });

  // ===== UNSAVED CHANGES WARNING =====
  useUnsavedChangesWarning();

  // ===== REGISTER FILE INPUT TRIGGER =====
  // Make triggerFileInput available to other components (e.g., tree panel)
  useEffect(() => {
    setTriggerFileInput(triggerFileInput);
    return () => setTriggerFileInput(null);
  }, [triggerFileInput, setTriggerFileInput]);

  // ===== AUDIO RE-ATTACHMENT MODAL =====
  const [showAudioReattachModal, setShowAudioReattachModal] = useState(false);

  // ===== BAND AMPLITUDE VIEW =====
  const [selectedBandAmplitudeId] = useState<string | null>(null);
  const [tempoSignalId, setTempoSignalId] = useState<string | null>("onsetEnvelope");
  const bandAmplitudeData = useBandAmplitudeData(selectedBandAmplitudeId);

  // ===== STEM CONFIRMATION DIALOG =====
  // State for pending audio load when stems exist
  const [pendingAudio, setPendingAudio] = useState<{
    sampleRate: number;
    getChannelData: (n: number) => Float32Array;
  } | null>(null);
  const [showStemConfirmDialog, setShowStemConfirmDialog] = useState(false);

  // Wrapped audio decoded handler that shows confirmation if stems exist
  const handleAudioDecodedWithConfirmation = useCallback(
    (a: { sampleRate: number; getChannelData: (n: number) => Float32Array }) => {
      if (hasStems) {
        // Store pending audio and show confirmation dialog
        setPendingAudio(a);
        setShowStemConfirmDialog(true);
      } else {
        // No stems, proceed directly
        handleAudioDecoded(a);
      }
    },
    [hasStems, handleAudioDecoded]
  );

  // Confirm handlers for stem dialog
  const handleConfirmKeepStems = useCallback(() => {
    if (pendingAudio) {
      handleAudioDecoded(pendingAudio);
      setPendingAudio(null);
    }
    setShowStemConfirmDialog(false);
  }, [pendingAudio, handleAudioDecoded]);

  const handleConfirmClearStems = useCallback(() => {
    if (pendingAudio) {
      clearStems();
      handleAudioDecoded(pendingAudio);
      setPendingAudio(null);
    }
    setShowStemConfirmDialog(false);
  }, [pendingAudio, clearStems, handleAudioDecoded]);

  const handleCancelAudioLoad = useCallback(() => {
    setPendingAudio(null);
    setShowStemConfirmDialog(false);
  }, []);

  // Build signal options for tempo hypothesis comparison
  const tempoSignalOptions = useMemo((): SignalOption[] => {
    const options: SignalOption[] = [];

    // MIR 1D signals
    const mir1dSignals: Array<{ id: MirFunctionId; label: string }> = [
      { id: "onsetEnvelope", label: "Onset Envelope" },
      { id: "spectralFlux", label: "Spectral Flux" },
      { id: "spectralCentroid", label: "Spectral Centroid" },
      { id: "cqtHarmonicEnergy", label: "CQT Harmonic Energy" },
      { id: "cqtBassPitchMotion", label: "CQT Bass Pitch Motion" },
      { id: "cqtTonalStability", label: "CQT Tonal Stability" },
    ];

    for (const sig of mir1dSignals) {
      const result = mirResults[sig.id];
      options.push({
        id: sig.id,
        label: sig.label,
        group: "mir",
        data: result?.kind === "1d" ? { times: result.times, values: result.values } : null,
      });
    }

    // Band amplitude signals (if available)
    const bands = bandStructure?.bands ?? [];
    for (const band of bands) {
      const bandResult = useBandMirStore.getState().cache.get(`${band.id}:bandOnsetStrength`);
      if (bandResult) {
        options.push({
          id: `band:${band.id}:onsetStrength`,
          label: `${band.label} Onset`,
          group: "band",
          data: { times: bandResult.times, values: bandResult.values },
        });
      }
    }

    return options;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- bandMirCacheSize triggers refresh when band analysis completes
  }, [mirResults, bandStructure, bandMirCacheSize]);

  // Auto-compute amplitude envelope when band is selected but data missing
  useEffect(() => {
    if (selectedBandAmplitudeId && !bandAmplitudeData && audio) {
      void runBandAnalysis([selectedBandAmplitudeId], ["bandAmplitudeEnvelope"]);
    }
  }, [selectedBandAmplitudeId, bandAmplitudeData, audio, runBandAnalysis]);

  // ===== DERIVED STATE HOOKS =====
  const candidatesById = useCandidatesById();
  const activeCandidate = useActiveCandidate();
  const searchSignal = useSearchSignal();
  const hasSearchResult = useHasSearchResult();
  const refinementLabelsAvailable = useRefinementLabelsAvailable();
  const debugSignals = useDebugSignals();
  const tabDefs = useTabDefs();
  const tabResult = useTabResult();
  const displayedHeatmap = useDisplayedHeatmap();
  const heatmapValueRange = useHeatmapValueRange();
  const heatmapYAxisLabel = useHeatmapYAxisLabel();
  const visibleRange = useVisibleRange();
  const mirroredCursorTimeSec = useMirroredCursorTime();

  // ===== COMPUTED VALUES =====

  // Extract beat candidates from MIR results for phase alignment
  const beatCandidates = useMemo((): BeatCandidate[] => {
    const result = mirResults?.beatCandidates;
    if (!result || result.kind !== "events") return [];
    return result.events.map((e) => ({
      time: e.time,
      strength: e.strength,
      source: "combined" as const,
    }));
  }, [mirResults]);

  // ===== KEYBOARD SHORTCUTS =====
  useKeyboardShortcuts({
    onPrevCandidate,
    onNextCandidate,
    onAccept: acceptActive,
    onReject: rejectActive,
    onTogglePlay: togglePlayShortcut,
    onPlayQuery: playQueryRegion,
    onToggleAddMissingMode: () => setAddMissingMode(!addMissingMode),
    onDeleteManual: deleteActiveManual,
    onJumpToBestUnreviewed: jumpToBestUnreviewed,
    canDeleteManual: activeCandidate?.source === "manual",
  });

  // ===== EFFECTS =====
  // Auto-enable refinement when labels available
  useEffect(() => {
    if (userSetUseRefinementRef.current) return;
    setUseRefinementSearch(refinementLabelsAvailable);
  }, [refinementLabelsAvailable, setUseRefinementSearch]);

  // Compute phase hypotheses when beat grid hypothesis is selected
  useEffect(() => {
    if (!beatGridState.selectedHypothesis || beatCandidates.length === 0 || !audioDuration) {
      if (beatGridState.phaseHypotheses.length > 0) {
        setPhaseHypotheses([]);
      }
      return;
    }

    const phases = computePhaseHypotheses(
      beatGridState.selectedHypothesis.bpm,
      beatCandidates,
      audioDuration,
      beatGridState.config
    );
    setPhaseHypotheses(phases);
  }, [
    beatGridState.selectedHypothesis,
    beatGridState.config,
    beatGridState.phaseHypotheses.length,
    beatCandidates,
    audioDuration,
    setPhaseHypotheses,
  ]);

  // Clear beat grid when audio changes
  useEffect(() => {
    if (!audio) {
      clearBeatGrid();
    }
  }, [audio, clearBeatGrid]);

  // Invalidate band MIR cache when bands change
  useEffect(() => {
    return setupBandMirInvalidation();
  }, []);

  // Set audio identity for musical time persistence (B4)
  useEffect(() => {
    if (audio && audioSampleRate && audioDuration) {
      const audioFileName = useAudioStore.getState().audioFileName;
      const identity = {
        filename: audioFileName ?? "unknown",
        duration: audioDuration,
        sampleRate: audioSampleRate,
      };
      setAudioIdentity(identity);
      setFrequencyBandAudioIdentity(identity);
    } else {
      setAudioIdentity(null);
      setFrequencyBandAudioIdentity(null);
      resetMusicalTime();
    }
  }, [
    audio,
    audioSampleRate,
    audioDuration,
    setAudioIdentity,
    setFrequencyBandAudioIdentity,
    resetMusicalTime,
  ]);

  // Handle promotion of beat grid to musical time
  const handlePromoteGrid = useCallback(
    (startTime: number, endTime: number) => {
      const grid = getPromotableGrid();
      if (!grid) return;
      promoteGrid(grid, startTime, endTime);
    },
    [getPromotableGrid, promoteGrid]
  );

  // Handle manual tempo hypothesis creation
  const handleCreateManualHypothesis = useCallback(
    (bpm: number) => {
      const hypothesis = createManualHypothesis(bpm);
      // Auto-select the newly created hypothesis
      selectBeatGridHypothesis(hypothesis);
    },
    [createManualHypothesis, selectBeatGridHypothesis]
  );

  // Handle hypothesis duplication for editing
  const handleDuplicateHypothesis = useCallback(
    (source: Parameters<typeof duplicateHypothesis>[0]) => {
      const hypothesis = duplicateHypothesis(source);
      // Auto-select the duplicated hypothesis
      selectBeatGridHypothesis(hypothesis);
    },
    [duplicateHypothesis, selectBeatGridHypothesis]
  );

  // Handle BPM update for manual/edited hypotheses
  const handleUpdateHypothesisBpm = useCallback(
    (hypothesisId: string, newBpm: number) => {
      const updated = updateHypothesisBpm(hypothesisId, newBpm);
      if (updated) {
        // Update in-place to preserve userNudge and isLocked state
        updateSelectedBpm(updated);
      }
    },
    [updateHypothesisBpm, updateSelectedBpm]
  );

  // Handle manual hypothesis deletion
  const handleDeleteManualHypothesis = useCallback(
    (hypothesisId: string) => {
      // If this hypothesis is selected, deselect it first
      if (beatGridState.selectedHypothesis?.id === hypothesisId) {
        selectBeatGridHypothesis(null);
      }
      deleteManualHypothesis(hypothesisId);
    },
    [beatGridState.selectedHypothesis, selectBeatGridHypothesis, deleteManualHypothesis]
  );

  // Handle tap-to-nudge
  const handleRecordTap = useCallback(
    (currentBpm: number) => {
      return recordTap(currentBpm);
    },
    [recordTap]
  );

  // Handle beat marking - apply the marked tempo as a manual hypothesis
  const handleApplyBeatMarking = useCallback(() => {
    const result = getMarkedBpm();
    if (!result) return;

    // Create a manual hypothesis with the marked BPM
    const hypothesis = createManualHypothesis(result.bpm);
    // Select it to trigger phase alignment
    selectBeatGridHypothesis(hypothesis);
    // Exit beat marking mode
    stopBeatMarking();
  }, [getMarkedBpm, createManualHypothesis, selectBeatGridHypothesis, stopBeatMarking]);

  // Clear manual tempo when audio changes
  useEffect(() => {
    if (!audio) {
      clearManualTempo();
    }
  }, [audio, clearManualTempo]);

  // Mark search as stale when inputs change
  useEffect(() => {
    const query = refinement.queryRegion
      ? { startSec: refinement.queryRegion.startSec, endSec: refinement.queryRegion.endSec }
      : null;
    const prev = lastSelectionRef.current;
    const selectionChanged =
      (prev?.startSec ?? null) !== (query?.startSec ?? null) ||
      (prev?.endSec ?? null) !== (query?.endSec ?? null);
    lastSelectionRef.current = query;

    if (!query || !audio) {
      setSearchResult(null);
      setWaveformSeekTo(null);
      setSearchDirty(false);
      setCandidateFilter("all");
      setAddMissingMode(false);
      userSetUseRefinementRef.current = false;
      setUseRefinementSearch(false);
      setRefinement((prevState) => {
        if (
          prevState.candidates.length === 0 &&
          prevState.activeCandidateId == null &&
          prevState.queryRegion == null
        )
          return prevState;
        return {
          queryRegion: null,
          candidates: [],
          activeCandidateId: null,
          refinementStats: { accepted: 0, rejected: 0, unreviewed: 0 },
        };
      });
      return;
    }

    if (selectionChanged) {
      setSearchResult(null);
      setWaveformSeekTo(null);
      setCandidateFilter("all");
      setAddMissingMode(false);
      userSetUseRefinementRef.current = false;
      setUseRefinementSearch(false);
      setRefinement((prevState) => ({
        ...prevState,
        candidates: [],
        activeCandidateId: null,
        refinementStats: computeRefinementStats([]),
      }));
    }

    setSearchDirty(true);
  }, [
    refinement.queryRegion,
    searchControls,
    audio,
    setSearchResult,
    setWaveformSeekTo,
    setSearchDirty,
    setCandidateFilter,
    setAddMissingMode,
    setUseRefinementSearch,
    setRefinement,
  ]);

  // Ensure the selected tab exists
  useEffect(() => {
    if (tabDefs.find((t) => t.id === visualTab)) return;
    const fallback = tabDefs.find((t) => t.hasData) ?? tabDefs[0];
    if (fallback) setVisualTab(fallback.id);
  }, [tabDefs, visualTab, setVisualTab]);

  // ===== EVENT HANDLERS =====
  const handleCursorHoverFromViewport = (evt: MouseEvent<HTMLElement>) => {
    if (!viewport || viewport.minPxPerSec <= 0) return;
    const rect = evt.currentTarget.getBoundingClientRect();
    const span = viewport.endTime - viewport.startTime;
    if (span <= 0) return;
    const pxPerSec = rect.width > 0 ? rect.width / span : viewport.minPxPerSec;
    if (!pxPerSec || pxPerSec <= 0) return;
    const x = Math.max(0, Math.min(rect.width, evt.clientX - rect.left));
    const t = viewport.startTime + x / pxPerSec;
    const clamped = audioDuration ? Math.min(audioDuration, Math.max(0, t)) : Math.max(0, t);
    setCursorTimeSec(clamped);
  };

  const handleCursorLeave = () => setCursorTimeSec(null);

  const handleRegionChange = useCallback(
    (r: { startSec: number; endSec: number } | null) => {
      if (!r) {
        setWaveformSeekTo(null);
        setRefinement({
          queryRegion: null,
          candidates: [],
          activeCandidateId: null,
          refinementStats: { accepted: 0, rejected: 0, unreviewed: 0 },
        });
        return;
      }
      if (!audioSampleRate || !audioTotalSamples) return;
      const startSec = Math.min(r.startSec, r.endSec);
      const endSec = Math.max(r.startSec, r.endSec);
      const startSample = Math.max(
        0,
        Math.min(audioTotalSamples, Math.floor(startSec * audioSampleRate))
      );
      const endSample = Math.max(
        startSample,
        Math.min(audioTotalSamples, Math.floor(endSec * audioSampleRate))
      );
      setRefinement((prevState) => ({
        ...prevState,
        queryRegion: { startSec, endSec, startSample, endSample },
      }));
    },
    [audioSampleRate, audioTotalSamples, setRefinement, setWaveformSeekTo]
  );

  // ===== SIZE HOOKS =====
  const { ref: heatmapHostRef, size: heatmapHostSize } = useElementSize<HTMLDivElement>();

  // ===== RENDER =====
  return (
    <div className="page-bg flex flex-col h-screen bg-zinc-50 font-sans dark:bg-zinc-950 overflow-hidden">
      <div className="w-full flex-1 flex min-h-0">
        {/* Interpretation Tree Panel (replaces FrequencyBandSidebar) */}
        <InterpretationTreePanel />

        <main className="main-bg flex-1 min-w-0 overflow-y-auto bg-white p-2 pr-4 shadow dark:bg-zinc-950">
          {/* Missing audio warning banner */}
          <MissingAudioBanner onReattach={() => setShowAudioReattachModal(true)} />

          <section>
            <div className="space-y-1.5">
              <WaveSurferPlayer
                ref={playerRef}
                fileInputRef={fileInputRef}
                cursorTimeSec={mirroredCursorTimeSec}
                onCursorTimeChange={setCursorTimeSec}
                viewport={viewport}
                seekToTimeSec={waveformSeekTo}
                onIsPlayingChange={setIsAudioPlaying}
                candidateCurveKind={searchResult?.curveKind}
                queryRegion={
                  refinement.queryRegion
                    ? { startSec: refinement.queryRegion.startSec, endSec: refinement.queryRegion.endSec }
                    : null
                }
                candidates={refinement.candidates}
                activeCandidateId={refinement.activeCandidateId}
                addMissingMode={addMissingMode}
                onSelectCandidateId={(candidateId) => {
                  setRefinement((prevState) => ({ ...prevState, activeCandidateId: candidateId }));
                  const c = candidateId ? candidatesById.get(candidateId) : null;
                  if (c) setWaveformSeekTo(c.startSec);
                }}
                onManualCandidateCreate={(c) => {
                  addManualCandidate({
                    id: c.id,
                    startSec: c.startSec,
                    endSec: c.endSec,
                    score: 1.0,
                    status: "accepted",
                    source: "manual",
                  });
                  setWaveformSeekTo(c.startSec);
                }}
                onManualCandidateUpdate={(u) => {
                  updateManualCandidate(u);
                }}
                onAudioDecoded={handleAudioDecodedWithConfirmation}
                onViewportChange={(vp) => setViewport(normalizeViewport(vp, audioDuration))}
                onPlaybackTime={(t) => setPlayheadTimeSec(t)}
                onRegionChange={handleRegionChange}
                onClearRegion={() => handleRegionChange(null)}
                searchModeActive={visualTab === "search"}
                isAnalysing={isRunning}
                analysisName={mirTabDefinitions.find((t) => t.id === runningAnalysis)?.label}
                lastAnalysisMs={lastTimings?.totalMs}
                analysisBackend={lastTimings?.backend}
                muted={mainPlayerMuted}
                onBpmClick={() => setVisualTab("tempoHypotheses")}
                displayAudioUrl={activeDisplayUrl}
                overlayContent={
                  <>
                    <BeatGridOverlay
                      viewport={viewport}
                      beatGrid={beatGridState.activeBeatGrid}
                      audioDuration={audioDuration ?? 0}
                      isVisible={beatGridState.isVisible}
                      musicalTimeSegments={musicalTimeStructure?.segments ?? []}
                      selectedSegmentId={musicalTimeSelectedSegmentId}
                    />
                    <BeatMarkingOverlay
                      isActive={beatMarkingActive}
                      viewport={viewport ? { startSec: viewport.startTime, endSec: viewport.endTime } : null}
                      beat1TimeSec={beatMark1?.timeSec ?? null}
                      beat2TimeSec={beatMark2?.timeSec ?? null}
                      audioDuration={audioDuration ?? 0}
                      onBeatClick={placeBeatMark}
                      onBeatDrag={updateBeatMark}
                      onApply={handleApplyBeatMarking}
                      onReset={resetBeatMarks}
                      onCancel={stopBeatMarking}
                    />
                  </>
                }
                toolbarLeft={
                  <div className="flex items-center gap-2">
                    <div className="relative flex flex-col  items-center justify-center mr-4">
                      <Image
                        src="/SquidPlain.png"
                        alt="Octoseq"
                        width={36}
                        height={36}
                        className="h-14 w-14 rounded-3xl bg-stone-200 p-1 dark:bg-stone-800 hover:scale-125 hover:rotate-180 transition-all"
                      />
                      <div className="absolute top-8 inset-0 flex items-center justify-center">
                        <p className="w-full text-tiny tracking-[0.25em] font font-mono  text-zinc-900 dark:text-zinc-100 text-shadow-lg text-shadow-stone-500/50 dark:text-shadow-stone-100/50 text-center backdrop-blur-lg backdrop-opacity-20 ">
                          octoseq
                        </p>
                      </div>
                    </div>
                    <DemoAudioModal
                      onSelectDemo={async (demo) => {
                        await playerRef.current?.loadUrl(demo.path, demo.name);
                      }}
                    />
                  </div>
                }
                toolbarRight={
                  <div className="flex flex-nowrap items-center gap-2 border-l border-zinc-300 dark:border-zinc-700 pl-2 ml-1 min-w-0 overflow-hidden">
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setIsConfigOpen(true)}
                      >
                        Configure
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setIsDebugOpen(true)}
                      >
                        Debug
                      </Button>

                    </div>
                  </div>
                }
              />

              {/* Band Amplitude Envelope Display */}
              {bandAmplitudeData && (
                <div className="mt-1.5">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
                      {bandAmplitudeData.bandLabel} Amplitude
                    </span>
                    {bandAmplitudeData.diagnostics.warnings.length > 0 && (
                      <span className="text-xs text-amber-500" title={bandAmplitudeData.diagnostics.warnings.join("; ")}>
                        ⚠
                      </span>
                    )}
                  </div>
                  <SignalViewer
                    signal={createContinuousSignal(bandAmplitudeData.times, bandAmplitudeData.values)}
                    viewport={viewport}
                    cursorTimeSec={mirroredCursorTimeSec}
                    onCursorTimeChange={setCursorTimeSec}
                    initialHeight={80}
                    mode="filled"
                    color={{ stroke: "rgb(124, 58, 237)", fill: "rgba(124, 58, 237, 0.3)" }}
                    showBeatGrid={beatGridState.isVisible}
                    audioDuration={audioDuration ?? 0}
                  />
                </div>
              )}

              {/* Main visualization section - hidden when custom signals or event streams is selected */}
              {!isCustomSignalSelected && !isEventStreamsSelected && <div className="mt-1.5">

                {visualTab === "search" ? (
                  hasSearchResult ? (
                    <div className="space-y-2">
                      <SignalViewer
                        signal={createContinuousSignal(searchResult!.times, searchSignal!)}
                        viewport={viewport}
                        cursorTimeSec={mirroredCursorTimeSec}
                        onCursorTimeChange={setCursorTimeSec}
                        threshold={searchControls.threshold}
                        mode="filled"
                        color={{ stroke: "rgb(16, 185, 129)", fill: "rgba(16, 185, 129, 0.3)" }}
                        showBeatGrid={beatGridState.isVisible}
                        audioDuration={audioDuration ?? 0}
                      />
                    </div>
                  ) : (
                    <p className="text-sm text-zinc-500">Select an audio segment and run search to see the similarity curve.</p>
                  )
                ) : visualTab === "debug" ? (
                  debugSignals.length > 0 ? (
                    <div className="space-y-2">
                      {debugSignals.map((sig) => (
                        <div key={sig.name} className="border-l-2 border-purple-500 pl-2">
                          <span className="text-xs text-purple-600 dark:text-purple-400 font-medium">{sig.name}</span>
                          <SignalViewer
                            signal={createContinuousSignal(sig.times, sig.values)}
                            viewport={viewport}
                            cursorTimeSec={mirroredCursorTimeSec}
                            onCursorTimeChange={setCursorTimeSec}
                            mode="filled"
                            color={{ stroke: "rgb(168, 85, 247)", fill: "rgba(168, 85, 247, 0.3)" }}
                            showBeatGrid={beatGridState.isVisible}
                            audioDuration={audioDuration ?? 0}
                          />
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-zinc-500">
                      Use <code className="bg-zinc-100 dark:bg-zinc-800 px-1 rounded">dbg.emit(&quot;name&quot;, value)</code> in your script and click the flask icon to extract debug signals.
                    </p>
                  )
                ) : (
                  <>
                    {visualTab === "amplitudeEnvelope" ||
                      visualTab === "spectralCentroid" ||
                      visualTab === "spectralFlux" ||
                      visualTab === "onsetEnvelope" ||
                      visualTab === "cqtHarmonicEnergy" ||
                      visualTab === "cqtBassPitchMotion" ||
                      visualTab === "cqtTonalStability" ? (
                      tabResult?.kind === "1d" && tabResult.fn === visualTab ? (
                        <>
                          <SignalViewer
                            signal={createContinuousSignal(tabResult.times, tabResult.values)}
                            viewport={viewport}
                            cursorTimeSec={mirroredCursorTimeSec}
                            onCursorTimeChange={setCursorTimeSec}
                            mode="filled"
                            color={{ stroke: "rgb(59, 130, 246)", fill: "rgba(59, 130, 246, 0.3)" }}
                            showBeatGrid={beatGridState.isVisible}
                            audioDuration={audioDuration ?? 0}
                          />
                          {/* Band MIR signals for relevant 1D tabs (STFT-based) */}
                          {hasBands && (visualTab === "amplitudeEnvelope" || visualTab === "onsetEnvelope" || visualTab === "spectralFlux" || visualTab === "spectralCentroid") && (
                            <div className="mt-2">
                              <BandMirSignalViewer
                                fn={visualTab === "amplitudeEnvelope" ? "bandAmplitudeEnvelope" : visualTab === "onsetEnvelope" ? "bandOnsetStrength" : visualTab === "spectralCentroid" ? "bandSpectralCentroid" : "bandSpectralFlux"}
                                viewport={viewport}
                                cursorTimeSec={mirroredCursorTimeSec}
                                onCursorTimeChange={setCursorTimeSec}
                                onWaveformsReadyChange={handleBandWaveformsReadyChange}
                                showBeatGrid={beatGridState.isVisible}
                                audioDuration={audioDuration ?? 0}
                              />
                              <BandEventViewer
                                fn="bandOnsetPeaks"
                                viewport={viewport}
                                cursorTimeSec={mirroredCursorTimeSec}
                                onCursorTimeChange={setCursorTimeSec}
                                showBeatGrid={beatGridState.isVisible}
                                audioDuration={audioDuration ?? 0}
                              />
                            </div>
                          )}
                          {/* Band MIR signals for CQT-based 1D tabs */}
                          {hasBands && (visualTab === "cqtHarmonicEnergy" || visualTab === "cqtBassPitchMotion" || visualTab === "cqtTonalStability") && (
                            <div className="mt-2">
                              <BandMirSignalViewer
                                fn={visualTab === "cqtHarmonicEnergy" ? "bandCqtHarmonicEnergy" : visualTab === "cqtBassPitchMotion" ? "bandCqtBassPitchMotion" : "bandCqtTonalStability"}
                                viewport={viewport}
                                cursorTimeSec={mirroredCursorTimeSec}
                                onCursorTimeChange={setCursorTimeSec}
                                onWaveformsReadyChange={handleBandWaveformsReadyChange}
                                showBeatGrid={beatGridState.isVisible}
                                audioDuration={audioDuration ?? 0}
                              />
                            </div>
                          )}
                        </>
                      ) : (
                        <p className="text-sm text-zinc-500">Run {visualTab} to view output.</p>
                      )
                    ) : null}

                    {visualTab === "onsetPeaks" ? (
                      tabResult?.kind === "events" && tabResult.fn === "onsetPeaks" ? (
                        <>
                          <SparseEventsViewer
                            events={tabResult.events}
                            viewport={viewport}
                            cursorTimeSec={mirroredCursorTimeSec}
                            onCursorTimeChange={setCursorTimeSec}
                            variant="onset"
                            showBeatGrid={beatGridState.isVisible}
                            audioDuration={audioDuration ?? 0}
                          />
                          {/* Band-scoped onset peaks */}
                          {hasBands && (
                            <div className="mt-2">
                              <BandEventViewer
                                fn="bandOnsetPeaks"
                                viewport={viewport}
                                cursorTimeSec={mirroredCursorTimeSec}
                                onCursorTimeChange={setCursorTimeSec}
                                showBeatGrid={beatGridState.isVisible}
                                audioDuration={audioDuration ?? 0}
                              />
                            </div>
                          )}
                        </>
                      ) : (
                        <p className="text-sm text-zinc-500">Run Onset Peaks to view output.</p>
                      )
                    ) : null}

                    {visualTab === "beatCandidates" ? (
                      tabResult?.kind === "events" && tabResult.fn === "beatCandidates" ? (
                        <>
                          <div className="relative">
                            <SparseEventsViewer
                              events={tabResult.events}
                              viewport={viewport}
                              cursorTimeSec={mirroredCursorTimeSec}
                              onCursorTimeChange={setCursorTimeSec}
                              variant="beatCandidate"
                              showBeatGrid={beatGridState.isVisible}
                              audioDuration={audioDuration ?? 0}
                            />
                            <BeatGridOverlay
                              viewport={viewport}
                              beatGrid={beatGridState.activeBeatGrid}
                              audioDuration={audioDuration ?? 0}
                              isVisible={beatGridState.isVisible}
                              musicalTimeSegments={musicalTimeStructure?.segments ?? []}
                              selectedSegmentId={musicalTimeSelectedSegmentId}
                            />
                          </div>
                          {/* Band-scoped beat candidates */}
                          {hasBands && (
                            <div className="mt-2">
                              <BandEventViewer
                                fn="bandBeatCandidates"
                                viewport={viewport}
                                cursorTimeSec={mirroredCursorTimeSec}
                                onCursorTimeChange={setCursorTimeSec}
                                showBeatGrid={beatGridState.isVisible}
                                audioDuration={audioDuration ?? 0}
                              />
                            </div>
                          )}
                        </>
                      ) : (
                        <p className="text-sm text-zinc-500">Run Beat Candidates to view output.</p>
                      )
                    ) : null}

                    {visualTab === "tempoHypotheses" ? (
                      <>
                        {tabResult?.kind === "tempoHypotheses" && tabResult.fn === "tempoHypotheses" ? (
                          <TempoHypothesesViewer
                            hypotheses={tabResult.hypotheses}
                            manualHypotheses={manualHypotheses}
                            inputCandidateCount={tabResult.inputCandidateCount}
                            selectedHypothesisId={beatGridState.selectedHypothesis?.id ?? null}
                            onHypothesisSelect={selectBeatGridHypothesis}
                            beatGrid={
                              beatGridState.selectedHypothesis
                                ? {
                                  isVisible: beatGridState.isVisible,
                                  isLocked: beatGridState.isLocked,
                                  phaseHypotheses: beatGridState.phaseHypotheses,
                                  activePhaseIndex: beatGridState.activePhaseIndex,
                                  userNudge: beatGridState.userNudge,
                                  bpm: beatGridState.selectedHypothesis.bpm,
                                  phaseOffset: beatGridState.phaseHypotheses[beatGridState.activePhaseIndex]?.phaseOffset ?? 0,
                                  metronomeEnabled: beatGridState.metronomeEnabled,
                                }
                                : null
                            }
                            playheadTimeSec={playheadTimeSec}
                            isPlaying={isAudioPlaying}
                            onToggleVisibility={toggleBeatGridVisibility}
                            onCyclePhase={cyclePhase}
                            onNudge={nudgePhase}
                            onResetNudge={resetNudge}
                            onToggleLock={() => setBeatGridLocked(!beatGridState.isLocked)}
                            onToggleMetronome={toggleMetronome}
                            // Manual tempo controls
                            onCreateManualHypothesis={handleCreateManualHypothesis}
                            onDuplicateHypothesis={handleDuplicateHypothesis}
                            onUpdateHypothesisBpm={handleUpdateHypothesisBpm}
                            onDeleteHypothesis={handleDeleteManualHypothesis}
                            onRecordTap={handleRecordTap}
                            // Beat marking
                            beatMarkingActive={beatMarkingActive}
                            onStartBeatMarking={startBeatMarking}
                            // Musical Time (B4)
                            canPromote={canPromoteBeatGrid()}
                            audioDuration={audioDuration}
                            musicalTimeSegmentCount={musicalTimeStructure?.segments.length ?? 0}
                            onPromote={handlePromoteGrid}
                            // Signal viewer for visual correlation
                            viewport={viewport}
                            signalOptions={tempoSignalOptions}
                            selectedSignalId={tempoSignalId}
                            onSignalSelect={setTempoSignalId}
                            cursorTimeSec={mirroredCursorTimeSec}
                            onCursorTimeChange={setCursorTimeSec}
                          />
                        ) : (
                          <p className="text-sm text-zinc-500">Run Tempo Hypotheses to view output.</p>
                        )}
                        <MusicalTimePanel
                          structure={musicalTimeStructure}
                          selectedSegmentId={musicalTimeSelectedSegmentId}
                          audioDuration={audioDuration ?? 0}
                          onSelectSegment={selectMusicalTimeSegment}
                          onRemoveSegment={removeMusicalTimeSegment}
                          onSplitSegment={splitMusicalTimeSegmentAt}
                          onUpdateBoundary={updateMusicalTimeBoundary}
                          onClearAll={clearMusicalTime}
                        />
                      </>
                    ) : null}

                    {visualTab === "melSpectrogram" ||
                      visualTab === "hpssHarmonic" ||
                      visualTab === "hpssPercussive" ||
                      visualTab === "mfcc" ||
                      visualTab === "mfccDelta" ||
                      visualTab === "mfccDeltaDelta" ? (
                      tabResult?.kind === "2d" && tabResult.fn === visualTab ? (
                        <div
                          ref={heatmapHostRef}
                          onMouseMove={handleCursorHoverFromViewport}
                          onMouseLeave={handleCursorLeave}
                        >
                          <HeatmapWithBandOverlay
                            input={displayedHeatmap}
                            startTime={visibleRange.startTime}
                            endTime={visibleRange.endTime}
                            width={Math.floor(heatmapHostSize.width || 0)}
                            valueRange={heatmapValueRange}
                            yLabel={heatmapYAxisLabel}
                            colorScheme={heatmapScheme}
                            melConfig={{
                              nMels: 128,
                              fMin: 0,
                              fMax: audioSampleRate ? audioSampleRate / 2 : 22050,
                            }}
                            audioDuration={audioDuration}
                            beatGrid={beatGridState.activeBeatGrid}
                            beatGridVisible={beatGridState.isVisible}
                            musicalTimeSegments={musicalTimeStructure?.segments}
                            selectedSegmentId={musicalTimeSelectedSegmentId}
                            playheadTimeSec={mirroredCursorTimeSec ?? playheadTimeSec}
                          />
                        </div>
                      ) : (
                        <p className="text-sm text-zinc-500">Run {visualTab} to view output.</p>
                      )
                    ) : null}
                  </>
                )}
              </div>}
            </div>
            {visualTab === "search" && <SearchPanel playerRef={playerRef} />}
            <CustomSignalsPanel />
            <MeshAssetsPanel />
            <AuthoredEventsPanel />
            <VisualiserPanel
              audio={audio}
              playbackTime={playheadTimeSec}
              audioDuration={audioDuration}
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              mirResults={mirResults as any}
              searchSignal={searchSignal}
              isPlaying={isAudioPlaying}
              musicalTimeStructure={musicalTimeStructure}
            />

          </section>
          <MirConfigModal />
          <DebugPanel />
          <AudioReattachModal
            open={showAudioReattachModal}
            onOpenChange={setShowAudioReattachModal}
          />

          {/* Stem Confirmation Dialog */}
          <Modal
            title="Load Audio File"
            open={showStemConfirmDialog}
            onOpenChange={(open) => {
              if (!open) handleCancelAudioLoad();
            }}
          >
            <div className="space-y-4">
              <p className="text-sm text-zinc-600 dark:text-zinc-400">
                You have stems loaded. How would you like to handle them?
              </p>
              <div className="flex flex-col gap-2">
                <Button
                  variant="default"
                  onClick={handleConfirmKeepStems}
                  className="w-full justify-start"
                >
                  <span className="font-medium">Keep stems</span>
                  <span className="ml-2 text-xs opacity-70">
                    Load as new mixdown, keep stems for reference
                  </span>
                </Button>
                <Button
                  variant="outline"
                  onClick={handleConfirmClearStems}
                  className="w-full justify-start"
                >
                  <span className="font-medium">Clear stems</span>
                  <span className="ml-2 text-xs opacity-70">
                    Remove all stems, load as mixdown
                  </span>
                </Button>
                <Button
                  variant="ghost"
                  onClick={handleCancelAudioLoad}
                  className="w-full"
                >
                  Cancel
                </Button>
              </div>
            </div>
          </Modal>

        </main>
      </div>

      <footer className="shrink-0 flex items-center justify-center py-1 text-xs text-zinc-500 dark:text-zinc-400 divide-x-2 divide-zinc-300 dark:divide-zinc-700 border-t border-zinc-200 dark:border-zinc-800">
        <p className="px-3">vibe-assisted; use at your own risk</p>
        <a
          href="https://github.com/rewbs/octoseq"
          target="_blank"
          rel="noopener noreferrer"
          className="px-3 flex items-center gap-1 transition-colors hover:text-zinc-900 dark:hover:text-zinc-200"
        >
          <Github className="h-3 w-3" />
          code
        </a>
        <div className="px-3">
          <ThemeToggle />
        </div>
      </footer>
    </div>
  );
}
