import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import type {
  AudioBufferLike,
  BandMirFunctionId,
  MusicalTimeStructure,
  TempoHypothesis,
} from "@octoseq/mir";
import {
  MIXDOWN_STREAM_ID,
  addBand,
  addStemWithAudio,
  analysisKey,
  audioCache,
  loadMixdown,
  resetAllStreams,
  useAnalysisStore,
  useStreamStore,
  type AnalysisId,
  type AnalysisResult,
  type AudioStream,
  type BandStream,
  type StreamId,
} from "@/lib/streams";
import { makeAudioRef, makeSegment } from "@/lib/streams/__tests__/fixtures";
import { useAuthoredEventStore } from "@/lib/stores/authoredEventStore";
import { useComposedSignalStore } from "@/lib/stores/composedSignalStore";
import { useDerivedSignalStore } from "@/lib/stores/derivedSignalStore";
import { useProjectStore } from "@/lib/stores/projectStore";
import { useTimingStore } from "@/lib/stores/timingStore";
import {
  DERIVED_SIGNAL_SCHEMA_VERSION,
  type DerivedSignalDefinition,
  type DerivedSignalResult,
  type DerivedSignalStructure,
} from "@/lib/stores/types/derivedSignal";
import {
  AMPLITUDE_ENVELOPE_RATE_HZ,
  exportInterpretationPackage,
} from "../exportInterpretationPackage";

// ----------------------------
// Deterministic helpers
// ----------------------------

/** Fixed timestamp used everywhere determinism matters. */
const T0 = "2026-01-01T00:00:00.000Z";

const META = { backend: "cpu" as const, usedGpu: false, timings: { totalMs: 0 } };

function frameTimes(count: number, durationSec: number): Float32Array {
  const out = new Float32Array(count);
  for (let i = 0; i < count; i++) out[i] = (i * durationSec) / count;
  return out;
}

/**
 * Deterministic triangle-ish waveform in [-0.8, 0.8]. Uses only exact IEEE
 * arithmetic (no transcendentals) so the golden fixture is byte-identical
 * across platforms and Node versions.
 */
function tri(i: number): number {
  const phase = (i % 100) / 100;
  const v = phase < 0.5 ? phase * 2 : 2 - phase * 2;
  return (v - 0.5) * 1.6;
}

function makeToneBuffer(durationSec: number, sampleRate: number): AudioBufferLike {
  const samples = new Float32Array(Math.round(durationSec * sampleRate));
  for (let i = 0; i < samples.length; i++) samples[i] = tri(i);
  return { sampleRate, numberOfChannels: 1, getChannelData: () => samples };
}

/** Deterministic sawtooth values in [0, 0.9]. */
function sawValues(count: number, period = 10): number[] {
  return Array.from({ length: count }, (_, i) => (i % period) / period * 0.9);
}

function mir1d(values: number[], durationSec: number): AnalysisResult {
  return {
    kind: "1d",
    times: frameTimes(values.length, durationSec),
    values: new Float32Array(values),
    meta: META,
  };
}

function mirActivity(activityLevel: number[], durationSec: number): AnalysisResult {
  return {
    kind: "activity",
    times: frameTimes(activityLevel.length, durationSec),
    activityLevel: new Float32Array(activityLevel),
    isActive: new Uint8Array(activityLevel.map((v) => (v > 0 ? 1 : 0))),
    suppressMask: new Uint8Array(activityLevel.length),
    meta: META,
    diagnostics: {
      noiseFloor: 0,
      enterThreshold: 0,
      exitThreshold: 0,
      totalFrames: activityLevel.length,
      activeFrames: activityLevel.length,
      activeFraction: 1,
    },
  };
}

function bandMir1d(
  bandId: string,
  bandLabel: string,
  fn: BandMirFunctionId,
  values: number[],
  durationSec: number
): AnalysisResult {
  return {
    kind: "bandMir1d",
    bandId,
    bandLabel,
    fn,
    times: frameTimes(values.length, durationSec),
    values: new Float32Array(values),
    meta: META,
    diagnostics: {
      meanEnergyRetained: 1,
      weakFrameCount: 0,
      emptyFrameCount: 0,
      totalFrames: values.length,
      warnings: [],
    },
  };
}

