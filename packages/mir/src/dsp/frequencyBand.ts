/**
 * Frequency Band utilities for F1.
 *
 * These functions provide validation, creation, and query operations
 * for frequency band structures. All computations are deterministic and pure.
 */

import type {
    FrequencyBand,
    FrequencyBandStructure,
    FrequencyBandTimeScope,
    FrequencyBandProvenance,
    FrequencyBoundsAtTime,
    FrequencySegment,
    FrequencyKeyframe,
} from "../types";

// ----------------------------
// ID Generation
// ----------------------------

/**
 * Generate a unique band ID.
 */
export function generateBandId(): string {
    return `band-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// ----------------------------
// Validation
// ----------------------------

/**
 * Validate frequency segments for a band.
 *
 * Checks:
 * - lowHz < highHz at all segment boundaries
 * - All frequency values are non-negative
 * - startTime < endTime for each segment
 * - Segments don't overlap in time
 * - Segments are ordered by startTime
 *
 * @param segments - Frequency segments to validate
 * @returns Array of validation errors (empty if valid)
 */
export function validateFrequencySegments(segments: FrequencySegment[]): string[] {
    const errors: string[] = [];

    for (let i = 0; i < segments.length; i++) {
        const seg = segments[i];
        if (!seg) continue;

        // Check frequency invariants at start
        if (seg.lowHzStart < 0 || seg.highHzStart < 0) {
            errors.push(`Segment ${i}: start frequencies must be non-negative`);
        }
        if (seg.lowHzStart >= seg.highHzStart) {
            errors.push(
                `Segment ${i}: lowHzStart (${seg.lowHzStart}) must be < highHzStart (${seg.highHzStart})`
            );
        }

        // Check frequency invariants at end
        if (seg.lowHzEnd < 0 || seg.highHzEnd < 0) {
            errors.push(`Segment ${i}: end frequencies must be non-negative`);
        }
        if (seg.lowHzEnd >= seg.highHzEnd) {
            errors.push(
                `Segment ${i}: lowHzEnd (${seg.lowHzEnd}) must be < highHzEnd (${seg.highHzEnd})`
            );
        }

        // Check time ordering
        if (seg.startTime >= seg.endTime) {
            errors.push(
                `Segment ${i}: startTime (${seg.startTime}) must be < endTime (${seg.endTime})`
            );
        }

        // Check non-overlap with next segment
        if (i < segments.length - 1) {
            const next = segments[i + 1];
            if (!next) continue;
            if (seg.endTime > next.startTime) {
                errors.push(`Segment ${i} overlaps with segment ${i + 1}`);
            }
            if (seg.startTime >= next.startTime) {
                errors.push(`Segment ${i} not ordered before segment ${i + 1}`);
            }
        }
    }

    return errors;
}

/**
 * Validate a frequency band.
 *
 * @param band - Frequency band to validate
 * @returns Array of validation errors (empty if valid)
 */
export function validateFrequencyBand(band: FrequencyBand): string[] {
    const errors: string[] = [];

    if (!band.id || band.id.trim() === "") {
        errors.push("Band must have a non-empty id");
    }

    if (!band.label || band.label.trim() === "") {
        errors.push("Band must have a non-empty label");
    }

    if (band.frequencyShape.length === 0) {
        errors.push(`Band "${band.label}": must have at least one frequency segment`);
    }

    // Validate segments
    const segmentErrors = validateFrequencySegments(band.frequencyShape);
    errors.push(...segmentErrors.map((e) => `Band "${band.label}": ${e}`));

    // For sectioned bands, validate segments cover the scope
    if (band.timeScope.kind === "sectioned" && band.frequencyShape.length > 0) {
        const { startTime, endTime } = band.timeScope;
        const first = band.frequencyShape[0];
        const last = band.frequencyShape[band.frequencyShape.length - 1];

        if (first && first.startTime > startTime) {
            errors.push(
                `Band "${band.label}": segments don't cover scope start (first segment starts at ${first.startTime}, scope starts at ${startTime})`
            );
        }
        if (last && last.endTime < endTime) {
            errors.push(
                `Band "${band.label}": segments don't cover scope end (last segment ends at ${last.endTime}, scope ends at ${endTime})`
            );
        }
    }
    // Note: Global bands skip coverage validation per design decision

    return errors;
}

