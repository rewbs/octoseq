/**
 * Composed Signal Actions Hook
 *
 * Higher-level operations for composed signals that may involve
 * multiple stores or complex computations.
 */

import { useCallback } from "react";
import { useShallow } from "zustand/react/shallow";
import { useComposedSignalStore } from "../composedSignalStore";
import { useBeatGridStore } from "../beatGridStore";
import { useAudioInputStore } from "../audioInputStore";
import {
  sampleComposedSignal,
  sampleToArray,
  snapToGrid,
  secondsToBeats,
} from "@/lib/composedSignal/interpolate";
import type { InterpolationType } from "../types/composedSignal";

/**
 * Hook providing composed signal actions and utilities.
 */
export function useComposedSignalActions() {
  // Store state and actions
  const {
    getSignalById,
    getEnabledSignals,
    addNode,
    selectedSignalId,
    snapEnabled,
    snapSubdivision,
  } = useComposedSignalStore(
    useShallow((s) => ({
      getSignalById: s.getSignalById,
      getEnabledSignals: s.getEnabledSignals,
      addNode: s.addNode,
      selectedSignalId: s.selectedSignalId,
      snapEnabled: s.snapEnabled,
      snapSubdivision: s.snapSubdivision,
    }))
  );

  // BPM from beat grid
  const bpm = useBeatGridStore((s) => s.selectedHypothesis?.bpm ?? null);

  // Audio duration
  const audioDuration = useAudioInputStore((s) => s.getAudioDuration());

  /**
   * Sample a signal at a specific beat position.
   */
  const sampleSignalAtBeat = useCallback(
    (signalId: string, timeBeats: number): number | null => {
      const signal = getSignalById(signalId);
      if (!signal) return null;

      return sampleComposedSignal(
        signal.nodes,
        timeBeats,
        signal.valueMin,
        signal.valueMax
      );
    },
    [getSignalById]
  );

  /**
   * Sample a signal at a specific time in seconds.
   * Requires BPM to be set.
   */
  const sampleSignalAtTime = useCallback(
    (signalId: string, timeSeconds: number): number | null => {
      if (bpm === null) return null;

      const signal = getSignalById(signalId);
      if (!signal) return null;

      const timeBeats = secondsToBeats(timeSeconds, bpm);
      return sampleComposedSignal(
        signal.nodes,
        timeBeats,
        signal.valueMin,
        signal.valueMax
      );
    },
    [bpm, getSignalById]
  );

  /**
   * Export a signal to a Float32Array for the visualiser.
   * Returns null if BPM is not set.
   */
  const exportSignalToArray = useCallback(
    (signalId: string, sampleRate: number = 100): Float32Array | null => {
      if (bpm === null || audioDuration <= 0) return null;

      const signal = getSignalById(signalId);
      if (!signal) return null;

      return sampleToArray(
        signal.nodes,
        sampleRate,
        audioDuration,
        bpm,
        signal.valueMin,
        signal.valueMax
      );
    },
    [bpm, audioDuration, getSignalById]
  );

  /**
   * Export all enabled signals to Float32Arrays.
   * Returns a Map of signal name -> samples.
   */
  const exportAllSignalsToArrays = useCallback(
    (sampleRate: number = 100): Map<string, Float32Array> => {
      const result = new Map<string, Float32Array>();

      if (bpm === null || audioDuration <= 0) return result;

      const signals = getEnabledSignals();
      for (const signal of signals) {
        const samples = sampleToArray(
          signal.nodes,
          sampleRate,
          audioDuration,
          bpm,
          signal.valueMin,
          signal.valueMax
        );
        result.set(signal.name, samples);
      }

      return result;
    },
    [bpm, audioDuration, getEnabledSignals]
  );

  /**
   * Snap a beat position to the current grid settings.
   */
  const snapBeatToGrid = useCallback(
    (beatPosition: number): number => {
      return snapToGrid(beatPosition, snapSubdivision, snapEnabled);
    },
    [snapEnabled, snapSubdivision]
  );

  /**
   * Convert seconds to beats using current BPM.
   */
  const secondsToBeatsCurrent = useCallback(
    (seconds: number): number | null => {
      if (bpm === null) return null;
      return secondsToBeats(seconds, bpm);
    },
    [bpm]
  );

  /**
   * Add a node at a specific time in seconds.
   * Will snap to grid if enabled.
   */
  const addNodeAtTime = useCallback(
    (
      signalId: string,
      timeSeconds: number,
      value: number,
      interp: InterpolationType = "linear"
    ): string | null => {
      if (bpm === null) return null;

      const timeBeats = secondsToBeats(timeSeconds, bpm);
      const snappedBeats = snapToGrid(timeBeats, snapSubdivision, snapEnabled);

      return addNode(signalId, {
        time_beats: snappedBeats,
        value,
        interp_to_next: interp,
      });
    },
    [bpm, snapEnabled, snapSubdivision, addNode]
  );

  /**
   * Add nodes at regular intervals.
   */
  const addNodesAtInterval = useCallback(
    (
      signalId: string,
      startBeat: number,
      endBeat: number,
      intervalBeats: number,
      value: number,
      interp: InterpolationType = "linear"
    ): string[] => {
      const nodeIds: string[] = [];

      for (let beat = startBeat; beat <= endBeat; beat += intervalBeats) {
        const id = addNode(signalId, {
          time_beats: beat,
          value,
          interp_to_next: interp,
        });
        if (id) nodeIds.push(id);
      }

      return nodeIds;
    },
    [addNode]
  );

  /**
   * Check if BPM is available (required for composed signals).
   */
  const isBpmAvailable = bpm !== null;

  /**
   * Get current BPM value.
   */
  const getCurrentBpm = useCallback(() => bpm, [bpm]);

  /**
   * Get total duration in beats.
   */
  const getDurationBeats = useCallback((): number | null => {
    if (bpm === null || audioDuration <= 0) return null;
    return secondsToBeats(audioDuration, bpm);
  }, [bpm, audioDuration]);

  return {
    // Sampling
    sampleSignalAtBeat,
    sampleSignalAtTime,

    // Export
    exportSignalToArray,
    exportAllSignalsToArrays,

    // Grid
    snapBeatToGrid,
    secondsToBeatsCurrent,

    // Node creation
    addNodeAtTime,
    addNodesAtInterval,

    // BPM utilities
    isBpmAvailable,
    getCurrentBpm,
    getDurationBeats,
  };
}
