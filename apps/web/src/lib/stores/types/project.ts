/**
 * Project Types
 *
 * A Project is the root organizational entity in Octoseq.
 * It encapsulates all interpretation work for a given audio piece.
 */

import type {
  MusicalTimeStructure,
  BeatGrid,
  TempoHypothesis,
  PhaseHypothesis,
  PhaseAlignmentConfig,
} from "@octoseq/mir";
import type { Stream } from "@/lib/streams";
import type { AuthoredEventStream } from "./authoredEvent";
import type { SubBeatDivision } from "../timingStore";
import type { DerivedSignalStructure } from "./derivedSignal";
import type { ComposedSignalStructure } from "./composedSignal";
import type { MeshAssetStructure } from "./meshAsset";
import { DEFAULT_SCRIPT } from "@/lib/scripting/defaultScripts";
import { nanoid } from "nanoid";

// ----------------------------
// Scripts
// ----------------------------

/**
 * A single script within the project.
 */
export interface ProjectScript {
  /** Unique identifier (nanoid). */
  id: string;
  /** User-editable name. */
  name: string;
  /** Rhai script content. */
  content: string;
  /** ISO timestamp when created. */
  createdAt: string;
  /** ISO timestamp when last modified. */
  modifiedAt: string;
}

/**
 * Project scripts collection.
 * Supports multiple named scripts with one active.
 */
export interface ProjectScripts {
  /** All scripts in the project. */
  scripts: ProjectScript[];
  /** ID of the currently active script (for visualiser). */
  activeScriptId: string | null;
}

// ----------------------------
// Beat Grid State
// ----------------------------

/**
 * Serializable beat grid state from the timing store (beat-grid section).
 * Saved even if not yet promoted to Musical Time.
 */
export interface ProjectBeatGridState {
  /** Currently selected tempo hypothesis. */
  selectedHypothesis: TempoHypothesis | null;
  /** Computed phase hypotheses for the selected tempo. */
  phaseHypotheses: PhaseHypothesis[];
  /** Index of the active phase hypothesis. */
  activePhaseIndex: number;
  /** The active beat grid. */
  activeBeatGrid: BeatGrid | null;
  /** User nudge offset in seconds. */
  userNudge: number;
  /** Whether the beat grid is locked. */
  isLocked: boolean;
  /** Whether beat grid overlay is visible. */
  isVisible: boolean;
  /** Whether metronome is enabled. */
  metronomeEnabled: boolean;
  /** Configuration for phase alignment. */
  config: Required<PhaseAlignmentConfig>;
  /** Sub-beat division. */
  subBeatDivision: SubBeatDivision;
}

// ----------------------------
// Interpretation Data
// ----------------------------

/**
 * Project interpretation data - the authored analysis results.
 * This is the core of what makes a project valuable.
 */
export interface ProjectInterpretation {
  /** Musical time structure (promoted beat grids). */
  musicalTime: MusicalTimeStructure | null;
  /** Authored event streams. */
  authoredEvents: AuthoredEventStream[];
  /** Active beat grid state (even if not promoted). */
  beatGrid: ProjectBeatGridState | null;
  /** Derived signal definitions for interpretation-layer signal extraction. */
  derivedSignals: DerivedSignalStructure | null;
  /** Composed signal definitions for human-authored interpretation curves. */
  composedSignals: ComposedSignalStructure | null;
}

// ----------------------------
// UI State
// ----------------------------

/**
 * Project UI state that should be persisted.
 * Minimal set needed to restore user's workspace.
 */
export interface ProjectUIState {
  /** Expanded nodes in the interpretation tree. */
  treeExpandedNodes: string[];
  /** Selected node in the interpretation tree. */
  treeSelectedNodeId: string | null;
  /** Sidebar width in pixels. */
  sidebarWidth: number;
  /** Inspector panel height in pixels. */
  inspectorHeight: number;
  /** Last playhead position in seconds (for restoring on reload). */
  lastPlayheadPosition: number;
}

