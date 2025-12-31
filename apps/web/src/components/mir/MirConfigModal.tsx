"use client";

import { useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { Modal } from "@/components/ui/modal";
import { useConfigStore } from "@/lib/stores";
import type { MirFunctionId } from "./MirControlPanel";
import type { HeatmapColorScheme } from "@/components/heatmap/TimeAlignedHeatmapPixi";

type FilterOption = "all" | MirFunctionId;

/**
 * Modal for configuring MIR analysis parameters.
 * Uses configStore directly instead of receiving props.
 */
export function MirConfigModal() {
  const [filter, setFilter] = useState<FilterOption>("all");

  // Config state and actions from store
  const {
    isConfigOpen,
    fftSize,
    hopSize,
    melBands,
    melFMin,
    melFMax,
    onsetSmoothMs,
    onsetDiffMethod,
    onsetUseLog,
    peakMinIntervalMs,
    peakThreshold,
    peakAdaptiveFactor,
    transientFftSize,
    transientHopSize,
    timbreFftSize,
    timbreHopSize,
    hpssTimeMedian,
    hpssFreqMedian,
    mfccNCoeffs,
    tempoMinBpm,
    tempoMaxBpm,
    tempoBinSize,
    tempoMaxHypotheses,
    tempoWeightByStrength,
    showDcBin,
    showMfccC0,
    heatmapScheme,
    cqtBinsPerOctave,
    cqtFMin,
    cqtFMax,
  } = useConfigStore(
    useShallow((s) => ({
      isConfigOpen: s.isConfigOpen,
      fftSize: s.fftSize,
      hopSize: s.hopSize,
      melBands: s.melBands,
      melFMin: s.melFMin,
      melFMax: s.melFMax,
      onsetSmoothMs: s.onsetSmoothMs,
      onsetDiffMethod: s.onsetDiffMethod,
      onsetUseLog: s.onsetUseLog,
      peakMinIntervalMs: s.peakMinIntervalMs,
      peakThreshold: s.peakThreshold,
      peakAdaptiveFactor: s.peakAdaptiveFactor,
      transientFftSize: s.transientFftSize,
      transientHopSize: s.transientHopSize,
      timbreFftSize: s.timbreFftSize,
      timbreHopSize: s.timbreHopSize,
      hpssTimeMedian: s.hpssTimeMedian,
      hpssFreqMedian: s.hpssFreqMedian,
      mfccNCoeffs: s.mfccNCoeffs,
      tempoMinBpm: s.tempoMinBpm,
      tempoMaxBpm: s.tempoMaxBpm,
      tempoBinSize: s.tempoBinSize,
      tempoMaxHypotheses: s.tempoMaxHypotheses,
      tempoWeightByStrength: s.tempoWeightByStrength,
      showDcBin: s.showDcBin,
      showMfccC0: s.showMfccC0,
      heatmapScheme: s.heatmapScheme,
      cqtBinsPerOctave: s.cqtBinsPerOctave,
      cqtFMin: s.cqtFMin,
      cqtFMax: s.cqtFMax,
    }))
  );

  const {
    setIsConfigOpen,
    setFftSize,
    setHopSize,
    setMelBands,
    setMelFMin,
    setMelFMax,
    setOnsetSmoothMs,
    setOnsetDiffMethod,
    setOnsetUseLog,
    setPeakMinIntervalMs,
    setPeakThreshold,
    setPeakAdaptiveFactor,
    setTransientFftSize,
    setTransientHopSize,
    setTimbreFftSize,
    setTimbreHopSize,
    setHpssTimeMedian,
    setHpssFreqMedian,
    setMfccNCoeffs,
    setTempoMinBpm,
    setTempoMaxBpm,
    setTempoBinSize,
    setTempoMaxHypotheses,
    setTempoWeightByStrength,
    setShowDcBin,
    setShowMfccC0,
    setHeatmapScheme,
    setCqtBinsPerOctave,
    setCqtFMin,
    setCqtFMax,
  } = useConfigStore(
    useShallow((s) => ({
      setIsConfigOpen: s.setIsConfigOpen,
      setFftSize: s.setFftSize,
      setHopSize: s.setHopSize,
      setMelBands: s.setMelBands,
      setMelFMin: s.setMelFMin,
      setMelFMax: s.setMelFMax,
      setOnsetSmoothMs: s.setOnsetSmoothMs,
      setOnsetDiffMethod: s.setOnsetDiffMethod,
      setOnsetUseLog: s.setOnsetUseLog,
      setPeakMinIntervalMs: s.setPeakMinIntervalMs,
      setPeakThreshold: s.setPeakThreshold,
      setPeakAdaptiveFactor: s.setPeakAdaptiveFactor,
      setTransientFftSize: s.setTransientFftSize,
      setTransientHopSize: s.setTransientHopSize,
      setTimbreFftSize: s.setTimbreFftSize,
      setTimbreHopSize: s.setTimbreHopSize,
      setHpssTimeMedian: s.setHpssTimeMedian,
      setHpssFreqMedian: s.setHpssFreqMedian,
      setMfccNCoeffs: s.setMfccNCoeffs,
      setTempoMinBpm: s.setTempoMinBpm,
      setTempoMaxBpm: s.setTempoMaxBpm,
      setTempoBinSize: s.setTempoBinSize,
      setTempoMaxHypotheses: s.setTempoMaxHypotheses,
      setTempoWeightByStrength: s.setTempoWeightByStrength,
      setShowDcBin: s.setShowDcBin,
      setShowMfccC0: s.setShowMfccC0,
      setHeatmapScheme: s.setHeatmapScheme,
      setCqtBinsPerOctave: s.setCqtBinsPerOctave,
      setCqtFMin: s.setCqtFMin,
      setCqtFMax: s.setCqtFMax,
    }))
  );

  const usesMel =
    filter === "all" ||
    filter === "melSpectrogram" ||
    filter === "onsetEnvelope" ||
    filter === "onsetPeaks" ||
    filter === "beatCandidates" ||
    filter === "mfcc" ||
    filter === "mfccDelta" ||
    filter === "mfccDeltaDelta";

  const usesOnset = filter === "all" || filter === "onsetEnvelope" || filter === "onsetPeaks";

  const usesPeakPick = filter === "all" || filter === "onsetPeaks";

  const usesHpss = filter === "all" || filter === "hpssHarmonic" || filter === "hpssPercussive";

  const usesMfcc =
    filter === "all" || filter === "mfcc" || filter === "mfccDelta" || filter === "mfccDeltaDelta";

  const usesHeatmapFn =
    filter === "all" ||
    filter === "melSpectrogram" ||
    filter === "hpssHarmonic" ||
    filter === "hpssPercussive" ||
    filter === "mfcc" ||
    filter === "mfccDelta" ||
    filter === "mfccDeltaDelta";

  const usesTempo = filter === "all" || filter === "tempoHypotheses";

  const usesCqt =
    filter === "all" ||
    filter === "cqtHarmonicEnergy" ||
    filter === "cqtBassPitchMotion" ||
    filter === "cqtTonalStability";

  return (
    <Modal title="MIR Configuration" open={isConfigOpen} onOpenChange={setIsConfigOpen}>
      <div className="space-y-4">
        {/* Filter Control */}
        <div className="flex items-center gap-2 border-b border-zinc-100 pb-3 dark:border-zinc-800">
          <label className="text-sm font-medium text-zinc-700 dark:text-zinc-200">
            Show options for:
          </label>
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value as FilterOption)}
            className="rounded-md border border-zinc-200 bg-white px-2 py-1 text-sm dark:border-zinc-800 dark:bg-zinc-950"
          >
            <option value="all">All Functions</option>
            <option value="spectralCentroid">Spectral Centroid (1D)</option>
            <option value="spectralFlux">Spectral Flux (1D)</option>
            <option value="onsetEnvelope">Onset Envelope (1D)</option>
            <option value="onsetPeaks">Onset Peaks (events)</option>
            <option value="beatCandidates">Beat Candidates (events)</option>
            <option value="melSpectrogram">Mel Spectrogram (2D)</option>
            <option value="hpssHarmonic">HPSS Harmonic Spectrogram (2D)</option>
            <option value="hpssPercussive">HPSS Percussive Spectrogram (2D)</option>
            <option value="mfcc">MFCC (2D)</option>
            <option value="mfccDelta">MFCC Delta (2D)</option>
            <option value="mfccDeltaDelta">MFCC Delta-Delta (2D)</option>
            <option value="tempoHypotheses">Tempo Hypotheses</option>
            <option value="cqtHarmonicEnergy">CQT Harmonic Energy (1D)</option>
            <option value="cqtBassPitchMotion">CQT Bass Pitch Motion (1D)</option>
            <option value="cqtTonalStability">CQT Tonal Stability (1D)</option>
          </select>
        </div>

        <div className="space-y-3">
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
            <label className="grid grid-cols-[160px,1fr] items-center gap-2">
              <span className="text-xs text-zinc-600 dark:text-zinc-300">FFT size (power of 2)</span>
              <input
                type="number"
                min={64}
                step={64}
                value={fftSize}
                onChange={(e) => setFftSize(Math.max(64, Math.floor(Number(e.target.value)) || 64))}
                className="rounded border border-zinc-200 bg-white px-2 py-1 text-sm dark:border-zinc-800 dark:bg-zinc-950"
              />
            </label>
            <label className="grid grid-cols-[160px,1fr] items-center gap-2">
              <span className="text-xs text-zinc-600 dark:text-zinc-300">Hop size</span>
              <input
                type="number"
                min={1}
                step={16}
                value={hopSize}
                onChange={(e) => setHopSize(Math.max(1, Math.floor(Number(e.target.value)) || 1))}
                className="rounded border border-zinc-200 bg-white px-2 py-1 text-sm dark:border-zinc-800 dark:bg-zinc-950"
              />
            </label>
          </div>

          {usesMel && (
            <div className="rounded-md border border-zinc-100 bg-zinc-50/50 p-2 dark:border-zinc-800/50 dark:bg-zinc-900/50">
              <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-zinc-500">
                Mel Spectrogram
              </h3>
              <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                <label className="grid grid-cols-[160px,1fr] items-center gap-2">
                  <span className="text-xs text-zinc-600 dark:text-zinc-300">Mel bands (nMels)</span>
                  <input
                    type="number"
                    min={1}
                    max={256}
                    step={1}
                    value={melBands}
                    onChange={(e) =>
                      setMelBands(Math.max(1, Math.floor(Number(e.target.value)) || 1))
                    }
                    className="rounded border border-zinc-200 bg-white px-2 py-1 text-sm dark:border-zinc-800 dark:bg-zinc-950"
                  />
                </label>
                <label className="grid grid-cols-[160px,1fr] items-center gap-2">
                  <span className="text-xs text-zinc-600 dark:text-zinc-300">Mel fMin (Hz)</span>
                  <input
                    type="number"
                    min={0}
                    step={10}
                    value={melFMin}
                    onChange={(e) => setMelFMin(e.target.value)}
                    placeholder="default"
                    className="rounded border border-zinc-200 bg-white px-2 py-1 text-sm dark:border-zinc-800 dark:bg-zinc-950"
                  />
                </label>
                <label className="grid grid-cols-[160px,1fr] items-center gap-2">
                  <span className="text-xs text-zinc-600 dark:text-zinc-300">Mel fMax (Hz)</span>
                  <input
                    type="number"
                    min={0}
                    step={10}
                    value={melFMax}
                    onChange={(e) => setMelFMax(e.target.value)}
                    placeholder="default (Nyquist)"
                    className="rounded border border-zinc-200 bg-white px-2 py-1 text-sm dark:border-zinc-800 dark:bg-zinc-950"
                  />
                </label>
              </div>
            </div>
          )}

          {usesOnset && (
            <div className="rounded-md border border-zinc-100 bg-zinc-50/50 p-2 dark:border-zinc-800/50 dark:bg-zinc-900/50">
              <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-zinc-500">
                Onset Detection
              </h3>
              <div className="space-y-1.5">
                <label className="grid grid-cols-[180px,1fr,60px] items-center gap-2">
                  <span className="text-xs text-zinc-600 dark:text-zinc-300">
                    Onset smoothing (ms)
                  </span>
                  <input
                    type="range"
                    min={0}
                    max={200}
                    step={5}
                    value={onsetSmoothMs}
                    onChange={(e) => setOnsetSmoothMs(Number(e.target.value))}
                  />
                  <span className="text-right text-xs tabular-nums text-zinc-600 dark:text-zinc-300">
                    {onsetSmoothMs}
                  </span>
                </label>

                <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                  <label className="grid grid-cols-[160px,1fr] items-center gap-2">
                    <span className="text-xs text-zinc-600 dark:text-zinc-300">Diff method</span>
                    <select
                      value={onsetDiffMethod}
                      onChange={(e) =>
                        setOnsetDiffMethod(e.target.value as "rectified" | "abs")
                      }
                      className="rounded-md border border-zinc-200 bg-white px-2 py-1 text-sm dark:border-zinc-800 dark:bg-zinc-950"
                    >
                      <option value="rectified">Rectified (positive only)</option>
                      <option value="abs">Absolute</option>
                    </select>
                  </label>
                  <label className="inline-flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={onsetUseLog}
                      onChange={(e) => setOnsetUseLog(e.target.checked)}
                    />
                    <span className="text-xs text-zinc-600 dark:text-zinc-300">
                      Log-compress differences
                    </span>
                  </label>
                </div>
              </div>
            </div>
          )}

          {usesPeakPick && (
            <div className="rounded-md border border-zinc-100 bg-zinc-50/50 p-2 dark:border-zinc-800/50 dark:bg-zinc-900/50">
              <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-zinc-500">
                Peak Picking
              </h3>
              <div className="space-y-1.5">
                <label className="grid grid-cols-[180px,1fr,60px] items-center gap-2">
                  <span className="text-xs text-zinc-600 dark:text-zinc-300">
                    Peak min interval (ms)
                  </span>
                  <input
                    type="range"
                    min={20}
                    max={400}
                    step={10}
                    value={peakMinIntervalMs}
                    onChange={(e) => setPeakMinIntervalMs(Number(e.target.value))}
                  />
                  <span className="text-right text-xs tabular-nums text-zinc-600 dark:text-zinc-300">
                    {peakMinIntervalMs}
                  </span>
                </label>

                <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
                  <label className="grid grid-cols-[140px,1fr] items-center gap-2">
                    <span className="text-xs text-zinc-600 dark:text-zinc-300">Peak threshold</span>
                    <input
                      type="number"
                      step={0.01}
                      value={peakThreshold}
                      onChange={(e) => setPeakThreshold(e.target.value)}
                      placeholder="auto"
                      className="rounded border border-zinc-200 bg-white px-2 py-1 text-sm dark:border-zinc-800 dark:bg-zinc-950"
                    />
                  </label>
                  <label className="grid grid-cols-[140px,1fr] items-center gap-2">
                    <span className="text-xs text-zinc-600 dark:text-zinc-300">Adaptive factor</span>
                    <input
                      type="number"
                      step={0.1}
                      value={peakAdaptiveFactor}
                      onChange={(e) => setPeakAdaptiveFactor(e.target.value)}
                      placeholder="blank = off"
                      className="rounded border border-zinc-200 bg-white px-2 py-1 text-sm dark:border-zinc-800 dark:bg-zinc-950"
                    />
                  </label>
                </div>
              </div>
            </div>
          )}

          {usesHpss && (
            <div className="rounded-md border border-zinc-100 bg-zinc-50/50 p-2 dark:border-zinc-800/50 dark:bg-zinc-900/50">
              <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-zinc-500">
                Transient FFT (HPSS)
              </h3>
              <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                <label className="grid grid-cols-[160px,1fr] items-center gap-2">
                  <span className="text-xs text-zinc-600 dark:text-zinc-300">FFT size (power of 2)</span>
                  <input
                    type="number"
                    min={64}
                    step={64}
                    value={transientFftSize}
                    onChange={(e) => setTransientFftSize(Math.max(64, Math.floor(Number(e.target.value)) || 64))}
                    className="rounded border border-zinc-200 bg-white px-2 py-1 text-sm dark:border-zinc-800 dark:bg-zinc-950"
                  />
                </label>
                <label className="grid grid-cols-[160px,1fr] items-center gap-2">
                  <span className="text-xs text-zinc-600 dark:text-zinc-300">Hop size</span>
                  <input
                    type="number"
                    min={1}
                    step={16}
                    value={transientHopSize}
                    onChange={(e) => setTransientHopSize(Math.max(1, Math.floor(Number(e.target.value)) || 1))}
                    className="rounded border border-zinc-200 bg-white px-2 py-1 text-sm dark:border-zinc-800 dark:bg-zinc-950"
                  />
                </label>
                <label className="grid grid-cols-[160px,1fr] items-center gap-2">
                  <span className="text-xs text-zinc-600 dark:text-zinc-300">Time median</span>
                  <input
                    type="number"
                    min={1}
                    step={2}
                    value={hpssTimeMedian}
                    onChange={(e) =>
                      setHpssTimeMedian(Math.max(1, Math.floor(Number(e.target.value)) | 1))
                    }
                    className="rounded border border-zinc-200 bg-white px-2 py-1 text-sm dark:border-zinc-800 dark:bg-zinc-950"
                  />
                </label>
                <label className="grid grid-cols-[160px,1fr] items-center gap-2">
                  <span className="text-xs text-zinc-600 dark:text-zinc-300">Freq median</span>
                  <input
                    type="number"
                    min={1}
                    step={2}
                    value={hpssFreqMedian}
                    onChange={(e) =>
                      setHpssFreqMedian(Math.max(1, Math.floor(Number(e.target.value)) | 1))
                    }
                    className="rounded border border-zinc-200 bg-white px-2 py-1 text-sm dark:border-zinc-800 dark:bg-zinc-950"
                  />
                </label>
              </div>
            </div>
          )}

          {usesMfcc && (
            <div className="rounded-md border border-zinc-100 bg-zinc-50/50 p-2 dark:border-zinc-800/50 dark:bg-zinc-900/50">
              <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-zinc-500">
                Timbre FFT (MFCC)
              </h3>
              <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                <label className="grid grid-cols-[160px,1fr] items-center gap-2">
                  <span className="text-xs text-zinc-600 dark:text-zinc-300">FFT size (power of 2)</span>
                  <input
                    type="number"
                    min={64}
                    step={64}
                    value={timbreFftSize}
                    onChange={(e) => setTimbreFftSize(Math.max(64, Math.floor(Number(e.target.value)) || 64))}
                    className="rounded border border-zinc-200 bg-white px-2 py-1 text-sm dark:border-zinc-800 dark:bg-zinc-950"
                  />
                </label>
                <label className="grid grid-cols-[160px,1fr] items-center gap-2">
                  <span className="text-xs text-zinc-600 dark:text-zinc-300">Hop size</span>
                  <input
                    type="number"
                    min={1}
                    step={16}
                    value={timbreHopSize}
                    onChange={(e) => setTimbreHopSize(Math.max(1, Math.floor(Number(e.target.value)) || 1))}
                    className="rounded border border-zinc-200 bg-white px-2 py-1 text-sm dark:border-zinc-800 dark:bg-zinc-950"
                  />
                </label>
                <label className="grid grid-cols-[160px,1fr] items-center gap-2">
                  <span className="text-xs text-zinc-600 dark:text-zinc-300">Num coefficients</span>
                  <input
                    type="number"
                    min={1}
                    max={40}
                    step={1}
                    value={mfccNCoeffs}
                    onChange={(e) =>
                      setMfccNCoeffs(Math.max(1, Math.floor(Number(e.target.value)) || 1))
                    }
                    className="rounded border border-zinc-200 bg-white px-2 py-1 text-sm dark:border-zinc-800 dark:bg-zinc-950"
                  />
                </label>
              </div>
            </div>
          )}

          {usesTempo && (
            <div className="rounded-md border border-zinc-100 bg-zinc-50/50 p-2 dark:border-zinc-800/50 dark:bg-zinc-900/50">
              <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-zinc-500">
                Tempo Hypotheses
              </h3>
              <div className="space-y-1.5">
                <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                  <label className="grid grid-cols-[160px,1fr] items-center gap-2">
                    <span className="text-xs text-zinc-600 dark:text-zinc-300">Min BPM</span>
                    <input
                      type="number"
                      min={1}
                      max={300}
                      step={1}
                      value={tempoMinBpm}
                      onChange={(e) => setTempoMinBpm(Math.max(1, Math.floor(Number(e.target.value)) || 24))}
                      className="rounded border border-zinc-200 bg-white px-2 py-1 text-sm dark:border-zinc-800 dark:bg-zinc-950"
                    />
                  </label>
                  <label className="grid grid-cols-[160px,1fr] items-center gap-2">
                    <span className="text-xs text-zinc-600 dark:text-zinc-300">Max BPM</span>
                    <input
                      type="number"
                      min={1}
                      max={600}
                      step={1}
                      value={tempoMaxBpm}
                      onChange={(e) => setTempoMaxBpm(Math.max(1, Math.floor(Number(e.target.value)) || 300))}
                      className="rounded border border-zinc-200 bg-white px-2 py-1 text-sm dark:border-zinc-800 dark:bg-zinc-950"
                    />
                  </label>
                </div>
                <label className="grid grid-cols-[180px,1fr,60px] items-center gap-2">
                  <span className="text-xs text-zinc-600 dark:text-zinc-300">Bin size (BPM)</span>
                  <input
                    type="range"
                    min={0.1}
                    max={5}
                    step={0.1}
                    value={tempoBinSize}
                    onChange={(e) => setTempoBinSize(Number(e.target.value))}
                  />
                  <span className="text-right text-xs tabular-nums text-zinc-600 dark:text-zinc-300">
                    {tempoBinSize.toFixed(1)}
                  </span>
                </label>
                <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                  <label className="grid grid-cols-[160px,1fr] items-center gap-2">
                    <span className="text-xs text-zinc-600 dark:text-zinc-300">Max hypotheses</span>
                    <input
                      type="number"
                      min={1}
                      max={50}
                      step={1}
                      value={tempoMaxHypotheses}
                      onChange={(e) => setTempoMaxHypotheses(Math.max(1, Math.floor(Number(e.target.value)) || 10))}
                      className="rounded border border-zinc-200 bg-white px-2 py-1 text-sm dark:border-zinc-800 dark:bg-zinc-950"
                    />
                  </label>
                  <label className="inline-flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={tempoWeightByStrength}
                      onChange={(e) => setTempoWeightByStrength(e.target.checked)}
                    />
                    <span className="text-xs text-zinc-600 dark:text-zinc-300">
                      Weight by beat strength
                    </span>
                  </label>
                </div>
              </div>
            </div>
          )}

          {usesCqt && (
            <div className="rounded-md border border-zinc-100 bg-zinc-50/50 p-2 dark:border-zinc-800/50 dark:bg-zinc-900/50">
              <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-zinc-500">
                CQT (Constant-Q Transform)
              </h3>
              <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                <label className="grid grid-cols-[160px,1fr] items-center gap-2">
                  <span className="text-xs text-zinc-600 dark:text-zinc-300">Bins per octave</span>
                  <input
                    type="number"
                    min={1}
                    max={96}
                    step={1}
                    value={cqtBinsPerOctave}
                    onChange={(e) =>
                      setCqtBinsPerOctave(Math.max(1, Math.floor(Number(e.target.value)) || 24))
                    }
                    className="rounded border border-zinc-200 bg-white px-2 py-1 text-sm dark:border-zinc-800 dark:bg-zinc-950"
                  />
                </label>
                <label className="grid grid-cols-[160px,1fr] items-center gap-2">
                  <span className="text-xs text-zinc-600 dark:text-zinc-300">fMin (Hz)</span>
                  <input
                    type="number"
                    min={0}
                    step={1}
                    value={cqtFMin}
                    onChange={(e) => setCqtFMin(e.target.value)}
                    placeholder="32.7 (C1)"
                    className="rounded border border-zinc-200 bg-white px-2 py-1 text-sm dark:border-zinc-800 dark:bg-zinc-950"
                  />
                </label>
                <label className="grid grid-cols-[160px,1fr] items-center gap-2">
                  <span className="text-xs text-zinc-600 dark:text-zinc-300">fMax (Hz)</span>
                  <input
                    type="number"
                    min={0}
                    step={1}
                    value={cqtFMax}
                    onChange={(e) => setCqtFMax(e.target.value)}
                    placeholder="8372 (C9)"
                    className="rounded border border-zinc-200 bg-white px-2 py-1 text-sm dark:border-zinc-800 dark:bg-zinc-950"
                  />
                </label>
              </div>
            </div>
          )}

          <div className="rounded-md border border-zinc-100 bg-zinc-50/50 p-2 dark:border-zinc-800/50 dark:bg-zinc-900/50">
            <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-zinc-500">
              Display Options
            </h3>
            <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
              {usesHpss && (
                <label className="inline-flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={showDcBin}
                    onChange={(e) => setShowDcBin(e.target.checked)}
                  />
                  <span className="text-xs text-zinc-600 dark:text-zinc-300">
                    Show DC bin (spectrogram)
                  </span>
                </label>
              )}
              {usesMfcc && (
                <label className="inline-flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={showMfccC0}
                    onChange={(e) => setShowMfccC0(e.target.checked)}
                  />
                  <span className="text-xs text-zinc-600 dark:text-zinc-300">Show MFCC C0</span>
                </label>
              )}
              {usesHeatmapFn && (
                <label className="grid grid-cols-[160px,1fr] items-center gap-2">
                  <span className="text-xs text-zinc-600 dark:text-zinc-300">
                    Heatmap colour scheme
                  </span>
                  <select
                    value={heatmapScheme}
                    onChange={(e) => setHeatmapScheme(e.target.value as HeatmapColorScheme)}
                    className="rounded-md border border-zinc-200 bg-white px-2 py-1 text-sm dark:border-zinc-800 dark:bg-zinc-950"
                  >
                    <option value="grayscale">Grayscale</option>
                    <option value="viridis">Viridis</option>
                    <option value="plasma">Plasma</option>
                    <option value="magma">Magma</option>
                  </select>
                </label>
              )}
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
}
