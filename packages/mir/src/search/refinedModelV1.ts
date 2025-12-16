import type { MirFeatureVectorLayoutV1 } from "./featureVectorV1";

export type MirRefinedModelKindV1 = "baseline" | "prototype" | "logistic";

export type MirRefinedModelExplainV1 = {
    kind: MirRefinedModelKindV1;
    positives: number;
    negatives: number;

    /** L2 norms per feature group (useful as a cheap, stable explainability hook). */
    weightL2?: {
        mel: number;
        melForeground: number;
        melContrast?: number;
        onset: number;
        onsetForeground: number;
        onsetContrast?: number;
        mfcc?: number;
        mfccForeground?: number;
        mfccContrast?: number;
    };

    /** Training diagnostics (only for logistic). */
    training?: {
        iterations: number;
        finalLoss: number;
    };
};

export type MirLogisticModelV1 = {
    kind: "logistic";
    w: Float32Array;
    b: number;
    explain: MirRefinedModelExplainV1;
};

export type MirPrototypeModelV1 = {
    kind: "prototype";
    prototype: Float32Array;
    explain: MirRefinedModelExplainV1;
};

export type MirBaselineModelV1 = {
    kind: "baseline";
    explain: MirRefinedModelExplainV1;
};

export type MirRefinedModelV1 = MirBaselineModelV1 | MirPrototypeModelV1 | MirLogisticModelV1;

export type MirLogitContributionsByGroupV1 = {
    logit: number;
    bias: number;
    mel: number;
    melForeground: number;
    melContrast?: number;
    onset: number;
    onsetForeground: number;
    onsetContrast?: number;
    mfcc?: number;
    mfccForeground?: number;
    mfccContrast?: number;
};

function clamp01(x: number): number {
    return x <= 0 ? 0 : x >= 1 ? 1 : x;
}

function sigmoid(x: number): number {
    // Prevent overflow in exp(); ±20 already saturates for our purposes.
    const z = x > 20 ? 20 : x < -20 ? -20 : x;
    return 1 / (1 + Math.exp(-z));
}

function dot(a: Float32Array, b: Float32Array): number {
    const n = Math.min(a.length, b.length);
    let s = 0;
    for (let i = 0; i < n; i++) s += (a[i] ?? 0) * (b[i] ?? 0);
    return s;
}

function sliceDot(w: Float32Array, x: Float32Array, offset: number, length: number): number {
    const end = Math.min(w.length, x.length, offset + length);
    let sum = 0;
    for (let i = offset; i < end; i++) sum += (w[i] ?? 0) * (x[i] ?? 0);
    return sum;
}

export function logitContributionsByGroupV1(
    w: Float32Array,
    b: number,
    x: Float32Array,
    layout: MirFeatureVectorLayoutV1
): MirLogitContributionsByGroupV1 {
    const melForeground =
        sliceDot(w, x, layout.melMeanFg.offset, layout.melMeanFg.length) +
        sliceDot(w, x, layout.melVarianceFg.offset, layout.melVarianceFg.length);
    const melContrast = layout.melContrast ? sliceDot(w, x, layout.melContrast.offset, layout.melContrast.length) : 0;
    const onsetForeground = sliceDot(w, x, layout.onsetFg.offset, layout.onsetFg.length);
    const onsetContrast = layout.onsetContrast ? sliceDot(w, x, layout.onsetContrast.offset, layout.onsetContrast.length) : 0;

    const mfccForeground =
        layout.mfccMeanFg && layout.mfccVarianceFg
            ? sliceDot(w, x, layout.mfccMeanFg.offset, layout.mfccMeanFg.length) +
              sliceDot(w, x, layout.mfccVarianceFg.offset, layout.mfccVarianceFg.length)
            : 0;
    const mfccContrast =
        layout.mfccMeanContrast && layout.mfccVarianceContrast
            ? sliceDot(w, x, layout.mfccMeanContrast.offset, layout.mfccMeanContrast.length) +
              sliceDot(w, x, layout.mfccVarianceContrast.offset, layout.mfccVarianceContrast.length)
            : 0;

    const mel = melForeground + melContrast;
    const onset = onsetForeground + onsetContrast;
    const mfcc = mfccForeground + mfccContrast;

    const logit = mel + onset + mfcc + b;

    return {
        logit,
        bias: b,
        mel,
        melForeground,
        ...(layout.melContrast ? { melContrast } : {}),
        onset,
        onsetForeground,
        ...(layout.onsetContrast ? { onsetContrast } : {}),
        ...(layout.mfccMeanFg || layout.mfccMeanContrast
            ? {
                mfcc,
                mfccForeground,
                ...(layout.mfccMeanContrast ? { mfccContrast } : {}),
            }
            : {}),
    };
}

