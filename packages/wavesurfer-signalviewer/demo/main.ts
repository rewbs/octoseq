/**
 * SignalViewer Plugin Demo
 */

import WaveSurfer from "wavesurfer.js";
import { SignalViewerPlugin } from "../src/index.js";
import type { SignalViewerPluginInstance, RenderMode } from "../src/index.js";
import {
  generateSineWave,
  generateEnvelope,
  generateNoise,
  generateSparseEvents,
} from "./synthetic-signals.js";

// Demo audio URL (a short sample)
const DEMO_AUDIO_URL =
  "https://upload.wikimedia.org/wikipedia/commons/c/c8/Example.ogg";

async function main() {
  // Generate synthetic signals
  const duration = 30; // Will be updated when audio loads
  const sineSignal = generateSineWave(duration, 0.5, 100);
  const envelopeSignal = generateEnvelope(duration, 0.5, 1, 0.6, 2, 100);
  const noiseSignal = generateNoise(duration, 100, 0.9);
  const sparseSignal = generateSparseEvents(duration, 0.8, 0.3);

  // Create WaveSurfer
  const wavesurfer = WaveSurfer.create({
    container: "#waveform",
    waveColor: "#4ecca3",
    progressColor: "#1a936f",
    cursorColor: "#e94560",
    height: 80,
    barWidth: 2,
    barGap: 1,
    barRadius: 2,
    url: DEMO_AUDIO_URL,
  });

  // Register SignalViewer plugin
  let signalViewer: Awaited<
    ReturnType<typeof wavesurfer.registerPluginV8>
  > | null = null;
  let currentLayout: "overlay" | "stacked" = "overlay";
  let currentRenderMode: RenderMode = "filled";

  async function initSignalViewer() {
    if (signalViewer) {
      await wavesurfer.unregisterPluginV8("signalviewer");
    }

    signalViewer = await wavesurfer.registerPluginV8(
      SignalViewerPlugin({
        height: currentLayout === "stacked" ? 200 : 100,
        layout: currentLayout,
        backgroundColor: "rgba(15, 52, 96, 0.5)",
        showGrid: true,
        onHover: (time, values) => {
          document.getElementById("hoverTime")!.textContent = `${time.toFixed(3)}s`;
          document.getElementById("hoverSine")!.textContent =
            values["sine"] !== null ? values["sine"]?.toFixed(3) ?? "--" : "--";
          document.getElementById("hoverEnvelope")!.textContent =
            values["envelope"] !== null ? values["envelope"]?.toFixed(3) ?? "--" : "--";
          document.getElementById("hoverNoise")!.textContent =
            values["noise"] !== null ? values["noise"]?.toFixed(3) ?? "--" : "--";
        },
        layers: [
          {
            id: "sine",
            signal: sineSignal,
            mode: currentRenderMode,
            baseline: "center",
            normalization: "fixed",
            color: {
              stroke: "#3b82f6",
              fill: "rgba(59, 130, 246, 0.3)",
              strokeWidth: 2,
            },
          },
          {
            id: "envelope",
            signal: envelopeSignal,
            mode: currentRenderMode,
            baseline: "bottom",
            normalization: "fixed",
            color: {
              stroke: "#f59e0b",
              fill: "rgba(245, 158, 11, 0.3)",
              strokeWidth: 2,
            },
          },
          {
            id: "noise",
            signal: noiseSignal,
            mode: currentRenderMode,
            baseline: "bottom",
            normalization: "global",
            color: {
              stroke: "#10b981",
              fill: "rgba(16, 185, 129, 0.3)",
              strokeWidth: 1.5,
            },
          },
        ],
      })
    );
  }

  // Wait for audio to be ready
  wavesurfer.on("ready", async () => {
    await initSignalViewer();
  });

  // Play/pause button
  const playPauseBtn = document.getElementById("playPause")!;
  playPauseBtn.addEventListener("click", () => {
    wavesurfer.playPause();
  });

  wavesurfer.on("play", () => {
    playPauseBtn.textContent = "Pause";
  });

  wavesurfer.on("pause", () => {
    playPauseBtn.textContent = "Play";
  });

  // Stop button
  document.getElementById("stop")!.addEventListener("click", () => {
    wavesurfer.stop();
  });

  // Layout mode selector
  document.getElementById("layoutMode")!.addEventListener("change", async (e) => {
    currentLayout = (e.target as HTMLSelectElement).value as "overlay" | "stacked";
    await initSignalViewer();
  });

  // Render mode selector
  document.getElementById("renderMode")!.addEventListener("change", async (e) => {
    currentRenderMode = (e.target as HTMLSelectElement).value as RenderMode;

    if (signalViewer) {
      const actions = (signalViewer as unknown as { instance: SignalViewerPluginInstance }).instance.actions;
      actions.updateLayer("sine", { mode: currentRenderMode });
      actions.updateLayer("envelope", { mode: currentRenderMode });
      actions.updateLayer("noise", { mode: currentRenderMode });
    }
  });
}

main().catch(console.error);
