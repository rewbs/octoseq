"use client";

import { getInspectorNodeType, getAudioSourceId, getMirAnalysisId } from "@/lib/nodeTypes";
import { ProjectInspector } from "./ProjectInspector";
import { AudioSourceInspector } from "./AudioSourceInspector";
import { StemsInspector } from "./StemsInspector";
import { BandsInspector } from "./BandsInspector";
import { BandInspector } from "./BandInspector";
import { AuthoredEventsInspector } from "./AuthoredEventsInspector";
import { AuthoredStreamInspector } from "./AuthoredStreamInspector";
import { CandidateEventsInspector } from "./CandidateEventsInspector";
import { DerivedSignalsInspector } from "@/components/derivedSignal/DerivedSignalsInspector";
import { ComposedSignalInspector } from "@/components/composedSignal/ComposedSignalInspector";
import { MeshAssetsInspector } from "@/components/meshAssets";
import { ScriptInspector } from "./ScriptInspector";
import { ScriptsInspector } from "./ScriptsInspector";

interface InspectorContentProps {
  nodeId: string;
}

/**
 * Routes to the appropriate inspector view based on the selected node type.
 */
export function InspectorContent({ nodeId }: InspectorContentProps) {
  const nodeType = getInspectorNodeType(nodeId);
  const sourceId = getAudioSourceId(nodeId);

  switch (nodeType) {
    case "project":
      return <ProjectInspector />;

    case "audio-section":
      // Audio section itself - show general audio info
      return (
        <div className="p-4 text-sm text-zinc-500 dark:text-zinc-400">
          Select an audio source (Mixdown or a Stem) to manage frequency bands.
        </div>
      );

    case "audio-mixdown":
    case "audio-stem":
      return <AudioSourceInspector sourceId={sourceId ?? "mixdown"} />;

    case "stems-section":
      return <StemsInspector />;

    case "bands-section":
      return <BandsInspector nodeId={nodeId} />;

    case "band":
      return <BandInspector nodeId={nodeId} />;

    case "mir-section": {
      // Check if this is a band's MIR section (contains :bands:)
      if (nodeId.includes(":bands:")) {
        return <BandInspector nodeId={nodeId} />;
      }
      // Audio source MIR section - show the audio source inspector with Run All Analyses
      return <AudioSourceInspector sourceId={sourceId ?? "mixdown"} />;
    }

    case "mir-analysis": {
      // Check if this is a band's MIR analysis (contains :bands:)
      if (nodeId.includes(":bands:")) {
        return <BandInspector nodeId={nodeId} />;
      }
      // For melSpectrogram on audio sources, show BandsInspector
      const analysisId = getMirAnalysisId(nodeId);
      if (analysisId === "melSpectrogram") {
        return <BandsInspector nodeId={nodeId} />;
      }
      // For other analyses, show the audio source inspector
      return <AudioSourceInspector sourceId={sourceId ?? "mixdown"} />;
    }

    case "event-streams-section":
      return (
        <div className="p-4 text-sm text-zinc-500 dark:text-zinc-400">
          Select Authored or Candidates to manage event streams.
        </div>
      );

    case "authored-events":
      return <AuthoredEventsInspector />;

    case "authored-stream":
      return <AuthoredStreamInspector nodeId={nodeId} />;

    case "candidate-events":
      return <CandidateEventsInspector />;

    case "candidate-stream":
      // For now, show the same as the parent section
      // TODO: Add CandidateStreamInspector for individual candidate stream details
      return <CandidateEventsInspector />;

    case "derived-signals-section":
    case "derived-signal":
      return <DerivedSignalsInspector nodeId={nodeId} />;

    case "composed-signals-section":
    case "composed-signal":
      return <ComposedSignalInspector nodeId={nodeId} />;

    case "assets-section":
      return (
        <div className="p-4 text-sm text-zinc-500 dark:text-zinc-400">
          Select an asset type to manage assets.
        </div>
      );

    case "mesh-assets":
      return <MeshAssetsInspector />;

    case "scripts-section":
      return <ScriptsInspector />;

    case "script":
      return <ScriptInspector nodeId={nodeId} />;

    default:
      return (
        <div className="p-4 text-sm text-zinc-500 dark:text-zinc-400">
          Select a node in the tree to see its details.
        </div>
      );
  }
}