/**
 * Validate a complete frequency band structure.
 *
 * @param structure - Structure to validate
 * @returns Array of validation errors (empty if valid)
 */
export function validateBandStructure(structure: FrequencyBandStructure): string[] {
    const errors: string[] = [];

    // Check for duplicate IDs
    const ids = new Set<string>();
    for (const band of structure.bands) {
        if (ids.has(band.id)) {
            errors.push(`Duplicate band ID: ${band.id}`);
        }
        ids.add(band.id);
    }

    // Validate each band
    for (const band of structure.bands) {
        errors.push(...validateFrequencyBand(band));
    }

    return errors;
}

// ----------------------------
// Creation Helpers
// ----------------------------

/**
 * Create an empty FrequencyBandStructure.
 */
export function createBandStructure(): FrequencyBandStructure {
    const now = new Date().toISOString();
    return {
        version: 2,
        bands: [],
        createdAt: now,
        modifiedAt: now,
    };
}

/**
 * Create a simple constant-frequency band (no time variation).
 *
 * @param label - Human-readable band label
 * @param lowHz - Lower frequency bound in Hz
 * @param highHz - Upper frequency bound in Hz
 * @param duration - Duration in seconds (defines segment end time)
 * @param options - Optional configuration
 * @returns A new FrequencyBand
 */
export function createConstantBand(
    label: string,
    lowHz: number,
    highHz: number,
    duration: number,
    options?: {
        enabled?: boolean;
        sortOrder?: number;
        id?: string;
        /** The audio source this band belongs to. Defaults to "mixdown". */
        sourceId?: string;
    }
): FrequencyBand {
    const now = new Date().toISOString();
    return {
        id: options?.id ?? generateBandId(),
        label,
        sourceId: options?.sourceId ?? "mixdown",
        enabled: options?.enabled ?? true,
        timeScope: { kind: "global" },
        frequencyShape: [
            {
                startTime: 0,
                endTime: duration,
                lowHzStart: lowHz,
                highHzStart: highHz,
                lowHzEnd: lowHz,
                highHzEnd: highHz,
            },
        ],
        sortOrder: options?.sortOrder ?? 0,
        provenance: {
            source: "manual",
            createdAt: now,
        },
    };
}

/**
 * Create a sectioned band (applies only to a time range).
 *
 * @param label - Human-readable band label
 * @param lowHz - Lower frequency bound in Hz
 * @param highHz - Upper frequency bound in Hz
 * @param startTime - Section start time in seconds
 * @param endTime - Section end time in seconds
 * @param options - Optional configuration
 * @returns A new FrequencyBand
 */
export function createSectionedBand(
    label: string,
    lowHz: number,
    highHz: number,
    startTime: number,
    endTime: number,
    options?: {
        enabled?: boolean;
        sortOrder?: number;
        id?: string;
        /** The audio source this band belongs to. Defaults to "mixdown". */
        sourceId?: string;
    }
): FrequencyBand {
    const now = new Date().toISOString();
    return {
        id: options?.id ?? generateBandId(),
        label,
        sourceId: options?.sourceId ?? "mixdown",
        enabled: options?.enabled ?? true,
        timeScope: { kind: "sectioned", startTime, endTime },
        frequencyShape: [
            {
                startTime,
                endTime,
                lowHzStart: lowHz,
                highHzStart: highHz,
                lowHzEnd: lowHz,
                highHzEnd: highHz,
            },
        ],
        sortOrder: options?.sortOrder ?? 0,
        provenance: {
            source: "manual",
            createdAt: now,
        },
    };
}

