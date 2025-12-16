/**
 * WGSL kernel: HPSS mask estimation (harmonic/percussive) from a linear magnitude spectrogram.
 *
 * CPU reference path in `src/dsp/hpss.ts` uses true median filters with configurable kernels
 * (defaults 17x17). That is too slow, and implementing a general median on GPU would require
 * per-pixel sorting / dynamic allocation.
 *
 * GPU strategy (approximation, intentionally fixed):
 * - Use a fixed 9-tap 1D robust smoother in time (harmonic estimate) and in frequency
 *   (percussive estimate).
 * - Robust smoother is implemented as the exact median-of-9 via a fixed compare–swap
 *   sorting network (no dynamic memory, no data-dependent branches, fixed cost).
 *
 * This yields masks that are structurally faithful for visualisation / musical use, while
 * allowing a large performance win from GPU parallelism.
 *
 * Shapes:
 * - Input mags: flattened row-major [frame][bin], length = nFrames * nBins
 * - Output harmonicMask, percussiveMask: same layout and length
 */
export const hpssMasksWGSL = /* wgsl */ `
struct Params {
  nBins: u32,
  nFrames: u32,
  softMask: u32, // 1 => soft, 0 => hard
  _pad: u32,
};

@group(0) @binding(0) var<storage, read> mags : array<f32>;
@group(0) @binding(1) var<storage, read_write> harmonicMask : array<f32>;
@group(0) @binding(2) var<storage, read_write> percussiveMask : array<f32>;
@group(0) @binding(3) var<uniform> params : Params;

fn clamp_i32(x: i32, lo: i32, hi: i32) -> i32 {
  return max(lo, min(hi, x));
}

fn swap_if_greater(a: ptr<function, f32>, b: ptr<function, f32>) {
  // Branchless compare–swap.
  let av = *a;
  let bv = *b;
  *a = min(av, bv);
  *b = max(av, bv);
}

// Sorting network for 9 values; returns the 5th smallest (median).
//
// Notes:
// - This is fixed-cost and data-independent.
// - For our HPSS approximation we only need a robust center value, and exact median-of-9
//   is a good tradeoff vs kernel size.
fn median9(v0: f32, v1: f32, v2: f32, v3: f32, v4: f32, v5: f32, v6: f32, v7: f32, v8: f32) -> f32 {
  var a0 = v0; var a1 = v1; var a2 = v2;
  var a3 = v3; var a4 = v4; var a5 = v5;
  var a6 = v6; var a7 = v7; var a8 = v8;

  // 9-input sorting network (compare–swap stages). This is a known minimal-ish network.
  // We fully sort then take middle; cost is acceptable for 9.
  // Stage 1
  swap_if_greater(&a0,&a1); swap_if_greater(&a3,&a4); swap_if_greater(&a6,&a7);
  // Stage 2
  swap_if_greater(&a1,&a2); swap_if_greater(&a4,&a5); swap_if_greater(&a7,&a8);
  // Stage 3
  swap_if_greater(&a0,&a1); swap_if_greater(&a3,&a4); swap_if_greater(&a6,&a7);
  // Stage 4
  swap_if_greater(&a0,&a3); swap_if_greater(&a3,&a6); swap_if_greater(&a0,&a3);
  // Stage 5
  swap_if_greater(&a1,&a4); swap_if_greater(&a4,&a7); swap_if_greater(&a1,&a4);
  // Stage 6
  swap_if_greater(&a2,&a5); swap_if_greater(&a5,&a8); swap_if_greater(&a2,&a5);
  // Stage 7
  swap_if_greater(&a1,&a3); swap_if_greater(&a5,&a7);
  // Stage 8
  swap_if_greater(&a2,&a6);
  // Stage 9
  swap_if_greater(&a2,&a3); swap_if_greater(&a4,&a6);
  // Stage 10
  swap_if_greater(&a2,&a4); swap_if_greater(&a4,&a6);
  // Stage 11
  swap_if_greater(&a3,&a5); swap_if_greater(&a5,&a7);
  // Stage 12
  swap_if_greater(&a3,&a4); swap_if_greater(&a5,&a6);
  // Stage 13
  swap_if_greater(&a4,&a5);

  return a4;
}

fn mag_at(frame: i32, bin: i32) -> f32 {
  let f = clamp_i32(frame, 0, i32(params.nFrames) - 1);
  let b = clamp_i32(bin, 0, i32(params.nBins) - 1);
  let idx = u32(f) * params.nBins + u32(b);
  return mags[idx];
}

@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) gid : vec3<u32>) {
  let frame = gid.x;
  let bin = gid.y;

  if (frame >= params.nFrames || bin >= params.nBins) {
    return;
  }

  let f = i32(frame);
  let b = i32(bin);

  // Harmonic estimate: median in time over 9 taps.
  let h = median9(
    mag_at(f-4,b), mag_at(f-3,b), mag_at(f-2,b), mag_at(f-1,b), mag_at(f,b),
    mag_at(f+1,b), mag_at(f+2,b), mag_at(f+3,b), mag_at(f+4,b)
  );

  // Percussive estimate: median in frequency over 9 taps.
  let p = median9(
    mag_at(f,b-4), mag_at(f,b-3), mag_at(f,b-2), mag_at(f,b-1), mag_at(f,b),
    mag_at(f,b+1), mag_at(f,b+2), mag_at(f,b+3), mag_at(f,b+4)
  );

  let eps: f32 = 1e-12;
  let denom = max(eps, h + p);

  var mh = h / denom;
  var mp = p / denom;

  // Optional hard mask (kept for compatibility with CPU options).
  if (params.softMask == 0u) {
    let isH = h >= p;
    mh = select(0.0, 1.0, isH);
    mp = select(1.0, 0.0, isH);
  }

  let idx = frame * params.nBins + bin;
  harmonicMask[idx] = mh;
  percussiveMask[idx] = mp;
}
`;
