"use client";

import { useMemo } from "react";
import { useAudioInputStore } from "@/lib/stores/audioInputStore";
import { useFrequencyBandStore } from "@/lib/stores/frequencyBandStore";
import { useCandidateEventStore } from "@/lib/stores/candidateEventStore";
import { useAuthoredEventStore } from "@/lib/stores/authoredEventStore";
import { TREE_NODE_IDS } from "@/lib/stores/interpretationTreeStore";

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
export function useTreeData(): TreeNodeData[] {
  const audioCollection = useAudioInputStore((s) => s.collection);
  const frequencyBandStructure = useFrequencyBandStore((s) => s.structure);
  const candidateStreams = useCandidateEventStore((s) => s.streams);
  const authoredStreams = useAuthoredEventStore((s) => s.streams);

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

    // Helper to build band children for a specific source
    const buildBandChildren = (sourceId: string): TreeNodeData[] => {
      const sourceBands = frequencyBandStructure?.bands.filter(
        (b) => b.sourceId === sourceId
      ) ?? [];

      return sourceBands.map((band) => ({
        id: `audio:${sourceId}:band:${band.id}`,
        label: band.label,
        iconName: "circle",
        hasChildren: true, // Has MIR child node
        children: [
          {
            id: `audio:${sourceId}:band:${band.id}:mir`,
            label: "MIR",
            iconName: "activity",
            hasChildren: false,
          },
        ],
      }));
    };

    // Count mixdown bands for badge
    const mixdownBandCount = frequencyBandStructure?.bands.filter(
      (b) => b.sourceId === "mixdown"
    ).length ?? 0;

    // Build stem children with their bands
    const stemChildren: TreeNodeData[] =
      audioCollection?.stemOrder.map((stemId) => {
        const stem = audioCollection.inputs[stemId];
        const stemBands = buildBandChildren(stemId);
        const stemBandCount = stemBands.length;

        const stemMirChildren: TreeNodeData[] = [
          {
            id: `audio:stem:${stemId}:mir`,
            label: "MIR",
            iconName: "activity",
            hasChildren: false,
          },
          ...stemBands,
        ];

        return {
          id: `audio:stem:${stemId}`,
          label: stem?.label ?? stemId,
          iconName: "audio-lines",
          hasChildren: true,
          badge: stemBandCount > 0 ? String(stemBandCount) : undefined,
          children: stemMirChildren,
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

    // Build mixdown children with MIR and bands
    const mixdownBands = buildBandChildren("mixdown");
    const mixdownChildren: TreeNodeData[] = [
      {
        id: `${TREE_NODE_IDS.MIXDOWN}:mir`,
        label: "MIR",
        iconName: "activity",
        hasChildren: false,
      },
      ...mixdownBands,
    ];

    // Build audio section
    const audioChildren: TreeNodeData[] = [
      {
        id: TREE_NODE_IDS.MIXDOWN,
        label: audioCollection?.inputs.mixdown?.label ?? "Mixdown",
        iconName: "audio-lines",
        hasChildren: true,
        badge: mixdownBandCount > 0 ? String(mixdownBandCount) : undefined,
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

    // Build the full tree
    const tree: TreeNodeData[] = [
      {
        id: TREE_NODE_IDS.AUDIO,
        label: "Audio",
        iconName: "music",
        hasChildren: true,
        children: audioChildren,
      },
      {
        id: TREE_NODE_IDS.EVENT_STREAMS,
        label: "Event Streams",
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
      {
        id: TREE_NODE_IDS.SCRIPTS,
        label: "Scripts",
        iconName: "code",
        hasChildren: true,
        children: [
          {
            id: TREE_NODE_IDS.MAIN_SCRIPT,
            label: "Main Script",
            iconName: "file-code",
            hasChildren: false,
          },
        ],
      },
      {
        id: TREE_NODE_IDS.TEXT,
        label: "Text",
        iconName: "type",
        hasChildren: false,
        isDisabled: true,
      },
    ];

    return tree;
  }, [audioCollection, frequencyBandStructure, candidateStreams, authoredStreams]);
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
