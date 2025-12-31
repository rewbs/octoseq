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

// ----------------------------
// Frequency Bands (F1)
// ----------------------------

/**
 * Time scope for a frequency band.
 * - "global": Band applies to entire track
 * - "sectioned": Band applies only to explicit start/end times
 */
export type FrequencyBandTimeScope =
    | { kind: "global" }
    | { kind: "sectioned"; startTime: number; endTime: number };

/**
 * A single time segment of a piecewise-linear frequency range.
 *
 * Segments define how the band's frequency boundaries vary over time.
 * Between segment boundaries, linear interpolation is used.
 *
 * Invariants:
 * - lowHzStart < highHzStart and lowHzEnd < highHzEnd
 * - All frequency values >= 0
 * - startTime < endTime
 * - Segments don't overlap in time (within a band)
 * - For sectioned bands, segments must fully cover the time scope
 */
export type FrequencySegment = {
    /** Start time of this segment in seconds (inclusive). */
    startTime: number;
    /** End time of this segment in seconds (exclusive). */
    endTime: number;
    /** Lower frequency bound in Hz at segment start. */
    lowHzStart: number;
    /** Upper frequency bound in Hz at segment start. */
    highHzStart: number;
    /** Lower frequency bound in Hz at segment end. */
    lowHzEnd: number;
    /** Upper frequency bound in Hz at segment end. */
    highHzEnd: number;
};

/**
 * Provenance metadata for a frequency band.
 * Tracks how the band was created for audit and debugging.
 */
export type FrequencyBandProvenance = {
    /** How this band was created. */
    source: "manual" | "imported" | "preset";
    /** ISO timestamp when the band was created. */
    createdAt: string;
    /** Optional preset name if source is "preset". */
    presetName?: string;
};

/**
 * A frequency band definition.
 *
 * Bands define semantic frequency regions for band-isolated analysis
 * (e.g., bass, mids, highs, or "kick-like", "snare-like").
 *
 * Bands can have constant or time-varying frequency boundaries via
 * the piecewise-linear frequencyShape.
 *
 * Bands are immutable unless explicitly edited by the user.
 */
export type FrequencyBand = {
    /** Unique identifier for this band. */
    id: string;
    /** Human-readable label (editable). */
    label: string;
    /** Whether the band is currently active for processing. */
    enabled: boolean;
    /** Time scope for this band. */
    timeScope: FrequencyBandTimeScope;
    /** Piecewise-linear frequency shape over time. */
    frequencyShape: FrequencySegment[];
    /** Stable sort order (not insertion order). */
    sortOrder: number;
    /** Provenance metadata. */
    provenance: FrequencyBandProvenance;
};

/**
 * The authoritative frequency band structure for a track.
 *
 * Once authored, this becomes the source of truth for frequency bands.
 * Band-scoped MIR passes will rely on this structure.
 *
 * Design constraints:
 * - Bands are explicitly authored, not inferred
 * - Bands can overlap in frequency (intentional for semantic regions)
 * - Each band's frequencyShape segments are non-overlapping and ordered
 * - Bands are sorted by sortOrder for stable ordering
 */
export type FrequencyBandStructure = {
    /** Schema version for future migrations. */
    version: 1;
    /** Ordered list of frequency bands (by sortOrder). */
    bands: FrequencyBand[];
    /** ISO timestamp when the structure was created. */
    createdAt: string;
    /** ISO timestamp when the structure was last modified. */
    modifiedAt: string;
};

/**
 * Computed frequency bounds at a given time.
 * Result of querying a band at a specific time point.
 */
export type FrequencyBoundsAtTime = {
    /** The band ID this belongs to. */
    bandId: string;
    /** Lower frequency in Hz at this time. */
    lowHz: number;
    /** Upper frequency in Hz at this time. */
    highHz: number;
    /** Whether the band is enabled. */
    enabled: boolean;
};

/**
 * A keyframe for UI display and editing.
 *
 * Keyframes are a UI abstraction over the segment model.
 * Each segment boundary (start or end) can be represented as a keyframe.
 * This makes it easier to display and edit time-varying frequency bands.
 */
export type FrequencyKeyframe = {
    /** Time in seconds. */
    time: number;
    /** Lower frequency bound in Hz at this time. */
    lowHz: number;
    /** Upper frequency bound in Hz at this time. */
    highHz: number;
    /** Index of the segment this keyframe belongs to. */
    segmentIndex: number;
    /** Whether this is the start or end of the segment. */
    edge: "start" | "end";
};

