# The preset pool

Fifty Milkdrop presets, and the Octoseq scene written from each. This file is
written by `python3 tools/loop/presets.py table`; do not edit it by hand. The
presets, the scenes' names and the notes are in `tools/loop/preset_pool.json`.

The presets were chosen by rule, not by taste: five from each of the collection's
ten categories, each from a different sub-category, picked to spread across what a
preset can use (`presets.py choose`). Each was rendered by projectM on the loop's
test tracks and looked at before its scene was written. A scene is meant to be
similar or better, not a copy: where a preset was dull, or drew nothing, the note
says what was done instead.

Figures are for the first thirty seconds of `dontstop`: speed (frame widths a second
where the picture moves), swirl (how far the motion is from one rigid slide, zoom or
turn), punch (how hard the picture jumps on hits), look change (how different it is
from eight seconds before) and wash (how much of the frame is filled with soft
colour). A scene is not required to match its preset's figures, and most punch harder.

## Dancer

### 00. Aurora: `mandala`

- Preset: `Dancer/Aurora/$$$ Royal - Mashup (259).milk`
- It uses: moves by place (dx, dy, rot); composite shader; blur; echo; 3 custom waves; 1 shape, 1 textured with the frame
- It looks like: a six-pointed neon star that keeps re-forming
- Scene: [`scenes/mandala.rhai`](../../scenes/mandala.rhai); kept: the six-fold fold. Ours folds three kinds of moving shape through a kaleidoscope that turns a notch on each hit, so the star is never the same twice
- Preset measured: speed 0.27, swirl 0.89, punch 1.26, look change 0.48, wash 0.11
- Scene measured: speed 0.13, swirl 0.81, punch 3.01, look change 0.68, wash 0.41

### 01. Hatches: `hatch`

- Preset: `Dancer/Hatches/suksma - biotoxins on strings - chrystalmouthze plumputate rodeo drive.milk`
- It uses: warp shader; composite shader; blur; echo; 4 custom waves; borders
- It looks like: angular streaks of white, yellow and blue, like a city seen at a slant
- Scene: [`scenes/hatch.rhai`](../../scenes/hatch.rhai); kept: straight streaks at two slants. Ours makes them from bars that slide, with the drums thickening one slant each
- Preset measured: speed 0.26, swirl 0.73, punch 2.07, look change 0.23, wash 0.16
- Scene measured: speed 0.13, swirl 0.55, punch 3.46, look change 0.48, wash 0.34

### 02. Nexus Mirror: `nexus`

- Preset: `Dancer/Nexus Mirror/EoS - ascopic d.milk`
- It uses: moves by place (zoom); echo; 2 custom waves; 1 shape
- It looks like: a tunnel, the same on the left as on the right, with a glowing core
- Scene: [`scenes/nexus.rhai`](../../scenes/nexus.rhai); kept: the mirrored tunnel and the core. Ours gets the mirror from an echo laid over an unsymmetrical picture
- Preset measured: speed 0.50, swirl 0.95, punch 1.03, look change 0.48, wash 0.23
- Scene measured: speed 0.23, swirl 0.69, punch 1.76, look change 0.12, wash 0.19

### 03. Streamers: `streamers`

- Preset: `Dancer/Streamers/$$$ Royal - Mashup (149).milk`
- It uses: composite shader; blur; echo; 3 custom waves; 2 shapes, 2 textured with the frame; borders
- It looks like: an orange haze filling the frame, with yellow streamers rising through it
- Scene: [`scenes/streamers.rhai`](../../scenes/streamers.rhai); kept: the haze and the rising. Ours takes its colours from the show's palette instead of being orange
- Preset measured: speed 0.50, swirl 0.71, punch 1.13, look change 0.29, wash 0.88
- Scene measured: speed 0.12, swirl 0.50, punch 3.58, look change 0.57, wash 0.19

### 04. Wire: `wire`

- Preset: `Dancer/Wire/EoS_Phat technicolor F breather C.milk`
- It uses: moves by place (rot, sx, sy, zoom); 2 custom waves; 1 shape, 1 textured with the frame
- It looks like: thin wire curves in several colours on black
- Scene: [`scenes/wire.rhai`](../../scenes/wire.rhai); kept: fine line on black. Ours bends each wire with a different part of the band and tumbles them in depth
- Preset measured: speed 0.05, swirl 0.59, punch 1.26, look change 0.24, wash 0.02
- Scene measured: speed 0.09, swirl 0.65, punch 3.90, look change 0.14, wash 0.15

## Drawing

