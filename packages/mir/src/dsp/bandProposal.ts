/**
 * Band Proposal Generation for F5.
 *
 * Generates automated suggestions for "interesting" frequency bands.
 * Proposals are advisory only - they must be explicitly promoted by the user.
 *
 * Algorithm overview:
 * 1. Analyze spectral structure using CQT
 * 2. Identify regions with concentrated energy or distinct activity
 * 3. Score and rank candidates
 * 4. Generate proposal objects with explanations
 */

import type {
    BandProposal,
    BandProposalConfig,
    BandProposalResult,
    BandProposalSource,
    CqtSpectrogram,
    FrequencyBand,
    FrequencyBandProvenance,
    MirRunMeta,
} from "../types";
import { type AudioBufferLike, type Spectrogram, spectrogram } from "./spectrogram";
import { cqtSpectrogram, cqtBinToHz, withCqtDefaults, getNumBins } from "./cqt";
import { harmonicEnergy, bassPitchMotion, tonalStability } from "./cqtSignals";

// ----------------------------
// Configuration Defaults
// ----------------------------

const PROPOSAL_DEFAULTS: Required<BandProposalConfig> = {
    maxProposals: 8,
    minSalience: 0.3,
    minSeparationOctaves: 0.5,
    minBandwidthHz: 20,
    analysisWindow: 0, // 0 = full track
};

// ----------------------------
// Types
// ----------------------------

type SpectralPeak = {
    binIndex: number;
    centerHz: number;
    magnitude: number;
    bandwidth: number; // in octaves
    lowHz: number;
    highHz: number;
};

type ProposalCandidate = {
    peak: SpectralPeak;
    salience: number;
    source: BandProposalSource;
    reason: string;
};

// ----------------------------
// Utility Functions
// ----------------------------

/**
 * Generate a unique proposal ID.
 */