/**
 * Create standard frequency bands for a track.
 *
 * Creates a standard 6-band frequency split:
 * - Sub Bass: 20-60 Hz
 * - Bass: 60-250 Hz
 * - Low Mids: 250-500 Hz
 * - Mids: 500-2000 Hz
 * - High Mids: 2000-4000 Hz
 * - Highs: 4000-20000 Hz
 *
 * @param duration - Track duration in seconds
 * @param sourceId - The audio source these bands belong to. Defaults to "mixdown".
 * @returns Array of FrequencyBand objects
 */
export function createStandardBands(duration: number, sourceId: string = "mixdown"): FrequencyBand[] {
    const now = new Date().toISOString();
    const bands: Array<{ label: string; lowHz: number; highHz: number }> = [
        { label: "Sub Bass", lowHz: 20, highHz: 60 },
        { label: "Bass", lowHz: 60, highHz: 250 },
        { label: "Low Mids", lowHz: 250, highHz: 500 },
        { label: "Mids", lowHz: 500, highHz: 2000 },
        { label: "High Mids", lowHz: 2000, highHz: 4000 },
        { label: "Highs", lowHz: 4000, highHz: 20000 },
    ];

    return bands.map((b, index) => ({
        id: generateBandId(),
        label: b.label,
        sourceId,
        enabled: true,
        timeScope: { kind: "global" } as FrequencyBandTimeScope,
        frequencyShape: [
            {
                startTime: 0,
                endTime: duration,
                lowHzStart: b.lowHz,
                highHzStart: b.highHz,
                lowHzEnd: b.lowHz,
                highHzEnd: b.highHz,
            },
        ],
        sortOrder: index,
        provenance: {
            source: "preset" as const,
            createdAt: now,
            presetName: "Standard 6-Band",
        },
    }));
}

// ----------------------------
// Query Helpers
// ----------------------------

/**
 * Get all bands belonging to a specific audio source.
 *
 * @param structure - Frequency band structure (can be null)
 * @param sourceId - The audio source ID ("mixdown" or stem ID)
 * @returns Array of bands for that source, sorted by sortOrder
 */
export function bandsForSource(
    structure: FrequencyBandStructure | null,
    sourceId: string
): FrequencyBand[] {
    if (!structure) return [];
    return sortBands(structure.bands.filter((band) => band.sourceId === sourceId));
}

/**
 * Get all enabled bands belonging to a specific audio source.
 *
 * @param structure - Frequency band structure (can be null)
 * @param sourceId - The audio source ID ("mixdown" or stem ID)
 * @returns Array of enabled bands for that source, sorted by sortOrder
 */
export function enabledBandsForSource(
    structure: FrequencyBandStructure | null,
    sourceId: string
): FrequencyBand[] {
    if (!structure) return [];
    return sortBands(
        structure.bands.filter((band) => band.sourceId === sourceId && band.enabled)
    );
}

/**
 * Get all bands active at a given time.
 *
 * A band is active if:
 * - It is enabled
 * - The time falls within its time scope
 *
 * @param structure - Frequency band structure (can be null)
 * @param time - Time in seconds
 * @param sourceId - Optional: filter to a specific audio source
 * @returns Array of active bands
 */
export function bandsActiveAt(
    structure: FrequencyBandStructure | null,
    time: number,
    sourceId?: string
): FrequencyBand[] {
    if (!structure) return [];

    return structure.bands.filter((band) => {
        if (!band.enabled) return false;
        if (sourceId !== undefined && band.sourceId !== sourceId) return false;
        if (band.timeScope.kind === "global") return true;
        return time >= band.timeScope.startTime && time < band.timeScope.endTime;
    });
}

/**
 * Get frequency bounds for a band at a given time.
 *
 * Uses linear interpolation within segments.
 *
 * @param band - The frequency band to query
 * @param time - Time in seconds
 * @returns Frequency bounds if band is active and has defined bounds, null otherwise
 */
