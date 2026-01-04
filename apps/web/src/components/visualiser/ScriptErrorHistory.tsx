"use client";

import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { History, X, Trash2, ChevronDown, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useScriptErrorStore, type HistoricalScriptError } from "@/lib/stores/scriptErrorStore";
import type { ScriptDiagnostic } from "@/lib/scripting/scriptDiagnostics";

function formatTimestamp(ts: number): string {
  const date = new Date(ts);
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function formatDiagnosticLocation(d: ScriptDiagnostic): string {
  if (d.location && typeof d.location.line === "number" && typeof d.location.column === "number") {
    return `L${d.location.line}:C${d.location.column}`;
  }
  return "";
}

interface ErrorEntryProps {
  entry: HistoricalScriptError;
  isExpanded: boolean;
  onToggle: () => void;
}

function ErrorEntry({ entry, isExpanded, onToggle }: ErrorEntryProps) {
  const firstError = entry.diagnostics[0];
  const errorCount = entry.diagnostics.length;

  return (
    <div className="border-b border-zinc-800 last:border-b-0">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-start gap-2 p-2 text-left hover:bg-zinc-800/50 transition-colors"
      >
        <span className="mt-0.5 text-zinc-500">
          {isExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 text-[10px] text-zinc-500 mb-0.5">
            <span>{formatTimestamp(entry.timestamp)}</span>
            {errorCount > 1 && (
              <span className="px-1 py-0.5 bg-red-900/50 text-red-300 rounded text-[9px]">
                {errorCount} errors
              </span>
            )}
          </div>
          {firstError && (
            <div className="text-[11px] text-red-300 truncate">
              {formatDiagnosticLocation(firstError) && (
                <span className="text-zinc-500 mr-1">{formatDiagnosticLocation(firstError)}</span>
              )}
              <span className="text-zinc-400 mr-1">[{firstError.phase}]</span>
              {firstError.message}
            </div>
          )}
        </div>
      </button>

      {isExpanded && (
        <div className="pl-7 pr-2 pb-2 space-y-1">
          {entry.diagnostics.map((d, i) => (
            <div key={i} className="text-[11px] font-mono text-red-200 bg-zinc-900/50 p-1.5 rounded">
              <div className="flex items-center gap-2 mb-0.5">
                {formatDiagnosticLocation(d) && (
                  <span className="text-zinc-500">{formatDiagnosticLocation(d)}</span>
                )}
                <span className="text-zinc-400">[{d.phase}]</span>
                <span className="text-red-400/70 text-[10px]">{d.kind}</span>
              </div>
              <div className="whitespace-pre-wrap break-words">{d.message}</div>
              {d.raw && d.raw !== d.message && (
                <details className="mt-1">
                  <summary className="text-[10px] text-zinc-500 cursor-pointer hover:text-zinc-400">
                    Raw error
                  </summary>
                  <pre className="mt-1 text-[10px] text-zinc-400 whitespace-pre-wrap break-all">
                    {d.raw}
                  </pre>
                </details>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

interface ScriptErrorHistoryProps {
  className?: string;
}

export function ScriptErrorHistory({ className }: ScriptErrorHistoryProps) {
  const { currentDiagnostics, errorHistory, isHistoryOpen, setHistoryOpen, clearHistory } =
    useScriptErrorStore();
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [panelPosition, setPanelPosition] = useState({ top: 0, left: 0 });

  const hasErrors = currentDiagnostics.some((d) => d.kind !== "warning");
  const hasHistory = errorHistory.length > 0;

  // Update panel position when opened
  useEffect(() => {
    if (isHistoryOpen && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      setPanelPosition({
        top: rect.bottom + 4,
        left: Math.max(8, rect.left - 300 + rect.width), // Align right edge with button
      });
    }
  }, [isHistoryOpen]);

  // Close on click outside
  useEffect(() => {
    if (!isHistoryOpen) return;

    function handleClickOutside(e: MouseEvent) {
      if (
        panelRef.current &&
        !panelRef.current.contains(e.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(e.target as Node)
      ) {
        setHistoryOpen(false);
      }
    }

    function handleEscape(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setHistoryOpen(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [isHistoryOpen, setHistoryOpen]);

  const toggleEntry = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  if (!hasErrors && !hasHistory) {
    return null;
  }

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setHistoryOpen(!isHistoryOpen)}
        className={`inline-flex items-center gap-1 text-xs transition-colors ${
          hasErrors
            ? "text-red-500 hover:text-red-400"
            : "text-zinc-500 hover:text-zinc-400"
        } ${className ?? ""}`}
        title={`${hasErrors ? "Script error" : "View error history"} (${errorHistory.length} in history)`}
      >
        {hasErrors && <span>⚠️</span>}
        <History className="w-3 h-3" />
        {hasErrors && <span>Script error</span>}
        {errorHistory.length > 0 && (
          <span className="text-[10px] text-zinc-500">({errorHistory.length})</span>
        )}
      </button>

      {isHistoryOpen &&
        createPortal(
          <div
            ref={panelRef}
            className="fixed z-50 w-[400px] max-h-[60vh] flex flex-col rounded-lg border border-zinc-700 bg-zinc-900 shadow-xl"
            style={{ top: panelPosition.top, left: panelPosition.left }}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-800">
              <h3 className="text-sm font-medium text-zinc-200">Script Error History</h3>
              <div className="flex items-center gap-1">
                {errorHistory.length > 0 && (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => {
                      clearHistory();
                    }}
                    title="Clear history"
                    className="h-6 w-6 text-zinc-500 hover:text-zinc-300"
                  >
                    <Trash2 className="w-3 h-3" />
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => setHistoryOpen(false)}
                  className="h-6 w-6 text-zinc-500 hover:text-zinc-300"
                >
                  <X className="w-3 h-3" />
                </Button>
              </div>
            </div>

            {/* Current errors */}
            {currentDiagnostics.length > 0 && (
              <div className="border-b border-zinc-700 bg-zinc-950/50">
                <div className="px-3 py-1.5 text-[10px] font-medium text-zinc-400 uppercase tracking-wider">
                  Current
                </div>
                <div className="px-3 pb-2 space-y-1">
                  {currentDiagnostics.map((d, i) => (
                    <div
                      key={i}
                      className={`text-[11px] font-mono p-1.5 rounded ${
                        d.kind === "warning"
                          ? "text-yellow-200 bg-yellow-900/20"
                          : "text-red-200 bg-red-900/20"
                      }`}
                    >
                      {formatDiagnosticLocation(d) && (
                        <span className="text-zinc-500 mr-1">{formatDiagnosticLocation(d)}</span>
                      )}
                      <span className="text-zinc-400 mr-1">[{d.phase}]</span>
                      {d.message}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* History */}
            <div className="flex-1 overflow-y-auto">
              {errorHistory.length === 0 ? (
                <div className="px-3 py-8 text-center text-xs text-zinc-500">
                  No errors in history
                </div>
              ) : (
                <>
                  <div className="px-3 py-1.5 text-[10px] font-medium text-zinc-400 uppercase tracking-wider sticky top-0 bg-zinc-900">
                    History ({errorHistory.length})
                  </div>
                  {errorHistory.map((entry) => (
                    <ErrorEntry
                      key={entry.id}
                      entry={entry}
                      isExpanded={expandedIds.has(entry.id)}
                      onToggle={() => toggleEntry(entry.id)}
                    />
                  ))}
                </>
              )}
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
