/**
 * Band Masking utilities for F3.
 *
 * These functions apply frequency band boundaries as spectral masks
 * to an existing spectrogram, enabling per-band MIR analysis.
 */

import type { Spectrogram } from "./spectrogram";
import type { FrequencyBand } from "../types";
import { frequencyBoundsAt } from "./frequencyBand";

// ----------------------------
// Types
// ----------------------------

export type BandMaskOptions = {
    /** Soft edge width in Hz for smooth transitions (0 = hard edge). Default: 0 */
    edgeSmoothHz?: number;
};

export type MaskedSpectrogram = Spectrogram & {
    /** ID of the band this mask was computed for */
    bandId: string;
    /** Fraction of energy retained per frame (0-1) for diagnostics */
    energyRetainedPerFrame: Float32Array;
};

// ----------------------------
// Conversion Helpers
// ----------------------------

/**
 * Convert an FFT bin index to frequency in Hz.
 *
 * @param bin - FFT bin index (0 to fftSize/2)
 * @param sampleRate - Audio sample rate in Hz
 * @param fftSize - FFT size (number of samples)
 * @returns Frequency in Hz
 */
export function binToHz(bin: number, sampleRate: number, fftSize: number): number {
    return bin * (sampleRate / fftSize);
}

/**
 * Convert a frequency in Hz to an FFT bin index.
 *
 * @param hz - Frequency in Hz
 * @param sampleRate - Audio sample rate in Hz
 * @param fftSize - FFT size (number of samples)
 * @returns FFT bin index (may be fractional)
 */
export function hzToBin(hz: number, sampleRate: number, fftSize: number): number {
    return hz / (sampleRate / fftSize);
}

// ----------------------------
// Mask Computation
// ----------------------------

/**
 * Compute a spectral mask for a band at a specific time.
 *
 * Returns a Float32Array of length (fftSize/2 + 1) containing
 * mask values between 0 and 1.
 *
 * @param band - The frequency band to mask
 * @param time - Time in seconds
 * @param sampleRate - Audio sample rate in Hz
 * @param fftSize - FFT size
 * @param options - Mask options
 * @returns Mask array, or null if band is inactive at this time
 */
export function computeBandMaskAtTime(
    band: FrequencyBand,
    time: number,
    sampleRate: number,
    fftSize: number,
    options?: BandMaskOptions
): Float32Array | null {
    const bounds = frequencyBoundsAt(band, time);
    if (!bounds) return null;

    const nBins = (fftSize >>> 1) + 1;
    const mask = new Float32Array(nBins);
    const edgeSmoothHz = options?.edgeSmoothHz ?? 0;
    const binHz = sampleRate / fftSize;

    for (let k = 0; k < nBins; k++) {
        const hz = binToHz(k, sampleRate, fftSize);

        if (hz < bounds.lowHz || hz > bounds.highHz) {
            // Outside band
            mask[k] = 0;
        } else if (edgeSmoothHz <= 0) {
            // Inside band, hard edge
            mask[k] = 1;
        } else {
            // Inside band, with soft edges
            const distFromLow = hz - bounds.lowHz;
            const distFromHigh = bounds.highHz - hz;

            let gain = 1;

            // Apply raised-cosine taper at low edge
            if (distFromLow < edgeSmoothHz) {
                gain *= 0.5 * (1 - Math.cos(Math.PI * distFromLow / edgeSmoothHz));
            }

            // Apply raised-cosine taper at high edge
            if (distFromHigh < edgeSmoothHz) {
                gain *= 0.5 * (1 - Math.cos(Math.PI * distFromHigh / edgeSmoothHz));
            }

            mask[k] = gain;
        }
    }

    return mask;
}

/**
 * Apply a band mask to an entire spectrogram.
 *
 * Creates a new spectrogram with band-masked magnitudes.
 * Uses linear interpolation of band bounds for time-varying bands.
 *
 * @param spec - Source spectrogram
 * @param band - Frequency band to apply
 * @param options - Mask options
 * @returns Masked spectrogram with energy retention diagnostics
 */
export function applyBandMaskToSpectrogram(
    spec: Spectrogram,
    band: FrequencyBand,
    options?: BandMaskOptions
): MaskedSpectrogram {
    const nFrames = spec.times.length;
    const nBins = (spec.fftSize >>> 1) + 1;

    const maskedMagnitudes: Float32Array[] = new Array(nFrames);
    const energyRetained = new Float32Array(nFrames);

    for (let t = 0; t < nFrames; t++) {
        const time = spec.times[t] ?? 0;
        const srcMags = spec.magnitudes[t];

        if (!srcMags) {
            maskedMagnitudes[t] = new Float32Array(nBins);
            energyRetained[t] = 0;
            continue;
        }

        // Compute mask for this frame
        const mask = computeBandMaskAtTime(
            band,
            time,
            spec.sampleRate,
            spec.fftSize,
            options
        );

        if (!mask) {
            // Band is inactive at this time
            maskedMagnitudes[t] = new Float32Array(nBins);
            energyRetained[t] = 0;
            continue;
        }

        // Apply mask and compute energy
        const masked = new Float32Array(nBins);
        let originalEnergy = 0;
        let maskedEnergy = 0;

        for (let k = 0; k < nBins; k++) {
            const mag = srcMags[k] ?? 0;
            const maskedMag = mag * (mask[k] ?? 0);

            masked[k] = maskedMag;
            originalEnergy += mag * mag;
            maskedEnergy += maskedMag * maskedMag;
        }

        maskedMagnitudes[t] = masked;
        energyRetained[t] = originalEnergy > 0 ? maskedEnergy / originalEnergy : 0;
    }

    return {
        sampleRate: spec.sampleRate,
        fftSize: spec.fftSize,
        hopSize: spec.hopSize,
        times: spec.times,
        magnitudes: maskedMagnitudes,
        bandId: band.id,
        energyRetainedPerFrame: energyRetained,
    };
}

/**
 * Compute the energy of a magnitude spectrum.
 *
 * @param magnitudes - Magnitude spectrum (one frame)
 * @returns Sum of squared magnitudes
 */
export function computeFrameEnergy(magnitudes: Float32Array): number {
    let energy = 0;
    for (let k = 0; k < magnitudes.length; k++) {
        const mag = magnitudes[k] ?? 0;
        energy += mag * mag;
    }
    return energy;
}

/**
 * Compute the amplitude (sum of magnitudes) of a frame.
 *
 * @param magnitudes - Magnitude spectrum (one frame)
 * @returns Sum of magnitudes
 */
export function computeFrameAmplitude(magnitudes: Float32Array): number {
    let sum = 0;
    for (let k = 0; k < magnitudes.length; k++) {
        sum += magnitudes[k] ?? 0;
    }
    return sum;
}
