"use client";

import { useMemo } from "react";
import { useAudioInputStore } from "@/lib/stores/audioInputStore";
import { useFrequencyBandStore } from "@/lib/stores/frequencyBandStore";
import { useCandidateEventStore } from "@/lib/stores/candidateEventStore";
import { useAuthoredEventStore } from "@/lib/stores/authoredEventStore";
import { useProjectStore } from "@/lib/stores/projectStore";
import { TREE_NODE_IDS } from "@/lib/stores/interpretationTreeStore";
import { useMirStore, mirTabDefinitions, makeInputMirCacheKey } from "@/lib/stores/mirStore";
import { useBandMirStore } from "@/lib/stores/bandMirStore";
import { useCustomSignalStore } from "@/lib/stores/customSignalStore";
import type { MirFunctionId } from "@/components/mir/MirControlPanel";
import type { BandMirFunctionId, BandCqtFunctionId, BandEventFunctionId } from "@octoseq/mir";

/**
 * Tree node data structure for rendering.
 */
export interface TreeNodeData {
  id: string;
  label: string;
  iconName?: string;
  hasChildren: boolean;
  isDisabled?: boolean;
  badge?: string;
  children?: TreeNodeData[];
}

/**
 * Hook that builds the tree data structure from various stores.
 * Returns a stable tree structure for rendering.
 */
/**
 * Get the appropriate icon name for an analysis kind.
 */
function getAnalysisIcon(kind: "1d" | "2d" | "events" | "tempoHypotheses"): string {
  switch (kind) {
    case "1d":
      return "trending-up";
    case "2d":
      return "grid-3x3";
    case "events":
      return "scatter-chart";
    case "tempoHypotheses":
      return "timer";
    default:
      return "activity";
  }
}

/**
 * Band MIR function definitions for tree display (1D signals).
 */
const bandMirFunctionDefs: Array<{
  id: BandMirFunctionId | BandCqtFunctionId;
  label: string;
  iconName: string;
}> = [
    { id: "bandAmplitudeEnvelope", label: "Amplitude", iconName: "trending-up" },
    { id: "bandSpectralCentroid", label: "Spectral Centroid", iconName: "trending-up" },
    { id: "bandSpectralFlux", label: "Spectral Flux", iconName: "trending-up" },
    { id: "bandCqtHarmonicEnergy", label: "Harmonic Energy", iconName: "trending-up" },
    { id: "bandCqtBassPitchMotion", label: "Bass Motion", iconName: "trending-up" },
    { id: "bandCqtTonalStability", label: "Tonal Stability", iconName: "trending-up" },
    { id: "bandOnsetStrength", label: "Onset Envelope", iconName: "trending-up" },
  ];

/**
 * Band event function definitions for tree display (event extraction).
 */
const bandEventFunctionDefs: Array<{
  id: BandEventFunctionId;
  label: string;
  iconName: string;
}> = [
    { id: "bandOnsetPeaks", label: "Onset Peaks", iconName: "scatter-chart" },
    { id: "bandBeatCandidates", label: "Beat Candidates", iconName: "scatter-chart" },
  ];

/**
 * Build MIR analysis children for a given parent node ID prefix.
 * @param nodeIdPrefix - The prefix for child node IDs (e.g., "audio:mixdown:mir")
 * @param sourceId - The audio source ID to check for cached results
 * @param inputMirCache - The MIR cache to check for available results
 */
function buildMirAnalysisChildren(
  nodeIdPrefix: string,
  sourceId: string,
  inputMirCache: Map<string, unknown>
): TreeNodeData[] {
  const analysisNodes = mirTabDefinitions.map((def) => {
    const cacheKey = makeInputMirCacheKey(sourceId, def.id as MirFunctionId);
    const hasResult = inputMirCache.has(cacheKey);
    return {
      id: `${nodeIdPrefix}:${def.id}`,
      label: def.label.replace(/ \([^)]+\)$/, ""), // Remove kind suffix like "(1D)"
      iconName: getAnalysisIcon(def.kind),
      hasChildren: false,
      isDisabled: !hasResult,
    };
  });

  // Add Search node at the end (always enabled since it requires user input, not analysis results)
  const searchNode: TreeNodeData = {
    id: `${nodeIdPrefix}:search`,
    label: "Search (alpha)",
    iconName: "search",
    hasChildren: false,
    isDisabled: false,
  };

  return [...analysisNodes, searchNode];
}