export function frequencyBoundsAt(
    band: FrequencyBand,
    time: number
): FrequencyBoundsAtTime | null {
    // Check if band is active at this time
    if (!band.enabled) return null;

    if (band.timeScope.kind === "sectioned") {
        if (time < band.timeScope.startTime || time >= band.timeScope.endTime) {
            return null;
        }
    }

    // Find the segment containing this time
    for (const seg of band.frequencyShape) {
        if (time >= seg.startTime && time < seg.endTime) {
            // Linear interpolation
            const t = (time - seg.startTime) / (seg.endTime - seg.startTime);
            return {
                bandId: band.id,
                lowHz: seg.lowHzStart + (seg.lowHzEnd - seg.lowHzStart) * t,
                highHz: seg.highHzStart + (seg.highHzEnd - seg.highHzStart) * t,
                enabled: band.enabled,
            };
        }
    }

    // Edge case: time exactly at end of last segment
    const last = band.frequencyShape[band.frequencyShape.length - 1];
    if (last && Math.abs(time - last.endTime) < 0.001) {
        return {
            bandId: band.id,
            lowHz: last.lowHzEnd,
            highHz: last.highHzEnd,
            enabled: band.enabled,
        };
    }

    return null;
}

/**
 * Get all frequency bounds at a given time.
 *
 * Returns bounds for all active bands that have defined frequency at the given time.
 *
 * @param structure - Frequency band structure (can be null)
 * @param time - Time in seconds
 * @returns Array of frequency bounds, sorted by sortOrder
 */
export function allFrequencyBoundsAt(
    structure: FrequencyBandStructure | null,
    time: number
): FrequencyBoundsAtTime[] {
    if (!structure) return [];

    const bounds: FrequencyBoundsAtTime[] = [];

    for (const band of structure.bands) {
        const b = frequencyBoundsAt(band, time);
        if (b) bounds.push(b);
    }

    // Sort by sortOrder
    bounds.sort((a, b) => {
        const bandA = structure.bands.find((band) => band.id === a.bandId);
        const bandB = structure.bands.find((band) => band.id === b.bandId);
        return (bandA?.sortOrder ?? 0) - (bandB?.sortOrder ?? 0);
    });

    return bounds;
}

/**
 * Find a band by its ID.
 *
 * @param structure - Frequency band structure (can be null)
 * @param id - Band ID to find
 * @returns The band if found, null otherwise
 */
export function findBandById(
    structure: FrequencyBandStructure | null,
    id: string
): FrequencyBand | null {
    if (!structure) return null;
    return structure.bands.find((b) => b.id === id) ?? null;
}

// ----------------------------
// Sorting Helpers
// ----------------------------

/**
 * Sort bands by sortOrder.
 * Returns a new array (does not mutate input).
 *
 * @param bands - Bands to sort
 * @returns New array sorted by sortOrder ascending
 */
export function sortBands(bands: FrequencyBand[]): FrequencyBand[] {
    return [...bands].sort((a, b) => a.sortOrder - b.sortOrder);
}

/**
 * Sort frequency segments by startTime.
 * Returns a new array (does not mutate input).
 *
 * @param segments - Segments to sort
 * @returns New array sorted by startTime ascending
 */
export function sortFrequencySegments(segments: FrequencySegment[]): FrequencySegment[] {
    return [...segments].sort((a, b) => a.startTime - b.startTime);
}

// ----------------------------
// Modification Helpers
// ----------------------------

/**
 * Update the modifiedAt timestamp of a structure.
 * Returns a new structure (does not mutate input).
 *
 * @param structure - Structure to update
 * @returns New structure with updated modifiedAt
 */
export function touchStructure(structure: FrequencyBandStructure): FrequencyBandStructure {
    return {
        ...structure,
        modifiedAt: new Date().toISOString(),
    };
}

/**
 * Add a band to a structure.
 * Returns a new structure (does not mutate input).
 *
 * @param structure - Structure to add to
 * @param band - Band to add
 * @returns New structure with the band added
 */
