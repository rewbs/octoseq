# Handover: Octoseq redesign, 24 November 2026

For the next agent to pick this work up cold. Read this, then
[queue.md](queue.md) (every decision and every failed experiment, D1 to D143),
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
  $1.17 has been spent so far.

## Where things are

| What | Where |
| --- | --- |
| The working checkout | WSL2, Ubuntu-24.04, `~/code/octoseq` (`\\wsl.localhost\Ubuntu-24.04\home\p14\code\octoseq`) |
| The checkout to push from | Windows, `C:\Users\P14\code\octoseq`, remote `wsl` points at the WSL one: `git fetch -q wsl <branch> && git merge -q --ff-only FETCH_HEAD && git push origin <branch>` |
| The engine the loops render with | a Windows build: run `tools/loop/win-engine.sh` after any change under `packages/visualiser` |
| Model environment | `.loop/venv` (Demucs, Beat This, and now ADTOF) |
| The owner's nine review tracks | `.loop/funcheck/tracks/` (copied from `C:\Users\P14\Documents\tracks`); seeds 101 to 109 |
| Review videos | `.loop/funcheck` (round 1), `funcheck2`, `funcheck3`, `funcheck4`; copies for the owner in `C:\Users\P14\code\octoseq\.loop\preview\` |
| The roadmap page for the owner | https://claude.ai/artifact/Hd5kZ6HVbw656kLvAWDH8p |

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

The owner's wish list from review 3, and where each item stands: more responsive
(done, rated better); grain, dither, lo-fi, ASCII filters (done: six finishes);
more dynamic warping and fewer waves (done in part: five warps, waves in 20 scenes
of 62 where they were in 32 of 58); fractals and procedural generators (done: four
grounds); more palettes (done: 17); drum rolls and breaks detected properly (open:
see below); picking the dominant stem for the moment (not done: a `lead` role is in
every bundle and no scene reads it; a first try at using it measured slightly worse).

## How the picture answers the music

- Every scene's main movement follows `roles.hit`: every kick and snare where the
  track has drums, the strongest onsets where it has none.
- Every scene ends with `post.answer(style.answer, style.kick, roles.hit, style.at)`
  and `post.finish(style.finish, timing.time)`. The engine shapes both
  (`packages/visualiser/src/scripting.rs`, the prelude).
- Nine answers in two families. One to six arrive at once and ease back over four
  tenths of a beat. Seven to nine (notch, swing, slide) turn or move the frame and
  leave it there until the next blow. The director alternates the families.
- `tools/loop/response.py` measures it: `answered`, `answered_rolls`, `jump_size`,
  `undone`, `dead_time`, `stray_jumps`. `undone` is the one that caught "twitchy":
  how much of a jump has been taken back two frames later (round 2: 0.51; round 3:
  0.08; target at most 0.35).

What was tried and did not work is in queue.md D132, so that it is not tried again:
longer or eased envelopes on the scenes' own movement, a longer ease on the
whole-frame answer, a steady movement that only reverses, a small two-state step on
the eased answers. Two wrong versions of the twitch measure are described in D129.

## What a show can now be made of

- **62 scenes** (`scenes/`), each keeping a written contract. 50 came from Milkdrop
  presets; 4 stand on a ground.
- **Finishes** (`post.finish`): grain, dither, two-tone dither, ASCII, tape, halftone
  dots. About one look in three gets one.
- **Warps** for the feedback loop: whirls, fold, flow, blocks, slices are new. A new
  warp that moves the picture a lot between blows costs answered blows: six swaps
  were put back for that (D135).
- **Grounds** (`fx.ground`): a Julia set, marble, cells, a tunnel, drawn from the
  frame's coordinates alone and laid under a scene. Scenes julia, marble, honeycomb,
  wormhole.
- **17 palettes** in `director.py`, drawn from their own random stream.

## Drum detection: the open problem

The picture can only answer the hits analysis hands it, and the owner's second
complaint about round 2, "lands on wrong moments", is about those hits.

| Held-out modules (39) | Bands on the drum stem (in use) | ADTOF on the drum stem (on trial) | Target |
| --- | --- | --- | --- |
| Blows found (kick or snare) | 0.705 | 0.720 | 0.9 |
| Blows inside rolls found | 0.558 | 0.596 | 0.9 |
| Of its blows, real | 0.788 | 0.834 | tracked |
| False blows a second in breaks | 0.53 | 0.44 | 0.1 |
| Kick F / snare F / hat F | 0.738 / 0.592 / 0.851 | 0.851 / 0.580 / 0.753 | tracked |
| Mean F (what the worker chooses by) | 0.727 | 0.728 | tracked |

- **In use since the owner's rating of round 4:** `adtof_stem` (D144). Before it,
  `drumbands_stem`, a rise-in-band-energy detector on the Demucs drum stem, which
  is still what the mix is listened to with where a track has no drums.
- **Tried on the band detector and not kept (D136):** a looser detector for blows as
  such (a plain trade of recall for false blows); checking each blow against the
  other stems; filling in only near hits already found; weighting by how far a hit
  stands out (it says almost nothing about whether the hit is real).
- **ADTOF (D142, D144):** registered as `adtof_stem` and installed by
  `tools/loop/models/setup.sh`. Its weights are non-commercial (CC BY-NC-SA 4.0);
  the owner chose to keep it knowing that. On twelve training modules it looked
  far better than it turned out on the held-out ones (rolls 0.73 against 0.42 in
  training; 0.596 against 0.558 held out): do not trust a twelve-module trial.
  It ties with the band detector on mean F, and the worker's rule gave a tie to
  the cheaper; `PREFERRED` in `worker.py` now lets the owner's rating break that
  tie, and only a tie.
- **Round 4 was rendered with ADTOF's hits** and the owner judged them better on
  real music, where it hears things very differently from the band detector (four
  times the kicks on one track).
- **What the "false blows in breaks" are:** on the training modules they land on
  bass and tune notes that Demucs puts mostly in the drum stem when no drums are
  playing. Neither the drum stem's loudness nor its share of the mix separates
  them from real hits. The worker already swaps to the strongest onsets where the
  drum stem is all but silent, which the accuracy row does not credit.
- **Not tried:** taking ADTOF's kicks and snares with the bands' hats (the held-out
  figures suggest it, which is exactly why it must be chosen on the training split,
  not from them); ADTOF's thresholds tuned per class on the training split; a
  drum-separation model (kick, snare and hat stems) in front of the band detector.

## Machines

- **This laptop** (Windows 11 on ARM64, 18 threads visible in WSL): a clip is one
  core's work, whatever the graphics card. `--jobs 8` gives about three times the
  speed; beyond that the laptop's graphics card is the limit.
- **RunPod**: one RTX 4090 pod with 18 cores did the whole loop in 13 minutes at
  `--jobs 16`. How it was set up is in [setup.md](setup.md). The pod is terminated;
  nothing is running. The key is `runpod_api_key` in the `secrets` CLI inside WSL.
  Two rules: the pod takes the code from GitHub (never copy the working tree: it
  holds `.env`), and the owner's nine tracks have not been uploaded (asked in D139,
  not yet answered).

## Waiting on the owner

- Whether "keep the model" was also meant as acceptance of ADTOF's non-commercial
  licence. I took it so (D144) and said so; it is one flag to reverse.
- Whether the nine review tracks may be uploaded to a rented machine (D139).
- The older items in queue.md's "Needed from you": more test tracks, a Music.ai key.

## What I would do next, in order

1. **Round 4 was rated "keep the model"**, so ADTOF is in. Ask the owner what is
   still wrong with the shows now: "lands on wrong moments" was the last named
   fault, and nothing has been named since.
2. **Choose, on the training split, which drums to take from which detector.**
   The held-out figures suggest ADTOF's kicks and snares with the band detector's
   hats would beat either. Run ADTOF on all the training modules that have stems
   (it takes about twenty seconds a module when nothing else is running), choose
   there, then prove it on the held-out modules and save the accuracy baseline.
3. **The frame moves less far at a blow than the owner's first "better" round**
   on some tracks (`jump_size` under 0.3 on one of nine in round 4). `style.kick`
   is the one number that raises it; test it on ten scenes first.
4. **Fit the scene to the music.** The director still picks scenes at random; a
   calm scene on a drop is the next thing a review is likely to say. The `lead`
   role and section intensity are there to use.
5. **Analysis targets still missed:** sections (0.54 against 0.75), beats (0.933
   against 0.95), tempo (91% against 95%).
6. **The milestone 1 exit test** needs eight more test tracks from the owner.

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
- **The owner's own files are not mine to upload.** The nine review tracks stayed
  on this machine; the question is in the queue.
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
- The nine review tracks' bundles in `.loop/analysis` were made with ADTOF for
  round 4, by naming it; they carry a different recipe key from the one the worker
  now makes by default, so the next `--reanalyse` will make them again (the same
  drums). The older ones are in each track's `history/`.
- The owner follows from another device: send finished videos with the file-send
  tool (640x360 copies under 30 MB), and keep the roadmap page current.