### 05. Dunes: `dunes`

- Preset: `Drawing/Dunes/shifter + Flexi - liquid circuitry from the hive nz+ darq kngettes.milk`
- It uses: moves by place (zoom); warp shader; composite shader; blur; echo; 1 custom wave; 3 shapes, 1 textured with the frame
- It looks like: relief seen from above, like sand or bark, in brown and teal
- Scene: [`scenes/dunes.rhai`](../../scenes/dunes.rhai); kept: ridges that creep. Ours cuts them by sharpening the loop's brightness against a blur of itself, in the show's colours and not the preset's brown and teal
- Preset measured: speed 0.08, swirl 0.90, punch 1.24, look change 0.52, wash 0.45
- Scene measured: speed 0.11, swirl 0.37, punch 2.51, look change 0.48, wash 0.19

### 06. Fractal Mirror: `lattice`

- Preset: `Drawing/Fractal Mirror/suksma - fiShbRaiN - witchcraft (metropolish remix) - vieg.milk`
- It uses: warp shader; composite shader; blur; echo; 2 custom waves; 2 shapes, 1 textured with the frame
- It looks like: glowing lines mirrored four ways, repeating into the middle
- Scene: [`scenes/lattice.rhai`](../../scenes/lattice.rhai); kept: the four-fold mirror and the repeat. Ours repeats by drawing the frame again inside a square in the loop
- Preset measured: speed 0.48, swirl 0.95, punch 1.24, look change 0.23, wash 0.12
- Scene measured: speed 0.10, swirl 0.76, punch 3.21, look change 0.38, wash 0.55

### 07. Lasers: `spotlights`

- Preset: `Drawing/Lasers/suksma - god, most comp shaders look pretty nice with this - pitkanen spher nz+.milk`
- It uses: moves by place (cx, cy, rot, sx, sy, zoom); warp shader; composite shader; blur; echo; 2 shapes; borders
- It looks like: glowing orbs throwing beams, like stage lamps
- Scene: [`scenes/spotlights.rhai`](../../scenes/spotlights.rhai); kept: lamps and beams. Ours makes the beams by smearing lamps four times brighter than white away from a point above the frame
- Preset measured: speed 0.42, swirl 0.91, punch 1.93, look change 0.27, wash 0.10
- Scene measured: speed 0.11, swirl 0.74, punch 5.14, look change 0.49, wash 0.08

### 08. Rorschach Mirror: `rorschach`

- Preset: `Drawing/Rorschach Mirror/Hexcollie - Julian Shader Wars3 - endlessly tired nz+.milk`
- It uses: warp shader; composite shader; blur; echo; 2 shapes
- It looks like: blotches with hard outlines, mirrored down the middle
- Scene: [`scenes/rorschach.rhai`](../../scenes/rorschach.rhai); kept: the fold and the hard-edged pools. Ours does not cut the colour into steps: in this engine that kills a trail in a few frames
- Preset measured: speed 0.43, swirl 0.57, punch 1.09, look change 0.67, wash 0.22
- Scene measured: speed 0.09, swirl 0.83, punch 1.90, look change 0.46, wash 0.10

### 09. Whirlpools Mirror: `whirlpools`

- Preset: `Drawing/Whirlpools Mirror/technothrob holotorics - mrt worth your wile equi intrapheron petron.milk`
- It uses: warp shader; composite shader; blur; 2 shapes
- It looks like: soft rainbow liquid in mirrored whirls
- Scene: [`scenes/whirlpools.rhai`](../../scenes/whirlpools.rhai); kept: the whirl and the mirror. Ours shows one whirlpool tiled two by two, each tile the mirror of the next
- Preset measured: speed 0.15, swirl 0.85, punch 1.08, look change 0.36, wash 0.41
- Scene measured: speed 0.17, swirl 0.89, punch 3.96, look change 0.40, wash 0.19

## Fractal

### 10. Blobby: `cells`

- Preset: `Fractal/Blobby/va ultramix2 - 28.milk`
- It uses: moves by place (dx, dy); 1 shape; borders
- It looks like: nearly black, with one small soft blue glow: the dullest of the fifty
- Scene: [`scenes/cells.rhai`](../../scenes/cells.rhai); better, not similar: ours is a true feedback fractal, one cell with four half-size copies of the whole picture about it, and so on down
- Preset measured: speed 0.05, swirl 0.84, punch 2.04, look change 0.01, wash 0.00
- Scene measured: speed 0.04, swirl 0.69, punch 2.19, look change 0.14, wash 0.09