export function addBandToStructure(
    structure: FrequencyBandStructure,
    band: FrequencyBand
): FrequencyBandStructure {
    return {
        ...structure,
        bands: sortBands([...structure.bands, band]),
        modifiedAt: new Date().toISOString(),
    };
}

/**
 * Remove a band from a structure by ID.
 * Returns a new structure (does not mutate input).
 *
 * @param structure - Structure to remove from
 * @param bandId - ID of band to remove
 * @returns New structure with the band removed
 */
export function removeBandFromStructure(
    structure: FrequencyBandStructure,
    bandId: string
): FrequencyBandStructure {
    return {
        ...structure,
        bands: structure.bands.filter((b) => b.id !== bandId),
        modifiedAt: new Date().toISOString(),
    };
}

/**
 * Update a band in a structure.
 * Returns a new structure (does not mutate input).
 *
 * @param structure - Structure containing the band
 * @param bandId - ID of band to update
 * @param updates - Partial band updates to apply
 * @returns New structure with the band updated
 */
export function updateBandInStructure(
    structure: FrequencyBandStructure,
    bandId: string,
    updates: Partial<Omit<FrequencyBand, "id">>
): FrequencyBandStructure {
    return {
        ...structure,
        bands: sortBands(
            structure.bands.map((b) => (b.id === bandId ? { ...b, ...updates } : b))
        ),
        modifiedAt: new Date().toISOString(),
    };
}

// ----------------------------
// Keyframe Helpers (F2)
// ----------------------------

/**
 * Extract keyframes from a band's frequency shape.
 *
 * Keyframes are a UI abstraction over the segment model.
 * Each segment has a start keyframe and an end keyframe.
 * Adjacent segments share keyframes at their boundaries.
 *
 * @param band - The frequency band to extract keyframes from
 * @returns Array of keyframes sorted by time
 */
export function keyframesFromBand(band: FrequencyBand): FrequencyKeyframe[] {
    const keyframes: FrequencyKeyframe[] = [];
    const segments = sortFrequencySegments(band.frequencyShape);

    for (let i = 0; i < segments.length; i++) {
        const seg = segments[i];
        if (!seg) continue;

        // Add start keyframe
        keyframes.push({
            time: seg.startTime,
            lowHz: seg.lowHzStart,
            highHz: seg.highHzStart,
            segmentIndex: i,
            edge: "start",
        });

        // Only add end keyframe if it's not shared with next segment
        const nextSeg = segments[i + 1];
        const isShared = nextSeg && Math.abs(nextSeg.startTime - seg.endTime) < 0.001;

        if (!isShared) {
            keyframes.push({
                time: seg.endTime,
                lowHz: seg.lowHzEnd,
                highHz: seg.highHzEnd,
                segmentIndex: i,
                edge: "end",
            });
        }
    }

    return keyframes;
}

/**
 * Convert keyframes back to frequency segments.
 *
 * Consecutive keyframes become segment boundaries.
 * This is the inverse of keyframesFromBand.
 *
 * @param keyframes - Array of keyframes (must be sorted by time)
 * @returns Array of frequency segments
 */
export function segmentsFromKeyframes(keyframes: FrequencyKeyframe[]): FrequencySegment[] {
    if (keyframes.length < 2) return [];

    const sorted = [...keyframes].sort((a, b) => a.time - b.time);
    const segments: FrequencySegment[] = [];

    for (let i = 0; i < sorted.length - 1; i++) {
        const curr = sorted[i];
        const next = sorted[i + 1];
        if (!curr || !next) continue;

        segments.push({
            startTime: curr.time,
            endTime: next.time,
            lowHzStart: curr.lowHz,
            highHzStart: curr.highHz,
            lowHzEnd: next.lowHz,
            highHzEnd: next.highHz,
        });
    }

    return segments;
}

/**
 * Split a band's segment at a given time, creating a new keyframe.
 *
 * The frequency values at the split point are interpolated from the
 * existing segment. Returns a new band with updated frequencyShape.
 *
 * @param band - The band to split
 * @param time - Time in seconds to split at
 * @returns New band with the split segment, or original band if time is invalid
 */
