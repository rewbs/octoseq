"use client";

import { memo, useEffect, useRef, useState, useMemo, useCallback } from "react";
import type { AudioBufferLike } from "@octoseq/mir";
import { GripHorizontal, GripVertical, Rows3, Columns3 } from "lucide-react";
import Editor, { type Monaco } from "@monaco-editor/react";

// We import the mock type if the real package isn't built yet, preventing TS errors.
// In a real build, this would import from @octoseq/visualiser.
// The dynamic import below handles the actual loading.
import type { WasmVisualiser } from "@octoseq/visualiser";
import {
  registerRhaiLanguage,
  RHAI_LANGUAGE_ID,
  ALL_SIGNALS,
  type SignalMetadata,
} from "@/lib/scripting";

interface VisualiserPanelProps {
  audio: AudioBufferLike | null;
  playbackTime: number;
  audioDuration?: number; // Optional explicitly passed duration
  mirResults: Record<string, number[]> | null; // Keys are feature names
  searchSignal?: Float32Array | null; // Search similarity curve
  className?: string;
  isPlaying?: boolean;
}

const MIN_HEIGHT = 100;
const MAX_HEIGHT = 800;
const DEFAULT_HEIGHT = 400;
const FOOTER_RESERVE = 80; // Space reserved for footer + margins

// Script editor sizing
const SCRIPT_MIN_HEIGHT = 60;
const SCRIPT_MAX_HEIGHT = 400;
const SCRIPT_DEFAULT_HEIGHT = 96; // h-24 equivalent

// Horizontal layout sizing (percentage-based)
const SCRIPT_MIN_WIDTH_PERCENT = 15;
const SCRIPT_MAX_WIDTH_PERCENT = 70;
const SCRIPT_DEFAULT_WIDTH_PERCENT = 30;

// Helper to normalize array to [0, 1]
function normalizeSignal(data: number[] | Float32Array, customRange?: [number, number]): Float32Array {
  let min = Infinity;
  let max = -Infinity;

  if (customRange) {
    min = customRange[0];
    max = customRange[1];
  } else {
    for (let i = 0; i < data.length; i++) {
      const v = data[i] as number;
      if (v < min) min = v;
      if (v > max) max = v;
    }
  }

  const range = max - min;
  const out = new Float32Array(data.length);
  if (range === 0) return out; // All zeros

  for (let i = 0; i < data.length; i++) {
    out[i] = ((data[i] as number) - min) / range;
  }
  return out;
}

