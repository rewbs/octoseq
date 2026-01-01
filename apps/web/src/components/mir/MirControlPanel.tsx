/**
 * MIR function identifiers for analysis operations.
 */
export type MirFunctionId =
    | "amplitudeEnvelope"
    | "spectralCentroid"
    | "spectralFlux"
    | "melSpectrogram"
    | "onsetEnvelope"
    | "onsetPeaks"
    | "beatCandidates"
    | "tempoHypotheses"
    | "hpssHarmonic"
    | "hpssPercussive"
    | "mfcc"
    | "mfccDelta"
    | "mfccDeltaDelta"
    | "cqtHarmonicEnergy"
    | "cqtBassPitchMotion"
    | "cqtTonalStability";
