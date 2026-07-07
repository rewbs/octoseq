/**
 * Deterministic per-stream row colors for the Comparison panel.
 *
 * - Bands reuse the shared band palette, indexed among ALL bands in sortOrder —
 *   the same convention as BandMirSignalViewer, so a band keeps its color across
 *   both viewers.
 * - The mixdown gets a fixed neutral accent readable on the zinc-50/zinc-900 row
 *   backgrounds in both themes.
 * - Stems get their own small palette (distinct from the band palette), indexed
 *   among stems in sortOrder.
 */

import { getBandColorHex } from "@/lib/bandColors";
import { isBandStream, type Stream, type StreamId } from "@/lib/streams";

/** Mixdown accent (zinc-400): readable on both light and dark row backgrounds. */
export const MIXDOWN_COLOR_HEX = "#a1a1aa";

/** Stem palette — deliberately disjoint from BAND_COLORS_HEX. */
export const STEM_COLORS_HEX: string[] = [
  "#f59e0b", // amber-500
  "#06b6d4", // cyan-500
  "#84cc16", // lime-500
  "#d946ef", // fuchsia-500
  "#f43f5e", // rose-500
  "#6366f1", // indigo-500
];

function stemColorHex(index: number): string {
  const len = STEM_COLORS_HEX.length;
  return STEM_COLORS_HEX[((index % len) + len) % len] ?? MIXDOWN_COLOR_HEX;
}

/** Compute a stable stroke color for every stream in the collection. */
export function buildStreamColorMap(streams: Map<StreamId, Stream>): Map<StreamId, string> {
  const all = [...streams.values()];
  const stems = all
    .filter((s) => s.kind === "stem")
    .sort((a, b) => a.sortOrder - b.sortOrder);
  const bands = all.filter(isBandStream).sort((a, b) => a.sortOrder - b.sortOrder);

  const colors = new Map<StreamId, string>();
  for (const stream of all) {
    if (stream.kind === "mixdown") colors.set(stream.id, MIXDOWN_COLOR_HEX);
  }
  stems.forEach((stem, index) => colors.set(stem.id, stemColorHex(index)));
  bands.forEach((band, index) => colors.set(band.id, getBandColorHex(index)));
  return colors;
}