### 11. Loops: `petal`

- Preset: `Fractal/Loops/phat_RippleNebula99h-EoS mod_mod6.milk`
- It uses: moves by place (dx, dy, rot, sx, sy, warp, zoom); echo; 2 shapes, 1 textured with the frame; borders
- It looks like: a pale flower bursting outwards over the whole frame
- Scene: [`scenes/petal.rhai`](../../scenes/petal.rhai); kept: the opening flower and the pale colour. Ours changes its number of petals on each hit
- Preset measured: speed 0.12, swirl 0.79, punch 1.05, look change 0.70, wash 0.29
- Scene measured: speed 0.22, swirl 0.63, punch 1.79, look change 0.48, wash 0.00

### 12. Nested Hexagon: `hexagon`

- Preset: `Fractal/Nested Hexagon/An Digital FX Edit 2 martin - girlie affairs Internal LightFX AdamFX b.milk`
- It uses: moves by place (dx, rot, zoom); warp shader; composite shader; blur; echo; waveform 4; 1 custom wave
- It looks like: a hexagon with sparks bursting from it, on flat fields of strong colour
- Scene: [`scenes/hexagon.rhai`](../../scenes/hexagon.rhai); kept: the hexagon, the sparks and the flat fields. Ours nests the hexagon inside itself by drawing the frame again in the loop
- Preset measured: speed 0.59, swirl 0.78, punch 3.46, look change 0.44, wash 0.22
- Scene measured: speed 0.26, swirl 0.81, punch 2.75, look change 0.02, wash 0.21

### 13. Pointy: `frames`

- Preset: `Fractal/Pointy/Bdrv Aderrasi - Chromatic Voyage bdrv etAL.milk`
- It uses: moves by place (dx, dy, rot, zoom); waveform 5; 3 shapes, 3 textured with the frame; borders
- It looks like: rectangles nested like a corridor, in rainbow bands, with a small scribble
- Scene: [`scenes/frames.rhai`](../../scenes/frames.rhai); kept: all of it. Ours runs the colour a step per frame of the corridor and puts the melody in the scribble
- Preset measured: speed 0.24, swirl 0.36, punch 1.04, look change 0.66, wash 0.36
- Scene measured: speed 0.18, swirl 0.78, punch 3.83, look change 0.03, wash 0.19

### 14. Wave Interference: `moire`

- Preset: `Fractal/Wave Interference/amandio c - interference pattern 3.milk`
- It uses: echo; waveform 2; 1 shape; borders
- It looks like: two sets of rings crossing into broad curved bands
- Scene: [`scenes/moire.rhai`](../../scenes/moire.rhai); kept: the effect itself, which needs nothing but fine rings. Ours gives each set a drum
- Preset measured: speed 0.09, swirl 0.78, punch 1.08, look change 0.47, wash 0.36
- Scene measured: speed 0.08, swirl 0.84, punch 1.98, look change 0.15, wash 0.39

## Geometric

### 15. Cathedral: `cathedral`

- Preset: `Geometric/Cathedral/martin - flexi - laser dome [bipolar focus intent] - alienth nz+.milk`
- It uses: warp shader; composite shader; blur; echo; waveform 6; borders
- It looks like: dark pointed arches in green and red
- Scene: [`scenes/cathedral.rhai`](../../scenes/cathedral.rhai); kept: the arches. Ours stands them in real depth and walks the eye down the nave
- Preset measured: speed 0.12, swirl 0.85, punch 1.90, look change 0.32, wash 0.26
- Scene measured: speed 0.18, swirl 0.58, punch 2.34, look change 0.08, wash 0.23

### 16. Sphere Array: `array`

- Preset: `Geometric/Sphere Array/akish - placard - do what you say - i can't stand you.milk`
- It uses: warp shader; composite shader; blur; waveform 2; 2 shapes
- It looks like: a marbled black and white texture, mirrored
- Scene: [`scenes/array.rhai`](../../scenes/array.rhai); by its name, not its look: ours is an array of forty moons, all showing the same phase as one lamp circles them, with a wave of size running through the grid
- Preset measured: speed 0.04, swirl 0.88, punch 1.03, look change 0.43, wash 0.03
- Scene measured: speed 0.09, swirl 0.70, punch 2.09, look change 0.03, wash 0.20

### 17. Triangles Solo: `triangles`

