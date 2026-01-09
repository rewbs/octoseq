"use client";

import { useCallback, useRef, useState } from "react";
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
import { useAudioInputStore } from "@/lib/stores/audioInputStore";
import { useMirStore } from "@/lib/stores/mirStore";
import { useCandidateEventStore } from "@/lib/stores/candidateEventStore";
import { useFrequencyBandStore } from "@/lib/stores/frequencyBandStore";
import { useMirActions } from "@/lib/stores/hooks/useMirActions";
import { generateMixdownFromStems, createBlobUrlFromBuffer } from "@/lib/audio/mixdownGenerator";
import type { AudioInput, AudioInputOrigin, GeneratedAudioSource } from "@/lib/stores/types/audioInput";
import { MIXDOWN_ID } from "@/lib/stores/types/audioInput";
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
    stem: AudioInput;
    index: number;
    timeoutId: ReturnType<typeof setTimeout>;
  } | null>(null);
  const [isGeneratingMixdown, setIsGeneratingMixdown] = useState(false);

  // MIR actions for auto-running analysis on stem load
  const { runAnalysis } = useMirActions();

  const {
    collection,
    selectedInputId,
    addStem,
    renameInput,
    reorderStems,
    removeStem,
    restoreStem,
    selectInput,
    updateMixdown,
    getStems,
    setCloudAssetId,
    setAssetMetadata,
    clearRawBuffer,
    setCurrentAudioSource,
  } = useAudioInputStore(
    useShallow((s) => ({
      collection: s.collection,
      selectedInputId: s.selectedInputId,
      addStem: s.addStem,
      renameInput: s.renameInput,
      reorderStems: s.reorderStems,
      removeStem: s.removeStem,
      restoreStem: s.restoreStem,
      selectInput: s.selectInput,
      updateMixdown: s.updateMixdown,
      getStems: s.getStems,
      setCloudAssetId: s.setCloudAssetId,
      setAssetMetadata: s.setAssetMetadata,
      clearRawBuffer: s.clearRawBuffer,
      setCurrentAudioSource: s.setCurrentAudioSource,
    }))
  );

  // Cloud upload
  const { uploadToCloud, isSignedIn } = useCloudAssetUploader();

  const stems = collection?.stemOrder.map((id) => collection.inputs[id]).filter(Boolean) ?? [];

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

      if (over && active.id !== over.id && collection) {
        const oldIndex = collection.stemOrder.indexOf(active.id as string);
        const newIndex = collection.stemOrder.indexOf(over.id as string);

        if (oldIndex !== -1 && newIndex !== -1) {
          const newOrder = [...collection.stemOrder];
          const [removed] = newOrder.splice(oldIndex, 1);
          if (removed) {
            newOrder.splice(newIndex, 0, removed);
            reorderStems(newOrder);
          }
        }
      }
    },
    [collection, reorderStems]
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

          const origin: AudioInputOrigin = {
            kind: "file",
            fileName: file.name,
          };

          const stemId = addStem({
            audioBuffer: {
              sampleRate: audioBuffer.sampleRate,
              numberOfChannels: audioBuffer.numberOfChannels,
              getChannelData: (channel: number) => audioBuffer.getChannelData(channel),
            },
            metadata: {
              sampleRate: audioBuffer.sampleRate,
              totalSamples: audioBuffer.length,
              duration: audioBuffer.duration,
            },
            audioUrl,
            origin,
            label,
          });

          // Store asset metadata for cloud upload
          setAssetMetadata(stemId, {
            contentHash,
            mimeType: file.type || "audio/mpeg",
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
                setCloudAssetId(stemId, cloudAssetId);
                clearRawBuffer(stemId);
              },
              onError: (error) => {
                console.error("[StemUpload] Upload failed:", error);
              },
            });
          }

          // Auto-run key MIR analyses on the new stem
          // Wait for analyses to complete before processing next file to avoid cancellation
          await runAnalysis("onsetEnvelope", stemId);
          await runAnalysis("spectralFlux", stemId);
        } catch (error) {
          console.error(`Failed to import stem "${file.name}":`, error);
        }
      }

      // Reset the file input
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    },
    [addStem, runAnalysis, isSignedIn, uploadToCloud, setAssetMetadata, setCloudAssetId, clearRawBuffer]
  );

  const handleDeleteStem = useCallback(
    (stemId: string) => {
      if (!collection) return;

      if (deleteConfirmId === stemId) {
        // Get the index before removing
        const index = collection.stemOrder.indexOf(stemId);
        const stem = removeStem(stemId);

        if (stem) {
          // Clear any pending undo
          if (deletedStem) {
            clearTimeout(deletedStem.timeoutId);
          }

          // Invalidate MIR cache for this stem
          useMirStore.getState().invalidateInputMir(stemId);

          // Clear candidate events for this stem
          useCandidateEventStore.getState().clearForSource(stemId);

          // Clear frequency bands for this stem
          useFrequencyBandStore.getState().clearBandsForSource(stemId);

          // Set up undo with timeout
          const timeoutId = setTimeout(() => {
            setDeletedStem(null);
          }, 5000); // 5 seconds to undo

          setDeletedStem({ stem, index, timeoutId });
        }

        setDeleteConfirmId(null);
      } else {
        setDeleteConfirmId(stemId);
        // Clear confirmation after 3 seconds
        setTimeout(() => setDeleteConfirmId(null), 3000);
      }
    },
    [collection, deleteConfirmId, deletedStem, removeStem]
  );

  const handleUndoDelete = useCallback(() => {
    if (deletedStem) {
      clearTimeout(deletedStem.timeoutId);
      restoreStem(deletedStem.stem, deletedStem.index);
      setDeletedStem(null);
    }
  }, [deletedStem, restoreStem]);

  const handleDismissUndo = useCallback(() => {
    if (deletedStem) {
      clearTimeout(deletedStem.timeoutId);
      setDeletedStem(null);
    }
  }, [deletedStem]);

  const handleGenerateMixdown = useCallback(async () => {
    const allStems = getStems();
    if (allStems.length === 0) return;

    setIsGeneratingMixdown(true);

    try {
      // Get audio buffers from all stems
      const stemBuffers = allStems
        .map((stem) => stem.audioBuffer)
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

      // Update the mixdown in the store
      const origin: AudioInputOrigin = {
        kind: "synthetic",
        generatedFrom: allStems.map((s) => s.id),
      };

      updateMixdown({
        audioBuffer: mixedBuffer,
        metadata: {
          sampleRate: mixedBuffer.sampleRate,
          totalSamples: samples,
          duration,
        },
        audioUrl,
        origin,
        label: "Generated Mixdown",
      });

      // =======================================================================
      // DESIGN: Create GeneratedAudioSource with ready status (we have the URL).
      // This is the single source of truth for playback - WaveSurfer will load
      // from this URL.
      // =======================================================================
      const generatedSource: GeneratedAudioSource = {
        type: "generated",
        id: MIXDOWN_ID,
        generatedFrom: allStems.map((s) => s.id),
        status: "ready",
        url: audioUrl,
      };
      setCurrentAudioSource(generatedSource);

      // Run MIR analysis on the new mixdown
      await runAnalysis("onsetEnvelope", MIXDOWN_ID);
      await runAnalysis("spectralFlux", MIXDOWN_ID);
    } catch (error) {
      console.error("Failed to generate mixdown:", error);
    } finally {
      setIsGeneratingMixdown(false);
    }
  }, [getStems, updateMixdown, setCurrentAudioSource, runAnalysis]);

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
            <SortableContext
              items={stems.map((s) => s!.id)}
              strategy={verticalListSortingStrategy}
            >
              {stems.map((stem, index) => {
                if (!stem) return null;
                return (
                  <StemListItem
                    key={stem.id}
                    stemId={stem.id}
                    label={stem.label}
                    colorIndex={index}
                    isSelected={stem.id === selectedInputId}
                    isDeleting={stem.id === deleteConfirmId}
                    onSelect={() => selectInput(stem.id)}
                    onRename={(newLabel) => renameInput(stem.id, newLabel)}
                    onDelete={() => handleDeleteStem(stem.id)}
                  />
                );
              })}
            </SortableContext>
          </DndContext>
        )}
      </div>

      {/* Undo Delete Toast */}
      {deletedStem && (
        <div className="p-2 border-t border-zinc-200 dark:border-zinc-800">
          <div className="flex items-center justify-between gap-2 px-2 py-1.5 rounded-md bg-zinc-100 dark:bg-zinc-800">
            <span className="text-xs text-zinc-600 dark:text-zinc-400">
              Deleted &quot;{deletedStem.stem.label}&quot;
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
