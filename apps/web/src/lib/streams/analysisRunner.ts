/**
 * Unified Analysis Runner — runs any analysis on any stream.
 *
 * One entry point replaces useMirActions (mixdown/stem path) and useBandMirActions
 * (band path). Callers address work as (streamId, analysisId); this module dispatches
 * on stream kind:
 *
 * - AudioStream → @octoseq/mir runMir, in the MIR web worker when available
 *   (falls back to the main thread in tests / when disabled in config)
 * - BandStream  → band-scoped batch functions on the main thread, computed from the
 *   PARENT stream's audio + the band's frequency shape
 *
 * Results land in analysisStore under the unified key, RAW (no display normalization —
 * that belongs at the display edge). Pending/error lifecycle is managed here.
 *
 * Fixes over the legacy hooks:
 * - Reruns cancel only the same (stream, analysis) job, not unrelated streams' jobs.
 * - Parent spectrogram/CQT memos are module-level (keyed by buffer identity + config),
 *   not React refs, so they survive unmount and invalidate correctly on audio change.
 * - Band event extraction computes its band-MIR dependency explicitly when missing.
 */

import {
  cqtSpectrogram,
  resample,
  runBandCqtBatch,
  runBandEventsBatch,
  runBandMirBatch,
  runMir,
  spectrogram,
  withCqtDefaults,
  type AudioBufferLike,
  type BandCqtFunctionId,
  type BandEventFunctionId,
  type BandMir1DResult,
  type BandMirFunctionId,
  type CqtSpectrogram,
  type MirAudioPayload,
  type MirFunctionId,
  type MirRunRequest,
  type Spectrogram,
} from "@octoseq/mir";
import { MirWorkerClient } from "@/lib/mirWorkerClient";
import { useConfigStore } from "@/lib/stores/configStore";
import { audioCache } from "./audioCache";
import { useAnalysisStore } from "./analysisStore";
import { useStreamStore } from "./streamStore";
import {
  BAND_ANALYSIS_IMPL,
  analysisKey,
  isAudioStream,
  isBandStream,
  toFrequencyBand,
  type AnalysisId,
  type AnalysisResult,
  type AudioStream,
  type BandStream,
  type StreamId,
} from "./types";

function analysisConfigFingerprint(config: ReturnType<typeof useConfigStore.getState>): string {
  return JSON.stringify({
    sampleRate: config.mirSampleRate,
    backend: config.enableGpu ? "gpu" : "cpu",
    spectrogram: config.getSpectrogramConfig(),
    mel: config.getMelConfig(),
    onset: config.getOnsetConfig(),
    peakPick: config.getPeakPickConfig(),
    hpss: config.getHpssConfig(),
    mfcc: config.getMfccConfig(),
    tempoHypotheses: config.getTempoHypothesesConfig(),
    cqt: config.getCqtConfig(),
  });
}

let currentConfigFingerprint = analysisConfigFingerprint(useConfigStore.getState());
useConfigStore.subscribe((config) => {
  const nextFingerprint = analysisConfigFingerprint(config);
  if (nextFingerprint === currentConfigFingerprint) return;
  currentConfigFingerprint = nextFingerprint;
  clearAnalysisMemos();
  cancelAllAnalyses();
  useAnalysisStore.getState().invalidateAll();
});

// ----------------------------
// Band implementation families
// ----------------------------

const BAND_STFT_FNS = new Set<BandMirFunctionId>([
  "bandAmplitudeEnvelope",
  "bandOnsetStrength",
  "bandSpectralFlux",
  "bandSpectralCentroid",
]);

const BAND_CQT_FNS = new Set<BandCqtFunctionId>([
  "bandCqtHarmonicEnergy",
  "bandCqtBassPitchMotion",
  "bandCqtTonalStability",
]);

const BAND_EVENT_FNS = new Set<BandEventFunctionId>(["bandOnsetPeaks", "bandBeatCandidates"]);

/** Reverse of BAND_ANALYSIS_IMPL: band implementation id → unified analysis id. */
const UNIFIED_ID_FOR_BAND_FN = new Map<string, AnalysisId>(
  Object.entries(BAND_ANALYSIS_IMPL).map(([unified, bandFn]) => [bandFn, unified as AnalysisId])
);

// ----------------------------
// Memoized derived inputs
// ----------------------------
// Keyed by the audio-owning stream id; validated by buffer identity + config
// fingerprint, so replacing a stream's audio or changing FFT config naturally misses.