- Preset: `Geometric/Triangles Solo/suksma - jerry kludging the dimswitch.milk`
- It uses: moves by place (dx, dy); warp shader; composite shader; blur; 4 custom waves; 3 shapes, 3 textured with the frame; motion vectors
- It looks like: a bright grid of coloured lenses
- Scene: [`scenes/triangles.rhai`](../../scenes/triangles.rhai); by its name: ours is five nested triangles turning like clock hands, at full colour as the preset is
- Preset measured: speed 0.17, swirl 0.87, punch 1.80, look change 0.30, wash 0.22
- Scene measured: speed 0.17, swirl 0.50, punch 1.87, look change 0.05, wash 0.53

### 18. Wire Grid: `grid`

- Preset: `Geometric/Wire Grid/suksma - doubting the gods but with horrible logic roam3 ODing on morgues nz+.milk`
- It uses: moves by place (dx, dy); warp shader; composite shader; blur; waveform 7; borders; motion vectors
- It looks like: a grid of white blobs that swell and break into dots, jumping hard on the drums
- Scene: [`scenes/grid.rhai`](../../scenes/grid.rhai); kept: the grid and the punch. Ours runs the kick across the columns and the snare down the rows
- Preset measured: speed 0.49, swirl 0.92, punch 3.24, look change 0.11, wash 0.02
- Scene measured: speed 0.11, swirl 0.70, punch 2.81, look change 0.25, wash 0.33

### 19. Wire Trace: `lissajous`

- Preset: `Geometric/Wire Trace/Eosphat-chasers22feedmebrains.milk`
- It uses: moves by place (sx, sy); echo; 4 custom waves; 4 shapes, 1 textured with the frame
- It looks like: thin magenta loops drawn on black
- Scene: [`scenes/lissajous.rhai`](../../scenes/lissajous.rhai); kept: the drawn loops. Ours uses three pens whose rates drift with the music's brightness
- Preset measured: speed 0.04, swirl 0.48, punch 1.06, look change 0.20, wash 0.01
- Scene measured: speed 0.10, swirl 0.66, punch 4.53, look change 0.50, wash 0.12

## Hypnotic

### 20. Illusion Radiate: `diamonds`

- Preset: `Hypnotic/Illusion Radiate/i made hexcollies day! [enhanced 1].milk`
- It uses: warp shader; composite shader; blur; waveform 0; borders
- It looks like: striped diamonds, one inside another, pouring outwards
- Scene: [`scenes/diamonds.rhai`](../../scenes/diamonds.rhai); kept: all of it. Ours makes each stripe one beat wide
- Preset measured: speed 0.50, swirl 0.60, punch 1.00, look change 0.07, wash 0.09
- Scene measured: speed 0.28, swirl 0.69, punch 1.84, look change 0.10, wash 0.48

### 21. Polar Mirror: `vortex`

- Preset: `Hypnotic/Polar Mirror/GreatWho + Flexi - Lasershow [bipolar gapminder RGB grind].milk`
- It uses: warp shader; composite shader; blur; waveform 6; 2 shapes, 1 textured with the frame
- It looks like: swirls and rings in two colours, turning about the middle
- Scene: [`scenes/vortex.rhai`](../../scenes/vortex.rhai); kept: the swirl, the rings and the two colours. Ours sends a ring out on every beat
- Preset measured: speed 0.15, swirl 0.80, punch 1.37, look change 0.51, wash 0.51
- Scene measured: speed 0.11, swirl 0.66, punch 4.08, look change 0.14, wash 0.17

### 22. Polar Closeup: `mercury`

- Preset: `Hypnotic/Polar Closeup/goody + flexi - emotive dissonance - integral anomaly - dissonant rift.milk`
- It uses: moves by place (dx, dy, zoom); warp shader; composite shader; blur; borders
- It looks like: swirling olive and silver, like liquid metal
- Scene: [`scenes/mercury.rhai`](../../scenes/mercury.rhai); kept: the metal. Ours gets the highlights by sharpening against a wide blur and taking most of the colour out
- Preset measured: speed 0.16, swirl 0.73, punch 1.02, look change 0.74, wash 0.16
- Scene measured: speed 0.11, swirl 0.88, punch 2.33, look change 0.34, wash 0.04

### 23. Polar Static: `glass`

- Preset: `Hypnotic/Polar Static/TonyMilkdrop - Nuclear [Flexi - help out + alien complex] --- Isosceles edit1.milk`
- It uses: moves by place (dx, dy, rot, zoom); warp shader; composite shader; blur; echo; waveform 6; borders
- It looks like: pale gradients with glassy shapes over them
- Scene: [`scenes/glass.rhai`](../../scenes/glass.rhai); kept: gradients and glass. Ours is five soft lamps behind a lens, with no outline anywhere
- Preset measured: speed 0.48, swirl 0.82, punch 1.45, look change 0.70, wash 0.30
- Scene measured: speed 0.11, swirl 0.75, punch 6.47, look change 0.42, wash 0.45