function l2Norm(v: Float32Array): number {
    let sum = 0;
    for (let i = 0; i < v.length; i++) {
        const x = v[i] ?? 0;
        sum += x * x;
    }
    return Math.sqrt(sum);
}

function cosineSimilarity01(a: Float32Array, b: Float32Array): number {
    const n = Math.min(a.length, b.length);
    let ab = 0;
    let aa = 0;
    let bb = 0;
    for (let i = 0; i < n; i++) {
        const x = a[i] ?? 0;
        const y = b[i] ?? 0;
        ab += x * y;
        aa += x * x;
        bb += y * y;
    }
    const denom = Math.sqrt(aa) * Math.sqrt(bb);
    if (denom <= 0) return 0;
    const cos = ab / denom;
    const clamped = Math.max(-1, Math.min(1, cos));
    return (clamped + 1) / 2;
}

function sliceSumSquares(w: Float32Array, offset: number, length: number): number {
    let sum = 0;
    const end = Math.min(w.length, offset + length);
    for (let i = offset; i < end; i++) {
        const x = w[i] ?? 0;
        sum += x * x;
    }
    return sum;
}

export function summariseWeightL2ByGroup(w: Float32Array, layout: MirFeatureVectorLayoutV1): MirRefinedModelExplainV1["weightL2"] {
    const melForegroundSq =
        sliceSumSquares(w, layout.melMeanFg.offset, layout.melMeanFg.length) +
        sliceSumSquares(w, layout.melVarianceFg.offset, layout.melVarianceFg.length);
    const melContrastSq = layout.melContrast ? sliceSumSquares(w, layout.melContrast.offset, layout.melContrast.length) : 0;
    const onsetForegroundSq = sliceSumSquares(w, layout.onsetFg.offset, layout.onsetFg.length);
    const onsetContrastSq = layout.onsetContrast ? sliceSumSquares(w, layout.onsetContrast.offset, layout.onsetContrast.length) : 0;

    const mfccForegroundSq =
        layout.mfccMeanFg && layout.mfccVarianceFg
            ? sliceSumSquares(w, layout.mfccMeanFg.offset, layout.mfccMeanFg.length) +
              sliceSumSquares(w, layout.mfccVarianceFg.offset, layout.mfccVarianceFg.length)
            : 0;
    const mfccContrastSq =
        layout.mfccMeanContrast && layout.mfccVarianceContrast
            ? sliceSumSquares(w, layout.mfccMeanContrast.offset, layout.mfccMeanContrast.length) +
              sliceSumSquares(w, layout.mfccVarianceContrast.offset, layout.mfccVarianceContrast.length)
            : 0;

    const mel = Math.sqrt(melForegroundSq + melContrastSq);
    const onset = Math.sqrt(onsetForegroundSq + onsetContrastSq);
    const mfcc = mfccForegroundSq + mfccContrastSq > 0 ? Math.sqrt(mfccForegroundSq + mfccContrastSq) : undefined;

    return {
        mel,
        melForeground: Math.sqrt(melForegroundSq),
        ...(melContrastSq > 0 ? { melContrast: Math.sqrt(melContrastSq) } : {}),
        onset,
        onsetForeground: Math.sqrt(onsetForegroundSq),
        ...(onsetContrastSq > 0 ? { onsetContrast: Math.sqrt(onsetContrastSq) } : {}),
        ...(mfcc != null
            ? {
                mfcc,
                mfccForeground: Math.sqrt(mfccForegroundSq),
                ...(mfccContrastSq > 0 ? { mfccContrast: Math.sqrt(mfccContrastSq) } : {}),
            }
            : {}),
    };
}

