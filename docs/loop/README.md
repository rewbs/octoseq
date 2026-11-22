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

## Running it

```bash
python3 tools/loop/run.py                # every scene on every test track, 30 s each
python3 tools/loop/run.py --seconds 0    # whole tracks
python3 tools/loop/run.py --scenes 'example-scripts/05-*.rhai' --tracks data/super.mp3
python3 tools/loop/run.py --save-baseline
python3 tools/loop/selftest.py           # checks the loop's own instruments
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

## What is checked

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

| Chunk                                | Gates                                                                                                                                                                                            | Human input at the end                            |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------- |
| **1. Analysis bundle and worker**    | Bundle schema validates; tempo, onsets and sections recovered from synthetic audio with known answers; stem and analysis adaptors pass contract tests; stored bundle is reused, never recomputed | API keys to verify adaptors against live services |
| **2. Role binding**                  | Engine tests pass; a scene asking for an unavailable role fails with a clear error; every scene renders on every track                                                                           | None                                              |
| **3. Feedback-first rendering**      | No hard-gate failures; active area and jerkiness targets met on a reference scene; deterministic; the WASM build still compiles                                                                  | None                                              |
| **4. Scenes, director, one command** | Every scene on every track passes hard gates and targets over the whole track; two runs of the director differ; each resulting show re-renders identically                                       | Review pack 1: rate the clips                     |

## Limits of the loop today

- **Stand-in analysis.** `tools/loop/analyse.py` uses signal processing only: no
  stems, no sections, a single global tempo. It exists so the loop can run on real
  tracks before chunk 1 delivers the real worker.
- **Two test tracks.** `data/` has one 18-second and one 283-second track. The
  milestone 1 exit test needs ten.
- **Software rendering.** Fine for 480x270 checks; full-resolution renders want a GPU.
- **Uncalibrated thresholds.** No human ratings exist yet to calibrate against.