### 24. Polar Warp: `filigree`

- Preset: `Hypnotic/Polar Warp/flexi - grind my glitch up [003].milk`
- It uses: moves by place (dx, dy); warp shader; composite shader; blur; 1 custom wave; borders
- It looks like: fine dark-blue tracery
- Scene: [`scenes/filigree.rhai`](../../scenes/filigree.rhai); kept: fine line on dark. Ours is crimped rings through a kaleidoscope of ten, with the trails sharpened into more line
- Preset measured: speed 0.15, swirl 0.71, punch 1.14, look change 0.53, wash 0.10
- Scene measured: speed 0.13, swirl 0.61, punch 2.73, look change 0.33, wash 0.47

## Particles

### 25. Blobby: `motes`

- Preset: `Particles/Blobby/hypra-a-astral hypra-a-plane fairlly amazing bullshit.milk`
- It uses: warp shader; composite shader; blur; 1 shape
- It looks like: nearly black, with tiny specks that blink hard on the drums
- Scene: [`scenes/motes.rhai`](../../scenes/motes.rhai); kept: specks that blink. Ours hangs them in depth so the eye reads space, and fills more of the frame
- Preset measured: speed 0.12, swirl 0.71, punch 2.40, look change 0.10, wash 0.02
- Scene measured: speed 0.09, swirl 0.69, punch 2.56, look change 0.09, wash 0.11

### 26. Grid: `weave`

- Preset: `Particles/Grid/Stahlregen & flexi + Geiss + Rovastar - Tides (Blur-Spark Motion RMX)(Jelly).milk`
- It uses: warp shader; composite shader; blur; waveform 0; borders; motion vectors
- It looks like: a woven blue and red texture inside a border
- Scene: [`scenes/weave.rhai`](../../scenes/weave.rhai); kept: the weave and the border. Ours runs a wave through the warp and another through the weft
- Preset measured: speed 0.10, swirl 0.80, punch 1.74, look change 0.67, wash 0.26
- Scene measured: speed 0.09, swirl 0.77, punch 5.13, look change 0.10, wash 0.54

### 27. Points: `spokes`

- Preset: `Particles/Points/$$$ Royal - Mashup (103).milk`
- It uses: warp shader; composite shader; waveform 4; motion vectors
- It looks like: a star of twelve spokes
- Scene: [`scenes/spokes.rhai`](../../scenes/spokes.rhai); kept: the twelve spokes. Ours runs the kick round them one way and the snare the other
- Preset measured: speed 0.44, swirl 0.71, punch 1.10, look change 0.26, wash 0.11
- Scene measured: speed 0.16, swirl 0.59, punch 2.19, look change 0.11, wash 0.27

### 28. Points Trails: `crystal`

- Preset: `Particles/Points Trails/Jc - Crystalography.milk`
- It uses: moves by place (warp); warp shader; composite shader; 1 custom wave
- It looks like: a white and cyan crystal, mirrored into an X
- Scene: [`scenes/crystal.rhai`](../../scenes/crystal.rhai); kept: the hard, nearly white crystal. Ours folds eight ways and lays a small copy of the picture over its own middle
- Preset measured: speed 0.05, swirl 0.62, punch 1.05, look change 0.23, wash 0.05
- Scene measured: speed 0.08, swirl 0.67, punch 3.60, look change 0.36, wash 0.00

### 29. Swarm: `swarm`

- Preset: `Particles/Swarm/$$$ Royal - Mashup (401).milk`
- It uses: warp shader; composite shader; blur; echo; 1 custom wave; 1 shape; borders
- It looks like: nearly black, with small orange sparks spinning fast
- Scene: [`scenes/swarm.rhai`](../../scenes/swarm.rhai); kept: the speed. Ours is three shells of sparks spinning against each other, with far more light in the frame
- Preset measured: speed 0.15, swirl 0.71, punch 1.84, look change 0.40, wash 0.00
- Scene measured: speed 0.33, swirl 0.44, punch 1.51, look change 0.02, wash 0.38

## Reaction

### 30. Automata: `automata`