function bandEventsResult(
  bandId: string,
  bandLabel: string,
  events: Array<{ time: number; weight: number }>
): AnalysisResult {
  return {
    kind: "bandEvents",
    bandId,
    bandLabel,
    fn: "bandOnsetPeaks",
    events,
    meta: META,
    diagnostics: { eventCount: events.length, eventsPerSecond: 1, warnings: [] },
  };
}

function beatCandidatesResult(
  candidates: Array<{ time: number; strength: number }>,
  durationSec: number
): AnalysisResult {
  return {
    kind: "beatCandidates",
    times: frameTimes(Math.max(1, candidates.length), durationSec),
    candidates: candidates.map((c) => ({ ...c, source: "combined" as const })),
    meta: META,
  };
}

function onsetPeaksResult(
  events: Array<{ time: number; strength: number }>,
  durationSec: number
): AnalysisResult {
  return {
    kind: "events",
    times: frameTimes(Math.max(1, events.length), durationSec),
    events: events.map((e, index) => ({ ...e, index })),
    meta: META,
  };
}

function hypothesis(bpm: number): TempoHypothesis {
  return {
    id: `hyp-${bpm}`,
    bpm,
    confidence: 1,
    evidence: { supportingIntervalCount: 0, weightedSupport: 0, peakHeight: 0, binRange: [bpm, bpm] },
    familyId: `fam-${Math.round(bpm)}`,
    harmonicRatio: 1,
  };
}

function makeMusicalTime(durationSec: number): MusicalTimeStructure {
  return {
    version: 1,
    segments: [
      {
        id: "seg-1",
        bpm: 120,
        phaseOffset: 0,
        startTime: 0,
        endTime: durationSec,
        provenance: { source: "manual_entry", promotedAt: T0 },
      },
    ],
    createdAt: T0,
    modifiedAt: T0,
  };
}

function makeDerivedStructure(
  signals: Array<{ id: string; name: string; enabled?: boolean }>
): DerivedSignalStructure {
  return {
    version: DERIVED_SIGNAL_SCHEMA_VERSION,
    signals: signals.map(
      (s, i): DerivedSignalDefinition => ({
        id: s.id,
        name: s.name,
        source: {
          kind: "1d",
          signalRef: { type: "analysis", streamId: MIXDOWN_STREAM_ID, analysisId: "onsetEnvelope" },
        },
        transforms: [],
        stabilization: { mode: "none", envelopeMode: "raw" },
        autoRecompute: false,
        enabled: s.enabled ?? true,
        sortOrder: i,
        createdAt: T0,
        modifiedAt: T0,
      })
    ),
    createdAt: T0,
    modifiedAt: T0,
  };
}

function makeDerivedResult(id: string, values: number[], durationSec: number): DerivedSignalResult {
  return {
    definitionId: id,
    status: "computed",
    times: frameTimes(values.length, durationSec),
    values: new Float32Array(values),
    valueRange: { min: Math.min(...values), max: Math.max(...values) },
    computedAt: T0,
  };
}

// ----------------------------
// Store seeding
// ----------------------------

const analyses = () => useAnalysisStore.getState();

function seedMixdown(durationSec: number, sampleRate = 1000): void {
  loadMixdown({
    audio: makeAudioRef({ durationSec, sampleRate }),
    buffer: makeToneBuffer(durationSec, sampleRate),
  });
}

function setResult(streamId: StreamId, analysisId: AnalysisId, result: AnalysisResult): void {
  analyses().setResult(analysisKey(streamId, analysisId), result);
}

beforeEach(() => {
  resetAllStreams();
  useAuthoredEventStore.getState().reset();
  useComposedSignalStore.getState().reset();
  useDerivedSignalStore.getState().reset();
  useProjectStore.getState().closeProject();
  const timing = useTimingStore.getState();
  timing.clearBeatGrid();
  timing.clearManualTempo();
  timing.reset();
});

