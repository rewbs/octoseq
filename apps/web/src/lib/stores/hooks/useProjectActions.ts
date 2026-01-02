"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useProjectStore } from "../projectStore";
import { useFrequencyBandStore } from "../frequencyBandStore";
import { useMusicalTimeStore } from "../musicalTimeStore";
import { useAuthoredEventStore } from "../authoredEventStore";
import { useBeatGridStore } from "../beatGridStore";
import { useInterpretationTreeStore } from "../interpretationTreeStore";
import { useAudioInputStore } from "../audioInputStore";
import { useCustomSignalStore } from "../customSignalStore";
import { useMeshAssetStore } from "../meshAssetStore";
import { usePlaybackStore } from "../playbackStore";
import { useAutosaveStore } from "../autosaveStore";
import { useAutosave } from "./useAutosave";
import { clearAutosave } from "../../persistence/autosave";
import type { ProjectAudioCollection, ProjectAudioReference, ProjectBeatGridState } from "../types/project";
import type { AuthoredEventStream } from "../types/authoredEvent";
import type { AutosaveRecord } from "../../persistence/types";

/**
 * Hook that provides project lifecycle actions and sets up store synchronization.
 *
 * This hook:
 * 1. Provides actions for creating, saving, and loading projects
 * 2. Subscribes to other stores to sync their data to the project
 * 3. Handles hydration of stores when a project is loaded
 */
