
import { useState, useRef, useEffect } from "react";
import { Move, X } from "lucide-react";
import { Button } from "@/components/ui/button";

export type DebugStats = {
    timings?: {
        fingerprintMs?: number;
        scanMs?: number;
        modelMs?: number;
        totalMs: number;
    };
    audio?: {
        sampleRate: number | null;
        totalSamples: number | null;
        duration: number;
    };
    visualiser?: {
        fps: number;
    }
};

type DebugPanelProps = {
    isOpen: boolean;
    onClose: () => void;
    stats: DebugStats;
    debug: boolean;
    setDebug: (v: boolean) => void;
    useWorker: boolean;
    setUseWorker: (v: boolean) => void;
    enableGpu: boolean;
    setEnableGpu: (v: boolean) => void;
};

export function DebugPanel({
    isOpen,
    onClose,
    stats,
    debug,
    setDebug,
    useWorker,
    setUseWorker,
    enableGpu,
    setEnableGpu
}: DebugPanelProps) {
    const [position, setPosition] = useState({ x: 20, y: 100 });
    const isDragging = useRef(false);
    const dragOffset = useRef({ x: 0, y: 0 });

    useEffect(() => {
        const handleMouseMove = (e: MouseEvent) => {
            if (isDragging.current) {
                setPosition({
                    x: e.clientX - dragOffset.current.x,
                    y: e.clientY - dragOffset.current.y
                });
            }
        };

        const handleMouseUp = () => {
            isDragging.current = false;
        };

        window.addEventListener("mousemove", handleMouseMove);
        window.addEventListener("mouseup", handleMouseUp);

        return () => {
            window.removeEventListener("mousemove", handleMouseMove);
            window.removeEventListener("mouseup", handleMouseUp);
        };
    }, []);

    const handleMouseDown = (e: React.MouseEvent) => {
        isDragging.current = true;
        dragOffset.current = {
            x: e.clientX - position.x,
            y: e.clientY - position.y
        };
    };

    if (!isOpen) return null;

    return (
        <div
            className="fixed z-50 w-72 bg-black/80 backdrop-blur-md border border-zinc-800 rounded-lg text-zinc-100 shadow-2xl text-[10px] font-mono select-none"
            style={{ left: position.x, top: position.y }}
        >
            <div
                className="flex items-center justify-between px-3 py-2 border-b border-zinc-800 cursor-move bg-zinc-900/50 rounded-t-lg"
                onMouseDown={handleMouseDown}
            >
                <div className="flex items-center gap-2 font-semibold text-zinc-400">
                    <Move className="w-3 h-3" />
                    <span>DEBUG</span>
                </div>
                <button onClick={onClose} className="hover:text-white text-zinc-500">
                    <X className="w-4 h-4" />
                </button>
            </div>

            <div className="p-3 space-y-4">
                {/* Toggles */}
                <div className="space-y-2">
                    <Toggle label="Debug Logs" value={debug} onChange={setDebug} />
                    <Toggle label="Use Worker" value={useWorker} onChange={setUseWorker} />
                    <Toggle label="Enable GPU" value={enableGpu} onChange={setEnableGpu} />
                </div>

                <div className="h-px bg-zinc-800" />

                {/* Timings */}
                {stats.timings && (
                    <div className="space-y-1">
                        <div className="font-semibold text-zinc-500 mb-1">LAST RUN TIMINGS</div>
                        {stats.timings.fingerprintMs !== undefined && (
                            <Row label="Fingerprint" value={`${stats.timings.fingerprintMs.toFixed(1)}ms`} />
                        )}
                        {stats.timings.scanMs !== undefined && (
                            <Row label="Scan" value={`${stats.timings.scanMs.toFixed(1)}ms`} />
                        )}
                        {stats.timings.modelMs !== undefined && (
                            <Row label="Model" value={`${stats.timings.modelMs.toFixed(1)}ms`} />
                        )}
                        <Row label="Total" value={`${stats.timings.totalMs.toFixed(1)}ms`} highlight />
                    </div>
                )}

                <div className="h-px bg-zinc-800" />

                {/* Audio Stats */}
                <div className="space-y-1">
                    <div className="font-semibold text-zinc-500 mb-1">AUDIO</div>
                    <Row label="Sample Rate" value={stats.audio?.sampleRate ? `${stats.audio.sampleRate}Hz` : "-"} />
                    <Row label="Duration" value={`${stats.audio?.duration.toFixed(2)}s`} />
                    <Row label="Samples" value={stats.audio?.totalSamples?.toLocaleString() ?? "-"} />
                </div>
            </div>
        </div>
    );
}

function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
    return (
        <div className="flex items-center justify-between">
            <span className="text-zinc-400">{label}</span>
            <input
                type="checkbox"
                checked={value}
                onChange={(e) => onChange(e.target.checked)}
                className="rounded border-zinc-700 bg-zinc-900 text-indigo-500 focus:ring-0 focus:ring-offset-0 h-3 w-3"
            />
        </div>
    );
}

function Row({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
    return (
        <div className="flex items-center justify-between">
            <span className="text-zinc-500">{label}</span>
            <span className={highlight ? "text-indigo-400 font-bold" : "text-zinc-300"}>{value}</span>
        </div>
    );
}
