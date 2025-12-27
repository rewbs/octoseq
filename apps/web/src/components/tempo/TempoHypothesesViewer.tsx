"use client";

import { useCallback, useState, useRef, useEffect, useMemo } from "react";
import { GripHorizontal, Plus, Copy, Trash2, Hand, MousePointerClick } from "lucide-react";
import type { TempoHypothesis, PhaseHypothesis } from "@octoseq/mir";
import type { ExtendedTempoHypothesis, TempoHypothesisSource } from "@/lib/stores/manualTempoStore";

/**
 * Compute beat meter value (1 at beat, decays to 0 over one beat period).
 * Returns value in [0, 1] range.
 */
function computeBeatMeterValue(
  playheadTimeSec: number,
  bpm: number,
  phaseOffset: number,
  userNudge: number
): number {
  if (bpm <= 0) return 0;
  const period = 60 / bpm;
  const effectivePhase = phaseOffset + userNudge;
  // Time since last beat
  const timeSincePhase = playheadTimeSec - effectivePhase;
  const beatPosition = ((timeSincePhase % period) + period) % period; // Always positive
  const fractionThroughBeat = beatPosition / period;
  // Decay from 1 to 0 over the beat period (exponential decay for snappier feel)
  return Math.exp(-fractionThroughBeat * 4);
}

const MIN_HEIGHT = 100;
const MAX_HEIGHT = 600;
const DEFAULT_HEIGHT = 300;

/** Beat grid state passed to the viewer for controls display. */
export type BeatGridControlState = {
  isVisible: boolean;
  isLocked: boolean;
  phaseHypotheses: PhaseHypothesis[];
  activePhaseIndex: number;
  userNudge: number;
  bpm: number;
  phaseOffset: number;
  metronomeEnabled: boolean;
};

/** Combined hypothesis type that can be either algorithmic or manual/edited */
export type DisplayableHypothesis = TempoHypothesis & {
  source?: TempoHypothesisSource;
  sourceHypothesisId?: string;
};

export type TempoHypothesesViewerProps = {
  hypotheses: TempoHypothesis[];
  /** Manual/edited hypotheses from the manual tempo store */
  manualHypotheses?: ExtendedTempoHypothesis[];
  inputCandidateCount: number;
  onHypothesisSelect?: (hypothesis: TempoHypothesis) => void;
  selectedHypothesisId?: string | null;
  /** Beat grid state for controls (only shown when a hypothesis is selected). */
  beatGrid?: BeatGridControlState | null;
  /** Current playhead time in seconds (for beat meter animation). */
  playheadTimeSec?: number;
  /** Whether audio is currently playing. */
  isPlaying?: boolean;
  /** Callbacks for beat grid controls. */
  onToggleVisibility?: () => void;
  onCyclePhase?: (direction: 1 | -1) => void;
  onNudge?: (deltaSec: number) => void;
  onResetNudge?: () => void;
  onToggleLock?: () => void;
  onToggleMetronome?: () => void;
  // --- Manual Tempo Controls ---
  /** Callback to create a manual tempo hypothesis */
  onCreateManualHypothesis?: (bpm: number) => void;
  /** Callback to duplicate a hypothesis for editing */
  onDuplicateHypothesis?: (hypothesis: TempoHypothesis) => void;
  /** Callback to update a manual/edited hypothesis BPM */
  onUpdateHypothesisBpm?: (hypothesisId: string, newBpm: number) => void;
  /** Callback to delete a manual/edited hypothesis */
  onDeleteHypothesis?: (hypothesisId: string) => void;
  /** Callback for tap-to-nudge (returns suggested BPM or null) */
  onRecordTap?: (currentBpm: number) => number | null;
  // --- Beat Marking ---
  /** Whether beat marking mode is active */
  beatMarkingActive?: boolean;
  /** Callback to start beat marking mode */
  onStartBeatMarking?: () => void;
  // --- Musical Time (B4) ---
  /** Whether the current grid can be promoted. */
  canPromote?: boolean;
  /** Audio duration in seconds (for full-track promotion). */
  audioDuration?: number;
  /** Number of existing musical time segments. */
  musicalTimeSegmentCount?: number;
  /** Callback when user promotes the grid to musical time. */
  onPromote?: (startTime: number, endTime: number) => void;
};

