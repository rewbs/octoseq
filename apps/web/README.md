Octoseq web is a local-first MIR playground with:
- WaveSurfer waveform + single-region selection
- 1D/2D MIR visualisation (mel, onset, HPSS, MFCC, peaks)
- Deterministic within-track similarity search (fingerprint + sliding window) running in a Web Worker
- Optional WebGPU acceleration for mel/onset stages

All audio stays on-device; drop a file and explore.

## Run locally

First, run the development server:

```bash
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

## Workflow

1) Load an audio file (local file input).
2) Pick a MIR function (spectral centroid/flux, onset envelope/peaks, mel/HPSS/MFCC variants) and run analysis.
3) Select a region on the waveform. Use “Search Controls” to set precision/threshold/weights/softmax, then “Run search”.
4) Toggle tabs under the waveform:
   - Similarity (search curve + threshold line)
   - MIR outputs: one tab per MIR function you’ve run (1D/events/2D heatmaps)
5) Click candidate markers to jump playback; the search panel shows timing + window/hop stats.

## Notes
- All MIR + search runs in a Web Worker; cancellation is supported.
- WebGPU is optional; disable via the Debug panel if needed.
- Region selection is single-active; metrics (start/end/duration/samples) are shown below the waveform.

## Troubleshooting
- If similarity or MIR tabs look empty, ensure you’ve run the corresponding analysis; results are cached per MIR function.
- If WebGPU fails, uncheck “Enable WebGPU” in Debug and rerun.
