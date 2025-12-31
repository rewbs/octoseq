"use client";

import { useCallback, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Music,
  AudioLines,
  Layers,
  Layers2,
  Zap,
  Code,
  FileCode,
  Type,
  Circle,
  CircleDashed,
  GripVertical,
  Sparkles,
  CheckCircle,
  Activity,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  useInterpretationTreeStore,
  TREE_NODE_IDS,
  SIDEBAR_ICON_ONLY_THRESHOLD,
  SIDEBAR_MIN_WIDTH,
  SIDEBAR_MAX_WIDTH,
} from "@/lib/stores/interpretationTreeStore";
import { useAudioInputStore } from "@/lib/stores/audioInputStore";
import { MIXDOWN_ID } from "@/lib/stores/types/audioInput";
import { TreeNode } from "./TreeNode";
import { useTreeData, type TreeNodeData } from "./useTreeData";
import { FrequencyBandContent } from "@/components/frequencyBand/FrequencyBandContent";
import { StemManagementContent } from "@/components/stems/StemManagementContent";
import { CandidateEventsContent } from "@/components/candidates/CandidateEventsContent";
import { AuthoredEventsContent } from "@/components/authored/AuthoredEventsContent";

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
  type: <Type className="h-4 w-4" />,
  circle: <Circle className="h-2.5 w-2.5" />,
  "circle-dashed": <CircleDashed className="h-2.5 w-2.5" />,
  sparkles: <Sparkles className="h-4 w-4" />,
  "check-circle": <CheckCircle className="h-4 w-4" />,
  activity: <Activity className="h-4 w-4" />,
};

// ----------------------------
// Types
// ----------------------------

export interface InterpretationTreePanelProps {
  /** Audio duration for frequency band operations. */
  audioDuration: number;
}

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
  onToggleExpand: (nodeId: string) => void;
  onSelectNode: (nodeId: string) => void;
  audioDuration: number;
}