function generateProposalId(): string {
    return `proposal-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Generate a band ID for the proposed band.
 */
function generateBandId(): string {
    return `band-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Compute time-averaged magnitude spectrum from CQT.
 */
function computeAverageCqtSpectrum(cqt: CqtSpectrogram): Float32Array {
    const nBins = cqt.magnitudes[0]?.length ?? 0;
    const nFrames = cqt.magnitudes.length;
    const average = new Float32Array(nBins);

    for (let frame = 0; frame < nFrames; frame++) {
        const frameMags = cqt.magnitudes[frame];
        if (!frameMags) continue;

        for (let bin = 0; bin < nBins; bin++) {
            average[bin] = (average[bin] ?? 0) + (frameMags[bin] ?? 0);
        }
    }

    for (let bin = 0; bin < nBins; bin++) {
        average[bin] = (average[bin] ?? 0) / nFrames;
    }

    return average;
}

/**
 * Find local maxima in a 1D array.
 */
function findLocalMaxima(
    values: Float32Array,
    minNeighborDistance: number = 3
): number[] {
    const peaks: number[] = [];

    for (let i = minNeighborDistance; i < values.length - minNeighborDistance; i++) {
        let isPeak = true;
        const centerVal = values[i] ?? 0;

        for (let j = -minNeighborDistance; j <= minNeighborDistance; j++) {
            if (j === 0) continue;
            if ((values[i + j] ?? 0) >= centerVal) {
                isPeak = false;
                break;
            }
        }

        if (isPeak && centerVal > 0) {
            peaks.push(i);
        }
    }

    return peaks;
}

/**
 * Compute the bandwidth (in bins) at -3dB around a peak.
 */
function computeBandwidth(
    values: Float32Array,
    peakBin: number,
    cqt: CqtSpectrogram,
    minBandwidthHz: number
): { lowBin: number; highBin: number; lowHz: number; highHz: number; bandwidthOctaves: number } {
    const peakMag = values[peakBin] ?? 0;
    const threshold = peakMag * 0.707; // -3dB

    // Find lower edge
    let lowBin = peakBin;
    while (lowBin > 0 && (values[lowBin - 1] ?? 0) >= threshold) {
        lowBin--;
    }

    // Find upper edge
    let highBin = peakBin;
    while (highBin < values.length - 1 && (values[highBin + 1] ?? 0) >= threshold) {
        highBin++;
    }

    // Enforce a minimum bandwidth in Hz to avoid implausibly narrow bands (e.g. ~1 Hz at low freqs).
    // Expand symmetrically around the peak when possible, otherwise expand toward the available side.
    if (minBandwidthHz > 0) {
        // Avoid infinite loops if something goes wrong
        const maxExpansions = values.length;
        for (let i = 0; i < maxExpansions; i++) {
            const lowHzTmp = cqtBinToHz(lowBin, cqt.config);
            const highHzTmp = cqtBinToHz(highBin, cqt.config);
            if (highHzTmp - lowHzTmp >= minBandwidthHz) break;

            const canExpandLow = lowBin > 0;
            const canExpandHigh = highBin < values.length - 1;
            if (!canExpandLow && !canExpandHigh) break;

            if (canExpandLow && canExpandHigh) {
                lowBin--;
                highBin++;
            } else if (canExpandLow) {
                lowBin--;
            } else {
                highBin++;
            }
        }
    }

    const lowHz = cqtBinToHz(lowBin, cqt.config);
    const highHz = cqtBinToHz(highBin, cqt.config);
    const bandwidthOctaves = Math.log2(highHz / lowHz);

    return { lowBin, highBin, lowHz, highHz, bandwidthOctaves };
}

/**
 * Compute temporal variance of energy in a frequency band.
 * Low variance = consistent energy; high variance = transient or intermittent.
 */
function computeTemporalVariance(
    cqt: CqtSpectrogram,
    lowBin: number,
    highBin: number
): number {
    const nFrames = cqt.magnitudes.length;
    const bandEnergies = new Float32Array(nFrames);

    // Compute energy in band for each frame
    for (let frame = 0; frame < nFrames; frame++) {
        const frameMags = cqt.magnitudes[frame];
        if (!frameMags) continue;

        let energy = 0;
        for (let bin = lowBin; bin <= highBin; bin++) {
            const mag = frameMags[bin] ?? 0;
            energy += mag * mag;
        }
        bandEnergies[frame] = energy;
    }

    // Compute variance
    let sum = 0;
    for (let i = 0; i < nFrames; i++) {
        sum += bandEnergies[i] ?? 0;
    }
    const mean = sum / nFrames;

    let variance = 0;
    for (let i = 0; i < nFrames; i++) {
        const diff = (bandEnergies[i] ?? 0) - mean;
        variance += diff * diff;
    }
    variance /= nFrames;

    // Normalize by mean squared to get coefficient of variation squared
    return mean > 0 ? variance / (mean * mean) : 0;
}

// ----------------------------
// Peak Detection and Scoring
// ----------------------------

/**
 * Detect spectral peaks from the average CQT spectrum.
 */
function detectSpectralPeaks(
    cqt: CqtSpectrogram,
    config: Required<BandProposalConfig>
): SpectralPeak[] {
    const avgSpectrum = computeAverageCqtSpectrum(cqt);

    // Minimum distance in bins based on separation requirement
    const minBinDistance = Math.ceil(config.minSeparationOctaves * cqt.binsPerOctave);

    const peakIndices = findLocalMaxima(avgSpectrum, Math.max(3, minBinDistance / 2));

    const peaks: SpectralPeak[] = [];

    for (const binIndex of peakIndices) {
        const bw = computeBandwidth(avgSpectrum, binIndex, cqt, config.minBandwidthHz);

        peaks.push({
            binIndex,
            centerHz: cqtBinToHz(binIndex, cqt.config),
            magnitude: avgSpectrum[binIndex] ?? 0,
            bandwidth: bw.bandwidthOctaves,
            lowHz: bw.lowHz,
            highHz: bw.highHz,
        });
    }

    // Sort by magnitude (descending)
    peaks.sort((a, b) => b.magnitude - a.magnitude);

    return peaks;
}

/**
 * Score a spectral peak for proposal salience.
 */
function scorePeak(
    peak: SpectralPeak,
    cqt: CqtSpectrogram,
    avgSpectrum: Float32Array,
    cqtSignals: {
        harmonicEnergy: Float32Array;
        bassPitchMotion: Float32Array;
        tonalStability: Float32Array;
    }
): ProposalCandidate {
    // Find bin range for this peak
    const lowBin = Math.max(0, Math.floor(peak.lowHz / (cqt.config.fMin * Math.pow(2, 1 / cqt.binsPerOctave))));
    const highBin = Math.min(
        getNumBins(cqt.config) - 1,
        Math.ceil(peak.highHz / (cqt.config.fMin * Math.pow(2, 1 / cqt.binsPerOctave)))
    );

    // Compute various scores
    const temporalVariance = computeTemporalVariance(cqt, lowBin, highBin);

    // Energy concentration: how much energy is in this band vs total
    let bandEnergy = 0;
    let totalEnergy = 0;
    for (let bin = 0; bin < avgSpectrum.length; bin++) {
        const mag = avgSpectrum[bin] ?? 0;
        totalEnergy += mag * mag;
        if (bin >= lowBin && bin <= highBin) {
            bandEnergy += mag * mag;
        }
    }
    const energyConcentration = totalEnergy > 0 ? bandEnergy / totalEnergy : 0;

    // Get average CQT signal values for this frequency range
    // Map frequency to frame indices (not perfect, but approximate)
    const isBassRange = peak.centerHz < 300;
    const isLowMidRange = peak.centerHz >= 300 && peak.centerHz < 1000;

    // Compute average signal values
    let avgHarmonicEnergy = 0;
    let avgBassPitchMotion = 0;
    let avgTonalStability = 0;
    const nFrames = cqtSignals.harmonicEnergy.length;

    for (let i = 0; i < nFrames; i++) {
        avgHarmonicEnergy += cqtSignals.harmonicEnergy[i] ?? 0;
        avgBassPitchMotion += cqtSignals.bassPitchMotion[i] ?? 0;
        avgTonalStability += cqtSignals.tonalStability[i] ?? 0;
    }
    avgHarmonicEnergy /= nFrames;
    avgBassPitchMotion /= nFrames;
    avgTonalStability /= nFrames;

    // Determine source and compute salience based on characteristics
    let source: BandProposalSource;
    let reason: string;
    let salience: number;

    if (isBassRange && avgBassPitchMotion > 0.4) {
        source = "cqt_bass_motion";
        reason = "Significant bass pitch motion detected";
        salience = 0.3 + energyConcentration * 0.3 + avgBassPitchMotion * 0.4;
    } else if (avgHarmonicEnergy > 0.5 && avgTonalStability > 0.5) {
        source = "cqt_harmonic";
        reason = "Strong harmonic structure with stable tonality";
        salience = 0.3 + avgHarmonicEnergy * 0.35 + avgTonalStability * 0.35;
    } else if (temporalVariance > 0.5) {
        source = "onset_band";
        reason = "Distinct transient activity pattern";
        salience = 0.3 + energyConcentration * 0.3 + Math.min(1, temporalVariance) * 0.4;
    } else if (energyConcentration > 0.1) {
        source = "energy_cluster";
        reason = "Concentrated spectral energy";
        salience = 0.2 + energyConcentration * 0.5 + (1 - Math.min(1, peak.bandwidth)) * 0.3;
    } else {
        source = "spectral_peak";
        reason = "Persistent spectral peak";
        salience = 0.2 + energyConcentration * 0.4 + (1 - Math.min(1, peak.bandwidth * 2)) * 0.4;
    }

    // Add frequency-specific context to reason
    if (isBassRange) {
        reason += " (bass region)";
    } else if (isLowMidRange) {
        reason += " (low-mid region)";
    } else if (peak.centerHz > 4000) {
        reason += " (high frequency region)";
    }

    return {
        peak,
        salience: Math.min(1, Math.max(0, salience)),
        source,
        reason,
    };
}

// ----------------------------
// Proposal Generation
// ----------------------------

/**
 * Create a FrequencyBand from a proposal candidate.
 */
function createBandFromCandidate(
    candidate: ProposalCandidate,
    duration: number
): FrequencyBand {
    const now = new Date().toISOString();
    const provenance: FrequencyBandProvenance = {
        source: "manual", // Will be treated as imported when promoted
        createdAt: now,
    };

    return {
        id: generateBandId(),
        label: `Region ${Math.round(candidate.peak.centerHz)} Hz`,
        sourceId: "mixdown", // Proposals default to mixdown; user assigns sourceId on promotion
        enabled: true,
        timeScope: { kind: "global" },
        frequencyShape: [
            {
                startTime: 0,
                endTime: duration,
                lowHzStart: candidate.peak.lowHz,
                highHzStart: candidate.peak.highHz,
                lowHzEnd: candidate.peak.lowHz,
                highHzEnd: candidate.peak.highHz,
            },
        ],
        sortOrder: 0,
        provenance,
    };
}

/**
 * Filter candidates to remove overlapping proposals.
 * Keeps the highest-salience candidate when overlap exceeds threshold.
 */
function filterOverlappingCandidates(
    candidates: ProposalCandidate[],
    minSeparationOctaves: number
): ProposalCandidate[] {
    const filtered: ProposalCandidate[] = [];

    for (const candidate of candidates) {
        let hasOverlap = false;

        for (const existing of filtered) {
            const octaveDiff = Math.abs(
                Math.log2(candidate.peak.centerHz / existing.peak.centerHz)
            );

            if (octaveDiff < minSeparationOctaves) {
                hasOverlap = true;
                break;
            }
        }

        if (!hasOverlap) {
            filtered.push(candidate);
        }
    }

    return filtered;
}

// ----------------------------
// Main Export
// ----------------------------

export type BandProposalOptions = {
    config?: BandProposalConfig;
    isCancelled?: () => boolean;
};

/**
 * Generate band proposals from audio.
 *
 * @param audio - Audio buffer to analyze
 * @param duration - Track duration in seconds
 * @param options - Optional configuration
 * @returns Array of band proposals with salience scores and reasons
 */
export async function generateBandProposals(
    audio: AudioBufferLike,
    duration: number,
    options: BandProposalOptions = {}
): Promise<BandProposalResult> {
    const startTime = performance.now();

    const config: Required<BandProposalConfig> = {
        ...PROPOSAL_DEFAULTS,
        ...options.config,
    };

    // Compute CQT
    const cqtConfig = withCqtDefaults({
        binsPerOctave: 24,
        fMin: 32.7,
        fMax: Math.min(8372, audio.sampleRate / 2), // Cap at Nyquist
    });

    const cqt = await cqtSpectrogram(audio, cqtConfig, {
        isCancelled: options.isCancelled,
    });

    if (options.isCancelled?.()) {
        throw new Error("@octoseq/mir: cancelled");
    }

    // Compute CQT-derived signals
    const harmonicResult = harmonicEnergy(cqt);
    const bassMotionResult = bassPitchMotion(cqt);
    const tonalResult = tonalStability(cqt);

    const cqtSignals = {
        harmonicEnergy: harmonicResult.values,
        bassPitchMotion: bassMotionResult.values,
        tonalStability: tonalResult.values,
    };

    // Detect spectral peaks
    const peaks = detectSpectralPeaks(cqt, config);

    // Score each peak
    const avgSpectrum = computeAverageCqtSpectrum(cqt);
    const candidates: ProposalCandidate[] = [];

    for (const peak of peaks) {
        if (options.isCancelled?.()) {
            throw new Error("@octoseq/mir: cancelled");
        }

        const candidate = scorePeak(peak, cqt, avgSpectrum, cqtSignals);

        if (candidate.salience >= config.minSalience) {
            candidates.push(candidate);
        }
    }

    // Sort by salience (descending)
    candidates.sort((a, b) => b.salience - a.salience);

    // Filter overlapping candidates
    const filtered = filterOverlappingCandidates(candidates, config.minSeparationOctaves);

    // Limit to maxProposals
    const finalCandidates = filtered.slice(0, config.maxProposals);

    // Create proposals
    const proposals: BandProposal[] = finalCandidates.map((candidate, index) => {
        const band = createBandFromCandidate(candidate, duration);
        band.sortOrder = index;

        return {
            id: generateProposalId(),
            band,
            salience: candidate.salience,
            reason: candidate.reason,
            source: candidate.source,
            generatedAt: new Date().toISOString(),
        };
    });

    const endTime = performance.now();

    const meta: MirRunMeta = {
        backend: "cpu",
        usedGpu: false,
        timings: {
            totalMs: endTime - startTime,
            cpuMs: endTime - startTime,
        },
    };

    return {
        kind: "bandProposals",
        proposals,
        meta,
    };
}
