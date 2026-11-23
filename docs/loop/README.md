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

## One command

```bash
python3 tools/loop/video.py data/dontstop.mp3            # -> .loop/videos/dontstop-<seed>.mp4
python3 tools/loop/video.py data/dontstop.mp3            # again: a different show
python3 tools/loop/video.py data/dontstop.mp3 --seed 7   # the show seed 7 made before
python3 tools/loop/video.py song.xm --width 1280 --height 720
python3 tools/loop/video.py data/dontstop.mp3 --seed 7 --vivid   # the same show in stronger colours
python3 tools/loop/video.py data/dontstop.mp3 --seed 7 --fps 120            # 120 frames a second
python3 tools/loop/video.py data/dontstop.mp3 --seed 7 --step-rate 120      # 30 fps, the 120 fps picture
```

Track in, video out. It builds the bundle (once per track), has the director make a
show, renders every frame and muxes the audio in.

The **director** (`tools/loop/director.py`) decides which scene plays when and in
what colours. Its rules: change the look at section starts; hold no look longer than
nine seconds, changing it again on the beat in longer sections; cut at a section
start and blend over four beats inside a section; never the same scene or place in
the frame twice running; a new palette at each section and the same one within it;
louder sections run faster. The rest is chance, from a seed drawn fresh each run and written into the
show. A show is a directory under `.loop/shows/` holding `show.json` and a copy of
each scene as it was, with its colours and speed filled in, so the show keeps
rendering the same frames after the scenes it came from have changed.

In a **blend** both scenes run and draw. What they draw is mixed by how far the
blend has got, and so are their feedback warps, inside the one feedback loop: the
old picture's trails bend towards the new scene's motion while the new scene
arrives. A show's segment asks for one with `"transition": <seconds>`; without it
the segment cuts in.

### Frame rate and step rate

The engine steps once for each frame it saves unless told otherwise, and a scene
built on the feedback loop is not quite the same picture at every step rate. The
loop's settings are scaled to the step (a decay of 0.96 keeps 96% every thirtieth of
a second however often the loop runs), so trails last as long and travel as far. But
a moving shape leaves a stamp at every step, so more steps draw a smoother, denser
trail.

`--step-rate 120` has the engine step 120 times a second whatever the frame rate and
save only the frames asked for. A 30 fps render is then the 120 fps render with three
frames in four left out, byte for byte, and the render loop checks that on every run.
It takes about 6% longer to make (115 s against 108 s for 90 s of video): saving frames is
what takes the time, not drawing them.
The default is one step a frame, which is the picture every scene here was made at;
the owner chose to keep it (D98 in the queue).

Anything new in the engine that acts once a step has to be scaled to the step's
length (`FEEDBACK_REFERENCE_FPS` in `feedback.rs`), or it will run four times as
fast at 120 steps a second. The loop itself is kept in 16-bit float between steps:
in the output's 8 bits a small fade rounds back to where it started and never
finishes (D99).

### Editing a show

The director proposes; `tools/loop/show.py` is how a person changes what it proposed
and keeps those changes when the director is asked again.

```bash
python3 tools/loop/show.py list   .loop/shows/dontstop-1
python3 tools/loop/show.py set    .loop/shows/dontstop-1 3 --scene quartet.rhai --palette ice
python3 tools/loop/show.py split  .loop/shows/dontstop-1 41.5      # a new look from 41.5 s
python3 tools/loop/show.py pin    .loop/shows/dontstop-1 0 1       # these are mine
python3 tools/loop/show.py reroll .loop/shows/dontstop-1 --bundle <package.json> --seed 5
python3 tools/loop/video.py data/dontstop.mp3 --show .loop/shows/dontstop-1
```

Anything `set` or `split` touches is pinned. `reroll` asks the director for a new
show and puts every pinned segment back at its own time, with its own scene copy
byte for byte. An edit that would leave a show the engine cannot play is refused
and nothing is written. The show records what was done to it.

### What the scenes can ask for that Milkdrop cannot give

Milkdrop hears three frequency bands of the last 11 milliseconds. A bundle knows
the whole track, taken apart:

- **The band, separately.** With the model environment, a bundle carries the level
  of each separated stem, as the roles `drums`, `bass`, `melody` (everything else)
  and `vocals`. `quartet` gives each its own place in the frame.
- **What is coming.** An envelope can start rising before its event. In `orbit` the
  cube draws itself in during the beat before each hit and bursts on it.
