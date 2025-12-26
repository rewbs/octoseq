"use client";

import { useCallback, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import {
    ChevronLeft,
    ChevronRight,
    ChevronDown,
    Plus,
    Trash2,
    Volume2,
    VolumeX,
    Eye,
    EyeOff,
    Headphones,
    Magnet,
    Sparkles,
    Check,
    X,
    Loader2,
    Info,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useFrequencyBandStore } from "@/lib/stores/frequencyBandStore";
import { useBandProposalStore } from "@/lib/stores/bandProposalStore";
import { useBandProposalActions } from "@/lib/stores/hooks/useBandProposalActions";
import { createConstantBand, type FrequencyBand, type BandProposal } from "@octoseq/mir";
import { KeyframeTable } from "./KeyframeTable";
import { useBandKeyboardShortcuts } from "@/lib/hooks/useBandKeyboardShortcuts";

// ----------------------------
// Types
// ----------------------------

type BandListItemProps = {
    bandId: string;
    label: string;
    enabled: boolean;
    isSelected: boolean;
    isSoloed: boolean;
    isMuted: boolean;
    colorIndex: number;
    onSelect: () => void;
    onRename: (newLabel: string) => void;
    onToggleEnabled: () => void;
    onToggleSolo: () => void;
    onToggleMute: () => void;
    onDelete: () => void;
};

// ----------------------------
// Constants
// ----------------------------

const BAND_COLORS = [
    "bg-blue-500",
    "bg-green-500",
    "bg-orange-500",
    "bg-purple-500",
    "bg-pink-500",
    "bg-teal-500",
];

// ----------------------------
// BandListItem Component
// ----------------------------

function BandListItem({
    bandId,
    label,
    enabled,
    isSelected,
    isSoloed,
    isMuted,
    colorIndex,
    onSelect,
    onRename,
    onToggleEnabled,
    onToggleSolo,
    onToggleMute,
    onDelete,
}: BandListItemProps) {
    const [isEditing, setIsEditing] = useState(false);
    const [editValue, setEditValue] = useState(label);

    const handleDoubleClick = () => {
        setEditValue(label);
        setIsEditing(true);
    };

    const handleBlur = () => {
        setIsEditing(false);
        if (editValue.trim() && editValue !== label) {
            onRename(editValue.trim());
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === "Enter") {
            handleBlur();
        } else if (e.key === "Escape") {
            setEditValue(label);
            setIsEditing(false);
        }
    };

    const colorClass = BAND_COLORS[colorIndex % BAND_COLORS.length];

    return (
        <div
            className={cn(
                "group flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer transition-colors",
                isSelected
                    ? "bg-zinc-200 dark:bg-zinc-700"
                    : "hover:bg-zinc-100 dark:hover:bg-zinc-800",
                !enabled && "opacity-50"
            )}
            onClick={onSelect}
        >
            {/* Color indicator */}
            <div className={cn("w-3 h-3 rounded-full shrink-0", colorClass)} />

            {/* Label */}
            <div className="flex-1 min-w-0">
                {isEditing ? (
                    <input
                        type="text"
                        value={editValue}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEditValue(e.target.value)}
                        onBlur={handleBlur}
                        onKeyDown={handleKeyDown}
                        className="h-6 py-0 px-1 text-sm w-full rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800"
                        autoFocus
                        onClick={(e: React.MouseEvent<HTMLInputElement>) => e.stopPropagation()}
                    />
                ) : (
                    <span
                        className="text-sm truncate block"
                        onDoubleClick={(e: React.MouseEvent<HTMLSpanElement>) => {
                            e.stopPropagation();
                            handleDoubleClick();
                        }}
                    >
                        {label}
                    </span>
                )}
            </div>

            {/* Controls (visible on hover or when active) */}
            <div
                className={cn(
                    "flex items-center gap-0.5",
                    "opacity-0 group-hover:opacity-100",
                    (isSelected || isSoloed || isMuted) && "opacity-100"
                )}
            >
                {/* Solo button */}
                <Button
                    variant="ghost"
                    size="icon"
                    className={cn(
                        "h-6 w-6",
                        isSoloed && "bg-yellow-500/20 text-yellow-600 dark:text-yellow-400"
                    )}
                    onClick={(e) => {
                        e.stopPropagation();
                        onToggleSolo();
                    }}
                    title="Solo (audition this band only)"
                >
                    <Headphones className="h-3.5 w-3.5" />
                </Button>

                {/* Mute button */}
                <Button
                    variant="ghost"
                    size="icon"
                    className={cn(
                        "h-6 w-6",
                        isMuted && "bg-red-500/20 text-red-600 dark:text-red-400"
                    )}
                    onClick={(e) => {
                        e.stopPropagation();
                        onToggleMute();
                    }}
                    title="Mute (hide from overlay)"
                >
                    {isMuted ? (
                        <VolumeX className="h-3.5 w-3.5" />
                    ) : (
                        <Volume2 className="h-3.5 w-3.5" />
                    )}
                </Button>

                {/* Enable/Disable button */}
                <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    onClick={(e) => {
                        e.stopPropagation();
                        onToggleEnabled();
                    }}
                    title={enabled ? "Disable band" : "Enable band"}
                >
                    {enabled ? (
                        <Eye className="h-3.5 w-3.5" />
                    ) : (
                        <EyeOff className="h-3.5 w-3.5" />
                    )}
                </Button>

                {/* Delete button */}
                <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 text-red-500 hover:text-red-600 hover:bg-red-500/10"
                    onClick={(e) => {
                        e.stopPropagation();
                        onDelete();
                    }}
                    title="Delete band"
                >
                    <Trash2 className="h-3.5 w-3.5" />
                </Button>
            </div>
        </div>
    );
}

