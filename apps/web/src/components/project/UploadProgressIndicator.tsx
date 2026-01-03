'use client';

import { useState } from 'react';
import { Upload, Check, AlertCircle, ChevronDown, ChevronUp, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { UploadState } from '@/lib/hooks/useAssetUpload';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

interface UploadProgressIndicatorProps {
  /** All current uploads */
  uploads: UploadState[];
  /** Callback to cancel an upload */
  onCancel?: (assetId: string) => void;
  /** Callback to dismiss a completed/failed upload */
  onDismiss?: (assetId: string) => void;
}

// -----------------------------------------------------------------------------
// Individual Upload Item
// -----------------------------------------------------------------------------

function UploadItem({
  upload,
  onCancel,
  onDismiss,
}: {
  upload: UploadState;
  onCancel?: (assetId: string) => void;
  onDismiss?: (assetId: string) => void;
}) {
  const isActive = upload.status === 'pending' || upload.status === 'uploading';
  const isComplete = upload.status === 'uploaded';
  const isFailed = upload.status === 'failed' || upload.status === 'cancelled';

  return (
    <div className="flex items-center gap-2 py-1.5 px-2 text-xs">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          {isComplete && <Check className="h-3 w-3 text-emerald-500 shrink-0" />}
          {isFailed && <AlertCircle className="h-3 w-3 text-red-500 shrink-0" />}
          {isActive && (
            <div className="h-3 w-3 border-2 border-blue-500 border-t-transparent rounded-full animate-spin shrink-0" />
          )}
          <span className="truncate">{upload.fileName ?? 'Uploading...'}</span>
        </div>
        {isActive && (
          <div className="mt-1 h-1 bg-zinc-200 dark:bg-zinc-700 rounded-full overflow-hidden">
            <div
              className="h-full bg-blue-500 transition-all duration-300"
              style={{ width: `${upload.progress}%` }}
            />
          </div>
        )}
        {isFailed && upload.error && (
          <div className="mt-0.5 text-red-500 dark:text-red-400 truncate">{upload.error}</div>
        )}
      </div>

      {/* Action buttons */}
      {isActive && onCancel && (
        <Button
          size="icon"
          variant="ghost"
          className="h-5 w-5"
          onClick={() => onCancel(upload.assetId)}
        >
          <X className="h-3 w-3" />
        </Button>
      )}
      {(isComplete || isFailed) && onDismiss && (
        <Button
          size="icon"
          variant="ghost"
          className="h-5 w-5"
          onClick={() => onDismiss(upload.assetId)}
        >
          <X className="h-3 w-3" />
        </Button>
      )}
    </div>
  );
}

// -----------------------------------------------------------------------------
// Main Component
// -----------------------------------------------------------------------------

export function UploadProgressIndicator({
  uploads,
  onCancel,
  onDismiss,
}: UploadProgressIndicatorProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  // Filter to show only relevant uploads
  const activeUploads = uploads.filter(
    (u) => u.status === 'pending' || u.status === 'uploading'
  );
  const completedUploads = uploads.filter((u) => u.status === 'uploaded');
  const failedUploads = uploads.filter(
    (u) => u.status === 'failed' || u.status === 'cancelled'
  );

  const totalActive = activeUploads.length;
  const totalFailed = failedUploads.length;
  const hasUploads = uploads.length > 0;

  // Don't render if no uploads
  if (!hasUploads) {
    return null;
  }

  // Calculate overall progress for active uploads
  const overallProgress =
    totalActive > 0
      ? Math.round(
          activeUploads.reduce((sum, u) => sum + u.progress, 0) / totalActive
        )
      : 100;

  return (
    <div className="fixed bottom-4 right-4 z-50 w-72 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg shadow-lg overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between px-3 py-2 bg-zinc-50 dark:bg-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors"
      >
        <div className="flex items-center gap-2">
          <Upload className="h-4 w-4 text-zinc-500" />
          <span className="text-sm font-medium">
            {totalActive > 0 ? (
              <>
                Uploading {totalActive} file{totalActive !== 1 ? 's' : ''}
              </>
            ) : totalFailed > 0 ? (
              <span className="text-red-600 dark:text-red-400">
                {totalFailed} upload{totalFailed !== 1 ? 's' : ''} failed
              </span>
            ) : (
              <span className="text-emerald-600 dark:text-emerald-400">
                Uploads complete
              </span>
            )}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {totalActive > 0 && (
            <span className="text-xs text-zinc-500">{overallProgress}%</span>
          )}
          {isExpanded ? (
            <ChevronDown className="h-4 w-4 text-zinc-400" />
          ) : (
            <ChevronUp className="h-4 w-4 text-zinc-400" />
          )}
        </div>
      </button>

      {/* Progress bar (always visible when uploading) */}
      {totalActive > 0 && (
        <div className="h-1 bg-zinc-200 dark:bg-zinc-700">
          <div
            className="h-full bg-blue-500 transition-all duration-300"
            style={{ width: `${overallProgress}%` }}
          />
        </div>
      )}

      {/* Expanded content */}
      {isExpanded && (
        <div className="max-h-48 overflow-y-auto divide-y divide-zinc-100 dark:divide-zinc-800">
          {/* Active uploads */}
          {activeUploads.map((upload) => (
            <UploadItem
              key={upload.assetId}
              upload={upload}
              onCancel={onCancel}
              onDismiss={onDismiss}
            />
          ))}

          {/* Failed uploads */}
          {failedUploads.map((upload) => (
            <UploadItem
              key={upload.assetId}
              upload={upload}
              onCancel={onCancel}
              onDismiss={onDismiss}
            />
          ))}

          {/* Completed uploads (limited to last 3) */}
          {completedUploads.slice(0, 3).map((upload) => (
            <UploadItem
              key={upload.assetId}
              upload={upload}
              onCancel={onCancel}
              onDismiss={onDismiss}
            />
          ))}
        </div>
      )}
    </div>
  );
}