interface MonoMemo {
  buffer: AudioBufferLike;
  rate: number;
  payload: MirAudioPayload;
}
interface SpecMemo {
  buffer: AudioBufferLike;
  fingerprint: string;
  spec: Spectrogram;
}
interface CqtMemo {
  buffer: AudioBufferLike;
  fingerprint: string;
  cqt: CqtSpectrogram;
}

const monoMemos = new Map<StreamId, MonoMemo>();
const specMemos = new Map<StreamId, SpecMemo>();
const cqtMemos = new Map<StreamId, CqtMemo>();

/** Drop derived-input memos for one stream, or all of them. */
export function clearAnalysisMemos(streamId?: StreamId): void {
  if (streamId === undefined) {
    monoMemos.clear();
    specMemos.clear();
    cqtMemos.clear();
    return;
  }
  monoMemos.delete(streamId);
  specMemos.delete(streamId);
  cqtMemos.delete(streamId);
}

function effectiveSampleRate(buffer: AudioBufferLike): number {
  const target = useConfigStore.getState().mirSampleRate;
  return target > 0 && target !== buffer.sampleRate ? target : buffer.sampleRate;
}

function makeMono(buffer: AudioBufferLike, rate: number): Float32Array {
  const ch0 = buffer.getChannelData(0);
  // Always copy: callers may transfer the underlying ArrayBuffer to a worker.
  return rate !== buffer.sampleRate
    ? resample(ch0, buffer.sampleRate, rate)
    : new Float32Array(ch0);
}

/** Memoized mono payload for main-thread use. NOT safe to transfer to a worker. */
function getMonoPayload(streamId: StreamId, buffer: AudioBufferLike): MirAudioPayload {
  const rate = effectiveSampleRate(buffer);
  const memo = monoMemos.get(streamId);
  if (memo && memo.buffer === buffer && memo.rate === rate) return memo.payload;
  const payload: MirAudioPayload = { sampleRate: rate, mono: makeMono(buffer, rate) };
  monoMemos.set(streamId, { buffer, rate, payload });
  return payload;
}

async function getSpectrogram(streamId: StreamId, buffer: AudioBufferLike): Promise<Spectrogram> {
  const config = useConfigStore.getState().getSpectrogramConfig();
  const payload = getMonoPayload(streamId, buffer);
  const fingerprint = `${payload.sampleRate}:${config.fftSize}:${config.hopSize}:${config.window}`;
  const memo = specMemos.get(streamId);
  if (memo && memo.buffer === buffer && memo.fingerprint === fingerprint) return memo.spec;
  const spec = await spectrogram(
    { sampleRate: payload.sampleRate, numberOfChannels: 1, getChannelData: () => payload.mono },
    config
  );
  specMemos.set(streamId, { buffer, fingerprint, spec });
  return spec;
}

async function getCqt(streamId: StreamId, buffer: AudioBufferLike): Promise<CqtSpectrogram> {
  const config = withCqtDefaults(useConfigStore.getState().getCqtConfig());
  const payload = getMonoPayload(streamId, buffer);
  const fingerprint = `${payload.sampleRate}:${config.binsPerOctave}:${config.fMin}:${config.fMax}`;
  const memo = cqtMemos.get(streamId);
  if (memo && memo.buffer === buffer && memo.fingerprint === fingerprint) return memo.cqt;
  const cqt = await cqtSpectrogram(
    { sampleRate: payload.sampleRate, numberOfChannels: 1, getChannelData: () => payload.mono },
    config
  );
  cqtMemos.set(streamId, { buffer, fingerprint, cqt });
  return cqt;
}

// ----------------------------
// Job tracking
// ----------------------------
// Reruns of the same key cancel the previous job for THAT key only.

interface ActiveJob {
  token: object;
  cancel: () => void;
}

const activeJobs = new Map<string, ActiveJob>();

function registerJob(key: string, cancel: () => void): object {
  activeJobs.get(key)?.cancel();
  const token = {};
  activeJobs.set(key, { token, cancel });
  return token;
}

function releaseJob(key: string, token: object): void {
  if (activeJobs.get(key)?.token === token) activeJobs.delete(key);
}

export function cancelAnalysis(streamId: StreamId, analysisId: AnalysisId): void {
  const key = analysisKey(streamId, analysisId);
  activeJobs.get(key)?.cancel();
  activeJobs.delete(key);
  useAnalysisStore.getState().invalidateKey(key);
}

export function cancelAllAnalyses(): void {
  for (const job of activeJobs.values()) job.cancel();
  activeJobs.clear();
}

function isCancellationError(e: unknown): boolean {
  return /cancelled/i.test((e as Error)?.message ?? "");
}

