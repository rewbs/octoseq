"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Music,
  AudioLines,
  AudioWaveform,
  Layers,
  Layers2,
  Zap,
  Code,
  FileCode,
  File,
  Type,
  Circle,
  CircleDashed,
  GripVertical,
  GripHorizontal,
  Sparkles,
  CheckCircle,
  Activity,
  Folder,
  TrendingUp,
  Grid3X3,
  ScatterChart,
  Timer,
  Search,
  Headphones,
  SlidersHorizontal,
  Package,
  Box,
  Upload,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  useInterpretationTreeStore,
  TREE_NODE_IDS,
  SIDEBAR_ICON_ONLY_THRESHOLD,
  SIDEBAR_MIN_WIDTH,
  SIDEBAR_MAX_WIDTH,
  INSPECTOR_SECTION_MIN_RATIO,
  INSPECTOR_SECTION_MAX_RATIO,
} from "@/lib/stores/interpretationTreeStore";
import { InspectorContent } from "@/components/inspector/InspectorContent";
import { useAudioInputStore } from "@/lib/stores/audioInputStore";
import type { AudioSource, RemoteAudioSource, GeneratedAudioSource } from "@/lib/stores/types/audioInput";
import { useProjectStore } from "@/lib/stores/projectStore";
import { useMirStore } from "@/lib/stores/mirStore";
import { MIXDOWN_ID } from "@/lib/stores/types/audioInput";
import { getMirAnalysisId, getAudioSourceId, getBandId } from "@/lib/nodeTypes";
import { useFrequencyBandStore } from "@/lib/stores/frequencyBandStore";
import { TreeNode } from "./TreeNode";
import { useTreeData, type TreeNodeData } from "./useTreeData";

/**
 * Parse a tree node ID to extract the audio input ID if it's an audio node.
 * Returns the input ID for audio nodes, or null for non-audio nodes.
 *
 * Node ID patterns:
 * - "audio:mixdown" → MIXDOWN_ID
 * - "audio:stem:{stemId}" → stemId
 * - anything else → null
 */
function parseAudioInputId(nodeId: string): string | null {
  if (nodeId === TREE_NODE_IDS.MIXDOWN) {
    return MIXDOWN_ID;
  }
  if (nodeId.startsWith("audio:stem:")) {
    return nodeId.slice("audio:stem:".length);
  }
  return null;
}

/**
 * Parse a tree node ID to extract the script ID if it's a script node.
 * Returns the script ID for script nodes, or null for non-script nodes.
 *
 * Node ID pattern:
 * - "scripts:{scriptId}" → scriptId
 * - anything else → null
 */
function parseScriptId(nodeId: string): string | null {
  if (nodeId.startsWith("scripts:")) {
    return nodeId.slice("scripts:".length);
  }
  return null;
}

/**
 * Map band MIR function IDs to their corresponding visual tab IDs.
 * Band functions are displayed within the context of their parent analysis type.
 */
const BAND_MIR_TO_VISUAL_TAB: Record<string, string> = {
  // STFT-based band functions
  bandAmplitudeEnvelope: "amplitudeEnvelope",
  bandOnsetStrength: "onsetEnvelope",
  bandSpectralFlux: "spectralFlux",
  bandSpectralCentroid: "spectralCentroid",
  // CQT-based band functions
  bandCqtHarmonicEnergy: "cqtHarmonicEnergy",
  bandCqtBassPitchMotion: "cqtBassPitchMotion",
  bandCqtTonalStability: "cqtTonalStability",
  // Event functions
  bandOnsetPeaks: "onsetPeaks",
  bandBeatCandidates: "beatCandidates",
};

// ----------------------------
// Icon Mapping
// ----------------------------