// ----------------------------
// Project Entity
// ----------------------------

/**
 * The complete Project entity.
 *
 * A Project is the root organizational unit in Octoseq.
 * It encapsulates all interpretation work for a given audio piece.
 *
 * Design constraints:
 * - Projects own references, not raw data (audio buffers are runtime-only)
 * - Projects are explicitly authored, not auto-generated
 * - Projects are the unit of save/load/share
 *
 * ## Persistence Boundary
 *
 * **Must Persist:**
 * - Project metadata (id, name, timestamps)
 * - Streams (mixdown/stems/bands; audio URLs are runtime-only and persist as null)
 * - Musical time, authored events, beat grid
 * - Custom signals (definitions, not cached results)
 * - Scripts (full content)
 * - Mesh assets (3D objects with OBJ content)
 * - UI state (tree, sidebar, inspector, playhead)
 *
 * **Must NOT Persist:**
 * - Candidate events (ephemeral proposals)
 * - Debug/probe signals
 * - Runtime caches (percentiles, FFT buffers, GPU resources)
 * - Playback running/paused state
 * - Audio buffers (decoded audio - runtime only)
 */
export interface Project {
  /** Stable unique identifier (nanoid). */
  id: string;
  /** User-editable project name. */
  name: string;
  /** ISO timestamp when created. */
  createdAt: string;
  /** ISO timestamp when last modified. */
  modifiedAt: string;

  /**
   * The full stream collection (mixdown, stems, and band streams).
   * AudioStreams persist with audio.url null (blob URLs are runtime-only);
   * decoded PCM never persists.
   */
  streams: Stream[];
  /** Authored interpretation data. */
  interpretation: ProjectInterpretation;
  /** Visualization scripts. */
  scripts: ProjectScripts;
  /** 3D mesh assets loaded into the project. */
  meshAssets: MeshAssetStructure | null;
  /** Persisted UI state. */
  uiState: ProjectUIState;
}

// ----------------------------
// Serialization
// ----------------------------

/**
 * Serialized project format for JSON export/import.
 * Versioned for future migrations.
 */
export interface ProjectSerialized {
  /** Schema version. v1 payloads are rejected (no migration). */
  version: 2;
  /** The project data. */
  project: Project;
}

// ----------------------------
// Audio Load State
// ----------------------------

/**
 * State of audio loading when importing a project.
 */
export type AudioLoadStatus = "pending" | "loading" | "loaded" | "failed";

/**
 * Audio load state for each input in the project.
 */
export interface AudioLoadState {
  /** Load status per audio input ID. */
  status: Map<string, AudioLoadStatus>;
  /** Error messages for failed loads. */
  errors: Map<string, string>;
}

// ----------------------------
// Factory Functions
// ----------------------------

/**
 * Create a new empty project with the given name.
 */
export function createEmptyProject(name: string): Project {
  const now = new Date().toISOString();

  return {
    id: nanoid(),
    name,
    createdAt: now,
    modifiedAt: now,
    streams: [],
    interpretation: {
      musicalTime: null,
      authoredEvents: [],
      beatGrid: null,
      derivedSignals: null,
      composedSignals: null,
    },
    scripts: {
      scripts: [],
      activeScriptId: null,
    },
    meshAssets: null,
    uiState: {
      treeExpandedNodes: ["project", "audio", "mixdown", "scripts"],
      treeSelectedNodeId: null,
      sidebarWidth: 280,
      inspectorHeight: 200,
      lastPlayheadPosition: 0,
    },
  };
}

/**
 * Create a default script for new projects.
 */
export function createDefaultScript(name: string = "Main"): ProjectScript {
  const now = new Date().toISOString();

  return {
    id: nanoid(),
    name,
    content: DEFAULT_SCRIPT,
    createdAt: now,
    modifiedAt: now,
  };
}
