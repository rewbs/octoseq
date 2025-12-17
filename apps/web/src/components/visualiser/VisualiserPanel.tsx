"use client";

import { useEffect, useRef, useState, useMemo } from "react";
import type { AudioBufferLike } from "@octoseq/mir";

// We import the mock type if the real package isn't built yet, preventing TS errors.
// In a real build, this would import from @octoseq/visualiser.
// The dynamic import below handles the actual loading.
import { WasmVisualiser } from "@octoseq/visualiser";

interface VisualiserPanelProps {
  audio: AudioBufferLike | null;
  playbackTime: number;
  audioDuration?: number; // Optional explicitly passed duration
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  mirResults: Record<string, any> | null; // Keys are feature names
  similarityCurve?: Float32Array | null; // New prop for similarity data
  isPlaying?: boolean;
  className?: string;
}

// Helper to normalize array to [0, 1]
function normalizeSignal(data: number[] | Float32Array, customRange?: [number, number]): Float32Array {
  let min = Infinity;
  let max = -Infinity;

  if (customRange) {
    min = customRange[0];
    max = customRange[1];
  } else {
    for (let i = 0; i < data.length; i++) {
      const v = data[i]!;
      if (v < min) min = v;
      if (v > max) max = v;
    }
  }

  const range = max - min;
  const out = new Float32Array(data.length);
  if (range === 0) return out; // All zeros

  for (let i = 0; i < data.length; i++) {
    out[i] = (data[i]! - min) / range;
  }
  return out;
}

// Helper to get raw data
function getSignalData(
  sourceName: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  mirResults: Record<string, any> | null,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  audioBuffer: any | null,
  similarityCurve?: Float32Array | null
): Float32Array | null {
  if (sourceName === "Waveform") {
    if (audioBuffer) {
      // Standard AudioBuffer
      if (typeof audioBuffer.getChannelData === 'function') {
        return audioBuffer.getChannelData(0);
      }
      // MirAudioPayload
      if (audioBuffer.mono) {
        return audioBuffer.mono;
      }
    }
    return null;
  }

  if (sourceName === "Similarity") {
    return similarityCurve ?? null;
  }

  if (!mirResults) return null;
  const res = mirResults[sourceName];
  if (!res) return null;

  // Handle generic 1D result object from page.tsx
  if (res.values) return res.values;
  // Handle raw array if passed directly
  if (res instanceof Float32Array || Array.isArray(res)) return new Float32Array(res);

  return null;
}


