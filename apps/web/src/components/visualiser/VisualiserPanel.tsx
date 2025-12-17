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
  mirResults: Record<string, number[]> | null; // Keys are feature names
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
      const v = data[i];
      if (v < min) min = v;
      if (v > max) max = v;
    }
  }

  const range = max - min;
  const out = new Float32Array(data.length);
  if (range === 0) return out; // All zeros

  for (let i = 0; i < data.length; i++) {
    out[i] = (data[i] - min) / range;
  }
  return out;
}

// Helper to get raw data
function getSignalData(
  sourceName: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  mirResults: Record<string, any> | null,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  audioBuffer: any | null
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
  if (mirResults && mirResults[sourceName]) {
    const val = mirResults[sourceName];
    // If it's a raw array
    if (val.length !== undefined && val.constructor !== Object) {
      return new Float32Array(val);
    }
    // If it's a Mir1DResult object
    if (val.values) {
      return new Float32Array(val.values);
    }
  }
  return null;
}

export function VisualiserPanel({ audio, playbackTime, audioDuration, mirResults, className }: VisualiserPanelProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const visualiserRef = useRef<WasmVisualiser | null>(null);
  const [rotSource, setRotSource] = useState<string>("Spectral Centroid (1D)");
  const [zoomSource, setZoomSource] = useState<string>("RMS (1D)");
  const [sigmoidK, setSigmoidK] = useState<number>(5.0);
  const [isReady, setIsReady] = useState(false);
  const requestRef = useRef<number>(0);
  const timeRef = useRef(playbackTime);
  const [rotRange, setRotRange] = useState<[number, number]>([-1, 1]); // Default for waveform
  const [zoomRange, setZoomRange] = useState<[number, number]>([0, 1]); // Default for RMS
  const [rotGain, setRotGain] = useState<number>(1.0);
  const [zoomGain, setZoomGain] = useState<number>(1.0);

  // Update timeRef for the loop
  useEffect(() => {
    timeRef.current = playbackTime;
    if (visualiserRef.current) {
      visualiserRef.current.set_time(playbackTime);
    }
  }, [playbackTime]);

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
    const rotData = getSignalData(rotSource, mirResults, audio);
    if (rotData && rotData.length > 0) {
      // Calculate raw stats for debug
      let min = Infinity, max = -Infinity;
      for (let i = 0; i < rotData.length; i++) {
        if (rotData[i] < min) min = rotData[i];
        if (rotData[i] > max) max = rotData[i];
      }
      console.log(`[${rotSource}] Raw Range:`, min, "to", max);

      // Use safe defaults if NaN
      const rMin = isNaN(rotRange[0]) ? -1 : rotRange[0];
      const rMax = isNaN(rotRange[1]) ? 1 : rotRange[1];
      const rGain = isNaN(rotGain) ? 1.0 : rotGain;

      const norm = normalizeSignal(rotData, [rMin, rMax]);

      // Apply gain
      if (rGain !== 1.0) {
        for (let i = 0; i < norm.length; i++) {
          norm[i] *= rGain;
        }
      }

      const rate = duration > 0 ? norm.length / duration : 0;

      // @ts-ignore
      if (vis.push_rotation_data) {
        vis.push_rotation_data(norm, rate);
      }
    }

    // Process Zoom
    const zoomData = getSignalData(zoomSource, mirResults, audio);
    if (zoomData && zoomData.length > 0) {
      // stats
      let min = Infinity, max = -Infinity;
      for (let i = 0; i < zoomData.length; i++) {
        if (zoomData[i] < min) min = zoomData[i];
        if (zoomData[i] > max) max = zoomData[i];
      }
      console.log(`[${zoomSource}] Raw Range:`, min, "to", max);

      const zMin = isNaN(zoomRange[0]) ? 0 : zoomRange[0];
      const zMax = isNaN(zoomRange[1]) ? 1 : zoomRange[1];
      const zGain = isNaN(zoomGain) ? 1.0 : zoomGain;

      const norm = normalizeSignal(zoomData, [zMin, zMax]);

      // Apply gain
      if (zGain !== 1.0) {
        for (let i = 0; i < norm.length; i++) {
          norm[i] *= zGain;
        }
      }

      const rate = duration > 0 ? norm.length / duration : 0;

      // console.log("Pushing ZOOM:", { src: zoomSource, len: norm.length, dur: duration, rate });

      // @ts-ignore
      if (vis.push_zoom_data) {
        vis.push_zoom_data(norm, rate);
      }
    }
  }, [rotSource, zoomSource, mirResults, isReady, audio, audioDuration, rotRange, zoomRange, rotGain, zoomGain]);

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

      // Do NOT clamp time every frame.
      // vis.set_time(timeRef.current);
      // Instead let render(dt) advance time, and sync only on prop change (above).

      vis.render(dt);

      // Poll debug values if available
      // @ts-ignore
      if (vis.get_current_vals) {
        // @ts-ignore
        const vals = vis.get_current_vals(); // returns Float32Array [rot, zoom, time, last_input, sig_dur]
        if (vals && vals.length >= 5) {
          setDebugValues({
            rot: vals[0],
            zoom: vals[1],
            time: vals[2],
            input: vals[3],
            sigDur: vals[4]
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

  const availableSources = useMemo(() => {
    const keys = mirResults ? Object.keys(mirResults) : [];
    return ["Waveform", ...keys];
  }, [mirResults]);

  return (
    <div className={`p-4 bg-gray-900 rounded-lg ${className}`}>
      <div className="flex justify-between items-center mb-2">
        <h3 className="text-gray-200 font-bold">GPU Visualiser</h3>
        <div className="flex gap-4 text-sm">
          <div className="flex gap-4 text-sm items-end">
            <div className="flex flex-col">
              <label className="text-gray-400 text-xs">Rotation Source</label>
              <select
                value={rotSource}
                onChange={e => setRotSource(e.target.value)}
                className="bg-gray-800 text-white rounded p-1 w-32"
              >
                {availableSources.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div className="flex gap-1 items-center">
              <div className="flex flex-col w-12">
                <label className="text-gray-500 text-[10px]">In Min</label>
                <input type="number" step="0.1" value={isNaN(rotRange[0]) ? '' : rotRange[0]} onChange={e => setRotRange([parseFloat(e.target.value), rotRange[1]])} className="bg-gray-800 text-white rounded p-1 text-xs" />
              </div>
              <div className="flex flex-col w-12">
                <label className="text-gray-500 text-[10px]">In Max</label>
                <input type="number" step="0.1" value={isNaN(rotRange[1]) ? '' : rotRange[1]} onChange={e => setRotRange([rotRange[0], parseFloat(e.target.value)])} className="bg-gray-800 text-white rounded p-1 text-xs" />
              </div>
              {/* Gain */}
              <div className="flex flex-col w-12">
                <label className="text-gray-500 text-[10px]">Gain</label>
                <input type="number" step="0.1" value={isNaN(rotGain) ? '' : rotGain} onChange={e => setRotGain(parseFloat(e.target.value))} className="bg-gray-800 text-white rounded p-1 text-xs" />
              </div>
            </div>

            <div className="w-px bg-gray-700 h-8 mx-2"></div>

            <div className="flex flex-col">
              <label className="text-gray-400 text-xs">Zoom Source</label>
              <select
                value={zoomSource}
                onChange={e => setZoomSource(e.target.value)}
                className="bg-gray-800 text-white rounded p-1 w-32"
              >
                {availableSources.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div className="flex gap-1 items-center">
              <div className="flex flex-col w-12">
                <label className="text-gray-500 text-[10px]">In Min</label>
                <input type="number" step="0.1" value={isNaN(zoomRange[0]) ? '' : zoomRange[0]} onChange={e => setZoomRange([parseFloat(e.target.value), zoomRange[1]])} className="bg-gray-800 text-white rounded p-1 text-xs" />
              </div>
              <div className="flex flex-col w-12">
                <label className="text-gray-500 text-[10px]">In Max</label>
                <input type="number" step="0.1" value={isNaN(zoomRange[1]) ? '' : zoomRange[1]} onChange={e => setZoomRange([zoomRange[0], parseFloat(e.target.value)])} className="bg-gray-800 text-white rounded p-1 text-xs" />
              </div>
              {/* Gain */}
              <div className="flex flex-col w-12">
                <label className="text-gray-500 text-[10px]">Gain</label>
                <input type="number" step="0.1" value={isNaN(zoomGain) ? '' : zoomGain} onChange={e => setZoomGain(parseFloat(e.target.value))} className="bg-gray-800 text-white rounded p-1 text-xs" />
              </div>
            </div>

            <div className="w-px bg-gray-700 h-8 mx-2"></div>

            <div className="flex flex-col w-32">
              <label className="text-gray-400 text-xs">Sigmoid (K={sigmoidK})</label>
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

      <div className="relative aspect-video bg-black rounded overflow-hidden border border-gray-800">
        <canvas ref={canvasRef} className="absolute inset-0 h-full w-full object-contain" />

        {/* Debug Overlay */}
        {isReady && debugValues && (
          <div className="absolute top-2 left-2 bg-black/50 text-green-400 font-mono text-xs p-2 rounded pointer-events-none">
            <div>ROT: {debugValues.rot.toFixed(3)}</div>
            <div>ZOOM: {debugValues.zoom.toFixed(3)}</div>
            <div>TIME: {debugValues.time.toFixed(3)}</div>
            <div>Knee: {debugValues.input.toFixed(3)}</div>
            <div>SigDur: {debugValues.sigDur.toFixed(3)}</div>
            <div>FPS: {((1000 / 16)).toFixed(0)}</div>
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
