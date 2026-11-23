# What Milkdrop Does: Notes From projectM and 9,795 Presets

Milkdrop is the redesign's reference for dynamism, variety and pace. These notes
record what a reading of projectM's source (commit `9e26f5b5b`) and one pass over
the "Cream of the Crop" preset collection (9,795 presets) found, what was measured
when 24 of those presets were rendered on our test tracks, and what has been built
from it. Figures marked _measured_ come from `tools/loop/milkdrop.py`; the rest
come from the source or from counting the presets' text.

## The short version

Milkdrop's pace is inside each preset, not in how often presets change. It holds a
preset for 30 seconds and blends to the next over 3. What keeps the picture alive
in between is the feedback loop itself: a warp that differs from place to place
and never stops moving, driven by time and by loudness together.

Our first scenes had rigid warps (one zoom, turn or slide for the whole frame), so
the director changed scene every 3 to 9 seconds to make up for it.

## How a frame is made

In order (`MilkdropPreset::RenderFrame`):

1. The preset's per-frame equations run.
2. The previous frame is drawn through a **32 by 24 mesh** into a new buffer and
   multiplied by a decay. Per-vertex equations set zoom, rotation, centre, shift
   and stretch at each of the 33 by 25 corners, from position, radius, angle,
   time and audio. Every vertex also gets the built-in warp: four sine waves,
   `warp * 0.0035 * sin(time * k + scale * position)`, with `k` of 0.333, 0.375,
   0.753 and 0.825, whose spacing itself drifts.
3. Three blurred copies are made, at a quarter, an eighth and a sixteenth size.
4. New content is drawn on top: up to four custom shapes (each can be many
   instances), up to four custom waves, the basic waveform, borders.
5. A composite pass makes the displayed picture from that: a shader, or an echo
   plus gamma. It is display-only; the loop feeds on step 4.

The audio a preset sees is crude: three bands (0 to 3.7, 3.7 to 7.3 and 7.3 to
11 kHz) from 11 ms of sound, each as a ratio to its own 4-second average, with a
21 ms attack. There is no beat detection. Nothing is frame-rate compensated except
those averages.

## What the presets use

| | Share of presets |
| --- | --- |
| Per-frame equations | 98.7% |
| Per-vertex warp equations | 58.4% |
| A warp shader | 80.9% |
| A composite shader | 81.4% (of those: blur 74%, gain 51%, mirror or kaleidoscope 24%) |
| Blur textures | 72.1% |
| Custom shapes | 63.6% (pasting the previous frame back: 40.7%; instanced: 27.7%, median 92 copies) |
| Custom waves | 47.7% |
| Motion driven by audio and time together | 89.0% (time alone 9.0%, audio alone 0.8%) |

Typical values: decay 0.94 to 0.997 a frame (median 0.96); zoom within 0.97 to
1.106 a frame; a median of four drawn layers, nearly half of them additive. Slow
motion runs on sine waves of about 0.37 radians a second (a 17-second period) and
colour on about 0.96 (6.6 seconds), with the three colour channels detuned by a
few percent so they never line up.

Common idioms: a clock that advances by loudness, so everything runs faster when
the music is loud (24% to 54% of presets, depending how it is counted); two
detuned sines added for a wobble that never repeats (23%); parameters re-rolled at
random on a beat (21%) or every 12.6 seconds (15%).

## Measured: 24 presets on our tracks

Two or three presets from each category, each on three test tracks, 30 seconds a
clip, measured exactly as the loop measures ours (`tools/loop/milkdrop_reference.json`).

| Figure | Milkdrop, 10th to 90th percentile | Median | Our first three scenes |
| --- | --- | --- | --- |
| Speed of flow, frame widths a second | 0.10 to 0.57 | 0.24 | 0.08 |
| Share of motion that is not one rigid movement | 0.62 to 0.94 | 0.81 | 0.61 |
| Change of picture over a quarter second | 0.21 to 0.89 | 0.54 | 0.37 |
| Change of look over 8 seconds, within one preset | 0.06 to 0.66 | 0.37 | 0.10 |
| Punch (motion on hits against typical motion) | 1.01 to 2.06 | 1.16 | 6.6 |
| Wash | 0.01 to 0.38 | 0.12 | 0.18 |

Two things stand out besides the gap in flow. Milkdrop is **not** punchy by our
measure: its picture barely moves more on a hit than between hits. Punch is
something the owner asked for and Milkdrop does not have. And a quarter of
Milkdrop's clips have more "wash" than the 0.2 we set as a limit after review 1,
so that figure does not separate ugly from not.

## Built from this

- Three warps that differ across the frame and move: `waves` (Milkdrop's own
  four-sine warp), `petals` (zoom by direction) and `ripple` (zoom by distance).
- Scenes `liquid`, `bloom` and `well`: an audio-driven clock, wobble on detuned
  sines, a slow tide in the zoom, and colour that creeps round the wheel as trails
  age. The first three scenes got a little of the same.
- The loop measures flow, detail and pace on every clip and reports each run
  beside the reference.

## Not built yet, in order of expected effect

1. A richer display-only composite stage: mirror and kaleidoscope, gain curves.
   We have bloom only.
2. Blurred copies of the frame that the warp and the composite can read.
3. A shape that pastes the previous frame back at its own zoom and turn, and
   drawing many copies of a shape at once.
4. Drawing the sound itself. Half of Milkdrop's presets draw waveforms; our
   bundles carry no audio samples, only signals at 50 to 100 values a second.
5. Re-rolling a scene's parameters on a beat or every dozen seconds.
6. Longer holds in the director, once scenes carry 30 seconds on their own.