- Preset: `Reaction/Automata/suksma - barium titanate --- Isosceles edit06.milk`
- It uses: warp shader; composite shader; blur; 3 shapes
- It looks like: fine pink cells and blobs growing on black
- Scene: [`scenes/automata.rhai`](../../scenes/automata.rhai); kept: growth at the scale of a few pixels. Ours seeds it with points and drives it by sharpening against a very fine blur
- Preset measured: speed 0.26, swirl 0.87, punch 1.35, look change 0.41, wash 0.01
- Scene measured: speed 0.13, swirl 0.71, punch 7.28, look change 0.59, wash 0.11

### 31. Dunes: `contours`

- Preset: `Reaction/Dunes/shifter + Flexi - liquid circuitry from the neon grafitti hive nz+.milk`
- It uses: moves by place (zoom); warp shader; composite shader; blur; echo; 1 custom wave; 1 shape
- It looks like: bands with hard edges in every colour, like a map's height lines
- Scene: [`scenes/contours.rhai`](../../scenes/contours.rhai); kept: all of it. This is the look the loop's sharpening gives when it is driven hard
- Preset measured: speed 0.13, swirl 0.93, punch 1.18, look change 0.69, wash 0.55
- Scene measured: speed 0.07, swirl 0.80, punch 2.22, look change 0.51, wash 0.23

### 32. Liquid Gradient: `drip`

- Preset: `Reaction/Liquid Gradient/Flexi - leaving colors - magic happened to my wallpaper.milk`
- It uses: moves by place (dx, dy); echo; borders
- It looks like: liquid in strong colours running down from the top edge over white
- Scene: [`scenes/drip.rhai`](../../scenes/drip.rhai); kept: the runs from the top edge. Ours runs over black, as every scene here does
- Preset measured: speed 0.07, swirl 0.73, punch 0.97, look change 0.22, wash 0.10
- Scene measured: speed 0.14, swirl 0.33, punch 1.89, look change 0.27, wash 0.32

### 33. Mountains: `strata`

- Preset: `Reaction/Mountains/cope + flexi - mother-of-whirl [no fnords were hurt] - 1-ret nz+.milk`
- It uses: warp shader; composite shader; blur; waveform 6; borders
- It looks like: bright slanted bands in orange and cyan
- Scene: [`scenes/strata.rhai`](../../scenes/strata.rhai); kept: slanted bands in two colours. Ours lays them down from bars that climb the slope
- Preset measured: speed 0.17, swirl 0.67, punch 1.02, look change 0.49, wash 0.21
- Scene measured: speed 0.12, swirl 0.62, punch 2.72, look change 0.37, wash 0.45

### 34. Windy: `starfield`

- Preset: `Reaction/Windy/goody + geiss  - dead cold nz+.milk`
- It uses: warp shader; composite shader; blur
- It looks like: white streaks flying out from a point
- Scene: [`scenes/starfield.rhai`](../../scenes/starfield.rhai); kept: all of it. Ours ties the speed of the flight to how loud the music is
- Preset measured: speed 0.11, swirl 0.81, punch 0.96, look change 0.70, wash 0.00
- Scene measured: speed 0.08, swirl 0.58, punch 3.91, look change 0.32, wash 0.00

## Sparkle

### 35. Explosions: `bokeh`

- Preset: `Sparkle/Explosions/$$$ Royal - Mashup (412).milk`
- It uses: warp shader; composite shader; blur; 3 shapes, 1 textured with the frame
- It looks like: soft coloured balls bursting outwards
- Scene: [`scenes/bokeh.rhai`](../../scenes/bokeh.rhai); kept: all of it. Ours hangs them at different depths so they part as they burst
- Preset measured: speed 0.29, swirl 0.93, punch 1.57, look change 0.37, wash 0.16
- Scene measured: speed 0.14, swirl 0.81, punch 4.16, look change 0.21, wash 0.45

### 36. Jewel: `jewel`

- Preset: `Sparkle/Jewel/Goody + martin - crystal palace - Aqua Lumens.milk`
- It uses: warp shader; composite shader; blur; echo
- It looks like: thin crystalline lines and rays on dark blue
- Scene: [`scenes/jewel.rhai`](../../scenes/jewel.rhai); kept: line and ray. Ours is three wire cages tumbling inside each other, smeared into rays
- Preset measured: speed 0.08, swirl 0.84, punch 1.11, look change 0.29, wash 0.17
- Scene measured: speed 0.28, swirl 0.69, punch 26.38, look change 0.03, wash 0.00

### 37. Mass Squares: `glitch`

