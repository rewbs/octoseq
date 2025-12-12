/**
 * WGSL kernel: mel filterbank projection.
 *
 * Computes per-frame mel band energies:
 *   out[frame, mel] = log10(eps + sum_k mags[frame, k] * filters[mel, k])
 *
 * Notes:
 * - FFT/STFT stays on CPU (spectrogram()). This kernel only accelerates the dense projection.
 * - Numerical differences vs CPU are expected to be small (floating point order-of-ops).
 */
export const melProjectWGSL = /* wgsl */ `
struct Params {
  nBins: u32,
  nMels: u32,
  nFrames: u32,
  _pad: u32,
};

@group(0) @binding(0) var<storage, read> mags : array<f32>;
@group(0) @binding(1) var<storage, read> filters : array<f32>;
@group(0) @binding(2) var<storage, read_write> out : array<f32>;
@group(0) @binding(3) var<uniform> params : Params;

fn log10(x: f32) -> f32 {
  return log(x) / log(10.0);
}

@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) gid : vec3<u32>) {
  let frame = gid.x;
  let mel = gid.y;
  if (frame >= params.nFrames || mel >= params.nMels) {
    return;
  }

  var sum: f32 = 0.0;
  let bins = params.nBins;
  let magBase = frame * bins;
  let filBase = mel * bins;

  for (var k: u32 = 0u; k < bins; k = k + 1u) {
    sum = sum + mags[magBase + k] * filters[filBase + k];
  }

  let eps: f32 = 1e-12;
  out[frame * params.nMels + mel] = log10(eps + sum);
}
`;