/**
 * Generate a consistent hue from a string ID.
 */
function familyIdToHue(familyId: string): number {
  let hash = 0;
  for (let i = 0; i < familyId.length; i++) {
    hash = ((hash << 5) - hash) + familyId.charCodeAt(i);
    hash = hash & hash;
  }
  return Math.abs(hash) % 360;
}

/**
 * Format harmonic ratio as human-readable label.
 */
function formatHarmonicRatio(ratio: number): string {
  if (ratio === 1.0) return "root";
  if (ratio === 2.0) return "2x";
  if (ratio === 0.5) return "1/2";
  if (ratio === 3.0) return "3x";
  if (ratio === 1.5) return "3/2";
  if (Math.abs(ratio - 1 / 3) < 0.01) return "1/3";
  if (Math.abs(ratio - 2 / 3) < 0.01) return "2/3";
  return `${ratio.toFixed(2)}x`;
}

/**
 * Get source label and styling for a hypothesis.
 */
function getSourceDisplay(source?: TempoHypothesisSource): {
  label: string;
  className: string;
} {
  switch (source) {
    case "manual":
      return {
        label: "manual",
        className: "bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300",
      };
    case "edited":
      return {
        label: "edited",
        className: "bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300",
      };
    default:
      return {
        label: "algorithmic",
        className: "bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400",
      };
  }
}

/**
 * Visual viewer for tempo hypotheses.
 * Displays a list of BPM hypotheses with confidence bars and harmonic family groupings.
 * Supports manual tempo entry, editing, and tap-to-nudge interactions.
 */
