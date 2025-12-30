import { defineConfig } from "vite";

export default defineConfig({
  root: "demo",
  build: {
    outDir: "../demo-dist",
  },
  resolve: {
    alias: {
      "@octoseq/wavesurfer-signalviewer": new URL("./src/index.ts", import.meta.url).pathname,
    },
  },
});
