/**
 * Phase alignment algorithm for beat grid generation.
 *
 * Given a BPM and beat candidates, this module computes optimal phase offsets
 * that align the beat grid with detected beat candidates.
 *
 * The algorithm is deterministic: same inputs always produce same outputs.
 */

import type { BeatCandidate, PhaseHypothesis, PhaseAlignmentConfig } from "../types";

const DEFAULT_CONFIG: Required<PhaseAlignmentConfig> = {
    phaseResolution: 16,
    matchTolerance: 0.05, // 50ms
    topK: 3,
    offsetPenaltyWeight: 0.2,
};

/**
 * Compute phase hypotheses for a given BPM against beat candidates.
 *
 * Algorithm:
 * 1. Compute beat period = 60 / bpm
 * 2. Generate N phase offsets spanning [0, period) at resolution = period/N
 * 3. For each phase offset:
 *    a. For each beat candidate, find closest grid line
 *    b. If within tolerance, add weighted score based on candidate strength
 *    c. Track systematic offset error for penalty
 * 4. Normalize scores and apply offset penalty
 * 5. Return top K phases sorted by score
 *
 * @param bpm - Tempo in beats per minute
 * @param candidates - Beat candidate events with time and strength
 * @param audioDuration - Total audio duration in seconds
 * @param config - Optional configuration overrides
 * @returns Array of top K phase hypotheses, sorted by score descending
 */
export function computePhaseHypotheses(
    bpm: number,
    candidates: BeatCandidate[],
    audioDuration: number,
    config?: PhaseAlignmentConfig
): PhaseHypothesis[] {
    const cfg = { ...DEFAULT_CONFIG, ...config };
    const period = 60 / bpm;

    if (candidates.length === 0 || audioDuration <= 0 || bpm <= 0) {
        return [];
    }

    const phases: PhaseHypothesis[] = [];

    // Generate and score phase candidates
    for (let i = 0; i < cfg.phaseResolution; i++) {
        const phaseOffset = (i / cfg.phaseResolution) * period;
        const result = scorePhase(phaseOffset, period, candidates, audioDuration, cfg.matchTolerance);
        phases.push({
            index: i,
            phaseOffset,
            score: result.score,
            matchCount: result.matchCount,
            avgOffsetError: result.avgOffsetError,
        });
    }

    // Normalize scores to [0, 1] and apply offset penalty
    const maxScore = Math.max(...phases.map((p) => p.score), 1e-9);
    for (const phase of phases) {
        // Penalty based on systematic offset (how far off-center matches are)
        const penalty = (phase.avgOffsetError / cfg.matchTolerance) * cfg.offsetPenaltyWeight;
        phase.score = (phase.score / maxScore) * (1 - Math.min(1, penalty));
    }

    // Sort by score descending and take top K
    phases.sort((a, b) => b.score - a.score);
    return phases.slice(0, cfg.topK);
}

/**
 * Score a single phase offset against beat candidates.
 */
function scorePhase(
    phaseOffset: number,
    period: number,
    candidates: BeatCandidate[],
    audioDuration: number,
    tolerance: number
): { score: number; matchCount: number; avgOffsetError: number } {
    let score = 0;
    let matchCount = 0;
    let totalOffsetError = 0;

    for (const candidate of candidates) {
        // Find the closest grid beat to this candidate
        const beatsFromStart = (candidate.time - phaseOffset) / period;
        const nearestBeatIndex = Math.round(beatsFromStart);
        const nearestBeatTime = phaseOffset + nearestBeatIndex * period;

        // Skip if the nearest beat is outside the audio range
        if (nearestBeatTime < 0 || nearestBeatTime > audioDuration) continue;

        const offset = Math.abs(candidate.time - nearestBeatTime);

        if (offset <= tolerance) {
            // Gaussian-like weighting: closer matches score higher
            const weight = Math.exp((-offset * offset) / (2 * tolerance * tolerance));
            score += candidate.strength * weight;
            matchCount++;
            totalOffsetError += offset;
        }
    }

    const avgOffsetError = matchCount > 0 ? totalOffsetError / matchCount : 0;

    return { score, matchCount, avgOffsetError };
}

/**
 * Generate beat times for a given grid within the audio duration.
 *
 * @param bpm - Tempo in beats per minute
 * @param phaseOffset - Base phase offset in seconds
 * @param userNudge - User adjustment in seconds (additive)
 * @param audioDuration - Total audio duration in seconds
 * @returns Array of beat times in seconds
 */
export function generateBeatTimes(
    bpm: number,
    phaseOffset: number,
    userNudge: number,
    audioDuration: number
): number[] {
    if (bpm <= 0 || audioDuration <= 0) {
        return [];
    }

    const period = 60 / bpm;
    const effectivePhase = phaseOffset + userNudge;
    const beats: number[] = [];

    // Find the first beat at or after time 0
    const firstBeatIndex = Math.ceil(-effectivePhase / period);
    let time = effectivePhase + firstBeatIndex * period;

    while (time <= audioDuration) {
        if (time >= 0) {
            beats.push(time);
        }
        time += period;
    }

    return beats;
}