// ----------------------------
// Band-Scoped MIR (F3)
// ----------------------------

/**
 * Band MIR function identifiers (STFT-based).
 */
export type BandMirFunctionId =
    | "bandAmplitudeEnvelope"
    | "bandOnsetStrength"
    | "bandSpectralFlux"
    | "bandSpectralCentroid";

/**
 * Band CQT function identifiers (CQT-based).
 */
export type BandCqtFunctionId =
    | "bandCqtHarmonicEnergy"
    | "bandCqtBassPitchMotion"
    | "bandCqtTonalStability";

/**
 * Band event function identifiers (derived from 1D signals).
 */
export type BandEventFunctionId =
    | "bandOnsetPeaks"
    | "bandBeatCandidates";

/**
 * Diagnostics for band MIR computation.
 * Provides information about energy retention and potential issues.
 */
export type BandMirDiagnostics = {
    /** Average energy retention across all frames (0-1). */
    meanEnergyRetained: number;
    /** Number of frames with < 1% energy (weak band). */
    weakFrameCount: number;
    /** Number of frames with 0 energy (empty band). */
    emptyFrameCount: number;
    /** Total frames processed. */
    totalFrames: number;
    /** Warning messages (informational, not blocking). */
    warnings: string[];
};

/**
 * Result of a band-scoped MIR computation (STFT-based).
 */
export type BandMir1DResult = {
    kind: "bandMir1d";
    /** ID of the band this result is for. */
    bandId: string;
    /** Label of the band (for display). */
    bandLabel: string;
    /** The MIR function that produced this result. */
    fn: BandMirFunctionId;
    /** Frame times aligned to spectrogram timebase. */
    times: Float32Array;
    /** Signal values per frame. */
    values: Float32Array;
    /** Execution metadata. */
    meta: MirRunMeta;
    /** Diagnostics about energy retention and potential issues. */
    diagnostics: BandMirDiagnostics;
};

/**
 * Result of a band-scoped CQT computation.
 */
export type BandCqt1DResult = {
    kind: "bandCqt1d";
    /** ID of the band this result is for. */
    bandId: string;
    /** Label of the band (for display). */
    bandLabel: string;
    /** The CQT function that produced this result. */
    fn: BandCqtFunctionId;
    /** Frame times aligned to CQT timebase. */
    times: Float32Array;
    /** Signal values per frame. */
    values: Float32Array;
    /** Execution metadata. */
    meta: MirRunMeta;
    /** Diagnostics about energy retention and potential issues. */
    diagnostics: BandMirDiagnostics;
};

/**
 * A band event (onset peak or beat candidate within a band).
 */
export type BandMirEvent = {
    /** Time in seconds. */
    time: number;
    /** Relative weight/strength (0-1 normalized). */
    weight: number;
    /** Optional beat position if beat grid exists. */
    beatPosition?: number;
    /** Optional beat phase if beat grid exists. */
    beatPhase?: number;
};

/**
 * Diagnostics for band event extraction.
 */
export type BandEventDiagnostics = {
    /** Total number of events extracted. */
    eventCount: number;
    /** Events per second (density). */
    eventsPerSecond: number;
    /** Warning messages (e.g., too sparse or too dense). */
    warnings: string[];
};

/**
 * Result of band event extraction.
 */
export type BandEventsResult = {
    kind: "bandEvents";
    /** ID of the band this result is for. */
    bandId: string;
    /** Label of the band (for display). */
    bandLabel: string;
    /** The event function that produced this result. */
    fn: BandEventFunctionId;
    /** Extracted events. */
    events: BandMirEvent[];
    /** Source signal used for extraction (for debugging). */
    sourceSignal?: {
        fn: BandMirFunctionId;
        times: Float32Array;
        values: Float32Array;
    };
    /** Execution metadata. */
    meta: MirRunMeta;
    /** Diagnostics about extraction quality. */
    diagnostics: BandEventDiagnostics;
};

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
    | "mfccDeltaDelta"
    // CQT-derived signals (F5)
    | "cqtHarmonicEnergy"
    | "cqtBassPitchMotion"
    | "cqtTonalStability";

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

    // CQT configuration (F5)
    cqt?: {
        /** Number of bins per octave. Default: 24 (quarter-tone). */
        binsPerOctave?: number;
        /** Minimum frequency in Hz. Default: 32.7 Hz (C1). */
        fMin?: number;
        /** Maximum frequency in Hz. Default: 8372 Hz (C9). */
        fMax?: number;
        /** Hop size in samples. Auto-computed if not specified. */
        hopSize?: number;
    };
};

