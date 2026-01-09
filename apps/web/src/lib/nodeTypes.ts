/**
 * Node type detection utilities for the interpretation tree.
 * Used to determine which inspector view to show for a selected node.
 */

import { TREE_NODE_IDS } from "@/lib/stores/interpretationTreeStore";

/**
 * Node types that have dedicated inspector views.
 */
export type InspectorNodeType =
  | "project"
  | "audio-section"
  | "audio-mixdown"
  | "audio-stem"
  | "stems-section"
  | "bands-section"
  | "band"
  | "mir-section"
  | "mir-analysis"
  | "event-streams-section"
  | "authored-events"
  | "authored-stream"
  | "candidate-events"
  | "candidate-stream"
  | "derived-signals-section"
  | "derived-signal"
  | "composed-signals-section"
  | "composed-signal"
  | "assets-section"
  | "mesh-assets"
  | "scripts-section"
  | "script"
  | "unknown";

/**
 * Determine the inspector type for a given tree node ID.
 *
 * @param nodeId - The tree node ID
 * @returns The inspector node type
 */
export function getInspectorNodeType(nodeId: string | null): InspectorNodeType {
  if (!nodeId) return "unknown";

  // Project root
  if (nodeId === TREE_NODE_IDS.PROJECT) return "project";

  // Top-level sections
  if (nodeId === TREE_NODE_IDS.AUDIO) return "audio-section";
  if (nodeId === TREE_NODE_IDS.EVENT_STREAMS) return "event-streams-section";
  if (nodeId === TREE_NODE_IDS.DERIVED_SIGNALS) return "derived-signals-section";
  if (nodeId === TREE_NODE_IDS.COMPOSED_SIGNALS) return "composed-signals-section";
  if (nodeId === TREE_NODE_IDS.ASSETS) return "assets-section";
  if (nodeId === TREE_NODE_IDS.THREE_D_OBJECTS) return "mesh-assets";
  if (nodeId === TREE_NODE_IDS.SCRIPTS) return "scripts-section";

  // MIR analysis nodes - check before MIR section (more specific pattern first)
  // Pattern: *:mir:analysisId (e.g., audio:mixdown:mir:spectralCentroid)
  if (nodeId.includes(":mir:")) return "mir-analysis";

  // MIR section nodes - ends with :mir
  // Pattern: *:mir (e.g., audio:mixdown:mir)
  if (nodeId.endsWith(":mir")) return "mir-section";

  // Bands section nodes - ends with :bands
  // Pattern: *:bands (e.g., audio:mixdown:bands, audio:stem:abc123:bands)
  if (nodeId.endsWith(":bands")) return "bands-section";

  // Audio children
  if (nodeId === TREE_NODE_IDS.MIXDOWN) return "audio-mixdown";
  if (nodeId === TREE_NODE_IDS.STEMS) return "stems-section";
  if (nodeId.startsWith("audio:stem:") && !nodeId.includes(":band:")) {
    return "audio-stem";
  }

  // Band nodes (under :bands: section) - but not band MIR nodes
  // Pattern: *:bands:bandId (e.g., audio:mixdown:bands:abc123)
  if (nodeId.includes(":bands:") && !nodeId.includes(":mir")) return "band";

  // Event stream children
  if (nodeId === TREE_NODE_IDS.AUTHORED_EVENTS) return "authored-events";
  if (nodeId === TREE_NODE_IDS.CANDIDATE_EVENTS) return "candidate-events";

  // Individual event stream nodes
  // Pattern: event-streams:authored:streamId or event-streams:candidates:streamId
  if (nodeId.startsWith("event-streams:authored:")) return "authored-stream";
  if (nodeId.startsWith("event-streams:candidates:")) return "candidate-stream";

  // Derived signal nodes
  if (nodeId.startsWith("derived-signals:")) return "derived-signal";

  // Composed signal nodes
  if (nodeId.startsWith("composed-signals:")) return "composed-signal";

  // Script nodes
  if (nodeId.startsWith("scripts:")) return "script";

  return "unknown";
}

