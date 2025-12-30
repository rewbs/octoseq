/**
 * Synthetic signal generators for demo
 */

import type { ContinuousSignal, SparseSignal } from "../src/types.js";

/**
 * Generate a sine wave signal
 */
export function generateSineWave(
  duration: number,
  frequency: number,
  sampleRate: number = 100
): ContinuousSignal {
  const numSamples = Math.floor(duration * sampleRate);
  const times = new Float32Array(numSamples);
  const values = new Float32Array(numSamples);

  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    times[i] = t;
    values[i] = Math.sin(2 * Math.PI * frequency * t);
  }

  return {
    kind: "continuous",
    times,
    values,
    meta: {
      domain: { min: -1, max: 1 },
      label: "Sine Wave",
    },
  };
}

/**
 * Generate an amplitude envelope (positive-only)
 */
export function generateEnvelope(
  duration: number,
  attackTime: number = 0.1,
  decayTime: number = 0.3,
  sustainLevel: number = 0.7,
  releaseTime: number = 0.5,
  sampleRate: number = 100
): ContinuousSignal {
  const numSamples = Math.floor(duration * sampleRate);
  const times = new Float32Array(numSamples);
  const values = new Float32Array(numSamples);

  const noteOnTime = 0;
  const noteOffTime = duration - releaseTime;

  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    times[i] = t;

    let value: number;

    if (t < attackTime) {
      // Attack phase
      value = t / attackTime;
    } else if (t < attackTime + decayTime) {
      // Decay phase
      const decayProgress = (t - attackTime) / decayTime;
      value = 1 - (1 - sustainLevel) * decayProgress;
    } else if (t < noteOffTime) {
      // Sustain phase
      value = sustainLevel;
    } else {
      // Release phase
      const releaseProgress = (t - noteOffTime) / releaseTime;
      value = sustainLevel * (1 - releaseProgress);
    }

    values[i] = Math.max(0, value);
  }

  return {
    kind: "continuous",
    times,
    values,
    meta: {
      domain: { min: 0, max: 1 },
      label: "Envelope",
    },
  };
}

/**
 * Generate a noise signal (positive-only, smoothed)
 */
export function generateNoise(
  duration: number,
  sampleRate: number = 100,
  smoothing: number = 0.8
): ContinuousSignal {
  const numSamples = Math.floor(duration * sampleRate);
  const times = new Float32Array(numSamples);
  const values = new Float32Array(numSamples);

  let prevValue = 0.5;

  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    times[i] = t;

    // Smooth random walk
    const noise = Math.random();
    const smoothed = prevValue * smoothing + noise * (1 - smoothing);
    values[i] = smoothed;
    prevValue = smoothed;
  }

  return {
    kind: "continuous",
    times,
    values,
    meta: {
      domain: { min: 0, max: 1 },
      label: "Noise",
    },
  };
}

/**
 * Generate sparse events (like onset peaks)
 */
export function generateSparseEvents(
  duration: number,
  averageInterval: number = 0.5,
  jitter: number = 0.2
): SparseSignal {
  const events: { time: number; strength: number }[] = [];

  let t = averageInterval * Math.random();
  while (t < duration) {
    events.push({
      time: t,
      strength: 0.5 + 0.5 * Math.random(),
    });

    // Next event with jitter
    const interval = averageInterval * (1 + (Math.random() - 0.5) * 2 * jitter);
    t += Math.max(0.1, interval);
  }

  const times = new Float32Array(events.map((e) => e.time));
  const strengths = new Float32Array(events.map((e) => e.strength));

  return {
    kind: "sparse",
    times,
    strengths,
    meta: {
      label: "Events",
    },
  };
}

/**
 * Generate a stepped signal (like quantized data)
 */
export function generateSteppedSignal(
  duration: number,
  numSteps: number = 20
): ContinuousSignal {
  const times = new Float32Array(numSteps);
  const values = new Float32Array(numSteps);

  for (let i = 0; i < numSteps; i++) {
    times[i] = (i / numSteps) * duration;
    values[i] = Math.floor(Math.random() * 5) / 4; // 0, 0.25, 0.5, 0.75, 1
  }

  return {
    kind: "continuous",
    times,
    values,
    meta: {
      domain: { min: 0, max: 1 },
      label: "Steps",
    },
  };
}
