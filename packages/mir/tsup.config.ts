import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/runner/runMir.ts", "src/runner/workerProtocol.ts"],
  format: ["esm"],
  dts: true,
  sourcemap: true,
  clean: true,
  target: "es2022",
  treeshake: true
});