/**
 * Extract the source ID from an audio-related node ID.
 *
 * @param nodeId - The tree node ID
 * @returns The source ID (e.g., "mixdown" or stem ID) or null
 */
export function getAudioSourceId(nodeId: string): string | null {
  if (nodeId === TREE_NODE_IDS.MIXDOWN || nodeId.startsWith("audio:mixdown:")) {
    return "mixdown";
  }
  if (nodeId.startsWith("audio:stem:")) {
    // Extract stem ID from patterns like "audio:stem:abc123" or "audio:stem:abc123:band:xyz"
    const parts = nodeId.split(":");
    if (parts.length >= 3 && parts[2]) {
      return parts[2];
    }
  }
  return null;
}

/**
 * Extract the band ID from a band node ID.
 * Pattern: *:bands:bandId or *:bands:bandId:mir:*
 *
 * @param nodeId - The tree node ID
 * @returns The band ID or null
 */
export function getBandId(nodeId: string): string | null {
  if (nodeId.includes(":bands:")) {
    const parts = nodeId.split(":bands:");
    if (parts.length >= 2 && parts[1]) {
      // Get the first segment after :bands: (the band ID)
      return parts[1].split(":")[0] ?? null;
    }
  }
  return null;
}

/**
 * Extract the script ID from a script node ID.
 *
 * @param nodeId - The tree node ID
 * @returns The script ID or null
 */
export function getScriptId(nodeId: string): string | null {
  if (nodeId.startsWith("scripts:")) {
    return nodeId.slice("scripts:".length);
  }
  return null;
}

/**
 * Extract the MIR analysis ID from a MIR analysis node ID.
 *
 * @param nodeId - The tree node ID (e.g., "audio:mixdown:mir:spectralCentroid")
 * @returns The analysis ID (e.g., "spectralCentroid") or null
 */
export function getMirAnalysisId(nodeId: string): string | null {
  if (!nodeId.includes(":mir:")) return null;
  const parts = nodeId.split(":mir:");
  if (parts.length >= 2 && parts[1]) {
    // The analysis ID is everything after ":mir:"
    return parts[1];
  }
  return null;
}

/**
 * Extract the derived signal ID from a derived signal node ID.
 *
 * @param nodeId - The tree node ID (e.g., "derived-signals:abc123")
 * @returns The derived signal ID or null
 */
export function getDerivedSignalId(nodeId: string): string | null {
  if (nodeId.startsWith("derived-signals:")) {
    return nodeId.slice("derived-signals:".length);
  }
  return null;
}

/**
 * Extract the composed signal ID from a composed signal node ID.
 *
 * @param nodeId - The tree node ID (e.g., "composed-signals:abc123")
 * @returns The composed signal ID or null
 */
export function getComposedSignalId(nodeId: string): string | null {
  if (nodeId.startsWith("composed-signals:")) {
    return nodeId.slice("composed-signals:".length);
  }
  return null;
}

/**
 * Extract the authored stream ID from an authored stream node ID.
 *
 * @param nodeId - The tree node ID (e.g., "event-streams:authored:abc123")
 * @returns The stream ID or null
 */
export function getAuthoredStreamId(nodeId: string): string | null {
  if (nodeId.startsWith("event-streams:authored:")) {
    return nodeId.slice("event-streams:authored:".length);
  }
  return null;
}

/**
 * Extract the candidate stream ID from a candidate stream node ID.
 *
 * @param nodeId - The tree node ID (e.g., "event-streams:candidates:abc123")
 * @returns The stream ID or null
 */
export function getCandidateStreamId(nodeId: string): string | null {
  if (nodeId.startsWith("event-streams:candidates:")) {
    return nodeId.slice("event-streams:candidates:".length);
  }
  return null;
}
