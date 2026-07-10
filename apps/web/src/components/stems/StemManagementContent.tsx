"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { Upload, Info, X, Combine, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useCandidateEventStore } from "@/lib/stores/candidateEventStore";
import {
  MIXDOWN_STREAM_ID,
  addStemWithAudio,
  audioCache,
  isAudioStream,
  loadMixdown,
  rawFileCache,
  removeStreamCascade,
  runStreamAnalysis,
  useAudioSourceStore,
  useStreamStore,
  type AudioStream,
  type GeneratedAudioSource,
  type Stream,
} from "@/lib/streams";
import type { AudioBufferLike } from "@octoseq/mir";
import { generateMixdownFromStems, createBlobUrlFromBuffer } from "@/lib/audio/mixdownGenerator";
import { StemListItem } from "./StemListItem";
import { useCloudAssetUploader } from "@/lib/hooks/useCloudAssetUploader";
import { computeContentHash } from "@/lib/persistence/assetHashing";

/**
 * Content panel for managing stems.
 * Rendered when the "Stems" tree node is expanded.
 */
export function StemManagementContent() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [deletedStem, setDeletedStem] = useState<{
    removed: Stream[];
    buffer: AudioBufferLike | null;
    label: string;
    timeoutId: ReturnType<typeof setTimeout>;
  } | null>(null);
  const [isGeneratingMixdown, setIsGeneratingMixdown] = useState(false);

  const { streams, selectedStreamId, renameStream, reorderStreams, restoreStreams, selectStream } =
    useStreamStore(
      useShallow((s) => ({
        streams: s.streams,
        selectedStreamId: s.selectedStreamId,
        renameStream: s.renameStream,
        reorderStreams: s.reorderStreams,
        restoreStreams: s.restoreStreams,
        selectStream: s.selectStream,
      }))
    );
  const setCurrentSource = useAudioSourceStore((s) => s.setCurrentSource);

  // Cloud upload
  const { uploadToCloud, isSignedIn } = useCloudAssetUploader();

  const stems = useMemo(
    () =>
      [...streams.values()]
        .filter((s): s is AudioStream => s.kind === "stem")
        .sort((a, b) => a.sortOrder - b.sortOrder),
    [streams]
  );

  // DnD sensors
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5, // 5px movement before drag starts
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;

      if (over && active.id !== over.id) {
        const stemOrder = stems.map((s) => s.id);
        const oldIndex = stemOrder.indexOf(active.id as string);
        const newIndex = stemOrder.indexOf(over.id as string);

        if (oldIndex !== -1 && newIndex !== -1) {
          const newOrder = [...stemOrder];
          const [removed] = newOrder.splice(oldIndex, 1);
          if (removed) {
            newOrder.splice(newIndex, 0, removed);
            reorderStreams(newOrder);
          }
        }
      }
    },
    [stems, reorderStreams]
  );

  const handleFileSelect = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (!files || files.length === 0) return;

      // Process all selected files
      const audioContext = new AudioContext();

      for (const file of Array.from(files)) {
        try {
          // Read file as ArrayBuffer (original bytes for cloud upload)
          const arrayBuffer = await file.arrayBuffer();

          // Compute content hash for deduplication
          const contentHash = await computeContentHash(arrayBuffer);

          // Decode the audio file (needs a copy since decodeAudioData consumes the buffer)
          const audioBuffer = await audioContext.decodeAudioData(arrayBuffer.slice(0));

          // Create blob URL for playback
          const blob = new Blob([arrayBuffer], { type: file.type });
          const audioUrl = URL.createObjectURL(blob);

          // Extract file name without extension as label
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

          // Start cloud upload if signed in
          if (isSignedIn) {
            console.log("[StemUpload] Starting cloud upload for:", file.name);
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
                console.log("[StemUpload] Upload complete:", cloudAssetId);
                const stream = useStreamStore.getState().getStream(stemId);
                if (stream && isAudioStream(stream)) {
                  useStreamStore.getState().updateAudio(stemId, { ...stream.audio, cloudAssetId });
                }
                rawFileCache.delete(stemId);
              },
              onError: (error) => {
                console.error("[StemUpload] Upload failed:", error);
              },
            });
          }

          // Auto-run key MIR analyses on the new stem
          // Wait for analyses to complete before processing next file to avoid cancellation
          await runStreamAnalysis(stemId, "onsetEnvelope");
          await runStreamAnalysis(stemId, "spectralFlux");
        } catch (error) {
          console.error(`Failed to import stem "${file.name}":`, error);
        }
      }

      // Reset the file input
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    },
    [isSignedIn, uploadToCloud]
  );

  const handleDeleteStem = useCallback(
    (stemId: string) => {
      if (deleteConfirmId === stemId) {
        // Capture the PCM before removal so undo can restore it (removeStreamCascade
        // drops the cached buffer along with analyses)
        const buffer = audioCache.get(stemId);
        const removed = removeStreamCascade(stemId);

        if (removed.length > 0) {
          // Clear any pending undo
          if (deletedStem) {
            clearTimeout(deletedStem.timeoutId);
          }

          // Clear candidate events for this stem
          // (band streams of this stem were already removed by removeStreamCascade)
          useCandidateEventStore.getState().clearForSource(stemId);

          // Set up undo with timeout
          const timeoutId = setTimeout(() => {
            setDeletedStem(null);
          }, 5000); // 5 seconds to undo

          setDeletedStem({ removed, buffer, label: removed[0]!.label, timeoutId });
        }

        setDeleteConfirmId(null);
      } else {
        setDeleteConfirmId(stemId);
        // Clear confirmation after 3 seconds
        setTimeout(() => setDeleteConfirmId(null), 3000);
      }
    },
    [deleteConfirmId, deletedStem]
  );

  const handleUndoDelete = useCallback(() => {
    if (deletedStem) {
      clearTimeout(deletedStem.timeoutId);
      if (deletedStem.buffer) {
        audioCache.set(deletedStem.removed[0]!.id, deletedStem.buffer);
      }
      restoreStreams(deletedStem.removed);
      setDeletedStem(null);
    }
  }, [deletedStem, restoreStreams]);

  const handleDismissUndo = useCallback(() => {
    if (deletedStem) {
      clearTimeout(deletedStem.timeoutId);
      setDeletedStem(null);
    }
  }, [deletedStem]);

  const handleGenerateMixdown = useCallback(async () => {
    const allStems = useStreamStore.getState().getStems();
    if (allStems.length === 0) return;

    setIsGeneratingMixdown(true);

    try {
      // Get audio buffers from all stems
      const stemBuffers = allStems
        .map((stem) => audioCache.get(stem.id))
        .filter((buffer): buffer is NonNullable<typeof buffer> => buffer != null);

      if (stemBuffers.length === 0) {
        console.error("No audio buffers found in stems");
        return;
      }

      // Generate mixed audio
      const mixedBuffer = generateMixdownFromStems(stemBuffers);
      const audioUrl = createBlobUrlFromBuffer(mixedBuffer, mixedBuffer.sampleRate);

      // Calculate duration from the buffer
      const samples = mixedBuffer.getChannelData(0).length;
      const duration = samples / mixedBuffer.sampleRate;

      // Update the mixdown stream (caches the PCM and invalidates analyses)
      loadMixdown({
        audio: {
          origin: { kind: "generated", generatedFrom: allStems.map((s) => s.id) },
          url: audioUrl,
          durationSec: duration,
          sampleRate: mixedBuffer.sampleRate,
          channels: mixedBuffer.numberOfChannels,
        },
        buffer: mixedBuffer,
        label: "Generated Mixdown",
      });

      // =======================================================================
      // DESIGN: Create GeneratedAudioSource with ready status (we have the URL).
      // This is the single source of truth for playback - WaveSurfer will load
      // from this URL.
      // =======================================================================
      const generatedSource: GeneratedAudioSource = {
        type: "generated",
        id: MIXDOWN_STREAM_ID,
        generatedFrom: allStems.map((s) => s.id),
        status: "ready",
        url: audioUrl,
      };
      setCurrentSource(generatedSource);

      // Run MIR analysis on the new mixdown
      await runStreamAnalysis(MIXDOWN_STREAM_ID, "onsetEnvelope");
      await runStreamAnalysis(MIXDOWN_STREAM_ID, "spectralFlux");
    } catch (error) {
      console.error("Failed to generate mixdown:", error);
    } finally {
      setIsGeneratingMixdown(false);
    }
  }, [setCurrentSource]);

  return (
    <div className="flex flex-col">
      {/* Import Stem Button */}
      <div className="p-2 space-y-2">
        <Button
          variant="outline"
          size="sm"
          className="w-full"
          onClick={() => fileInputRef.current?.click()}
        >
          <Upload className="h-4 w-4 mr-1" />
          Import Stems
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept="audio/*"
          multiple
          className="hidden"
          onChange={handleFileSelect}
        />
        {/* Generate Mixdown Button */}
        <Button
          variant="outline"
          size="sm"
          className="w-full"
          disabled={stems.length === 0 || isGeneratingMixdown}
          onClick={handleGenerateMixdown}
        >
          {isGeneratingMixdown ? (
            <Loader2 className="h-4 w-4 mr-1 animate-spin" />
          ) : (
            <Combine className="h-4 w-4 mr-1" />
          )}
          Generate Mixdown
        </Button>
      </div>

      {/* Stem List */}
      <div className="px-2 space-y-1">
        {stems.length === 0 ? (
          <div className="flex items-start gap-2 px-1 py-4 text-xs text-zinc-500 dark:text-zinc-400">
            <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            <span>
              No stems imported yet.
              <br />
              Click &quot;Import Stem&quot; to add separated audio tracks.
            </span>
          </div>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext items={stems.map((s) => s.id)} strategy={verticalListSortingStrategy}>
              {stems.map((stem, index) => (
                <StemListItem
                  key={stem.id}
                  stemId={stem.id}
                  label={stem.label}
                  colorIndex={index}
                  isSelected={stem.id === selectedStreamId}
                  isDeleting={stem.id === deleteConfirmId}
                  onSelect={() => selectStream(stem.id)}
                  onRename={(newLabel) => renameStream(stem.id, newLabel)}
                  onDelete={() => handleDeleteStem(stem.id)}
                />
              ))}
            </SortableContext>
          </DndContext>
        )}
      </div>

      {/* Undo Delete Toast */}
      {deletedStem && (
        <div className="p-2 border-t border-zinc-200 dark:border-zinc-800">
          <div className="flex items-center justify-between gap-2 px-2 py-1.5 rounded-md bg-zinc-100 dark:bg-zinc-800">
            <span className="text-xs text-zinc-600 dark:text-zinc-400">
              Deleted &quot;{deletedStem.label}&quot;
            </span>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-xs text-blue-600 hover:text-blue-700"
                onClick={handleUndoDelete}
              >
                Undo
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 text-zinc-400 hover:text-zinc-600"
                onClick={handleDismissUndo}
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Toast */}
      {deleteConfirmId && !deletedStem && (
        <div className="p-2 border-t border-zinc-200 dark:border-zinc-800">
          <div className="text-xs text-amber-600 dark:text-amber-400 text-center px-2">
            This will remove the stem and its analysis data.
            <br />
            Click delete again to confirm.
          </div>
        </div>
      )}
    </div>
  );
}
