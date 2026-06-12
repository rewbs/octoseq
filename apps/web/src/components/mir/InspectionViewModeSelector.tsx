"use client";

import { useMemo } from "react";
import { Eye, Layers, GitCompare } from "lucide-react";
import { useInspectionStore } from "@/lib/stores/inspectionStore";
import { useStreamStore } from "@/lib/streams";
import { cn } from "@/lib/utils";
import type { InspectionViewMode } from "@/lib/stores/inspectionStore";

// ----------------------------
// Types
// ----------------------------

interface ViewModeOption {
  mode: InspectionViewMode;
  label: string;
  icon: React.ReactNode;
  description: string;
  disabled?: boolean;
}

// ----------------------------
// Component
// ----------------------------

export function InspectionViewModeSelector() {
  const viewMode = useInspectionStore((s) => s.viewMode);
  const setViewMode = useInspectionStore((s) => s.setViewMode);
  const hasStems = useStreamStore((s) =>
    [...s.streams.values()].some((st) => st.kind === "stem")
  );

  // Get selected stream label for display
  const selectedStream = useStreamStore((s) =>
    s.selectedStreamId ? s.streams.get(s.selectedStreamId) ?? null : null
  );

  const options: ViewModeOption[] = useMemo(
    () => [
      {
        mode: "mixdown",
        label: "Mixdown",
        icon: <Eye className="w-3.5 h-3.5" />,
        description: "Inspect the main audio mixdown",
      },
      {
        mode: "selected-stem",
        label: selectedStream?.kind === "stem" ? selectedStream.label : "Selected Stem",
        icon: <Layers className="w-3.5 h-3.5" />,
        description: "Inspect the currently selected stem",
        disabled: !hasStems || selectedStream?.kind !== "stem",
      },
      {
        mode: "compare-all",
        label: "Compare All",
        icon: <GitCompare className="w-3.5 h-3.5" />,
        description: "Compare signals across all sources",
        disabled: !hasStems,
      },
    ],
    [hasStems, selectedStream]
  );

  return (
    <div className="flex items-center gap-1">
      <span className="text-xs text-zinc-500 dark:text-zinc-400 mr-1">View:</span>
      <div className="flex items-center rounded-md border border-zinc-200 dark:border-zinc-700 overflow-hidden">
        {options.map((option) => (
          <button
            key={option.mode}
            type="button"
            onClick={() => setViewMode(option.mode)}
            disabled={option.disabled}
            title={option.description}
            className={cn(
              "flex items-center gap-1.5 px-2 py-1 text-xs font-medium transition-colors",
              "border-r border-zinc-200 dark:border-zinc-700 last:border-r-0",
              viewMode === option.mode
                ? "bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100"
                : "bg-white dark:bg-zinc-900 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800/50",
              option.disabled && "opacity-40 cursor-not-allowed"
            )}
          >
            {option.icon}
            <span className="hidden sm:inline">{option.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