export function splitBandSegmentAt(band: FrequencyBand, time: number): FrequencyBand {
    const segments = sortFrequencySegments(band.frequencyShape);

    // Find the segment containing this time
    const segmentIndex = segments.findIndex(
        (seg) => time > seg.startTime && time < seg.endTime
    );

    if (segmentIndex === -1) {
        // Time is not inside any segment
        return band;
    }

    const seg = segments[segmentIndex];
    if (!seg) return band;

    // Calculate interpolated values at split point
    const t = (time - seg.startTime) / (seg.endTime - seg.startTime);
    const lowHz = seg.lowHzStart + (seg.lowHzEnd - seg.lowHzStart) * t;
    const highHz = seg.highHzStart + (seg.highHzEnd - seg.highHzStart) * t;

    // Create two new segments
    const firstHalf: FrequencySegment = {
        startTime: seg.startTime,
        endTime: time,
        lowHzStart: seg.lowHzStart,
        highHzStart: seg.highHzStart,
        lowHzEnd: lowHz,
        highHzEnd: highHz,
    };

    const secondHalf: FrequencySegment = {
        startTime: time,
        endTime: seg.endTime,
        lowHzStart: lowHz,
        highHzStart: highHz,
        lowHzEnd: seg.lowHzEnd,
        highHzEnd: seg.highHzEnd,
    };

    // Replace the original segment with the two halves
    const newSegments = [
        ...segments.slice(0, segmentIndex),
        firstHalf,
        secondHalf,
        ...segments.slice(segmentIndex + 1),
    ];

    return {
        ...band,
        frequencyShape: newSegments,
    };
}

/**
 * Merge adjacent segments where frequencies match at the boundary.
 *
 * This is useful after deleting a keyframe to clean up redundant segments.
 *
 * @param band - The band to merge segments in
 * @param tolerance - Frequency tolerance for considering values equal (default 0.1 Hz)
 * @returns New band with merged segments
 */
export function mergeAdjacentSegments(
    band: FrequencyBand,
    tolerance: number = 0.1
): FrequencyBand {
    const segments = sortFrequencySegments(band.frequencyShape);

    if (segments.length < 2) return band;

    const merged: FrequencySegment[] = [];
    let current = segments[0];

    if (!current) return band;

    for (let i = 1; i < segments.length; i++) {
        const next = segments[i];
        if (!next) continue;

        // Check if segments can be merged
        const timeMatches = Math.abs(current.endTime - next.startTime) < 0.001;
        const lowMatches = Math.abs(current.lowHzEnd - next.lowHzStart) < tolerance;
        const highMatches = Math.abs(current.highHzEnd - next.highHzStart) < tolerance;

        if (timeMatches && lowMatches && highMatches) {
            // Merge: extend current to include next
            current = {
                startTime: current.startTime,
                endTime: next.endTime,
                lowHzStart: current.lowHzStart,
                highHzStart: current.highHzStart,
                lowHzEnd: next.lowHzEnd,
                highHzEnd: next.highHzEnd,
            };
        } else {
            // Can't merge: push current and move on
            merged.push(current);
            current = next;
        }
    }

    // Don't forget the last segment
    merged.push(current);

    return {
        ...band,
        frequencyShape: merged,
    };
}

/**
 * Remove a keyframe from a band.
 *
 * This merges the two adjacent segments into one.
 * Cannot remove first or last keyframe (would make band invalid).
 *
 * @param band - The band to modify
 * @param time - Time of the keyframe to remove
 * @returns New band with keyframe removed, or original if removal is invalid
 */
