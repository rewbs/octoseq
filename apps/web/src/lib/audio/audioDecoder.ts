"use client";

/**
 * Audio Decoder Utility
 *
 * Decodes audio from various sources for MIR analysis.
 *
 * DESIGN PRINCIPLES:
 * - Playback wants URLs. Analysis wants PCM. Authority wants one owner.
 * - This module provides the PCM path for MIR analysis.
 * - Decoding is lazy (on-demand) and can be cached in AudioInput.audioBuffer.
 * - All decoding goes through this module for consistency.
 */

import type { AudioBufferLike } from "@octoseq/mir";
import type { AudioSource } from "@/lib/stores/types/audioInput";
import { getAssetDownloadUrls } from "@/lib/actions/asset";

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export interface DecodeOptions {
  /** AbortSignal for cancellation */
  signal?: AbortSignal;
  /** Callback for progress updates */
  onProgress?: (phase: "fetching" | "decoding", progress?: number) => void;
}

export interface DecodeResult {
  /** The decoded audio buffer (PCM data for MIR) */
  buffer: AudioBufferLike;
  /** Sample rate of the decoded audio */
  sampleRate: number;
  /** Duration in seconds */
  duration: number;
  /** Number of samples */
  length: number;
}

// -----------------------------------------------------------------------------
// Core Decoding
// -----------------------------------------------------------------------------

/**
 * Decode audio from an AudioSource for MIR analysis.
 *
 * This is the main entry point for getting PCM data from any audio source type.
 * Results should be cached in AudioInput.audioBuffer to avoid re-decoding.
 *
 * @param source - The AudioSource to decode
 * @param options - Decoding options including cancellation
 * @returns The decoded audio as an AudioBufferLike
 */
export async function decodeAudioSource(
  source: AudioSource,
  options: DecodeOptions = {}
): Promise<DecodeResult> {
  const { signal, onProgress } = options;

  // Check for cancellation
  if (signal?.aborted) {
    throw new DOMException("Aborted", "AbortError");
  }

  switch (source.type) {
    case "local":
      return decodeLocalFile(source.file, options);

    case "remote":
      return decodeRemoteAsset(source.cloudAssetId, options);

    case "generated":
      // Generated sources should already have their buffer available
      // This path shouldn't normally be called, but handle it gracefully
      throw new Error(
        "Generated sources should have their buffer set during generation"
      );
  }
}

/**
 * Decode a local File to PCM data.
 */
async function decodeLocalFile(
  file: File,
  options: DecodeOptions
): Promise<DecodeResult> {
  const { signal, onProgress } = options;

  onProgress?.("fetching");

  // Read file as ArrayBuffer
  const arrayBuffer = await file.arrayBuffer();

  if (signal?.aborted) {
    throw new DOMException("Aborted", "AbortError");
  }

  onProgress?.("decoding");

  // Decode with AudioContext
  const audioContext = new AudioContext();
  try {
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

    if (signal?.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }

    return createDecodeResult(audioBuffer);
  } finally {
    await audioContext.close();
  }
}

/**
 * Decode a remote asset (from R2 storage) to PCM data.
 */
async function decodeRemoteAsset(
  cloudAssetId: string,
  options: DecodeOptions
): Promise<DecodeResult> {
  const { signal, onProgress } = options;

  onProgress?.("fetching");

  // Get the download URL from the server
  const result = await getAssetDownloadUrls({ assetIds: [cloudAssetId] });

  if (signal?.aborted) {
    throw new DOMException("Aborted", "AbortError");
  }

  if (!result?.data?.assets || result.data.assets.length === 0) {
    throw new Error(`Failed to get download URL for asset: ${cloudAssetId}`);
  }

  const assetInfo = result.data.assets[0];
  if (!assetInfo) {
    throw new Error(`Asset not found: ${cloudAssetId}`);
  }

  // Fetch the audio file
  const response = await fetch(assetInfo.downloadUrl, { signal });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  const arrayBuffer = await response.arrayBuffer();

  if (signal?.aborted) {
    throw new DOMException("Aborted", "AbortError");
  }

  onProgress?.("decoding");

  // Decode with AudioContext
  const audioContext = new AudioContext();
  try {
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

    if (signal?.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }

    return createDecodeResult(audioBuffer);
  } finally {
    await audioContext.close();
  }
}

/**
 * Decode an ArrayBuffer directly to PCM data.
 * Used when you already have the raw audio bytes (e.g., from WaveSurfer decode).
 */
export async function decodeArrayBuffer(
  arrayBuffer: ArrayBuffer,
  options: DecodeOptions = {}
): Promise<DecodeResult> {
  const { signal, onProgress } = options;

  if (signal?.aborted) {
    throw new DOMException("Aborted", "AbortError");
  }

  onProgress?.("decoding");

  const audioContext = new AudioContext();
  try {
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

    if (signal?.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }

    return createDecodeResult(audioBuffer);
  } finally {
    await audioContext.close();
  }
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

/**
 * Create a DecodeResult from a Web Audio AudioBuffer.
 * The returned AudioBufferLike wraps the native AudioBuffer.
 */
function createDecodeResult(audioBuffer: AudioBuffer): DecodeResult {
  const audioBufferLike: AudioBufferLike = {
    sampleRate: audioBuffer.sampleRate,
    numberOfChannels: audioBuffer.numberOfChannels,
    getChannelData: (channel: number) => audioBuffer.getChannelData(channel),
  };

  return {
    buffer: audioBufferLike,
    sampleRate: audioBuffer.sampleRate,
    duration: audioBuffer.duration,
    length: audioBuffer.length,
  };
}

/**
 * Create an AudioBufferLike from raw channel data.
 * Used when you have Float32Arrays directly (e.g., from mixdown generation).
 */
export function createAudioBufferLike(
  channels: Float32Array[],
  sampleRate: number
): AudioBufferLike {
  return {
    sampleRate,
    numberOfChannels: channels.length,
    getChannelData: (channel: number) => {
      if (channel < 0 || channel >= channels.length) {
        throw new RangeError(
          `Channel ${channel} out of range [0, ${channels.length - 1}]`
        );
      }
      // Non-null assertion safe because we've validated the bounds
      return channels[channel]!;
    },
  };
}