// ----------------------------
// Worker client (browser only)
// ----------------------------

let workerClient: MirWorkerClient | null = null;

function getWorkerClient(): MirWorkerClient | null {
  if (typeof window === "undefined" || typeof Worker === "undefined") return null;
  if (!useConfigStore.getState().useWorker) return null;
  if (!workerClient) workerClient = new MirWorkerClient();
  return workerClient;
}

function buildMirRequest(analysisId: MirFunctionId): MirRunRequest {
  const config = useConfigStore.getState();
  return {
    fn: analysisId,
    spectrogram: config.getSpectrogramConfig(),
    mel: config.getMelConfig(),
    backend: config.enableGpu ? "gpu" : "cpu",
    onset: config.getOnsetConfig(),
    peakPick: config.getPeakPickConfig(),
    hpss: config.getHpssConfig(),
    mfcc: config.getMfccConfig(),
    tempoHypotheses: config.getTempoHypothesesConfig(),
    cqt: config.getCqtConfig(),
  };
}

// ----------------------------
// Audio-stream path
// ----------------------------

async function runAudioStreamAnalysis(
  stream: AudioStream,
  analysisId: AnalysisId,
  key: string
): Promise<AnalysisResult | null> {
  const buffer = audioCache.get(stream.id);
  if (!buffer) {
    throw new Error(`runStreamAnalysis: no decoded audio for stream "${stream.id}"`);
  }

  const analyses = useAnalysisStore.getState();
  const config = useConfigStore.getState();
  const client = getWorkerClient();

  analyses.setPending(key);

  let token: object;
  let resultPromise: Promise<AnalysisResult>;

  if (client) {
    client.init(config.enableGpu);
    // Fresh copy: the worker takes ownership of the buffer via transfer.
    const payload: MirAudioPayload = {
      sampleRate: effectiveSampleRate(buffer),
      mono: makeMono(buffer, effectiveSampleRate(buffer)),
    };
    const job = client.run(payload, buildMirRequest(analysisId), {
      enableGpu: config.enableGpu,
      debug: config.debug,
    });
    token = registerJob(key, job.cancel);
    resultPromise = job.promise;
  } else {
    const flag = { cancelled: false };
    token = registerJob(key, () => {
      flag.cancelled = true;
    });
    resultPromise = runMir(getMonoPayload(stream.id, buffer), buildMirRequest(analysisId), {
      strictGpu: false,
      isCancelled: () => flag.cancelled,
    });
  }

  try {
    const result = await resultPromise;
    const analysesNow = useAnalysisStore.getState();
    analysesNow.setResult(key, result);
    const meta = (
      result as {
        meta?: { timings?: { totalMs?: number; cpuMs?: number; gpuMs?: number }; backend?: string };
      }
    ).meta;
    if (meta?.timings) {
      analysesNow.setLastRun({
        key,
        totalMs: meta.timings.totalMs,
        cpuMs: meta.timings.cpuMs,
        gpuMs: meta.timings.gpuMs,
        backend: meta.backend,
      });
    }
    return result;
  } catch (e) {
    if (isCancellationError(e)) return null;
    useAnalysisStore.getState().setError(key, (e as Error)?.message ?? String(e));
    throw e;
  } finally {
    releaseJob(key, token);
  }
}

// ----------------------------
// Band-stream path
// ----------------------------

interface BandWork {
  band: BandStream;
  /** Unified analysis ids requested for this band. */
  analysisIds: AnalysisId[];
}

function resolveParentAudio(parentId: StreamId): { parent: AudioStream; buffer: AudioBufferLike } {
  const parent = useStreamStore.getState().getStream(parentId);
  if (!parent || !isAudioStream(parent)) {
    throw new Error(`runStreamAnalysis: band parent "${parentId}" is not an audio stream`);
  }
  const buffer = audioCache.get(parent.id);
  if (!buffer) {
    throw new Error(`runStreamAnalysis: no decoded audio for band parent "${parent.id}"`);
  }
  return { parent, buffer };
}

function bandFnFor(
  analysisId: AnalysisId
): BandMirFunctionId | BandCqtFunctionId | BandEventFunctionId {
  const bandFn = BAND_ANALYSIS_IMPL[analysisId];
  if (!bandFn) {
    throw new Error(`Analysis "${analysisId}" is not available on band streams`);
  }
  return bandFn;
}

/**
 * Get the band-MIR source signal for event extraction, computing it if missing.
 * Prefers onsetEnvelope (bandOnsetStrength), falls back to amplitudeEnvelope.
 */
