"use client";

import { useMemo, type ChangeEvent } from "react";
import { useShallow } from "zustand/react/shallow";
import {
  MIXDOWN_STREAM_ID,
  analysisKey,
  isBandStream,
  toDisplaySignal,
  useAnalysisStore,
  useStreamStore,
  type AnalysisId,
  type DisplaySignal,
  type Stream,
} from "@/lib/streams";
import { useDerivedSignalStore } from "@/lib/stores/derivedSignalStore";
import { mirTabDefinitions } from "@/lib/stores/mirStore";
import { cn } from "@/lib/utils";

// ============================================================================
// Types
// ============================================================================

/**
 * A selected 1D signal source.
 * - "stream": a unified `(streamId, analysisId)` address into the analysisStore
 *   (mixdown, stems, and bands alike — band-ness is a property of the stream).
 * - "derived": a computed custom signal from the derivedSignalStore.
 */
export type SignalSourceRef =
  | { kind: "stream"; streamId: string; analysisId: AnalysisId }
  | { kind: "derived"; signalId: string };

export interface SignalSourceOption {
  ref: SignalSourceRef;
  /** Stable string form of the ref, used as the `<option>` value. */
  value: string;
  label: string;
}

export interface SignalSourceGroup {
  /** Stable group key (stream id, or "derived"). */
  key: string;
  label: string;
  options: SignalSourceOption[];
}

/** Stable string encoding of a ref (select plumbing / equality checks). */
export function signalSourceValue(ref: SignalSourceRef): string {
  return ref.kind === "stream"
    ? `stream::${ref.streamId}::${ref.analysisId}`
    : `derived::${ref.signalId}`;
}

// ============================================================================
// Source enumeration
// ============================================================================

/** Every 1D-displayable analysis, labelled for selection. */
const ANALYSIS_1D_OPTIONS: ReadonlyArray<{ id: AnalysisId; label: string }> =
  mirTabDefinitions
    .filter((t) => t.kind === "1d")
    .map((t) => ({ id: t.id, label: t.label.replace(" (1D)", "") }));

/** Mixdown options stay unqualified; stem/band options carry the stream label. */
function streamSignalLabel(stream: Stream, analysisLabel: string): string {
  return stream.id === MIXDOWN_STREAM_ID ? analysisLabel : `${stream.label} ${analysisLabel}`;
}

/**
 * Enumerate the selectable 1D signal sources, grouped per stream (mixdown,
 * then stems, then bands, each its own group), plus an optional leading
 * "Custom Signals" group of computed derived signals.
 *
 * A stream analysis is offered only when a result is present in the unified
 * analysisStore and is 1D-displayable (`toDisplaySignal` at the display edge).
 */
export function useSignalSourceGroups(options?: {
  includeDerived?: boolean;
}): SignalSourceGroup[] {
  const includeDerived = options?.includeDerived ?? false;

  const streams = useStreamStore((s) => s.streams);
  const analysisResults = useAnalysisStore((s) => s.results);
  const derivedSignals = useDerivedSignalStore(
    useShallow((s) => (includeDerived ? (s.structure?.signals ?? []) : []))
  );
  const derivedSignalResults = useDerivedSignalStore((s) => s.resultCache);

  return useMemo(() => {
    const groups: SignalSourceGroup[] = [];

    // Custom (derived) signals lead, mirroring the legacy source ordering.
    if (includeDerived) {
      const derivedOptions: SignalSourceOption[] = derivedSignals
        .filter((signal) => derivedSignalResults.has(signal.id))
        .map((signal) => {
          const ref: SignalSourceRef = { kind: "derived", signalId: signal.id };
          return { ref, value: signalSourceValue(ref), label: signal.name };
        });
      if (derivedOptions.length > 0) {
        groups.push({ key: "derived", label: "Custom Signals", options: derivedOptions });
      }
    }

    // Per-stream groups: mixdown, then stems, then bands.
    const all = [...streams.values()];
    const ordered: Stream[] = [
      ...all.filter((s) => s.kind === "mixdown"),
      ...all.filter((s) => s.kind === "stem").sort((a, b) => a.sortOrder - b.sortOrder),
      ...all.filter(isBandStream).sort((a, b) => a.sortOrder - b.sortOrder),
    ];

    for (const stream of ordered) {
      const streamOptions: SignalSourceOption[] = [];
      for (const analysis of ANALYSIS_1D_OPTIONS) {
        const result = analysisResults.get(analysisKey(stream.id, analysis.id));
        if (!result || !toDisplaySignal(result, analysis.id)) continue;
        const ref: SignalSourceRef = {
          kind: "stream",
          streamId: stream.id,
          analysisId: analysis.id,
        };
        streamOptions.push({
          ref,
          value: signalSourceValue(ref),
          label: streamSignalLabel(stream, analysis.label),
        });
      }
      if (streamOptions.length > 0) {
        groups.push({ key: stream.id, label: stream.label, options: streamOptions });
      }
    }

    return groups;
  }, [includeDerived, derivedSignals, derivedSignalResults, streams, analysisResults]);
}