export const VisualiserPanel = memo(function VisualiserPanel({ audio, playbackTime, audioDuration, mirResults, searchSignal, className, isPlaying = true }: VisualiserPanelProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const visRef = useRef<WasmVisualiser | null>(null);
  const rafRef = useRef<number>(0);
  const lastTimeRef = useRef<number>(0);
  const isPlayingRef = useRef(isPlaying);
  const containerRef = useRef<HTMLDivElement>(null);

  // Resizable height state
  const [panelHeight, setPanelHeight] = useState(DEFAULT_HEIGHT);
  const isResizingRef = useRef(false);
  const startYRef = useRef(0);
  const startHeightRef = useRef(0);
  const userHasResizedRef = useRef(false);

  // Auto-fit height calculation based on window size
  useEffect(() => {
    const calculateAutoFitHeight = () => {
      if (!containerRef.current || userHasResizedRef.current) return;

      const rect = containerRef.current.getBoundingClientRect();
      const availableHeight = window.innerHeight - rect.top - FOOTER_RESERVE;
      const clampedHeight = Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, availableHeight));
      setPanelHeight(clampedHeight);
    };

    // Calculate after DOM is settled
    const rafId = requestAnimationFrame(calculateAutoFitHeight);
    window.addEventListener('resize', calculateAutoFitHeight);

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener('resize', calculateAutoFitHeight);
    };
  }, []);

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isResizingRef.current = true;
    userHasResizedRef.current = true; // User has manually resized, disable auto-fit
    startYRef.current = e.clientY;
    startHeightRef.current = panelHeight;
    document.body.style.cursor = 'ns-resize';
    document.body.style.userSelect = 'none';
  }, [panelHeight]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizingRef.current) return;
      const delta = e.clientY - startYRef.current;
      const newHeight = Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, startHeightRef.current + delta));
      setPanelHeight(newHeight);
    };

    const handleMouseUp = () => {
      if (isResizingRef.current) {
        isResizingRef.current = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      }
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  // Keep ref up to date for loop access
  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  const [isReady, setIsReady] = useState(false);
  const [webGpuError, setWebGpuError] = useState<string | null>(null);
  const timeRef = useRef(playbackTime);
  const [scriptError, setScriptError] = useState<string | null>(null);
  const monacoDisposablesRef = useRef<Array<{ dispose: () => void }>>([]);

  // Compute available signals based on current data
  const availableSignals = useMemo((): SignalMetadata[] => {
    const signals: SignalMetadata[] = [];

    // Always include timing signals
    signals.push(...ALL_SIGNALS.filter((s) => s.category === "timing"));

    // Include audio signals if we have audio
    if (audio) {
      signals.push(...ALL_SIGNALS.filter((s) => s.category === "audio"));
    }

    // Include MIR signals that are actually computed
    if (mirResults) {
      const availableMirKeys = Object.keys(mirResults);
      const mirSignals = ALL_SIGNALS.filter(
        (s) =>
          (s.category === "spectral" || s.category === "onset") &&
          availableMirKeys.includes(s.name)
      );
      signals.push(...mirSignals);
    }

    // Include search signals if we have search results
    if (searchSignal && searchSignal.length > 0) {
      signals.push(...ALL_SIGNALS.filter((s) => s.category === "search"));
    }

    return signals;
  }, [audio, mirResults, searchSignal]);

  // Handler for Monaco editor initialization
  const handleEditorBeforeMount = useCallback(
    (monaco: Monaco) => {
      // Clean up any previous registrations
      monacoDisposablesRef.current.forEach((d) => d.dispose());

      // Register Rhai language with dynamic signal list
      monacoDisposablesRef.current = registerRhaiLanguage(monaco, () => availableSignals);
    },
    [availableSignals]
  );

  // Cleanup Monaco disposables on unmount
  useEffect(() => {
    return () => {
      monacoDisposablesRef.current.forEach((d) => d.dispose());
    };
  }, []);

  // Script editor resizable height state
  const [scriptHeight, setScriptHeight] = useState(SCRIPT_DEFAULT_HEIGHT);
  const isScriptResizingRef = useRef(false);
  const scriptStartYRef = useRef(0);
  const scriptStartHeightRef = useRef(0);

  // Layout mode: 'vertical' (stacked) or 'horizontal' (side-by-side)
  const [layoutMode, setLayoutMode] = useState<'vertical' | 'horizontal'>('horizontal');

  // Horizontal layout split (percentage for script width)
  const [scriptWidthPercent, setScriptWidthPercent] = useState(SCRIPT_DEFAULT_WIDTH_PERCENT);
  const isHorizontalResizingRef = useRef(false);
  const horizontalStartXRef = useRef(0);
  const horizontalStartWidthRef = useRef(0);
  const horizontalContainerRef = useRef<HTMLDivElement>(null);

  const handleHorizontalResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isHorizontalResizingRef.current = true;
    horizontalStartXRef.current = e.clientX;
    horizontalStartWidthRef.current = scriptWidthPercent;
    document.body.style.cursor = 'ew-resize';
    document.body.style.userSelect = 'none';
  }, [scriptWidthPercent]);

  useEffect(() => {
    const handleHorizontalMouseMove = (e: MouseEvent) => {
      if (!isHorizontalResizingRef.current || !horizontalContainerRef.current) return;
      const containerWidth = horizontalContainerRef.current.offsetWidth;
      const deltaX = e.clientX - horizontalStartXRef.current;
      const deltaPercent = (deltaX / containerWidth) * 100;
      const newPercent = Math.min(
        SCRIPT_MAX_WIDTH_PERCENT,
        Math.max(SCRIPT_MIN_WIDTH_PERCENT, horizontalStartWidthRef.current + deltaPercent)
      );
      setScriptWidthPercent(newPercent);
    };

    const handleHorizontalMouseUp = () => {
      if (isHorizontalResizingRef.current) {
        isHorizontalResizingRef.current = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      }
    };

    document.addEventListener('mousemove', handleHorizontalMouseMove);
    document.addEventListener('mouseup', handleHorizontalMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleHorizontalMouseMove);
      document.removeEventListener('mouseup', handleHorizontalMouseUp);
    };
  }, []);

  const handleScriptResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isScriptResizingRef.current = true;
    scriptStartYRef.current = e.clientY;
    scriptStartHeightRef.current = scriptHeight;
    document.body.style.cursor = 'ns-resize';
    document.body.style.userSelect = 'none';
  }, [scriptHeight]);

  useEffect(() => {
    const handleScriptMouseMove = (e: MouseEvent) => {
      if (!isScriptResizingRef.current) return;
      const delta = e.clientY - scriptStartYRef.current;
      const newHeight = Math.min(SCRIPT_MAX_HEIGHT, Math.max(SCRIPT_MIN_HEIGHT, scriptStartHeightRef.current + delta));
      setScriptHeight(newHeight);
    };

    const handleScriptMouseUp = () => {
      if (isScriptResizingRef.current) {
        isScriptResizingRef.current = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      }
    };

    document.addEventListener('mousemove', handleScriptMouseMove);
    document.addEventListener('mouseup', handleScriptMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleScriptMouseMove);
      document.removeEventListener('mouseup', handleScriptMouseUp);
    };
  }, []);

  // Default demo script - uses scene graph API
  // Uses signals that are always available: time, dt, amplitude, flux
  const defaultScript = `// Rhai script: Cube reacts to audio
// Available signals: time, dt, amplitude, flux
// Also: spectralCentroid, spectralFlux, onsetEnvelope (if MIR computed)

let cube;
let phase = 0.0;

fn init(ctx) {
    cube = mesh.cube();
    scene.add(cube);
}

fn update(dt, inputs) {
    // Use flux (from zoom source) or fall back to constant rotation
    let flux_val = if inputs.contains("flux") { inputs.flux } else { 0.0 };
    phase += dt * (0.5 + flux_val * 2.0);

    cube.rotation.y = phase;
    cube.rotation.x = 0.1 * (inputs.time * 2.0).sin();

    // Scale based on amplitude (from rotation source)
    let amp = if inputs.contains("amplitude") { inputs.amplitude } else { 0.0 };
    cube.scale = 1.0 + amp * 0.5;
}`;
  const [script, setScript] = useState(defaultScript);

  // Update timeRef for the loop
  useEffect(() => {
    timeRef.current = playbackTime;
    if (visRef.current) {
      visRef.current.set_time(playbackTime);
    }
  }, [playbackTime]);

  useEffect(() => {
    let active = true;

    async function init() {
      try {
        // Check for WebGPU support first
        if (!navigator.gpu) {
          setWebGpuError(
            "WebGPU is not supported in this browser. Please use a WebGPU-enabled browser such as Chrome 113+, Edge 113+, or Firefox Nightly with WebGPU enabled."
          );
          return;
        }

        // Try to get an adapter to confirm WebGPU is actually working
        const adapter = await navigator.gpu.requestAdapter();
        if (!adapter) {
          setWebGpuError(
            "WebGPU is supported but no compatible GPU adapter was found. Please ensure your GPU drivers are up to date."
          );
          return;
        }

        const pkg = await import("@octoseq/visualiser");
        if (!active) return;

        // Initialize WASM module using default export
        if (typeof pkg.default === "function") {
          await pkg.default();
        }

        if (canvasRef.current) {
          // Initialize visualiser
          const vis = await pkg.create_visualiser(canvasRef.current);
          visRef.current = vis;
          console.log("Visualiser initialized", vis);
          console.log("WASM methods:", Object.keys(Object.getPrototypeOf(vis)));
          setIsReady(true);

          // Initial sync
          vis.set_time(timeRef.current);
        }
      } catch (e) {
        console.error("Failed to load visualiser WASM:", e);
        setWebGpuError(
          `Failed to initialize WebGPU visualiser: ${e instanceof Error ? e.message : String(e)}`
        );
      }
    }

    init();

    return () => {
      active = false;
    };
  }, []);

  // Cleanup loop
  useEffect(() => {
    return () => {
      cancelAnimationFrame(rafRef.current);
    };
  }, []);

  // Push all available 1D signals to WASM for scripting access
  useEffect(() => {
    if (!visRef.current || !isReady) return;
    // Cast to allow new methods (types will be updated after WASM rebuild)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const vis = visRef.current as any;

    // Calculate audio duration
    let duration = 1;
    if (audioDuration && audioDuration > 0) {
      duration = audioDuration;
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const a = audio as any;
      if (a) {
        const len = a.length || (a.mono ? a.mono.length : 0);
        const sr = a.sampleRate || 0;
        if (len > 0 && sr > 0) duration = len / sr;
      }
    }

    // Clear previous signals (method may not exist yet until WASM is rebuilt)
    if (typeof vis.clear_signals === "function") {
      vis.clear_signals();
    }

    // Push available MIR signals
    if (mirResults && typeof vis.push_signal === "function") {
      // Map signal names from metadata to MIR result keys
      const signalMappings: Record<string, string> = {
        spectralCentroid: "spectralCentroid",
        spectralFlux: "spectralFlux",
        onsetEnvelope: "onsetEnvelope",
      };

      for (const [signalName, mirKey] of Object.entries(signalMappings)) {
        const mirResult = mirResults[mirKey];
        if (mirResult) {
          // Get raw data from MIR result
          let data: Float32Array | null = null;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const val = mirResult as any;
          if (val.values) {
            data = new Float32Array(val.values);
          } else if (val.length !== undefined) {
            data = new Float32Array(val);
          }

          if (data && data.length > 0) {
            // Normalize to 0-1
            const norm = normalizeSignal(data);
            const rate = duration > 0 ? norm.length / duration : 0;
            vis.push_signal(signalName, norm, rate);
          }
        }
      }
    }

    // Push search similarity signal
    if (searchSignal && searchSignal.length > 0 && typeof vis.push_signal === "function") {
      const norm = normalizeSignal(searchSignal);
      const rate = duration > 0 ? norm.length / duration : 0;
      vis.push_signal("searchSimilarity", norm, rate);
    }
  }, [mirResults, isReady, audio, audioDuration, searchSignal]);


  // Load script when enabled or script changes
  useEffect(() => {
    if (!visRef.current || !isReady) return;
    const vis = visRef.current;

    if (script.trim()) {
      const success = vis.load_script(script);
      if (success) {
        setScriptError(null);
        console.log("Script loaded successfully");
      } else {
        const err = vis.get_script_error() ?? "Unknown script error";
        setScriptError(err);
        console.error("Script error:", err);
      }
    }
  }, [script, isReady]);

  // Render Loop
  useEffect(() => {
    if (!isReady || !visRef.current) return;

    let lastLog = performance.now();
    lastTimeRef.current = performance.now();
    const vis = visRef.current;

    const loop = (now: number) => {
      if (now - lastLog > 1000) {
        lastLog = now;
      }

      const dt = isPlayingRef.current ? (now - lastTimeRef.current) / 1000 : 0;
      lastTimeRef.current = now;

      vis.render(dt);
      rafRef.current = requestAnimationFrame(loop);

      // Poll debug values
      if (vis.get_current_vals) {
        const vals = vis.get_current_vals();
        if (vals && vals.length >= 4) {
          setDebugValues({
            time: vals[0] || 0,
            entityCount: vals[1] || 0,
            meshCount: vals[2] || 0,
            lineCount: vals[3] || 0
          });
        }
      }
    };
    rafRef.current = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(rafRef.current);
    };
  }, [isReady]);

  // Resize observer
  useEffect(() => {
    if (!canvasRef.current || !visRef.current) return;
    const vis = visRef.current;

    const observer = new ResizeObserver(entries => {
      for (const entry of entries) {
        const width = entry.contentRect.width;
        const height = entry.contentRect.height;
        const dpr = window.devicePixelRatio || 1;
        if (canvasRef.current) {
          canvasRef.current.width = width * dpr;
          canvasRef.current.height = height * dpr;
        }
        vis.resize(width * dpr, height * dpr);
      }
    });

    if (canvasRef.current) {
      observer.observe(canvasRef.current);
    }
    return () => observer.disconnect();
  }, [isReady]);

  const [debugValues, setDebugValues] = useState<{
    time: number, entityCount: number, meshCount: number, lineCount: number
  } | null>(null);

  // const availableSources = useMemo(() => {
  //   const keys = mirResults ? Object.keys(mirResults) : [];
  //   const sources = ["Amplitude", ...keys];
  //   if (searchSignal && searchSignal.length > 0) {
  //     sources.push("Search Similarity");
  //   }
  //   return sources;
  // }, [mirResults, searchSignal]);

  return (
    <div className={`mt-1.5 rounded-md border border-zinc-200 p-1 dark:border-zinc-800 ${className}`}>
      {/* Compact inline controls */}
      <div className="flex flex-wrap items-center gap-2 mb-1 text-xs text-zinc-600 dark:text-zinc-300">

        {(
          <button
            onClick={() => setLayoutMode(m => m === 'vertical' ? 'horizontal' : 'vertical')}
            className="p-0.5 rounded hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
            title={layoutMode === 'vertical' ? 'Switch to side-by-side layout' : 'Switch to stacked layout'}
          >
            {layoutMode === 'vertical' ? (
              <Columns3 className="w-4 h-4" />
            ) : (
              <Rows3 className="w-4 h-4" />
            )}
          </button>
        )}
        {scriptError && (
          <span className="text-red-500 text-xs" title={scriptError}>⚠️ Error</span>
        )}
      </div>

      {/* Main content area - uses flex for horizontal, block for vertical */}
      <div
        ref={horizontalContainerRef}
        className={layoutMode === 'horizontal' ? 'flex gap-0' : 'block'}
        style={{ height: layoutMode === 'horizontal' ? panelHeight : undefined }}
      >
        {/* Script Editor - horizontal mode (side panel) */}
        {layoutMode === 'horizontal' && (
          <>
            <div
              className="shrink-0 rounded-l-md border border-r-0 border-zinc-200 dark:border-zinc-800 overflow-hidden flex flex-col"
              style={{ width: `${scriptWidthPercent}%` }}
            >
              <Editor
                height="100%"
                defaultLanguage={RHAI_LANGUAGE_ID}
                theme="vs-dark"
                value={script}
                onChange={(value) => setScript(value ?? "")}
                beforeMount={handleEditorBeforeMount}
                options={{
                  minimap: { enabled: false },
                  fontSize: 12,
                  lineNumbers: "on",
                  scrollBeyondLastLine: false,
                  wordWrap: "on",
                  automaticLayout: true,
                  tabSize: 2,
                }}
              />
            </div>

            {/* Horizontal Resize Handle */}
            <div
              onMouseDown={handleHorizontalResizeStart}
              className="flex items-center justify-center w-2 cursor-ew-resize bg-zinc-200 dark:bg-zinc-800 hover:bg-zinc-300 dark:hover:bg-zinc-700 transition-colors group"
            >
              <GripVertical className="w-2 h-5 text-zinc-500 group-hover:text-zinc-700 dark:text-zinc-600 dark:group-hover:text-zinc-400" />
            </div>
          </>
        )}

        {/* Script Editor - vertical mode (stacked above) */}
        {layoutMode === 'vertical' && (
          <div className="mb-1 rounded-md border border-zinc-200 dark:border-zinc-800 overflow-hidden">
            <div style={{ height: scriptHeight }}>
              <Editor
                height="100%"
                defaultLanguage={RHAI_LANGUAGE_ID}
                theme="vs-dark"
                value={script}
                onChange={(value) => setScript(value ?? "")}
                beforeMount={handleEditorBeforeMount}
                options={{
                  minimap: { enabled: false },
                  fontSize: 12,
                  lineNumbers: "on",
                  scrollBeyondLastLine: false,
                  wordWrap: "on",
                  automaticLayout: true,
                  tabSize: 2,
                }}
              />
            </div>
            {/* Script Resize Handle */}
            <div
              onMouseDown={handleScriptResizeStart}
              className="flex items-center justify-center h-2 cursor-ns-resize dark:bg-zinc-900 hover:bg-zinc-700/50 transition-colors group"
            >
              <GripHorizontal className="w-5 h-2 text-zinc-600 group-hover:text-zinc-400" />
            </div>
          </div>
        )}

        {/* Canvas Container - always in the same position in the React tree */}
        <div
          ref={containerRef}
          className={`relative bg-black overflow-hidden border border-zinc-700 ${layoutMode === 'horizontal'
            ? 'flex-1 rounded-r-md border-l-0'
            : 'rounded-md'
            }`}
          style={layoutMode === 'horizontal' ? undefined : { height: panelHeight }}
        >
          <canvas ref={canvasRef} className="absolute inset-0 h-full w-full object-contain" />

          {/* Debug Overlay */}
          {isReady && debugValues && (
            <div className="absolute top-1 left-1 bg-black/60 text-emerald-400 font-mono text-tiny p-1.5 rounded-md pointer-events-none">
              <div>TIME: {debugValues.time.toFixed(3)}</div>
              <div>Entities: {debugValues.entityCount.toFixed(0)}</div>
              <div>Meshes: {debugValues.meshCount.toFixed(0)}</div>
              <div>Lines: {debugValues.lineCount.toFixed(0)}</div>
            </div>
          )}

          {!isReady && !webGpuError && (
            <div className="absolute inset-0 flex items-center justify-center text-xs text-zinc-500">
              Initializing WebGPU...
            </div>
          )}

          {webGpuError && (
            <div className="absolute inset-0 flex items-center justify-center p-6">
              <div className="max-w-md text-center">
                <div className="text-red-500 text-lg font-semibold mb-2">WebGPU Required</div>
                <div className="text-sm text-zinc-400">{webGpuError}</div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Resize Handle */}
      <div
        onMouseDown={handleResizeStart}
        className="flex items-center justify-center h-2 cursor-ns-resize hover:bg-zinc-200/50 dark:hover:bg-zinc-700/50 transition-colors group"
      >
        <GripHorizontal className="w-5 h-2 text-zinc-400 group-hover:text-zinc-600 dark:text-zinc-600 dark:group-hover:text-zinc-400" />
      </div>
    </div>
  );
});
