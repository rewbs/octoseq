"use client";

import { Button } from "@/components/ui/button";

export type MirFunctionId =
    | "spectralCentroid"
    | "spectralFlux"
    | "melSpectrogram"
    | "onsetEnvelope"
    | "onsetPeaks"
    | "hpssHarmonic"
    | "hpssPercussive"
    | "mfcc"
    | "mfccDelta"
    | "mfccDeltaDelta";

export type MirControlPanelProps = {
    selected: MirFunctionId;
    onSelectedChange: (id: MirFunctionId) => void;
    onRun: () => void;
    onCancel?: () => void;
    disabled?: boolean;
    isRunning?: boolean;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    config?: any; // Accepting the large config object from page.tsx
    debug?: boolean;
    setDebug?: (v: boolean) => void;
    useWorker?: boolean;
    setUseWorker?: (v: boolean) => void;
    enableGpu?: boolean;
    setEnableGpu?: (v: boolean) => void;
    heatmapScheme?: string;
    setHeatmapScheme?: (v: string) => void;
    lastTimings?: any;
};

export function MirControlPanel({ selected, onRun, onCancel, disabled, isRunning, config }: MirControlPanelProps) {
    return (
        <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">Analysis:</span>
                <div className="px-2 py-1 bg-zinc-100 dark:bg-zinc-800 rounded text-xs text-zinc-900 dark:text-zinc-100 font-mono">
                    {selected}
                </div>
            </div>

            <Button onClick={onRun} disabled={disabled || isRunning} size="sm" className="h-7 text-xs">
                {isRunning ? "Running…" : "Run"}
            </Button>

            {onCancel && isRunning && (
                <Button variant="outline" onClick={onCancel} size="sm" className="h-7 text-xs">
                    Cancel
                </Button>
            )}

            {/* Config Toggle (Placeholder) */}
            {config && (
                <details className="relative group">
                    <summary className="cursor-pointer list-none">
                        <Button variant="ghost" size="sm" className="h-7 w-7 p-0 rounded-full" asChild>
                            <span>⚙️</span>
                        </Button>
                    </summary>
                    <div className="absolute bottom-full left-0 mb-2 w-64 p-4 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg shadow-xl z-50 text-xs text-zinc-500">
                        <p className="mb-2 font-semibold text-zinc-900 dark:text-zinc-100">Configuration</p>
                        <p className="italic">Analysis settings are currently fixed for this demo.</p>
                        {/* We could render the full config UI here using the passed 'config' prop if needed,
                             but to keep it compact as requested, we'll hide it for now or implement a proper popover later. */}
                    </div>
                </details>
            )}
        </div>
    );
}