- **Where in the music we are.** `beat_phase`, `bar_phase`, `section_progress`:
  in `orbit` the light beats with the beat itself and the trails calm at the start
  of every section and rise to a boil by its end.
- **Solid geometry.** `orbit` is 3D shapes seen from a moving camera, drawn into the
  same feedback loop as everything else.

## Running the render loop

```bash
python3 tools/loop/run.py                # every scene on every test track, 30 s each
python3 tools/loop/run.py --seconds 0    # whole tracks
python3 tools/loop/run.py --scenes scenes/pulse.rhai --tracks data/super.mp3
python3 tools/loop/run.py --scenes director            # only the directed shows
python3 tools/loop/run.py --tracks tools/loop/fixtures/modules/synth-0001.mod
python3 tools/loop/run.py --save-baseline
python3 tools/loop/selftest.py           # checks the render loop's own instruments
```

Setup for a new machine is in [setup.md](setup.md). Requirements: Rust, Python 3 with numpy, ffmpeg, and a Vulkan driver. On a machine
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
| Punch            | target | A picture that eases through the music's hits instead of jumping on them |
| Look change      | target | The same picture as eight seconds ago                        |
| One-hue share    | target | One colour everywhere                                        |
| Wash             | tracked | How much of the frame is saturated mid-tone colour: misty when high, crisp when low. Not a target (D85) |
| Wash spread      | tracked | Whether a clip has both misty and crisp stretches, which is what is wanted |
| Flow speed       | target | A picture that sits still where Milkdrop's travels            |
| Flow swirl       | target | Motion that is one rigid slide, zoom or turn of the whole frame |

Before the clips, each run also checks the engine with scenes whose right answer is
known (`tools/loop/fixtures/scenes/`): a feedback loop built to run away must stay
below white, and the same loop with the bound switched off must blow out.

Punch, look change and one-hue share, and a looser jerkiness target, came out of
review 1, where a clip that met every target of the time was rated 2 out of 5 (see
[queue.md](queue.md)). A fourth, a limit on wash, was dropped by the owner later: a
show should have misty looks and crisp ones, so the loop now reports how far wash
ranges over a clip instead of how high it is.

Hard gates mean the output is broken. Targets describe where the redesign is heading;
they only warn, and most are expected to fail until the feedback-first rendering work
lands. Thresholds live in `tools/loop/gates.json` and are provisional until
calibrated against human ratings.

**These metrics cannot certify that a clip is fun.** They rule out the ways a clip is
obviously not.

## The Milkdrop reference

Milkdrop is what the redesign is aiming at for dynamism, variety and pace, so the
loop can render it and measure it the same way it measures ours.

```bash
tools/loop/projectm/build.sh              # once: builds projectM and our offline renderer for it
python3 tools/loop/milkdrop.py render     # 24 presets on the test tracks, about 20 minutes
python3 tools/loop/milkdrop.py compare    # the newest loop run beside the reference
```

`pm_render` drives an unmodified projectM through its C API with no window and a
clock set from the frame number. `milkdrop.py render` renders each preset in
`tools/loop/milkdrop_presets.txt` on each track and writes the spread of every
figure to `tools/loop/milkdrop_reference.json`, which is committed: every loop
report ends with our clips beside it, on a machine with no projectM too.
[docs/design/milkdrop-study.md](../design/milkdrop-study.md) has what the study
found.

`tools/loop/motion.py` adds the figures that show the difference: how fast the
picture flows where it moves (`flow_speed`), how much of that motion is not one
rigid movement of the whole frame (`flow_swirl`), how much of the picture is flat
colour (`flat_area`), and how much it changes over a quarter of a second and over
two. Two of them are targets, set at the level nine in ten reference clips reach.

## The accuracy loop