// ----------------------------
// Tests
// ----------------------------

describe("exportInterpretationPackage", () => {
  it("throws when no mixdown is loaded", () => {
    expect(() => exportInterpretationPackage()).toThrow(/no mixdown/);
  });

  it("produces formatVersion 1 with duration, project name, and fixed createdAt", () => {
    seedMixdown(10);
    useProjectStore.getState().createProject("My Project");

    const pkg = exportInterpretationPackage({ createdAt: T0 });

    expect(pkg.formatVersion).toBe(1);
    expect(pkg.createdAt).toBe(T0);
    expect(pkg.durationSec).toBe(10);
    expect(pkg.projectName).toBe("My Project");
  });

  it("exports every alias of a cached mixdown analysis (energy AND onsetEnvelope)", () => {
    seedMixdown(10);
    setResult(MIXDOWN_STREAM_ID, "onsetEnvelope", mir1d([0, 1, 2, 3], 10));

    const pkg = exportInterpretationPackage();
    const names = pkg.signals.map((s) => s.name);

    expect(names).toContain("onsetEnvelope");
    expect(names).toContain("energy");
    // Aliases not backed by a cached result are absent.
    expect(names).not.toContain("flux");
    expect(names).not.toContain("spectralFlux");
    // Session-ephemeral search curve is never exported.
    expect(names).not.toContain("searchSimilarity");

    const energy = pkg.signals.find((s) => s.name === "energy")!;
    const onsetEnvelope = pkg.signals.find((s) => s.name === "onsetEnvelope")!;
    expect(energy.values).toEqual(onsetEnvelope.values);
    // normalizeSignal min-max: [0,1,2,3] -> [0, 1/3, 2/3, 1]
    expect(energy.values[0]).toBe(0);
    expect(energy.values[1]).toBeCloseTo(1 / 3, 5);
    expect(energy.values[3]).toBe(1);
    expect(energy.rate).toBeCloseTo(4 / 10, 10);
  });

  it("maps activity results through activityLevel", () => {
    seedMixdown(10);
    setResult(MIXDOWN_STREAM_ID, "activity", mirActivity([0, 2, 4], 10));

    const pkg = exportInterpretationPackage();
    const activity = pkg.signals.find((s) => s.name === "activity");
    expect(activity).toBeDefined();
    expect(activity!.values[1]).toBeCloseTo(0.5, 5);
  });

  it("bakes amplitude as a ~200 Hz max-abs envelope normalized to [0,1]", () => {
    seedMixdown(2, 1000); // 2000 PCM samples

    const pkg = exportInterpretationPackage();
    const amplitude = pkg.signals.find((s) => s.name === "amplitude");

    expect(amplitude).toBeDefined();
    expect(amplitude!.values.length).toBe(Math.ceil(2 * AMPLITUDE_ENVELOPE_RATE_HZ));
    expect(amplitude!.rate).toBeCloseTo(AMPLITUDE_ENVELOPE_RATE_HZ, 5);
    for (const v of amplitude!.values) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
    // min-max normalization reaches both bounds
    expect(Math.max(...amplitude!.values)).toBe(1);
    expect(Math.min(...amplitude!.values)).toBe(0);
  });

  it("exports band signals with the panel's feature names and normalization", () => {
    seedMixdown(10);
    const bandId = addBand({
      parentId: MIXDOWN_STREAM_ID,
      label: "Bass",
      frequencyShape: [makeSegment()],
    });
    setResult(bandId, "amplitudeEnvelope", bandMir1d(bandId, "Bass", "bandAmplitudeEnvelope", [0, 5, 10], 10));
    setResult(bandId, "onsetEnvelope", bandMir1d(bandId, "Bass", "bandOnsetStrength", [1, 2, 3], 10));

    const pkg = exportInterpretationPackage();

    const features = pkg.bandSignals.map((s) => s.feature);
    expect(features).toEqual(["energy", "onset"]);
    const energy = pkg.bandSignals.find((s) => s.feature === "energy")!;
    expect(energy.bandId).toBe(bandId);
    expect(energy.label).toBe("Bass");
    expect(energy.values).toEqual([0, 0.5, 1]);
    expect(energy.rate).toBeCloseTo(3 / 10, 10);
  });

  it("exports band events as bare {time, weight} elements", () => {
    seedMixdown(10);
    const bandId = addBand({
      parentId: MIXDOWN_STREAM_ID,
      label: "Bass",
      frequencyShape: [makeSegment()],
    });
    setResult(bandId, "onsetPeaks", bandEventsResult(bandId, "Bass", [{ time: 1.5, weight: 0.7 }]));

    const pkg = exportInterpretationPackage();

    expect(pkg.bandEvents).toHaveLength(1);
    expect(pkg.bandEvents[0]!.bandId).toBe(bandId);
    expect(pkg.bandEvents[0]!.events).toEqual([{ time: 1.5, weight: 0.7 }]);
    expect(Object.keys(pkg.bandEvents[0]!.events[0]!)).toEqual(["time", "weight"]);
  });

  it("exports stem signals and availableStems [id, label] pairs", () => {
    seedMixdown(10);
    const stemId = addStemWithAudio({
      label: "Drums",
      audio: makeAudioRef({ durationSec: 10 }),
      buffer: makeToneBuffer(1, 100),
    });
    setResult(stemId, "onsetEnvelope", mir1d([2, 4, 6, 8], 10));

    const pkg = exportInterpretationPackage();

    expect(pkg.availableStems).toEqual([[stemId, "Drums"]]);
    expect(pkg.stemSignals).toHaveLength(1);
    const stemSignal = pkg.stemSignals[0]!;
    expect(stemSignal.stemId).toBe(stemId);
    expect(stemSignal.label).toBe("Drums");
    expect(stemSignal.feature).toBe("energy");
    expect(stemSignal.values[0]).toBe(0);
    expect(stemSignal.values[3]).toBe(1);
  });

  it("exports beatCandidates and onsetPeaks with the exact push element shape", () => {
    seedMixdown(10);
    setResult(
      MIXDOWN_STREAM_ID,
      "beatCandidates",
      beatCandidatesResult([{ time: 1, strength: 0.8 }], 10)
    );
    setResult(MIXDOWN_STREAM_ID, "onsetPeaks", onsetPeaksResult([{ time: 2, strength: 0.6 }], 10));

    const pkg = exportInterpretationPackage();

    expect(pkg.eventStreams.map((s) => s.name)).toEqual(["beatCandidates", "onsetPeaks"]);
    expect(pkg.eventStreams[0]!.events[0]).toEqual({
      time: 1,
      weight: 0.8,
      beat_position: null,
      beat_phase: null,
      cluster_id: null,
    });
    expect(pkg.eventStreams[1]!.events[0]).toEqual({
      time: 2,
      weight: 0.6,
      beat_position: null,
      beat_phase: null,
      cluster_id: null,
    });
  });

  it("exports authored event streams with beat_position carried over", () => {
    seedMixdown(10);
    const store = useAuthoredEventStore.getState();
    const streamId = store.addStream("hits", { kind: "manual" });
    store.addEvents(streamId, [
      {
        time: 0.5,
        beatPosition: 1,
        weight: 0.9,
        duration: null,
        payload: null,
        provenance: { kind: "manual", createdAt: T0 },
      },
      {
        time: 1.25,
        beatPosition: null,
        weight: 0.4,
        duration: null,
        payload: null,
        provenance: { kind: "manual", createdAt: T0 },
      },
    ]);

    const pkg = exportInterpretationPackage();

    expect(pkg.authoredEventStreams).toHaveLength(1);
    expect(pkg.authoredEventStreams[0]!.name).toBe("hits");
    expect(pkg.authoredEventStreams[0]!.events).toEqual([
      { time: 0.5, weight: 0.9, beat_position: 1, beat_phase: null, cluster_id: null },
      { time: 1.25, weight: 0.4, beat_position: null, beat_phase: null, cluster_id: null },
    ]);
  });

  it("samples enabled composed signals at 100 Hz when a tempo hypothesis is selected", () => {
    seedMixdown(2);
    useComposedSignalStore.getState().addSignal({
      name: "intensity",
      nodes: [
        { id: "n1", time_beats: 0, value: 0, interp_to_next: "linear" },
        { id: "n2", time_beats: 4, value: 1, interp_to_next: "linear" },
      ],
      enabled: true,
    });

    // Without BPM there is nothing to sample (matches the panel).
    expect(exportInterpretationPackage().composedSignals).toEqual([]);

    useTimingStore.getState().selectHypothesis(hypothesis(120));
    const pkg = exportInterpretationPackage();

    expect(pkg.composedSignals).toHaveLength(1);
    const composed = pkg.composedSignals[0]!;
    expect(composed.name).toBe("intensity");
    expect(composed.values.length).toBe(Math.ceil(2 * 100));
    expect(composed.rate).toBeCloseTo(100, 5);
    expect(composed.values[0]).toBe(0);
    // 2s at 120bpm = 4 beats: the curve reaches the final node's value.
    expect(composed.values[composed.values.length - 1]).toBeCloseTo(1, 2);
  });

  it("exports computed derived signals raw and skips uncomputed ones", () => {
    seedMixdown(10);
    const derived = useDerivedSignalStore.getState();
    derived.loadFromProject(
      makeDerivedStructure([
        { id: "derived-1", name: "Kick Energy" },
        { id: "derived-2", name: "Not Computed Yet" },
      ])
    );
    derived.setCachedResult("derived-1", makeDerivedResult("derived-1", [0, 2, 4], 10));

    const pkg = exportInterpretationPackage();

    expect(pkg.customSignals).toHaveLength(1);
    const custom = pkg.customSignals[0]!;
    expect(custom.id).toBe("derived-1");
    expect(custom.name).toBe("Kick Energy");
    // Custom signals are pushed raw (no normalization), same as the panel.
    expect(custom.values).toEqual([0, 2, 4]);
    expect(custom.rate).toBeCloseTo(3 / 10, 10);
  });

  it("passes the authoritative musical time structure through", () => {
    seedMixdown(10);
    const structure = makeMusicalTime(10);
    expect(useTimingStore.getState().importFromJSON(JSON.stringify(structure))).toBe(true);

    const pkg = exportInterpretationPackage();
    expect(pkg.musicalTime).toEqual(structure);
  });

  it("emits a version 2 frequency band structure, or null without bands", () => {
    seedMixdown(10);
    expect(exportInterpretationPackage().frequencyBands).toBeNull();

    const shape = [makeSegment()];
    const bandId = addBand({ parentId: MIXDOWN_STREAM_ID, label: "Bass", frequencyShape: shape });

    const pkg = exportInterpretationPackage({ createdAt: T0 });
    expect(pkg.frequencyBands).not.toBeNull();
    expect(pkg.frequencyBands!.version).toBe(2);
    expect(pkg.frequencyBands!.createdAt).toBe(T0);
    expect(pkg.frequencyBands!.bands).toHaveLength(1);
    const band = pkg.frequencyBands!.bands[0]!;
    expect(band.id).toBe(bandId);
    expect(band.label).toBe("Bass");
    expect(band.sourceId).toBe(MIXDOWN_STREAM_ID);
    expect(band.frequencyShape).toEqual(shape);
  });

  it("passes the active script through, or null without a project", () => {
    seedMixdown(10);
    expect(exportInterpretationPackage().script).toBeNull();

    useProjectStore.getState().createProject("Scripted");
    useProjectStore
      .getState()
      .syncScripts(
        [{ id: "script-1", name: "Main", content: "let c = mesh.cube();", createdAt: T0, modifiedAt: T0 }],
        "script-1"
      );

    expect(exportInterpretationPackage().script).toBe("let c = mesh.cube();");
  });
});

