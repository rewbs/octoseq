// The loop's check on light brighter than white: two rings of one colour, the left
// at full brightness and the right at four times that. Nothing else: no feedback,
// no effects. Cut off at white, the right ring's red stays at 1 while its green
// climbs to 0.8, and it turns orange. Tone-mapped, it is the same red, paler.
// The colour is repeated in tools/loop/run.py (BRIGHT_COLOUR).
fn init(ctx) {
    camera.position = #{ x: 0.0, y: 0.0, z: 6.5 };
    camera.target = #{ x: 0.0, y: 0.0, z: 0.0 };

    let dim = radial.ring(#{ radius: 0.8, thickness: 0.6, segments: 48 });
    dim.position.x = -2.5;
    dim.material = "emissive";
    dim.materialParams.base_color = #{ r: 0.0, g: 0.0, b: 0.0, a: 1.0 };
    dim.materialParams.emission_color = #{ r: 1.0, g: 0.2, b: 0.05, a: 1.0 };
    dim.materialParams.emission_intensity = 1.0;
    scene.add(dim);

    let bright = radial.ring(#{ radius: 0.8, thickness: 0.6, segments: 48 });
    bright.position.x = 2.5;
    bright.material = "emissive";
    bright.materialParams.base_color = #{ r: 0.0, g: 0.0, b: 0.0, a: 1.0 };
    bright.materialParams.emission_color = #{ r: 1.0, g: 0.2, b: 0.05, a: 1.0 };
    bright.materialParams.emission_intensity = 4.0;
    scene.add(bright);
}
