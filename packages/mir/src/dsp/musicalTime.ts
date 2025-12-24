/**
 * Musical Time utilities for B4.
 *
 * These functions compute derived values from musical time structures.
 * All computations are deterministic and pure.
 */

import type { BeatPosition, MusicalTimeSegment, MusicalTimeStructure, BeatGrid } from "../types";

/**
 * Find the segment containing a given time.
 * Segments are non-overlapping, so at most one segment contains any time.
 *
 * @param time - Time in seconds from track start
 * @param segments - Ordered list of segments (by startTime ascending)
 * @returns The containing segment, or null if time is outside all segments
 */
export function findSegmentAtTime(
    time: number,
    segments: MusicalTimeSegment[]
): MusicalTimeSegment | null {
    // Binary search would be more efficient for many segments,
    // but linear scan is fine for typical track segment counts (<10)
    for (const segment of segments) {
        if (time >= segment.startTime && time < segment.endTime) {
            return segment;
        }
    }
    return null;
}

/**
 * Compute the beat position at a given time.
 *
 * Beat position formula:
 *   period = 60 / bpm
 *   beatsFromStart = (time - phaseOffset) / period
 *   beatIndex = floor(beatsFromStart)
 *   beatPhase = beatsFromStart - beatIndex (fractional part, 0-1)
 *   beatPosition = beatsFromStart (continuous)
 *
 * @param time - Time in seconds from track start
 * @param segments - Ordered list of segments (by startTime ascending)
 * @returns BeatPosition if time is within a segment, null otherwise
 */
export function computeBeatPosition(
    time: number,
    segments: MusicalTimeSegment[]
): BeatPosition | null {
    const segment = findSegmentAtTime(time, segments);
    if (!segment) {
        return null;
    }

    const period = 60 / segment.bpm;
    const beatsFromStart = (time - segment.phaseOffset) / period;

    // Handle edge case: time before first beat in segment
    // beatIndex should never be negative within a properly defined segment
    const beatIndex = Math.floor(beatsFromStart);
    const beatPhase = beatsFromStart - beatIndex;

    return {
        segmentId: segment.id,
        beatIndex,
        beatPhase,
        beatPosition: beatsFromStart,
        bpm: segment.bpm,
    };
}

/**
 * Compute beat position from a MusicalTimeStructure.
 * Convenience wrapper for computeBeatPosition.
 */
export function computeBeatPositionFromStructure(
    time: number,
    structure: MusicalTimeStructure | null
): BeatPosition | null {
    if (!structure || structure.segments.length === 0) {
        return null;
    }
    return computeBeatPosition(time, structure.segments);
}

/**
 * Generate a unique segment ID.
 */
export function generateSegmentId(): string {
    return `seg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Create a new MusicalTimeSegment from a BeatGrid.
 *
 * @param grid - The beat grid to promote
 * @param startTime - Segment start boundary in seconds
 * @param endTime - Segment end boundary in seconds
 * @returns A new MusicalTimeSegment
 */
export function createSegmentFromGrid(
    grid: BeatGrid,
    startTime: number,
    endTime: number
): MusicalTimeSegment {
    const effectivePhaseOffset = grid.phaseOffset + grid.userNudge;

    return {
        id: generateSegmentId(),
        bpm: grid.bpm,
        phaseOffset: effectivePhaseOffset,
        startTime,
        endTime,
        confidence: grid.confidence,
        provenance: {
            source: "promoted_from_hypothesis",
            sourceHypothesisId: grid.sourceHypothesisId,
            promotedAt: new Date().toISOString(),
            userNudge: grid.userNudge,
        },
    };
}

/**
 * Create a new empty MusicalTimeStructure.
 */
export function createMusicalTimeStructure(): MusicalTimeStructure {
    const now = new Date().toISOString();
    return {
        version: 1,
        segments: [],
        createdAt: now,
        modifiedAt: now,
    };
}

/**
 * Validate that segments are non-overlapping and ordered.
 *
 * @param segments - List of segments to validate
 * @returns Array of validation errors (empty if valid)
 */
export function validateSegments(segments: MusicalTimeSegment[]): string[] {
    const errors: string[] = [];

    for (let i = 0; i < segments.length; i++) {
        const seg = segments[i];
        if (!seg) continue;

        // Check segment bounds
        if (seg.startTime >= seg.endTime) {
            errors.push(`Segment ${seg.id}: startTime (${seg.startTime}) >= endTime (${seg.endTime})`);
        }

        if (seg.bpm <= 0) {
            errors.push(`Segment ${seg.id}: bpm (${seg.bpm}) must be positive`);
        }

        // Check ordering and non-overlap with next segment
        if (i < segments.length - 1) {
            const next = segments[i + 1];
            if (!next) continue;
            if (seg.startTime >= next.startTime) {
                errors.push(`Segment ${seg.id} not ordered before ${next.id}`);
            }
            if (seg.endTime > next.startTime) {
                errors.push(`Segment ${seg.id} overlaps with ${next.id}`);
            }
        }
    }

    return errors;
}

/**
 * Sort segments by startTime ascending.
 * Returns a new array (does not mutate input).
 */
export function sortSegments(segments: MusicalTimeSegment[]): MusicalTimeSegment[] {
    return [...segments].sort((a, b) => a.startTime - b.startTime);
}

/**
 * Split a segment at a given time.
 *
 * @param segment - The segment to split
 * @param splitTime - Time in seconds where to split
 * @returns Tuple of [beforeSegment, afterSegment]
 * @throws If splitTime is outside segment bounds
 */
export function splitSegment(
    segment: MusicalTimeSegment,
    splitTime: number
): [MusicalTimeSegment, MusicalTimeSegment] {
    if (splitTime <= segment.startTime || splitTime >= segment.endTime) {
        throw new Error(
            `Split time ${splitTime} must be within segment bounds [${segment.startTime}, ${segment.endTime})`
        );
    }

    const beforeSegment: MusicalTimeSegment = {
        ...segment,
        id: generateSegmentId(),
        endTime: splitTime,
    };

    const afterSegment: MusicalTimeSegment = {
        ...segment,
        id: generateSegmentId(),
        startTime: splitTime,
        // phaseOffset stays the same - beat grid continues seamlessly
    };

    return [beforeSegment, afterSegment];
}

/**
 * Generate beat times within a segment.
 * Used for rendering beat markers.
 *
 * @param segment - The segment to generate beats for
 * @returns Array of beat times in seconds
 */
export function generateSegmentBeatTimes(segment: MusicalTimeSegment): number[] {
    const period = 60 / segment.bpm;
    const times: number[] = [];

    // Find first beat at or after segment start
    const beatsBeforeStart = Math.ceil((segment.startTime - segment.phaseOffset) / period);
    let time = segment.phaseOffset + beatsBeforeStart * period;

    while (time < segment.endTime) {
        if (time >= segment.startTime) {
            times.push(time);
        }
        time += period;
    }

    return times;
}
