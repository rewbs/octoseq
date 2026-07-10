"use client";

import { useCallback } from "react";
import {
  addStemWithAudio,
  isAudioStream,
  rawFileCache,
  runStreamAnalysis,
  useStreamStore,
} from "@/lib/streams";
import { useCloudAssetUploader } from "@/lib/hooks/useCloudAssetUploader";
import { computeContentHash } from "@/lib/persistence/assetHashing";

/**
 * Stem file import flow, duplicated minimally from StemManagementContent
 * (which still exists and cannot be modified in this change): decode via
 * AudioContext, register the stream via addStemWithAudio, kick off the cloud
 * upload when signed in, and auto-run the key MIR analyses.
 */
export function useStemImport(): { importStemFiles: (files: File[]) => Promise<void> } {
  const { uploadToCloud, isSignedIn } = useCloudAssetUploader();

  const importStemFiles = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;

      const audioContext = new AudioContext();

      for (const file of files) {
        try {
          // Original bytes for hashing/cloud upload; decode consumes a copy.
          const arrayBuffer = await file.arrayBuffer();
          const contentHash = await computeContentHash(arrayBuffer);
          const audioBuffer = await audioContext.decodeAudioData(arrayBuffer.slice(0));

          const blob = new Blob([arrayBuffer], { type: file.type });
          const audioUrl = URL.createObjectURL(blob);

          // File name without extension as the initial label
          const label = file.name.replace(/\.[^/.]+$/, "");

          const stemId = addStemWithAudio({
            label,
            audio: {
              origin: { kind: "file", fileName: file.name },
              url: audioUrl,
              fileName: file.name,
              contentHash,
              mimeType: file.type || "audio/mpeg",
              durationSec: audioBuffer.duration,
              sampleRate: audioBuffer.sampleRate,
              channels: audioBuffer.numberOfChannels,
            },
            buffer: {
              sampleRate: audioBuffer.sampleRate,
              numberOfChannels: audioBuffer.numberOfChannels,
              getChannelData: (channel: number) => audioBuffer.getChannelData(channel),
            },
          });

          if (isSignedIn) {
            uploadToCloud({
              file,
              type: "AUDIO",
              metadata: {
                fileName: file.name,
                fileSize: file.size,
                sampleRate: audioBuffer.sampleRate,
                channels: audioBuffer.numberOfChannels,
                duration: audioBuffer.duration,
              },
              onComplete: (cloudAssetId) => {
                const stream = useStreamStore.getState().getStream(stemId);
                if (stream && isAudioStream(stream)) {
                  useStreamStore.getState().updateAudio(stemId, { ...stream.audio, cloudAssetId });
                }
                rawFileCache.delete(stemId);
              },
              onError: (error) => {
                console.error("[StemImport] Upload failed:", error);
              },
            });
          }

          // Auto-run key MIR analyses; await so parallel imports don't cancel each other
          await runStreamAnalysis(stemId, "onsetEnvelope");
          await runStreamAnalysis(stemId, "spectralFlux");
        } catch (error) {
          console.error(`Failed to import stem "${file.name}":`, error);
        }
      }
    },
    [isSignedIn, uploadToCloud]
  );

  return { importStemFiles };
}
