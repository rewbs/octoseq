'use client';

import { useCallback, useRef, useSyncExternalStore } from 'react';
import { AssetType } from '@/lib/db';
import {
  registerAsset,
  confirmAssetUpload,
  markAssetFailed,
  getAssetUploadUrl,
} from '@/lib/actions/asset';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export type UploadStatus = 'pending' | 'uploading' | 'uploaded' | 'failed' | 'cancelled';

export interface UploadState {
  assetId: string;
  status: UploadStatus;
  progress: number; // 0-100
  error?: string;
  contentHash: string;
  fileName?: string;
}

export interface UploadOptions {
  contentHash: string;
  type: AssetType;
  contentType: string;
  file: Blob;
  metadata?: {
    fileName?: string;
    fileSize?: number;
    sampleRate?: number;
    channels?: number;
    duration?: number;
    vertexCount?: number;
    faceCount?: number;
  };
  onProgress?: (progress: number) => void;
  onComplete?: (assetId: string) => void;
  onError?: (error: string) => void;
}

// -----------------------------------------------------------------------------
// Upload Manager (singleton for state management)
// -----------------------------------------------------------------------------

type Listener = () => void;

class UploadManager {
  private uploads = new Map<string, UploadState>();
  private abortControllers = new Map<string, AbortController>();
  private listeners = new Set<Listener>();

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getSnapshot(): Map<string, UploadState> {
    return this.uploads;
  }

  private notify(): void {
    // Create a new Map to trigger React re-render
    this.uploads = new Map(this.uploads);
    this.listeners.forEach((listener) => listener());
  }

  private updateUpload(assetId: string, update: Partial<UploadState>): void {
    const current = this.uploads.get(assetId);
    if (current) {
      this.uploads.set(assetId, { ...current, ...update });
      this.notify();
    }
  }

  async startUpload(options: UploadOptions): Promise<string> {
    const { contentHash, type, contentType, file, metadata, onProgress, onComplete, onError } =
      options;

    // Register the asset and get upload URL
    const result = await registerAsset({
      contentHash,
      type,
      contentType,
      metadata,
    });

    if (!result?.data) {
      const error = result?.serverError ?? 'Failed to register asset';
      onError?.(error);
      throw new Error(error);
    }

    const { asset, uploadUrl, isExisting } = result.data;

    // If asset already exists and is uploaded, we're done
    if (isExisting && !uploadUrl) {
      onComplete?.(asset.id);
      return asset.id;
    }

    // Initialize upload state
    this.uploads.set(asset.id, {
      assetId: asset.id,
      status: 'pending',
      progress: 0,
      contentHash,
      fileName: metadata?.fileName,
    });
    this.notify();

    // Start the upload
    this.performUpload(asset.id, uploadUrl!, file, contentType, onProgress, onComplete, onError);

    return asset.id;
  }

  private async performUpload(
    assetId: string,
    uploadUrl: string,
    file: Blob,
    contentType: string,
    onProgress?: (progress: number) => void,
    onComplete?: (assetId: string) => void,
    onError?: (error: string) => void
  ): Promise<void> {
    const abortController = new AbortController();
    this.abortControllers.set(assetId, abortController);

    this.updateUpload(assetId, { status: 'uploading', progress: 0 });

    try {
      // Use XMLHttpRequest for progress tracking
      await this.uploadWithProgress(
        uploadUrl,
        file,
        contentType,
        abortController.signal,
        (progress) => {
          this.updateUpload(assetId, { progress });
          onProgress?.(progress);
        }
      );

      // Confirm upload with server
      const confirmResult = await confirmAssetUpload({ assetId });

      if (!confirmResult?.data) {
        throw new Error(confirmResult?.serverError ?? 'Failed to confirm upload');
      }

      this.updateUpload(assetId, { status: 'uploaded', progress: 100 });
      this.abortControllers.delete(assetId);
      onComplete?.(assetId);
    } catch (error) {
      if (abortController.signal.aborted) {
        this.updateUpload(assetId, { status: 'cancelled' });
        return;
      }

      const errorMessage = error instanceof Error ? error.message : 'Upload failed';
      this.updateUpload(assetId, { status: 'failed', error: errorMessage });
      this.abortControllers.delete(assetId);

      // Mark as failed on server
      await markAssetFailed({ assetId, error: errorMessage }).catch(() => {
        // Ignore server error when marking as failed
      });

      onError?.(errorMessage);
    }
  }

