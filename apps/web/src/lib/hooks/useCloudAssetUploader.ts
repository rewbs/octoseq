'use client';

import { useCallback } from 'react';
import { useUser } from '@clerk/nextjs';
import { useAssetUpload, type UploadOptions } from './useAssetUpload';
import { computeContentHash } from '../persistence/assetHashing';
import { AssetType } from '@/lib/db';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export interface CloudUploadRequest {
  /** The file to upload */
  file: File;
  /** Asset type */
  type: AssetType;
  /** Additional metadata to store with the asset */
  metadata?: {
    fileName?: string;
    fileSize?: number;
    sampleRate?: number;
    channels?: number;
    duration?: number;
    vertexCount?: number;
    faceCount?: number;
  };
  /** Callback when upload completes with the cloud asset ID */
  onComplete?: (cloudAssetId: string) => void;
  /** Callback when upload fails */
  onError?: (error: string) => void;
  /** Callback for progress updates */
  onProgress?: (progress: number) => void;
}

export interface CloudUploadResult {
  /** The content hash of the file */
  contentHash: string;
  /** The MIME type of the file */
  mimeType: string;
  /** The cloud asset ID (available after upload completes) */
  cloudAssetId?: string;
}

// -----------------------------------------------------------------------------
// Hook
// -----------------------------------------------------------------------------

/**
 * Hook for uploading assets to cloud storage (R2).
 *
 * This hook handles:
 * - Content hashing for deduplication
 * - Background uploads with progress tracking
 * - Integration with the asset upload manager
 *
 * Usage:
 * ```tsx
 * const { uploadToCloud, isSignedIn, hasActiveUploads } = useCloudAssetUploader();
 *
 * // When a file is attached
 * const result = await uploadToCloud({
 *   file: selectedFile,
 *   type: 'AUDIO',
 *   metadata: { fileName: file.name, fileSize: file.size },
 *   onComplete: (cloudAssetId) => {
 *     audioInputStore.setCloudAssetId(inputId, cloudAssetId);
 *   },
 * });
 *
 * // Store the contentHash and mimeType immediately
 * audioInputStore.setAssetMetadata(inputId, {
 *   contentHash: result.contentHash,
 *   mimeType: result.mimeType,
 * });
 * ```
 */
