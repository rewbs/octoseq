"use client";

import { useShallow } from "zustand/react/shallow";
import { useConfigStore, useMirStore, useTabResult, useDisplayedHeatmap } from "@/lib/stores";

/**
 * Debug panel component that displays debug options and timing information.
 * Uses stores directly instead of receiving props.
 */
export function DebugPanel() {
  // Config store
  const { debug, useWorker, enableGpu, setDebug, setUseWorker, setEnableGpu } = useConfigStore(
    useShallow((s) => ({
      debug: s.debug,
      useWorker: s.useWorker,
      enableGpu: s.enableGpu,
      setDebug: s.setDebug,
      setUseWorker: s.setUseWorker,
      setEnableGpu: s.setEnableGpu,
    }))
  );

  // MIR store
  const lastTimings = useMirStore((s) => s.lastTimings);

  // Derived state
  const tabResult = useTabResult();
  const displayedHeatmap = useDisplayedHeatmap();

  return (
    <section className="mt-10">
      <div className="mt-4 space-y-3">
        <details className="rounded-md border border-zinc-200 bg-zinc-50 p-3 text-sm dark:border-zinc-800 dark:bg-zinc-950">
          <summary className="cursor-pointer select-none text-zinc-700 dark:text-zinc-200">
            Debug
          </summary>
          <div className="mt-3 grid grid-cols-1 gap-2">
            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={debug}
                onChange={(e) => setDebug(e.target.checked)}
              />
              <span>Verbose worker logs</span>
            </label>
            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={useWorker}
                onChange={(e) => setUseWorker(e.target.checked)}
              />
              <span>Use Web Worker (non-blocking)</span>
            </label>
            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={enableGpu}
                onChange={(e) => setEnableGpu(e.target.checked)}
              />
              <span>Enable WebGPU stage (mel projection + onset envelope)</span>
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
                  <pre className="mt-1 whitespace-pre-wrap rounded bg-white p-2 dark:bg-black">
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
        </details>
      </div>
    </section>
  );
}