// ----------------------------
// Golden fixture for the Rust end-to-end test
// ----------------------------

const FIXTURE_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../../..",
  "packages/visualiser/tests/fixtures"
);
const FIXTURE_PATH = path.join(FIXTURE_DIR, "interpretation-package-v1.json");

const FIXTURE_SCRIPT = [
  "let cube = mesh.cube();",
  "",
  "cube.scale = inputs.mix.energy.scale(3);",
  "",
  "fn init(ctx) {",
  "    scene.add(cube);",
  "}",
  "",
  "fn update(dt, frame) {",
  "}",
].join("\n");

/**
 * Seed fully deterministic state: fixed stream ids (via restoreStreams), fixed
 * timestamps, and arithmetic-only waveforms. Rerunning the suite must
 * reproduce the fixture byte-for-byte.
 */
function seedDeterministicFixtureState(): void {
  const durationSec = 2;

  // Mixdown (fixed id) + PCM.
  seedMixdown(durationSec, 1000);

  // Stem and band with fixed ids/timestamps, inserted via restoreStreams to
  // bypass nanoid/now generation.
  const stem: AudioStream = {
    id: "stem-drums",
    kind: "stem",
    label: "Drums",
    enabled: true,
    sortOrder: 1,
    createdAt: T0,
    modifiedAt: T0,
    audio: makeAudioRef({ durationSec, sampleRate: 1000, fileName: "drums.wav" }),
  };
  const band: BandStream = {
    id: "band-bass",
    kind: "band",
    parentId: MIXDOWN_STREAM_ID,
    label: "Bass",
    enabled: true,
    sortOrder: 1,
    createdAt: T0,
    modifiedAt: T0,
    timeScope: { kind: "global" },
    frequencyShape: [makeSegment({ endTime: durationSec })],
    provenance: { source: "manual", createdAt: T0 },
  };
  useStreamStore.getState().restoreStreams([stem, band]);
  audioCache.set(stem.id, makeToneBuffer(durationSec, 1000));

  // Mixdown analyses: two 1D signals (each fans out to its aliases) + events.
  setResult(MIXDOWN_STREAM_ID, "onsetEnvelope", mir1d(sawValues(50), durationSec));
  setResult(MIXDOWN_STREAM_ID, "spectralFlux", mir1d(sawValues(50, 7), durationSec));
  setResult(
    MIXDOWN_STREAM_ID,
    "beatCandidates",
    beatCandidatesResult(
      [
        { time: 0.25, strength: 0.9 },
        { time: 0.75, strength: 0.7 },
        { time: 1.25, strength: 0.95 },
        { time: 1.75, strength: 0.6 },
      ],
      durationSec
    )
  );
  setResult(
    MIXDOWN_STREAM_ID,
    "onsetPeaks",
    onsetPeaksResult(
      [
        { time: 0.1, strength: 0.5 },
        { time: 0.9, strength: 0.8 },
        { time: 1.6, strength: 0.65 },
      ],
      durationSec
    )
  );

  // Band analyses: one feature signal + events.
  setResult(band.id, "amplitudeEnvelope", bandMir1d(band.id, band.label, "bandAmplitudeEnvelope", sawValues(40, 8), durationSec));
  setResult(
    band.id,
    "onsetPeaks",
    bandEventsResult(band.id, band.label, [
      { time: 0.2, weight: 0.9 },
      { time: 1.0, weight: 0.5 },
      { time: 1.8, weight: 0.75 },
    ])
  );

  // Stem analysis: one feature signal.
  setResult(stem.id, "onsetEnvelope", mir1d(sawValues(30, 6), durationSec));

  // Timing: committed musical time + a selected hypothesis (for composed BPM).
  useTimingStore.getState().importFromJSON(JSON.stringify(makeMusicalTime(durationSec)));
  useTimingStore.getState().selectHypothesis(hypothesis(120));

  // Authored events (stream/event ids never leak into the package).
  const authored = useAuthoredEventStore.getState();
  const authoredId = authored.addStream("hits", { kind: "manual" });
  authored.addEvents(authoredId, [
    {
      time: 0.5,
      beatPosition: 1,
      weight: 1,
      duration: null,
      payload: null,
      provenance: { kind: "manual", createdAt: T0 },
    },
    {
      time: 1.5,
      beatPosition: 3,
      weight: 0.8,
      duration: null,
      payload: null,
      provenance: { kind: "manual", createdAt: T0 },
    },
  ]);

  // Composed signal (id never leaks; name does).
  useComposedSignalStore.getState().addSignal({
    name: "intensity",
    nodes: [
      { id: "n1", time_beats: 0, value: 0.25, interp_to_next: "linear" },
      { id: "n2", time_beats: 2, value: 1, interp_to_next: "ease_in_out" },
      { id: "n3", time_beats: 4, value: 0, interp_to_next: "linear" },
    ],
    enabled: true,
  });

  // Derived signal with a computed result (id leaks — fixed).
  const derived = useDerivedSignalStore.getState();
  derived.loadFromProject(makeDerivedStructure([{ id: "derived-1", name: "Kick Energy" }]));
  derived.setCachedResult("derived-1", makeDerivedResult("derived-1", sawValues(25, 5), durationSec));

  // Project + script (project id never leaks; name and script do — fixed).
  useProjectStore.getState().createProject("Fixture Project");
  useProjectStore
    .getState()
    .syncScripts([{ id: "script-1", name: "Main", content: FIXTURE_SCRIPT, createdAt: T0, modifiedAt: T0 }], "script-1");
}

