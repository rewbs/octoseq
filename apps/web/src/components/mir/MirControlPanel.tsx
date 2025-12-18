"use client";


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
    disabled?: boolean;
};

export function MirControlPanel({ selected, onSelectedChange, disabled }: MirControlPanelProps) {
    return (
        <div className="flex flex-wrap items-center gap-3">
            <label className="inline-flex items-center gap-2">
                <span className="text-sm text-zinc-600 dark:text-zinc-300">MIR function</span>
                <select
                    className="rounded-md border border-zinc-200 bg-white px-2 py-1 text-sm dark:border-zinc-800 dark:bg-zinc-950"
                    value={selected}
                    onChange={(e) => onSelectedChange(e.target.value as MirFunctionId)}
                    disabled={disabled}
                >
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
            </label>
        </div>
    );
}
