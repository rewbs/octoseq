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

## Answered

Nothing yet.