const ICON_MAP: Record<string, React.ReactNode> = {
  music: <Music className="h-4 w-4" />,
  "audio-lines": <AudioLines className="h-4 w-4" />,
  layers: <Layers className="h-4 w-4" />,
  "layers-2": <Layers2 className="h-4 w-4" />,
  zap: <Zap className="h-4 w-4" />,
  code: <Code className="h-4 w-4" />,
  "file-code": <FileCode className="h-4 w-4" />,
  file: <File className="h-4 w-4" />,
  type: <Type className="h-4 w-4" />,
  circle: <Circle className="h-2.5 w-2.5" />,
  "circle-dashed": <CircleDashed className="h-2.5 w-2.5" />,
  sparkles: <Sparkles className="h-4 w-4" />,
  "check-circle": <CheckCircle className="h-4 w-4" />,
  activity: <Activity className="h-4 w-4" />,
  folder: <Folder className="h-4 w-4" />,
  "sliders-horizontal": <SlidersHorizontal className="h-4 w-4" />,
  // MIR analysis type icons
  "trending-up": <TrendingUp className="h-3.5 w-3.5" />,
  "grid-3x3": <Grid3X3 className="h-3.5 w-3.5" />,
  "scatter-chart": <ScatterChart className="h-3.5 w-3.5" />,
  timer: <Timer className="h-3.5 w-3.5" />,
  search: <Search className="h-3.5 w-3.5" />,
  waveform: <AudioWaveform className="h-4 w-4" />,
  // Asset icons
  package: <Package className="h-4 w-4" />,
  box: <Box className="h-4 w-4" />,
};

// ----------------------------
// Types
// ----------------------------

// Props removed - tree no longer needs external dependencies
// All context-specific content now lives in the Inspector panel

// ----------------------------
// Icon-Only Node Component
// ----------------------------

interface IconOnlyNodeProps {
  node: TreeNodeData;
  isSelected: boolean;
  onSelect: () => void;
}

function IconOnlyNode({ node, isSelected, onSelect }: IconOnlyNodeProps) {
  const icon = node.iconName ? ICON_MAP[node.iconName] : undefined;

  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "w-full flex items-center justify-center p-2 rounded-md transition-colors",
        isSelected
          ? "bg-zinc-200 dark:bg-zinc-700"
          : "hover:bg-zinc-100 dark:hover:bg-zinc-800",
        node.isDisabled && "opacity-50 cursor-not-allowed"
      )}
      title={node.label}
      disabled={node.isDisabled}
    >
      <div className="text-zinc-600 dark:text-zinc-400">{icon}</div>
    </button>
  );
}

// ----------------------------
// Recursive Tree Renderer
// ----------------------------

interface TreeNodeRendererProps {
  node: TreeNodeData;
  level: number;
  expandedNodes: Set<string>;
  selectedNodeId: string | null;
  soloedBandId: string | null;
  onToggleExpand: (nodeId: string) => void;
  onSelectNode: (nodeId: string) => void;
  onToggleSolo: (bandId: string) => void;
  /** Callback to trigger file input dialog (for Audio node action) */
  triggerFileInput: (() => void) | null;
  /** Whether audio is currently loaded (affects Audio node action visibility) */
  hasAudio: boolean;
}

