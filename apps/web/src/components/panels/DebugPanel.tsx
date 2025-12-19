"use client";

import { X } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { Button } from "@/components/ui/button";
import { useConfigStore, useMirStore, useTabResult, useDisplayedHeatmap } from "@/lib/stores";

/**
 * Debug panel component that displays debug options and timing information.
 * Renders as a floating window with a transparent background.
 */
export function DebugPanel() {
  // Config store
  const {
    debug,
    useWorker,
    enableGpu,
    isDebugOpen,
    setDebug,
    setUseWorker,
    setEnableGpu,
    setIsDebugOpen,
  } = useConfigStore(
    useShallow((s) => ({
      debug: s.debug,
      useWorker: s.useWorker,
      enableGpu: s.enableGpu,
      isDebugOpen: s.isDebugOpen,
      setDebug: s.setDebug,
      setUseWorker: s.setUseWorker,
      setEnableGpu: s.setEnableGpu,
      setIsDebugOpen: s.setIsDebugOpen,
    }))
  );

  // MIR store
  const lastTimings = useMirStore((s) => s.lastTimings);

  // Derived state
  const tabResult = useTabResult();
  const displayedHeatmap = useDisplayedHeatmap();

  if (!isDebugOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-end p-4 pointer-events-none">
      <div className="pointer-events-auto mt-16 mr-4 w-96 max-h-[80vh] overflow-auto rounded-lg border border-zinc-200 bg-white/90 p-4 shadow-lg backdrop-blur-sm dark:border-zinc-700 dark:bg-zinc-900/90">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">Debug</h2>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0"
            onClick={() => setIsDebugOpen(false)}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="grid grid-cols-1 gap-2 text-sm">
          <label className="inline-flex items-center gap-2">
            <input
              type="checkbox"
              checked={debug}
              onChange={(e) => setDebug(e.target.checked)}
            />
            <span className="text-zinc-700 dark:text-zinc-200">Verbose worker logs</span>
          </label>
          <label className="inline-flex items-center gap-2">
            <input
              type="checkbox"
              checked={useWorker}
              onChange={(e) => setUseWorker(e.target.checked)}
            />
            <span className="text-zinc-700 dark:text-zinc-200">Use Web Worker (non-blocking)</span>
          </label>
          <label className="inline-flex items-center gap-2">
            <input
              type="checkbox"
              checked={enableGpu}
              onChange={(e) => setEnableGpu(e.target.checked)}
            />
            <span className="text-zinc-700 dark:text-zinc-200">Enable WebGPU stage (mel projection + onset envelope)</span>
          </label>

          <div className="mt-2 text-xs text-zinc-600 dark:text-zinc-300">
            <div>
              worker: <code>{String(useWorker)}</code>
            </div>
            <div>
              gpu enabled: <code>{String(enableGpu)}</code>
            </div>
            <div>
              timings:{" "}
              {lastTimings ? (
                <pre className="mt-1 whitespace-pre-wrap rounded bg-white/50 p-2 dark:bg-black/50">
                  {JSON.stringify(lastTimings, null, 2)}
                </pre>
              ) : (
                <span className="text-zinc-500">(no run yet)</span>
              )}
            </div>

            {tabResult?.kind === "2d" && (
              <div className="mt-2 text-xs text-zinc-600 dark:text-zinc-300">
                raw shape: <code>{tabResult.raw.data.length}</code> frames ×{" "}
                <code>{tabResult.raw.data[0]?.length ?? 0}</code> features
                {displayedHeatmap ? (
                  <>
                    <br />
                    display shape: <code>{displayedHeatmap.data.length}</code> frames ×{" "}
                    <code>{displayedHeatmap.data[0]?.length ?? 0}</code> features
                  </>
                ) : null}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
