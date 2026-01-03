/**
 * Project Store
 *
 * Manages the active project and provides orchestration for save/load.
 * The Project is the root organizational entity that owns all interpretation work.
 */

import { nanoid } from "nanoid";
import { create } from "zustand";
import { devtools } from "zustand/middleware";

import type { FrequencyBandStructure, MusicalTimeStructure } from "@octoseq/mir";
import type { AuthoredEventStream } from "./types/authoredEvent";
import type { CustomSignalStructure } from "./types/customSignal";
import type { MeshAssetStructure } from "./types/meshAsset";
import type {
  Project,
  ProjectAudioCollection,
  ProjectAudioReference,
  ProjectBeatGridState,
  ProjectScript,
  ProjectSerialized,
  ProjectUIState,
  AudioLoadStatus,
} from "./types/project";
import { validateProject, validateProjectIds } from "@/lib/projectValidation";
import { DEFAULT_SCRIPT } from "../scripting/defaultScripts";

// ----------------------------
// Store State
// ----------------------------

interface ProjectState {
  /** Currently active project (null if none). */
  activeProject: Project | null;

  /** Whether there are unsaved changes. */
  isDirty: boolean;

  /** Whether to suppress dirty marking (during hydration/initialization). */
  suppressDirty: boolean;

  /** Audio load state when importing a project. */
  audioLoadStatus: Map<string, AudioLoadStatus>;

  /** Audio load errors. */
  audioLoadErrors: Map<string, string>;

  /** Whether a project operation is in progress. */
  isLoading: boolean;

  /** File handle from File System Access API (for "Save" behavior). */
  fileHandle: FileSystemFileHandle | null;

  /** Last saved file name (for display and fallback). */
  lastSavedFileName: string | null;
}

// ----------------------------
// Store Actions
// ----------------------------

interface ProjectActions {
  // ----------------------------
  // Project Lifecycle
  // ----------------------------

  /**
   * Create a new empty project.
   * @returns The new project ID.
   */
  createProject: (name?: string) => string;

  /**
   * Reset/clear the current project.
   * Returns to no-project state.
   */
  resetProject: () => void;

  /**
   * Close the current project without saving.
   */
  closeProject: () => void;

  // ----------------------------
  // Metadata
  // ----------------------------

  /** Rename the current project. */
  renameProject: (name: string) => void;

  /** Mark project as having unsaved changes. */
  markDirty: () => void;

  /** Mark project as saved (no unsaved changes). */
  markClean: () => void;

  /** Suppress dirty marking (for hydration/initialization). */
  setSuppressDirty: (suppress: boolean) => void;

  // ----------------------------
  // State Synchronization
  // These are called by other stores when their data changes.
  // ----------------------------

  /** Sync audio references from audioInputStore. */
  syncAudioReferences: (collection: ProjectAudioCollection) => void;

  /** Sync frequency bands from frequencyBandStore. */
  syncFrequencyBands: (structure: FrequencyBandStructure | null) => void;

  /** Sync musical time from musicalTimeStore. */
  syncMusicalTime: (structure: MusicalTimeStructure | null) => void;

  /** Sync authored events from authoredEventStore. */
  syncAuthoredEvents: (streams: AuthoredEventStream[]) => void;

  /** Sync beat grid state from beatGridStore. */
  syncBeatGrid: (state: ProjectBeatGridState | null) => void;

  /** Sync custom signals from customSignalStore. */
  syncCustomSignals: (structure: CustomSignalStructure | null) => void;

  /** Sync mesh assets from meshAssetStore. */
  syncMeshAssets: (structure: MeshAssetStructure | null) => void;

  /** Sync scripts. */
  syncScripts: (scripts: ProjectScript[], activeScriptId: string | null) => void;

  /** Sync a single script's content (for autosave). */
  syncScriptContent: (scriptId: string, content: string) => void;

  /** Sync UI state from interpretationTreeStore. */
  syncUIState: (state: Partial<ProjectUIState>) => void;

  // ----------------------------
  // Script Management
  // ----------------------------

  /** Add a new script to the project. */
  addScript: (name?: string, content?: string) => string | null;

  /** Remove a script from the project. */
  removeScript: (scriptId: string) => void;

  /** Rename a script. */
  renameScript: (scriptId: string, name: string) => void;

  /** Set the active script. */
  setActiveScript: (scriptId: string | null) => void;

