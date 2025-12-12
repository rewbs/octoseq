export type MirBackend = "cpu" | "gpu";

export type MirRunTimings = {
    totalMs: number;
    cpuMs?: number;
    gpuMs?: number;
};

export type MirRunMeta = {
    backend: MirBackend;
    usedGpu: boolean;
    timings: MirRunTimings;
};

export type Mir1DResult = {
    kind: "1d";
    times: Float32Array;
    values: Float32Array;
    meta: MirRunMeta;
};

export type Mir2DResult = {
    kind: "2d";
    times: Float32Array;
    data: Float32Array[];
    meta: MirRunMeta;
};

export type MirEvent = {
    time: number;
    strength: number;
    index: number;
};

export type MirEventsResult = {
    kind: "events";
    times: Float32Array;
    events: MirEvent[];
    meta: MirRunMeta;
};

export type MirResult = Mir1DResult | Mir2DResult | MirEventsResult;

// (moved above)

export type MirFunctionId =
    | "spectralCentroid"
    | "spectralFlux"
    | "melSpectrogram"
    | "onsetEnvelope"
    | "onsetPeaks"
    | "hpssHarmonic"
    | "hpssPercussive"
    | "mfcc"
    | "mfccDelta"
    | "mfccDeltaDelta";

export type MirRunRequest = {
    fn: MirFunctionId;
    spectrogram?: {
        fftSize: number;
        hopSize: number;
        window: "hann";
    };
    mel?: {
        nMels: number;
        fMin?: number;
        fMax?: number;
    };
    backend?: MirBackend;

    // Optional per-run config. Kept explicit (not a dynamic schema).
    onset?: {
        smoothMs?: number;
        diffMethod?: "rectified" | "abs";
        useLog?: boolean;
    };
    peakPick?: {
        minIntervalSec?: number;
        threshold?: number;
        adaptiveFactor?: number;
    };
    hpss?: {
        timeMedian?: number;
        freqMedian?: number;
    };
    mfcc?: {
        nCoeffs?: number;
    };
};

export type MirAudioPayload = {
    sampleRate: number;
    mono: Float32Array;
};