export function removeKeyframe(band: FrequencyBand, time: number): FrequencyBand {
    const segments = sortFrequencySegments(band.frequencyShape);

    if (segments.length < 2) return band;

    // Find the segment that ends at this time and the one that starts at this time
    const endingIndex = segments.findIndex(
        (seg) => Math.abs(seg.endTime - time) < 0.001
    );
    const startingIndex = segments.findIndex(
        (seg) => Math.abs(seg.startTime - time) < 0.001
    );

    // Can only remove keyframes at segment boundaries (not first or last)
    if (endingIndex === -1 || startingIndex === -1) return band;
    if (endingIndex !== startingIndex - 1) return band;

    const endingSeg = segments[endingIndex];
    const startingSeg = segments[startingIndex];

    if (!endingSeg || !startingSeg) return band;

    // Merge the two segments
    const merged: FrequencySegment = {
        startTime: endingSeg.startTime,
        endTime: startingSeg.endTime,
        lowHzStart: endingSeg.lowHzStart,
        highHzStart: endingSeg.highHzStart,
        lowHzEnd: startingSeg.lowHzEnd,
        highHzEnd: startingSeg.highHzEnd,
    };

    const newSegments = [
        ...segments.slice(0, endingIndex),
        merged,
        ...segments.slice(startingIndex + 1),
    ];

    return {
        ...band,
        frequencyShape: newSegments,
    };
}

/**
 * Update a keyframe's frequency values.
 *
 * This updates the corresponding segment boundary.
 *
 * @param band - The band to modify
 * @param time - Time of the keyframe to update
 * @param lowHz - New lower frequency (or undefined to keep current)
 * @param highHz - New upper frequency (or undefined to keep current)
 * @returns New band with updated keyframe
 */
export function updateKeyframe(
    band: FrequencyBand,
    time: number,
    lowHz?: number,
    highHz?: number
): FrequencyBand {
    const segments = band.frequencyShape.map((seg) => {
        const isStart = Math.abs(seg.startTime - time) < 0.001;
        const isEnd = Math.abs(seg.endTime - time) < 0.001;

        if (!isStart && !isEnd) return seg;

        const newSeg = { ...seg };

        if (isStart) {
            if (lowHz !== undefined) newSeg.lowHzStart = lowHz;
            if (highHz !== undefined) newSeg.highHzStart = highHz;
        }

        if (isEnd) {
            if (lowHz !== undefined) newSeg.lowHzEnd = lowHz;
            if (highHz !== undefined) newSeg.highHzEnd = highHz;
        }

        return newSeg;
    });

    return {
        ...band,
        frequencyShape: segments,
    };
}

/**
 * Move a keyframe in time.
 *
 * Updates the endTime of the segment before and startTime of the segment after.
 * Cannot move first or last keyframe.
 *
 * @param band - The band to modify
 * @param oldTime - Current time of the keyframe
 * @param newTime - New time for the keyframe
 * @returns New band with moved keyframe, or original if move is invalid
 */
export function moveKeyframeTime(
    band: FrequencyBand,
    oldTime: number,
    newTime: number
): FrequencyBand {
    const segments = sortFrequencySegments(band.frequencyShape);

    // Find the segments that share this boundary
    const endingIndex = segments.findIndex(
        (seg) => Math.abs(seg.endTime - oldTime) < 0.001
    );
    const startingIndex = segments.findIndex(
        (seg) => Math.abs(seg.startTime - oldTime) < 0.001
    );

    // Must be at a segment boundary
    if (endingIndex === -1 || startingIndex === -1) return band;
    if (endingIndex !== startingIndex - 1) return band;

    const endingSeg = segments[endingIndex];
    const startingSeg = segments[startingIndex];

    if (!endingSeg || !startingSeg) return band;

    // Check bounds: newTime must be within the span of both segments
    if (newTime <= endingSeg.startTime || newTime >= startingSeg.endTime) {
        return band;
    }

    // Update the boundary
    const newSegments = segments.map((seg, i) => {
        if (i === endingIndex) {
            return { ...seg, endTime: newTime };
        }
        if (i === startingIndex) {
            return { ...seg, startTime: newTime };
        }
        return seg;
    });

    return {
        ...band,
        frequencyShape: newSegments,
    };
}