async function ensureEventSourceSignal(
  parentId: StreamId,
  band: BandStream
): Promise<BandMir1DResult> {
  const analyses = useAnalysisStore.getState();
  for (const sourceId of ["onsetEnvelope", "amplitudeEnvelope"] as const) {
    const existing = analyses.getResult(analysisKey(band.id, sourceId));
    if (existing && existing.kind === "bandMir1d") return existing;
  }
  await runBandFamily(parentId, [{ band, analysisIds: ["onsetEnvelope"] }], "stft");
  const computed = useAnalysisStore.getState().getResult(analysisKey(band.id, "onsetEnvelope"));
  if (!computed || computed.kind !== "bandMir1d") {
    throw new Error(`Could not compute onset source signal for band "${band.id}"`);
  }
  return computed;
}

/**
 * Run one family (stft | cqt | events) of band analyses for a set of bands sharing
 * the same parent. The parent spectrogram/CQT is computed once.
 */
async function runBandFamily(
  parentId: StreamId,
  work: BandWork[],
  family: "stft" | "cqt" | "events"
): Promise<void> {
  if (work.length === 0) return;
  const analyses = useAnalysisStore.getState();
  const { buffer } = resolveParentAudio(parentId);

  // Keys involved, for pending/error lifecycle.
  const keysByBand = work.map(({ band, analysisIds }) =>
    analysisIds.map((id) => ({ analysisId: id, key: analysisKey(band.id, id) }))
  );
  for (const keys of keysByBand) for (const { key } of keys) analyses.setPending(key);

  const flag = { cancelled: false };
  const tokens = keysByBand.flatMap((keys) =>
    keys.map(({ key }) => ({ key, token: registerJob(key, () => (flag.cancelled = true)) }))
  );

  try {
    if (family === "stft") {
      const spec = await getSpectrogram(parentId, buffer);
      const functions = [
        ...new Set(
          work.flatMap((w) => w.analysisIds.map((id) => bandFnFor(id) as BandMirFunctionId))
        ),
      ];
      const { results } = await runBandMirBatch(
        spec,
        { bands: work.map((w) => toFrequencyBand(w.band)), functions },
        { isCancelled: () => flag.cancelled }
      );
      for (const [bandId, bandResults] of results) {
        for (const result of bandResults) {
          const unifiedId = UNIFIED_ID_FOR_BAND_FN.get(result.fn);
          if (unifiedId)
            useAnalysisStore.getState().setResult(analysisKey(bandId, unifiedId), result);
        }
      }
    } else if (family === "cqt") {
      const cqt = await getCqt(parentId, buffer);
      const functions = [
        ...new Set(
          work.flatMap((w) => w.analysisIds.map((id) => bandFnFor(id) as BandCqtFunctionId))
        ),
      ];
      const { results } = await runBandCqtBatch(
        cqt,
        { bands: work.map((w) => toFrequencyBand(w.band)), functions },
        { isCancelled: () => flag.cancelled }
      );
      for (const [bandId, bandResults] of results) {
        for (const result of bandResults) {
          const unifiedId = UNIFIED_ID_FOR_BAND_FN.get(result.fn);
          if (unifiedId)
            useAnalysisStore.getState().setResult(analysisKey(bandId, unifiedId), result);
        }
      }
    } else {
      // Events: each band needs its band-MIR source signal first.
      const bandMirResults = new Map<string, BandMir1DResult[]>();
      for (const { band } of work) {
        bandMirResults.set(band.id, [await ensureEventSourceSignal(parentId, band)]);
      }
      const functions = [
        ...new Set(
          work.flatMap((w) => w.analysisIds.map((id) => bandFnFor(id) as BandEventFunctionId))
        ),
      ];
      const { results } = await runBandEventsBatch({
        bandMirResults,
        functions,
        sourceFunction: "bandOnsetStrength",
      });
      for (const [bandId, bandResults] of results) {
        for (const result of bandResults) {
          const unifiedId = UNIFIED_ID_FOR_BAND_FN.get(result.fn);
          if (unifiedId)
            useAnalysisStore.getState().setResult(analysisKey(bandId, unifiedId), result);
        }
      }
      // Event extraction can silently skip bands (e.g. missing source); fail those keys
      // explicitly rather than leaving them pending forever.
      for (const { band, analysisIds } of work) {
        for (const id of analysisIds) {
          const key = analysisKey(band.id, id);
          if (useAnalysisStore.getState().isPending(key)) {
            useAnalysisStore.getState().setError(key, "Event extraction produced no result");
          }
        }
      }
    }

    // Any keys still pending (e.g. disabled bands skipped by the batch) get cleared.
    for (const keys of keysByBand) {
      for (const { key } of keys) {
        if (useAnalysisStore.getState().isPending(key)) {
          useAnalysisStore.getState().invalidateKey(key);
        }
      }
    }
  } catch (e) {
    for (const keys of keysByBand) {
      for (const { key } of keys) {
        if (isCancellationError(e)) {
          useAnalysisStore.getState().invalidateKey(key);
        } else {
          useAnalysisStore.getState().setError(key, (e as Error)?.message ?? String(e));
        }
      }
    }
    if (!isCancellationError(e)) throw e;
  } finally {
    for (const { key, token } of tokens) releaseJob(key, token);
  }
}