/**
 * Resolve a source ref to display-ready `{times, values}` (normalized at the
 * display edge via `toDisplaySignal`). Null while unresolved (e.g. the result
 * was invalidated).
 */
export function useSignalSourceData(ref: SignalSourceRef | null): DisplaySignal | null {
  const analysisResult = useAnalysisStore((s) =>
    ref?.kind === "stream" ? (s.results.get(analysisKey(ref.streamId, ref.analysisId)) ?? null) : null
  );
  const derivedResult = useDerivedSignalStore((s) =>
    ref?.kind === "derived" ? (s.resultCache.get(ref.signalId) ?? null) : null
  );

  return useMemo(() => {
    if (!ref) return null;
    if (ref.kind === "derived") {
      if (!derivedResult) return null;
      return { times: derivedResult.times, values: derivedResult.values };
    }
    if (!analysisResult) return null;
    return toDisplaySignal(analysisResult, ref.analysisId);
  }, [ref, analysisResult, derivedResult]);
}

/**
 * Display name for a source ref, live against the stores (tracks renames).
 */
export function useSignalSourceLabel(ref: SignalSourceRef | null): string | null {
  const stream = useStreamStore((s) =>
    ref?.kind === "stream" ? (s.streams.get(ref.streamId) ?? null) : null
  );
  const derivedName = useDerivedSignalStore((s) =>
    ref?.kind === "derived"
      ? (s.structure?.signals.find((signal) => signal.id === ref.signalId)?.name ?? null)
      : null
  );

  if (!ref) return null;
  if (ref.kind === "derived") return derivedName;
  if (!stream) return null;
  const analysis = ANALYSIS_1D_OPTIONS.find((a) => a.id === ref.analysisId);
  return streamSignalLabel(stream, analysis?.label ?? ref.analysisId);
}

// ============================================================================
// Component
// ============================================================================

interface SignalSourceSelectorProps {
  value: SignalSourceRef | null;
  onChange: (ref: SignalSourceRef | null) => void;
  /** Also offer computed derived ("custom") signals alongside stream analyses. */
  includeDerived?: boolean;
  className?: string;
}

/**
 * Reusable 1D signal source selector: a single grouped `<select>` over the
 * unified stream model. Groups are per stream (from streamStore), options are
 * the analyses with results (from analysisStore); returns the selection as a
 * `SignalSourceRef` (`{ streamId, analysisId }` for stream sources).
 */
export function SignalSourceSelector({
  value,
  onChange,
  includeDerived = false,
  className,
}: SignalSourceSelectorProps) {
  const groups = useSignalSourceGroups({ includeDerived });

  const optionsByValue = useMemo(() => {
    const map = new Map<string, SignalSourceOption>();
    for (const group of groups) {
      for (const option of group.options) {
        map.set(option.value, option);
      }
    }
    return map;
  }, [groups]);

  const handleChange = (e: ChangeEvent<HTMLSelectElement>) => {
    onChange(optionsByValue.get(e.target.value)?.ref ?? null);
  };

  return (
    <select
      value={value ? signalSourceValue(value) : ""}
      onChange={handleChange}
      className={cn(
        "h-7 px-2 text-xs rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-900 dark:text-zinc-100",
        className
      )}
    >
      <option value="">Select signal...</option>
      {groups.map((group) => (
        <optgroup key={group.key} label={group.label}>
          {group.options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}