- Preset: `Sparkle/Mass Squares/suksma - dotes hostile undertake - antiborg.milk`
- It uses: warp shader; composite shader; blur; 3 shapes, 1 textured with the frame; borders
- It looks like: white and pink rectangular blocks breaking up on black
- Scene: [`scenes/glitch.rhai`](../../scenes/glitch.rhai); kept: the blocks and the breakage. Ours moves one block on each sound the music makes, and never between
- Preset measured: speed 0.55, swirl 0.82, punch 1.31, look change 0.38, wash 0.03
- Scene measured: speed 0.27, swirl 0.67, punch 2.83, look change 0.37, wash 0.04

### 38. Mass Stars: `nebula`

- Preset: `Sparkle/Mass Stars/suksma - ed geining hateops - Fixation Nail Trimmer.milk`
- It uses: moves by place (dx, dy, warp); warp shader; blur; echo; 1 shape; motion vectors
- It looks like: a yellow-green glowing cloud
- Scene: [`scenes/nebula.rhai`](../../scenes/nebula.rhai); kept: the cloud. Ours takes its colours from the palette and puts hard stars in front
- Preset measured: speed 0.08, swirl 0.84, punch 1.28, look change 0.78, wash 0.29
- Scene measured: speed 0.03, swirl 0.63, punch 3.41, look change 0.38, wash 0.16

### 39. Squares: `mosaic`

- Preset: `Sparkle/Squares/suksma - barium titanate --- Isosceles edit07.milk`
- It uses: warp shader; composite shader; blur; 4 shapes
- It looks like: a wall of small squares that zooms and spins
- Scene: [`scenes/mosaic.rhai`](../../scenes/mosaic.rhai); kept: the wall and the zoom. Ours runs waves of size over the tiles; it does not spin
- Preset measured: speed 0.63, swirl 0.70, punch 1.20, look change 0.23, wash 0.01
- Scene measured: speed 0.17, swirl 0.26, punch 7.32, look change 0.51, wash 0.24

## Supernova

### 40. Burst: `amoeba`

- Preset: `Supernova/Burst/suksma - Dark One - Clouds - das yi hyper phosphene ejaculate.milk`
- It uses: moves by place (warp, zoom); warp shader; composite shader; blur; 2 shapes
- It looks like: one blob on black, filled with the outlines of its earlier shapes
- Scene: [`scenes/amoeba.rhai`](../../scenes/amoeba.rhai); kept: all of it. Ours bends the outline with the melody
- Preset measured: speed 0.28, swirl 0.79, punch 1.19, look change 0.08, wash 0.06
- Scene measured: speed 0.12, swirl 0.53, punch 4.10, look change 0.01, wash 0.03

### 41. Lasers: `flare`

- Preset: `Supernova/Lasers/$$$ Royal - Mashup (63).milk`
- It uses: moves by place (rot, zoom); warp shader; composite shader; blur; 3 custom waves; 3 shapes, 3 textured with the frame
- It looks like: a white star with rays over a field of colour
- Scene: [`scenes/flare.rhai`](../../scenes/flare.rhai); kept: the star and its rays. Ours makes them from a light several times brighter than white, and grows it with the section
- Preset measured: speed 0.20, swirl 0.80, punch 1.38, look change 0.66, wash 0.34
- Scene measured: speed 0.25, swirl 0.74, punch 42.11, look change 0.06, wash 0.10

### 42. Orbits: `binary`

- Preset: `Supernova/Orbits/Syst3mFailur - satanic ring V2.milk`
- It uses: echo; 1 custom wave; 1 shape, 1 textured with the frame
- It looks like: projectM drew this one as a plain white frame; only its name, orbits round a supernova, was left to go on
- Scene: [`scenes/binary.rhai`](../../scenes/binary.rhai); from the name: two stars in orbit and three bodies round them, in real depth, each drawing its path
- Preset measured: speed 0.70, swirl 0.89, look change 0.11, wash 0.00
- Scene measured: speed 0.07, swirl 0.61, punch 3.09, look change 0.17, wash 0.11

### 43. Radiate: `beam`

- Preset: `Supernova/Radiate/EvilJim - #26 I see Light!.milk`
- It uses: moves by place (zoom); waveform 3
- It looks like: a faint bow-tie of light on black
- Scene: [`scenes/beam.rhai`](../../scenes/beam.rhai); kept: the two opposed beams. Ours sweeps them like a lighthouse and adds a second pair going the other way
- Preset measured: speed 0.26, swirl 0.74, punch 1.21, look change 0.01, wash 0.00
- Scene measured: speed 0.18, swirl 0.84, punch 1.44, look change 0.15, wash 0.30

