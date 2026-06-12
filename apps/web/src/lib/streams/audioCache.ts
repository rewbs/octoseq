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
