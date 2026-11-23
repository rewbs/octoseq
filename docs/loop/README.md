# The Build Loop

How Octoseq gets built in large autonomous chunks, with human judgement collected in
batches instead of blocking the work. This supports the redesign in
[../design/redesign-deliverable.md](../design/redesign-deliverable.md).

## The problem it solves

The redesign's success test is "fun to watch", which only a person can judge. If
every change waited on that judgement, nothing could be built unattended. The loop
splits the question in two:

- **Is the output broken or measurably dull?** A machine can answer this, so it is
  checked automatically on every change.
- **Is it actually good?** A person answers this, but only at the end of a chunk of
  work, for many clips at once, and each answer is turned into a tighter automatic
  check so the same question is not asked twice.

## Two loops

| Loop              | Question it answers                                      | Ground truth                               | Command                  |
| ----------------- | -------------------------------------------------------- | ------------------------------------------ | ------------------------ |
| **Render loop**   | Is the picture broken or measurably dull?                | None needed: properties of the frames      | `tools/loop/run.py`      |
| **Accuracy loop** | Does the analysis put musical events at the right times? | Tracker modules, where every note is known | `tools/loop/accuracy.py` |

Neither needs a person to run or to judge.

## Running the render loop

```bash
python3 tools/loop/run.py                # every scene on every test track, 30 s each
python3 tools/loop/run.py --seconds 0    # whole tracks
python3 tools/loop/run.py --scenes 'example-scripts/05-*.rhai' --tracks data/super.mp3
python3 tools/loop/run.py --tracks tools/loop/fixtures/modules/synth-0001.mod
python3 tools/loop/run.py --save-baseline
python3 tools/loop/selftest.py           # checks the render loop's own instruments
```

Requirements: Rust, Python 3 with numpy, ffmpeg, and a Vulkan driver. On a machine
with no GPU, Mesa's software driver works (`apt-get install mesa-vulkan-drivers`) and
renders 480x270 at roughly real time.

Each run writes `.loop/runs/<name>/` (not committed):

- `report.md` — one table of results, with changes against the saved baseline
- `report.json` — the same, machine-readable
- `<track>__<scene>/clip.mp4` — the rendered clip with audio
- `<track>__<scene>/sheet.png` — 24 frames across the clip in one image

The run exits non-zero if any hard gate fails.

A track can be a tracker module instead of an audio file. The scene is then driven by
known-correct events rather than analysis (see "Perfect bundles" below).

## What the render loop checks

| Check            | Kind   | Catches                                                      |
| ---------------- | ------ | ------------------------------------------------------------ |
| Render completes | hard   | Crashes and script errors                                    |
| Determinism      | hard   | Two renders of the same input producing different frames     |
| Black frames     | hard   | Output that is mostly black                                  |
| Blown-out frames | hard   | Feedback running away to white                               |
| Frozen picture   | hard   | Nothing moving                                               |
| Flash rate       | hard   | Strobing above three flashes a second (the WCAG 2.3.1 limit) |
| Active area      | target | Small objects on an empty background                         |
| Jerkiness        | target | Motion that jumps rather than flows                          |
| Audio sync       | target | Picture that does not follow the music                       |
| Variety          | target | A look that never changes over the clip                      |
| Colourfulness    | target | Grey, washed-out output                                      |

Hard gates mean the output is broken. Targets describe where the redesign is heading;
they only warn, and most are expected to fail until the feedback-first rendering work
lands. Thresholds live in `tools/loop/gates.json` and are provisional until
calibrated against human ratings.

**These metrics cannot certify that a clip is fun.** They rule out the ways a clip is
obviously not.

## The accuracy loop

```bash
tools/loop/modplayer/build.sh              # once: build the instrumented module player
python3 tools/loop/corpus.py restore       # once: download the corpus listed in the manifest
python3 tools/loop/accuracy.py             # score every analyser, both splits, all variants
python3 tools/loop/accuracy.py --quick     # committed fixtures only; about 20 seconds
python3 tools/loop/tune.py --apply         # search parameters on the training split
python3 tools/loop/accuracy.py --save-baseline
python3 tools/loop/perfect_bundle.py song.xm
```

