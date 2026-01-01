"use client";

import { memo, useEffect, useRef, useState, useCallback, useMemo } from "react";
import type { AudioBufferLike, MusicalTimeStructure } from "@octoseq/mir";
import { computeBeatPosition } from "@octoseq/mir";
import { GripHorizontal, GripVertical, Rows3, Columns3, FlaskConical, Loader2 } from "lucide-react";
import Editor, { type Monaco } from "@monaco-editor/react";
import { useHotkeysContext } from "react-hotkeys-hook";
import { useDebugSignalStore, type RawAnalysisResult, type DebugSignal } from "@/lib/stores";
import { HOTKEY_SCOPE_APP } from "@/lib/hotkeys";
import { useBandMirStore } from "@/lib/stores/bandMirStore";
import { useFrequencyBandStore } from "@/lib/stores/frequencyBandStore";
import { useMirStore } from "@/lib/stores/mirStore";
import { useAudioInputStore } from "@/lib/stores/audioInputStore";
import { useAuthoredEventStore } from "@/lib/stores/authoredEventStore";
import { useProjectStore } from "@/lib/stores/projectStore";
import { useMeshAssets } from "@/lib/stores/meshAssetStore";
import type { BandMirFunctionId } from "@octoseq/mir";

// We import the mock type if the real package isn't built yet, preventing TS errors.
// In a real build, this would import from @octoseq/visualiser.
// The dynamic import below handles the actual loading.
import type { WasmVisualiser } from "@octoseq/visualiser";
import {
  registerRhaiLanguage,
  RHAI_LANGUAGE_ID,
  type ScriptApiMetadata,
  type ScriptDiagnostic,
  parseScriptApiMetadata,
  parseScriptDiagnosticsJson,
  validateConfigMaps,
  type ConfigMapDiagnostic,
} from "@/lib/scripting";
import { SignalExplorerPanel } from "@/components/signalExplorer";
import { useSignalExplorerStore } from "@/lib/stores/signalExplorerStore";
import {
  detectSignalAtCursor,
  cursorChangedSignal,
  updateScriptSignals,
  requestSignalAnalysis,
  refreshCurrentSignal,
} from "@/lib/signalExplorer";

type MonacoDisposable = { dispose: () => void };

type MonacoEditorLike = {
  getModel?: () => unknown;
  onDidFocusEditorText: (callback: () => void) => MonacoDisposable;
  onDidBlurEditorText: (callback: () => void) => MonacoDisposable;
  onDidChangeCursorPosition?: (callback: (e: { position: { lineNumber: number; column: number } }) => void) => MonacoDisposable;
  hasTextFocus?: () => boolean;
};

interface VisualiserPanelProps {
  audio: AudioBufferLike | null;
  playbackTime: number;
  audioDuration?: number; // Optional explicitly passed duration
  mirResults: Record<string, number[]> | null; // Keys are feature names
  searchSignal?: Float32Array | null; // Search similarity curve
  className?: string;
  isPlaying?: boolean;
  /** Musical time structure for beat signals (B4). */
  musicalTimeStructure?: MusicalTimeStructure | null;
}

const MIN_HEIGHT = 100;
const MAX_HEIGHT = 2000;
const DEFAULT_HEIGHT = 400;
const FOOTER_RESERVE = 80; // Space reserved for footer + margins

// Script editor sizing
const SCRIPT_MIN_HEIGHT = 60;
const SCRIPT_DEFAULT_HEIGHT = 200;
const SCRIPT_SYNC_DEBOUNCE_MS = 400;

// Preview FPS settings
const MIN_TARGET_FPS = 1;
const MAX_TARGET_FPS = 120;
const DEFAULT_TARGET_FPS = 30;
const FPS_SETTINGS_KEY = "octoseq:visualiser-fps:v1";

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

