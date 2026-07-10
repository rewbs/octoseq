# Phase 1 Migration Map: legacy stores → unified streams

Mechanical mapping for porting consumers. The unified model lives in
`apps/web/src/lib/streams` (import from `@/lib/streams`). Design rationale:
[phase1-unified-streams.md](phase1-unified-streams.md).

Rules of engagement for porters:

- Direct rewire: replace legacy reads/writes with unified equivalents. Do NOT keep
  dual writes or fallbacks to legacy stores.
- Do not change component behavior or markup beyond what the data-model change forces.
- If a legacy concept has no mapping here, STOP and report it instead of inventing one.
- React components subscribe with hooks (`useStreamStore((s) => ...)`); non-React code
  uses `useStreamStore.getState()`.

## Stream collection (was audioInputStore)

| Legacy (`useAudioInputStore`)                                 | Unified                                                                        |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `collection.inputs[id]` / `getInputById(id)`                  | `useStreamStore.getState().getStream(id)` (returns `Stream` or null)           |
| `getMixdown()`                                                | `useStreamStore.getState().getMixdown()`                                       |
| `getStems()`                                                  | `useStreamStore.getState().getStems()`                                         |
| `hasStems()`                                                  | `getStems().length > 0`                                                        |
| `getAudio()` (mixdown PCM)                                    | `audioCache.get(MIXDOWN_STREAM_ID)`                                            |
| `input.audioBuffer`                                           | `audioCache.get(stream.id)`                                                    |
| `input.metadata.duration`                                     | `stream.audio.durationSec` (AudioStream only)                                  |
| `input.metadata.sampleRate`                                   | `stream.audio.sampleRate`                                                      |
| `input.metadata.totalSamples`                                 | `Math.round(audio.durationSec * audio.sampleRate)` or read PCM length          |
| `input.label`                                                 | `stream.label`                                                                 |
| `input.role` ("mixdown"\|"stem")                              | `stream.kind`                                                                  |
| `input.audioUrl`                                              | `stream.audio.url`                                                             |
| `input.origin` (kind file/url/stem/synthetic)                 | `stream.audio.origin` (kind file/url/separated/generated)                      |
| `input.cloudAssetId` / `assetId` / `contentHash` / `mimeType` | same fields on `stream.audio` (AudioReference)                                 |
| `input.rawBuffer`                                             | `rawFileCache.get(stream.id)` (set on load, delete after upload)               |
| `MIXDOWN_ID`                                                  | `MIXDOWN_STREAM_ID`                                                            |
| `initializeWithMixdown(...)` / `updateMixdown(...)`           | `loadMixdown({ audio: AudioReference, buffer, label? })`                       |
| `addStem({...})`                                              | `addStemWithAudio({ label, audio: AudioReference, buffer })`                   |
| `replaceStem(id, {...})`                                      | `replaceStreamAudio(id, audioReference, buffer)`                               |
| `renameInput(id, label)`                                      | `useStreamStore.getState().renameStream(id, label)`                            |
| `reorderStems(ids)`                                           | `useStreamStore.getState().reorderStreams(ids)`                                |
| `removeStem(id)`                                              | `removeStreamCascade(id)` (returns removed streams incl. bands)                |
| `restoreStem(...)`                                            | `useStreamStore.getState().restoreStreams(removed)`                            |
| `setCloudAssetId(id, assetId)`                                | `useStreamStore.getState().updateAudio(id, { ...stream.audio, cloudAssetId })` |
| `clearCollection()` / `reset()`                               | `resetAllStreams()`                                                            |
| `selectedInputId` / `selectInput(id)`                         | `selectedStreamId` / `selectStream(id)` on streamStore                         |
| `activeDisplayId` / `setActiveDisplay(id)`                    | `useAudioSourceStore` `displayedStreamId` / `setDisplayedStream(id)`           |

## Playback source (was audioInputStore AudioSource section)

| Legacy                                          | Unified (`useAudioSourceStore`)            |
| ----------------------------------------------- | ------------------------------------------ |
| `currentAudioSource`                            | `currentSource`                            |
| `setCurrentAudioSource(src)`                    | `setCurrentSource(src)`                    |
| `updateAudioSourceStatus(status, url?, error?)` | `updateSourceStatus(status, url?, error?)` |
| `getCurrentAudioUrl()`                          | `getCurrentUrl()`                          |
| `pendingFileName` / `setPendingFileName`        | same names on `useAudioSourceStore`        |
| `triggerFileInput` / `setTriggerFileInput`      | same names on `useAudioSourceStore`        |
| `AudioSource`/`LocalAudioSource`/… types        | import from `@/lib/streams`                |

`AudioSource.id` is now a `StreamId`.

## MIR execution (was useMirActions / useBandMirActions)