### Why tracker modules

A tracker module is a score and its instruments in one file. Played by a
deterministic player, it yields both the audio and an exact record of every note:
when it started, on which channel, with which instrument. That is ground truth for
event timing that no hand-labelled dataset matches, and it can be produced in any
quantity.

### How the reference is made

1. **Instrumented player** (`tools/loop/modplayer/`). OpenMPT's playback engine with a
   small patch that reports every sample (re)start that becomes audible, to the
   output sample, along with the row and tempo grid. Tone-portamento glides, notes at
   zero volume and notes cut before they sound are not reported. The same module is
   also rendered once per channel with everything else muted, giving true stems.
   Rendering is deterministic: fixed interpolation, fixed ramping, no dither, a
   fixed seed for random instrument variation. The patch is applied to a pinned
   upstream commit at build time; nothing from OpenMPT is committed here and Octoseq
   does not depend on it.
2. **Heard-event times** (`modref.py`). A trigger is when the player started a sample,
   not when a listener hears it: the sample may begin with silence or fade in. For
   each trigger the channel's own audio is measured for its physical onset, its
   steepest rise and its peak. Events are labelled percussive (fast attack), soft
   (slow attack) or legato (no rise in level, only a change of pitch), and weighted
   by loudness and by how far the rest of the mix masks them. Triggers on different
   channels within 30 ms are merged into one event for scoring the full mix.
3. **Beats, sections, stems.** Beats and downbeats come from the row grid, section
   boundaries from changes in instrumentation between order-list positions, and the
   drums/bass/other stems from summing channels by what they play.

### What is scored

Every analyser in `tools/loop/analysers.py` is scored the same way, whatever it is
underneath: signal processing, a local model or a hosted API. An analyser returns any
of onsets, beats, sections and stems; parts it does not produce are skipped.

| Part     | Measure                                                                                                                        |
| -------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Onsets   | Precision, loudness-weighted recall and F within 50 ms; mean signed timing error (bias) and spread, overall and per event type |
| Beats    | F within 70 ms at the reference's level, and at half, double and off-beat levels; tempo accuracy                               |
| Sections | Boundary F within 0.5 s and 3 s                                                                                                |
| Stems    | Scale-invariant SDR per stem, and its improvement over the unseparated mix                                                     |

The timing target is a bias under one 60 fps frame, about 17 ms.

The report names the best analyser for each part, judged on the held-out split. That
is how local models and hosted APIs will be chosen between as they are added.

### Guards against fooling ourselves

- **Instrument checks.** Before any analyser is scored, the loop checks its own
  equipment against synthetic modules whose answers are known independently: the
  event log matches triggers computed from the pattern data, stems add up to the mix,
  a sample with known leading silence is heard at the right time, attack types and
  stems are labelled correctly, the scorer gives perfect detections a perfect score
  and measures a known delay, and rendering twice gives identical output.
- **Held-out split.** Tuning sees only the training split. Every module's split is
  fixed (by seed, manifest or directory) and never changes.
- **Degraded variants.** Tracker renders are dry, uncompressed and lossless; real
  releases are not. Each track is also scored through reverb, heavy compression and
  an MP3 round trip.
- **Real-music check.** `data/*.mp3` has no ground truth, so it is used for what can
  be measured without one: whether detections on the original survive degradation,
  and whether their density is plausible. Tuned parameters are rejected if this
  falls.

### Self-tuning

`tune.py` searches the parameters of `analyse.py` by deterministic coordinate descent
on the training split, cancels the remaining timing bias exactly, and then judges the
result on the held-out split and the real-music check. It adopts the result (writes
`params.json`, which `analyse.py` then uses by default) only if every acceptance rule
in the script's header passes.

### Perfect bundles

`perfect_bundle.py` converts a module straight into an analysis bundle whose events
come from the reference, not from analysis: merged events, one stream per stem, per
attack type and per sample, section starts, the module's own tempo grid, and stem
signals measured on the true stems. `run.py` accepts a module as a track and uses
this bundle, so a scene can be developed against events known to be right, then
rendered from an analysed bundle to see what analysis errors cost.