export const VisualiserPanel = memo(function VisualiserPanel({ audio, playbackTime, audioDuration, mirResults, searchSignal, className, isPlaying = true, musicalTimeStructure }: VisualiserPanelProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const visRef = useRef<WasmVisualiser | null>(null);
  const rafRef = useRef<number>(0);
  const lastTimeRef = useRef<number>(0);
  const isPlayingRef = useRef(isPlaying);
  const containerRef = useRef<HTMLDivElement>(null);

  // Dirty flag for conditional rendering when paused
  // When not playing, we only re-render when something changes (script, seek, signals, resize)
  const needsRenderRef = useRef(true);

  // Request a single render frame (used when paused to trigger re-render on changes)
  const requestRender = useCallback(() => {
    needsRenderRef.current = true;
  }, []);

  // Resizable height state
  const [panelHeight, setPanelHeight] = useState(DEFAULT_HEIGHT);
  const isResizingRef = useRef(false);
  const startYRef = useRef(0);
  const startHeightRef = useRef(0);
  const userHasResizedRef = useRef(false);

  // Target FPS for preview (affects signal sampling)
  const [targetFps, setTargetFps] = useState(DEFAULT_TARGET_FPS);
  const targetFpsRef = useRef(targetFps);

  // Config-map validation diagnostics (stored for reuse in render loop)
  const configMapDiagsRef = useRef<ConfigMapDiagnostic[]>([]);

  // Keep ref in sync with state and update Signal Explorer store
  useEffect(() => {
    targetFpsRef.current = targetFps;
    useSignalExplorerStore.getState().setTargetFps(targetFps);
  }, [targetFps]);

  // Load FPS setting from localStorage
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const stored = window.localStorage.getItem(FPS_SETTINGS_KEY);
      if (stored !== null) {
        const parsed = parseFloat(stored);
        if (!isNaN(parsed) && parsed >= MIN_TARGET_FPS && parsed <= MAX_TARGET_FPS) {
          setTargetFps(parsed);
        }
      }
    } catch {
      // Ignore localStorage errors
    }
  }, []);

  // Save FPS setting to localStorage
  const handleFpsChange = useCallback((fps: number) => {
    const clamped = Math.max(MIN_TARGET_FPS, Math.min(MAX_TARGET_FPS, fps));
    setTargetFps(clamped);
    try {
      window.localStorage.setItem(FPS_SETTINGS_KEY, String(clamped));
    } catch {
      // Ignore localStorage errors
    }
  }, []);

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

  // Keep ref up to date for loop access and trigger render on state change
  useEffect(() => {
    isPlayingRef.current = isPlaying;
    // Request render when playback state changes (e.g., to render initial paused frame)
    requestRender();
  }, [isPlaying, requestRender]);

  const [isReady, setIsReady] = useState(false);
  const [webGpuError, setWebGpuError] = useState<string | null>(null);
  const timeRef = useRef(playbackTime);
  const [scriptError, setScriptError] = useState<string | null>(null);
  const [scriptDiagnostics, setScriptDiagnostics] = useState<ScriptDiagnostic[]>([]);
  const monacoDisposablesRef = useRef<Array<{ dispose: () => void }>>([]);
  const hotkeysScopeDisposablesRef = useRef<Array<{ dispose: () => void }>>([]);
  const scriptApiRef = useRef<ScriptApiMetadata | null>(null);
  const editorRef = useRef<MonacoEditorLike | null>(null);
  const monacoRef = useRef<Monaco | null>(null);
  const availableBandsRef = useRef<Array<{ id: string; label: string }>>([]);
  const { disableScope, enableScope } = useHotkeysContext();

  // Handler for Monaco editor initialization
  const handleEditorBeforeMount = useCallback(
    (monaco: Monaco) => {
      // Clean up any previous registrations
      monacoDisposablesRef.current.forEach((d) => d.dispose());

      // Register Rhai language using the TypeScript API registry.
      // The registry is self-contained - no need for WASM metadata.
      monacoDisposablesRef.current = registerRhaiLanguage(monaco, {
        getAvailableBands: () => availableBandsRef.current,
      });
    },
    []
  );

  const handleEditorMount = useCallback((editor: MonacoEditorLike, monaco: Monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;

    // Disable global app hotkeys while the script editor has focus so typing
    // isn't hijacked by single-letter shortcuts.
    hotkeysScopeDisposablesRef.current.forEach((d) => d.dispose());
    hotkeysScopeDisposablesRef.current = [
      editor.onDidFocusEditorText(() => disableScope(HOTKEY_SCOPE_APP)),
      editor.onDidBlurEditorText(() => enableScope(HOTKEY_SCOPE_APP)),
    ];

    // Add cursor position listener for Signal Explorer
    if (editor.onDidChangeCursorPosition) {
      const cursorDisposable = editor.onDidChangeCursorPosition((e) => {
        const model = editor.getModel?.() as Parameters<typeof monaco.editor.setModelMarkers>[0] | null;
        if (!model) return;

        const scriptSignals = useSignalExplorerStore.getState().scriptSignals;
        const prevCursor = useSignalExplorerStore.getState().currentCursor;
        const cursor = detectSignalAtCursor(model, e.position, scriptSignals);

        useSignalExplorerStore.getState().setCursor(cursor);

        // Only trigger analysis if cursor moved to a different signal
        if (cursor.signalName && cursorChangedSignal(prevCursor, cursor) && visRef.current) {
          requestSignalAnalysis(
            visRef.current as Parameters<typeof requestSignalAnalysis>[0],
            cursor.signalName,
            timeRef.current
          );
        }
      });
      monacoDisposablesRef.current.push(cursorDisposable);
    }

    if (editor.hasTextFocus?.()) {
      disableScope(HOTKEY_SCOPE_APP);
    }
  }, [disableScope, enableScope]);

  const applyDiagnosticsToEditor = useCallback((diags: ScriptDiagnostic[], configMapDiags: ConfigMapDiagnostic[] = []) => {
    const monaco = monacoRef.current;
    const editor = editorRef.current;
    if (!monaco || !editor) return;
    const model = editor.getModel?.();
    if (!model) return;

    // Runtime diagnostics (errors and warnings from Rust)
    const runtimeMarkers = diags
      .filter((d) => d.location && typeof d.location.line === "number" && typeof d.location.column === "number")
      .map((d) => ({
        severity: d.kind === "warning" ? monaco.MarkerSeverity.Warning : monaco.MarkerSeverity.Error,
        message: `[${d.phase}] ${d.message}`,
        startLineNumber: d.location!.line,
        startColumn: d.location!.column,
        endLineNumber: d.location!.line,
        endColumn: d.location!.column + 1,
      }));

    // Config-map validation warnings
    const configMapMarkers = configMapDiags.map((d) => ({
      severity: d.severity === "warning" ? monaco.MarkerSeverity.Warning : monaco.MarkerSeverity.Info,
      message: d.message,
      startLineNumber: d.startLineNumber,
      startColumn: d.startColumn,
      endLineNumber: d.endLineNumber,
      endColumn: d.endColumn,
    }));

    // Merge both sets of markers
    const allMarkers = [...runtimeMarkers, ...configMapMarkers];
    monaco.editor.setModelMarkers(model as Parameters<typeof monaco.editor.setModelMarkers>[0], "octoseq-rhai", allMarkers);
  }, []);

  // Cleanup Monaco disposables on unmount
  useEffect(() => {
    return () => {
      monacoDisposablesRef.current.forEach((d) => d.dispose());
      hotkeysScopeDisposablesRef.current.forEach((d) => d.dispose());
      enableScope(HOTKEY_SCOPE_APP);
    };
  }, [enableScope]);

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
      const maxScriptHeight = panelHeight - MIN_HEIGHT;
      const newHeight = Math.min(maxScriptHeight, Math.max(SCRIPT_MIN_HEIGHT, scriptStartHeightRef.current + delta));
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
  }, [panelHeight]);

  // Default demo script - uses scene graph API
  // Uses signals that are always available: time, dt, amplitude, flux
  const defaultScript = `let cube = mesh.cube();

let smoothAmp = inputs.amplitude.abs().smooth.moving_average(0.5).scale(20);
let smoothOnsets = inputs.onsetEnvelope.smooth.exponential(0.1, 0.5).scale(10);

cube.rotation.x = smoothAmp;
cube.scale = smoothOnsets;
cube.rotation.y = sin(inputs.time);
camera.lookAt(#{x:gen.perlin(4, 40), y:gen.perlin(2, 41), z:gen.perlin(8, 42)});


let bloom = fx.bloom(#{
  intensity: smoothOnsets.sigmoid(10).scale(10).add(1.0) ,
  threshold: 0.7});

let fb = feedback.builder()
    .warp.spiral(sin(inputs.beatPosition), 1, 0.1)
    .opacity(0.4)
    .blend.difference()
    .build();

fn init(ctx) {
    scene.add(cube);
    post.add(bloom);
    feedback.enable(fb);
}

fn update(dt, frame) {
}`;
  const [script, setScript] = useState(defaultScript);
  const [isScriptLoaded, setIsScriptLoaded] = useState(false);

  // Subscribe to active script from Project store
  const activeScript = useProjectStore((s) => {
    const proj = s.activeProject;
    if (!proj?.scripts.activeScriptId) return null;
    return proj.scripts.scripts.find((sc) => sc.id === proj.scripts.activeScriptId) ?? null;
  });
  const activeScriptId = activeScript?.id ?? null;
  const syncScriptContent = useProjectStore((s) => s.syncScriptContent);

  // Track which script ID is currently loaded in the editor
  const loadedScriptIdRef = useRef<string | null>(null);

  // Load script from Project when active script changes
  useEffect(() => {
    if (activeScript && activeScript.id !== loadedScriptIdRef.current) {
      setScript(activeScript.content);
      loadedScriptIdRef.current = activeScript.id;
    }
    // Mark as loaded once we've checked for an active script
    setIsScriptLoaded(true);
  }, [activeScript]);

  // Debounced sync back to Project (replaces localStorage autosave)
  useEffect(() => {
    if (!activeScriptId || !isScriptLoaded) return;
    // Skip if content matches what we just loaded (prevents feedback loop)
    if (loadedScriptIdRef.current === activeScriptId && activeScript?.content === script) return;

    const handle = window.setTimeout(() => {
      syncScriptContent(activeScriptId, script);
    }, SCRIPT_SYNC_DEBOUNCE_MS);

    return () => window.clearTimeout(handle);
  }, [script, activeScriptId, isScriptLoaded, syncScriptContent, activeScript?.content]);

  // Track previous playback time for seek detection
  const prevPlaybackTimeRef = useRef(playbackTime);

  // Update timeRef for the loop and detect seeks for Signal Explorer
  useEffect(() => {
    const prevTime = prevPlaybackTimeRef.current;
    const timeDelta = Math.abs(playbackTime - prevTime);
    prevPlaybackTimeRef.current = playbackTime;
    timeRef.current = playbackTime;

    if (visRef.current) {
      visRef.current.set_time(playbackTime);
    }

    // Request render when playback time changes (handles seeking while paused)
    requestRender();

    // Detect seek (time jump > 0.3s) and refresh Signal Explorer
    const SEEK_THRESHOLD = 0.3;
    if (timeDelta > SEEK_THRESHOLD) {
      const { lastValidSignalName, isExpanded } = useSignalExplorerStore.getState();
      if (lastValidSignalName && isExpanded && visRef.current) {
        requestSignalAnalysis(
          visRef.current as Parameters<typeof requestSignalAnalysis>[0],
          lastValidSignalName,
          playbackTime
        );
      }
    }
  }, [playbackTime, requestRender]);

  // Update Signal Explorer playback state and refresh during playback
  useEffect(() => {
    useSignalExplorerStore.getState().setPlaybackActive(isPlaying);
  }, [isPlaying]);

  // Periodically refresh Signal Explorer during playback (~2Hz)
  useEffect(() => {
    if (!isPlaying || !visRef.current) return;

    const PLAYBACK_UPDATE_INTERVAL_MS = 500; // 2Hz
    const intervalId = setInterval(() => {
      const { lastValidSignalName, isExpanded } = useSignalExplorerStore.getState();
      // Only update if panel is expanded and we have a signal selected
      if (lastValidSignalName && isExpanded && visRef.current) {
        requestSignalAnalysis(
          visRef.current as Parameters<typeof requestSignalAnalysis>[0],
          lastValidSignalName,
          timeRef.current
        );
      }
    }, PLAYBACK_UPDATE_INTERVAL_MS);

    return () => clearInterval(intervalId);
  }, [isPlaying]);

  // Re-analyze when windowBeats changes (zoom in/out)
  useEffect(() => {
    let prevWindowBeats = useSignalExplorerStore.getState().windowBeats;
    const unsubscribe = useSignalExplorerStore.subscribe((state) => {
      if (state.windowBeats !== prevWindowBeats && visRef.current) {
        prevWindowBeats = state.windowBeats;
        const { lastValidSignalName, isExpanded } = state;
        if (lastValidSignalName && isExpanded) {
          requestSignalAnalysis(
            visRef.current as Parameters<typeof requestSignalAnalysis>[0],
            lastValidSignalName,
            timeRef.current
          );
        }
      }
    });
    return () => unsubscribe();
  }, []);

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

        // Load host-defined Script API metadata for editor UX (autocomplete/hover/docs)
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const anyPkg = pkg as any;
          if (typeof anyPkg.get_script_api_metadata_json === "function") {
            const json = anyPkg.get_script_api_metadata_json();
            scriptApiRef.current = parseScriptApiMetadata(json);
          }
        } catch (e) {
          console.warn("Failed to load script API metadata:", e);
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

    // Push amplitude signal from raw audio
    if (audio && typeof vis.push_signal === "function") {
      let audioData: Float32Array | null = null;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const audioBuffer = audio as any;
      // Standard AudioBuffer
      if (typeof audioBuffer.getChannelData === "function") {
        audioData = audioBuffer.getChannelData(0);
      }
      // MirAudioPayload
      else if (audioBuffer.mono) {
        audioData = audioBuffer.mono;
      }

      if (audioData && audioData.length > 0) {
        // Normalize waveform from [-1, 1] to [0, 1]
        const norm = normalizeSignal(audioData, [-1, 1]);
        const rate = duration > 0 ? norm.length / duration : 0;
        vis.push_signal("amplitude", norm, rate);
      }
    }

    // Push available MIR signals
    if (mirResults && typeof vis.push_signal === "function") {
      // Map signal names from metadata to MIR result keys
      // Note: "flux" is an alias for "spectralFlux", "energy" is an alias for "onsetEnvelope"
      // CQT signal aliases: "harmonic", "bassMotion", "tonal"
      const signalMappings: Record<string, string> = {
        spectralCentroid: "spectralCentroid",
        spectralFlux: "spectralFlux",
        flux: "spectralFlux",
        onsetEnvelope: "onsetEnvelope",
        energy: "onsetEnvelope",
        cqtHarmonicEnergy: "cqtHarmonicEnergy",
        harmonic: "cqtHarmonicEnergy",
        cqtBassPitchMotion: "cqtBassPitchMotion",
        bassMotion: "cqtBassPitchMotion",
        cqtTonalStability: "cqtTonalStability",
        tonal: "cqtTonalStability",
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

    // Push MIR event streams (e.g., beatCandidates) from the MIR store
    if (typeof vis.push_event_stream === "function") {
      const mirStoreResults = useMirStore.getState().mirResults;

      // Push beatCandidates as an event stream
      const beatCandidatesResult = mirStoreResults.beatCandidates;
      if (beatCandidatesResult && beatCandidatesResult.kind === "events") {
        const events = beatCandidatesResult.events.map((e) => ({
          time: e.time,
          weight: e.strength,
          beat_position: null,
          beat_phase: null,
          cluster_id: null,
        }));
        vis.push_event_stream("beatCandidates", JSON.stringify(events));
      }

      // Push onsetPeaks as an event stream
      const onsetPeaksResult = mirStoreResults.onsetPeaks;
      if (onsetPeaksResult && onsetPeaksResult.kind === "events") {
        const events = onsetPeaksResult.events.map((e) => ({
          time: e.time,
          weight: e.strength,
          beat_position: null,
          beat_phase: null,
          cluster_id: null,
        }));
        vis.push_event_stream("onsetPeaks", JSON.stringify(events));
      }
    }

    // Push authored event streams (human-curated events)
    if (typeof vis.push_authored_event_stream === "function") {
      // First clear any existing authored streams
      if (typeof vis.clear_authored_event_streams === "function") {
        vis.clear_authored_event_streams();
      }

      // Get all authored streams and push them
      const authoredStreams = useAuthoredEventStore.getState().getAllStreams();
      for (const stream of authoredStreams) {
        const events = stream.events.map((e) => ({
          time: e.time,
          weight: e.weight,
          beat_position: e.beatPosition,
          beat_phase: null,
          cluster_id: null,
        }));
        vis.push_authored_event_stream(stream.name, JSON.stringify(events));
      }
    }

    // Set the musical time structure on the WASM side for beat-aware Signal operations
    if (typeof vis.set_musical_time === "function") {
      if (musicalTimeStructure && musicalTimeStructure.segments.length > 0) {
        vis.set_musical_time(JSON.stringify(musicalTimeStructure));
      } else {
        vis.clear_musical_time();
      }
    }

    // Push musical time signals (B4)
    if (musicalTimeStructure && musicalTimeStructure.segments.length > 0 && typeof vis.push_signal === "function") {
      // Pre-compute beat signals as dense arrays
      // Use 100 samples per second for smooth interpolation
      const sampleRate = 100;
      const numSamples = Math.ceil(duration * sampleRate);

      const beatPositionArray = new Float32Array(numSamples);
      const beatIndexArray = new Float32Array(numSamples);
      const beatPhaseArray = new Float32Array(numSamples);
      const bpmArray = new Float32Array(numSamples);

      // Track last known values for "freeze" behavior outside segments
      let lastBeatPosition = 0;
      let lastBeatIndex = 0;
      let lastBeatPhase = 0;
      let lastBpm = 120; // Default BPM

      for (let i = 0; i < numSamples; i++) {
        const time = i / sampleRate;
        const beatPos = computeBeatPosition(time, musicalTimeStructure.segments);

        if (beatPos) {
          // Update last known values
          lastBeatPosition = beatPos.beatPosition;
          lastBeatIndex = beatPos.beatIndex;
          lastBeatPhase = beatPos.beatPhase;
          lastBpm = beatPos.bpm;
        }

        // Use current or last known values (freeze behavior)
        beatPositionArray[i] = lastBeatPosition;
        beatIndexArray[i] = lastBeatIndex;
        beatPhaseArray[i] = lastBeatPhase;
        bpmArray[i] = lastBpm;
      }

      // Push the pre-computed arrays
      vis.push_signal("beatPosition", beatPositionArray, sampleRate);
      vis.push_signal("beatIndex", beatIndexArray, sampleRate);
      vis.push_signal("beatPhase", beatPhaseArray, sampleRate);
      vis.push_signal("bpm", bpmArray, sampleRate);
    }

    // Request render when signals change (even when paused)
    requestRender();
  }, [mirResults, isReady, audio, audioDuration, searchSignal, musicalTimeStructure, requestRender]);

  // Update Signal Explorer BPM from musical time structure
  useEffect(() => {
    if (musicalTimeStructure && musicalTimeStructure.segments.length > 0) {
      // Use the first segment's BPM (most common case)
      const firstSegment = musicalTimeStructure.segments[0];
      useSignalExplorerStore.getState().setBpm(firstSegment?.bpm ?? null);
    } else {
      useSignalExplorerStore.getState().setBpm(null);
    }
  }, [musicalTimeStructure]);

  // Get band MIR results and frequency bands for the band signals effect
  const bandMirResults = useBandMirStore((state) => state.cache);
  const getAllBandMirResults = useBandMirStore((state) => state.getAllResults);
  const bandEventCache = useBandMirStore((state) => state.eventCache);
  const getAllEventResults = useBandMirStore((state) => state.getAllEventResults);
  const frequencyBands = useFrequencyBandStore((state) => state.structure?.bands);
  const getBandById = useFrequencyBandStore((state) => state.getBandById);
  const meshAssets = useMeshAssets();

  // Keep available bands for editor completions in a ref (avoids stale closures)
  useEffect(() => {
    const bands = frequencyBands ?? [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    availableBandsRef.current = bands.map((b: any) => ({ id: b.id, label: b.label }));
  }, [frequencyBands]);

  // Push band MIR signals to WASM (F4)
  useEffect(() => {
    if (!visRef.current || !isReady) return;
    // Use type assertion for new WASM methods not yet in generated types
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const vis = visRef.current as any;
    const duration = audioDuration ?? 0;

    // Get all band MIR results
    const allResults = getAllBandMirResults();
    if (allResults.length === 0) return;

    // Clear previous band signals only if we have new ones to push
    if (typeof vis.clear_band_signals === "function") {
      vis.clear_band_signals();
    }

    // Map function IDs to script feature names
    const featureMap: Record<BandMirFunctionId, string> = {
      bandAmplitudeEnvelope: "energy",
      bandOnsetStrength: "onset",
      bandSpectralFlux: "flux",
      bandSpectralCentroid: "centroid",
    };

    // Push each band signal
    for (const result of allResults) {
      const band = getBandById(result.bandId);
      if (!band) continue;

      const feature = featureMap[result.fn];
      if (!feature) continue;

      if (typeof vis.push_band_signal === "function" && result.values.length > 0) {
        // Normalize to 0-1
        const norm = normalizeSignal(result.values);
        const rate = duration > 0 ? result.times.length / duration : 0;
        vis.push_band_signal(result.bandId, band.label, feature, norm, rate);
      }
    }

    // Push band events for script access
    if (typeof vis.clear_band_events === "function") {
      vis.clear_band_events();
    }

    const allEventResults = getAllEventResults();
    for (const eventData of allEventResults) {
      if (typeof vis.push_band_events === "function" && eventData.events.length > 0) {
        // Convert to JSON format expected by WASM
        const eventsJson = JSON.stringify(eventData.events);
        vis.push_band_events(eventData.bandId, eventsJson);
      }
    }

    // Request render when band signals change (even when paused)
    requestRender();
  }, [bandMirResults, bandEventCache, frequencyBands, isReady, audioDuration, getAllBandMirResults, getAllEventResults, getBandById, requestRender]);

  // Get stem information for the stem signals effect
  // Note: We select the raw collection and stemOrder to avoid creating new arrays on every render
  const audioInputCollection = useAudioInputStore((state) => state.collection);
  const inputMirCache = useMirStore((state) => state.inputMirCache);

  // Compute stems from collection (memoized to avoid infinite loops)
  const stems = useMemo(() => {
    if (!audioInputCollection) return [];
    return audioInputCollection.stemOrder
      .map((id) => audioInputCollection.inputs[id])
      .filter((input): input is NonNullable<typeof input> => input !== undefined);
  }, [audioInputCollection]);

  // Push stem MIR signals to WASM (S2 integration)
  useEffect(() => {
    if (!visRef.current || !isReady) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const vis = visRef.current as any;
    const duration = audioDuration ?? 0;

    // Set available stems for script namespace generation
    if (typeof vis.set_available_stems === "function") {
      const stemList = stems.map((s: { id: string; label: string }) => [s.id, s.label]);
      vis.set_available_stems(JSON.stringify(stemList));
    }

    // Clear previous stem signals
    if (typeof vis.clear_stem_signals === "function") {
      vis.clear_stem_signals();
    }

    // Skip if no stems
    if (stems.length === 0) return;

    // Map MIR function IDs to stem signal feature names
    const featureMap: Record<string, string> = {
      spectralCentroid: "centroid",
      spectralFlux: "flux",
      onsetEnvelope: "energy",
      onsetPeaks: "onset",
    };

    // Push signals for each stem
    for (const stem of stems) {
      // Get all MIR results for this stem from the cache
      const prefix = `${stem.id}:`;
      for (const [cacheKey, result] of inputMirCache) {
        if (!cacheKey.startsWith(prefix)) continue;
        const fnId = cacheKey.slice(prefix.length);
        const feature = featureMap[fnId];
        if (!feature) continue;

        if (result.kind === "1d" && typeof vis.push_stem_signal === "function") {
          // Normalize to 0-1
          const norm = normalizeSignal(result.values);
          const rate = duration > 0 ? result.times.length / duration : 0;
          vis.push_stem_signal(stem.id, stem.label, feature, norm, rate);
        }
      }
    }

    // Request render when stem signals change (even when paused)
    requestRender();
  }, [stems, inputMirCache, isReady, audioDuration, requestRender]);

  // Track registered mesh asset IDs to detect changes
  const registeredMeshAssetsRef = useRef<Set<string>>(new Set());

  // Sync mesh assets to WASM visualiser
  useEffect(() => {
    if (!visRef.current || !isReady) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const vis = visRef.current as any;

    if (typeof vis.register_mesh_asset !== "function") return;

    const currentAssetIds = new Set(meshAssets.map((a) => a.id));
    const previousAssetIds = registeredMeshAssetsRef.current;

    // Register new assets
    for (const asset of meshAssets) {
      if (!previousAssetIds.has(asset.id)) {
        const success = vis.register_mesh_asset(asset.name, asset.objContent);
        if (success) {
          console.log(`Registered mesh asset: ${asset.name}`);
        } else {
          console.warn(`Failed to register mesh asset: ${asset.name}`);
        }
      }
    }

    // Unregister removed assets
    if (typeof vis.unregister_mesh_asset === "function") {
      for (const prevId of previousAssetIds) {
        if (!currentAssetIds.has(prevId)) {
          // Find the asset name that was removed (we stored by name)
          // Note: We need to track names too, but for now just clear all
          // This is a simplification - in practice we'd need a name->id map
        }
      }
    }

    // Update the ref with current asset IDs
    registeredMeshAssetsRef.current = currentAssetIds;

    // Request render to reflect any new assets
    requestRender();
  }, [meshAssets, isReady, requestRender]);

  // Load script when enabled or script changes
  useEffect(() => {
    if (!visRef.current || !isReady) return;
    const vis = visRef.current;

    if (script.trim()) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const visAny = vis as any;
      const success = vis.load_script(script);
      const diagJson =
        typeof visAny.take_script_diagnostics_json === "function"
          ? visAny.take_script_diagnostics_json()
          : "[]";
      const diags = parseScriptDiagnosticsJson(diagJson);

      // Compute config-map validation diagnostics (static analysis)
      const configMapDiags = validateConfigMaps(script);
      configMapDiagsRef.current = configMapDiags;

      setScriptDiagnostics(diags);
      applyDiagnosticsToEditor(diags, configMapDiags);

      if (success) {
        setScriptError(diags[0]?.message ?? null);

        // Update Signal Explorer with script signals and refresh current analysis
        updateScriptSignals(visAny);
        refreshCurrentSignal(visAny, timeRef.current);

        // Request render to show script changes immediately (even when paused)
        requestRender();
      } else {
        const err = diags[0]?.message ?? vis.get_script_error() ?? "Unknown script error";
        setScriptError(err);
      }
    }
  }, [script, isReady, applyDiagnosticsToEditor, bandMirResults, frequencyBands, requestRender]);

  // Render Loop
  useEffect(() => {
    if (!isReady || !visRef.current) return;

    let lastLog = performance.now();
    let lastRenderTime = performance.now();
    lastTimeRef.current = performance.now();
    const vis = visRef.current;

    // Track dropped frames for user feedback
    let droppedFrameCount = 0;
    let totalDroppedFrames = 0;
    let lastDroppedFrameWarning = 0;

    // Frame budget in milliseconds (50ms = minimum ~20fps before dropping)
    const FRAME_BUDGET_MS = 50;

    // Rolling average for frame time (exponential moving average)
    let avgFrameTimeMs = 0;
    const EMA_ALPHA = 0.1; // Smoothing factor (lower = smoother, higher = more responsive)

    const loop = (now: number) => {
      if (now - lastLog > 1000) {
        lastLog = now;
      }

      // Get current target FPS and calculate frame interval
      const currentTargetFps = targetFpsRef.current;
      const targetFrameIntervalMs = 1000 / currentTargetFps;
      const timeSinceLastRender = now - lastRenderTime;

      // Skip this frame if not enough time has passed (throttle to target FPS)
      if (timeSinceLastRender < targetFrameIntervalMs * 0.95) {
        rafRef.current = requestAnimationFrame(loop);
        return;
      }

      // When paused, only render if explicitly requested (dirty flag set)
      // This saves CPU/GPU when nothing has changed
      const isCurrentlyPlaying = isPlayingRef.current;
      if (!isCurrentlyPlaying && !needsRenderRef.current) {
        // Not playing and no render requested - skip this frame but keep loop alive
        rafRef.current = requestAnimationFrame(loop);
        return;
      }

      // Clear dirty flag (we're about to render)
      needsRenderRef.current = false;

      // Use fixed dt based on target FPS for consistent signal sampling
      // This ensures peak-preserving sampling windows are predictable
      const dt = isCurrentlyPlaying ? (1 / currentTargetFps) : 0;
      lastRenderTime = now;
      lastTimeRef.current = now;

      // Measure frame processing time
      const frameStart = performance.now();

      // Use budget-limited render if available, otherwise fall back to regular render
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const visAny = vis as any;
      let frameCompleted = true;
      if (typeof visAny.render_with_budget === "function") {
        frameCompleted = visAny.render_with_budget(dt, FRAME_BUDGET_MS);
      } else {
        vis.render(dt);
      }

      const frameEnd = performance.now();
      const frameTimeMs = frameEnd - frameStart;

      // Update rolling average (only for completed frames to avoid skewed stats)
      if (frameCompleted) {
        avgFrameTimeMs = avgFrameTimeMs === 0
          ? frameTimeMs
          : avgFrameTimeMs * (1 - EMA_ALPHA) + frameTimeMs * EMA_ALPHA;
      }

      // Track dropped frames
      if (!frameCompleted) {
        droppedFrameCount++;
        totalDroppedFrames++;
        // Log warning every 5 seconds if frames are being dropped
        if (now - lastDroppedFrameWarning > 5000) {
          console.warn(
            `Dropped ${droppedFrameCount} frames in the last 5 seconds due to script complexity. ` +
            `Consider simplifying your script.`
          );
          droppedFrameCount = 0;
          lastDroppedFrameWarning = now;
        }
      }

      // Poll script diagnostics (runtime errors during update/render)
      if (typeof visAny.take_script_diagnostics_json === "function") {
        const diagJson = visAny.take_script_diagnostics_json();
        const diags = parseScriptDiagnosticsJson(diagJson);
        if (diags.length > 0) {
          setScriptDiagnostics(diags);
          // Preserve config-map warnings alongside runtime errors
          applyDiagnosticsToEditor(diags, configMapDiagsRef.current);
          setScriptError(diags[0]?.message ?? null);
        }
      }
      rafRef.current = requestAnimationFrame(loop);

      // Poll debug values
      if (vis.get_current_vals) {
        const vals = vis.get_current_vals();
        if (vals && vals.length >= 4) {
          setDebugValues({
            time: vals[0] || 0,
            entityCount: vals[1] || 0,
            meshCount: vals[2] || 0,
            lineCount: vals[3] || 0,
            frameTimeMs: avgFrameTimeMs,
            budgetUsedPercent: (avgFrameTimeMs / FRAME_BUDGET_MS) * 100,
            droppedFrames: totalDroppedFrames
          });
        }
      }
      // if (typeof visAny.get_entity_positions_json === "function") {
      //   const posJson = visAny.get_entity_positions_json();
      //   console.log("Entity positions:", posJson);
      // }
    };
    rafRef.current = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(rafRef.current);
    };
  }, [applyDiagnosticsToEditor, isReady]);

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
        // Request render when canvas resizes (even when paused)
        needsRenderRef.current = true;
      }
    });

    if (canvasRef.current) {
      observer.observe(canvasRef.current);
    }
    return () => observer.disconnect();
  }, [isReady]);

  const [debugValues, setDebugValues] = useState<{
    time: number, entityCount: number, meshCount: number, lineCount: number,
    frameTimeMs: number, budgetUsedPercent: number, droppedFrames: number
  } | null>(null);

  // Debug signal analysis
  const {
    isRunning: isAnalysisRunning,
    lastError: analysisError,
    setDebugSignals,
    setIsRunning: setAnalysisRunning,
    setLastError: setAnalysisError,
    setLastRunDuration,
    setLastStepCount,
  } = useDebugSignalStore();

  const handleRunAnalysis = useCallback(async () => {
    if (isAnalysisRunning) return;
    const vis = visRef.current;
    if (!vis || !script.trim()) {
      setAnalysisError("No visualizer or script available");
      return;
    }

    // Get duration from audio or use default
    let duration = 10.0;
    if (audioDuration && audioDuration > 0) {
      duration = audioDuration;
    }

    setAnalysisRunning(true);
    setAnalysisError(null);

    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => {
        setTimeout(resolve, 0);
      });
    });

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const visAny = vis as any;
      if (typeof visAny.run_analysis !== "function") {
        throw new Error("Analysis not available - please rebuild WASM");
      }

      const resultJson = visAny.run_analysis(script, duration, 0.01); // 10ms steps
      const result: RawAnalysisResult = JSON.parse(resultJson);

      if (result.success) {
        // Convert arrays to Float32Array
        const signals: DebugSignal[] = result.signals.map((s) => ({
          name: s.name,
          times: new Float32Array(s.times),
          values: new Float32Array(s.values),
        }));

        setDebugSignals(signals);
        setLastRunDuration(result.duration);
        setLastStepCount(result.step_count);
        console.log(`Analysis complete: ${signals.length} signals, ${result.step_count} steps`);
      } else {
        setAnalysisError(result.error ?? "Unknown analysis error");
      }
    } catch (e) {
      setAnalysisError(e instanceof Error ? e.message : String(e));
    } finally {
      setAnalysisRunning(false);
    }
  }, [isAnalysisRunning, script, audioDuration, setDebugSignals, setAnalysisRunning, setAnalysisError, setLastRunDuration, setLastStepCount]);

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
        {/* Extract debug signals button */}
        <button
          onClick={handleRunAnalysis}
          disabled={isAnalysisRunning || !script.trim() || !isReady}
          className="p-0.5 rounded hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          title="Extract debug signals from script (runs analysis mode)"
        >
          {isAnalysisRunning ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <FlaskConical className="w-4 h-4" />
          )}
        </button>
        {/* FPS control */}
        <div className="flex items-center gap-1">
          <span className="text-zinc-500 dark:text-zinc-400">FPS:</span>
          <input
            type="number"
            value={targetFps}
            onChange={(e) => {
              const val = parseFloat(e.target.value);
              if (!isNaN(val)) handleFpsChange(val);
            }}
            min={MIN_TARGET_FPS}
            max={MAX_TARGET_FPS}
            step="any"
            className="w-12 px-1 py-0.5 text-xs bg-zinc-100 dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-600 rounded focus:outline-none focus:ring-1 focus:ring-emerald-500"
            title={`Target preview FPS (${MIN_TARGET_FPS}-${MAX_TARGET_FPS})`}
          />
        </div>
        {isAnalysisRunning && (
          <div
            className="flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-600 dark:text-emerald-300"
            role="status"
            aria-live="polite"
          >
            <Loader2 className="h-3 w-3 animate-spin" />
            <span>Extracting debug signals</span>
            <span className="h-1 w-14 overflow-hidden rounded-full bg-emerald-500/20">
              <span className="block h-full w-full animate-pulse bg-linear-to-r from-transparent via-emerald-400/80 to-transparent" />
            </span>
          </div>
        )}
        {analysisError && (
          <span className="text-red-500 text-xs" title={analysisError}>Analysis error</span>
        )}
        {scriptError && (
          <span className="text-red-500 text-xs" title={scriptError}>⚠️ Script error</span>
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
              <div className="flex-1 min-h-0">
                <Editor
                  height="100%"
                  defaultLanguage={RHAI_LANGUAGE_ID}
                  theme="vs-dark"
                  value={script}
                  onChange={(value) => setScript(value ?? "")}
                  beforeMount={handleEditorBeforeMount}
                  onMount={handleEditorMount}
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
              {scriptDiagnostics.length > 0 && (
                <div className="border-t border-zinc-800 bg-zinc-950/40 p-2 text-[11px] text-red-200 overflow-auto max-h-40">
                  <div className="font-semibold mb-1">Script errors</div>
                  <div className="font-mono whitespace-pre-wrap">
                    {scriptDiagnostics.map((d, i) => (
                      <div key={i}>
                        {(d.location && typeof d.location.line === "number" && typeof d.location.column === "number")
                          ? `L${d.location.line}:C${d.location.column} `
                          : ""}
                        [{d.phase}] {d.message}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Signal Explorer Panel */}
              <div className="border-t border-zinc-800">
                <SignalExplorerPanel className="rounded-none border-0" />
              </div>
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
            <div style={{ height: scriptHeight }} className="flex flex-col">
              <div className="flex-1 min-h-0">
                <Editor
                  height="100%"
                  defaultLanguage={RHAI_LANGUAGE_ID}
                  theme="vs-dark"
                  value={script}
                  onChange={(value) => setScript(value ?? "")}
                  beforeMount={handleEditorBeforeMount}
                  onMount={handleEditorMount}
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
              {scriptDiagnostics.length > 0 && (
                <div className="border-t border-zinc-800 bg-zinc-950/40 p-2 text-[11px] text-red-200 overflow-auto max-h-40">
                  <div className="font-semibold mb-1">Script errors</div>
                  <div className="font-mono whitespace-pre-wrap">
                    {scriptDiagnostics.map((d, i) => (
                      <div key={i}>
                        {(d.location && typeof d.location.line === "number" && typeof d.location.column === "number")
                          ? `L${d.location.line}:C${d.location.column} `
                          : ""}
                        [{d.phase}] {d.message}
                      </div>
                    ))}
                  </div>
                </div>
              )}
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

        {/* Signal Explorer Panel - vertical mode (between script and canvas) */}
        {layoutMode === 'vertical' && (
          <div className="mb-1 rounded-md border border-zinc-200 dark:border-zinc-800 overflow-hidden">
            <SignalExplorerPanel className="rounded-none border-0" />
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
              <div className="mt-1 pt-1 border-t border-zinc-600">
                <div className={
                  debugValues.budgetUsedPercent > 100 ? 'text-red-400' :
                    debugValues.budgetUsedPercent > 60 ? 'text-yellow-400' :
                      'text-emerald-400'
                }>
                  Frame: {debugValues.frameTimeMs.toFixed(1)}ms ({debugValues.budgetUsedPercent.toFixed(0)}%)
                </div>
                {debugValues.droppedFrames > 0 && (
                  <div className="text-red-400">Dropped: {debugValues.droppedFrames}</div>
                )}
              </div>
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
