"use client";

import { useMemo } from "react";

export type SearchPrecision = "coarse" | "medium" | "fine";

export type SearchControls = {
    threshold: number; // 0..1
    precision: SearchPrecision;

    // optional advanced weights
    melWeight: number;
    transientWeight: number;

    /** Optional: apply softmax to similarity curve for sharper contrast. */
    applySoftmax?: boolean;
};

export type SearchControlsPanelProps = {
    value: SearchControls;
    onChange: (next: SearchControls) => void;
    disabled?: boolean;
    selectionDurationSec?: number | null;

    /** Use human refinement labels (accepted/rejected/manual) for per-track discrimination. */
    useRefinement?: boolean;
    onUseRefinementChange?: (next: boolean) => void;
    refinementAvailable?: boolean;
};

function clamp01(x: number): number {
    return Math.max(0, Math.min(1, x));
}

export function SearchControlsPanel({
    value,
    onChange,
    disabled,
    selectionDurationSec,
    useRefinement,
    onUseRefinementChange,
    refinementAvailable,
}: SearchControlsPanelProps) {
    const thresholdPct = Math.round(value.threshold * 100);
    const refinementOn = !!useRefinement && !!refinementAvailable;
    const thresholdLabel = refinementOn ? "Confidence threshold" : "Similarity threshold";

    const hopMs = useMemo(() => {
        // UI mapping only; worker uses a deterministic hopSec derived from precision + duration.
        const dur = selectionDurationSec ?? 0;
        const base = value.precision === "fine" ? 0.005 : value.precision === "medium" ? 0.020 : 0.05;
        // Keep a slightly larger hop for long regions to avoid huge scans.
        const scaled = dur > 2 ? base * 1.5 : base;
        return Math.round(scaled * 1000);
    }, [value.precision, selectionDurationSec]);

    return (
        <div className="rounded-md border border-zinc-200 bg-zinc-50 p-3 text-sm dark:border-zinc-800 dark:bg-zinc-950">
            <div className="text-sm font-medium text-zinc-800 dark:text-zinc-100">Search Controls</div>
            <div className="mt-3 space-y-3">
                <label className="grid grid-cols-[180px,1fr,60px] items-center gap-2">
                    <span className="text-xs text-zinc-600 dark:text-zinc-300">{thresholdLabel}</span>
                    <input
                        type="range"
                        min={60}
                        max={95}
                        step={1}
                        value={thresholdPct}
                        onChange={(e) => onChange({ ...value, threshold: clamp01(Number(e.target.value) / 100) })}
                        disabled={disabled}
                    />
                    <span className="text-right text-xs tabular-nums text-zinc-600 dark:text-zinc-300">{thresholdPct}%</span>
                </label>

                <label className="inline-flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-300">
                    <input
                        type="checkbox"
                        checked={!!value.applySoftmax}
                        onChange={(e) => onChange({ ...value, applySoftmax: e.target.checked })}
                        disabled={disabled || refinementOn}
                    />
                    <span>Apply softmax to similarity curve (baseline only)</span>
                </label>

                {onUseRefinementChange ? (
                    <label className="inline-flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-300">
                        <input
                            type="checkbox"
                            checked={!!useRefinement}
                            onChange={(e) => onUseRefinementChange(e.target.checked)}
                            disabled={disabled || !refinementAvailable}
                        />
                        <span>Use refinement (accepted/rejected examples)</span>
                        {!refinementAvailable ? <span className="text-[11px] text-zinc-500">(add labels to enable)</span> : null}
                    </label>
                ) : null}

                <label className="grid grid-cols-[180px,1fr] items-center gap-2">
                    <span className="text-xs text-zinc-600 dark:text-zinc-300">Search precision</span>
                    <div className="flex items-center gap-2">
                        <select
                            value={value.precision}
                            onChange={(e) => onChange({ ...value, precision: e.target.value as SearchPrecision })}
                            disabled={disabled}
                            className="rounded-md border border-zinc-200 bg-white px-2 py-1 text-sm dark:border-zinc-800 dark:bg-zinc-950"
                        >
                            <option value="coarse">Coarse</option>
                            <option value="medium">Medium</option>
                            <option value="fine">Fine</option>
                        </select>
                        <span className="text-xs text-zinc-500">≈ {hopMs}ms hop</span>
                    </div>
                </label>

                <details className="rounded-md border border-zinc-200 bg-white p-2 text-xs dark:border-zinc-800 dark:bg-zinc-950">
                    <summary className="cursor-pointer select-none text-zinc-700 dark:text-zinc-200">Advanced (weights)</summary>
                    <div className="mt-2 space-y-2">
                        <label className="grid grid-cols-[180px,1fr,60px] items-center gap-2">
                            <span className="text-xs text-zinc-600 dark:text-zinc-300">Timbre weight (mel)</span>
                            <input
                                type="range"
                                min={0}
                                max={200}
                                step={5}
                                value={Math.round(value.melWeight * 100)}
                                onChange={(e) => onChange({ ...value, melWeight: Number(e.target.value) / 100 })}
                                disabled={disabled}
                            />
                            <span className="text-right text-xs tabular-nums text-zinc-600 dark:text-zinc-300">{value.melWeight.toFixed(2)}</span>
                        </label>
                        <label className="grid grid-cols-[180px,1fr,60px] items-center gap-2">
                            <span className="text-xs text-zinc-600 dark:text-zinc-300">Transient weight (onset)</span>
                            <input
                                type="range"
                                min={0}
                                max={200}
                                step={5}
                                value={Math.round(value.transientWeight * 100)}
                                onChange={(e) => onChange({ ...value, transientWeight: Number(e.target.value) / 100 })}
                                disabled={disabled}
                            />
                            <span className="text-right text-xs tabular-nums text-zinc-600 dark:text-zinc-300">{value.transientWeight.toFixed(2)}</span>
                        </label>
                        <p className="text-[11px] text-zinc-500">
                            These weights scale the feature blocks before cosine similarity.
                        </p>
                    </div>
                </details>
            </div>
        </div>
    );
}