/**
 * Build band MIR analysis children for a given band.
 * Uses band-specific MIR functions (bandAmplitudeEnvelope, etc.) instead of standard MIR.
 * @param nodeIdPrefix - The prefix for child node IDs (e.g., "audio:mixdown:bands:bandId:mir")
 * @param bandId - The band ID to check for cached results
 * @param bandMirCache - The band MIR cache to check for available results
 * @param bandCqtCache - The band CQT cache to check for available results
 * @param bandEventCache - The band event cache to check for available results
 */
function buildBandMirAnalysisChildren(
  nodeIdPrefix: string,
  bandId: string,
  bandMirCache: Map<string, unknown>,
  bandCqtCache: Map<string, unknown>,
  bandEventCache: Map<string, unknown>
): TreeNodeData[] {
  // Build 1D signal nodes
  const signalNodes = bandMirFunctionDefs.map((def) => {
    // Check appropriate cache based on function type
    const isCqt = def.id.startsWith("bandCqt");
    const cacheKey = `${bandId}:${def.id}`;
    const hasResult = isCqt ? bandCqtCache.has(cacheKey) : bandMirCache.has(cacheKey);
    return {
      id: `${nodeIdPrefix}:${def.id}`,
      label: def.label,
      iconName: def.iconName,
      hasChildren: false,
      isDisabled: !hasResult,
    };
  });

  // Build event nodes
  const eventNodes = bandEventFunctionDefs.map((def) => {
    const cacheKey = `${bandId}:${def.id}`;
    const hasResult = bandEventCache.has(cacheKey);
    return {
      id: `${nodeIdPrefix}:${def.id}`,
      label: def.label,
      iconName: def.iconName,
      hasChildren: false,
      isDisabled: !hasResult,
    };
  });

  return [...signalNodes, ...eventNodes];
}

