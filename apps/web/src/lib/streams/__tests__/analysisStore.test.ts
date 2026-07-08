import { beforeEach, describe, expect, it } from "vitest";
import { useAnalysisStore } from "../analysisStore";
import { analysisKey, stableParamsHash, type AnalysisResult } from "../types";

const store = () => useAnalysisStore.getState();

function fakeResult(tag: string): AnalysisResult {
  return {
    kind: "1d",
    tag,
    times: new Float32Array([0]),
    values: new Float32Array([0]),
  } as unknown as AnalysisResult;
}

beforeEach(() => {
  store().reset();
});

describe("stableParamsHash", () => {
  it("hashes undefined and empty params to 'default'", () => {
    expect(stableParamsHash()).toBe("default");
    expect(stableParamsHash({})).toBe("default");
  });

  it("is insensitive to key order", () => {
    expect(stableParamsHash({ a: 1, b: "x" })).toBe(stableParamsHash({ b: "x", a: 1 }));
  });

  it("is sensitive to values and keys", () => {
    expect(stableParamsHash({ a: 1 })).not.toBe(stableParamsHash({ a: 2 }));
    expect(stableParamsHash({ a: 1 })).not.toBe(stableParamsHash({ b: 1 }));
  });
});

describe("analysisKey", () => {
  it("builds streamId::analysisId::hash", () => {
    expect(analysisKey("s1", "onsetEnvelope")).toBe("s1::onsetEnvelope::default");
    const withParams = analysisKey("s1", "onsetEnvelope", { smoothMs: 50 });
    expect(withParams.startsWith("s1::onsetEnvelope::")).toBe(true);
    expect(withParams).not.toBe("s1::onsetEnvelope::default");
  });
});

describe("result lifecycle", () => {
  const key = analysisKey("s1", "spectralFlux");

  it("setPending marks pending and clears a previous error", () => {
    store().setError(key, "boom");
    store().setPending(key);
    expect(store().isPending(key)).toBe(true);
    expect(store().getError(key)).toBeNull();
  });

  it("setResult stores the result and clears pending and error", () => {
    store().setPending(key);
    const result = fakeResult("r1");
    store().setResult(key, result);
    expect(store().getResult(key)).toBe(result);
    expect(store().isPending(key)).toBe(false);
    expect(store().getError(key)).toBeNull();
  });

  it("setError records the message and clears pending", () => {
    store().setPending(key);
    store().setError(key, "boom");
    expect(store().getError(key)).toBe("boom");
    expect(store().isPending(key)).toBe(false);
  });
});

describe("invalidation", () => {
  it("invalidateStream drops only that stream's entries and returns the result count", () => {
    store().setResult(analysisKey("s1", "spectralFlux"), fakeResult("a"));
    store().setResult(analysisKey("s1", "onsetEnvelope", { x: 1 }), fakeResult("b"));
    store().setResult(analysisKey("s2", "spectralFlux"), fakeResult("c"));
    store().setPending(analysisKey("s1", "mfcc"));
    store().setError(analysisKey("s1", "melSpectrogram"), "boom");

    const removed = store().invalidateStream("s1");

    expect(removed).toBe(2);
    expect(store().getResult(analysisKey("s1", "spectralFlux"))).toBeNull();
    expect(store().getResult(analysisKey("s1", "onsetEnvelope", { x: 1 }))).toBeNull();
    expect(store().isPending(analysisKey("s1", "mfcc"))).toBe(false);
    expect(store().getError(analysisKey("s1", "melSpectrogram"))).toBeNull();
    expect(store().getResult(analysisKey("s2", "spectralFlux"))).not.toBeNull();
  });

  it("invalidateStream does not match stream ids by substring", () => {
    store().setResult(analysisKey("s1", "spectralFlux"), fakeResult("a"));
    store().setResult(analysisKey("s10", "spectralFlux"), fakeResult("b"));
    store().invalidateStream("s1");
    expect(store().getResult(analysisKey("s10", "spectralFlux"))).not.toBeNull();
  });

  it("invalidateKey drops a single entry", () => {
    const k1 = analysisKey("s1", "spectralFlux");
    const k2 = analysisKey("s1", "onsetEnvelope");
    store().setResult(k1, fakeResult("a"));
    store().setResult(k2, fakeResult("b"));
    store().invalidateKey(k1);
    expect(store().getResult(k1)).toBeNull();
    expect(store().getResult(k2)).not.toBeNull();
  });

  it("invalidateAll clears everything", () => {
    store().setResult(analysisKey("s1", "spectralFlux"), fakeResult("a"));
    store().setPending(analysisKey("s2", "mfcc"));
    store().invalidateAll();
    expect(store().results.size).toBe(0);
    expect(store().pending.size).toBe(0);
  });
});
