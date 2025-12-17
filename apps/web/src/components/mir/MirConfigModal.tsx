
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";

export type MirConfigConfig = {
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
};

type MirConfigModalProps = {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    config: MirConfigConfig;
};

export function MirConfigModal({ open, onOpenChange, config }: MirConfigModalProps) {
    if (!open) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
            <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg shadow-xl w-full max-w-2xl max-h-[85vh] flex flex-col">
                <div className="flex items-center justify-between p-4 border-b border-zinc-200 dark:border-zinc-800">
                    <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">Analysis Configuration</h2>
                    <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => onOpenChange(false)}>
                        <X className="h-4 w-4" />
                    </Button>
                </div>

                <div className="p-6 overflow-y-auto space-y-6">
                    {/* Spectrogram settings */}
                    <Section title="Spectrogram">
                        <div className="grid grid-cols-2 gap-4">
                            <SelectField label="FFT Size" value={config.fftSize} onChange={v => config.setFftSize(Number(v))}>
                                <option value="256">256</option>
                                <option value="512">512</option>
                                <option value="1024">1024</option>
                                <option value="2048">2048</option>
                                <option value="4096">4096</option>
                            </SelectField>
                            <SelectField label="Hop Size" value={config.hopSize} onChange={v => config.setHopSize(Number(v))}>
                                <option value="64">64</option>
                                <option value="128">128</option>
                                <option value="256">256</option>
                                <option value="512">512</option>
                            </SelectField>
                        </div>
                    </Section>

                    {/* Mel Settings */}
                    <Section title="Mel Spectrogram">
                        <div className="space-y-4">
                            <InputField label="Mel Bands" type="number" value={config.melBands} onChange={v => config.setMelBands(Number(v))} />
                            <div className="grid grid-cols-2 gap-4">
                                <InputField label="F Min (Hz)" value={config.melFMin} onChange={v => config.setMelFMin(String(v))} placeholder="Default" />
                                <InputField label="F Max (Hz)" value={config.melFMax} onChange={v => config.setMelFMax(String(v))} placeholder="Default" />
                            </div>
                        </div>
                    </Section>

                    {/* Onset Settings */}
                    <Section title="Onset Detection">
                        <div className="space-y-4">
                            <div className="flex items-center justify-between">
                                <label className="text-xs font-medium text-zinc-700 dark:text-zinc-300">Diff Method</label>
                                <select
                                    className="h-8 w-32 rounded-md border border-zinc-200 bg-white px-3 py-1 text-xs shadow-sm dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50"
                                    value={config.onsetDiffMethod}
                                    onChange={(e) => config.setOnsetDiffMethod(e.target.value as "rectified" | "abs")}
                                >
                                    <option value="rectified">Rectified</option>
                                    <option value="abs">Absolute</option>
                                </select>
                            </div>
                            <div className="flex items-center gap-2">
                                <input type="checkbox" id="useLog" checked={config.onsetUseLog} onChange={(e) => config.setOnsetUseLog(e.target.checked)} />
                                <label htmlFor="useLog" className="text-xs text-zinc-700 dark:text-zinc-300">Use Log Flux</label>
                            </div>
                            <InputField label="Smooth Window (ms)" type="number" value={config.onsetSmoothMs} onChange={v => config.setOnsetSmoothMs(Number(v))} />
                        </div>
                    </Section>

                    {/* Peak Picking */}
                    <Section title="Peak Picking">
                        <div className="space-y-4">
                            <InputField label="Min Interval (ms)" type="number" value={config.peakMinIntervalMs} onChange={v => config.setPeakMinIntervalMs(Number(v))} />
                            <div className="grid grid-cols-2 gap-4">
                                <InputField label="Threshold" value={config.peakThreshold} onChange={v => config.setPeakThreshold(String(v))} placeholder="Auto" />
                                <InputField label="Adapt Factor" value={config.peakAdaptiveFactor} onChange={v => config.setPeakAdaptiveFactor(String(v))} placeholder="Auto" />
                            </div>
                        </div>
                    </Section>

                    {/* HPSS */}
                    <Section title="HPSS">
                        <div className="grid grid-cols-2 gap-4">
                            <InputField label="Time Median" type="number" value={config.hpssTimeMedian} onChange={v => config.setHpssTimeMedian(Number(v))} />
                            <InputField label="Freq Median" type="number" value={config.hpssFreqMedian} onChange={v => config.setHpssFreqMedian(Number(v))} />
                        </div>
                    </Section>

                    {/* MFCC */}
                    <Section title="MFCC">
                        <div className="space-y-4">
                            <InputField label="Num Coeffs" type="number" value={config.mfccNCoeffs} onChange={v => config.setMfccNCoeffs(Number(v))} />
                            <div className="flex flex-col gap-2">
                                <div className="flex items-center gap-2">
                                    <input type="checkbox" id="mfccC0" checked={config.showMfccC0} onChange={(e) => config.setShowMfccC0(e.target.checked)} />
                                    <label htmlFor="mfccC0" className="text-xs text-zinc-700 dark:text-zinc-300">Show C0 (Energy)</label>
                                </div>
                                <div className="flex items-center gap-2">
                                    <input type="checkbox" id="showDc" checked={config.showDcBin} onChange={(e) => config.setShowDcBin(e.target.checked)} />
                                    <label htmlFor="showDc" className="text-xs text-zinc-700 dark:text-zinc-300">Show DC Bin</label>
                                </div>
                            </div>
                        </div>
                    </Section>
                </div>
            </div>
        </div>
    );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <section className="space-y-3">
            <h3 className="font-semibold text-sm border-b border-zinc-100 dark:border-zinc-800 pb-1 text-zinc-900 dark:text-zinc-100 mb-4">{title}</h3>
            {children}
        </section>
    );
}

function InputField({ label, type = "text", value, onChange, placeholder }: { label: string; type?: string; value: string | number; onChange: (v: string | number) => void; placeholder?: string }) {
    return (
        <div>
            <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">{label}</label>
            <input
                type={type}
                className="flex h-8 w-full rounded-md border border-zinc-200 bg-white px-3 py-1 text-xs shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-zinc-500 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-zinc-950 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-800 dark:bg-zinc-950 dark:placeholder:text-zinc-400 dark:focus-visible:ring-zinc-300"
                value={value}
                onChange={(e) => onChange(e.target.value)}
                placeholder={placeholder}
            />
        </div>
    );
}

function SelectField({ label, value, onChange, children }: { label: string; value: string | number; onChange: (v: string | number) => void; children: React.ReactNode }) {
    return (
        <div>
            <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">{label}</label>
            <select
                className="flex h-8 w-full items-center justify-between rounded-md border border-zinc-200 bg-white px-3 py-1 text-xs shadow-sm placeholder:text-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-950 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-800 dark:bg-zinc-950 dark:placeholder:text-zinc-400 dark:focus:ring-zinc-300"
                value={value}
                onChange={(e) => onChange(e.target.value)}
            >
                {children}
            </select>
        </div>
    );
}