export function useTreeData(): TreeNodeData[] {
  const audioCollection = useAudioInputStore((s) => s.collection);
  const frequencyBandStructure = useFrequencyBandStore((s) => s.structure);
  const candidateStreams = useCandidateEventStore((s) => s.streams);
  const authoredStreams = useAuthoredEventStore((s) => s.streams);
  const activeProject = useProjectStore((s) => s.activeProject);
  const isDirty = useProjectStore((s) => s.isDirty);
  const inputMirCache = useMirStore((s) => s.inputMirCache);
  const bandMirCache = useBandMirStore((s) => s.cache);
  const bandCqtCache = useBandMirStore((s) => s.cqtCache);
  const bandEventCache = useBandMirStore((s) => s.typedEventCache);
  const customSignalStructure = useCustomSignalStore((s) => s.structure);
  const customSignalResultCache = useCustomSignalStore((s) => s.resultCache);

  return useMemo(() => {
    const stemCount = audioCollection?.stemOrder.length ?? 0;

    // Count total candidate events
    let totalCandidateEvents = 0;
    const candidateStreamArray = Array.from(candidateStreams.values());
    for (const stream of candidateStreamArray) {
      totalCandidateEvents += stream.events.length;
    }

    // Count total authored events
    let totalAuthoredEvents = 0;
    const authoredStreamArray = Array.from(authoredStreams.values());
    for (const stream of authoredStreamArray) {
      totalAuthoredEvents += stream.events.length;
    }

    // Helper to build individual band nodes for a specific source
    const buildBandNodes = (sourceId: string, bandNodePrefix: string): TreeNodeData[] => {
      const sourceBands = frequencyBandStructure?.bands.filter(
        (b) => b.sourceId === sourceId
      ) ?? [];

      return sourceBands.map((band) => {
        const bandNodeId = `${bandNodePrefix}:${band.id}`;
        const bandMirNodeId = `${bandNodeId}:mir`;
        return {
          id: bandNodeId,
          label: band.label,
          iconName: "circle",
          hasChildren: true, // Has MIR child node
          children: [
            {
              id: bandMirNodeId,
              label: "MIR",
              iconName: "activity",
              hasChildren: true,
              children: buildBandMirAnalysisChildren(bandMirNodeId, band.id, bandMirCache, bandCqtCache, bandEventCache),
            },
          ],
        };
      });
    };

    // Helper to build "Bands" section node for an audio source
    const buildBandsSection = (sourceId: string, bandsNodeId: string): TreeNodeData => {
      const bandNodePrefix = `${bandsNodeId}`;
      const bandNodes = buildBandNodes(sourceId, bandNodePrefix);
      const bandCount = bandNodes.length;

      return {
        id: bandsNodeId,
        label: "Bands",
        iconName: "sliders-horizontal",
        hasChildren: true, // Always expandable for band discovery
        badge: bandCount > 0 ? String(bandCount) : undefined,
        children: bandNodes,
      };
    };

    // Build stem children with MIR and Bands sections
    const stemChildren: TreeNodeData[] =
      audioCollection?.stemOrder.map((stemId) => {
        const stem = audioCollection.inputs[stemId];
        const stemNodeId = `audio:stem:${stemId}`;
        const stemMirNodeId = `${stemNodeId}:mir`;
        const stemBandsNodeId = `${stemNodeId}:bands`;

        const stemChildNodes: TreeNodeData[] = [
          {
            id: stemMirNodeId,
            label: "MIR",
            iconName: "activity",
            hasChildren: true,
            children: buildMirAnalysisChildren(stemMirNodeId, stemId, inputMirCache),
          },
          buildBandsSection(stemId, stemBandsNodeId),
        ];

        return {
          id: stemNodeId,
          label: stem?.label ?? stemId,
          iconName: "audio-lines",
          hasChildren: true,
          children: stemChildNodes,
        };
      }) ?? [];

    // Build candidate stream children
    const candidateChildren: TreeNodeData[] = candidateStreamArray.map((stream) => ({
      id: `event-streams:candidates:${stream.id}`,
      label: `${stream.sourceLabel} - ${getEventTypeLabel(stream.eventType)}`,
      iconName: "circle-dashed",
      hasChildren: false,
      badge: String(stream.events.length),
    }));

    // Build authored stream children
    const authoredChildren: TreeNodeData[] = authoredStreamArray.map((stream) => ({
      id: `event-streams:authored:${stream.id}`,
      label: stream.name,
      iconName: "circle",
      hasChildren: false,
      badge: String(stream.events.length),
    }));

    // Build mixdown children with MIR and Bands sections
    const mixdownMirNodeId = `${TREE_NODE_IDS.MIXDOWN}:mir`;
    const mixdownBandsNodeId = `${TREE_NODE_IDS.MIXDOWN}:bands`;
    const mixdownChildren: TreeNodeData[] = [
      {
        id: mixdownMirNodeId,
        label: "MIR",
        iconName: "activity",
        hasChildren: true,
        children: buildMirAnalysisChildren(mixdownMirNodeId, "mixdown", inputMirCache),
      },
      buildBandsSection("mixdown", mixdownBandsNodeId),
    ];

    // Build audio section
    const audioChildren: TreeNodeData[] = [
      {
        id: TREE_NODE_IDS.MIXDOWN,
        label: audioCollection?.inputs.mixdown?.label ?? "Mixdown",
        iconName: "audio-lines",
        hasChildren: true,
        children: mixdownChildren,
      },
      // Stems section - always visible, expandable for management
      {
        id: TREE_NODE_IDS.STEMS,
        label: "Stems",
        iconName: "layers-2",
        hasChildren: true, // Always expandable for import functionality
        badge: stemCount > 0 ? String(stemCount) : undefined,
        children: stemChildren,
      },
    ];

    // Build script children from project
    const scriptChildren: TreeNodeData[] = activeProject?.scripts.scripts.map((script) => ({
      id: `scripts:${script.id}`,
      label: script.name,
      iconName: script.id === activeProject.scripts.activeScriptId ? "file-code" : "file",
      hasChildren: false,
    })) ?? [
        // Fallback when no project is loaded
        {
          id: TREE_NODE_IDS.MAIN_SCRIPT,
          label: "Main Script",
          iconName: "file-code",
          hasChildren: false,
        },
      ];

    // Build the sections (children of project)
    const projectChildren: TreeNodeData[] = [
      {
        id: TREE_NODE_IDS.AUDIO,
        label: "Audio",
        iconName: "music",
        hasChildren: true,
        children: audioChildren,
      },
      // Custom Signals section
      (() => {
        const customSignals = customSignalStructure?.signals ?? [];
        const signalChildren: TreeNodeData[] = customSignals.map((signal) => {
          const hasResult = customSignalResultCache.has(signal.id);
          return {
            id: `custom-signals:${signal.id}`,
            label: signal.name,
            iconName: hasResult ? "activity" : "circle-dashed",
            hasChildren: false,
            isDisabled: !signal.enabled,
          };
        });

        return {
          id: TREE_NODE_IDS.CUSTOM_SIGNALS,
          label: "Custom Signals",
          iconName: "waveform",
          hasChildren: true,
          badge: customSignals.length > 0 ? String(customSignals.length) : undefined,
          children: signalChildren,
        };
      })(),
      {
        id: TREE_NODE_IDS.EVENT_STREAMS,
        label: "Custom Event Streams",
        iconName: "zap",
        hasChildren: true,
        children: [
          // Authored streams first (authoritative)
          {
            id: TREE_NODE_IDS.AUTHORED_EVENTS,
            label: "Authored",
            iconName: "check-circle",
            hasChildren: true, // Always expandable for creation controls
            badge: totalAuthoredEvents > 0 ? String(totalAuthoredEvents) : undefined,
            children: authoredChildren,
          },
          // Candidates second (suggestions)
          {
            id: TREE_NODE_IDS.CANDIDATE_EVENTS,
            label: "Candidates",
            iconName: "sparkles",
            hasChildren: true, // Always expandable for generation controls
            badge: totalCandidateEvents > 0 ? String(totalCandidateEvents) : undefined,
            children: candidateChildren,
          },
        ],
      },
      // Assets section
      {
        id: TREE_NODE_IDS.ASSETS,
        label: "Assets",
        iconName: "package",
        hasChildren: true,
        children: [
          {
            id: TREE_NODE_IDS.THREE_D_OBJECTS,
            label: "3D Objects",
            iconName: "box",
            hasChildren: false,
          },
        ],
      },
      {
        id: TREE_NODE_IDS.SCRIPTS,
        label: "Scripts",
        iconName: "code",
        hasChildren: true,
        badge: scriptChildren.length > 0 ? String(scriptChildren.length) : undefined,
        children: scriptChildren,
      },
      {
        id: TREE_NODE_IDS.TEXT,
        label: "Lyrics / Text events",
        iconName: "type",
        hasChildren: false,
        isDisabled: true,
      },
    ];

    // Build the full tree with Project as root
    const projectName = activeProject?.name ?? "Untitled Project";
    const projectLabel = isDirty ? `${projectName} *` : projectName;

    const tree: TreeNodeData[] = [
      {
        id: TREE_NODE_IDS.PROJECT,
        label: projectLabel,
        iconName: "folder",
        hasChildren: true,
        children: projectChildren,
      },
    ];

    return tree;
  }, [audioCollection, frequencyBandStructure, candidateStreams, authoredStreams, activeProject, isDirty, inputMirCache, bandMirCache, bandCqtCache, bandEventCache, customSignalStructure, customSignalResultCache]);
}

/**
 * Get human-readable label for an event type.
 */
function getEventTypeLabel(eventType: string): string {
  switch (eventType) {
    case "onset":
      return "Onsets";
    case "beat":
      return "Beats";
    case "flux":
      return "Flux";
    default:
      return eventType;
  }
}