| Legacy                                                                                                         | Unified                                                                                    |
| -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `runAnalysis(fn, inputId?, cacheKey?)`                                                                         | `runStreamAnalysis(streamId, analysisId)`                                                  |
| `runAllAnalyses()` / `runAllAnalysesForInput(id)`                                                              | `runStreamAnalyses([streamId], ALL_ANALYSES)`                                              |
| `cancelAnalysis()`                                                                                             | `cancelAnalysis(streamId, analysisId)` or `cancelAllAnalyses()`                            |
| `runBandAnalysis(bandIds, fns, sourceId)`                                                                      | `runStreamAnalyses(bandStreamIds, unifiedIds)`                                             |
| `runBandCqtAnalysis(...)` / event extraction                                                                   | same — unified ids (`cqtHarmonicEnergy`, `onsetPeaks`, …)                                  |
| band fn ids (`bandAmplitudeEnvelope`, `bandOnsetStrength`, `bandCqt*`, `bandOnsetPeaks`, `bandBeatCandidates`) | unified ids (`amplitudeEnvelope`, `onsetEnvelope`, `cqt*`, `onsetPeaks`, `beatCandidates`) |

The runner dispatches on stream kind; never check "is this a band" before running.

## MIR results (was mirStore.mirResults / mirStore.inputMirCache / bandMirStore caches)

| Legacy                                           | Unified                                                                     |
| ------------------------------------------------ | --------------------------------------------------------------------------- |
| `mirResults[fn]` (mixdown)                       | `useAnalysisStore.getState().getResult(analysisKey(MIXDOWN_STREAM_ID, fn))` |
| `inputMirCache.get(\`${inputId}:${fn}\`)`        | `getResult(analysisKey(inputId, fn))`                                       |
| `bandMirStore.getCached(bandId, bandFn)`         | `getResult(analysisKey(bandId, unifiedId))`                                 |
| `bandMirStore.getCqtCached(bandId, fn)`          | `getResult(analysisKey(bandId, unifiedId))`                                 |
| `bandMirStore.getEventsCached` / typed events    | `getResult(analysisKey(bandId, "onsetPeaks" \| "beatCandidates"))`          |
| `isPending` variants                             | `useAnalysisStore.getState().isPending(key)`                                |
| invalidation listener bus (`onBandInvalidation`) | delete — `streamActions` invalidates explicitly                             |

React subscription pattern (Maps need shallow-safe selection):

```ts
const result = useAnalysisStore((s) => s.results.get(analysisKey(streamId, analysisId)));
const pending = useAnalysisStore((s) => s.pending.has(analysisKey(streamId, analysisId)));
```

**Display normalization**: legacy mirStore values were pre-normalized
(`normaliseForWaveform`, centroid centered, flux ±1). Unified results are RAW.
At the display edge, use:

```ts
import { toDisplaySignal, toDisplayEvents } from "@/lib/streams";
const display = result ? toDisplaySignal(result, analysisId) : null; // {times, values}
const events = result ? toDisplayEvents(result) : null; // uniform event list
```

`UiMirResult` shapes (`{kind, fn, times, values}` / `{kind, fn, times, events}`) map to
raw `AnalysisResult` + these helpers. `tempoHypotheses` results keep their raw shape.

## Frequency bands (was frequencyBandStore.structure.bands)

| Legacy (`FrequencyBand`)                                           | Unified (`BandStream` in streamStore)                                         |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| `structure.bands`                                                  | `useStreamStore.getState().getBands()` (or per parent)                        |
| `band.sourceId`                                                    | `band.parentId`                                                               |
| `band.frequencyShape/timeScope/provenance/enabled/label/sortOrder` | same names on `BandStream`                                                    |
| create band                                                        | `addBand({ parentId, label, frequencyShape, ... })`                           |
| edit shape                                                         | `updateBandShape(id, { frequencyShape?, timeScope? })` (invalidates analyses) |
| remove band                                                        | `removeStreamCascade(id)`                                                     |
| `selectedBandId`                                                   | `streamStore.selectedStreamId`                                                |
| mir `FrequencyBand` for band fns                                   | `toFrequencyBand(bandStream)` adapter                                         |

UI-only band editing state (hover, drag, snap, solo/mute, sidebar) is NOT in
streamStore — see task-4 notes in the design doc.

## Notes

- Decoded PCM (`AudioBufferLike`) NEVER goes into a Zustand store. Use `audioCache`.
- The unified stores throw on programmer errors (missing parent, band-of-band,
  removing mixdown). Do not wrap in try/catch to silence; fix the call site.
- `streamStore.streams` is a `Map` — for React lists select with a stable derived
  array, e.g. `useStreamStore((s) => s.getStems())` is NOT referentially stable;
  prefer `useStreamStore((s) => s.streams)` + `useMemo` over it, or select primitive
  fields. (Same pattern the codebase already uses for Map-holding stores.)
