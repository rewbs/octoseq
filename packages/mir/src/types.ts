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

/**
 * A beat candidate represents a plausible beat-like moment in the audio.
 *
 * These are sparse events (timestamps) that may or may not correspond to
 * actual beats. They are not tempo-aligned and do not imply any BPM value.
 *
 * Beat candidates are intended to be:
 * - Dense enough to include most true beats
 * - Sparse enough to be computationally tractable
 * - Inspectable in the UI for debugging
 *
 * Future milestones will cluster, align, and refine these candidates.
 */
export type BeatCandidate = {
    /** Time in seconds from track start. */
    time: number;
    /** Relative salience/confidence (0-1 normalized). Higher = more likely to be a beat. */
    strength: number;
    /** Source of this candidate (for debugging/inspection). */
    source: BeatCandidateSource;
};

export type BeatCandidateSource =
    | "onset_peak"      // Derived from onset envelope peaks
    | "flux_peak"       // Derived from spectral flux peaks
    | "combined";       // Derived from combined salience signal

export type BeatCandidatesResult = {
    kind: "beatCandidates";
    /** Frame times from the underlying analysis (for alignment). */
    times: Float32Array;
    /** The beat candidate events. */
    candidates: BeatCandidate[];
    /** Optional: the salience signal used for peak picking (for debugging). */
    salience?: {
        times: Float32Array;
        values: Float32Array;
    };
    meta: MirRunMeta;
};

/**
 * A tempo hypothesis represents a plausible BPM with confidence score.
 *
 * Hypotheses are derived from inter-onset intervals of beat candidates.
 * They are grouped into harmonic families (e.g., 60, 120, 180 BPM) but
 * not collapsed - each BPM is preserved as a separate hypothesis.
 */
export type TempoHypothesis = {
    /** Deterministic identifier for this hypothesis (e.g., "hyp-0"). */
    id: string;
    /** Tempo in beats per minute (0.1 BPM precision). */
    bpm: number;
    /** Confidence score normalized to [0, 1]. Higher = more likely. */
    confidence: number;
    /** Evidence metadata for debugging/inspection. */
    evidence: TempoHypothesisEvidence;
    /** Harmonic family ID - hypotheses in the same family are harmonically related. */
    familyId: string;
    /** Harmonic relationship to the family root (1.0 = root, 2.0 = double, 0.5 = half, etc.). */
    harmonicRatio: number;
};

export type TempoHypothesisEvidence = {
    /** Number of IOIs supporting this tempo. */
    supportingIntervalCount: number;
    /** Sum of weighted contributions (if strength-weighting enabled). */
    weightedSupport: number;
    /** Peak height in the histogram. */
    peakHeight: number;
    /** Histogram bin range [minBpm, maxBpm]. */
    binRange: [number, number];
};

export type TempoHypothesesResult = {
    kind: "tempoHypotheses";
    /** Frame times from underlying analysis (for alignment). */
    times: Float32Array;
    /** Ordered list of tempo hypotheses (by confidence descending). */
    hypotheses: TempoHypothesis[];
    /** The number of beat candidates used as input. */
    inputCandidateCount: number;
    /** Histogram data for debugging/visualization. */
    histogram?: {
        bpmBins: Float32Array;
        counts: Float32Array;
    };
    meta: MirRunMeta;
};

export type MirResult = Mir1DResult | Mir2DResult | MirEventsResult | BeatCandidatesResult | TempoHypothesesResult;

// ----------------------------
// Beat Grid Phase Alignment (B3)
// ----------------------------

/**
 * A beat grid represents phase-aligned beats for a given BPM.
 *
 * Given a BPM and phase offset, the beat times are:
 *   beat[n] = phaseOffset + userNudge + n * (60 / bpm)
 *
 * Beat grids are hypotheses that can be confirmed or adjusted by the user.
 */
export type BeatGrid = {
    /** Unique identifier for this grid (derived from source hypothesis + phase). */
    id: string;
    /** BPM of the grid (from the source tempo hypothesis). */
    bpm: number;
    /** Phase offset in seconds from track start. First beat occurs at this time. */
    phaseOffset: number;
    /** Confidence score [0, 1] for this phase alignment. */
    confidence: number;
    /** The tempo hypothesis this grid was derived from. */
    sourceHypothesisId: string;
    /** Whether the user has locked this grid (prevents auto-updates). */
    isLocked: boolean;
    /** User adjustment to phase offset in seconds (additive). */
    userNudge: number;
};

/**
 * A phase hypothesis represents a candidate phase offset for a given BPM.
 * Used during phase alignment scoring.
 */
export type PhaseHypothesis = {
    /** Index within the phase candidate list (0 to N-1). */
    index: number;
    /** Phase offset in seconds. */
    phaseOffset: number;
    /** Alignment score (sum of weighted matches, normalized). */
    score: number;
    /** Number of beat candidates matched within tolerance. */
    matchCount: number;
    /** Average offset error of matched candidates in seconds. */
    avgOffsetError: number;
};