export function useCloudAssetUploader() {
  const { isSignedIn } = useUser();
  const {
    startUpload,
    uploads,
    pendingUploads,
    failedUploads,
    hasActiveUploads,
    cancelUpload,
    retryUpload,
    removeUpload,
    getUploadByHash,
  } = useAssetUpload();

  /**
   * Upload a file to cloud storage.
   * Returns immediately with content hash and MIME type.
   * The actual upload happens in the background.
   */
  const uploadToCloud = useCallback(
    async (request: CloudUploadRequest): Promise<CloudUploadResult | null> => {
      if (!isSignedIn) {
        console.log('[CloudUpload] User not signed in, skipping cloud upload');
        return null;
      }

      const { file, type, metadata, onComplete, onError, onProgress } = request;

      try {
        // Read file as ArrayBuffer for hashing
        const arrayBuffer = await file.arrayBuffer();

        // Compute content hash
        const contentHash = await computeContentHash(arrayBuffer);

        // Check if already uploaded (deduplication)
        const existing = getUploadByHash(contentHash);
        if (existing?.status === 'uploaded' && existing.assetId) {
          console.log('[CloudUpload] Asset already uploaded:', existing.assetId);
          onComplete?.(existing.assetId);
          return {
            contentHash,
            mimeType: file.type,
            cloudAssetId: existing.assetId,
          };
        }

        // Start the upload
        const uploadOptions: UploadOptions = {
          contentHash,
          type,
          contentType: file.type,
          file: new Blob([arrayBuffer], { type: file.type }),
          metadata: {
            fileName: file.name,
            fileSize: file.size,
            ...metadata,
          },
          onProgress,
          onComplete: (assetId) => {
            console.log('[CloudUpload] Upload completed:', assetId);
            onComplete?.(assetId);
          },
          onError: (error) => {
            console.error('[CloudUpload] Upload failed:', error);
            onError?.(error);
          },
        };

        // Start upload (runs in background)
        startUpload(uploadOptions).catch((err) => {
          console.error('[CloudUpload] Failed to start upload:', err);
          onError?.(err instanceof Error ? err.message : String(err));
        });

        // Return immediately with hash and mime type
        return {
          contentHash,
          mimeType: file.type,
        };
      } catch (err) {
        console.error('[CloudUpload] Error preparing upload:', err);
        onError?.(err instanceof Error ? err.message : 'Failed to prepare upload');
        return null;
      }
    },
    [isSignedIn, startUpload, getUploadByHash]
  );

  /**
   * Upload raw bytes to cloud storage.
   * Use this when you already have the ArrayBuffer (e.g., from rawBuffer).
   */
  const uploadBytesToCloud = useCallback(
    async (
      bytes: ArrayBuffer,
      options: {
        type: AssetType;
        mimeType: string;
        fileName?: string;
        metadata?: CloudUploadRequest['metadata'];
        onComplete?: (cloudAssetId: string) => void;
        onError?: (error: string) => void;
        onProgress?: (progress: number) => void;
      }
    ): Promise<CloudUploadResult | null> => {
      if (!isSignedIn) {
        console.log('[CloudUpload] User not signed in, skipping cloud upload');
        return null;
      }

      const { type, mimeType, fileName, metadata, onComplete, onError, onProgress } = options;

      try {
        // Compute content hash
        const contentHash = await computeContentHash(bytes);

        // Check if already uploaded (deduplication)
        const existing = getUploadByHash(contentHash);
        if (existing?.status === 'uploaded' && existing.assetId) {
          console.log('[CloudUpload] Asset already uploaded:', existing.assetId);
          onComplete?.(existing.assetId);
          return {
            contentHash,
            mimeType,
            cloudAssetId: existing.assetId,
          };
        }

        // Start the upload
        const uploadOptions: UploadOptions = {
          contentHash,
          type,
          contentType: mimeType,
          file: new Blob([bytes], { type: mimeType }),
          metadata: {
            fileName,
            fileSize: bytes.byteLength,
            ...metadata,
          },
          onProgress,
          onComplete: (assetId) => {
            console.log('[CloudUpload] Upload completed:', assetId);
            onComplete?.(assetId);
          },
          onError: (error) => {
            console.error('[CloudUpload] Upload failed:', error);
            onError?.(error);
          },
        };

        // Start upload (runs in background)
        startUpload(uploadOptions).catch((err) => {
          console.error('[CloudUpload] Failed to start upload:', err);
          onError?.(err instanceof Error ? err.message : String(err));
        });

        // Return immediately with hash and mime type
        return {
          contentHash,
          mimeType,
        };
      } catch (err) {
        console.error('[CloudUpload] Error preparing upload:', err);
        onError?.(err instanceof Error ? err.message : 'Failed to prepare upload');
        return null;
      }
    },
    [isSignedIn, startUpload, getUploadByHash]
  );

  return {
    /** Upload a File to cloud storage */
    uploadToCloud,
    /** Upload raw bytes to cloud storage */
    uploadBytesToCloud,
    /** Whether the user is signed in (required for cloud uploads) */
    isSignedIn: !!isSignedIn,
    /** All current uploads */
    uploads,
    /** Uploads that are pending or in progress */
    pendingUploads,
    /** Uploads that failed */
    failedUploads,
    /** Whether any uploads are in progress */
    hasActiveUploads,
    /** Cancel an upload by asset ID */
    cancelUpload,
    /** Retry a failed upload */
    retryUpload,
    /** Remove an upload from tracking */
    removeUpload,
  };
}
