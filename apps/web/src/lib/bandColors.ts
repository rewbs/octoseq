/**
 * Shared band color constants for frequency band visualization.
 *
 * These colors are used across:
 * - FrequencyBandOverlay (canvas rendering)
 * - FrequencyBandSidebar (Tailwind classes)
 * - BandMirSignalViewer (signal visualization)
 */

// ----------------------------
// RGB Values (for canvas/custom rendering)
// ----------------------------

export type RgbColor = { r: number; g: number; b: number };

export const BAND_COLORS_RGB: RgbColor[] = [
    { r: 59, g: 130, b: 246 },   // Blue
    { r: 16, g: 185, b: 129 },   // Green
    { r: 249, g: 115, b: 22 },   // Orange
    { r: 139, g: 92, b: 246 },   // Purple
    { r: 236, g: 72, b: 153 },   // Pink
    { r: 20, g: 184, b: 166 },   // Teal
];

// ----------------------------
// Hex Values (for WaveSurfer, CSS)
// ----------------------------

export const BAND_COLORS_HEX: string[] = [
    "#3b82f6", // blue-500
    "#10b981", // emerald-500
    "#f97316", // orange-500
    "#8b5cf6", // violet-500
    "#ec4899", // pink-500
    "#14b8a6", // teal-500
];

// ----------------------------
// Tailwind Classes (for UI components)
// ----------------------------

export const BAND_COLORS_TAILWIND: string[] = [
    "bg-blue-500",
    "bg-emerald-500",
    "bg-orange-500",
    "bg-violet-500",
    "bg-pink-500",
    "bg-teal-500",
];

export const BAND_TEXT_COLORS_TAILWIND: string[] = [
    "text-blue-500",
    "text-emerald-500",
    "text-orange-500",
    "text-violet-500",
    "text-pink-500",
    "text-teal-500",
];

export const BAND_BORDER_COLORS_TAILWIND: string[] = [
    "border-blue-500",
    "border-emerald-500",
    "border-orange-500",
    "border-violet-500",
    "border-pink-500",
    "border-teal-500",
];

// ----------------------------
// Accessors (with cycling for any index)
// ----------------------------

export function getBandColorRgb(index: number): RgbColor {
    const len = BAND_COLORS_RGB.length;
    return BAND_COLORS_RGB[((index % len) + len) % len] ?? BAND_COLORS_RGB[0]!;
}

export function getBandColorHex(index: number): string {
    const len = BAND_COLORS_HEX.length;
    return BAND_COLORS_HEX[((index % len) + len) % len] ?? BAND_COLORS_HEX[0]!;
}

export function getBandColorTailwind(index: number): string {
    const len = BAND_COLORS_TAILWIND.length;
    return BAND_COLORS_TAILWIND[((index % len) + len) % len] ?? BAND_COLORS_TAILWIND[0]!;
}

export function getBandTextColorTailwind(index: number): string {
    const len = BAND_TEXT_COLORS_TAILWIND.length;
    return BAND_TEXT_COLORS_TAILWIND[((index % len) + len) % len] ?? BAND_TEXT_COLORS_TAILWIND[0]!;
}

export function getBandBorderColorTailwind(index: number): string {
    const len = BAND_BORDER_COLORS_TAILWIND.length;
    return BAND_BORDER_COLORS_TAILWIND[((index % len) + len) % len] ?? BAND_BORDER_COLORS_TAILWIND[0]!;
}

/**
 * Get all color variants for a band at a given index.
 */
export function getBandColors(index: number): {
    rgb: RgbColor;
    hex: string;
    bg: string;
    text: string;
    border: string;
} {
    return {
        rgb: getBandColorRgb(index),
        hex: getBandColorHex(index),
        bg: getBandColorTailwind(index),
        text: getBandTextColorTailwind(index),
        border: getBandBorderColorTailwind(index),
    };
}

/**
 * Convert RGB to hex string.
 */
export function rgbToHex(color: RgbColor): string {
    const r = Math.round(color.r).toString(16).padStart(2, "0");
    const g = Math.round(color.g).toString(16).padStart(2, "0");
    const b = Math.round(color.b).toString(16).padStart(2, "0");
    return `#${r}${g}${b}`;
}

/**
 * Convert RGB to CSS rgba string with optional alpha.
 */
export function rgbToRgba(color: RgbColor, alpha: number = 1): string {
    return `rgba(${color.r}, ${color.g}, ${color.b}, ${alpha})`;
}