export function TempoHypothesesViewer({
  hypotheses,
  manualHypotheses = [],
  inputCandidateCount,
  onHypothesisSelect,
  selectedHypothesisId,
  beatGrid,
  playheadTimeSec,
  isPlaying,
  onToggleVisibility,
  onCyclePhase,
  onNudge,
  onResetNudge,
  onToggleLock,
  onToggleMetronome,
  // Manual tempo controls
  onCreateManualHypothesis,
  onDuplicateHypothesis,
  onUpdateHypothesisBpm,
  onDeleteHypothesis,
  onRecordTap,
  // Beat marking
  beatMarkingActive,
  onStartBeatMarking,
  // Musical Time (B4)
  canPromote,
  audioDuration,
  musicalTimeSegmentCount,
  onPromote,
}: TempoHypothesesViewerProps) {
  // Manual BPM input state
  const [manualBpmInput, setManualBpmInput] = useState("");
  const [isEditingBpm, setIsEditingBpm] = useState(false);
  const [editBpmValue, setEditBpmValue] = useState("");

  // Track which families have been manually collapsed
  const [collapsedFamilies, setCollapsedFamilies] = useState<Set<string>>(new Set());

  // Resizable height state
  const [panelHeight, setPanelHeight] = useState(DEFAULT_HEIGHT);
  const isResizingRef = useRef(false);
  const startYRef = useRef(0);
  const startHeightRef = useRef(0);

  // Tap-to-nudge state
  const [isTapping, setIsTapping] = useState(false);
  const tapTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Combine algorithmic and manual hypotheses
  const allHypotheses = useMemo((): DisplayableHypothesis[] => {
    // Add source: "algorithmic" to base hypotheses
    const algorithmic: DisplayableHypothesis[] = hypotheses.map((h) => ({
      ...h,
      source: "algorithmic" as const,
    }));
    // Manual hypotheses already have source
    return [...algorithmic, ...manualHypotheses];
  }, [hypotheses, manualHypotheses]);

  // Find selected hypothesis from combined list
  const selectedHypothesis = useMemo(() => {
    return allHypotheses.find((h) => h.id === selectedHypothesisId) ?? null;
  }, [allHypotheses, selectedHypothesisId]);

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isResizingRef.current = true;
    startYRef.current = e.clientY;
    startHeightRef.current = panelHeight;
    document.body.style.cursor = 'ns-resize';
    document.body.style.userSelect = 'none';
  }, [panelHeight]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
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

  // Check if a family is expanded (all families expanded by default unless manually collapsed)
  const isFamilyExpanded = useCallback((familyId: string) => {
    return !collapsedFamilies.has(familyId);
  }, [collapsedFamilies]);

  const toggleFamily = useCallback((familyId: string) => {
    setCollapsedFamilies((prev) => {
      const next = new Set(prev);
      if (next.has(familyId)) {
        next.delete(familyId);
      } else {
        next.add(familyId);
      }
      return next;
    });
  }, []);

  // Handle manual BPM submission
  const handleManualBpmSubmit = useCallback(() => {
    const bpm = parseFloat(manualBpmInput);
    if (isNaN(bpm) || bpm < 20 || bpm > 400) {
      return;
    }
    onCreateManualHypothesis?.(bpm);
    setManualBpmInput("");
  }, [manualBpmInput, onCreateManualHypothesis]);

  // Handle BPM adjustment (fine/coarse)
  const handleBpmAdjust = useCallback((delta: number) => {
    if (!selectedHypothesis) return;

    // If it's a manual/edited hypothesis, update it directly
    if (selectedHypothesis.source === "manual" || selectedHypothesis.source === "edited") {
      const newBpm = Math.max(20, Math.min(400, selectedHypothesis.bpm + delta));
      onUpdateHypothesisBpm?.(selectedHypothesis.id, newBpm);
    } else {
      // For algorithmic hypotheses, duplicate first then adjust on next interaction
      onDuplicateHypothesis?.(selectedHypothesis);
    }
  }, [selectedHypothesis, onUpdateHypothesisBpm, onDuplicateHypothesis]);

  // Handle tap-to-nudge
  const handleTap = useCallback(() => {
    if (!selectedHypothesis || !onRecordTap) return;

    setIsTapping(true);

    // Clear previous timeout
    if (tapTimeoutRef.current) {
      clearTimeout(tapTimeoutRef.current);
    }

    // Get suggested BPM from tap
    const suggestedBpm = onRecordTap(selectedHypothesis.bpm);

    if (suggestedBpm !== null) {
      // If it's a manual/edited hypothesis, update it
      if (selectedHypothesis.source === "manual" || selectedHypothesis.source === "edited") {
        onUpdateHypothesisBpm?.(selectedHypothesis.id, suggestedBpm);
      }
      // For algorithmic, we'd need to duplicate first - skip for now
    }

    // Reset tapping state after delay
    tapTimeoutRef.current = setTimeout(() => {
      setIsTapping(false);
    }, 200);
  }, [selectedHypothesis, onRecordTap, onUpdateHypothesisBpm]);

  // Handle inline BPM editing
  const handleStartEditBpm = useCallback(() => {
    if (!selectedHypothesis) return;
    setEditBpmValue(selectedHypothesis.bpm.toFixed(1));
    setIsEditingBpm(true);
  }, [selectedHypothesis]);

  const handleFinishEditBpm = useCallback(() => {
    if (!selectedHypothesis) return;

    const newBpm = parseFloat(editBpmValue);
    if (!isNaN(newBpm) && newBpm >= 20 && newBpm <= 400) {
      if (selectedHypothesis.source === "manual" || selectedHypothesis.source === "edited") {
        onUpdateHypothesisBpm?.(selectedHypothesis.id, newBpm);
      }
    }
    setIsEditingBpm(false);
  }, [selectedHypothesis, editBpmValue, onUpdateHypothesisBpm]);

  // Group hypotheses by family
  const familyGroups = useMemo(() => {
    const groups = new Map<string, DisplayableHypothesis[]>();
    for (const h of allHypotheses) {
      const group = groups.get(h.familyId) ?? [];
      group.push(h);
      groups.set(h.familyId, group);
    }
    return groups;
  }, [allHypotheses]);

  // Sort families by highest confidence member
  const sortedFamilies = useMemo(() => {
    return Array.from(familyGroups.entries()).sort((a, b) => {
      const maxA = Math.max(...a[1].map((h) => h.confidence));
      const maxB = Math.max(...b[1].map((h) => h.confidence));
      return maxB - maxA;
    });
  }, [familyGroups]);

  // Compute beat meter value for visual feedback during playback
  const beatMeterValue = useMemo(() => {
    if (!beatGrid || !isPlaying || playheadTimeSec === undefined) return 0;
    return computeBeatMeterValue(
      playheadTimeSec,
      beatGrid.bpm,
      beatGrid.phaseOffset,
      beatGrid.userNudge
    );
  }, [beatGrid, isPlaying, playheadTimeSec]);

  // Cleanup tap timeout on unmount
  useEffect(() => {
    return () => {
      if (tapTimeoutRef.current) {
        clearTimeout(tapTimeoutRef.current);
      }
    };
  }, []);

  return (
    <div className="rounded-md border border-zinc-200 dark:border-zinc-800">
      {/* Manual BPM Input Section */}
      <div className="p-2 border-b border-zinc-200 dark:border-zinc-700 bg-zinc-50/50 dark:bg-zinc-800/50">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-zinc-500 dark:text-zinc-400">Manual tempo:</span>
          <input
            type="number"
            min={20}
            max={400}
            step={0.1}
            value={manualBpmInput}
            onChange={(e) => setManualBpmInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                handleManualBpmSubmit();
              }
            }}
            placeholder="e.g. 120"
            className="w-24 px-2 py-1 text-sm rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-900 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          <span className="text-xs text-zinc-400">BPM</span>
          <button
            type="button"
            onClick={handleManualBpmSubmit}
            disabled={!manualBpmInput || parseFloat(manualBpmInput) < 20 || parseFloat(manualBpmInput) > 400}
            className="px-2 py-1 text-xs rounded bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-1"
          >
            <Plus className="w-3 h-3" />
            Add
          </button>

          {/* Divider */}
          <div className="h-4 w-px bg-zinc-300 dark:bg-zinc-600 mx-1" />

          {/* Mark Beats button */}
          {onStartBeatMarking && (
            <button
              type="button"
              onClick={onStartBeatMarking}
              disabled={beatMarkingActive}
              className={`px-2 py-1 text-xs rounded transition-colors flex items-center gap-1 ${beatMarkingActive
                  ? "bg-blue-600 text-white"
                  : "bg-blue-100 dark:bg-blue-900/30 hover:bg-blue-200 dark:hover:bg-blue-900/50 text-blue-700 dark:text-blue-300"
                }`}
              title="Click two beats on the waveform to set tempo"
            >
              <MousePointerClick className="w-3 h-3" />
              {beatMarkingActive ? "Marking..." : "Mark Beats"}
            </button>
          )}
        </div>
      </div>

      <div
        className="p-2 space-y-3 overflow-y-auto"
        style={{ height: panelHeight }}
      >
        <div className="text-xs text-zinc-500 dark:text-zinc-400">
          {allHypotheses.length} hypotheses ({hypotheses.length} algorithmic, {manualHypotheses.length} manual/edited) from {inputCandidateCount} beat candidates
        </div>

        {allHypotheses.length === 0 ? (
          <div className="p-4 text-sm text-zinc-500 dark:text-zinc-400">
            No tempo hypotheses found. Enter a manual tempo above or run analysis
            with audio that has clear rhythmic content.
          </div>
        ) : (
          sortedFamilies.map(([familyId, members]) => {
            const isExpanded = isFamilyExpanded(familyId);
            const hue = familyIdToHue(familyId);
            const familyColor = `hsl(${hue}, 60%, 50%)`;
            const rootHyp = members.find((h) => h.harmonicRatio === 1.0) ?? members[0]!;

            return (
              <div
                key={familyId}
                className="rounded-md border border-zinc-200 dark:border-zinc-700 overflow-hidden"
              >
                {/* Family header */}
                <button
                  type="button"
                  className="flex items-center gap-2 px-3 py-2 bg-zinc-50 dark:bg-zinc-800 cursor-pointer w-full text-left hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors"
                  onClick={() => toggleFamily(familyId)}
                >
                  <div
                    className="w-3 h-3 rounded-full shrink-0"
                    style={{ backgroundColor: familyColor }}
                  />
                  <span className="font-medium text-sm">
                    ~{rootHyp.bpm.toFixed(1)} BPM family
                  </span>
                  <span className="text-xs text-zinc-500 ml-auto">
                    {members.length} hypothesis{members.length > 1 ? "es" : ""}
                  </span>
                  <span className="text-xs text-zinc-400">
                    {isExpanded ? "\u25BC" : "\u25B6"}
                  </span>
                </button>

                {/* Family members */}
                {isExpanded && (
                  <div className="divide-y divide-zinc-100 dark:divide-zinc-700">
                    {members
                      .sort((a, b) => b.confidence - a.confidence)
                      .map((hyp) => {
                        const sourceDisplay = getSourceDisplay(hyp.source);
                        const isSelected = selectedHypothesisId === hyp.id;
                        const canDelete = hyp.source === "manual" || hyp.source === "edited";

                        return (
                          <div
                            key={hyp.id}
                            className={`px-3 py-2 transition-colors ${isSelected
                              ? "bg-blue-50 dark:bg-blue-900/30"
                              : "hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
                              }`}
                          >
                            <button
                              type="button"
                              className="w-full text-left"
                              onClick={() => onHypothesisSelect?.(hyp)}
                            >
                              <div className="flex items-center gap-3">
                                {/* BPM value */}
                                <div className="font-mono text-lg font-semibold w-20 text-right">
                                  {hyp.bpm.toFixed(1)}
                                </div>
                                <span className="text-xs text-zinc-500">BPM</span>

                                {/* Source badge */}
                                <span
                                  className={`text-xs px-1.5 py-0.5 rounded ${sourceDisplay.className}`}
                                >
                                  {sourceDisplay.label}
                                </span>

                                {/* Harmonic ratio badge */}
                                <span
                                  className="text-xs px-1.5 py-0.5 rounded"
                                  style={{
                                    backgroundColor: `${familyColor}20`,
                                    color: familyColor,
                                  }}
                                >
                                  {formatHarmonicRatio(hyp.harmonicRatio)}
                                </span>

                                {/* Confidence bar */}
                                <div className="flex-1 ml-2">
                                  <div className="h-4 bg-zinc-200 dark:bg-zinc-700 rounded overflow-hidden">
                                    <div
                                      className="h-full transition-all"
                                      style={{
                                        width: `${hyp.confidence * 100}%`,
                                        backgroundColor: familyColor,
                                        opacity: 0.7 + 0.3 * hyp.confidence,
                                      }}
                                    />
                                  </div>
                                </div>

                                {/* Confidence value */}
                                <span className="text-xs text-zinc-500 w-12 text-right">
                                  {(hyp.confidence * 100).toFixed(0)}%
                                </span>
                              </div>

                              {/* Evidence details */}
                              {hyp.source === "algorithmic" && (
                                <div className="mt-1 text-xs text-zinc-400 flex gap-4">
                                  <span>
                                    {hyp.evidence.supportingIntervalCount} intervals
                                  </span>
                                  <span>
                                    {hyp.evidence.binRange[0].toFixed(0)}-
                                    {hyp.evidence.binRange[1].toFixed(0)} BPM range
                                  </span>
                                </div>
                              )}
                            </button>

                            {/* Action buttons */}
                            <div className="mt-1 flex items-center gap-2">
                              {/* Duplicate button for algorithmic hypotheses */}
                              {hyp.source === "algorithmic" && onDuplicateHypothesis && (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    onDuplicateHypothesis(hyp);
                                  }}
                                  className="px-2 py-0.5 text-xs rounded bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-600 dark:text-zinc-400 transition-colors flex items-center gap-1"
                                  title="Duplicate for editing"
                                >
                                  <Copy className="w-3 h-3" />
                                  Edit copy
                                </button>
                              )}

                              {/* Delete button for manual/edited */}
                              {canDelete && onDeleteHypothesis && (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    onDeleteHypothesis(hyp.id);
                                  }}
                                  className="px-2 py-0.5 text-xs rounded bg-red-100 dark:bg-red-900/30 hover:bg-red-200 dark:hover:bg-red-900/50 text-red-600 dark:text-red-400 transition-colors flex items-center gap-1"
                                  title="Delete hypothesis"
                                >
                                  <Trash2 className="w-3 h-3" />
                                  Delete
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Beat Grid Controls - shown when a hypothesis is selected */}
      {selectedHypothesisId && beatGrid && (
        <div className="border-t border-zinc-200 dark:border-zinc-700 p-3 space-y-2 bg-zinc-50/50 dark:bg-zinc-800/50">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Beat Grid</span>
            <div className="flex items-center gap-2">
              {/* Beat meter and metronome */}
              <div className="flex items-center gap-3 pt-1">
                {/* Visual beat meter */}
                <div className="flex items-end gap-1 h-4">
                  <div
                    className="w-3 bg-linear-to-t from-orange-500 to-yellow-400 rounded-t transition-all duration-75"
                    style={{
                      height: `${beatMeterValue * 300}%`,
                      opacity: isPlaying ? 1 : 0.3,
                    }}
                  />
                </div>

                {/* Metronome checkbox */}
                <label className="flex items-center gap-1.5 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={beatGrid.metronomeEnabled}
                    onChange={onToggleMetronome}
                    className="w-3.5 h-3.5 rounded border-zinc-300 dark:border-zinc-600 text-orange-500 focus:ring-orange-500 focus:ring-offset-0"
                  />
                  <span className="text-xs text-zinc-600 dark:text-zinc-400">Metronome</span>
                </label>
              </div>
              <button
                type="button"
                onClick={onToggleVisibility}
                className={`px-2 py-1 text-xs rounded transition-colors ${beatGrid.isVisible
                  ? "bg-zinc-200 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-300"
                  : "bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-500"
                  }`}
              >
                {beatGrid.isVisible ? "Visible" : "Hidden"}
              </button>
              <button
                type="button"
                onClick={onToggleLock}
                className={`px-2 py-1 text-xs rounded transition-colors ${beatGrid.isLocked
                  ? "bg-green-200 dark:bg-green-800/50 text-green-800 dark:text-green-200"
                  : "bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300"
                  }`}
              >
                {beatGrid.isLocked ? "Locked" : "Provisional"}
              </button>
            </div>
          </div>

          {/* BPM Adjustment Controls */}
          {selectedHypothesis && (selectedHypothesis.source === "manual" || selectedHypothesis.source === "edited") && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-zinc-500 dark:text-zinc-400 w-12">Tempo:</span>
              <button
                type="button"
                onClick={() => handleBpmAdjust(-1)}
                className="px-2 py-0.5 text-xs bg-zinc-100 dark:bg-zinc-800 rounded hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
              >
                -1
              </button>
              <button
                type="button"
                onClick={() => handleBpmAdjust(-0.1)}
                className="px-2 py-0.5 text-xs bg-zinc-100 dark:bg-zinc-800 rounded hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
              >
                -0.1
              </button>
              {isEditingBpm ? (
                <input
                  type="number"
                  value={editBpmValue}
                  onChange={(e) => setEditBpmValue(e.target.value)}
                  onBlur={handleFinishEditBpm}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      handleFinishEditBpm();
                    } else if (e.key === "Escape") {
                      setIsEditingBpm(false);
                    }
                  }}
                  className="w-20 px-1 py-0.5 text-xs font-mono text-center rounded border border-blue-500 focus:outline-none"
                  autoFocus
                />
              ) : (
                <button
                  type="button"
                  onClick={handleStartEditBpm}
                  className="w-20 px-1 py-0.5 text-xs font-mono text-center text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded transition-colors"
                  title="Click to edit"
                >
                  {selectedHypothesis.bpm.toFixed(1)} BPM
                </button>
              )}
              <button
                type="button"
                onClick={() => handleBpmAdjust(0.1)}
                className="px-2 py-0.5 text-xs bg-zinc-100 dark:bg-zinc-800 rounded hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
              >
                +0.1
              </button>
              <button
                type="button"
                onClick={() => handleBpmAdjust(1)}
                className="px-2 py-0.5 text-xs bg-zinc-100 dark:bg-zinc-800 rounded hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
              >
                +1
              </button>

              {/* Tap-to-nudge button */}
              {onRecordTap && (
                <button
                  type="button"
                  onClick={handleTap}
                  className={`ml-2 px-3 py-1 text-xs rounded transition-all flex items-center gap-1 ${isTapping
                      ? "bg-orange-500 text-white scale-95"
                      : "bg-orange-100 dark:bg-orange-900/30 hover:bg-orange-200 dark:hover:bg-orange-900/50 text-orange-700 dark:text-orange-300"
                    }`}
                  title="Tap in time with the music to nudge the BPM"
                >
                  <Hand className="w-3 h-3" />
                  Tap
                </button>
              )}
            </div>
          )}

          {/* Phase cycling controls */}
          {beatGrid.phaseHypotheses.length > 1 && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-zinc-500 dark:text-zinc-400 w-12">Phase:</span>
              <button
                type="button"
                onClick={() => onCyclePhase?.(-1)}
                className="px-2 py-0.5 text-xs bg-zinc-100 dark:bg-zinc-800 rounded hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
              >
                Prev
              </button>
              <span className="text-xs font-mono text-zinc-600 dark:text-zinc-400 w-10 text-center">
                {beatGrid.activePhaseIndex + 1}/{beatGrid.phaseHypotheses.length}
              </span>
              <button
                type="button"
                onClick={() => onCyclePhase?.(1)}
                className="px-2 py-0.5 text-xs bg-zinc-100 dark:bg-zinc-800 rounded hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
              >
                Next
              </button>
              <span className="text-xs text-zinc-400 dark:text-zinc-500 ml-2">
                (score: {(beatGrid.phaseHypotheses[beatGrid.activePhaseIndex]?.score ?? 0).toFixed(2)})
              </span>
            </div>
          )}

          {/* Nudge controls */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-zinc-500 dark:text-zinc-400 w-12">Nudge:</span>
            <button
              type="button"
              onClick={() => onNudge?.(-0.01)}
              className="px-2 py-0.5 text-xs bg-zinc-100 dark:bg-zinc-800 rounded hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
            >
              -10ms
            </button>
            <button
              type="button"
              onClick={() => onNudge?.(-0.001)}
              className="px-2 py-0.5 text-xs bg-zinc-100 dark:bg-zinc-800 rounded hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
            >
              -1ms
            </button>
            <span className="text-xs font-mono text-zinc-600 dark:text-zinc-400 w-16 text-center">
              {(beatGrid.userNudge * 1000).toFixed(1)}ms
            </span>
            <button
              type="button"
              onClick={() => onNudge?.(0.001)}
              className="px-2 py-0.5 text-xs bg-zinc-100 dark:bg-zinc-800 rounded hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
            >
              +1ms
            </button>
            <button
              type="button"
              onClick={() => onNudge?.(0.01)}
              className="px-2 py-0.5 text-xs bg-zinc-100 dark:bg-zinc-800 rounded hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
            >
              +10ms
            </button>
            {beatGrid.userNudge !== 0 && (
              <button
                type="button"
                onClick={onResetNudge}
                className="px-2 py-0.5 text-xs text-red-500 hover:text-red-600 hover:underline transition-colors"
              >
                Reset
              </button>
            )}
          </div>

          {/* Musical Time Promotion (B4) */}
          <div className="pt-2 mt-2 border-t border-zinc-200 dark:border-zinc-700">
            <div className="flex items-center justify-between">
              <div className="text-xs text-zinc-500 dark:text-zinc-400">
                {musicalTimeSegmentCount !== undefined && musicalTimeSegmentCount > 0 ? (
                  <span>{musicalTimeSegmentCount} segment{musicalTimeSegmentCount !== 1 ? "s" : ""} authored</span>
                ) : (
                  <span>No musical time authored yet</span>
                )}
              </div>
              <button
                type="button"
                disabled={!canPromote}
                onClick={() => {
                  if (audioDuration !== undefined && onPromote) {
                    onPromote(0, audioDuration);
                  }
                }}
                className={`px-3 py-1.5 text-xs font-medium rounded transition-colors ${canPromote
                    ? "bg-blue-600 hover:bg-blue-700 text-white"
                    : "bg-zinc-200 dark:bg-zinc-700 text-zinc-400 dark:text-zinc-500 cursor-not-allowed"
                  }`}
                title={
                  canPromote
                    ? "Promote this locked grid to authoritative musical time"
                    : "Lock the grid first to enable promotion"
                }
              >
                Promote to Musical Time
              </button>
            </div>
            {!canPromote && beatGrid.isLocked === false && (
              <div className="mt-1 text-xs text-amber-600 dark:text-amber-400">
                Lock the grid to enable promotion
              </div>
            )}
          </div>
        </div>
      )}

      {/* Resize Handle */}
      <div
        onMouseDown={handleResizeStart}
        className="flex items-center justify-center h-2 cursor-ns-resize hover:bg-zinc-200/50 dark:hover:bg-zinc-700/50 transition-colors group border-t border-zinc-200 dark:border-zinc-800"
      >
        <GripHorizontal className="w-5 h-2 text-zinc-400 group-hover:text-zinc-600 dark:text-zinc-600 dark:group-hover:text-zinc-400" />
      </div>
    </div>
  );
}
