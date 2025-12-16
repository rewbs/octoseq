import type { MirFingerprintV1 } from "./fingerprintV1";

export type MirFeatureVectorSlice = {
    offset: number;
    length: number;
};

export type MirFeatureVectorLayoutV1 = {
    dim: number;

    // Foreground (query-length) window features
    melMeanFg: MirFeatureVectorSlice;
    melVarianceFg: MirFeatureVectorSlice;
    onsetFg: MirFeatureVectorSlice;
    mfccMeanFg?: MirFeatureVectorSlice;
    mfccVarianceFg?: MirFeatureVectorSlice;

    // Local contrast features (foreground - background-without-foreground)
    melContrast?: MirFeatureVectorSlice;
    onsetContrast?: MirFeatureVectorSlice;
    mfccMeanContrast?: MirFeatureVectorSlice;
    mfccVarianceContrast?: MirFeatureVectorSlice;
};

export function makeFeatureVectorLayoutV1(params: {
    melDim: number;
    mfccDim?: number;
    includeContrast?: boolean;
}): MirFeatureVectorLayoutV1 {
    const melDim = Math.max(0, params.melDim);
    const mfccDim = Math.max(0, params.mfccDim ?? 0);
    const includeContrast = params.includeContrast ?? true;

    let offset = 0;
    const melMeanFg: MirFeatureVectorSlice = { offset, length: melDim };
    offset += melDim;

    const melVarianceFg: MirFeatureVectorSlice = { offset, length: melDim };
    offset += melDim;

    const onsetFg: MirFeatureVectorSlice = { offset, length: 3 };
    offset += 3;

    const layout: MirFeatureVectorLayoutV1 = { dim: 0, melMeanFg, melVarianceFg, onsetFg };

    if (mfccDim > 0) {
        layout.mfccMeanFg = { offset, length: mfccDim };
        layout.mfccVarianceFg = { offset: offset + mfccDim, length: mfccDim };
        offset += mfccDim * 2;
    }

    if (includeContrast) {
        layout.melContrast = { offset, length: melDim };
        offset += melDim;

        layout.onsetContrast = { offset, length: 3 };
        offset += 3;

        if (mfccDim > 0) {
            layout.mfccMeanContrast = { offset, length: mfccDim };
            layout.mfccVarianceContrast = { offset: offset + mfccDim, length: mfccDim };
            offset += mfccDim * 2;
        }
    }

    layout.dim = offset;

    return layout;
}

export function writeFingerprintToFeatureVectorRawV1(
    fp: MirFingerprintV1,
    out: Float32Array,
    offset: number,
    layout: MirFeatureVectorLayoutV1
): void {
    // Mel mean
    for (let i = 0; i < layout.melMeanFg.length; i++) {
        out[offset + layout.melMeanFg.offset + i] = fp.mel.mean[i] ?? 0;
    }
    // Mel variance
    for (let i = 0; i < layout.melVarianceFg.length; i++) {
        out[offset + layout.melVarianceFg.offset + i] = fp.mel.variance[i] ?? 0;
    }
    // Onset stats
    out[offset + layout.onsetFg.offset + 0] = fp.onset.mean;
    out[offset + layout.onsetFg.offset + 1] = fp.onset.max;
    out[offset + layout.onsetFg.offset + 2] = fp.onset.peakDensityHz;

    // Optional MFCC stats
    if (layout.mfccMeanFg && layout.mfccVarianceFg) {
        const mean = fp.mfcc?.mean;
        const variance = fp.mfcc?.variance;
        for (let i = 0; i < layout.mfccMeanFg.length; i++) {
            out[offset + layout.mfccMeanFg.offset + i] = mean?.[i] ?? 0;
        }
        for (let i = 0; i < layout.mfccVarianceFg.length; i++) {
            out[offset + layout.mfccVarianceFg.offset + i] = variance?.[i] ?? 0;
        }
    }

    // Fingerprints do not include local contrast; ensure contrast blocks are deterministic zeros.
    if (layout.melContrast) {
        out.fill(0, offset + layout.melContrast.offset, offset + layout.melContrast.offset + layout.melContrast.length);
    }
    if (layout.onsetContrast) {
        out.fill(0, offset + layout.onsetContrast.offset, offset + layout.onsetContrast.offset + layout.onsetContrast.length);
    }
    if (layout.mfccMeanContrast) {
        out.fill(
            0,
            offset + layout.mfccMeanContrast.offset,
            offset + layout.mfccMeanContrast.offset + layout.mfccMeanContrast.length
        );
    }
    if (layout.mfccVarianceContrast) {
        out.fill(
            0,
            offset + layout.mfccVarianceContrast.offset,
            offset + layout.mfccVarianceContrast.offset + layout.mfccVarianceContrast.length
        );
    }
}