  /** Get a script by ID. */
  getScript: (scriptId: string) => ProjectScript | undefined;

  /** Get the active script. */
  getActiveScript: () => ProjectScript | undefined;

  // ----------------------------
  // Serialization
  // ----------------------------

  /** Export the current project to JSON string. */
  exportToJson: () => string | null;

  /** Import a project from JSON string. Does NOT hydrate stores - caller must do that. */
  importFromJson: (json: string) => Project | null;

  /** Set the active project (for use after loading). */
  setActiveProject: (project: Project) => void;

  // ----------------------------
  // File Handle (File System Access API)
  // ----------------------------

  /** Set the file handle for File System Access API saves. */
  setFileHandle: (handle: FileSystemFileHandle | null) => void;

  /** Set the last saved file name. */
  setLastSavedFileName: (name: string | null) => void;

  // ----------------------------
  // Audio Load State
  // ----------------------------

  /** Set audio load status for an input. */
  setAudioLoadStatus: (inputId: string, status: AudioLoadStatus, error?: string) => void;

  /** Clear all audio load state. */
  clearAudioLoadState: () => void;

  /** Get pending audio loads. */
  getPendingAudioLoads: () => ProjectAudioReference[];

  /** Get failed audio loads. */
  getFailedAudioLoads: () => Array<{ ref: ProjectAudioReference; error: string }>;

  // ----------------------------
  // Queries
  // ----------------------------

  /** Check if a project is loaded. */
  isProjectLoaded: () => boolean;

  /** Get the active project ID. */
  getActiveProjectId: () => string | null;

  /** Get project stats for display. */
  getProjectStats: () => {
    bandCount: number;
    eventStreamCount: number;
    eventCount: number;
    scriptCount: number;
    hasMusicalTime: boolean;
    hasBeatGrid: boolean;
  };
}

export type ProjectStore = ProjectState & ProjectActions;

// ----------------------------
// Initial State
// ----------------------------

const initialState: ProjectState = {
  activeProject: null,
  isDirty: false,
  suppressDirty: false,
  audioLoadStatus: new Map(),
  audioLoadErrors: new Map(),
  isLoading: false,
  fileHandle: null,
  lastSavedFileName: null,
};

// ----------------------------
// Store Implementation
// ----------------------------

