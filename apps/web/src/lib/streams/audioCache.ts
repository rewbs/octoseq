/**
 * Audio Cache — decoded PCM, keyed by StreamId.
 *
 * Deliberately NOT a Zustand store: decoded buffers are large, never rendered
 * directly, and serializing them through reactive state/devtools is pure overhead.
 * Components that need to react to audio availability should watch the stream's
 * AudioReference in streamStore; the buffer itself is fetched from here on demand.
 *
 * Only AudioStreams have cache entries. Band streams read their parent's PCM.
 */

import type { AudioBufferLike } from "@octoseq/mir";
import type { StreamId } from "./types";

const buffers = new Map<StreamId, AudioBufferLike>();

/**
 * Original encoded file bytes, kept transiently for asset registration and cloud
 * upload, then cleared. Same non-reactive rationale as the PCM cache.
 */
const rawFiles = new Map<StreamId, ArrayBuffer>();

export const rawFileCache = {
  set(id: StreamId, buffer: ArrayBuffer): void {
    rawFiles.set(id, buffer);
  },
  get(id: StreamId): ArrayBuffer | null {
    return rawFiles.get(id) ?? null;
  },
  delete(id: StreamId): boolean {
    return rawFiles.delete(id);
  },
  clear(): void {
    rawFiles.clear();
  },
};

export const audioCache = {
  set(id: StreamId, buffer: AudioBufferLike): void {
    buffers.set(id, buffer);
  },

  get(id: StreamId): AudioBufferLike | null {
    return buffers.get(id) ?? null;
  },

  has(id: StreamId): boolean {
    return buffers.has(id);
  },

  delete(id: StreamId): boolean {
    return buffers.delete(id);
  },

  clear(): void {
    buffers.clear();
  },

  size(): number {
    return buffers.size;
  },
};
