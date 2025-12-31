/**
 * Signal type and builder entries for the API registry.
 *
 * Signals are the core abstraction for declarative computation graphs.
 * They support arithmetic, smoothing, normalization, gating, and event extraction.
 */

import type { RegistryEntry } from "../types";

export const SIGNAL_ENTRIES: RegistryEntry[] = [
  // ============================================================================
  // Signal - Core signal type
  // ============================================================================
  {
    kind: "type",
    name: "Signal",
    path: "Signal",
    description: "Declarative signal computation graph (host-evaluated).",
    properties: [
      {
        name: "smooth",
        path: "Signal.smooth",
        type: "SmoothBuilder",
        description: "Smoothing operations namespace.",
        readonly: true,
      },
      {
        name: "normalise",
        path: "Signal.normalise",
        type: "NormaliseBuilder",
        description: "Normalisation operations namespace.",
        readonly: true,
      },
      {
        name: "gate",
        path: "Signal.gate",
        type: "GateBuilder",
        description: "Gating operations namespace.",
        readonly: true,
      },
      {
        name: "pick",
        path: "Signal.pick",
        type: "PickBuilder",
        description: "Event extraction namespace.",
        readonly: true,
      },
    ],
    methods: [
      // Arithmetic
      {
        name: "add",
        path: "Signal.add",
        description: "Add another signal.",
        params: [{ name: "other", type: "Signal", description: "Signal to add." }],
        returns: "Signal",
        chainsTo: "Signal",
        overloadId: "signal",
        example: "inputs.spectralFlux.add(inputs.onsetEnvelope)",
      },
      {
        name: "add",
        path: "Signal.add",
        description: "Add a constant value.",
        params: [{ name: "value", type: "float", description: "Constant to add." }],
        returns: "Signal",
        chainsTo: "Signal",
        overloadId: "scalar",
        example: "inputs.amplitude.add(0.5)",
      },
      {
        name: "mul",
        path: "Signal.mul",
        description: "Multiply by another signal.",
        params: [{ name: "other", type: "Signal", description: "Signal to multiply by." }],
        returns: "Signal",
        chainsTo: "Signal",
        example: "inputs.amplitude.mul(inputs.onsetEnvelope)",
      },
      {
        name: "scale",
        path: "Signal.scale",
        description: "Multiply by a constant factor.",
        params: [{ name: "factor", type: "float", description: "Scale factor." }],
        returns: "Signal",
        chainsTo: "Signal",
        example: "inputs.amplitude.scale(2.0)",
      },
      {
        name: "mix",
        path: "Signal.mix",
        description: "Linear blend between this signal and another.",
        params: [
          { name: "other", type: "Signal", description: "Other signal." },
          {
            name: "weight",
            type: "float",
            description: "0.0 = this, 1.0 = other.",
            default: 0.5,
            range: { min: 0, max: 1 },
          },
        ],
        returns: "Signal",
        chainsTo: "Signal",
        example: "inputs.amplitude.mix(inputs.spectralFlux, 0.5)",
      },
      // Math
      {
        name: "clamp",
        path: "Signal.clamp",
        description: "Clamp signal to [min, max].",
        params: [
          { name: "min", type: "float", description: "Lower bound." },
          { name: "max", type: "float", description: "Upper bound." },
        ],
        returns: "Signal",
        chainsTo: "Signal",
        example: "inputs.amplitude.clamp(0.0, 1.0)",
      },
      {
        name: "floor",
        path: "Signal.floor",
        description: "Round down.",
        params: [],
        returns: "Signal",
        chainsTo: "Signal",
        example: "inputs.beatPosition.floor()",
      },
      {
        name: "ceil",
        path: "Signal.ceil",
        description: "Round up.",
        params: [],
        returns: "Signal",
        chainsTo: "Signal",
        example: "inputs.beatPosition.ceil()",
      },
      {
        name: "abs",
        path: "Signal.abs",
        description: "Absolute value.",
        params: [],
        returns: "Signal",
        chainsTo: "Signal",
        example: "inputs.diff().abs()",
      },
      {
        name: "sigmoid",
        path: "Signal.sigmoid",
        description: "Apply a logistic sigmoid curve (centered at 0.5).",
        params: [{ name: "k", type: "float", description: "Steepness (0.0 = no-op)." }],
        returns: "Signal",
        chainsTo: "Signal",
        example: "inputs.amplitude.normalise.robust().sigmoid(10.0)",
        notes: "Normalize or clamp to 0-1 first for predictable results.",
      },
      // Rate and accumulation
      {
        name: "diff",
        path: "Signal.diff",
        description: "Approximate derivative (rate of change).",
        params: [],
        returns: "Signal",
        chainsTo: "Signal",
        example: "inputs.amplitude.diff()",
      },
      {
        name: "integrate",
        path: "Signal.integrate",
        description: "Cumulative sum with optional decay (in beats).",
        params: [
          {
            name: "decay_beats",
            type: "float",
            description: "0 = no decay.",
            default: 0.0,
          },
        ],
        returns: "Signal",
        chainsTo: "Signal",
        example: "inputs.onsetEnvelope.integrate(0.5)",
      },
      // Time shifting
      {
        name: "delay",
        path: "Signal.delay",
        description: "Delay the signal by N beats.",
        params: [{ name: "beats", type: "float", description: "Delay amount in beats." }],
        returns: "Signal",
        chainsTo: "Signal",
        example: "inputs.onsetEnvelope.delay(0.25)",
      },
      {
        name: "anticipate",
        path: "Signal.anticipate",
        description: "Look ahead by N beats (input signals only).",
        params: [{ name: "beats", type: "float", description: "Lookahead in beats." }],
        returns: "Signal",
        chainsTo: "Signal",
        example: "inputs.onsetEnvelope.anticipate(0.1)",
        notes: "For derived signals this may be a no-op.",
      },
      // Sampling
      {
        name: "interpolate",
        path: "Signal.interpolate",
        description: "Use linear interpolation sampling.",
        params: [],
        returns: "Signal",
        chainsTo: "Signal",
        example: "inputs.spectralCentroid.interpolate()",
      },
      {
        name: "peak",
        path: "Signal.peak",
        description: "Use peak-preserving sampling (default).",
        params: [],
        returns: "Signal",
        chainsTo: "Signal",
        example: "inputs.onsetEnvelope.peak()",
      },
      {
        name: "peak_window",
        path: "Signal.peak_window",
        description: "Peak-preserving sampling with custom window (beats).",
        params: [{ name: "beats", type: "float", description: "Window size in beats." }],
        returns: "Signal",
        chainsTo: "Signal",
        example: "inputs.energy.peak_window(0.25)",
      },
      {
        name: "peak_window_sec",
        path: "Signal.peak_window_sec",
        description: "Peak-preserving sampling with custom window (seconds).",
        params: [{ name: "seconds", type: "float", description: "Window size in seconds." }],
        returns: "Signal",
        chainsTo: "Signal",
        example: "inputs.energy.peak_window_sec(0.05)",
      },
      // Debug
      {
        name: "probe",
        path: "Signal.probe",
        description: "Attach a debug probe to emit values during host evaluation.",
        params: [{ name: "name", type: "string", description: "Probe name." }],
        returns: "Signal",
        chainsTo: "Signal",
        example: 'inputs.onsetEnvelope.probe("onset")',
        notes: "Use with analysis mode / host evaluation; this does not print.",
      },
    ],
  },

  // ============================================================================
  // SmoothBuilder - Smoothing operations
  // ============================================================================
  {
    kind: "builder",
    name: "SmoothBuilder",
    path: "SmoothBuilder",
    description: "Smoothing operations (returned by signal.smooth).",
    parent: "Signal",
    properties: [],
    methods: [
      {
        name: "moving_average",
        path: "SmoothBuilder.moving_average",
        description: "Moving average over a window of N beats.",
        params: [{ name: "beats", type: "float", description: "Window size in beats." }],
        returns: "Signal",
        chainsTo: "Signal",
        example: "inputs.onsetEnvelope.smooth.moving_average(0.5)",
      },
      {
        name: "exponential",
        path: "SmoothBuilder.exponential",
        description: "Asymmetric exponential smoothing in beats.",
        params: [
          { name: "attack_beats", type: "float", description: "Attack time in beats (rising)." },
          { name: "release_beats", type: "float", description: "Release time in beats (falling)." },
        ],
        returns: "Signal",
        chainsTo: "Signal",
        example: "inputs.amplitude.smooth.exponential(0.1, 0.5)",
      },
      {
        name: "gaussian",
        path: "SmoothBuilder.gaussian",
        description: "Gaussian blur with sigma in beats.",
        params: [{ name: "sigma_beats", type: "float", description: "Sigma in beats." }],
        returns: "Signal",
        chainsTo: "Signal",
        example: "inputs.spectralCentroid.smooth.gaussian(0.25)",
      },
    ],
  },

  // ============================================================================
  // NormaliseBuilder - Normalisation operations
  // ============================================================================
  {
    kind: "builder",
    name: "NormaliseBuilder",
    path: "NormaliseBuilder",
    description: "Normalisation operations (returned by signal.normalise).",
    parent: "Signal",
    properties: [],
    methods: [
      {
        name: "global",
        path: "NormaliseBuilder.global",
        description: "Min-max normalisation using whole-track statistics.",
        params: [],
        returns: "Signal",
        chainsTo: "Signal",
        example: "inputs.amplitude.normalise.global()",
      },
      {
        name: "robust",
        path: "NormaliseBuilder.robust",
        description: "Percentile-based normalisation (5th-95th).",
        params: [],
        returns: "Signal",
        chainsTo: "Signal",
        example: "inputs.spectralFlux.normalise.robust()",
      },
      {
        name: "to_range",
        path: "NormaliseBuilder.to_range",
        description: "Map to a custom output range.",
        params: [
          { name: "min", type: "float", description: "Output min." },
          { name: "max", type: "float", description: "Output max." },
        ],
        returns: "Signal",
        chainsTo: "Signal",
        example: "inputs.amplitude.normalise.to_range(0.0, 1.0)",
      },
    ],
  },

  // ============================================================================
  // GateBuilder - Gating operations
  // ============================================================================
  {
    kind: "builder",
    name: "GateBuilder",
    path: "GateBuilder",
    description: "Gating operations (returned by signal.gate).",
    parent: "Signal",
    properties: [],
    methods: [
      {
        name: "threshold",
        path: "GateBuilder.threshold",
        description: "Binary gate: 1.0 if >= threshold else 0.0.",
        params: [{ name: "threshold", type: "float", description: "Threshold value." }],
        returns: "Signal",
        chainsTo: "Signal",
        example: "inputs.onsetEnvelope.gate.threshold(0.7)",
      },
      {
        name: "hysteresis",
        path: "GateBuilder.hysteresis",
        description: "Schmitt trigger gate (on/off thresholds).",
        params: [
          { name: "on_threshold", type: "float", description: "Must exceed to turn on." },
          { name: "off_threshold", type: "float", description: "Must drop below to turn off." },
        ],
        returns: "Signal",
        chainsTo: "Signal",
        example: "inputs.amplitude.gate.hysteresis(0.6, 0.4)",
      },
    ],
  },

  // ============================================================================
  // PickBuilder - Event extraction
  // ============================================================================
  {
    kind: "builder",
    name: "PickBuilder",
    path: "PickBuilder",
    description: "Event extraction operations (returned by signal.pick).",
    parent: "Signal",
    properties: [],
    methods: [
      {
        name: "events",
        path: "PickBuilder.events",
        description: "Extract an EventStream from a Signal using peak-picking.",
        params: [
          {
            name: "options",
            type: "PickEventsOptions",
            description: "Options map.",
          },
        ],
        returns: "EventStream",
        chainsTo: "EventStream",
        example: 'let events = inputs.onsetEnvelope.pick.events(#{ target_density: 2.0 });',
        notes: "In playback mode, this may return an empty stream.",
      },
    ],
  },

  // ============================================================================
  // EventStream - Immutable event stream
  // ============================================================================
  {
    kind: "type",
    name: "EventStream",
    path: "EventStream",
    description: "An immutable, time-ordered stream of events.",
    properties: [],
    methods: [
      {
        name: "len",
        path: "EventStream.len",
        description: "Number of events.",
        params: [],
        returns: "int",
        example: "let n = events.len();",
      },
      {
        name: "is_empty",
        path: "EventStream.is_empty",
        description: "True if there are no events.",
        params: [],
        returns: "bool",
        example: "if events.is_empty() { ... }",
      },
      {
        name: "get",
        path: "EventStream.get",
        description: "Get an event by index (or () if out of range).",
        params: [{ name: "index", type: "int", description: "0-based index." }],
        returns: "Event | void",
        example: "let e = events.get(0);",
      },
      {
        name: "to_array",
        path: "EventStream.to_array",
        description: "Convert to an array for iteration.",
        params: [],
        returns: "array<Event>",
        example: "for e in events.to_array() { ... }",
      },
      {
        name: "time_span",
        path: "EventStream.time_span",
        description: "Return [start, end] times (or [] if empty).",
        params: [],
        returns: "array<float>",
        example: "let span = events.time_span();",
      },
      {
        name: "max_weight",
        path: "EventStream.max_weight",
        description: "Maximum event weight (or 0.0 if empty).",
        params: [],
        returns: "float",
        example: "let w = events.max_weight();",
      },
      {
        name: "min_weight",
        path: "EventStream.min_weight",
        description: "Minimum event weight (or 0.0 if empty).",
        params: [],
        returns: "float",
        example: "let w = events.min_weight();",
      },
      {
        name: "to_signal",
        path: "EventStream.to_signal",
        description: "Convert events to an impulse Signal.",
        params: [],
        returns: "Signal",
        chainsTo: "Signal",
        overloadId: "impulse",
        example: "let impulses = events.to_signal();",
      },
      {
        name: "to_signal",
        path: "EventStream.to_signal",
        description: "Convert events to a shaped Signal.",
        params: [
          {
            name: "options",
            type: "ToSignalOptions",
            description: "Envelope shaping options.",
          },
        ],
        returns: "Signal",
        chainsTo: "Signal",
        overloadId: "options",
        example:
          'let env = events.to_signal(#{ envelope: "attack_decay", attack_beats: 0.05, decay_beats: 0.5 });',
      },
      {
        name: "filter_time",
        path: "EventStream.filter_time",
        description: "Filter events to a time range [start, end).",
        params: [
          { name: "start", type: "float", description: "Start time (seconds)." },
          { name: "end", type: "float", description: "End time (seconds)." },
        ],
        returns: "EventStream",
        chainsTo: "EventStream",
        example: "let later = events.filter_time(30.0, 45.0);",
      },
      {
        name: "filter_weight",
        path: "EventStream.filter_weight",
        description: "Filter events by minimum weight.",
        params: [{ name: "min_weight", type: "float", description: "Minimum weight." }],
        returns: "EventStream",
        chainsTo: "EventStream",
        example: "let strong = events.filter_weight(0.5);",
      },
      {
        name: "limit",
        path: "EventStream.limit",
        description: "Limit to the first N events.",
        params: [{ name: "max_events", type: "int", description: "Maximum number of events." }],
        returns: "EventStream",
        chainsTo: "EventStream",
        example: "let first = events.limit(10);",
      },
      {
        name: "probe",
        path: "EventStream.probe",
        description: "Convert to signal and attach a debug probe for analysis visualization.",
        params: [{ name: "name", type: "string", description: "Probe name shown in debug UI." }],
        returns: "Signal",
        chainsTo: "Signal",
        example: 'let probed = events.probe("onsets");',
        notes: "Returns a Signal, not EventStream. Use to visualize events in the debug UI.",
      },
    ],
  },

  // ============================================================================
  // Event - Single event
  // ============================================================================
  {
    kind: "type",
    name: "Event",
    path: "Event",
    description: "A single extracted event.",
    properties: [
      {
        name: "time",
        path: "Event.time",
        type: "float",
        description: "Event time in seconds.",
        readonly: true,
      },
      {
        name: "weight",
        path: "Event.weight",
        type: "float",
        description: "Event weight (meaning depends on weight_mode).",
        readonly: true,
      },
      {
        name: "beat_position",
        path: "Event.beat_position",
        type: "float",
        description: "Beat position if available, else 0.0.",
        readonly: true,
      },
      {
        name: "beat_phase",
        path: "Event.beat_phase",
        type: "float",
        description: "Phase within beat if available, else 0.0.",
        readonly: true,
      },
      {
        name: "cluster_id",
        path: "Event.cluster_id",
        type: "int",
        description: "Cluster ID if available, else -1.",
        readonly: true,
      },
    ],
    methods: [],
  },

  // ============================================================================
  // Bands - Band-scoped signal accessors
  // ============================================================================
  {
    kind: "type",
    name: "Bands",
    path: "Bands",
    description: 'Band-scoped signal accessors (string-keyed map). Access via inputs.bands["BandName"].',
    properties: [],
    methods: [],
    example: 'inputs.bands["Bass"].energy',
  },

  // ============================================================================
  // BandSignals - Signals for a specific band
  // ============================================================================
  {
    kind: "type",
    name: "BandSignals",
    path: "BandSignals",
    description: "Signals available for a specific band key.",
    properties: [
      {
        name: "energy",
        path: "BandSignals.energy",
        type: "Signal",
        description: "Band amplitude envelope (0-1).",
        readonly: true,
      },
      {
        name: "onset",
        path: "BandSignals.onset",
        type: "Signal",
        description: "Band onset strength (0-1).",
        readonly: true,
      },
      {
        name: "flux",
        path: "BandSignals.flux",
        type: "Signal",
        description: "Band spectral flux (0-1).",
        readonly: true,
      },
      {
        name: "amplitude",
        path: "BandSignals.amplitude",
        type: "Signal",
        description: "Alias for energy.",
        readonly: true,
      },
      {
        name: "events",
        path: "BandSignals.events",
        type: "EventStream",
        description: "Band-scoped events (may be empty).",
        readonly: true,
      },
    ],
    methods: [],
  },
];
