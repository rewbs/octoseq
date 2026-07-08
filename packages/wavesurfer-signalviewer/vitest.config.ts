import { defineConfig } from "vitest/config";

// The package-root vite.config.ts is for the demo app (root: "demo/"); without
// this file vitest inherits that root and finds no tests.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
