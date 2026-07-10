import { describe, expect, it } from "vitest";
import { DEFAULT_SCRIPT, migrateDefaultScript } from "./defaultScripts";

describe("migrateDefaultScript", () => {
  it("repairs the Neon Reactor RMS reference", () => {
    const legacy = DEFAULT_SCRIPT.replace(
      "let wave = radial.wave(energy, #{",
      "let wave = radial.wave(inputs.mix.rms.smooth.moving_average(0.1), #{"
    );

    expect(migrateDefaultScript(legacy)).toBe(DEFAULT_SCRIPT);
  });

  it("does not alter user-authored scripts", () => {
    const script = "let wave = radial.wave(inputs.mix.rms.smooth.moving_average(0.1), #{});";
    expect(migrateDefaultScript(script)).toBe(script);
  });
});