export function trainLogisticModelV1(params: {
    positives: Float32Array[];
    negatives: Float32Array[];
    layout: MirFeatureVectorLayoutV1;
    options?: { iterations?: number; learningRate?: number; l2?: number };
}): MirLogisticModelV1 {
    const pos = params.positives;
    const neg = params.negatives;
    const dim = params.layout.dim;

    // Small, deterministic batch GD: fast enough for < 50 samples and a few hundred dims.
    const iterations = Math.max(1, params.options?.iterations ?? 80);
    const learningRate = Math.max(1e-4, params.options?.learningRate ?? 0.15);
    const l2 = Math.max(0, params.options?.l2 ?? 0.01);

    const w = new Float32Array(dim);
    let b = 0;

    const posW = pos.length > 0 ? 0.5 / pos.length : 0;
    const negW = neg.length > 0 ? 0.5 / neg.length : 0;

    let lastLoss = Infinity;
    let itersUsed = 0;

    for (let iter = 0; iter < iterations; iter++) {
        itersUsed = iter + 1;

        const gradW = new Float32Array(dim);
        let gradB = 0;
        let loss = 0;

        const accumulate = (x: Float32Array, y: 0 | 1, weight: number) => {
            const s = dot(w, x) + b;
            const p = sigmoid(s);
            const err = p - y; // dL/ds for logistic loss

            gradB += weight * err;
            for (let j = 0; j < dim; j++) gradW[j] = (gradW[j] ?? 0) + weight * err * (x[j] ?? 0);

            // Weighted cross-entropy loss
            const pSafe = Math.min(1 - 1e-9, Math.max(1e-9, p));
            loss += weight * (y ? -Math.log(pSafe) : -Math.log(1 - pSafe));
        };

        for (const x of pos) accumulate(x, 1, posW);
        for (const x of neg) accumulate(x, 0, negW);

        // L2 regularisation (do not regularise bias).
        if (l2 > 0) {
            for (let j = 0; j < dim; j++) {
                gradW[j] = (gradW[j] ?? 0) + l2 * (w[j] ?? 0);
            }
            loss += (l2 * (l2Norm(w) ** 2)) / 2;
        }

        // Basic learning-rate decay helps stability on small datasets.
        const lr = learningRate / (1 + iter * 0.01);
        for (let j = 0; j < dim; j++) w[j] = (w[j] ?? 0) - lr * (gradW[j] ?? 0);
        b -= lr * gradB;

        if (Math.abs(lastLoss - loss) < 1e-6) break;
        lastLoss = loss;
    }

    return {
        kind: "logistic",
        w,
        b,
        explain: {
            kind: "logistic",
            positives: pos.length,
            negatives: neg.length,
            weightL2: summariseWeightL2ByGroup(w, params.layout),
            training: { iterations: itersUsed, finalLoss: Number.isFinite(lastLoss) ? lastLoss : 0 },
        },
    };
}

export function buildPrototypeModelV1(params: {
    positives: Float32Array[];
    layout: MirFeatureVectorLayoutV1;
}): MirPrototypeModelV1 {
    const dim = params.layout.dim;
    const proto = new Float32Array(dim);

    const n = Math.max(1, params.positives.length);
    for (const x of params.positives) {
        for (let j = 0; j < dim; j++) proto[j] = (proto[j] ?? 0) + (x[j] ?? 0) / n;
    }

    return {
        kind: "prototype",
        prototype: proto,
        explain: {
            kind: "prototype",
            positives: params.positives.length,
            negatives: 0,
        },
    };
}

export function scoreWithModelV1(model: MirRefinedModelV1, x: Float32Array): number {
    if (model.kind === "baseline") return 0;
    if (model.kind === "prototype") return clamp01(cosineSimilarity01(model.prototype, x));
    // logistic
    return clamp01(sigmoid(dot(model.w, x) + model.b));
}
