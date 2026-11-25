# Handover: Octoseq redesign, 24–25 November 2026

For the next agent to pick this work up cold. Read this, then
[queue.md](queue.md) (every decision and every failed experiment, D1 to D150),
[README.md](README.md) (what the loops measure) and `CLAUDE.md` (the standing rules).

## The job and its rules

Octoseq is being rebuilt as "track in, video out": an audio file goes in, analysis
makes a bundle of what the music does, a director makes a show from a pool of
scenes, and the engine renders it. The owner reviews whole-track videos and says
whether they are fun. Work happens on the branch `claude/music-viz-redesign-mnvlsu`.

The owner's standing rules, which have not changed:

- Use the loops to choose and prove work. Name the row a change is meant to move
  and keep the change only if that row improves without another falling.
- Tune only on the training split. Never look at held-out modules while tuning.
- Do not stop for judgement calls: take the most reversible default, record it in
  `docs/loop/queue.md`, carry on.
- Do not loosen a gate to make a run pass. Gates change only on human ratings.
- Commit each finished chunk with the regenerated scoreboard, and push. No pull
  request unless asked.
- Report plainly, including what failed.
- Never print, log or commit a key. Hosted stem services cost money: never clear
  `.loop/cache/stems`, and do not spend on them.
- RunPod may be used for anything, with a check-in to the owner every $25 spent.
  About **$1.30** has been spent so far ($1.17 prior + ~$0.13 across three failed
  pod boots in this session; all pods terminated).

## Where things are