```bash
tools/loop/modplayer/build.sh              # once: build the instrumented module player
python3 tools/loop/corpus.py restore       # once: download the corpus listed in the manifest
python3 tools/loop/accuracy.py             # score every analyser, both splits, all variants
python3 tools/loop/accuracy.py --quick     # committed fixtures only; about 20 seconds
python3 tools/loop/tune.py --apply         # search parameters on the training split
python3 tools/loop/accuracy.py --save-baseline
python3 tools/loop/perfect_bundle.py song.xm

tools/loop/models/setup.sh                    # optional: install model-based analysers
.loop/venv/bin/python tools/loop/accuracy.py  # the same loop, with the models included

python3 tools/loop/stems.py status            # which stem sources can run on this machine
python3 tools/loop/stems.py demucs song.mp3   # separate one file with one source
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
   each trigger the channel's own audio is measured for its physical onset, the point
   halfway up its rise, its steepest rise and its peak. Analysis is scored against the
   halfway point: for a fast attack all four are within a millisecond or two, and for
   a slow one it is the only one that is well defined. Events are labelled percussive
   (fast attack), soft (slow attack) or legato (no rise in level, only a change of
   pitch), and weighted by loudness and by how far the rest of the mix masks them.
   Notes heard within 30 ms of each other, or triggered on the same tick and heard
   within 50 ms, are merged into one event for scoring the full mix.
3. **Beats, sections, stems.** Beats and downbeats come from the row grid, section
   boundaries from changes in instrumentation between order-list positions, and the
   drums/bass/other stems from summing channels by what they play.
4. **Drum hits by type.** Each drum sample is typed kick, snare or hat from where the
   energy of its hits lies, heard alone on its own channel: mostly below 250 Hz is a
   kick, mostly above 4 kHz a hat, in between a snare. Claps count as snares, cymbals
   and shakers as hats, and toms as none of the three. The rule was set on training
   modules whose sample names say what they are, and the loop checks it against
   sample names on every run.

### What is scored

Every analyser in `tools/loop/analysers.py` is scored the same way, whatever it is
underneath: signal processing, a local model or a hosted API. An analyser returns any
of onsets, beats, sections and stems; parts it does not produce are skipped.

| Part     | Measure                                                                                                                        |
| -------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Onsets   | Precision, loudness-weighted recall and F within 50 ms; mean signed timing error (bias) and spread, overall and per event type |
| Beats    | F within 70 ms at the reference's level, and at half, double and off-beat levels; tempo accuracy                               |
| Sections | Boundary F within 0.5 s and 3 s                                                                                                |
| Drum hits | Precision, recall and F within 50 ms for kicks, snares and hats separately, and their timing bias; clean audio                 |
| Stems    | Scale-invariant SDR per stem, and its improvement over the unseparated mix                                                     |

The timing target is a bias under one 60 fps frame, about 17 ms.

The drum detector listens either to the full mix (`drumbands`) or to the drum stem
local Demucs separates (`drumbands_stem`). Its settings are tuned on the training
split by `tools/loop/tune_drums.py` and kept in `tools/loop/drum_params.json`.

Model-based analysers are optional. `tools/loop/models/setup.sh` installs them into
their own environment under `.loop/`; run the loop with that environment's Python to
include them, or with the system Python to leave them out. They run only on the
held-out split, since they are slow and are not tuned here. What each returns for a
file is kept in `.loop/cache/model-results`, so only the first run pays for it. An
analyser that needs a separation for every module is scored on every third held-out
module, and its rows say so.

The report names the best analyser for each part, judged on the held-out split. That
is how local models and hosted APIs will be chosen between as they are added.

### Stem sources

Stems come from one interface, `tools/loop/stems.py`, whatever is behind it:

| Source                | What it is                                          | Needs                                       |
| --------------------- | --------------------------------------------------- | ------------------------------------------- |
| `user`                | Stem files the user already has, labelled           | The files                                   |
| `lalal`               | LALAL.AI (hosted)                                   | `LALALAI_API_KEY`                           |
| `fal_demucs`          | Demucs hosted on fal.ai                             | `FAL_KEY`                                   |
| `musicai`             | Music.ai (hosted). **Unverified**: never run        | `MUSICAI_API_KEY`, `MUSICAI_STEMS_WORKFLOW` |
| `demucs`, `demucs_ft` | Demucs run locally, plain and fine-tuned (4x slower) | The model environment                       |

Every source returns labelled files (`vocals`, `drums`, `bass`, `other`, plus extras)
and records what produced them. Results are cached by the audio's checksum, so a
paid separation is bought once.

Each source is also an analyser, scored against the true stems of eight held-out
modules: three synthetic and five downloaded, the first of each that have drums,
bass and other on channels of their own and are under four minutes. Modules have no
vocals, so anything a source returns beyond drums and bass counts as `other`.
`user_stems` hands the true stems back through the interface; it checks the
interface and is not a candidate. A hosted source with no key is reported as not
run, or with the scores recorded in `tools/loop/hosted_stem_scores.json` the last
time it did run on the same modules.

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

### Roles

Scenes ask for musical roles, not for named signals: a scene declares
`//! roles: kick, energy` and reads `roles.kick`. Every bundle the loop builds carries
a `roles` table saying what each role is bound to (`tools/loop/roles.py`; the list of
roles is in [scripting.md](../../scripting.md#musical-roles)). A perfect bundle binds
them to the truth: the module's own beats and bars, its sections, its kicks, snares
and hats. The bundle for an audio file binds what analysis can supply, which today
leaves out `downbeat`, `bar_phase` and `drums`. The engine refuses to load a scene
that needs a role the bundle lacks, and names the role.

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

## Using the loops for real improvements

The loops are not only a safety net. They set the order of work: the rows of
[scoreboard.md](scoreboard.md) that are furthest from target are what gets worked on
next, and a change is kept only if the loop says it helped.

Rules for any change to analysis:

1. **Name the row first.** Say which scoreboard row the change is meant to move
   before making it.
2. **Tune on training, judge on held-out.** Never look at held-out modules while
   developing a change.
3. **Keep it only if it helps.** The target row must move the right way on the
   held-out split, no other row may fall by more than the regression allowance (a
   hard gate), and the real-music check must hold.
4. **Record it.** Run `accuracy.py --save-baseline`. That rewrites the scoreboard, so
   the commit that makes an improvement also shows it, and the scoreboard's git
   history is the history of real improvements.
5. **Raise the bar when it is cleared.** When a target is met comfortably, tighten it
   in `gates.json` and note that in the queue.

The same applies to the engine and scenes with the render loop: `baseline.json` is
the record, contact sheets are the evidence, and a scene is developed against a
perfect bundle first so that analysis errors and scene problems are not confused.

## Chunks for milestone 1

Each chunk can be built unattended. "Gates" are the automatic exit conditions.
Figures are held-out results from the scoreboard when this plan was written.

| Chunk                                                       | Gates                                                                                                                                                                                                                                                                                                                                                                                                                                            | Human input                                                        |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| **0. Analysis-accuracy loop** (done)                        | Instrument checks all pass; `accuracy.py` scores onsets, beats, sections and stems on both splits and all variants and exits zero; tuned parameters are adopted only under the rules in `tune.py`; the engine renders a scene from a perfect bundle; committed fixtures regenerate byte-for-byte                                                                                                                                                 | None                                                               |
| **1a. Wider corpus** (done)                                 | 194 downloaded modules sampled evenly across the whole public-domain listing (140 IT, 39 XM, 15 MOD; the listing has almost no S3M), 97 usable for training and 117 held out; instrument checks pass; re-tuning attempted and correctly rejected; scoreboard regenerated                                                                                                                                                                         | ScreamSeq exports welcome, not required                            |
| **1b. Slow attacks** (done, mostly by fixing the yardstick) | Soft recall at least 0.6 with percussive recall at least 0.90. Met, but not by a better detector: the misses were mostly the reference timing slow attacks at their steepest point (which for a fade-in is its very end) and splitting notes written together into separate events. Both are corrected (D8, D11 in the queue). Moving soft events in the analyser was tried and switched off (D20)                                               | None                                                               |
| **1c. Beat tracking** (in progress)                         | Tempo right at some metrical level on at least 95% of tracks; beat F at any level at least 0.95. Done so far: modules with irregular beat grids are scored instead of skipped, and a tracker that follows the music was tried and rejected on held-out modules. The signal-processing stand-in is near its ceiling, so what remains is registering and comparing at least one local model and one hosted service                                 | Go-ahead to install model packages; API keys for hosted candidates |
| **1d. Sections** (not done) | Boundary F within 3 s at least 0.75; at least one real analyser registered. It stands at 0.54 (`novelty_grid`: the first detector's boundaries moved onto a sixteen-beat grid, which the bundle now uses), up from 0.52. A second signal-processing analyser led on training and lost on held-out modules; a learned detector did worse; the All-In-One model would not install on this machine. The reference may also be too fine-grained to be the right target (D49) | A Music.ai key; a decision on D49 |
| **1e. Stems** (done, one provider unverified)               | User-supplied stems, the three hosted providers and one local model all registered as analysers; the best improves on the unseparated mix by at least 3 dB against true stems. Met: LALAL.AI improves on the mix by 17.9 dB, local Demucs by 6.3 dB and Demucs on fal.ai by 6.1 dB, against 2.5 dB for the band-split baseline. LALAL.AI and fal.ai are verified against the live services; Music.ai is written from its documentation and has not been run | A Music.ai key and workflow, to verify that adaptor                |
| **1f. Drum hits by type** (done) | The reference and scorer extended to kick, snare and hat; at least one analyser scored on it. Two are: a detector on the full mix scores a mean F of 0.57 on held-out modules (kick 0.47, snare 0.46, hat 0.79), and the same detector on the drum stem Demucs separates scores 0.73 (kick 0.74, snare 0.59, hat 0.85) | None |
| **1g. Bundle and worker**                                   | Bundle schema validates; the worker assembles the bundle from the best analyser per part as chosen by the accuracy loop; a stored bundle is reused, never recomputed; every scoreboard target met or its shortfall explained in the queue                                                                                                                                                                                                        | None                                                               |
| **2. Role binding** (done) | Engine tests pass; a scene asking for an unavailable role fails with a clear error; every scene renders on every track. Scenes declare roles and read `roles.<name>`; bundles bind sixteen of them; the accuracy loop checks on every run that a role-reading scene renders and that one needing a missing role is refused by name | None |
| **3. Feedback-first rendering** (part done) | No hard-gate failures on any scene. Active area and jerkiness targets met on a reference scene; deterministic; the WASM build still compiles. Done: feedback is bounded by default; a blend mode draws each frame over the last, so the previous frame is the base layer; warps no longer shear on a wide frame; and a reference scene, `scenes/vortex.rhai`, meets every gate and target on three of four default tracks, deterministically, with the WASM build compiling. Blended transitions between the scenes of a show are done (both scenes draw, and their pictures and warp fields are mixed in one feedback loop; the loop checks a blend shows both scenes and leaves the background alone, and that a cut does neither). Feedback settings mean the same at any frame rate (D97); the engine can take several steps a frame, so that a 30 fps render is the 120 fps picture (`--step-rate`, D98); and the loop is kept in 16-bit float between steps (D99). Not done: HDR with tone mapping (the loop is in float but still clipped at white each step, and the tunnel example still whites out, from its own emissive mesh, D55), and motion blur, which would average the steps of a frame instead of saving the last. The five older example scenes still fail as before | None |
| **4. Scenes, director, one command** (first version out for review) | Every scene passes hard gates and targets over whole tracks, first on perfect bundles and then on analysed bundles of the same modules; audio sync on the analysed bundle within 10% of the perfect bundle; two runs of the director differ; each resulting show re-renders identically. Done: three scenes with a shared style line, a rule-based director, and `video.py`. Directed shows pass every hard gate on all four default tracks, differ from run to run and re-render identically. Over whole tracks (one run by hand, 23 November 2026, not yet part of the default loop): 24 clips, none fails a hard gate; the directed shows meet `punch`, `look_change` and `one_hue_share` on every track. `wash` was above its old limit on every directed show (0.23 to 0.33); it is no longer a target (D85). On analysed bundles of the two fixture modules, audio sync reaches the perfect bundle's on four of the six scene renders and is 70% and 83% of it on the other two; `punch` is 3.9 to 7.5 against about 8. That is with drum hits heard in the Demucs drum stem. Heard in the mix, as they were before, sync was within 10% on two of six and 40% to 74% on the rest, and `punch` 3.2 to 5.7. Scene changes inside a section are blended; the web preview cannot play a show yet, cut or blended | Review 2: rate the new videos |

Chunks 1a to 1f are independent and can run in any order; 1a first is best, because
every later number is more trustworthy on a wider corpus.

## Limits of the loops today

- **Stand-in analysis.** `tools/loop/analyse.py` uses signal processing only: no
  stems, no sections, a single global tempo. It exists so the loops can run before
  chunk 1 delivers the real worker.
- **Two real test tracks.** `data/` has one 18-second and one 283-second track. The
  milestone 1 exit test needs ten.
- **Rendering speed.** Software rendering is fine for 480x270 checks; full-resolution
  renders want a GPU, and even there writing PNG frames is the limit (about 12 fps
  at 1920x1080).
- **Uncalibrated render thresholds.** No human ratings exist yet to calibrate against.
- **Tracker music is not all music.** Modules have no vocals, no live playing and no
  mastering. The degraded variants and the real-music check reduce the risk of
  tuning to that, but do not remove it.
- **The baseline analyser for sections is deliberately crude.** It exists so that
  scorer is exercised and so real analysers have something to beat.
- **Stems are judged on eight modules.** Enough to rank sources that differ by
  several decibels, not ones that differ by a fraction of one. Three of the eight are
  synthetic, and Demucs cannot find a synthetic bass at all, which widens the gap
  between it and LALAL.AI: on the five downloaded modules it is 13.1 dB against 9.0.
- **Beat level is ambiguous in modules.** A module does not say which metrical level
  is the beat, so the half, double and off-beat levels are reported alongside.
