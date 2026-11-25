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
| Round 4 | **Sent, not yet rated** | Same nine tracks, drums from ADTOF on trial |

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

- **In use:** `drumbands_stem`, a rise-in-band-energy detector on the Demucs drum
  stem.
- **Tried on the band detector and not kept (D136):** a looser detector for blows as
  such (a plain trade of recall for false blows); checking each blow against the
  other stems; filling in only near hits already found; weighting by how far a hit
  stands out (it says almost nothing about whether the hit is real).
- **ADTOF (D142):** registered as `adtof_stem`, installed by hand in `.loop/venv`,
  held behind `OCTOSEQ_NONCOMMERCIAL=1` because its weights are non-commercial. On
  twelve training modules it looked far better than it turned out on the held-out
  ones (rolls 0.73 against 0.42 in training; 0.596 against 0.558 held out): do not
  trust a twelve-module trial. It is a tie on mean F, so the worker's own rule
  (a tie goes to the cheaper) would keep the band detector even with the switch on.
- **Round 4 was rendered with ADTOF's hits** so the owner can judge on real music.
  It hears the owner's tracks very differently (four times the kicks on one).
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

- A rating of round 4.
- Whether ADTOF's non-commercial licence is acceptable (D142). Until then it is
  held behind `OCTOSEQ_NONCOMMERCIAL=1`.
- Whether the nine review tracks may be uploaded to a rented machine (D139).
- The older items in queue.md's "Needed from you": more test tracks, a Music.ai key.

## What I would do next, in order

1. **Get round 4 rated.** It is the only evidence there will be on whether ADTOF's
   hits are what "lands on wrong moments" needed. Ask the owner about the licence
   at the same time.
2. **If the answer is yes:** choose, on the training split, which drums to take from
   which detector, prove it on the held-out modules, save the accuracy baseline,
   and re-analyse. If no: put the nine tracks' bundles back (D143).
3. **The frame moves less far at a blow than the owner's first "better" round**
   on some tracks (`jump_size` under 0.3 on one of nine in round 4). `style.kick`
   is the one number that raises it; test it on ten scenes first.
4. **Fit the scene to the music.** The director still picks scenes at random; a
   calm scene on a drop is the next thing a review is likely to say. The `lead`
   role and section intensity are there to use.
5. **Analysis targets still missed:** sections (0.54 against 0.75), beats (0.933
   against 0.95), tempo (91% against 95%).
6. **The milestone 1 exit test** needs eight more test tracks from the owner.

## Traps

- Change one thing at a time and test it on ten scenes before a full scan. Twice
  this session two changes made together hid which one hurt.
- A measure can be wrong. Three versions of the twitch measure were written; look
  at frames (`ffmpeg ... tile`) as well as figures before trusting one.
- Patching the WSL tree with stacked exact-text patch scripts: never re-run an
  earlier script after a later one has changed the same text. It applies twice.
- Adding a scene or a palette changes every show for a given seed, so rounds are
  not like for like in their scenes. Compare rounds on the measures, not on looks.
- The nine review tracks' bundles in `.loop/analysis` are, at handover, the ones
  made with ADTOF for the round 4 trial. The older ones are in each track's
  `history/`. `worker.py` will keep using the stored bundle until asked to
  re-analyse.
- The owner follows from another device: send finished videos with the file-send
  tool (640x360 copies under 30 MB), and keep the roadmap page current.
