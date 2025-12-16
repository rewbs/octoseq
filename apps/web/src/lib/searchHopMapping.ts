import type { SearchPrecision } from "@/components/search/SearchControlsPanel";

/**
 * Map the UI "precision" control to a deterministic hop size in seconds.
 *
 * Engineering choice:
 * - absolute hop sizes (20/35/50ms) are intuitive
 * - we scale up modestly for long selections to avoid excessive window counts
 */
export function precisionToHopSec(precision: SearchPrecision, selectionDurationSec: number): number {
    const base = precision === "fine" ? 0.02 : precision === "medium" ? 0.035 : 0.05;
    const dur = Math.max(0, selectionDurationSec);
    const scaled = dur > 2 ? base * 1.5 : base;
    return Math.max(0.005, scaled);
}