function TreeNodeRenderer({
  node,
  level,
  expandedNodes,
  selectedNodeId,
  soloedBandId,
  onToggleExpand,
  onSelectNode,
  onToggleSolo,
  triggerFileInput,
  hasAudio,
}: TreeNodeRendererProps) {
  const isExpanded = expandedNodes.has(node.id);
  const isSelected = selectedNodeId === node.id;
  const icon = node.iconName ? ICON_MAP[node.iconName] : undefined;

  // Check if this is a band node and extract band ID
  const bandId = getBandId(node.id);
  const isBandNode = bandId !== null;
  const isSoloed = isBandNode && soloedBandId === bandId;

  // Check if this is the Audio section node
  const isAudioNode = node.id === TREE_NODE_IDS.AUDIO;

  // Build actions based on node type
  let actions: React.ReactNode = undefined;
  let hasActiveAction = false;

  if (isBandNode) {
    // Band nodes get solo button
    hasActiveAction = isSoloed;
    actions = (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onToggleSolo(bandId);
        }}
        className={cn(
          "p-0.5 rounded transition-colors",
          isSoloed
            ? "text-yellow-600 dark:text-yellow-400 bg-yellow-500/20"
            : "text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700"
        )}
        title={isSoloed ? "Stop soloing" : "Solo (preview this band)"}
      >
        <Headphones className="h-3 w-3" />
      </button>
    );
  } else if (isAudioNode && triggerFileInput) {
    // Audio section node gets Load Audio button
    hasActiveAction = !hasAudio; // Show persistently when no audio loaded
    actions = (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          triggerFileInput();
        }}
        className={cn(
          "px-1 py-0.5 rounded transition-colors flex items-center gap-1",
          !hasAudio
            ? "text-blue-600 dark:text-blue-400 bg-blue-500/20 border border-blue-500"
            : "text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700"
        )}
        title={hasAudio ? "Change audio" : "Load audio"}
      >
        <Upload className="h-3 w-3" />
        {!hasAudio && <span className="text-xs font-medium">Load audio</span>}
      </button>
    );
  }

  return (
    <TreeNode
      id={node.id}
      label={node.label}
      icon={icon}
      hasChildren={node.hasChildren}
      isExpanded={isExpanded}
      isSelected={isSelected}
      isDisabled={node.isDisabled}
      level={level}
      onToggleExpand={() => onToggleExpand(node.id)}
      onSelect={() => onSelectNode(node.id)}
      badge={node.badge}
      actions={actions}
      hasActiveAction={hasActiveAction}
    >
      {/* Render children when expanded */}
      {node.hasChildren && isExpanded && (
        node.children?.map((child) => (
          <TreeNodeRenderer
            key={child.id}
            node={child}
            level={level + 1}
            expandedNodes={expandedNodes}
            selectedNodeId={selectedNodeId}
            soloedBandId={soloedBandId}
            onToggleExpand={onToggleExpand}
            onSelectNode={onSelectNode}
            onToggleSolo={onToggleSolo}
            triggerFileInput={triggerFileInput}
            hasAudio={hasAudio}
          />
        ))
      )}
    </TreeNode>
  );
}

// ----------------------------
// Resize Handle Component
// ----------------------------

interface ResizeHandleProps {
  onResize: (deltaX: number) => void;
  onResizeEnd: () => void;
}

function ResizeHandle({ onResize, onResizeEnd }: ResizeHandleProps) {
  const [isDragging, setIsDragging] = useState(false);
  const startXRef = useRef(0);
  // Store callbacks in refs to avoid stale closure issues during drag
  const onResizeRef = useRef(onResize);
  const onResizeEndRef = useRef(onResizeEnd);

  useLayoutEffect(() => {
    onResizeRef.current = onResize;
    onResizeEndRef.current = onResizeEnd;
  });

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
    startXRef.current = e.clientX;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const deltaX = moveEvent.clientX - startXRef.current;
      startXRef.current = moveEvent.clientX;
      onResizeRef.current(deltaX);
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      onResizeEndRef.current();
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  }, []);

  return (
    <div
      className={cn(
        "absolute top-0 right-0 w-1 h-full cursor-col-resize group",
        "hover:bg-blue-500/30 transition-colors",
        isDragging && "bg-blue-500/50"
      )}
      onMouseDown={handleMouseDown}
    >
      <div
        className={cn(
          "absolute top-1/2 right-0 -translate-y-1/2 translate-x-1/2",
          "opacity-0 group-hover:opacity-100 transition-opacity",
          "bg-zinc-200 dark:bg-zinc-700 rounded p-0.5",
          isDragging && "opacity-100"
        )}
      >
        <GripVertical className="h-4 w-4 text-zinc-500" />
      </div>
    </div>
  );
}

// ----------------------------
// Horizontal Resize Handle (for vertical divider)
// ----------------------------

interface HorizontalResizeHandleProps {
  onResize: (deltaY: number) => void;
}

function HorizontalResizeHandle({ onResize }: HorizontalResizeHandleProps) {
  const [isDragging, setIsDragging] = useState(false);
  const startYRef = useRef(0);
  const onResizeRef = useRef(onResize);

  useLayoutEffect(() => {
    onResizeRef.current = onResize;
  });

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
    startYRef.current = e.clientY;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const deltaY = moveEvent.clientY - startYRef.current;
      startYRef.current = moveEvent.clientY;
      onResizeRef.current(deltaY);
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  }, []);

  return (
    <div
      className={cn(
        "h-1.5 cursor-ns-resize flex items-center justify-center shrink-0",
        "hover:bg-blue-500/30 transition-colors",
        "border-y border-zinc-200 dark:border-zinc-700",
        isDragging && "bg-blue-500/50"
      )}
      onMouseDown={handleMouseDown}
    >
      <div
        className={cn(
          "opacity-50 hover:opacity-100 transition-opacity",
          isDragging && "opacity-100"
        )}
      >
        <GripHorizontal className="h-3 w-3 text-zinc-400" />
      </div>
    </div>
  );
}