export function VisualiserPanel({ audio, playbackTime, audioDuration, mirResults, similarityCurve, isPlaying, className }: VisualiserPanelProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const visualiserRef = useRef<WasmVisualiser | null>(null);
  const [rotSource, setRotSource] = useState<string>("spectralCentroid");
  const [zoomSource, setZoomSource] = useState<string>("spectralFlux");
  const [sigmoidK, setSigmoidK] = useState<number>(5.0);
  const [sigmoidC, setSigmoidC] = useState<number>(0.5); // Center 0.0-1.0
  const [isReady, setIsReady] = useState(false);
  const requestRef = useRef<number>(0);
  const timeRef = useRef(playbackTime);
  const isPlayingRef = useRef(!!isPlaying);

  // Range controls (Min, Max)
  // Default to full normalised range 0-1
  const [rotRange, setRotRange] = useState<[number, number]>([0, 1]);
  const [zoomRange, setZoomRange] = useState<[number, number]>([0, 1]);

  // Gain controls (Multiplier)
  const [rotGain, setRotGain] = useState<number>(1.0);
  const [zoomGain, setZoomGain] = useState<number>(1.0);

  // Update timeRef for the loop
  useEffect(() => {
    timeRef.current = playbackTime;
    isPlayingRef.current = !!isPlaying;

    if (visualiserRef.current) {
      // Check for large drift or paused state to sync
      // If playing, we rely on render loop (dt) to advance time smoothly.
      // Only force set_time if we drift significantly (e.g. user seek).
      const vis = visualiserRef.current;
      // @ts-ignore
      if (vis.get_current_vals) {
        // @ts-ignore
        const vals = vis.get_current_vals();
        const internalTime = (vals && vals[2] !== undefined) ? vals[2] : -1;

        // If paused, always sync.
        if (!isPlaying) {
          vis.set_time(playbackTime);
          return;
        }

        // If playing, check drift (> 50ms)
        const drift = Math.abs(internalTime - playbackTime);
        if (drift > 0.1) {
          // console.log("Syncing drift:", drift);
          vis.set_time(playbackTime);
        }
      } else {
        // Fallback for safety if no getter
        vis.set_time(playbackTime);
      }
    }
  }, [playbackTime, isPlaying]);

  useEffect(() => {
    let active = true;

    async function init() {
      try {
        const pkg = await import("@octoseq/visualiser");
        if (!active) return;

        // Initialize WASM module using default export
        if (typeof pkg.default === "function") {
          await pkg.default();
        }

        if (canvasRef.current) {
          // Initialize visualiser
          const vis = await pkg.create_visualiser(canvasRef.current);
          visualiserRef.current = vis;
          console.log("Visualiser initialized", vis);
          console.log("WASM methods:", Object.keys(Object.getPrototypeOf(vis)));
          setIsReady(true);

          // Initial sync
          vis.set_time(timeRef.current);
        }
      } catch (e) {
        console.error("Failed to load visualiser WASM:", e);
      }
    }

    init();

    return () => {
      active = false;
    };
  }, []);

  // Push Data to WASM when state changes
  useEffect(() => {
    if (!visualiserRef.current || !mirResults) return;
    const vis = visualiserRef.current;

    // Calc audio duration safely
    let duration = audioDuration || 1;

    if (!audioDuration) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const a = audio as any;
      if (a) {
        const len = a.length || (a.mono ? a.mono.length : 0);
        const sr = a.sampleRate || 0;
        if (len > 0 && sr > 0) duration = len / sr;
      }
    }

    // Process Rotation
    let rotData = new Float32Array(0);
    if (rotSource === "None") {
      // no-op
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data = getSignalData(rotSource, mirResults, audio, similarityCurve) as any;
      if (data) {
        rotData = data;
      } else {
        console.warn(`[VisualiserPanel] Source not found: ${rotSource}`);
      }
    }

    // --- Zoom Data ---
    let zoomData = new Float32Array(0);
    if (zoomSource === "None") {
      // no-op
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data = getSignalData(zoomSource, mirResults, audio, similarityCurve) as any;
      if (data) {
        zoomData = data;
      } else {
        console.warn(`[VisualiserPanel] Source not found: ${zoomSource}`);
      }
    }
    if (rotData && rotData.length > 0) {
      // Calculate raw stats for debug
      let min = Infinity, max = -Infinity;
      for (let i = 0; i < rotData.length; i++) {
        if (rotData[i]! < min) min = rotData[i]!;
        if (rotData[i]! > max) max = rotData[i]!;
      }
      console.log(`[${rotSource}] Raw Range:`, min, "to", max);

      // Use safe defaults if NaN
      const rMin = isNaN(rotRange[0]) ? -1 : rotRange[0];
      const rMax = isNaN(rotRange[1]) ? 1 : rotRange[1];
      const currentRotGain = isNaN(rotGain) ? 1.0 : rotGain;

      const norm = normalizeSignal(rotData, [rMin, rMax]);

      // Apply gain
      if (currentRotGain !== 1.0) {
        for (let i = 0; i < norm.length; i++) {
          norm[i]! *= currentRotGain;
        }
      }

      const rate = duration > 0 ? norm.length / duration : 0;

      // @ts-ignore
      if (vis.push_rotation_data) {
        vis.push_rotation_data(norm, rate);
      }
    }

    // Process Zoom
    if (zoomData && zoomData.length > 0) {
      // stats
      let min = Infinity, max = -Infinity;
      for (let i = 0; i < zoomData.length; i++) {
        if (zoomData[i]! < min) min = zoomData[i]!;
        if (zoomData[i]! > max) max = zoomData[i]!;
      }
      console.log(`[${zoomSource}] Raw Range:`, min, "to", max);

      const zMin = isNaN(zoomRange[0]) ? 0 : zoomRange[0];
      const zMax = isNaN(zoomRange[1]) ? 1 : zoomRange[1];
      const currentZoomGain = isNaN(zoomGain) ? 1.0 : zoomGain;

      const norm = normalizeSignal(zoomData, [zMin, zMax]);

      // Apply gain
      if (currentZoomGain !== 1.0) {
        for (let i = 0; i < norm.length; i++) {
          norm[i]! *= currentZoomGain;
        }
      }

      const rate = duration > 0 ? norm.length / duration : 0;

      // console.log("Pushing ZOOM:", { src: zoomSource, len: norm.length, dur: duration, rate });

      // @ts-ignore
      if (vis.push_zoom_data) {
        vis.push_zoom_data(norm, rate);
      }
    }
  }, [rotSource, zoomSource, mirResults, isReady, audio, audioDuration, rotRange, zoomRange, rotGain, zoomGain, similarityCurve]);

  // Update Sigmoid
  useEffect(() => {
    if (!visualiserRef.current || !isReady) return;
    // @ts-ignore
    if (visualiserRef.current.set_sigmoid_k) {
      // @ts-ignore
      visualiserRef.current.set_sigmoid_k(sigmoidK);
    }
  }, [sigmoidK, isReady]);

  // Render Loop
  useEffect(() => {
    if (!isReady || !visualiserRef.current) return;

    let lastTime = performance.now();
    const vis = visualiserRef.current;

    const loop = (now: number) => {
      const dt = (now - lastTime) / 1000;
      lastTime = now;

      if (isPlayingRef.current) {
        vis.render(dt);
      } else {
        // If paused, force the specific time and render with dt=0 to update uniforms but not advance time
        vis.set_time(timeRef.current);
        vis.render(0);
      }

      // Poll debug values if available
      // @ts-ignore
      if (vis.get_current_vals) {
        // @ts-ignore
        const vals = vis.get_current_vals(); // returns Float32Array [rot, zoom, time, last_input, sig_dur]
        if (vals) {
          setDebugValues({
            rot: vals[0]!,
            zoom: vals[1]!,
            time: vals[2]!,
            input: vals[3]!,
            sigDur: vals[4]!
          });
        }
      } else {
        if (Math.random() < 0.01) console.warn("vis.get_current_vals not found on WASM object", Object.keys(Object.getPrototypeOf(vis)));
      }

      requestRef.current = requestAnimationFrame(loop);
    };
    requestRef.current = requestAnimationFrame(loop);
    return () => {
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
    };
  }, [isReady]);

  // Resize observer
  useEffect(() => {
    if (!canvasRef.current || !visualiserRef.current) return;
    const vis = visualiserRef.current;

    const observer = new ResizeObserver(entries => {
      for (const entry of entries) {
        const width = entry.contentRect.width;
        const height = entry.contentRect.height;
        // Canvas logic
        const dpr = window.devicePixelRatio || 1;
        canvasRef.current!.width = width * dpr;
        canvasRef.current!.height = height * dpr;
        vis.resize(width * dpr, height * dpr);
      }
    });
    observer.observe(canvasRef.current);
    return () => observer.disconnect();
  }, [isReady]);

  const [debugValues, setDebugValues] = useState<{ rot: number, zoom: number, time: number, input: number, sigDur: number } | null>(null);
  const [availableSources, setAvailableSources] = useState<string[]>([]);

  useEffect(() => {
    const available = new Set(["Waveform", "Similarity"]);
    if (mirResults) {
      Object.keys(mirResults).forEach(k => available.add(k));
    }
    setAvailableSources(Array.from(available).sort());
  }, [mirResults, audio]);

  return (
    <div className={`flex flex-col bg-gray-900 rounded-lg overflow-hidden ${className}`}>
      <div className="flex-none flex justify-between items-center p-2 bg-gray-900 z-10">
        <h3 className="text-gray-200 font-bold text-sm">Visualiser</h3>
        <div className="flex gap-4 text-sm scale-90 origin-right">
          <div className="flex gap-4 text-sm items-end">
            <div className="flex flex-col">
              <label className="text-gray-400 text-[10px]">Rot Source</label>
              <select
                value={rotSource}
                onChange={e => setRotSource(e.target.value)}
                className="bg-gray-800 text-white rounded p-1 w-24 text-xs"
              >
                {availableSources.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div className="flex gap-1 items-center">
              <div className="flex flex-col w-12">
                <label className="text-gray-500 text-[10px]">Min</label>
                <input type="number" step="0.1" value={isNaN(rotRange[0]) ? '' : rotRange[0]} onChange={e => setRotRange([parseFloat(e.target.value), rotRange[1]])} className="bg-gray-800 text-white rounded p-1 text-xs" />
              </div>
              <div className="flex flex-col w-12">
                <label className="text-gray-500 text-[10px]">Max</label>
                <input type="number" step="0.1" value={isNaN(rotRange[1]) ? '' : rotRange[1]} onChange={e => setRotRange([rotRange[0], parseFloat(e.target.value)])} className="bg-gray-800 text-white rounded p-1 text-xs" />
              </div>
              <div className="flex flex-col w-10">
                <label className="text-gray-500 text-[10px]">Gain</label>
                <input type="number" step="0.1" value={isNaN(rotGain) ? '' : rotGain} onChange={e => setRotGain(parseFloat(e.target.value))} className="bg-gray-800 text-white rounded p-1 text-xs" />
              </div>
            </div>

            <div className="w-px bg-gray-700 h-8 mx-2"></div>

            <div className="flex flex-col">
              <label className="text-gray-400 text-[10px]">Zoom Source</label>
              <select
                value={zoomSource}
                onChange={e => setZoomSource(e.target.value)}
                className="bg-gray-800 text-white rounded p-1 w-24 text-xs"
              >
                {availableSources.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div className="flex gap-1 items-center">
              <div className="flex flex-col w-12">
                <label className="text-gray-500 text-[10px]">Min</label>
                <input type="number" step="0.1" value={isNaN(zoomRange[0]) ? '' : zoomRange[0]} onChange={e => setZoomRange([parseFloat(e.target.value), zoomRange[1]])} className="bg-gray-800 text-white rounded p-1 text-xs" />
              </div>
              <div className="flex flex-col w-12">
                <label className="text-gray-500 text-[10px]">Max</label>
                <input type="number" step="0.1" value={isNaN(zoomRange[1]) ? '' : zoomRange[1]} onChange={e => setZoomRange([zoomRange[0], parseFloat(e.target.value)])} className="bg-gray-800 text-white rounded p-1 text-xs" />
              </div>
              <div className="flex flex-col w-10">
                <label className="text-gray-500 text-[10px]">Gain</label>
                <input type="number" step="0.1" value={isNaN(zoomGain) ? '' : zoomGain} onChange={e => setZoomGain(parseFloat(e.target.value))} className="bg-gray-800 text-white rounded p-1 text-xs" />
              </div>
            </div>

            <div className="w-px bg-gray-700 h-8 mx-2"></div>

            <div className="flex flex-col w-20">
              <label className="text-gray-400 text-[10px]">Sigmoid ({sigmoidK})</label>
              <input
                type="range"
                min="0" max="20" step="0.5"
                value={sigmoidK}
                onChange={e => setSigmoidK(parseFloat(e.target.value))}
                className="accent-indigo-500"
              />
            </div>
          </div>
        </div>
      </div>

      <div className="flex-1 relative w-full h-full bg-black overflow-hidden">
        <canvas ref={canvasRef} className="absolute inset-0 block w-full h-full" />

        {/* Debug Overlay */}
        {isReady && debugValues && (
          <div className="absolute top-2 left-2 bg-black/50 text-green-400 font-mono text-xs p-2 rounded pointer-events-none">
            <div>ROT: {debugValues.rot.toFixed(3)}</div>
            <div>ZOOM: {debugValues.zoom.toFixed(3)}</div>
            <div>TIME: {debugValues.time.toFixed(3)}</div>
          </div>
        )}

        {!isReady && (
          <div className="absolute inset-0 flex items-center justify-center text-xs text-neutral-500">
            Initializing WGPU...
          </div>
        )}
      </div>
    </div>
  );
}
