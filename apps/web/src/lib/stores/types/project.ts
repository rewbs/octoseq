/**
 * Project Types
 *
 * A Project is the root organizational entity in Octoseq.
 * It encapsulates all interpretation work for a given audio piece.
 */

import type {
  FrequencyBandStructure,
  MusicalTimeStructure,
  BeatGrid,
  TempoHypothesis,
  PhaseHypothesis,
  PhaseAlignmentConfig,
} from "@octoseq/mir";
import type { AudioInputMetadata, AudioInputOrigin } from "./audioInput";
import type { AuthoredEventStream } from "./authoredEvent";
import type { SubBeatDivision } from "../beatGridStore";
import type { CustomSignalStructure } from "./customSignal";

// ----------------------------
// Audio References
// ----------------------------

/**
 * Reference to an audio input within a project.
 * Contains metadata for identification and re-import,
 * but not the actual AudioBuffer (which is runtime-only).
 */
export interface ProjectAudioReference {
  /** Original input ID (for linking). "mixdown" or nanoid for stems. */
  id: string;
  /** User-facing label. */
  label: string;
  /** Role in the collection. */
  role: "mixdown" | "stem";
  /** Audio metadata for identification. */
  metadata: AudioInputMetadata;
  /** Origin for re-import (file path, URL, etc.). */
  origin: AudioInputOrigin;
  /** Order index for stems. */
  orderIndex?: number;
}

/**
 * Project audio collection (references only, not buffers).
 */
export interface ProjectAudioCollection {
  /** Mixdown reference (required once audio is loaded). */
  mixdown: ProjectAudioReference | null;
  /** Stem references in order. */
  stems: ProjectAudioReference[];
}

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
 * Serializable beat grid state from beatGridStore.
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
  /** Frequency band structure. */
  frequencyBands: FrequencyBandStructure | null;
  /** Musical time structure (promoted beat grids). */
  musicalTime: MusicalTimeStructure | null;
  /** Authored event streams. */
  authoredEvents: AuthoredEventStream[];
  /** Active beat grid state (even if not promoted). */
  beatGrid: ProjectBeatGridState | null;
  /** Custom signal definitions for 2D→1D extraction. */
  customSignals: CustomSignalStructure | null;
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

  /** Audio references (metadata only, not buffers). */
  audio: ProjectAudioCollection;
  /** Authored interpretation data. */
  interpretation: ProjectInterpretation;
  /** Visualization scripts. */
  scripts: ProjectScripts;
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
  /** Schema version for migrations. */
  version: 1;
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
  const { nanoid } = require("nanoid");

  return {
    id: nanoid(),
    name,
    createdAt: now,
    modifiedAt: now,
    audio: {
      mixdown: null,
      stems: [],
    },
    interpretation: {
      frequencyBands: null,
      musicalTime: null,
      authoredEvents: [],
      beatGrid: null,
      customSignals: null,
    },
    scripts: {
      scripts: [],
      activeScriptId: null,
    },
    uiState: {
      treeExpandedNodes: ["project", "audio", "mixdown", "scripts"],
      treeSelectedNodeId: null,
      sidebarWidth: 280,
    },
  };
}

/**
 * Create a default script for new projects.
 */
export function createDefaultScript(name: string = "Main"): ProjectScript {
  const now = new Date().toISOString();
  const { nanoid } = require("nanoid");

  return {
    id: nanoid(),
    name,
    content: `// ${name} script
// Use 'inputs' to access audio signals and bands
// Use 'scene' to add entities for rendering

let t = inputs.time;
`,
    createdAt: now,
    modifiedAt: now,
  };
}