// ----------------------------
// ProposalListItem Component
// ----------------------------

type ProposalListItemProps = {
    proposal: BandProposal;
    isInspected: boolean;
    onInspect: () => void;
    onPromote: () => void;
    onDismiss: () => void;
};

function ProposalListItem({
    proposal,
    isInspected,
    onInspect,
    onPromote,
    onDismiss,
}: ProposalListItemProps) {
    // Get frequency range from the band shape
    const firstSegment = proposal.band.frequencyShape[0];
    const lowHz = firstSegment?.lowHzStart ?? 0;
    const highHz = firstSegment?.highHzStart ?? 0;

    // Format frequency for display
    const formatHz = (hz: number) => {
        if (hz >= 1000) {
            return `${(hz / 1000).toFixed(1)}k`;
        }
        return `${Math.round(hz)}`;
    };

    return (
        <div
            className={cn(
                "group flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer transition-colors",
                isInspected
                    ? "bg-orange-100 dark:bg-orange-900/30 border border-orange-300 dark:border-orange-700"
                    : "hover:bg-zinc-100 dark:hover:bg-zinc-800 border border-transparent"
            )}
            onClick={onInspect}
        >
            {/* Salience indicator */}
            <div className="w-3 h-3 shrink-0 relative">
                <div className="absolute inset-0 rounded-full bg-orange-200 dark:bg-orange-900" />
                <div
                    className="absolute bottom-0 left-0 right-0 rounded-full bg-orange-500"
                    style={{ height: `${proposal.salience * 100}%` }}
                />
            </div>

            {/* Label and frequency range */}
            <div className="flex-1 min-w-0">
                <div className="text-sm truncate text-orange-700 dark:text-orange-300">
                    {formatHz(lowHz)} - {formatHz(highHz)} Hz
                </div>
                {isInspected && (
                    <div className="text-xs text-zinc-500 dark:text-zinc-400 truncate mt-0.5">
                        {proposal.reason}
                    </div>
                )}
            </div>

            {/* Action buttons */}
            <div
                className={cn(
                    "flex items-center gap-0.5",
                    "opacity-0 group-hover:opacity-100",
                    isInspected && "opacity-100"
                )}
            >
                {/* Promote button */}
                <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 text-green-600 hover:text-green-700 hover:bg-green-500/10"
                    onClick={(e) => {
                        e.stopPropagation();
                        onPromote();
                    }}
                    title="Promote to band"
                >
                    <Check className="h-3.5 w-3.5" />
                </Button>

                {/* Dismiss button */}
                <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 text-zinc-500 hover:text-zinc-600 hover:bg-zinc-500/10"
                    onClick={(e) => {
                        e.stopPropagation();
                        onDismiss();
                    }}
                    title="Dismiss proposal"
                >
                    <X className="h-3.5 w-3.5" />
                </Button>
            </div>
        </div>
    );
}

