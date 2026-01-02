"use client";

import { useAutosaveStore } from "@/lib/stores/autosaveStore";
import { formatAutosaveTimestamp } from "@/lib/persistence/autosave";

/**
 * Subtle status indicator for autosave state.
 * Shows a colored dot with tooltip indicating save status.
 */
export function AutosaveIndicator() {
  const status = useAutosaveStore((s) => s.status);
  const lastSavedAt = useAutosaveStore((s) => s.lastSavedAt);
  const error = useAutosaveStore((s) => s.error);

  // Determine dot color based on status
  const getDotColor = () => {
    switch (status) {
      case "saving":
        return "bg-blue-500 animate-pulse";
      case "saved":
        return "bg-emerald-500";
      case "error":
        return "bg-red-500";
      default:
        return "bg-zinc-400 dark:bg-zinc-600";
    }
  };

  // Get tooltip text
  const getTooltip = () => {
    switch (status) {
      case "saving":
        return "Saving...";
      case "saved":
        return lastSavedAt
          ? `Saved ${formatAutosaveTimestamp(lastSavedAt)}`
          : "Saved";
      case "error":
        return error ? `Save failed: ${error}` : "Save failed";
      default:
        return "Autosave enabled";
    }
  };

  return (
    <div className="relative group" title={getTooltip()}>
      {/* Status dot */}
      <div
        className={`
          w-2 h-2 rounded-full transition-colors duration-200
          ${getDotColor()}
        `}
      />

      {/* Tooltip (shown on hover) */}
      <div
        className="
          absolute left-1/2 -translate-x-1/2 top-full mt-1
          px-2 py-1 rounded text-xs
          bg-zinc-900 dark:bg-zinc-700 text-white
          whitespace-nowrap opacity-0 group-hover:opacity-100
          transition-opacity duration-150 pointer-events-none
          z-50
        "
      >
        {getTooltip()}
      </div>
    </div>
  );
}

/**
 * Compact autosave indicator for use in tight spaces.
 * Just the dot without tooltip container.
 */
export function AutosaveIndicatorDot() {
  const status = useAutosaveStore((s) => s.status);

  const getDotColor = () => {
    switch (status) {
      case "saving":
        return "bg-blue-500 animate-pulse";
      case "saved":
        return "bg-emerald-500";
      case "error":
        return "bg-red-500";
      default:
        return "bg-zinc-400 dark:bg-zinc-600";
    }
  };

  return (
    <div
      className={`
        w-1.5 h-1.5 rounded-full transition-colors duration-200
        ${getDotColor()}
      `}
    />
  );
}