| What | Where |
| --- | --- |
| The working checkout | WSL2, Ubuntu-24.04, `~/code/octoseq` (`\\wsl.localhost\Ubuntu-24.04\home\p14\code\octoseq`) |
| The checkout to push from | Windows, `C:\Users\P14\code\octoseq`, remote `wsl` points at the WSL one: `git fetch -q wsl <branch>; git merge -q --ff-only FETCH_HEAD; git push origin <branch>` |
| The engine the loops render with | a Windows build: run `tools/loop/win-engine.sh` after any change under `packages/visualiser` |
| Model environment | `.loop/venv` (Demucs, Beat This, ADTOF) |
| The owner's nine review tracks | `.loop/funcheck/tracks/` (copied from `C:\Users\P14\Documents\tracks`); seeds 101 to 109 |
| Review videos | `.loop/funcheck` (round 1), `funcheck2`, `funcheck3`, `funcheck4`, `funcheck5`; copies for the owner in `C:\Users\P14\code\octoseq\.loop\preview\funcheck5\` |
| The roadmap page for the owner | https://claude.ai/artifact/Hd5kZ6HVbw656kLvAWDH8p (external Claude.ai artifact; not directly editable from this harness — owner needs to update or run in Claude.ai) |

Driving WSL from the Windows side: write a script file and run it with
`wsl.exe -d Ubuntu-24.04 bash -l /mnt/c/.../script.sh`. Inline `bash -c '...'`
loses `$(...)` and variables. Long jobs go in the background and are waited for, not
polled. Edit the WSL tree with scripts run inside WSL when many files change.

## The commands that matter

```bash
python3 tools/loop/run.py --jobs 8                 # the whole render loop, 17 minutes here
python3 tools/loop/run.py --jobs 8 --save-baseline # ... and keep its figures as the baseline
python3 tools/loop/selftest.py                     # the instruments
python3 tools/loop/contract.py scenes/*.rhai       # every scene's written promises
python3 tools/loop/contract.py --render --mist-only --name c-NAME scenes/NAME.rhai   # a changed scene at its crispest and mistiest
.loop/venv/bin/python tools/loop/accuracy.py --save-baseline   # analysis against tracker modules; rewrites the scoreboard
python3 tools/loop/video.py TRACK -o OUT.mp4 --seed N --no-build   # a whole-track show
```

`contract.py --render` run several at once needs a different `--name` each, or the
runs overwrite one another's temporary scenes.

## The reviews so far

| Round | What the owner said | What was done |
| --- | --- | --- |
| Review 3, round 1 | "Not fun": nowhere near responsive enough | Every kick and snare is a hit; every look answers every blow with the whole frame |
| Round 2 | "Still not right": "twitchy, not punchy", "lands on wrong moments". Later: an answer "just has to be sudden and visible", e.g. a change of rotation or direction | Answers that are not taken back (below) |
| Round 3 | "Better, keep going" | Grounds, palettes, the drum-transcription trial |
| Round 4 | "Yes, keep the model" (asked whether it lands on the drums better than round 3) | Same nine tracks, drums from ADTOF. It is now the drums' analyser for every bundle (D144) |
| Round 5 | Pending owner review (delivered in `.loop/preview/funcheck5/`) | 30 new scenes + 15 shaders + 15 palettes (D145), `director-10` intensity+`lead` scene fitting (D146) and +25% `style.kick` (D149), `drums_hybrid_stem` (D147). Zero hard failures; 6/9 clean passes; medians vs re-scored Round 4: `intensity_fit` +0.290→+0.528, `lead_sync` +0.126→+0.166, `jump_size` 0.376→0.418 (9/9 ≥ 0.30), `undone` 0.097→0.080, `dead_time` 0.022→0.008 |

The owner's wish list from review 3, and where each item stands: more responsive
(done, rated better); grain, dither, lo-fi, ASCII filters (done: six finishes);
more dynamic warping and fewer waves (done in part: five warps, waves in 20 scenes
of 92); fractals and procedural generators (done: **19 grounds** in `fx.ground`);
more palettes (done: **32 palettes**); drum rolls and breaks detected properly
(improved via `drums_hybrid_stem`, mean F 0.761, hat F 0.851, blows/rolls/breaks still
below 0.9/0.9/0.1); picking the dominant stem & fitting scenes to music (done in
`director-10` via `section_intensity` + `lead` + dominant-stem matching, measured by
`intensity_fit` and `lead_sync` in `metrics.py`; 20 new scenes also read `roles.lead`).

## How the picture answers the music

- Every scene's main movement follows `roles.hit`: every kick and snare where the
  track has drums, the strongest onsets where it has none.
- Every scene ends with `post.answer(style.answer, style.kick, roles.hit, style.at)`
  and `post.finish(style.finish, timing.time)`. The engine shapes both
  (`packages/visualiser/src/scripting.rs`, the prelude). `director-10` sets
  `style.kick = round(1.06 + 0.5 * middle, 2)` (D149).
- Nine answers in two families. One to six arrive at once and ease back over four
  tenths of a beat. Seven to nine (notch, swing, slide) turn or move the frame and
  leave it there until the next blow. The director alternates the families.
- `tools/loop/response.py` measures it: `answered`, `answered_rolls`, `jump_size`,
  `undone`, `dead_time`, `stray_jumps`. `undone` is the one that caught "twitchy":
  how much of a jump has been taken back two frames later (round 2: 0.51; round 3:
  0.08; round 5: 0.08; target at most 0.35).
- **Parked future metric (D148):** single-frame `changed_area` (`jump_size`)
  under-reports rotation snaps and direction reversals (`kind` 7–9); the owner
  agreed to park optical-flow-based reactivity assessment as a future feature.

What was tried and did not work is in queue.md D132, so that it is not tried again:
longer or eased envelopes on the scenes' own movement, a longer ease on the
whole-frame answer, a steady movement that only reverses, a small two-state step on
the eased answers. Two wrong versions of the twitch measure are described in D129.

## What a show can now be made of

- **92 scenes** (`scenes/`), each keeping a written contract (`docs/design/preset-pool.md`
  lists all 92). 50 came from Milkdrop presets; 19 stand on procedural grounds; 15
  more are geometry/3D/feedback/Milkdrop-inspired scenes added in D145 (split between
  high-energy rhythmic scenes and calm melodic scenes reading `lead`/`brightness`).
- **Finishes** (`post.finish`): grain, dither, two-tone dither, ASCII, tape, halftone
  dots. About one look in three gets one.
- **Warps** for the feedback loop: whirls, fold, flow, blocks, slices. A warp or
  shader that modulates high-frequency parameters continuously between blows costs
  answered blows (D135, D145, D146).
- **Grounds** (`fx.ground`, kinds `1..=19` in `shader_post_ground.wgsl`): Julia set,
  marble, cells, tunnel, plus 15 new shaders added in D145 (kifs, plasma, metaballs,
  warp_stars, truchet, gyroid, aurora, Voronoi caustics, hexgrid, galaxy, raytunnel,
  Apollonian stained glass, circuit traces, Chladni nodal plates, synthwave grid).
- **32 palettes** in `director.py`, drawn from their own random stream.
- **Music-fitting director (`director-10`, D146 & D149):** ranks scenes by proximity
  of baseline `motion` rank to each segment's normalized `section_intensity` + `lead`,
  plus dominant-stem / `lead` role bonuses (penalizing drum-only scenes when drums
  are weak), drawing from the top 5–12 matching scenes.

## Drum detection: current state (D147)

| Held-out modules (39) | `drumbands_stem` | `adtof_stem` | **`drums_hybrid_stem` (in use)** | Target |
| --- | --- | --- | --- | --- |
| Blows found (kick or snare) | 0.705 | 0.720 | **0.720** | 0.9 |
| Blows inside rolls found | 0.558 | 0.596 | **0.596** | 0.9 |
| Of its blows, real | 0.788 | 0.834 | **0.834** | tracked |
| False blows a second in breaks | 0.53 | 0.44 | **0.438** | 0.1 |
| Kick F / snare F / hat F | 0.738 / 0.592 / 0.851 | 0.851 / 0.580 / 0.753 | **0.851 / 0.580 / 0.851** | tracked |
| Mean F (what the worker chooses by) | 0.727 | 0.728 | **0.761** | tracked |

- **In use since D147:** `drums_hybrid_stem` (ADTOF kick and snare + `drumbands_stem`
  hat on the Demucs drum stem). Chosen strictly on all 59 training modules with
  cached stems (ADTOF won kick 45–10 and snare 30–18; bands won hat 28–10 modules,
  median 0.909 vs 0.873), then proven on the 39 held-out modules (`accuracy.py`,
  17/17 instrument checks pass, zero regressions). Wins outright by +0.033 mean F.
- **Note on long tracks:** `_adtof_peaks` in `analysers.py` now chunks on GPU in
  overlapping 300 s windows whenever a track exceeds cuDNN's 65,535-frame GRU cap
  (~10m55s, encountered on training module `173039.it`).
- **Training-split observation not yet tested on held-out:** on the 59 training
  modules, tuning ADTOF's kick/snare thresholds slightly from `(0.22, 0.24)` to
  `(0.24, 0.20)` moved `K`, `S`, `blow_recall`, `roll_recall`, and `break_false_per_s`
  all in the right direction simultaneously (at -0.013 `blow_precision`). Worth a clean
  held-out trial if chasing blows/rolls/breaks further.

## Machines

- **This laptop** (Windows 11 on ARM64, 18 threads visible in WSL): `--jobs 6–8` for
  `run.py` (occasionally hits transient WSL vsock stalls at 8-way bursts; 4–6 workers
  with per-clip caching is rock-solid). All 9 whole review tracks rendered locally in
  19.6 min at 4 workers.
- **RunPod**: `secrets lease runpod_api_key --ttl 30m` (not `secrets get`) retrieves
  the key. Three pods in this session (`et653pil68gc2l`, `b7b328y42300za`,
  `eh9loirk0rp2yk`) stayed in `runtime: null` past 240 s and were terminated
  immediately (`pods: []` verified; ~$0.13 spent, ~$1.30 cumulative). Note: check
  `supportPublicIp: true` in RunPod GraphQL `podFindAndDeployOnDemand` next time.
  Never copy the working tree (`.env`); code comes from GitHub. The 9 review tracks
  have upload permission; ask before uploading anything else.

## Waiting on the owner

- Feedback on **Round 5** (640×360 copies in `C:\Users\P14\code\octoseq\.loop\preview\funcheck5\`).
- Updating the external Claude.ai roadmap artifact (`https://claude.ai/artifact/Hd5kZ6HVbw656kLvAWDH8p`).
- The older items in queue.md's "Needed from you": 8 more test tracks for milestone 1
  exit test, a Music.ai key.

## What I would do next, in order

1. **Address the missed analysis targets (worst first), tuning strictly on training:**
   - **Sections** (`0.540` against `0.75` target, `novelty_grid`)
   - **Beats** (`0.933` against `0.95` target, `standin`)
   - **Tempo** (`91%` against `95%` target, `standin`)
   - **Drums blows/rolls/breaks** (`0.720 / 0.596 / 0.438` vs `0.9 / 0.9 / 0.1`): test
     the `(0.24, 0.20)` ADTOF threshold pair or drum-stem separation model.
2. **Fix the small visual issues visible in Round 5 contact sheets:**
   - Add a recency cooldown in `director.py` so long flat-intensity stretches don't
     repeat the same 4–5 scenes (`lavalamp`, `polyweave`, `apollonian`) 4–5 times.
   - Inspect and fix the flat grey/washed frame on `rorschach` (Track 06) and
     occasional misty grey floor on `hexagon`/`contours`, plus soften `answer=2`
     brightness flash peak when `style.kick > 1.3`.
   - Nudge `flow_swirl` on tracks 03–05 (`0.598–0.610` vs `0.62`), e.g. adding gentle
     swirl feedback to a few lower-swirl ground scenes or weighting swirl variety.
3. **Parked future feature (D148):** optical-flow-based music-reactivity metric in
   `response.py`/`motion.py` so rotation snaps and direction reversals (`kind` 7–9)
   are measured accurately alongside frame-to-frame luma change.
4. **Milestone 1 exit test** once the owner supplies eight more test tracks.

## Lessons from this session

Each of these cost time once. They are in the order I would want to have been told them.

### About the owner's reviews

- **Ask what a complaint means before fixing it.** "Twitchy, not punchy" was taken
  to mean "should hit and ease back", and a morning went on easing curves. The
  owner then said an answer "just has to be sudden and visible", such as a change
  of direction, and the answers built on that (the ones that stay) measured best
  of all. One question up front would have found it.
- **A person's rating beats the proxy.** The tracker modules could not separate
  the two drum detectors (mean F 0.728 and 0.727). The owner could, on real music,
  in one viewing. When the proxy is undecided, put the thing in front of the owner:
  a trial render of the nine tracks takes 25 minutes.
- **Tell the owner what you can already see is wrong, and fix what is cheap first.**
  The grain finish greyed dark pictures; that showed on a contact sheet before
  sending, and re-rendering was better than sending it.
- **Say what a round changes and what it does not.** Round 4 changed three things
  at once (drum hits, scenes, palettes) and was sent saying so.

### About measuring

- **A measure can be wrong, and the wrong one looks like progress.** The twitch
  measure was written three times. Counting changed pixels cannot tell a blip from
  an ease, because every pixel changes a little during an ease. Timing how long the
  picture keeps moving would have marked down the answers the owner then asked
  for. Check a new measure against frames (`ffmpeg ... tile`) and against a
  picture whose right answer is known (`selftest.py`) before believing it.
- **When a measure changes, measure the earlier rounds again before comparing.**
  A commit message once claimed more blows answered in round 3 than round 2; with
  both measured the same way they were equal. It was caught and corrected before
  pushing only because the old videos were re-measured.
- **How much the picture changes is not how far it moved.** In a detailed scene a
  small move changes as many pixels as a large one. "Jump" had to become a rise
  over the frame before, not a peak standing clear, or an eased answer counted as
  no answer.
- **Contrast is what reads, not motion.** A warp that moves the picture a lot
  between blows costs answered blows, because a blow then stands out less. Six
  scenes had a new warp taken out again for that.
- **Ask the figures about what the picture was given.** On a track with no drums
  every scene measured as answering a third of its blows, because the measure
  asked about stand-in kicks that no scene follows.

### About experiments

- **One change at a time.** Twice in this session two changes went in together
  (a longer ease with new warps; earlier, three at once) and the scan could not say
  which one hurt. Each time a clean comparison had to be run afterwards.
- **A small trial misleads.** On twelve training modules ADTOF found 0.73 of the
  blows in rolls against 0.42; on the 39 held-out modules, 0.596 against 0.558.
- **Do not take a hint from the held-out figures.** They suggested mixing ADTOF's
  kicks with the band detector's hats. Acting on that would be tuning on the
  held-out split. It is written down as something to choose on the training split.
- **Find out what an error is before trying to remove it.** The "false blows in
  breaks" turned out to land on bass and tune notes that Demucs puts in the drum
  stem; three fixes had been tried before a ten-minute diagnostic showed that.
- **Record what failed where the next person will look.** queue.md D132, D135 and
  D136 exist so that none of it is tried twice.

### About speed

- **Find out what is slow before buying speed.** A rented RTX 4090 rendered a clip
  no faster than the laptop, at 3% use: a clip is one core's work. The gain was
  running clips side by side (`run.py --jobs`), which also made the laptop three
  times faster and the whole loop 17 minutes where it was 100.
- **Cheap comparisons change what is worth testing.** With 60 to 240 clips in a few
  minutes, three-way comparisons of every answer on ten scenes became routine.
- **A slow first timing may be contention.** ADTOF took as long as the track while
  the render loop was running, and twenty seconds a track when it was not.

### About rented machines, keys and permissions

- **Never copy the working tree to another machine.** It holds `.env`. The first
  attempt was stopped by the permission system, and it was right. The pod takes
  the code from GitHub, and uncommitted work as a diff of tracked files.
- **The owner's own files are not mine to upload without asking.** The nine review
  tracks stayed on this machine until the owner was asked; the answer was yes, for
  those nine. Ask again for anything else.
- **When a permission is refused, do not work round it: say what was wanted and
  why.** Installing ADTOF (no licence file, non-commercial weights) was refused,
  put to the owner, and done when the owner said to try it.
- **Terminate a pod when a batch of work ends.** It bills while idle.
- **A pod is not the laptop.** NVIDIA's Vulkan driver needed X libraries, the
  image's Python was too old, PyTorch found no CUDA. [setup.md](setup.md) has the list.

### About the tools here

- Patching the WSL tree with stacked exact-text patch scripts: never re-run an
  earlier script after a later one has changed the same text. It applies twice.
- `contract.py --render` run several at once needs a different `--name` each.
- Do not change `tools/loop/*.py` or scenes while a run that uses them is going.
- Output of a background job through `wsl.exe | tr` arrives only when it ends: ask
  the machine directly if you need to know sooner.
- Adding a scene or a palette changes every show for a given seed, so rounds are
  not like for like in their scenes. Compare rounds on the measures, not on looks.
- The nine review tracks' stored bundles in `.loop/analysis` were re-analysed with
  `drums_hybrid_stem` (the default worker choice since D147) for Round 5; earlier
  bundles remain in each track's `history/`.
- Tracks over ~10m55s (65,535 frames at 100 fps) hit cuDNN's GRU sequence-length
  cap; `_adtof_peaks` in `analysers.py` now handles that automatically via
  overlapping 300 s GPU chunks.
- The owner follows from another device: send finished videos (640x360 copies under
  30 MB in `C:\Users\P14\code\octoseq\.loop\preview\funcheck5\`), and keep the
  roadmap page current.