function TreeNodeRenderer({
  node,
  level,
  expandedNodes,
  selectedNodeId,
  onToggleExpand,
  onSelectNode,
  audioDuration,
}: TreeNodeRendererProps) {
  const isExpanded = expandedNodes.has(node.id);
  const isSelected = selectedNodeId === node.id;
  const icon = node.iconName ? ICON_MAP[node.iconName] : undefined;

  // Check for special content nodes
  const isMixdownNode = node.id === TREE_NODE_IDS.MIXDOWN;
  const isStemsNode = node.id === TREE_NODE_IDS.STEMS;
  const isStemNode = node.id.startsWith("audio:stem:") && !node.id.includes(":band:") && !node.id.endsWith(":mir");
  const isAuthoredEventsNode = node.id === TREE_NODE_IDS.AUTHORED_EVENTS;
  const isCandidateEventsNode = node.id === TREE_NODE_IDS.CANDIDATE_EVENTS;

  // Extract sourceId for audio source nodes
  const sourceId = parseAudioInputId(node.id);

  // Determine which special content to render
  const renderSpecialContent = () => {
    // Show band controls for Mixdown and Stem nodes
    if ((isMixdownNode || isStemNode) && sourceId) {
      return (
        <div className="ml-4 mt-1">
          <FrequencyBandContent audioDuration={audioDuration} sourceId={sourceId} />
        </div>
      );
    }
    if (isStemsNode) {
      return (
        <div className="ml-4 mt-1">
          <StemManagementContent audioDuration={audioDuration} />
        </div>
      );
    }
    if (isAuthoredEventsNode) {
      return (
        <div className="ml-4 mt-1">
          <AuthoredEventsContent audioDuration={audioDuration} />
        </div>
      );
    }
    if (isCandidateEventsNode) {
      return (
        <div className="ml-4 mt-1">
          <CandidateEventsContent audioDuration={audioDuration} />
        </div>
      );
    }
    return null;
  };

  const specialContent = renderSpecialContent();

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
    >
      {/* Render children when expanded */}
      {node.hasChildren && isExpanded && (
        <>
          {/* For special nodes, render their custom content */}
          {specialContent ? (
            specialContent
          ) : (
            /* Render child nodes recursively */
            node.children?.map((child) => (
              <TreeNodeRenderer
                key={child.id}
                node={child}
                level={level + 1}
                expandedNodes={expandedNodes}
                selectedNodeId={selectedNodeId}
                onToggleExpand={onToggleExpand}
                onSelectNode={onSelectNode}
                audioDuration={audioDuration}
              />
            ))
          )}
        </>
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

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      setIsDragging(true);
      startXRef.current = e.clientX;

      const handleMouseMove = (moveEvent: MouseEvent) => {
        const deltaX = moveEvent.clientX - startXRef.current;
        startXRef.current = moveEvent.clientX;
        onResize(deltaX);
      };

      const handleMouseUp = () => {
        setIsDragging(false);
        onResizeEnd();
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
      };

      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
    },
    [onResize, onResizeEnd]
  );

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
// InterpretationTreePanel Component
// ----------------------------

export function InterpretationTreePanel({ audioDuration }: InterpretationTreePanelProps) {
  const sidebarWidth = useInterpretationTreeStore((s) => s.sidebarWidth);
  const setSidebarWidth = useInterpretationTreeStore((s) => s.setSidebarWidth);
  const toggleSidebar = useInterpretationTreeStore((s) => s.toggleSidebar);
  const expandedNodes = useInterpretationTreeStore((s) => s.expandedNodes);
  const selectedNodeId = useInterpretationTreeStore((s) => s.selectedNodeId);
  const toggleExpanded = useInterpretationTreeStore((s) => s.toggleExpanded);
  const selectNode = useInterpretationTreeStore((s) => s.selectNode);
  const selectAudioInput = useAudioInputStore((s) => s.selectInput);

  const treeData = useTreeData();

  // Handle node selection - also selects audio input if applicable
  const handleSelectNode = useCallback(
    (nodeId: string) => {
      // Update tree selection
      selectNode(nodeId);

      // If this is an audio node, also update audio input selection
      const audioInputId = parseAudioInputId(nodeId);
      if (audioInputId) {
        selectAudioInput(audioInputId);
      }
    },
    [selectNode, selectAudioInput]
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

  // Get only root-level nodes for icon-only mode
  const rootNodes = treeData.filter(
    (node) =>
      node.id === TREE_NODE_IDS.AUDIO ||
      node.id === TREE_NODE_IDS.EVENT_STREAMS ||
      node.id === TREE_NODE_IDS.SCRIPTS ||
      node.id === TREE_NODE_IDS.TEXT
  );

  return (
    <div
      className="relative flex flex-col h-full bg-white dark:bg-zinc-900 border-r border-zinc-200 dark:border-zinc-800"
      style={{ width: sidebarWidth, minWidth: SIDEBAR_MIN_WIDTH, maxWidth: SIDEBAR_MAX_WIDTH }}
    >
      {/* Header */}
      <div className="flex items-center justify-between p-2 border-b border-zinc-200 dark:border-zinc-800">
        {!isIconOnly && (
          <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300 truncate">
            Interpretation
          </span>
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

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-1">
        {isIconOnly ? (
          // Icon-only mode: show just root node icons
          <div className="flex flex-col gap-1">
            {rootNodes.map((node) => (
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
          // Full tree mode
          treeData.map((node) => (
            <TreeNodeRenderer
              key={node.id}
              node={node}
              level={0}
              expandedNodes={expandedNodes}
              selectedNodeId={selectedNodeId}
              onToggleExpand={toggleExpanded}
              onSelectNode={handleSelectNode}
              audioDuration={audioDuration}
            />
          ))
        )}
      </div>

      {/* Resize Handle */}
      <ResizeHandle onResize={handleResize} onResizeEnd={handleResizeEnd} />
    </div>
  );
}
