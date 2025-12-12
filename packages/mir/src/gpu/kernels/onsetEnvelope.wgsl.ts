export const onsetEnvelopeWGSL = /* wgsl */ `
// Compute onset strength envelope from a (log) mel spectrogram.
//
// Input layout: melFlat[t*nMels + m]
// Output layout: out[t]
//
// We compute novelty per frame:
//   novelty[t] = sum_m max(0, mel[t,m] - mel[t-1,m])   (rectified)
//            or sum_m abs(...)
//
// One invocation computes one frame index (t). This is memory-bound but reduces a full
// (frames*mels) loop to the GPU and provides an end-to-end submit->readback timing.

struct Params {
  nMels: u32,
  nFrames: u32,
  diffMethod: u32, // 0=rectified, 1=abs
  _pad: u32,
};

@group(0) @binding(0) var<storage, read> melFlat: array<f32>;
@group(0) @binding(1) var<storage, read_write> out: array<f32>;
@group(0) @binding(2) var<uniform> params: Params;

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let t = gid.x;
  if (t >= params.nFrames) { return; }

  if (t == 0u) {
    out[t] = 0.0;
    return;
  }

  let nMels = params.nMels;
  var sum: f32 = 0.0;

  // Linear loop: nMels is small (e.g. 64). Keeping it serial per-frame is fine.
  // (Future optimisation: parallelise reduction within workgroup.)
  for (var m: u32 = 0u; m < nMels; m = m + 1u) {
    let a = melFlat[t * nMels + m];
    let b = melFlat[(t - 1u) * nMels + m];
    let d = a - b;

    if (params.diffMethod == 1u) {
      // abs
      sum = sum + abs(d);
    } else {
      // rectified
      sum = sum + max(0.0, d);
    }
  }

  out[t] = sum / max(1.0, f32(nMels));
}
`;