describe("golden fixture", () => {
  it("writes packages/visualiser/tests/fixtures/interpretation-package-v1.json deterministically", () => {
    seedDeterministicFixtureState();

    const pkg = exportInterpretationPackage({ createdAt: T0 });
    const json = JSON.stringify(pkg, null, 2);

    // Exporting twice from the same state is byte-identical.
    expect(JSON.stringify(exportInterpretationPackage({ createdAt: T0 }), null, 2)).toBe(json);

    mkdirSync(FIXTURE_DIR, { recursive: true });
    writeFileSync(FIXTURE_PATH, `${json}\n`);

    // Sanity-check the payload the Rust end-to-end test will consume.
    const parsed = JSON.parse(json) as typeof pkg;
    expect(parsed.formatVersion).toBe(1);
    expect(parsed.createdAt).toBe(T0);
    expect(parsed.durationSec).toBe(2);
    expect(parsed.projectName).toBe("Fixture Project");
    expect(parsed.script).toBe(FIXTURE_SCRIPT);
    expect(parsed.signals.map((s) => s.name)).toEqual([
      "amplitude",
      "spectralFlux",
      "flux",
      "onsetEnvelope",
      "energy",
      "beatPosition",
      "beatIndex",
      "beatPhase",
      "bpm",
    ]);
    expect(parsed.bandSignals.map((s) => `${s.bandId}:${s.feature}`)).toEqual(["band-bass:energy"]);
    expect(parsed.stemSignals.map((s) => `${s.stemId}:${s.feature}`)).toEqual(["stem-drums:energy"]);
    expect(parsed.customSignals.map((s) => s.id)).toEqual(["derived-1"]);
    expect(parsed.composedSignals.map((s) => s.name)).toEqual(["intensity"]);
    expect(parsed.eventStreams.map((s) => s.name)).toEqual(["beatCandidates", "onsetPeaks"]);
    expect(parsed.authoredEventStreams.map((s) => s.name)).toEqual(["hits"]);
    expect(parsed.bandEvents.map((b) => b.bandId)).toEqual(["band-bass"]);
    expect(parsed.musicalTime?.segments).toHaveLength(1);
    expect(parsed.frequencyBands?.version).toBe(2);
    expect(parsed.availableStems).toEqual([["stem-drums", "Drums"]]);
  });
});