// ----------------------------
// FrequencyBandSidebar Component
// ----------------------------

export type FrequencyBandSidebarProps = {
    /** Audio duration for creating new bands. */
    audioDuration: number;
};

export function FrequencyBandSidebar({ audioDuration }: FrequencyBandSidebarProps) {
    const {
        structure,
        selectedBandId,
        sidebarOpen,
        soloedBandId,
        mutedBandIds,
        hoveredKeyframeTime,
        snapMode,
        toggleSidebar,
        selectBand,
        addBand,
        updateBand,
        removeBand,
        setBandEnabled,
        setSoloedBandId,
        toggleMuted,
        setHoveredKeyframeTime,
        setSnapMode,
        getBandById,
    } = useFrequencyBandStore(
        useShallow((s) => ({
            structure: s.structure,
            selectedBandId: s.selectedBandId,
            sidebarOpen: s.sidebarOpen,
            soloedBandId: s.soloedBandId,
            mutedBandIds: s.mutedBandIds,
            hoveredKeyframeTime: s.hoveredKeyframeTime,
            snapMode: s.snapMode,
            toggleSidebar: s.toggleSidebar,
            selectBand: s.selectBand,
            addBand: s.addBand,
            updateBand: s.updateBand,
            removeBand: s.removeBand,
            setBandEnabled: s.setBandEnabled,
            setSoloedBandId: s.setSoloedBandId,
            toggleMuted: s.toggleMuted,
            setHoveredKeyframeTime: s.setHoveredKeyframeTime,
            setSnapMode: s.setSnapMode,
            getBandById: s.getBandById,
        }))
    );

    // Band proposal state
    const {
        proposals,
        isComputing,
        error: proposalError,
        inspectedProposalId,
    } = useBandProposalStore(
        useShallow((s) => ({
            proposals: s.proposals,
            isComputing: s.isComputing,
            error: s.error,
            inspectedProposalId: s.inspectedProposalId,
        }))
    );

    // Band proposal actions
    const {
        computeProposals,
        promoteProposal,
        dismissProposal,
        inspectProposal,
    } = useBandProposalActions();

    const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
    const [discoverExpanded, setDiscoverExpanded] = useState(true);

    const handleAddBand = useCallback(() => {
        const bandCount = structure?.bands.length ?? 0;
        const newBand = createConstantBand(
            `Band ${bandCount + 1}`,
            200, // Default low Hz
            2000, // Default high Hz
            audioDuration,
            {
                sortOrder: bandCount,
            }
        );
        const newId = addBand(newBand);
        selectBand(newId);
    }, [structure, audioDuration, addBand, selectBand]);

    const handleDeleteBand = useCallback(
        (bandId: string) => {
            if (deleteConfirmId === bandId) {
                removeBand(bandId);
                setDeleteConfirmId(null);
                if (selectedBandId === bandId) {
                    selectBand(null);
                }
            } else {
                setDeleteConfirmId(bandId);
                // Clear confirmation after 3 seconds
                setTimeout(() => setDeleteConfirmId(null), 3000);
            }
        },
        [deleteConfirmId, removeBand, selectedBandId, selectBand]
    );

    const handleToggleSolo = useCallback(
        (bandId: string) => {
            if (soloedBandId === bandId) {
                setSoloedBandId(null);
            } else {
                setSoloedBandId(bandId);
            }
        },
        [soloedBandId, setSoloedBandId]
    );

    const handleBandUpdate = useCallback(
        (updates: Partial<FrequencyBand>) => {
            if (selectedBandId) {
                updateBand(selectedBandId, updates);
            }
        },
        [selectedBandId, updateBand]
    );

    const handleCycleSnapMode = useCallback(() => {
        const modes = ["none", "beats", "frames", "keyframes"] as const;
        const currentIndex = modes.indexOf(snapMode);
        const nextIndex = (currentIndex + 1) % modes.length;
        setSnapMode(modes[nextIndex]!);
    }, [snapMode, setSnapMode]);

    const handleDiscoverBands = useCallback(() => {
        if (audioDuration > 0 && !isComputing) {
            computeProposals();
        }
    }, [audioDuration, isComputing, computeProposals]);

    const snapModeLabels: Record<string, string> = {
        none: "Off",
        beats: "Beats",
        frames: "Frames",
        keyframes: "Keyframes",
    };
    const snapModeLabel = snapModeLabels[snapMode] ?? "Off";

    const bands = structure?.bands ?? [];
    const selectedBand = selectedBandId ? getBandById(selectedBandId) : null;

    // Enable keyboard shortcuts
    useBandKeyboardShortcuts({ audioDuration });

    return (
        <div
            className={cn(
                "flex flex-col h-full bg-white dark:bg-zinc-900 border-r border-zinc-200 dark:border-zinc-800 transition-all duration-200",
                sidebarOpen ? "w-64" : "w-10"
            )}
        >
            {/* Header */}
            <div className="flex items-center justify-between p-2 border-b border-zinc-200 dark:border-zinc-800">
                {sidebarOpen && (
                    <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                        Frequency Bands
                    </span>
                )}
                <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    onClick={toggleSidebar}
                    title={sidebarOpen ? "Collapse sidebar" : "Expand sidebar"}
                >
                    {sidebarOpen ? (
                        <ChevronLeft className="h-4 w-4" />
                    ) : (
                        <ChevronRight className="h-4 w-4" />
                    )}
                </Button>
            </div>

            {sidebarOpen && (
                <>
                    {/* Add Band Button + Snap Mode */}
                    <div className="p-2 border-b border-zinc-200 dark:border-zinc-800 space-y-2">
                        <Button
                            variant="outline"
                            size="sm"
                            className="w-full"
                            onClick={handleAddBand}
                            disabled={audioDuration <= 0}
                        >
                            <Plus className="h-4 w-4 mr-1" />
                            Add Band
                        </Button>
                        <Button
                            variant="ghost"
                            size="sm"
                            className={cn(
                                "w-full justify-start",
                                snapMode !== "none" && "bg-blue-500/10 text-blue-600 dark:text-blue-400"
                            )}
                            onClick={handleCycleSnapMode}
                            title="Cycle snap mode (S)"
                        >
                            <Magnet className="h-4 w-4 mr-1" />
                            Snap: {snapModeLabel}
                        </Button>
                    </div>

                    {/* Band List */}
                    <div className="flex-1 overflow-y-auto p-2 space-y-1">
                        {bands.length === 0 ? (
                            <div className="text-sm text-zinc-500 dark:text-zinc-400 text-center py-4">
                                No bands defined.
                                <br />
                                Click &quot;Add Band&quot; to create one.
                            </div>
                        ) : (
                            bands.map((band, index) => (
                                <BandListItem
                                    key={band.id}
                                    bandId={band.id}
                                    label={band.label}
                                    enabled={band.enabled}
                                    isSelected={band.id === selectedBandId}
                                    isSoloed={band.id === soloedBandId}
                                    isMuted={mutedBandIds.has(band.id)}
                                    colorIndex={index}
                                    onSelect={() => selectBand(band.id)}
                                    onRename={(newLabel) =>
                                        updateBand(band.id, { label: newLabel })
                                    }
                                    onToggleEnabled={() =>
                                        setBandEnabled(band.id, !band.enabled)
                                    }
                                    onToggleSolo={() => handleToggleSolo(band.id)}
                                    onToggleMute={() => toggleMuted(band.id)}
                                    onDelete={() => handleDeleteBand(band.id)}
                                />
                            ))
                        )}

                        {/* Discover Section */}
                        <div className="mt-4 pt-3 border-t border-zinc-200 dark:border-zinc-700">
                            {/* Discover Header */}
                            <button
                                type="button"
                                className="flex items-center justify-between w-full text-left px-1 py-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800"
                                onClick={() => setDiscoverExpanded(!discoverExpanded)}
                            >
                                <div className="flex items-center gap-1.5">
                                    <Sparkles className="h-3.5 w-3.5 text-orange-500" />
                                    <span className="text-sm font-medium text-zinc-600 dark:text-zinc-400">
                                        Discover
                                    </span>
                                    {proposals.length > 0 && (
                                        <span className="text-xs text-orange-500 bg-orange-100 dark:bg-orange-900/30 px-1.5 py-0.5 rounded-full">
                                            {proposals.length}
                                        </span>
                                    )}
                                </div>
                                <ChevronDown
                                    className={cn(
                                        "h-4 w-4 text-zinc-400 transition-transform",
                                        !discoverExpanded && "-rotate-90"
                                    )}
                                />
                            </button>

                            {discoverExpanded && (
                                <div className="mt-2 space-y-2">
                                    {/* Discover Button */}
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        className={cn(
                                            "w-full border-orange-300 dark:border-orange-700",
                                            "text-orange-600 dark:text-orange-400",
                                            "hover:bg-orange-50 dark:hover:bg-orange-900/20"
                                        )}
                                        onClick={handleDiscoverBands}
                                        disabled={audioDuration <= 0 || isComputing}
                                    >
                                        {isComputing ? (
                                            <>
                                                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                                                Analyzing...
                                            </>
                                        ) : (
                                            <>
                                                <Sparkles className="h-4 w-4 mr-1" />
                                                Discover Bands
                                            </>
                                        )}
                                    </Button>

                                    {/* Error message */}
                                    {proposalError && (
                                        <div className="text-xs text-red-600 dark:text-red-400 px-1">
                                            {proposalError}
                                        </div>
                                    )}

                                    {/* Proposals list */}
                                    {proposals.length > 0 && (
                                        <div className="space-y-1">
                                            {proposals.map((proposal) => (
                                                <ProposalListItem
                                                    key={proposal.id}
                                                    proposal={proposal}
                                                    isInspected={proposal.id === inspectedProposalId}
                                                    onInspect={() =>
                                                        inspectProposal(
                                                            proposal.id === inspectedProposalId
                                                                ? null
                                                                : proposal.id
                                                        )
                                                    }
                                                    onPromote={() => promoteProposal(proposal.id)}
                                                    onDismiss={() => dismissProposal(proposal.id)}
                                                />
                                            ))}
                                        </div>
                                    )}

                                    {/* Empty state */}
                                    {proposals.length === 0 && !isComputing && !proposalError && (
                                        <div className="flex items-start gap-2 px-1 py-2 text-xs text-zinc-500 dark:text-zinc-400">
                                            <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                                            <span>
                                                Click &quot;Discover Bands&quot; to find interesting frequency regions in your audio.
                                            </span>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Keyframe Table for Selected Band */}
                    {selectedBand && (
                        <div className="border-t border-zinc-200 dark:border-zinc-800 shrink-0 max-h-75 overflow-hidden flex flex-col">
                            <KeyframeTable
                                band={selectedBand}
                                hoveredKeyframeTime={hoveredKeyframeTime}
                                audioDuration={audioDuration}
                                onBandUpdate={handleBandUpdate}
                                onKeyframeHover={setHoveredKeyframeTime}
                            />
                        </div>
                    )}

                    {/* Delete Confirmation Toast */}
                    {deleteConfirmId && (
                        <div className="p-2 border-t border-zinc-200 dark:border-zinc-800">
                            <div className="text-xs text-red-600 dark:text-red-400 text-center">
                                Click delete again to confirm
                            </div>
                        </div>
                    )}
                </>
            )}
        </div>
    );
}
