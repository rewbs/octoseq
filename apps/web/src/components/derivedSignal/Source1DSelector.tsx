"use client";

import { useMemo } from "react";
import {
  useStreamStore,
  isAudioStream,
  isBandStream,
  MIXDOWN_STREAM_ID,
  type AnalysisId,
} from "@/lib/streams";
import { useDerivedSignals } from "@/lib/stores/derivedSignalStore";
import {
  type Source1D,
  type Signal1DRef,
  type DerivedSignalSource,
} from "@/lib/stores/types/derivedSignal";

interface Source1DSelectorProps {
  source: Source1D;
  onChange: (source: DerivedSignalSource) => void;
}

/**
 * 1D analyses offered as derived-signal sources.
 * Unified ids — valid on audio streams and band streams alike.
 */
const ANALYSIS_1D_OPTIONS: { id: AnalysisId; label: string }[] = [
  { id: "amplitudeEnvelope", label: "Amplitude Envelope" },
  { id: "spectralCentroid", label: "Spectral Centroid" },
  { id: "spectralFlux", label: "Spectral Flux" },
  { id: "onsetEnvelope", label: "Onset Envelope" },
  { id: "cqtHarmonicEnergy", label: "CQT Harmonic Energy" },
  { id: "cqtBassPitchMotion", label: "CQT Bass Motion" },
  { id: "cqtTonalStability", label: "CQT Tonal Stability" },
];

/**
 * Source selector for 1D signals.
 */
export function Source1DSelector({ source, onChange }: Source1DSelectorProps) {
  const streams = useStreamStore((s) => s.streams);
  const audioStreams = useMemo(
    () => [...streams.values()].filter(isAudioStream).sort((a, b) => a.sortOrder - b.sortOrder),
    [streams]
  );
  const bands = useMemo(
    () => [...streams.values()].filter(isBandStream).sort((a, b) => a.sortOrder - b.sortOrder),
    [streams]
  );
  const derivedSignals = useDerivedSignals();

  const handleRefTypeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const type = e.target.value as Signal1DRef["type"];
    let newRef: Signal1DRef;
    switch (type) {
      case "analysis":
        newRef = {
          type: "analysis",
          streamId: MIXDOWN_STREAM_ID,
          analysisId: "amplitudeEnvelope",
        };
        break;
      case "derived": {
        const otherSignals = derivedSignals.filter(
          (s) => s.source.kind !== "1d" || s.source.signalRef.type !== "derived"
        );
        newRef = {
          type: "derived",
          signalId: otherSignals[0]?.id ?? "",
        };
        break;
      }
    }
    onChange({ ...source, signalRef: newRef });
  };

  const handleStreamChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    if (source.signalRef.type !== "analysis") return;
    onChange({
      ...source,
      signalRef: { ...source.signalRef, streamId: e.target.value },
    });
  };

  const handleAnalysisChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    if (source.signalRef.type !== "analysis") return;
    onChange({
      ...source,
      signalRef: { ...source.signalRef, analysisId: e.target.value as AnalysisId },
    });
  };

  const handleDerivedSignalChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    if (source.signalRef.type !== "derived") return;
    onChange({
      ...source,
      signalRef: { ...source.signalRef, signalId: e.target.value },
    });
  };

  const availableDerivedSignals = derivedSignals;

  return (
    <div className="space-y-4">
      {/* Reference Type */}
      <div className="space-y-2">
        <label className="text-sm font-medium">Source Type</label>
        <div className="flex flex-wrap gap-3">
          <label className="flex items-center space-x-2">
            <input
              type="radio"
              name="refType"
              value="analysis"
              checked={source.signalRef.type === "analysis"}
              onChange={handleRefTypeChange}
              className="h-4 w-4 border-zinc-300 text-blue-600"
            />
            <span className="text-sm">Analysis Signal</span>
          </label>
          <label
            className={`flex items-center space-x-2 ${availableDerivedSignals.length === 0 ? "opacity-50" : ""}`}
          >
            <input
              type="radio"
              name="refType"
              value="derived"
              checked={source.signalRef.type === "derived"}
              onChange={handleRefTypeChange}
              disabled={availableDerivedSignals.length === 0}
              className="h-4 w-4 border-zinc-300 text-blue-600"
            />
            <span className="text-sm">Derived Signal</span>
          </label>
        </div>
      </div>

      {/* Analysis options: one stream-grouped list, no mixdown/stem/band branching */}
      {source.signalRef.type === "analysis" && (
        <>
          <div className="space-y-2">
            <label className="text-sm font-medium">Stream</label>
            <select
              value={source.signalRef.streamId}
              onChange={handleStreamChange}
              className="w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-zinc-600 dark:bg-zinc-800"
            >
              <optgroup label="Audio">
                {audioStreams.map((stream) => (
                  <option key={stream.id} value={stream.id}>
                    {stream.label}
                  </option>
                ))}
              </optgroup>
              {bands.length > 0 && (
                <optgroup label="Bands">
                  {bands.map((band) => (
                    <option key={band.id} value={band.id}>
                      {band.label}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Signal</label>
            <select
              value={source.signalRef.analysisId}
              onChange={handleAnalysisChange}
              className="w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-zinc-600 dark:bg-zinc-800"
            >
              {ANALYSIS_1D_OPTIONS.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </>
      )}

      {/* Derived signal reference */}
      {source.signalRef.type === "derived" && (
        <div className="space-y-2">
          <label className="text-sm font-medium">Source Signal</label>
          <select
            value={source.signalRef.signalId}
            onChange={handleDerivedSignalChange}
            className="w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-zinc-600 dark:bg-zinc-800"
          >
            <option value="">Select signal...</option>
            {availableDerivedSignals.map((signal) => (
              <option key={signal.id} value={signal.id}>
                {signal.name}
              </option>
            ))}
          </select>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Chain signals to build complex derivations. Cycles are not allowed.
          </p>
        </div>
      )}
    </div>
  );
}
