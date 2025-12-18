"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/modal";
import type { MirFunctionId } from "./MirControlPanel";
import type { HeatmapColorScheme } from "@/components/heatmap/TimeAlignedHeatmapPixi";

interface MirConfigModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;

    fftSize: number;
    setFftSize: (v: number) => void;
    hopSize: number;
    setHopSize: (v: number) => void;

    melBands: number;
    setMelBands: (v: number) => void;
    melFMin: string;
    setMelFMin: (v: string) => void;
    melFMax: string;
    setMelFMax: (v: string) => void;

    onsetSmoothMs: number;
    setOnsetSmoothMs: (v: number) => void;
    onsetDiffMethod: "rectified" | "abs";
    setOnsetDiffMethod: (v: "rectified" | "abs") => void;
    onsetUseLog: boolean;
    setOnsetUseLog: (v: boolean) => void;

    peakMinIntervalMs: number;
    setPeakMinIntervalMs: (v: number) => void;
    peakThreshold: string;
    setPeakThreshold: (v: string) => void;
    peakAdaptiveFactor: string;
    setPeakAdaptiveFactor: (v: string) => void;

    hpssTimeMedian: number;
    setHpssTimeMedian: (v: number) => void;
    hpssFreqMedian: number;
    setHpssFreqMedian: (v: number) => void;

    mfccNCoeffs: number;
    setMfccNCoeffs: (v: number) => void;

    showDcBin: boolean;
    setShowDcBin: (v: boolean) => void;
    showMfccC0: boolean;
    setShowMfccC0: (v: boolean) => void;

    heatmapScheme: HeatmapColorScheme;
    setHeatmapScheme: (v: HeatmapColorScheme) => void;
}

type FilterOption = "all" | MirFunctionId;