// ----------------------------
// InterpretationTreePanel Component
// ----------------------------

export function InterpretationTreePanel() {
  const sidebarWidth = useInterpretationTreeStore((s) => s.sidebarWidth);
  const setSidebarWidth = useInterpretationTreeStore((s) => s.setSidebarWidth);
  const toggleSidebar = useInterpretationTreeStore((s) => s.toggleSidebar);
  const expandedNodes = useInterpretationTreeStore((s) => s.expandedNodes);
  const selectedNodeId = useInterpretationTreeStore((s) => s.selectedNodeId);
  const toggleExpanded = useInterpretationTreeStore((s) => s.toggleExpanded);
  const selectNode = useInterpretationTreeStore((s) => s.selectNode);
  const inspectorSectionRatio = useInterpretationTreeStore((s) => s.inspectorSectionRatio);
  const setInspectorSectionRatio = useInterpretationTreeStore((s) => s.setInspectorSectionRatio);
  const selectAudioInput = useAudioInputStore((s) => s.selectInput);
  const setActiveDisplay = useAudioInputStore((s) => s.setActiveDisplay);
  const setCurrentAudioSource = useAudioInputStore((s) => s.setCurrentAudioSource);
  const getInputById = useAudioInputStore((s) => s.getInputById);
  const triggerFileInput = useAudioInputStore((s) => s.triggerFileInput);
  const hasAudio = useAudioInputStore((s) => s.getAudio() !== null);
  const setActiveScript = useProjectStore((s) => s.setActiveScript);
  const activeProject = useProjectStore((s) => s.activeProject);
  const isDirty = useProjectStore((s) => s.isDirty);
  const setVisualTab = useMirStore((s) => s.setVisualTab);
  const setDisplayContextInputId = useMirStore((s) => s.setDisplayContextInputId);
  const soloedBandId = useFrequencyBandStore((s) => s.soloedBandId);
  const setSoloedBandId = useFrequencyBandStore((s) => s.setSoloedBandId);

  // Ref for tracking container height for ratio calculations
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerHeight, setContainerHeight] = useState(0);

  // Track container height
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const updateHeight = () => {
      // Subtract header height (approximately 41px)
      const headerHeight = 41;
      setContainerHeight(container.clientHeight - headerHeight);
    };

    updateHeight();

    const resizeObserver = new ResizeObserver(updateHeight);
    resizeObserver.observe(container);

    return () => resizeObserver.disconnect();
  }, []);

  // Project name for header
  const projectName = activeProject?.name ?? "Untitled Project";
  const headerTitle = isDirty ? `${projectName} *` : projectName;

  const treeData = useTreeData();

  // Handle node selection - also selects audio input, script, or visual tab if applicable
  // Helper to create an AudioSource from an existing AudioInput
  const createSourceFromInput = useCallback(
    (inputId: string): AudioSource | null => {
      const input = getInputById(inputId);
      if (!input) return null;

      // If the input already has a URL, create a ready source
      if (input.audioUrl) {
        // Determine source type based on origin
        if (input.origin.kind === "synthetic") {
          const source: GeneratedAudioSource = {
            type: "generated",
            id: input.id,
            generatedFrom: input.origin.generatedFrom ?? [],
            status: "ready",
            url: input.audioUrl,
          };
          return source;
        } else if (input.cloudAssetId) {
          // Has cloud asset - treat as remote (though URL is already resolved)
          const source: RemoteAudioSource = {
            type: "remote",
            id: input.id,
            cloudAssetId: input.cloudAssetId,
            status: "ready",
            url: input.audioUrl,
          };
          return source;
        } else {
          // Local file that's already loaded - create as remote with ready status
          // (We don't have the File object anymore, so we use the existing URL)
          const source: RemoteAudioSource = {
            type: "remote",
            id: input.id,
            cloudAssetId: input.cloudAssetId ?? "",
            status: "ready",
            url: input.audioUrl,
          };
          return source;
        }
      }

      // If no URL but has cloudAssetId, create pending remote source
      if (input.cloudAssetId) {
        const source: RemoteAudioSource = {
          type: "remote",
          id: input.id,
          cloudAssetId: input.cloudAssetId,
          status: "pending",
        };
        return source;
      }

      // No URL and no cloudAssetId - can't create a source
      return null;
    },
    [getInputById]
  );

  const handleSelectNode = useCallback(
    (nodeId: string) => {
      // Update tree selection
      selectNode(nodeId);

      // If this is an audio node, also update audio input selection
      const audioInputId = parseAudioInputId(nodeId);
      if (audioInputId) {
        selectAudioInput(audioInputId);
        // Also switch the waveform display to this audio source
        setActiveDisplay(audioInputId);

        // =======================================================================
        // DESIGN: Set currentAudioSource to establish single source of truth.
        // This is the primary way to switch audio display.
        // =======================================================================
        const source = createSourceFromInput(audioInputId);
        if (source) {
          setCurrentAudioSource(source);
        }
      }

      // If this is a script node, activate it in the project
      const scriptId = parseScriptId(nodeId);
      if (scriptId) {
        setActiveScript(scriptId);
      }

      // If this is a MIR analysis node, switch to that analysis view
      const analysisId = getMirAnalysisId(nodeId);
      if (analysisId) {
        // Check if this is a band MIR function and map to the corresponding visual tab
        const visualTabId = BAND_MIR_TO_VISUAL_TAB[analysisId] ?? analysisId;
        setVisualTab(visualTabId as Parameters<typeof setVisualTab>[0]);
      }

      // If this is a Bands node, switch to melSpectrogram view (best for viewing bands)
      if (nodeId.endsWith(":bands")) {
        setVisualTab("melSpectrogram");
      }

      // For any node under an audio source (including MIR children), set MIR display context
      const audioSourceId = getAudioSourceId(nodeId);
      if (audioSourceId) {
        setDisplayContextInputId(audioSourceId);
        // Also switch waveform to the parent audio source
        setActiveDisplay(audioSourceId);

        // Also set currentAudioSource for the parent audio source
        const source = createSourceFromInput(audioSourceId);
        if (source) {
          setCurrentAudioSource(source);
        }
      }
    },
    [selectNode, selectAudioInput, setActiveDisplay, setCurrentAudioSource, createSourceFromInput, setActiveScript, setVisualTab, setDisplayContextInputId]
  );

  // Determine if we're in icon-only mode
  const isIconOnly = sidebarWidth <= SIDEBAR_ICON_ONLY_THRESHOLD;

  const handleResize = useCallback(
    (deltaX: number) => {
      setSidebarWidth(sidebarWidth + deltaX);
    },
    [sidebarWidth, setSidebarWidth]
  );

  const handleResizeEnd = useCallback(() => {
    // Snap to icon-only mode if close to minimum
    if (sidebarWidth < SIDEBAR_ICON_ONLY_THRESHOLD && sidebarWidth > SIDEBAR_MIN_WIDTH) {
      setSidebarWidth(SIDEBAR_MIN_WIDTH);
    }
  }, [sidebarWidth, setSidebarWidth]);

  // Handle vertical divider resize
  const handleVerticalResize = useCallback(
    (deltaY: number) => {
      if (containerHeight <= 0) return;
      // Delta Y positive = dragging down = less inspector, more tree
      // So we subtract from the ratio
      const deltaRatio = deltaY / containerHeight;
      const newRatio = Math.max(
        INSPECTOR_SECTION_MIN_RATIO,
        Math.min(INSPECTOR_SECTION_MAX_RATIO, inspectorSectionRatio - deltaRatio)
      );
      setInspectorSectionRatio(newRatio);
    },
    [containerHeight, inspectorSectionRatio, setInspectorSectionRatio]
  );

  // Handle band solo toggle
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

  // Get project node and its children for rendering
  const projectNode = treeData.find((node) => node.id === TREE_NODE_IDS.PROJECT);
  // Promote project children to root level (since we only handle one project at a time)
  const rootNodes = projectNode?.children ?? [];
  // For icon-only mode, show only the main sections
  const iconOnlyNodes = rootNodes.filter(
    (child) =>
      child.id === TREE_NODE_IDS.AUDIO ||
      child.id === TREE_NODE_IDS.EVENT_STREAMS ||
      child.id === TREE_NODE_IDS.ASSETS ||
      child.id === TREE_NODE_IDS.SCRIPTS
  );

  // Calculate heights for tree and inspector sections
  const dividerHeight = 6; // Height of the divider in pixels
  const availableHeight = containerHeight - dividerHeight;
  const inspectorHeight = selectedNodeId && !isIconOnly ? Math.floor(availableHeight * inspectorSectionRatio) : 0;
  const treeHeight = availableHeight - inspectorHeight;

  return (
    <div
      ref={containerRef}
      className="relative flex flex-col h-full bg-white dark:bg-zinc-900 border-r border-zinc-200 dark:border-zinc-800"
      style={{ width: sidebarWidth, minWidth: SIDEBAR_MIN_WIDTH, maxWidth: SIDEBAR_MAX_WIDTH }}
    >
      {/* Header - Project name (clickable to select project) */}
      <div className="flex items-center justify-between p-2 border-b border-zinc-200 dark:border-zinc-800 shrink-0">
        {!isIconOnly && (
          <button
            type="button"
            onClick={() => handleSelectNode(TREE_NODE_IDS.PROJECT)}
            className={cn(
              "flex items-center gap-1.5 text-sm font-medium truncate rounded px-1 -ml-1 transition-colors",
              selectedNodeId === TREE_NODE_IDS.PROJECT
                ? "text-zinc-900 dark:text-zinc-100 bg-zinc-200 dark:bg-zinc-700"
                : "text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            )}
            title="Select project"
          >
            <Folder className="h-4 w-4 shrink-0" />
            <span className="truncate">{headerTitle}</span>
          </button>
        )}
        <Button
          variant="ghost"
          size="icon"
          className={cn("h-6 w-6 shrink-0", isIconOnly && "mx-auto")}
          onClick={toggleSidebar}
          title={isIconOnly ? "Expand sidebar" : "Collapse sidebar"}
        >
          {isIconOnly ? (
            <ChevronRight className="h-4 w-4" />
          ) : (
            <ChevronLeft className="h-4 w-4" />
          )}
        </Button>
      </div>

      {/* Tree Content */}
      <div
        className="overflow-y-auto p-1"
        style={{ height: treeHeight > 0 ? treeHeight : undefined, flex: treeHeight > 0 ? undefined : 1 }}
      >
        {isIconOnly ? (
          // Icon-only mode: show project and section icons
          <div className="flex flex-col gap-1">
            {iconOnlyNodes.map((node) => (
              <IconOnlyNode
                key={node.id}
                node={node}
                isSelected={selectedNodeId === node.id}
                onSelect={() => {
                  handleSelectNode(node.id);
                  // Expand sidebar when clicking an icon in icon-only mode
                  toggleSidebar();
                }}
              />
            ))}
          </div>
        ) : (
          // Full tree mode - project children promoted to root level
          rootNodes.map((node) => (
            <TreeNodeRenderer
              key={node.id}
              node={node}
              level={0}
              expandedNodes={expandedNodes}
              selectedNodeId={selectedNodeId}
              soloedBandId={soloedBandId}
              onToggleExpand={toggleExpanded}
              onSelectNode={handleSelectNode}
              onToggleSolo={handleToggleSolo}
              triggerFileInput={triggerFileInput}
              hasAudio={hasAudio}
            />
          ))
        )}
      </div>

      {/* Inspector Section - only show when a node is selected and not in icon-only mode */}
      {selectedNodeId && !isIconOnly && (
        <>
          {/* Horizontal Divider */}
          <HorizontalResizeHandle onResize={handleVerticalResize} />

          {/* Inspector Content */}
          <div
            className="overflow-y-auto bg-zinc-50 dark:bg-zinc-950"
            style={{ height: inspectorHeight }}
          >
            <InspectorContent nodeId={selectedNodeId} />
          </div>
        </>
      )}

      {/* Width Resize Handle */}
      <ResizeHandle onResize={handleResize} onResizeEnd={handleResizeEnd} />
    </div>
  );
}