  private uploadWithProgress(
    url: string,
    file: Blob,
    contentType: string,
    signal: AbortSignal,
    onProgress: (progress: number) => void
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();

      xhr.upload.addEventListener('progress', (event) => {
        if (event.lengthComputable) {
          const progress = Math.round((event.loaded / event.total) * 100);
          onProgress(progress);
        }
      });

      xhr.addEventListener('load', () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve();
        } else {
          reject(new Error(`Upload failed with status ${xhr.status}`));
        }
      });

      xhr.addEventListener('error', () => {
        reject(new Error('Network error during upload'));
      });

      xhr.addEventListener('abort', () => {
        reject(new Error('Upload cancelled'));
      });

      signal.addEventListener('abort', () => {
        xhr.abort();
      });

      xhr.open('PUT', url);
      xhr.setRequestHeader('Content-Type', contentType);
      xhr.send(file);
    });
  }

  cancelUpload(assetId: string): void {
    const controller = this.abortControllers.get(assetId);
    if (controller) {
      controller.abort();
      this.abortControllers.delete(assetId);
    }
  }

  async retryUpload(
    assetId: string,
    file: Blob,
    contentType: string,
    onProgress?: (progress: number) => void,
    onComplete?: (assetId: string) => void,
    onError?: (error: string) => void
  ): Promise<void> {
    const current = this.uploads.get(assetId);
    if (!current || (current.status !== 'failed' && current.status !== 'cancelled')) {
      return;
    }

    // Get a fresh upload URL
    const result = await getAssetUploadUrl({ assetId, contentType });

    if (!result?.data) {
      const error = result?.serverError ?? 'Failed to get upload URL';
      onError?.(error);
      return;
    }

    // Retry the upload
    this.performUpload(
      assetId,
      result.data.uploadUrl,
      file,
      contentType,
      onProgress,
      onComplete,
      onError
    );
  }

  removeUpload(assetId: string): void {
    this.cancelUpload(assetId);
    this.uploads.delete(assetId);
    this.notify();
  }

  getUpload(assetId: string): UploadState | undefined {
    return this.uploads.get(assetId);
  }

  getUploadByHash(contentHash: string): UploadState | undefined {
    for (const upload of this.uploads.values()) {
      if (upload.contentHash === contentHash) {
        return upload;
      }
    }
    return undefined;
  }
}

// Singleton instance
const uploadManager = new UploadManager();

// -----------------------------------------------------------------------------
// Hook
// -----------------------------------------------------------------------------

export function useAssetUpload() {
  const uploadsRef = useRef<Map<string, UploadState>>(new Map());

  // Subscribe to upload manager updates
  const uploads = useSyncExternalStore(
    useCallback((callback) => uploadManager.subscribe(callback), []),
    () => uploadManager.getSnapshot(),
    () => uploadManager.getSnapshot()
  );

  // Keep ref in sync for stable callbacks
  uploadsRef.current = uploads;

  const startUpload = useCallback(async (options: UploadOptions): Promise<string> => {
    return uploadManager.startUpload(options);
  }, []);

  const cancelUpload = useCallback((assetId: string): void => {
    uploadManager.cancelUpload(assetId);
  }, []);

  const retryUpload = useCallback(
    async (
      assetId: string,
      file: Blob,
      contentType: string,
      callbacks?: {
        onProgress?: (progress: number) => void;
        onComplete?: (assetId: string) => void;
        onError?: (error: string) => void;
      }
    ): Promise<void> => {
      await uploadManager.retryUpload(
        assetId,
        file,
        contentType,
        callbacks?.onProgress,
        callbacks?.onComplete,
        callbacks?.onError
      );
    },
    []
  );

  const removeUpload = useCallback((assetId: string): void => {
    uploadManager.removeUpload(assetId);
  }, []);

  const getUpload = useCallback((assetId: string): UploadState | undefined => {
    return uploadsRef.current.get(assetId);
  }, []);

  const getUploadByHash = useCallback((contentHash: string): UploadState | undefined => {
    for (const upload of uploadsRef.current.values()) {
      if (upload.contentHash === contentHash) {
        return upload;
      }
    }
    return undefined;
  }, []);

  // Derived state
  const pendingUploads = Array.from(uploads.values()).filter(
    (u) => u.status === 'pending' || u.status === 'uploading'
  );
  const failedUploads = Array.from(uploads.values()).filter((u) => u.status === 'failed');
  const hasActiveUploads = pendingUploads.length > 0;

  return {
    uploads: Array.from(uploads.values()),
    pendingUploads,
    failedUploads,
    hasActiveUploads,
    startUpload,
    cancelUpload,
    retryUpload,
    removeUpload,
    getUpload,
    getUploadByHash,
  };
}