function familyOf(analysisId: AnalysisId): "stft" | "cqt" | "events" {
  const bandFn = bandFnFor(analysisId);
  if (BAND_STFT_FNS.has(bandFn as BandMirFunctionId)) return "stft";
  if (BAND_CQT_FNS.has(bandFn as BandCqtFunctionId)) return "cqt";
  if (BAND_EVENT_FNS.has(bandFn as BandEventFunctionId)) return "events";
  throw new Error(`Unknown band analysis family for "${analysisId}"`);
}

// ----------------------------
// Public API
// ----------------------------

export interface RunAnalysisOptions {
  /** Recompute even if a cached result exists. */
  force?: boolean;
}

/**
 * Run a single analysis on a single stream. Resolves with the result (also stored in
 * analysisStore), the cached result on a cache hit, or null if cancelled.
 */
export async function runStreamAnalysis(
  streamId: StreamId,
  analysisId: AnalysisId,
  options?: RunAnalysisOptions
): Promise<AnalysisResult | null> {
  const stream = useStreamStore.getState().getStream(streamId);
  if (!stream) throw new Error(`runStreamAnalysis: stream "${streamId}" does not exist`);

  const key = analysisKey(streamId, analysisId);
  if (!options?.force) {
    const cached = useAnalysisStore.getState().getResult(key);
    if (cached) return cached;
  }

  if (isAudioStream(stream)) {
    return runAudioStreamAnalysis(stream, analysisId, key);
  }

  const band = stream as BandStream;
  await runBandFamily(band.parentId, [{ band, analysisIds: [analysisId] }], familyOf(analysisId));
  return useAnalysisStore.getState().getResult(key);
}

/**
 * Run several analyses across several streams. Band streams are grouped by parent and
 * family so each parent spectrogram/CQT is computed once per group. Audio streams run
 * sequentially (the worker processes one job at a time anyway).
 */
export async function runStreamAnalyses(
  streamIds: StreamId[],
  analysisIds: AnalysisId[],
  options?: RunAnalysisOptions
): Promise<void> {
  const streamStore = useStreamStore.getState();
  const audioStreams: AudioStream[] = [];
  const bandsByParent = new Map<StreamId, BandStream[]>();

  for (const id of streamIds) {
    const stream = streamStore.getStream(id);
    if (!stream) continue;
    if (isAudioStream(stream)) {
      audioStreams.push(stream);
    } else if (isBandStream(stream)) {
      const group = bandsByParent.get(stream.parentId) ?? [];
      group.push(stream);
      bandsByParent.set(stream.parentId, group);
    }
  }

  for (const stream of audioStreams) {
    for (const analysisId of analysisIds) {
      await runStreamAnalysis(stream.id, analysisId, options);
    }
  }

  for (const [parentId, bands] of bandsByParent) {
    const byFamily: Record<"stft" | "cqt" | "events", BandWork[]> = {
      stft: [],
      cqt: [],
      events: [],
    };
    for (const band of bands) {
      const grouped: Record<"stft" | "cqt" | "events", AnalysisId[]> = {
        stft: [],
        cqt: [],
        events: [],
      };
      for (const analysisId of analysisIds) {
        if (!(analysisId in BAND_ANALYSIS_IMPL)) continue; // unsupported on bands: skip in batch mode
        const key = analysisKey(band.id, analysisId);
        if (!options?.force && useAnalysisStore.getState().getResult(key)) continue;
        grouped[familyOf(analysisId)].push(analysisId);
      }
      for (const family of ["stft", "cqt", "events"] as const) {
        if (grouped[family].length > 0) {
          byFamily[family].push({ band, analysisIds: grouped[family] });
        }
      }
    }
    // Order matters: events depend on stft results.
    await runBandFamily(parentId, byFamily.stft, "stft");
    await runBandFamily(parentId, byFamily.cqt, "cqt");
    await runBandFamily(parentId, byFamily.events, "events");
  }
}