### 44. Stars: `halo`

- Preset: `Supernova/Stars/PieturP - HSL-tunnelvisions_morphing - mash0000 - solidity in discontinuity vs quantum instability.milk`
- It uses: moves by place (dx, dy, zoom); warp shader; blur; echo; waveform 6; 2 custom waves; 2 shapes, 2 textured with the frame; borders
- It looks like: rings and arcs in purple and red round a glowing middle
- Scene: [`scenes/halo.rhai`](../../scenes/halo.rhai); kept: all of it. Ours breaks each ring and turns alternate ones opposite ways
- Preset measured: speed 0.08, swirl 0.76, punch 1.05, look change 0.15, wash 0.04
- Scene measured: speed 0.10, swirl 0.78, punch 4.02, look change 0.13, wash 0.29

## Waveform

### 45. Spectrum: `bubbles`

- Preset: `Waveform/Spectrum/phlab salute.milk`
- It uses: moves by place (dy); warp shader; composite shader; blur; 3 custom waves; 1 shape, 1 textured with the frame; borders
- It looks like: marbled blue and green liquid with bubbles in it
- Scene: [`scenes/bubbles.rhai`](../../scenes/bubbles.rhai); kept: the bubbles and the marbling. The preset's name promised a spectrum, which neither it nor ours shows
- Preset measured: speed 0.38, swirl 0.95, punch 1.32, look change 0.53, wash 0.55
- Scene measured: speed 0.05, swirl 0.54, punch 2.11, look change 0.53, wash 0.13

### 46. Wire Circular: `pinwheel`

- Preset: `Waveform/Wire Circular/Geiss - Reaction Diffusion (Puddle Mix)s a aa aa.milk`
- It uses: moves by place (rot, zoom); warp shader; composite shader; blur; waveform 0
- It looks like: broad spiral bands in red, green and orange
- Scene: [`scenes/pinwheel.rhai`](../../scenes/pinwheel.rhai); kept: the spiral bands. Ours lays them down from three jets on a spinning hub
- Preset measured: speed 0.41, swirl 0.86, punch 1.07, look change 0.31, wash 0.41
- Scene measured: speed 0.22, swirl 0.78, punch 2.25, look change 0.19, wash 0.58

### 47. Wire Flat Double: `horizon`

- Preset: `Waveform/Wire Flat Double/Stahlregen - Downpour x Spectre PS2 (Contact Mix).milk`
- It uses: warp shader; composite shader; blur; waveform 6; borders
- It looks like: wavy lines running across a dark frame
- Scene: [`scenes/horizon.rhai`](../../scenes/horizon.rhai); kept: all of it. Ours gives each line a part of the band and bows them a little, like a horizon
- Preset measured: speed 0.38, swirl 0.83, punch 1.04, look change 0.04, wash 0.07
- Scene measured: speed 0.16, swirl 0.57, punch 3.32, look change 0.05, wash 0.28

### 48. Wire Spirograph: `spirograph`

- Preset: `Waveform/Wire Spirograph/Fumbling_Foo & Cope, Flexi, Martin, Orb - Star Forge v8 hue shifter.milk`
- It uses: moves by place (dx, rot, zoom); warp shader; composite shader; blur; echo; 1 custom wave; 1 shape
- It looks like: a mandala of concentric rings in very strong colour
- Scene: [`scenes/spirograph.rhai`](../../scenes/spirograph.rhai); kept: the mandala and the colour. Ours draws it stroke by stroke, with five pens on geared wheels seen through a kaleidoscope
- Preset measured: speed 0.08, swirl 0.75, punch 2.07, look change 0.66, wash 0.41
- Scene measured: speed 0.10, swirl 0.61, punch 3.39, look change 0.47, wash 0.32

### 49. Wire Tunnel: `tunnel`

- Preset: `Waveform/Wire Tunnel/fiShbRaiN + geiss + goody + stahlregen + martin + others - a butterfly dreaming it was a demon.milk`
- It uses: warp shader; composite shader; blur; echo; waveform 0; 1 custom wave; 3 shapes, 1 textured with the frame
- It looks like: yellow and red flower shapes bursting outwards
- Scene: [`scenes/tunnel.rhai`](../../scenes/tunnel.rhai); kept: the burst and the petals. Ours is a wavering ring thrown outwards, with the melody in the wall
- Preset measured: speed 0.14, swirl 0.86, punch 1.38, look change 0.51, wash 0.37
- Scene measured: speed 0.30, swirl 0.63, punch 1.67, look change 0.15, wash 0.46