export function useProjectActions() {
  const createProject = useProjectStore((s) => s.createProject);
  const resetProject = useProjectStore((s) => s.resetProject);
  const renameProject = useProjectStore((s) => s.renameProject);
  const exportToJson = useProjectStore((s) => s.exportToJson);
  const importFromJson = useProjectStore((s) => s.importFromJson);
  const setActiveProject = useProjectStore((s) => s.setActiveProject);
  const activeProject = useProjectStore((s) => s.activeProject);
  const isDirty = useProjectStore((s) => s.isDirty);
  const markClean = useProjectStore((s) => s.markClean);

  // Autosave state
  const autosaveStatus = useAutosaveStore((s) => s.status);
  const lastAutosaveAt = useAutosaveStore((s) => s.lastSavedAt);
  const wasRecovered = useAutosaveStore((s) => s.wasRecovered);
  const clearRecovered = useAutosaveStore((s) => s.clearRecovered);

  // Track if initial sync has been done
  const initialSyncDone = useRef(false);

  // Pending recovery state
  const [pendingRecovery, setPendingRecovery] = useState<AutosaveRecord | null>(null);

  // ----------------------------
  // Store Sync Subscriptions
  // ----------------------------

  useEffect(() => {
    // Subscribe to frequency band changes
    const unsubBands = useFrequencyBandStore.subscribe((state, prevState) => {
      if (state.structure !== prevState.structure && useProjectStore.getState().activeProject) {
        useProjectStore.getState().syncFrequencyBands(state.structure);
      }
    });

    // Subscribe to musical time changes
    const unsubMusicalTime = useMusicalTimeStore.subscribe((state, prevState) => {
      if (state.structure !== prevState.structure && useProjectStore.getState().activeProject) {
        useProjectStore.getState().syncMusicalTime(state.structure);
      }
    });

    // Subscribe to authored events changes
    const unsubAuthored = useAuthoredEventStore.subscribe((state, prevState) => {
      if (state.streams !== prevState.streams && useProjectStore.getState().activeProject) {
        const streams = Array.from(state.streams.values());
        useProjectStore.getState().syncAuthoredEvents(streams);
      }
    });

    // Subscribe to beat grid changes
    const unsubBeatGrid = useBeatGridStore.subscribe((state, prevState) => {
      const relevantChange =
        state.activeBeatGrid !== prevState.activeBeatGrid ||
        state.selectedHypothesis !== prevState.selectedHypothesis ||
        state.isLocked !== prevState.isLocked ||
        state.userNudge !== prevState.userNudge;

      if (relevantChange && useProjectStore.getState().activeProject) {
        const beatGridState: ProjectBeatGridState = {
          selectedHypothesis: state.selectedHypothesis,
          phaseHypotheses: state.phaseHypotheses,
          activePhaseIndex: state.activePhaseIndex,
          activeBeatGrid: state.activeBeatGrid,
          userNudge: state.userNudge,
          isLocked: state.isLocked,
          isVisible: state.isVisible,
          metronomeEnabled: state.metronomeEnabled,
          config: state.config,
          subBeatDivision: state.subBeatDivision,
        };
        useProjectStore.getState().syncBeatGrid(beatGridState);
      }
    });

    // Subscribe to tree state changes
    const unsubTree = useInterpretationTreeStore.subscribe((state, prevState) => {
      const relevantChange =
        state.expandedNodes !== prevState.expandedNodes ||
        state.selectedNodeId !== prevState.selectedNodeId ||
        state.sidebarWidth !== prevState.sidebarWidth ||
        state.inspectorHeight !== prevState.inspectorHeight;

      if (relevantChange && useProjectStore.getState().activeProject) {
        useProjectStore.getState().syncUIState({
          treeExpandedNodes: Array.from(state.expandedNodes),
          treeSelectedNodeId: state.selectedNodeId,
          sidebarWidth: state.sidebarWidth,
          inspectorHeight: state.inspectorHeight,
        });
      }
    });

    // Subscribe to custom signal changes
    const unsubCustomSignals = useCustomSignalStore.subscribe((state, prevState) => {
      if (state.structure !== prevState.structure && useProjectStore.getState().activeProject) {
        useProjectStore.getState().syncCustomSignals(state.structure);
      }
    });

    // Subscribe to mesh asset changes
    const unsubMeshAssets = useMeshAssetStore.subscribe((state, prevState) => {
      if (state.structure !== prevState.structure && useProjectStore.getState().activeProject) {
        useProjectStore.getState().syncMeshAssets(state.structure);
      }
    });

    // Subscribe to audio input changes
    const unsubAudio = useAudioInputStore.subscribe((state, prevState) => {
      if (state.collection !== prevState.collection && useProjectStore.getState().activeProject) {
        const collection = state.collection;
        if (collection) {
          const mixdownInput = collection.inputs.mixdown;
          const audioCollection: ProjectAudioCollection = {
            mixdown: mixdownInput
              ? {
                  id: mixdownInput.id,
                  label: mixdownInput.label,
                  role: mixdownInput.role,
                  metadata: mixdownInput.metadata!,
                  origin: mixdownInput.origin,
                  assetId: mixdownInput.assetId,
                }
              : null,
            stems: collection.stemOrder
              .map((stemId, index) => {
                const stem = collection.inputs[stemId];
                if (!stem || !stem.metadata) return null;
                return {
                  id: stem.id,
                  label: stem.label,
                  role: stem.role,
                  metadata: stem.metadata,
                  origin: stem.origin,
                  orderIndex: index,
                  assetId: stem.assetId,
                } as ProjectAudioReference;
              })
              .filter((s): s is ProjectAudioReference => s !== null),
          };
          useProjectStore.getState().syncAudioReferences(audioCollection);
        }
      }
    });

    return () => {
      unsubBands();
      unsubMusicalTime();
      unsubAuthored();
      unsubBeatGrid();
      unsubTree();
      unsubCustomSignals();
      unsubMeshAssets();
      unsubAudio();
    };
  }, []);

  // ----------------------------
  // Hydration Functions
  // ----------------------------

  /**
   * Hydrate all stores from the current project data.
   * Called after loading a project.
   */
  const hydrateStoresFromProject = useCallback(() => {
    const project = useProjectStore.getState().activeProject;
    if (!project) return;

    // Hydrate frequency bands
    if (project.interpretation.frequencyBands) {
      useFrequencyBandStore.getState().importFromJSON(
        JSON.stringify(project.interpretation.frequencyBands)
      );
    }

    // Hydrate musical time
    if (project.interpretation.musicalTime) {
      useMusicalTimeStore.getState().importFromJSON(
        JSON.stringify(project.interpretation.musicalTime)
      );
    }

    // Hydrate authored events
    if (project.interpretation.authoredEvents.length > 0) {
      const authoredStore = useAuthoredEventStore.getState();
      authoredStore.reset();
      for (const stream of project.interpretation.authoredEvents) {
        // Add stream with all events
        const streamId = authoredStore.addStream(stream.name, stream.source, {
          color: stream.color,
        });
        if (streamId) {
          authoredStore.addEvents(
            streamId,
            stream.events.map((e) => ({
              time: e.time,
              beatPosition: e.beatPosition,
              weight: e.weight,
              duration: e.duration,
              payload: e.payload,
              provenance: e.provenance,
            }))
          );
        }
      }
    }

    // Hydrate beat grid
    if (project.interpretation.beatGrid) {
      const bg = project.interpretation.beatGrid;
      const beatGridStore = useBeatGridStore.getState();

      if (bg.selectedHypothesis) {
        beatGridStore.selectHypothesis(bg.selectedHypothesis);
        beatGridStore.setPhaseHypotheses(bg.phaseHypotheses);
        beatGridStore.setActivePhaseIndex(bg.activePhaseIndex);
        beatGridStore.setUserNudge(bg.userNudge);
        beatGridStore.setLocked(bg.isLocked);
        beatGridStore.setVisible(bg.isVisible);
        beatGridStore.setMetronomeEnabled(bg.metronomeEnabled);
        beatGridStore.setConfig(bg.config);
        beatGridStore.setSubBeatDivision(bg.subBeatDivision);
      }
    }

    // Hydrate custom signals
    if (project.interpretation.customSignals) {
      useCustomSignalStore.getState().loadFromProject(project.interpretation.customSignals);
    }

    // Hydrate mesh assets
    if (project.meshAssets) {
      useMeshAssetStore.getState().loadFromProject(project.meshAssets);
    }

    // Hydrate tree state
    if (project.uiState) {
      const treeStore = useInterpretationTreeStore.getState();
      for (const nodeId of project.uiState.treeExpandedNodes) {
        treeStore.setExpanded(nodeId, true);
      }
      if (project.uiState.treeSelectedNodeId) {
        treeStore.selectNode(project.uiState.treeSelectedNodeId);
      }
      if (project.uiState.sidebarWidth) {
        treeStore.setSidebarWidth(project.uiState.sidebarWidth);
      }
      if (project.uiState.inspectorHeight) {
        treeStore.setInspectorHeight(project.uiState.inspectorHeight);
      }
      // Restore playhead position
      if (project.uiState.lastPlayheadPosition && project.uiState.lastPlayheadPosition > 0) {
        usePlaybackStore.getState().setPlayheadTimeSec(project.uiState.lastPlayheadPosition);
        // Also set cursor time to match
        usePlaybackStore.getState().setCursorTimeSec(project.uiState.lastPlayheadPosition);
      }
    }
  }, []);

  // ----------------------------
  // Project Lifecycle Actions
  // ----------------------------

  /**
   * Create a new project and optionally initialize it with current state.
   */
  const handleCreateProject = useCallback(
    (name?: string, importCurrentState = false) => {
      const projectId = createProject(name);

      if (importCurrentState) {
        // Sync current state from all stores
        const bandStructure = useFrequencyBandStore.getState().structure;
        if (bandStructure) {
          useProjectStore.getState().syncFrequencyBands(bandStructure);
        }

        const musicalTimeStructure = useMusicalTimeStore.getState().structure;
        if (musicalTimeStructure) {
          useProjectStore.getState().syncMusicalTime(musicalTimeStructure);
        }

        const authoredStreams = Array.from(useAuthoredEventStore.getState().streams.values());
        if (authoredStreams.length > 0) {
          useProjectStore.getState().syncAuthoredEvents(authoredStreams);
        }

        const beatGridState = useBeatGridStore.getState();
        if (beatGridState.selectedHypothesis) {
          useProjectStore.getState().syncBeatGrid({
            selectedHypothesis: beatGridState.selectedHypothesis,
            phaseHypotheses: beatGridState.phaseHypotheses,
            activePhaseIndex: beatGridState.activePhaseIndex,
            activeBeatGrid: beatGridState.activeBeatGrid,
            userNudge: beatGridState.userNudge,
            isLocked: beatGridState.isLocked,
            isVisible: beatGridState.isVisible,
            metronomeEnabled: beatGridState.metronomeEnabled,
            config: beatGridState.config,
            subBeatDivision: beatGridState.subBeatDivision,
          });
        }

        const customSignalStructure = useCustomSignalStore.getState().structure;
        if (customSignalStructure) {
          useProjectStore.getState().syncCustomSignals(customSignalStructure);
        }

        const meshAssetStructure = useMeshAssetStore.getState().structure;
        if (meshAssetStructure) {
          useProjectStore.getState().syncMeshAssets(meshAssetStructure);
        }

        const treeState = useInterpretationTreeStore.getState();
        useProjectStore.getState().syncUIState({
          treeExpandedNodes: Array.from(treeState.expandedNodes),
          treeSelectedNodeId: treeState.selectedNodeId,
          sidebarWidth: treeState.sidebarWidth,
          inspectorHeight: treeState.inspectorHeight,
        });
      }

      return projectId;
    },
    [createProject]
  );

  /**
   * Save project to JSON and trigger download.
   */
  const handleSaveProject = useCallback(async () => {
    // Sync current playhead position before saving
    const currentPlayhead = usePlaybackStore.getState().playheadTimeSec;
    useProjectStore.getState().syncUIState({ lastPlayheadPosition: currentPlayhead });

    const json = exportToJson();
    if (!json) return null;

    const project = useProjectStore.getState().activeProject;
    const filename = `${project?.name ?? "project"}.octoseq.json`;

    // Create download
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    // Mark as clean after save
    markClean();

    // Clear autosave after explicit save (no need to keep recovery data)
    try {
      await clearAutosave();
    } catch (error) {
      console.error("Failed to clear autosave after save:", error);
    }

    return filename;
  }, [exportToJson, markClean]);

  /**
   * Load project from JSON string.
   */
  const handleLoadProject = useCallback(
    (json: string): boolean => {
      const project = importFromJson(json);
      if (!project) return false;

      setActiveProject(project);
      hydrateStoresFromProject();

      return true;
    },
    [importFromJson, setActiveProject, hydrateStoresFromProject]
  );

  /**
   * Load project from file.
   */
  const handleLoadProjectFromFile = useCallback(
    async (file: File): Promise<boolean> => {
      try {
        const json = await file.text();
        return handleLoadProject(json);
      } catch (error) {
        console.error("Failed to load project file:", error);
        return false;
      }
    },
    [handleLoadProject]
  );

  /**
   * Reset project and clear all stores.
   */
  const handleResetProject = useCallback(() => {
    resetProject();

    // Clear all relevant stores
    useFrequencyBandStore.getState().clearStructure();
    useMusicalTimeStore.getState().reset();
    useAuthoredEventStore.getState().reset();
    useBeatGridStore.getState().clear();
    useCustomSignalStore.getState().reset();
    useMeshAssetStore.getState().reset();
    usePlaybackStore.getState().setPlayheadTimeSec(0);
    usePlaybackStore.getState().setCursorTimeSec(0);
  }, [resetProject]);

  // ----------------------------
  // Autosave Integration
  // ----------------------------

  const {
    hasRecovery,
    acceptRecovery,
    dismissRecovery,
    formatTimestamp,
  } = useAutosave({
    onRecoveryAvailable: (record) => {
      setPendingRecovery(record);
    },
    onRecoveryComplete: () => {
      // Hydrate stores after recovery
      hydrateStoresFromProject();
    },
    onError: (error) => {
      console.error("[Autosave] Error:", error);
    },
  });

  /**
   * Accept the pending autosave recovery.
   */
  const handleAcceptRecovery = useCallback(async () => {
    const success = await acceptRecovery();
    if (success) {
      setPendingRecovery(null);
      initialSyncDone.current = true;
    }
    return success;
  }, [acceptRecovery]);

  /**
   * Dismiss the pending autosave recovery and create a new project.
   */
  const handleDismissRecovery = useCallback(async () => {
    await dismissRecovery();
    setPendingRecovery(null);
    // Create a new project since we dismissed recovery
    handleCreateProject("Untitled Project", true);
    initialSyncDone.current = true;
  }, [dismissRecovery, handleCreateProject]);

  // ----------------------------
  // Auto-create project on mount if none exists
  // ----------------------------

  useEffect(() => {
    // Don't auto-create if there's a pending recovery
    if (pendingRecovery) return;

    if (!initialSyncDone.current && !activeProject) {
      // Auto-create a project on first mount
      handleCreateProject("Untitled Project", true);
      initialSyncDone.current = true;
    }
  }, [activeProject, handleCreateProject, pendingRecovery]);

  return {
    // State
    activeProject,
    isDirty,

    // Autosave state
    autosaveStatus,
    lastAutosaveAt,
    wasRecovered,
    clearRecovered,
    pendingRecovery,

    // Actions
    createProject: handleCreateProject,
    saveProject: handleSaveProject,
    loadProject: handleLoadProject,
    loadProjectFromFile: handleLoadProjectFromFile,
    resetProject: handleResetProject,
    renameProject,
    hydrateStoresFromProject,

    // Recovery actions
    acceptRecovery: handleAcceptRecovery,
    dismissRecovery: handleDismissRecovery,
    formatAutosaveTimestamp: formatTimestamp,
  };
}