export type MirAudioPayload = {
    sampleRate: number;
    mono: Float32Array;
};

// ----------------------------
// Constant-Q Transform (F5)
// ----------------------------

/**
 * Configuration for CQT (Constant-Q Transform) computation.
 *
 * CQT provides log-frequency resolution aligned to musical pitch ratios.
 * It is an internal spectral view, not a user-facing spectrogram.
 */
export type CqtConfig = {
    /** Number of bins per octave. Default: 24 (quarter-tone resolution). */
    binsPerOctave: number;
    /** Minimum frequency in Hz. Default: 32.7 Hz (C1). */
    fMin: number;
    /** Maximum frequency in Hz. Default: 8372 Hz (C9). */
    fMax: number;
    /** Hop size in samples. If not specified, auto-computed based on resolution. */
    hopSize?: number;
};

/**
 * Result of CQT computation.
 *
 * CQT produces a time-frequency representation with logarithmic frequency spacing.
 * Each bin corresponds to a specific frequency based on the musical pitch scale.
 */
export type CqtSpectrogram = {
    /** Sample rate of source audio. */
    sampleRate: number;
    /** Configuration used for this computation. */
    config: CqtConfig;
    /** Time axis (frame centers in seconds). */
    times: Float32Array;
    /** CQT magnitudes [frame][bin], log-frequency ordered from fMin to fMax. */
    magnitudes: Float32Array[];
    /** Number of octaves covered. */
    nOctaves: number;
    /** Number of bins per octave. */
    binsPerOctave: number;
    /** Center frequency of each bin in Hz. */
    binFrequencies: Float32Array;
};

/**
 * Identifier for CQT-derived 1D signals.
 */
export type CqtSignalId = "harmonicEnergy" | "bassPitchMotion" | "tonalStability";

/**
 * Result of a CQT-derived 1D signal computation.
 */
export type CqtSignalResult = {
    kind: "cqt1d";
    signalId: CqtSignalId;
    times: Float32Array;
    values: Float32Array;
    meta: MirRunMeta;
};

// ----------------------------
// Band Proposals (F5)
// ----------------------------

/**
 * Source algorithm that generated a band proposal.
 */
export type BandProposalSource =
    /** Persistent spectral peak detected across time. */
    | "spectral_peak"
    /** Frequency region with distinct onset pattern. */
    | "onset_band"
    /** Concentrated energy cluster in frequency region. */
    | "energy_cluster"
    /** Detected harmonic series structure. */
    | "harmonic_structure"
    /** High harmonic energy from CQT analysis. */
    | "cqt_harmonic"
    /** Significant bass pitch motion from CQT analysis. */
    | "cqt_bass_motion"
    /** Low tonal stability region from CQT analysis. */
    | "cqt_tonal_instability";

/**
 * A band proposal is an ephemeral suggestion for a frequency band.
 *
 * Proposals are generated by automated analysis and presented to the user
 * for review. They are never auto-persisted - explicit user action
 * (promotion) is required to convert them to real FrequencyBands.
 *
 * Design principle: Automation is advisory, not authoritative.
 */
export type BandProposal = {
    /** Unique ephemeral identifier for this proposal. */
    id: string;
    /** Proposed frequency band (same structure as FrequencyBand). */
    band: FrequencyBand;
    /** Salience score [0, 1] indicating how "interesting" this band is. */
    salience: number;
    /** Human-readable reason for this proposal. */
    reason: string;
    /** Algorithm that generated this proposal. */
    source: BandProposalSource;
    /** ISO timestamp when this proposal was generated. */
    generatedAt: string;
};

/**
 * Configuration for band proposal generation.
 */
export type BandProposalConfig = {
    /** Maximum number of proposals to generate. Default: 8. */
    maxProposals?: number;
    /** Minimum salience threshold for proposals [0, 1]. Default: 0.3. */
    minSalience?: number;
    /** Minimum separation in octaves between proposals. Default: 0.5. */
    minSeparationOctaves?: number;
    /** Minimum band width (Hz). Prevents implausibly narrow proposals. Default: 20. */
    minBandwidthHz?: number;
    /** Time window for analysis in seconds (0 = full track). Default: 0. */
    analysisWindow?: number;
};

/**
 * Result of band proposal generation.
 */
export type BandProposalResult = {
    kind: "bandProposals";
    proposals: BandProposal[];
    meta: MirRunMeta;
};
