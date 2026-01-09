"use client";

import { Input } from "@/components/ui/input";
import { useAudioInputStore } from "@/lib/stores/audioInputStore";
import { useAuthoredEventStore } from "@/lib/stores/authoredEventStore";
import { useFrequencyBandStore } from "@/lib/stores/frequencyBandStore";
import {
  REDUCER_EVENT_LABELS,
  REDUCER_EVENT_DESCRIPTIONS,
  type SourceEvents,
  type EventStreamRef,
  type ReducerEventAlgorithmId,
  type EventWindow,
  type EventEnvelopeShape,
  type DerivedSignalSource,
} from "@/lib/stores/types/derivedSignal";

interface SourceEventSelectorProps {
  source: SourceEvents;
  onChange: (source: DerivedSignalSource) => void;
}

/**
 * Source selector for event streams.
 */
export function SourceEventSelector({ source, onChange }: SourceEventSelectorProps) {
  const audioCollection = useAudioInputStore((s) => s.collection);
  const stemOrder = audioCollection?.stemOrder ?? [];
  const authoredStreams = useAuthoredEventStore((s) => s.streams);
  const bandStructure = useFrequencyBandStore((s) => s.structure);
  const bands = bandStructure?.bands ?? [];

  const handleStreamTypeChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const type = e.target.value as EventStreamRef["type"];
    let newRef: EventStreamRef;
    switch (type) {
      case "candidateOnsets":
        newRef = { type: "candidateOnsets", audioSourceId: "mixdown" };
        break;
      case "candidateBeats":
        newRef = { type: "candidateBeats", audioSourceId: "mixdown" };
        break;
      case "bandOnsetPeaks":
        newRef = { type: "bandOnsetPeaks", bandId: bands[0]?.id ?? "" };
        break;
      case "bandBeatCandidates":
        newRef = { type: "bandBeatCandidates", bandId: bands[0]?.id ?? "" };
        break;
      case "authoredEvents":
        const firstStream = authoredStreams.values().next().value;
        newRef = { type: "authoredEvents", streamId: firstStream?.id ?? "" };
        break;
      default:
        newRef = { type: "candidateOnsets", audioSourceId: "mixdown" };
    }
    onChange({ ...source, streamRef: newRef });
  };

  const handleAudioSourceChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    if (source.streamRef.type !== "candidateOnsets" && source.streamRef.type !== "candidateBeats") return;
    onChange({
      ...source,
      streamRef: { ...source.streamRef, audioSourceId: e.target.value },
    });
  };

  const handleBandChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    if (source.streamRef.type !== "bandOnsetPeaks" && source.streamRef.type !== "bandBeatCandidates") return;
    onChange({
      ...source,
      streamRef: { ...source.streamRef, bandId: e.target.value },
    });
  };

  const handleAuthoredStreamChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    if (source.streamRef.type !== "authoredEvents") return;
    onChange({
      ...source,
      streamRef: { ...source.streamRef, streamId: e.target.value },
    });
  };

  const handleReducerChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    onChange({ ...source, reducer: e.target.value as ReducerEventAlgorithmId });
  };

  const handleWindowKindChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const kind = e.target.value as EventWindow["kind"];
    const newWindow: EventWindow =
      kind === "seconds"
        ? { kind: "seconds", windowSize: 0.5 }
        : { kind: "beats", windowSize: 1 };
    onChange({
      ...source,
      reducerParams: { ...source.reducerParams, window: newWindow },
    });
  };

  const handleWindowSizeChange = (value: number) => {
    const window = source.reducerParams.window ?? { kind: "seconds", windowSize: 0.5 };
    onChange({
      ...source,
      reducerParams: { ...source.reducerParams, window: { ...window, windowSize: value } },
    });
  };

  const handleEnvelopeShapeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const kind = e.target.value as EventEnvelopeShape["kind"];
    let newShape: EventEnvelopeShape;
    switch (kind) {
      case "impulse":
        newShape = { kind: "impulse" };
        break;
      case "gaussian":
        newShape = { kind: "gaussian", widthMs: 50 };
        break;
      case "attackDecay":
        newShape = { kind: "attackDecay", attackMs: 5, decayMs: 100 };
        break;
      default:
        newShape = { kind: "impulse" };
    }
    onChange({
      ...source,
      reducerParams: { ...source.reducerParams, envelopeShape: newShape },
    });
  };

  const handleEnvelopeParamChange = (field: string, value: number) => {
    const shape = source.reducerParams.envelopeShape;
    if (!shape) return;

    let newShape: EventEnvelopeShape;
    if (shape.kind === "gaussian") {
      newShape = { ...shape, widthMs: field === "widthMs" ? value : shape.widthMs };
    } else if (shape.kind === "attackDecay") {
      newShape = {
        ...shape,
        attackMs: field === "attackMs" ? value : shape.attackMs,
        decayMs: field === "decayMs" ? value : shape.decayMs,
      };
    } else {
      return;
    }

    onChange({
      ...source,
      reducerParams: { ...source.reducerParams, envelopeShape: newShape },
    });
  };

  const isAudioBased = source.streamRef.type === "candidateOnsets" || source.streamRef.type === "candidateBeats";
  const isBandBased = source.streamRef.type === "bandOnsetPeaks" || source.streamRef.type === "bandBeatCandidates";
  const isAuthored = source.streamRef.type === "authoredEvents";
  const isEnvelopeReducer = source.reducer === "envelope";
  const isWindowedReducer = ["eventCount", "eventDensity", "weightedSum", "weightedMean"].includes(source.reducer);

  // Get current values for conditional selects
  const audioSourceId = isAudioBased ? (source.streamRef as { audioSourceId: string }).audioSourceId : "mixdown";
  const bandId = isBandBased ? (source.streamRef as { bandId: string }).bandId : "";
  const streamId = isAuthored ? (source.streamRef as { streamId: string }).streamId : "";

  return (
    <div className="space-y-4">
      {/* Stream Type */}
      <div className="space-y-2">
        <label className="text-sm font-medium">Event Stream Type</label>
        <select
          value={source.streamRef.type}
          onChange={handleStreamTypeChange}
          className="w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-zinc-600 dark:bg-zinc-800"
        >
          <option value="candidateOnsets">Candidate Onsets</option>
          <option value="candidateBeats">Candidate Beats</option>
          <option value="bandOnsetPeaks" disabled={bands.length === 0}>
            Band Onset Peaks
          </option>
          <option value="bandBeatCandidates" disabled={bands.length === 0}>
            Band Beat Candidates
          </option>
          <option value="authoredEvents" disabled={authoredStreams.size === 0}>
            Authored Events
          </option>
        </select>
      </div>

      {/* Audio Source (for candidate events) */}
      {isAudioBased && (
        <div className="space-y-2">
          <label className="text-sm font-medium">Audio Source</label>
          <select
            value={audioSourceId}
            onChange={handleAudioSourceChange}
            className="w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-zinc-600 dark:bg-zinc-800"
          >
            <option value="mixdown">Mixdown</option>
            {stemOrder.map((stemId) => {
              const stem = audioCollection?.inputs[stemId];
              return (
                <option key={stemId} value={stemId}>
                  {stem?.label ?? stemId}
                </option>
              );
            })}
          </select>
        </div>
      )}

      {/* Band (for band events) */}
      {isBandBased && (
        <div className="space-y-2">
          <label className="text-sm font-medium">Band</label>
          <select
            value={bandId}
            onChange={handleBandChange}
            className="w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-zinc-600 dark:bg-zinc-800"
          >
            <option value="">Select band...</option>
            {bands.map((band) => (
              <option key={band.id} value={band.id}>
                {band.label}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Authored Stream */}
      {isAuthored && (
        <div className="space-y-2">
          <label className="text-sm font-medium">Event Stream</label>
          <select
            value={streamId}
            onChange={handleAuthoredStreamChange}
            className="w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-zinc-600 dark:bg-zinc-800"
          >
            <option value="">Select stream...</option>
            {Array.from(authoredStreams.values()).map((stream) => (
              <option key={stream.id} value={stream.id}>
                {stream.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Reducer */}
      <div className="space-y-2">
        <label className="text-sm font-medium">Conversion Method</label>
        <select
          value={source.reducer}
          onChange={handleReducerChange}
          className="w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-zinc-600 dark:bg-zinc-800"
        >
          {(Object.keys(REDUCER_EVENT_LABELS) as ReducerEventAlgorithmId[]).map((id) => (
            <option key={id} value={id}>
              {REDUCER_EVENT_LABELS[id]}
            </option>
          ))}
        </select>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          {REDUCER_EVENT_DESCRIPTIONS[source.reducer]}
        </p>
      </div>

      {/* Window Settings (for windowed reducers) */}
      {isWindowedReducer && (
        <div className="space-y-2">
          <label className="text-sm font-medium">Window</label>
          <div className="flex items-center gap-2">
            <Input
              type="number"
              value={source.reducerParams.window?.windowSize ?? 0.5}
              onChange={(e) => handleWindowSizeChange(Number(e.target.value))}
              className="w-20"
              min={0.01}
              step={0.1}
            />
            <label className="flex items-center space-x-1">
              <input
                type="radio"
                name="windowKind"
                value="seconds"
                checked={(source.reducerParams.window?.kind ?? "seconds") === "seconds"}
                onChange={handleWindowKindChange}
                className="h-4 w-4"
              />
              <span className="text-sm">sec</span>
            </label>
            <label className="flex items-center space-x-1">
              <input
                type="radio"
                name="windowKind"
                value="beats"
                checked={source.reducerParams.window?.kind === "beats"}
                onChange={handleWindowKindChange}
                className="h-4 w-4"
              />
              <span className="text-sm">beats</span>
            </label>
          </div>
        </div>
      )}

      {/* Envelope Shape (for envelope reducer) */}
      {isEnvelopeReducer && (
        <div className="space-y-2">
          <label className="text-sm font-medium">Envelope Shape</label>
          <div className="flex flex-wrap gap-3">
            <label className="flex items-center space-x-1">
              <input
                type="radio"
                name="envelopeShape"
                value="impulse"
                checked={(source.reducerParams.envelopeShape?.kind ?? "attackDecay") === "impulse"}
                onChange={handleEnvelopeShapeChange}
                className="h-4 w-4"
              />
              <span className="text-sm">Impulse</span>
            </label>
            <label className="flex items-center space-x-1">
              <input
                type="radio"
                name="envelopeShape"
                value="gaussian"
                checked={source.reducerParams.envelopeShape?.kind === "gaussian"}
                onChange={handleEnvelopeShapeChange}
                className="h-4 w-4"
              />
              <span className="text-sm">Gaussian</span>
            </label>
            <label className="flex items-center space-x-1">
              <input
                type="radio"
                name="envelopeShape"
                value="attackDecay"
                checked={(source.reducerParams.envelopeShape?.kind ?? "attackDecay") === "attackDecay"}
                onChange={handleEnvelopeShapeChange}
                className="h-4 w-4"
              />
              <span className="text-sm">Attack/Decay</span>
            </label>
          </div>

          {/* Gaussian params */}
          {source.reducerParams.envelopeShape?.kind === "gaussian" && (
            <div className="flex items-center gap-2 pt-1">
              <label className="text-sm">Width:</label>
              <Input
                type="number"
                value={source.reducerParams.envelopeShape.widthMs}
                onChange={(e) => handleEnvelopeParamChange("widthMs", Number(e.target.value))}
                className="w-20"
                min={1}
              />
              <span className="text-sm text-zinc-500">ms</span>
            </div>
          )}

          {/* Attack/Decay params */}
          {source.reducerParams.envelopeShape?.kind === "attackDecay" && (
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <label className="text-sm">Attack:</label>
              <Input
                type="number"
                value={source.reducerParams.envelopeShape.attackMs}
                onChange={(e) => handleEnvelopeParamChange("attackMs", Number(e.target.value))}
                className="w-16"
                min={0}
              />
              <label className="text-sm">Decay:</label>
              <Input
                type="number"
                value={source.reducerParams.envelopeShape.decayMs}
                onChange={(e) => handleEnvelopeParamChange("decayMs", Number(e.target.value))}
                className="w-16"
                min={0}
              />
              <span className="text-sm text-zinc-500">ms</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