/**
 * Configuration for beat grid phase alignment.
 */
export type PhaseAlignmentConfig = {
    /** Number of phase candidates to generate per beat period. Default: 16. */
    phaseResolution?: number;
    /** Tolerance in seconds for matching candidates to grid lines. Default: 0.05 (50ms). */
    matchTolerance?: number;
    /** Number of top phase hypotheses to keep. Default: 3. */
    topK?: number;
    /** Weight for systematic offset penalty (0-1). Default: 0.2. */
    offsetPenaltyWeight?: number;
};

// ----------------------------
// Musical Time (B4)
// ----------------------------

/**
 * Provenance metadata for a musical time segment.
 * Tracks how the segment was created for audit and debugging.
 */
export type MusicalTimeProvenance = {
    /** How this segment was created. */
    source: "promoted_from_hypothesis" | "manual_entry" | "imported";
    /** Reference to the original TempoHypothesis (if promoted). */
    sourceHypothesisId?: string;
    /** ISO timestamp when the segment was created/promoted. */
    promotedAt: string;
    /** User nudge value preserved from promotion (for provenance). */
    userNudge?: number;
};

/**
 * A single segment of musical time with explicit boundaries.
 *
 * Beat times within a segment are derivable, not stored:
 *   beat[n] = phaseOffset + n * (60 / bpm)
 *
 * Segments are explicit, authored, and stable once committed.
 * They never change unless explicitly edited or unlocked by the user.
 */
export type MusicalTimeSegment = {
    /** Unique identifier for this segment. */
    id: string;
    /** Tempo in beats per minute. */
    bpm: number;
    /** Phase offset in seconds - first beat time relative to segment start. */
    phaseOffset: number;
    /** Segment start boundary in seconds (inclusive). */
    startTime: number;
    /** Segment end boundary in seconds (exclusive). */
    endTime: number;
    /** Confidence score frozen at lock time (optional, for display). */
    confidence?: number;
    /** Provenance metadata. */
    provenance: MusicalTimeProvenance;
};

/**
 * The authoritative musical time structure for a track.
 *
 * Once authored, this becomes the source of truth for musical time.
 * Rendering, scripts, and offline execution rely on this structure.
 *
 * Design constraints:
 * - Musical time is explicitly authored, not inferred silently
 * - Segments are non-overlapping and ordered by startTime
 * - Beat times are derivable from segment properties
 * - Gaps between segments are intentional (no musical time defined)
 */
export type MusicalTimeStructure = {
    /** Schema version for future migrations. */
    version: 1;
    /** Ordered list of musical time segments (by startTime ascending). */
    segments: MusicalTimeSegment[];
    /** ISO timestamp when the structure was created. */
    createdAt: string;
    /** ISO timestamp when the structure was last modified. */
    modifiedAt: string;
};

/**
 * Computed beat position at a given time.
 *
 * beat_position = beat_index + beat_phase
 *
 * This is a read-only computed value, not stored.
 */
export type BeatPosition = {
    /** The segment this position is within. */
    segmentId: string;
    /** Integer beat number from segment start (0, 1, 2, ...). */
    beatIndex: number;
    /** Phase within the current beat (0-1, exclusive). */
    beatPhase: number;
    /** Continuous beat position (beatIndex + beatPhase). */
    beatPosition: number;
    /** BPM of the containing segment. */
    bpm: number;
};

// (moved above)

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
        spectrogram?: {
            fftSize: number;
            hopSize: number;
            window: "hann";
        };
    };
    mfcc?: {
        nCoeffs?: number;
        spectrogram?: {
            fftSize: number;
            hopSize: number;
            window: "hann";
        };
    };
    beatCandidates?: {
        /** Minimum inter-candidate interval in seconds. Default: 0.1 (100ms). */
        minIntervalSec?: number;
        /** Threshold factor for peak detection. Lower = more candidates. Default: 0.5. */
        thresholdFactor?: number;
        /** Smoothing window for salience signal in ms. Default: 50. */
        smoothMs?: number;
        /** Whether to include the salience signal in output (for debugging). */
        includeSalience?: boolean;
    };
    tempoHypotheses?: {
        /** Minimum BPM to consider. Default: 24. */
        minBpm?: number;
        /** Maximum BPM to consider. Default: 300. */
        maxBpm?: number;
        /** Histogram bin size in BPM. Default: 1.0. */
        binSizeBpm?: number;
        /** Maximum number of hypotheses to return. Default: 10. */
        maxHypotheses?: number;
        /** Minimum confidence threshold (0-1). Default: 0.05. */
        minConfidence?: number;
        /** Weight IOIs by beat candidate strength. Default: true. */
        weightByStrength?: boolean;
        /** Include histogram in output for debugging. Default: false. */
        includeHistogram?: boolean;
    };
};

export type MirAudioPayload = {
    sampleRate: number;
    mono: Float32Array;
};
