# Human Judgement Queue

Everything waiting on the project owner, batched. Work continues on anything not
listed as blocked. See [README.md](README.md) for how this queue is used.

## Needed from you

| #   | What                                                                           | Blocks                                                        | Until then                                                           |
| --- | ------------------------------------------------------------------------------ | ------------------------------------------------------------- | -------------------------------------------------------------------- |
| N1  | Eight more test tracks in `data/` (see the spread suggested in the design doc) | The milestone 1 exit test                                     | The loop runs on the two tracks already there                        |
| N2  | API keys for the stem providers (LALAL.AI, Music.ai, fal.ai)                   | Verifying the stem adaptors against the live services         | Adaptors are built from the published API docs and marked unverified |
| N3  | API keys for whichever hosted analysis services are chosen in chunk 1          | Comparing hosted analysis against local models on real tracks | Local models and signal processing only                              |

## Taste reviews

None pending. Review pack 1 arrives at the end of chunk 4 (first scenes and
director): a page of clips, each with a 1–5 rating and a comment box.

The five existing example scenes were not sent for review. Fed the loop's stand-in
analysis of the two test tracks, nine of the ten renders fail a hard gate (frozen,
blown out to white, or crashing) rather than being merely dull, so rating them would
not be a good use of your time. The figures are in `tools/loop/baseline.json`.

## Decisions taken by default

Say so to reverse any of these.

| #   | Decision                                                                                                                 | Why this default                                                      |
| --- | ------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------- |
| D1  | Stem providers are LALAL.AI, Music.ai and Demucs on fal.ai                                                               | Proposed earlier and not objected to; AudioShake is easy to add later |
| D2  | For each part of the analysis bundle, the hosted API or local model is chosen by comparing candidates on the test tracks | "Most cutting edge" is not something a ranking can settle in advance  |
| D3  | The loop renders 480x270 at 30 fps, first 30 seconds by default                                                          | Keeps a full run to a couple of minutes; whole tracks on request      |
| D4  | Gate thresholds in `tools/loop/gates.json` are first guesses                                                             | To be calibrated against your ratings from review pack 1              |
| D5  | The loop uses a stand-in signal-processing analyser until chunk 1 delivers the real one                                  | Lets the loop run on real tracks today                                |

### Taken while building the accuracy loop

| #   | Decision                                                                                                                                                                                                                                                          | Why this default                                                                                                                                                             |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D6  | ScreamSeq's role was left as a placeholder in the request. I treated it as your tracker: the player is built from upstream OpenMPT at the exact commit ScreamSeq pins as its engine baseline, and ScreamSeq exports dropped into `.loop/modules/` join the corpus | ScreamSeq has no Linux build and has removed libopenmpt, so it cannot be the instrumented player itself; pinning its baseline keeps reference timing identical to its engine |
| D7  | Nothing in ScreamSeq or OpenMPT was modified in place. The instrumentation is a patch file applied to a fresh checkout at build time                                                                                                                              | Keeps it a development build, as asked, and leaves both repositories untouched                                                                                               |
| D8  | The time analysis is scored against is the **steepest rise** of each event. Bias against the physical onset and the peak is reported alongside                                                                                                                    | Closest of the three to when a sound is perceived to start; a visual hit should land there. Changing it is one constant in `score.py`                                        |
| D9  | Percussive means a 10%–90% rise under 20 ms; anything slower is soft; a note that does not raise the level at all is legato                                                                                                                                       | A common dividing line; all three are constants in `modref.py`                                                                                                               |
| D10 | An event counts as fully masked when it is 20 dB below the rest of the mix in every band it has energy in, and its weight falls linearly from there                                                                                                               | A simple energy model, not a psychoacoustic one                                                                                                                              |
| D11 | Simultaneous notes merge into one event when within 30 ms                                                                                                                                                                                                         | Below that they are not heard as separate attacks                                                                                                                            |
| D12 | A hit is a detection within 50 ms of an event; beats within 70 ms; sections within 0.5 s and 3 s                                                                                                                                                                  | The tolerances the music-analysis research community uses, so scores are comparable with published ones                                                                      |
| D13 | Section boundaries are placed where the set of instruments heard changes by at least 20% between order-list positions                                                                                                                                             | The order list alone says where patterns change, not which changes matter; on synthetic modules this agrees with the composed sections                                       |
| D14 | Stems are drums, bass and other. A sample played at one or two pitches that peaks within 50 ms is drums; a melodic sample whose strongest frequency is usually below 220 Hz is bass                                                                               | Modules have no vocals; trackers make drums easy to identify because they are hit at a fixed pitch                                                                           |
| D15 | Downloaded modules are never committed, even though the corpus only takes ones The Mod Archive lists as Public Domain. Only modules generated by `modgen.py` are committed                                                                                        | The licence is asserted by whoever uploaded the file and cannot be verified; the manifest records source and stated licence                                                  |
| D16 | Tuned parameters are adopted automatically, without review, when they pass the acceptance rules in `tune.py`                                                                                                                                                      | The rules are the review: held-out improvement, no loss on beats, bias within a frame, no loss on real recordings                                                            |
| D17 | The real-music check uses agreement between original and degraded audio, because `data/*.mp3` has no ground truth                                                                                                                                                 | It is the only thing measurable on those tracks without labels; hand-labelled real tracks would be stronger                                                                  |
| D18 | Modules that do not end within 15 minutes, or have fewer than 20 events, are left out of scoring                                                                                                                                                                  | Looping or near-empty modules add nothing                                                                                                                                    |
| D19 | Accuracy targets set at: soft recall 0.6, beat F 0.95, tempo right 95%, section F 0.75, stems 3 dB better than the mix                                                                                                                                            | First guesses at where real analysers should land; the current stand-ins miss all five, which is the point. Raise or lower them in `tools/loop/gates.json`                   |

## Answered

Nothing yet.