export const useProjectStore = create<ProjectStore>()(
  devtools(
    (set, get) => ({
      ...initialState,

      // ----------------------------
      // Project Lifecycle
      // ----------------------------

      createProject: (name = "Untitled Project") => {
        const now = new Date().toISOString();
        const projectId = nanoid();

        // Create a default script
        const defaultScriptId = nanoid();
        const defaultScript: ProjectScript = {
          id: defaultScriptId,
          name: "Main",
          content: DEFAULT_SCRIPT,
          createdAt: now,
          modifiedAt: now,
        };

        const project: Project = {
          id: projectId,
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
            scripts: [defaultScript],
            activeScriptId: defaultScriptId,
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

        set(
          {
            activeProject: project,
            isDirty: false,
            audioLoadStatus: new Map(),
            audioLoadErrors: new Map(),
            fileHandle: null,
            lastSavedFileName: null,
          },
          false,
          "createProject"
        );

        return projectId;
      },

      resetProject: () => {
        set(
          {
            activeProject: null,
            isDirty: false,
            audioLoadStatus: new Map(),
            audioLoadErrors: new Map(),
            fileHandle: null,
            lastSavedFileName: null,
          },
          false,
          "resetProject"
        );
      },

      closeProject: () => {
        set(
          {
            activeProject: null,
            isDirty: false,
            audioLoadStatus: new Map(),
            audioLoadErrors: new Map(),
            fileHandle: null,
            lastSavedFileName: null,
          },
          false,
          "closeProject"
        );
      },

      // ----------------------------
      // Metadata
      // ----------------------------

      renameProject: (name) => {
        const project = get().activeProject;
        if (!project) return;

        set(
          (state) => ({
            activeProject: state.activeProject
              ? {
                ...state.activeProject,
                name,
                modifiedAt: new Date().toISOString(),
              }
              : null,
            isDirty: true,
          }),
          false,
          "renameProject"
        );
      },

      markDirty: () => {
        if (!get().activeProject) return;
        set({ isDirty: true }, false, "markDirty");
      },

      markClean: () => {
        set({ isDirty: false }, false, "markClean");
      },

      setSuppressDirty: (suppress) => {
        set({ suppressDirty: suppress }, false, "setSuppressDirty");
      },

      // ----------------------------
      // State Synchronization
      // ----------------------------

      syncAudioReferences: (collection) => {
        const { activeProject, suppressDirty } = get();
        if (!activeProject) return;

        set(
          (state) => ({
            activeProject: state.activeProject
              ? {
                ...state.activeProject,
                audio: collection,
                modifiedAt: new Date().toISOString(),
              }
              : null,
            isDirty: suppressDirty ? state.isDirty : true,
          }),
          false,
          "syncAudioReferences"
        );
      },

      syncFrequencyBands: (structure) => {
        const { activeProject, suppressDirty } = get();
        if (!activeProject) return;

        set(
          (state) => ({
            activeProject: state.activeProject
              ? {
                ...state.activeProject,
                interpretation: {
                  ...state.activeProject.interpretation,
                  frequencyBands: structure,
                },
                modifiedAt: new Date().toISOString(),
              }
              : null,
            isDirty: suppressDirty ? state.isDirty : true,
          }),
          false,
          "syncFrequencyBands"
        );
      },

      syncMusicalTime: (structure) => {
        const { activeProject, suppressDirty } = get();
        if (!activeProject) return;

        set(
          (state) => ({
            activeProject: state.activeProject
              ? {
                ...state.activeProject,
                interpretation: {
                  ...state.activeProject.interpretation,
                  musicalTime: structure,
                },
                modifiedAt: new Date().toISOString(),
              }
              : null,
            isDirty: suppressDirty ? state.isDirty : true,
          }),
          false,
          "syncMusicalTime"
        );
      },

      syncAuthoredEvents: (streams) => {
        const { activeProject, suppressDirty } = get();
        if (!activeProject) return;

        set(
          (state) => ({
            activeProject: state.activeProject
              ? {
                ...state.activeProject,
                interpretation: {
                  ...state.activeProject.interpretation,
                  authoredEvents: streams,
                },
                modifiedAt: new Date().toISOString(),
              }
              : null,
            isDirty: suppressDirty ? state.isDirty : true,
          }),
          false,
          "syncAuthoredEvents"
        );
      },

      syncBeatGrid: (beatGridState) => {
        const { activeProject, suppressDirty } = get();
        if (!activeProject) return;

        set(
          (state) => ({
            activeProject: state.activeProject
              ? {
                ...state.activeProject,
                interpretation: {
                  ...state.activeProject.interpretation,
                  beatGrid: beatGridState,
                },
                modifiedAt: new Date().toISOString(),
              }
              : null,
            isDirty: suppressDirty ? state.isDirty : true,
          }),
          false,
          "syncBeatGrid"
        );
      },

      syncCustomSignals: (structure) => {
        const { activeProject, suppressDirty } = get();
        if (!activeProject) return;

        set(
          (state) => ({
            activeProject: state.activeProject
              ? {
                ...state.activeProject,
                interpretation: {
                  ...state.activeProject.interpretation,
                  customSignals: structure,
                },
                modifiedAt: new Date().toISOString(),
              }
              : null,
            isDirty: suppressDirty ? state.isDirty : true,
          }),
          false,
          "syncCustomSignals"
        );
      },

      syncMeshAssets: (structure) => {
        const { activeProject, suppressDirty } = get();
        if (!activeProject) return;

        set(
          (state) => ({
            activeProject: state.activeProject
              ? {
                ...state.activeProject,
                meshAssets: structure,
                modifiedAt: new Date().toISOString(),
              }
              : null,
            isDirty: suppressDirty ? state.isDirty : true,
          }),
          false,
          "syncMeshAssets"
        );
      },

      syncScripts: (scripts, activeScriptId) => {
        const { activeProject, suppressDirty } = get();
        if (!activeProject) return;

        set(
          (state) => ({
            activeProject: state.activeProject
              ? {
                ...state.activeProject,
                scripts: {
                  scripts,
                  activeScriptId,
                },
                modifiedAt: new Date().toISOString(),
              }
              : null,
            isDirty: suppressDirty ? state.isDirty : true,
          }),
          false,
          "syncScripts"
        );
      },

      syncScriptContent: (scriptId, content) => {
        const { activeProject, suppressDirty } = get();
        if (!activeProject) return;

        const now = new Date().toISOString();
        const updatedScripts = activeProject.scripts.scripts.map((s) =>
          s.id === scriptId ? { ...s, content, modifiedAt: now } : s
        );

        set(
          (state) => ({
            activeProject: state.activeProject
              ? {
                ...state.activeProject,
                scripts: {
                  ...state.activeProject.scripts,
                  scripts: updatedScripts,
                },
                modifiedAt: now,
              }
              : null,
            isDirty: suppressDirty ? state.isDirty : true,
          }),
          false,
          "syncScriptContent"
        );
      },

      syncUIState: (uiState) => {
        const { activeProject, suppressDirty } = get();
        if (!activeProject) return;

        set(
          (state) => ({
            activeProject: state.activeProject
              ? {
                ...state.activeProject,
                uiState: {
                  ...state.activeProject.uiState,
                  ...uiState,
                },
                modifiedAt: new Date().toISOString(),
              }
              : null,
            isDirty: suppressDirty ? state.isDirty : true,
          }),
          false,
          "syncUIState"
        );
      },

      // ----------------------------
      // Script Management
      // ----------------------------

      addScript: (name = "New Script", content = "") => {
        const project = get().activeProject;
        if (!project) return null;

        const now = new Date().toISOString();
        const scriptId = nanoid();

        const newScript: ProjectScript = {
          id: scriptId,
          name,
          content: content || `// ${name}\n`,
          createdAt: now,
          modifiedAt: now,
        };

        set(
          (state) => ({
            activeProject: state.activeProject
              ? {
                ...state.activeProject,
                scripts: {
                  scripts: [...state.activeProject.scripts.scripts, newScript],
                  activeScriptId: scriptId, // Auto-activate new script
                },
                modifiedAt: now,
              }
              : null,
            isDirty: true,
          }),
          false,
          "addScript"
        );

        return scriptId;
      },

      removeScript: (scriptId) => {
        const project = get().activeProject;
        if (!project) return;

        const scripts = project.scripts.scripts.filter((s) => s.id !== scriptId);

        // If removing active script, activate first remaining or null
        let activeScriptId = project.scripts.activeScriptId;
        if (activeScriptId === scriptId) {
          activeScriptId = scripts[0]?.id ?? null;
        }

        set(
          (state) => ({
            activeProject: state.activeProject
              ? {
                ...state.activeProject,
                scripts: {
                  scripts,
                  activeScriptId,
                },
                modifiedAt: new Date().toISOString(),
              }
              : null,
            isDirty: true,
          }),
          false,
          "removeScript"
        );
      },

      renameScript: (scriptId, name) => {
        const project = get().activeProject;
        if (!project) return;

        const now = new Date().toISOString();
        const updatedScripts = project.scripts.scripts.map((s) =>
          s.id === scriptId ? { ...s, name, modifiedAt: now } : s
        );

        set(
          (state) => ({
            activeProject: state.activeProject
              ? {
                ...state.activeProject,
                scripts: {
                  ...state.activeProject.scripts,
                  scripts: updatedScripts,
                },
                modifiedAt: now,
              }
              : null,
            isDirty: true,
          }),
          false,
          "renameScript"
        );
      },

      setActiveScript: (scriptId) => {
        const project = get().activeProject;
        if (!project) return;

        set(
          (state) => ({
            activeProject: state.activeProject
              ? {
                ...state.activeProject,
                scripts: {
                  ...state.activeProject.scripts,
                  activeScriptId: scriptId,
                },
                modifiedAt: new Date().toISOString(),
              }
              : null,
            isDirty: true,
          }),
          false,
          "setActiveScript"
        );
      },

      getScript: (scriptId) => {
        return get().activeProject?.scripts.scripts.find((s) => s.id === scriptId);
      },

      getActiveScript: () => {
        const project = get().activeProject;
        if (!project || !project.scripts.activeScriptId) return undefined;
        return project.scripts.scripts.find(
          (s) => s.id === project.scripts.activeScriptId
        );
      },

      // ----------------------------
      // Serialization
      // ----------------------------

      exportToJson: () => {
        const project = get().activeProject;
        if (!project) return null;

        const serialized: ProjectSerialized = {
          version: 1,
          project: {
            ...project,
            modifiedAt: new Date().toISOString(),
          },
        };

        return JSON.stringify(serialized, null, 2);
      },

      importFromJson: (json) => {
        try {
          const parsed = JSON.parse(json);

          // Validate and migrate project
          const validation = validateProject(parsed);

          if (!validation.valid) {
            console.error("Project validation failed:", validation.errors);
            return null;
          }

          if (validation.warnings.length > 0) {
            console.warn("Project loaded with warnings:", validation.warnings);
          }

          const project = validation.project!;

          // Check for duplicate IDs
          const idWarnings = validateProjectIds(project);
          if (idWarnings.length > 0) {
            console.warn("Project has duplicate IDs:", idWarnings);
          }

          return project;
        } catch (error) {
          console.error("Failed to parse project JSON:", error);
          return null;
        }
      },

      setActiveProject: (project) => {
        set(
          {
            activeProject: project,
            isDirty: false,
            audioLoadStatus: new Map(),
            audioLoadErrors: new Map(),
          },
          false,
          "setActiveProject"
        );
      },

      // ----------------------------
      // File Handle (File System Access API)
      // ----------------------------

      setFileHandle: (handle) => {
        set({ fileHandle: handle }, false, "setFileHandle");
      },

      setLastSavedFileName: (name) => {
        set({ lastSavedFileName: name }, false, "setLastSavedFileName");
      },

      // ----------------------------
      // Audio Load State
      // ----------------------------

      setAudioLoadStatus: (inputId, status, error) => {
        set(
          (state) => {
            const newStatus = new Map(state.audioLoadStatus);
            newStatus.set(inputId, status);

            const newErrors = new Map(state.audioLoadErrors);
            if (error) {
              newErrors.set(inputId, error);
            } else {
              newErrors.delete(inputId);
            }

            return {
              audioLoadStatus: newStatus,
              audioLoadErrors: newErrors,
            };
          },
          false,
          "setAudioLoadStatus"
        );
      },

      clearAudioLoadState: () => {
        set(
          {
            audioLoadStatus: new Map(),
            audioLoadErrors: new Map(),
          },
          false,
          "clearAudioLoadState"
        );
      },

      getPendingAudioLoads: () => {
        const project = get().activeProject;
        if (!project) return [];

        const status = get().audioLoadStatus;
        const pending: ProjectAudioReference[] = [];

        if (project.audio.mixdown) {
          const mixdownStatus = status.get(project.audio.mixdown.id);
          if (!mixdownStatus || mixdownStatus === "pending" || mixdownStatus === "failed") {
            pending.push(project.audio.mixdown);
          }
        }

        for (const stem of project.audio.stems) {
          const stemStatus = status.get(stem.id);
          if (!stemStatus || stemStatus === "pending" || stemStatus === "failed") {
            pending.push(stem);
          }
        }

        return pending;
      },

      getFailedAudioLoads: () => {
        const project = get().activeProject;
        if (!project) return [];

        const status = get().audioLoadStatus;
        const errors = get().audioLoadErrors;
        const failed: Array<{ ref: ProjectAudioReference; error: string }> = [];

        if (project.audio.mixdown) {
          const mixdownStatus = status.get(project.audio.mixdown.id);
          if (mixdownStatus === "failed") {
            failed.push({
              ref: project.audio.mixdown,
              error: errors.get(project.audio.mixdown.id) ?? "Unknown error",
            });
          }
        }

        for (const stem of project.audio.stems) {
          const stemStatus = status.get(stem.id);
          if (stemStatus === "failed") {
            failed.push({
              ref: stem,
              error: errors.get(stem.id) ?? "Unknown error",
            });
          }
        }

        return failed;
      },

      // ----------------------------
      // Queries
      // ----------------------------

      isProjectLoaded: () => get().activeProject !== null,

      getActiveProjectId: () => get().activeProject?.id ?? null,

      getProjectStats: () => {
        const project = get().activeProject;
        if (!project) {
          return {
            bandCount: 0,
            eventStreamCount: 0,
            eventCount: 0,
            scriptCount: 0,
            hasMusicalTime: false,
            hasBeatGrid: false,
          };
        }

        const eventCount = project.interpretation.authoredEvents.reduce(
          (sum, stream) => sum + stream.events.length,
          0
        );

        return {
          bandCount: project.interpretation.frequencyBands?.bands.length ?? 0,
          eventStreamCount: project.interpretation.authoredEvents.length,
          eventCount,
          scriptCount: project.scripts.scripts.length,
          hasMusicalTime: (project.interpretation.musicalTime?.segments.length ?? 0) > 0,
          hasBeatGrid: project.interpretation.beatGrid?.activeBeatGrid !== null,
        };
      },
    }),
    { name: "project-store" }
  )
);