### Corpus and licensing

| Source                                         | Where it lives                                                                               | Committed?                                                                                        |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Synthetic modules from `modgen.py`             | `tools/loop/fixtures/modules/` (four regression fixtures); the rest generated into the cache | Yes: generated here, no third-party content                                                       |
| Modules The Mod Archive lists as Public Domain | `.loop/cache/modules/modarchive/`                                                            | No. `tools/loop/corpus/manifest.json` records each one's source page, stated licence and checksum |
| Your own modules, such as ScreamSeq exports    | `.loop/modules/train/` or `.loop/modules/heldout/`                                           | No                                                                                                |

## How a chunk of work runs

1. **Start from exit gates.** Each chunk is defined by conditions the loop can check
   without a person (see the chunk list below).
2. **Iterate.** Change code, run the loop, read `report.md`, look at the contact
   sheets, repeat. The agent doing the work looks at the sheets itself; this is a
   cheap first pass on taste, not a substitute for the human review.
3. **Do not stop for judgement calls.** When a decision would normally need a person,
   take the most reversible default, record it in [queue.md](queue.md) under
   "Decisions taken by default", and carry on.
4. **End with a review pack.** When the gates pass, publish a page of clips with a
   rating and a comment box for each, and add it to the queue.
5. **Fold the answers back in.** Ratings and comments become fixes, and wherever
   possible a new or tightened gate, so the loop catches that problem next time.

Things only the project owner can supply (test tracks, API keys, spending approval)
are listed in the queue up front with exactly what each one blocks, so work that does
not depend on them continues.

## Chunks for milestone 1

Each chunk can be built unattended. "Gates" are the automatic exit conditions.

| Chunk                                | Gates                                                                                                                                                                                                                                                                                            | Human input at the end                            |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------- |
| **0. Analysis-accuracy loop** (done) | Instrument checks all pass; `accuracy.py` scores onsets, beats, sections and stems on both splits and all variants and exits zero; tuned parameters are adopted only under the rules in `tune.py`; the engine renders a scene from a perfect bundle; committed fixtures regenerate byte-for-byte | None                                              |
| **1. Analysis bundle and worker**    | Bundle schema validates; every analyser is registered in `analysers.py` and scored by the accuracy loop, and the chosen analyser for each part meets the accuracy targets on the held-out split; stem and analysis adaptors pass contract tests; stored bundle is reused, never recomputed       | API keys to verify adaptors against live services |
| **2. Role binding**                  | Engine tests pass; a scene asking for an unavailable role fails with a clear error; every scene renders on every track                                                                                                                                                                           | None                                              |
| **3. Feedback-first rendering**      | No hard-gate failures; active area and jerkiness targets met on a reference scene; deterministic; the WASM build still compiles                                                                                                                                                                  | None                                              |
| **4. Scenes, director, one command** | Every scene on every track passes hard gates and targets over the whole track; two runs of the director differ; each resulting show re-renders identically                                                                                                                                       | Review pack 1: rate the clips                     |

## Limits of the loops today

- **Stand-in analysis.** `tools/loop/analyse.py` uses signal processing only: no
  stems, no sections, a single global tempo. It exists so the loops can run before
  chunk 1 delivers the real worker.
- **Two real test tracks.** `data/` has one 18-second and one 283-second track. The
  milestone 1 exit test needs ten.
- **Software rendering.** Fine for 480x270 checks; full-resolution renders want a GPU.
- **Uncalibrated render thresholds.** No human ratings exist yet to calibrate against.
- **Tracker music is not all music.** Modules have no vocals, no live playing and no
  mastering. The degraded variants and the real-music check reduce the risk of
  tuning to that, but do not remove it.
- **Baseline analysers for sections and stems are deliberately crude.** They exist so
  those scorers are exercised and so real analysers have something to beat.
- **Beat level is ambiguous in modules.** A module does not say which metrical level
  is the beat, so the half, double and off-beat levels are reported alongside.
