import { describe, expect, it } from "vitest";
import { decimator } from "./decimator.js";
import { normalizer } from "./normalizer.js";
import { clamp } from "./utils.js";
import type { ContinuousSignal } from "./types.js";

function makeSignal(values: number[]): ContinuousSignal {
  return {
    kind: "continuous",
    times: new Float32Array(values.map((_, i) => i * 0.1)),
    values: new Float32Array(values),
  };
}

describe("clamp", () => {
  it("clamps into range and passes through in-range values", () => {
    expect(clamp(5, 0, 1)).toBe(1);
    expect(clamp(-5, 0, 1)).toBe(0);
    expect(clamp(0.5, 0, 1)).toBe(0.5);
  });
});

describe("normalizer", () => {
  it("computes global bounds and round-trips normalize/denormalize", () => {
    const signal = makeSignal([2, 4, 6, 8]);
    const bounds = normalizer.computeBounds(signal, "global");
    expect(bounds.min).toBe(2);
    expect(bounds.max).toBe(8);
    expect(normalizer.normalize(5, bounds)).toBeCloseTo(0.5, 5);
    expect(normalizer.denormalize(0.5, bounds)).toBeCloseTo(5, 5);
  });
});

describe("decimator", () => {
  it("returns points unchanged when under the target", () => {
    const times = new Float32Array([0, 0.1, 0.2, 0.3]);
    const values = new Float32Array([1, 2, 3, 4]);
    const out = decimator.decimate(times, values, 0, 0.3, 100);
    expect(out.times.length).toBe(4);
    expect(Array.from(out.values)).toEqual([1, 2, 3, 4]);
  });

  it("reduces dense data toward the target point count", () => {
    const n = 10_000;
    const times = new Float32Array(n).map((_, i) => i / 1000);
    const values = new Float32Array(n).map((_, i) => Math.sin(i / 50));
    const out = decimator.decimate(times, values, 0, 10, 200);
    expect(out.times.length).toBeGreaterThan(0);
    expect(out.times.length).toBeLessThan(n / 4);
  });
});