export function MirConfigModal(props: MirConfigModalProps) {
    const [filter, setFilter] = useState<FilterOption>("all");

    const usesMel =
        filter === "all" ||
        filter === "melSpectrogram" ||
        filter === "onsetEnvelope" ||
        filter === "onsetPeaks" ||
        filter === "mfcc" ||
        filter === "mfccDelta" ||
        filter === "mfccDeltaDelta";

    const usesOnset = filter === "all" || filter === "onsetEnvelope" || filter === "onsetPeaks";

    const usesPeakPick = filter === "all" || filter === "onsetPeaks";

    // Note: HPSS visualization config (showDcBin) is only relevant if HPSS functions are selected
    // But parameters are relevant if HPSS functions are used.
    const usesHpss = filter === "all" || filter === "hpssHarmonic" || filter === "hpssPercussive";

    const usesMfcc = filter === "all" || filter === "mfcc" || filter === "mfccDelta" || filter === "mfccDeltaDelta";

    // Heatmap scheme applies to 2D outputs
    const usesHeatmapFn =
        filter === "all" ||
        filter === "melSpectrogram" ||
        filter === "hpssHarmonic" ||
        filter === "hpssPercussive" ||
        filter === "mfcc" ||
        filter === "mfccDelta" ||
        filter === "mfccDeltaDelta";

    return (
        <Modal title="MIR Configuration" open={props.open} onOpenChange={props.onOpenChange}>
            <div className="space-y-6">
                {/* Filter Control */}
                <div className="flex items-center gap-3 border-b border-zinc-100 pb-4 dark:border-zinc-800">
                    <label className="text-sm font-medium text-zinc-700 dark:text-zinc-200">
                        Show options for:
                    </label>
                    <select
                        value={filter}
                        onChange={(e) => setFilter(e.target.value as FilterOption)}
                        className="rounded-md border border-zinc-200 bg-white px-2 py-1 text-sm dark:border-zinc-800 dark:bg-zinc-950"
                    >
                        <option value="all">All Functions</option>
                        <option value="spectralCentroid">Spectral Centroid (1D)</option>
                        <option value="spectralFlux">Spectral Flux (1D)</option>
                        <option value="onsetEnvelope">Onset Envelope (1D)</option>
                        <option value="onsetPeaks">Onset Peaks (events)</option>
                        <option value="melSpectrogram">Mel Spectrogram (2D)</option>
                        <option value="hpssHarmonic">HPSS Harmonic Spectrogram (2D)</option>
                        <option value="hpssPercussive">HPSS Percussive Spectrogram (2D)</option>
                        <option value="mfcc">MFCC (2D)</option>
                        <option value="mfccDelta">MFCC Delta (2D)</option>
                        <option value="mfccDeltaDelta">MFCC Delta-Delta (2D)</option>
                    </select>
                </div>

                <div className="space-y-4">
                    <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                        <label className="grid grid-cols-[160px,1fr] items-center gap-2">
                            <span className="text-xs text-zinc-600 dark:text-zinc-300">FFT size (power of 2)</span>
                            <input
                                type="number"
                                min={64}
                                step={64}
                                value={props.fftSize}
                                onChange={(e) => props.setFftSize(Math.max(64, Math.floor(Number(e.target.value)) || 64))}
                                className="rounded border border-zinc-200 bg-white px-2 py-1 text-sm dark:border-zinc-800 dark:bg-zinc-950"
                            />
                        </label>
                        <label className="grid grid-cols-[160px,1fr] items-center gap-2">
                            <span className="text-xs text-zinc-600 dark:text-zinc-300">Hop size</span>
                            <input
                                type="number"
                                min={1}
                                step={16}
                                value={props.hopSize}
                                onChange={(e) => props.setHopSize(Math.max(1, Math.floor(Number(e.target.value)) || 1))}
                                className="rounded border border-zinc-200 bg-white px-2 py-1 text-sm dark:border-zinc-800 dark:bg-zinc-950"
                            />
                        </label>
                    </div>

                    {usesMel && (
                        <div className="rounded-lg border border-zinc-100 bg-zinc-50/50 p-3 dark:border-zinc-800/50 dark:bg-zinc-900/50">
                            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">Mel Spectrogram</h3>
                            <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                                <label className="grid grid-cols-[160px,1fr] items-center gap-2">
                                    <span className="text-xs text-zinc-600 dark:text-zinc-300">Mel bands (nMels)</span>
                                    <input
                                        type="number"
                                        min={1}
                                        max={256}
                                        step={1}
                                        value={props.melBands}
                                        onChange={(e) => props.setMelBands(Math.max(1, Math.floor(Number(e.target.value)) || 1))}
                                        className="rounded border border-zinc-200 bg-white px-2 py-1 text-sm dark:border-zinc-800 dark:bg-zinc-950"
                                    />
                                </label>
                                <label className="grid grid-cols-[160px,1fr] items-center gap-2">
                                    <span className="text-xs text-zinc-600 dark:text-zinc-300">Mel fMin (Hz)</span>
                                    <input
                                        type="number"
                                        min={0}
                                        step={10}
                                        value={props.melFMin}
                                        onChange={(e) => props.setMelFMin(e.target.value)}
                                        placeholder="default"
                                        className="rounded border border-zinc-200 bg-white px-2 py-1 text-sm dark:border-zinc-800 dark:bg-zinc-950"
                                    />
                                </label>
                                <label className="grid grid-cols-[160px,1fr] items-center gap-2">
                                    <span className="text-xs text-zinc-600 dark:text-zinc-300">Mel fMax (Hz)</span>
                                    <input
                                        type="number"
                                        min={0}
                                        step={10}
                                        value={props.melFMax}
                                        onChange={(e) => props.setMelFMax(e.target.value)}
                                        placeholder="default (Nyquist)"
                                        className="rounded border border-zinc-200 bg-white px-2 py-1 text-sm dark:border-zinc-800 dark:bg-zinc-950"
                                    />
                                </label>
                            </div>
                        </div>
                    )}

                    {usesOnset && (
                        <div className="rounded-lg border border-zinc-100 bg-zinc-50/50 p-3 dark:border-zinc-800/50 dark:bg-zinc-900/50">
                            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">Onset Detection</h3>
                            <div className="space-y-2">
                                <label className="grid grid-cols-[180px,1fr,60px] items-center gap-2">
                                    <span className="text-xs text-zinc-600 dark:text-zinc-300">Onset smoothing (ms)</span>
                                    <input
                                        type="range"
                                        min={0}
                                        max={200}
                                        step={5}
                                        value={props.onsetSmoothMs}
                                        onChange={(e) => props.setOnsetSmoothMs(Number(e.target.value))}
                                    />
                                    <span className="text-right text-xs tabular-nums text-zinc-600 dark:text-zinc-300">{props.onsetSmoothMs}</span>
                                </label>

                                <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                                    <label className="grid grid-cols-[160px,1fr] items-center gap-2">
                                        <span className="text-xs text-zinc-600 dark:text-zinc-300">Diff method</span>
                                        <select
                                            value={props.onsetDiffMethod}
                                            onChange={(e) => props.setOnsetDiffMethod(e.target.value as "rectified" | "abs")}
                                            className="rounded-md border border-zinc-200 bg-white px-2 py-1 text-sm dark:border-zinc-800 dark:bg-zinc-950"
                                        >
                                            <option value="rectified">Rectified (positive only)</option>
                                            <option value="abs">Absolute</option>
                                        </select>
                                    </label>
                                    <label className="inline-flex items-center gap-2">
                                        <input type="checkbox" checked={props.onsetUseLog} onChange={(e) => props.setOnsetUseLog(e.target.checked)} />
                                        <span className="text-xs text-zinc-600 dark:text-zinc-300">Log-compress differences</span>
                                    </label>
                                </div>
                            </div>
                        </div>
                    )}

                    {usesPeakPick && (
                        <div className="rounded-lg border border-zinc-100 bg-zinc-50/50 p-3 dark:border-zinc-800/50 dark:bg-zinc-900/50">
                            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">Peak Picking</h3>
                            <div className="space-y-2">
                                <label className="grid grid-cols-[180px,1fr,60px] items-center gap-2">
                                    <span className="text-xs text-zinc-600 dark:text-zinc-300">Peak min interval (ms)</span>
                                    <input
                                        type="range"
                                        min={20}
                                        max={400}
                                        step={10}
                                        value={props.peakMinIntervalMs}
                                        onChange={(e) => props.setPeakMinIntervalMs(Number(e.target.value))}
                                    />
                                    <span className="text-right text-xs tabular-nums text-zinc-600 dark:text-zinc-300">{props.peakMinIntervalMs}</span>
                                </label>

                                <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
                                    <label className="grid grid-cols-[140px,1fr] items-center gap-2">
                                        <span className="text-xs text-zinc-600 dark:text-zinc-300">Peak threshold</span>
                                        <input
                                            type="number"
                                            step={0.01}
                                            value={props.peakThreshold}
                                            onChange={(e) => props.setPeakThreshold(e.target.value)}
                                            placeholder="auto"
                                            className="rounded border border-zinc-200 bg-white px-2 py-1 text-sm dark:border-zinc-800 dark:bg-zinc-950"
                                        />
                                    </label>
                                    <label className="grid grid-cols-[140px,1fr] items-center gap-2">
                                        <span className="text-xs text-zinc-600 dark:text-zinc-300">Adaptive factor</span>
                                        <input
                                            type="number"
                                            step={0.1}
                                            value={props.peakAdaptiveFactor}
                                            onChange={(e) => props.setPeakAdaptiveFactor(e.target.value)}
                                            placeholder="blank = off"
                                            className="rounded border border-zinc-200 bg-white px-2 py-1 text-sm dark:border-zinc-800 dark:bg-zinc-950"
                                        />
                                    </label>
                                </div>
                            </div>
                        </div>
                    )}

                    {usesHpss && (
                        <div className="rounded-lg border border-zinc-100 bg-zinc-50/50 p-3 dark:border-zinc-800/50 dark:bg-zinc-900/50">
                            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">HPSS</h3>
                            <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                                <label className="grid grid-cols-[160px,1fr] items-center gap-2">
                                    <span className="text-xs text-zinc-600 dark:text-zinc-300">HPSS timeMedian</span>
                                    <input
                                        type="number"
                                        min={1}
                                        step={2}
                                        value={props.hpssTimeMedian}
                                        onChange={(e) => props.setHpssTimeMedian(Math.max(1, Math.floor(Number(e.target.value)) | 1))}
                                        className="rounded border border-zinc-200 bg-white px-2 py-1 text-sm dark:border-zinc-800 dark:bg-zinc-950"
                                    />
                                </label>
                                <label className="grid grid-cols-[160px,1fr] items-center gap-2">
                                    <span className="text-xs text-zinc-600 dark:text-zinc-300">HPSS freqMedian</span>
                                    <input
                                        type="number"
                                        min={1}
                                        step={2}
                                        value={props.hpssFreqMedian}
                                        onChange={(e) => props.setHpssFreqMedian(Math.max(1, Math.floor(Number(e.target.value)) | 1))}
                                        className="rounded border border-zinc-200 bg-white px-2 py-1 text-sm dark:border-zinc-800 dark:bg-zinc-950"
                                    />
                                </label>
                            </div>
                        </div>
                    )}

                    {usesMfcc && (
                        <div className="rounded-lg border border-zinc-100 bg-zinc-50/50 p-3 dark:border-zinc-800/50 dark:bg-zinc-900/50">
                            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">MFCC</h3>
                            <label className="grid grid-cols-[180px,1fr] items-center gap-2">
                                <span className="text-xs text-zinc-600 dark:text-zinc-300">MFCC nCoeffs</span>
                                <input
                                    type="number"
                                    min={1}
                                    max={40}
                                    step={1}
                                    value={props.mfccNCoeffs}
                                    onChange={(e) => props.setMfccNCoeffs(Math.max(1, Math.floor(Number(e.target.value)) || 1))}
                                    className="rounded border border-zinc-200 bg-white px-2 py-1 text-sm dark:border-zinc-800 dark:bg-zinc-950"
                                />
                            </label>
                        </div>
                    )}

                    <div className="rounded-lg border border-zinc-100 bg-zinc-50/50 p-3 dark:border-zinc-800/50 dark:bg-zinc-900/50">
                        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">Display Options</h3>
                        <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                            {(usesHpss) && (
                                <label className="inline-flex items-center gap-2">
                                    <input type="checkbox" checked={props.showDcBin} onChange={(e) => props.setShowDcBin(e.target.checked)} />
                                    <span className="text-xs text-zinc-600 dark:text-zinc-300">Show DC bin (spectrogram)</span>
                                </label>
                            )}
                            {(usesMfcc) && (
                                <label className="inline-flex items-center gap-2">
                                    <input type="checkbox" checked={props.showMfccC0} onChange={(e) => props.setShowMfccC0(e.target.checked)} />
                                    <span className="text-xs text-zinc-600 dark:text-zinc-300">Show MFCC C0</span>
                                </label>
                            )}
                            {usesHeatmapFn && (
                                <label className="grid grid-cols-[160px,1fr] items-center gap-2">
                                    <span className="text-xs text-zinc-600 dark:text-zinc-300">Heatmap colour scheme</span>
                                    <select
                                        value={props.heatmapScheme}
                                        onChange={(e) => props.setHeatmapScheme(e.target.value as HeatmapColorScheme)}
                                        className="rounded-md border border-zinc-200 bg-white px-2 py-1 text-sm dark:border-zinc-800 dark:bg-zinc-950"
                                    >
                                        <option value="grayscale">Grayscale</option>
                                        <option value="viridis">Viridis</option>
                                        <option value="plasma">Plasma</option>
                                        <option value="magma">Magma</option>
                                    </select>
                                </label>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </Modal>
    );
}
