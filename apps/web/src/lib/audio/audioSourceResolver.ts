/**
 * Audio Source Resolver
 *
 * Centralized, cancelable resolution of AudioSource → URL.
 *
 * DESIGN PRINCIPLES:
 * - Playback wants URLs. Analysis wants PCM. Authority wants one owner.
 * - This resolver produces URLs for WaveSurfer playback only.
 * - Decoding is NOT done here - that's for MIR analysis (see audioDecoder.ts).
 * - Resolution is idempotent, cancelable, and resilient to rapid source switching.
 */

import { getAssetDownloadUrls } from "@/lib/actions/asset";
import type { AudioSource } from "@/lib/stores/types/audioInput";

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export interface ResolveOptions {
  /** AbortSignal for cancellation */
  signal?: AbortSignal;
  /** Callback for status updates during resolution */
  onStatusChange?: (status: "resolving" | "ready" | "failed") => void;
}

export interface ResolveResult {
  /** The resolved URL for playback */
  url: string;
  /** Cleanup function to revoke blob URLs (if applicable) */
  cleanup?: () => void;
}

// -----------------------------------------------------------------------------
// Resolution Functions
// -----------------------------------------------------------------------------

/**
 * Resolve a local file to a blob URL.
 * Creates an object URL from the File object.
 */
async function resolveLocalSource(
  file: File,
  options: ResolveOptions
): Promise<ResolveResult> {
  options.onStatusChange?.("resolving");

  // Check for cancellation
  if (options.signal?.aborted) {
    throw new DOMException("Aborted", "AbortError");
  }

  // Create blob URL from file
  const url = URL.createObjectURL(file);

  options.onStatusChange?.("ready");

  return {
    url,
    cleanup: () => URL.revokeObjectURL(url),
  };
}

/**
 * Resolve a remote asset to a pre-signed download URL.
 * Fetches the download URL from the server.
 */
async function resolveRemoteSource(
  cloudAssetId: string,
  options: ResolveOptions
): Promise<ResolveResult> {
  options.onStatusChange?.("resolving");

  // Check for cancellation
  if (options.signal?.aborted) {
    throw new DOMException("Aborted", "AbortError");
  }

  // Fetch pre-signed download URL from server
  const result = await getAssetDownloadUrls({ assetIds: [cloudAssetId] });

  // Check for cancellation after async operation
  if (options.signal?.aborted) {
    throw new DOMException("Aborted", "AbortError");
  }

  if (!result?.data?.assets || result.data.assets.length === 0) {
    throw new Error(`Failed to get download URL for asset: ${cloudAssetId}`);
  }

  const assetInfo = result.data.assets[0];
  if (!assetInfo?.downloadUrl) {
    throw new Error(`No download URL returned for asset: ${cloudAssetId}`);
  }

  options.onStatusChange?.("ready");

  return {
    url: assetInfo.downloadUrl,
    // Remote URLs don't need cleanup - they expire naturally
  };
}

/**
 * Resolve a generated audio source.
 * Generated sources should already have a URL set during generation.
 */
async function resolveGeneratedSource(
  source: Extract<AudioSource, { type: "generated" }>,
  options: ResolveOptions
): Promise<ResolveResult> {
  options.onStatusChange?.("resolving");

  // Check for cancellation
  if (options.signal?.aborted) {
    throw new DOMException("Aborted", "AbortError");
  }

  // Generated sources should already have a URL
  if (source.url) {
    options.onStatusChange?.("ready");
    return {
      url: source.url,
      // Don't provide cleanup - the URL is managed by the generator
    };
  }

  // If no URL, the generation hasn't completed yet
  throw new Error("Generated source does not have a URL yet");
}

// -----------------------------------------------------------------------------
// Main Resolver
// -----------------------------------------------------------------------------

/**
 * Resolve an AudioSource to a playback URL.
 *
 * This is the single entry point for URL resolution.
 * It handles all source types and provides cancelation support.
 *
 * @param source - The audio source to resolve
 * @param options - Resolution options (signal, callbacks)
 * @returns Promise<ResolveResult> with the URL and optional cleanup function
 * @throws DOMException with name "AbortError" if cancelled
 * @throws Error if resolution fails
 */
export async function resolveAudioSource(
  source: AudioSource,
  options: ResolveOptions = {}
): Promise<ResolveResult> {
  switch (source.type) {
    case "local":
      return resolveLocalSource(source.file, options);

    case "remote":
      return resolveRemoteSource(source.cloudAssetId, options);

    case "generated":
      return resolveGeneratedSource(source, options);

    default:
      // TypeScript exhaustiveness check
      const _exhaustive: never = source;
      throw new Error(`Unknown source type: ${(_exhaustive as AudioSource).type}`);
  }
}
