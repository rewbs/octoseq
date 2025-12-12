import type { MelSpectrogram } from "./mel";

export type MfccOptions = {
    nCoeffs?: number;
};

export type MfccResult = {
    times: Float32Array;
    coeffs: Float32Array[]; // [frame][coeff]
};

function assertPositiveInt(name: string, v: number): void {
    if (!Number.isFinite(v) || v <= 0 || (v | 0) !== v) {
        throw new Error(`@octoseq/mir: ${name} must be a positive integer`);
    }
}

function buildDctMatrix(nCoeffs: number, nMels: number): Float32Array {
    // DCT-II (ortho-ish scaling). Many MFCC refs use a scaled DCT; for visualisation and
    // relative features this is sufficient and stable.
    // Shape: [nCoeffs][nMels]
    const out = new Float32Array(nCoeffs * nMels);

    const scale0 = Math.sqrt(1 / nMels);
    const scale = Math.sqrt(2 / nMels);

    for (let i = 0; i < nCoeffs; i++) {
        for (let j = 0; j < nMels; j++) {
            const c = Math.cos((Math.PI / nMels) * (j + 0.5) * i);
            out[i * nMels + j] = (i === 0 ? scale0 : scale) * c;
        }
    }

    return out;
}

export function mfcc(mel: MelSpectrogram, options: MfccOptions = {}): MfccResult {
    const nFrames = mel.times.length;
    const nMels = mel.melBands[0]?.length ?? 0;

    const nCoeffs = options.nCoeffs ?? 13;
    assertPositiveInt("options.nCoeffs", nCoeffs);
    if (nMels <= 0) {
        return { times: mel.times, coeffs: new Array(nFrames).fill(0).map(() => new Float32Array(nCoeffs)) };
    }

    const dct = buildDctMatrix(nCoeffs, nMels);

    const out: Float32Array[] = new Array(nFrames);
    for (let t = 0; t < nFrames; t++) {
        const x = mel.melBands[t] ?? new Float32Array(nMels);

        // melSpectrogram already returns log10 energies. For MFCC we typically use ln energies.
        // We keep it simple here: treat the existing log-scaled values as log-energy features.
        const c = new Float32Array(nCoeffs);

        for (let i = 0; i < nCoeffs; i++) {
            let sum = 0;
            const rowOff = i * nMels;
            for (let j = 0; j < nMels; j++) {
                sum += (dct[rowOff + j] ?? 0) * (x[j] ?? 0);
            }
            c[i] = sum;
        }

        out[t] = c;
    }

    return { times: mel.times, coeffs: out };
}

export type DeltaOptions = {
    /** Regression window size N (frames). Standard choice is 2. */
    window?: number;
};

export type Features2D = {
    times: Float32Array;
    values: Float32Array[]; // [frame][feature]
};

export function delta(features: Features2D, options: DeltaOptions = {}): Features2D {
    const N = options.window ?? 2;
    assertPositiveInt("options.window", N);

    const nFrames = features.times.length;
    const nFeat = features.values[0]?.length ?? 0;

    const out: Float32Array[] = new Array(nFrames);

    // denom = 2 * sum_{n=1..N} n^2
    let denom = 0;
    for (let n = 1; n <= N; n++) denom += n * n;
    denom *= 2;

    for (let t = 0; t < nFrames; t++) {
        const d = new Float32Array(nFeat);

        for (let f = 0; f < nFeat; f++) {
            let num = 0;
            for (let n = 1; n <= N; n++) {
                const tPlus = Math.min(nFrames - 1, t + n);
                const tMinus = Math.max(0, t - n);
                const a = features.values[tPlus]?.[f] ?? 0;
                const b = features.values[tMinus]?.[f] ?? 0;
                num += n * (a - b);
            }
            d[f] = denom > 0 ? num / denom : 0;
        }

        out[t] = d;
    }

    return { times: features.times, values: out };
}

export function deltaDelta(features: Features2D, options: DeltaOptions = {}): Features2D {
    return delta(delta(features, options), options);
}
