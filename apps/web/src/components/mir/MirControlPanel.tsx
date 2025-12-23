/**
 * MIR function identifiers for analysis operations.
 */
export type MirFunctionId =
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
    | "mfccDeltaDelta";
