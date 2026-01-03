'use client';

import { useState } from 'react';
import { AlertTriangle, RefreshCw, X, ChevronDown, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { UploadState } from '@/lib/hooks/useAssetUpload';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

interface AssetFailurePanelProps {
  /** Failed uploads */
  failedUploads: UploadState[];
  /** Callback to retry an upload */
  onRetry?: (assetId: string) => void;
  /** Callback to dismiss a failed upload */
  onDismiss?: (assetId: string) => void;
  /** Callback to dismiss all failures */
  onDismissAll?: () => void;
}

// -----------------------------------------------------------------------------
// Failed Upload Item
// -----------------------------------------------------------------------------

function FailedUploadItem({
  upload,
  onRetry,
  onDismiss,
}: {
  upload: UploadState;
  onRetry?: (assetId: string) => void;
  onDismiss?: (assetId: string) => void;
}) {
  const [isRetrying, setIsRetrying] = useState(false);

  const handleRetry = async () => {
    setIsRetrying(true);
    onRetry?.(upload.assetId);
    // The retry callback is async but we don't await it here
    // The upload state will update through the hook
    setTimeout(() => setIsRetrying(false), 500);
  };

  return (
    <div className="flex items-start gap-3 p-3 bg-red-50 dark:bg-red-900/20 rounded-lg">
      <AlertTriangle className="h-4 w-4 text-red-500 mt-0.5 shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-red-700 dark:text-red-300 truncate">
          {upload.fileName ?? 'Unknown file'}
        </div>
        <div className="text-xs text-red-600 dark:text-red-400 mt-0.5">
          {upload.error ?? 'Upload failed'}
        </div>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        {onRetry && (
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7 text-red-600 hover:text-red-700 hover:bg-red-100 dark:text-red-400 dark:hover:bg-red-900/40"
            onClick={() => void handleRetry()}
            disabled={isRetrying}
          >
            <RefreshCw className={`h-4 w-4 ${isRetrying ? 'animate-spin' : ''}`} />
          </Button>
        )}
        {onDismiss && (
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7 text-red-600 hover:text-red-700 hover:bg-red-100 dark:text-red-400 dark:hover:bg-red-900/40"
            onClick={() => onDismiss(upload.assetId)}
          >
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Main Component
// -----------------------------------------------------------------------------

export function AssetFailurePanel({
  failedUploads,
  onRetry,
  onDismiss,
  onDismissAll,
}: AssetFailurePanelProps) {
  const [isExpanded, setIsExpanded] = useState(true);

  if (failedUploads.length === 0) {
    return null;
  }

  return (
    <div className="border border-red-200 dark:border-red-800 rounded-lg overflow-hidden bg-white dark:bg-zinc-900">
      {/* Header */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between px-3 py-2 bg-red-100 dark:bg-red-900/30 hover:bg-red-150 dark:hover:bg-red-900/40 transition-colors"
      >
        <div className="flex items-center gap-2">
          {isExpanded ? (
            <ChevronDown className="h-4 w-4 text-red-500" />
          ) : (
            <ChevronRight className="h-4 w-4 text-red-500" />
          )}
          <AlertTriangle className="h-4 w-4 text-red-500" />
          <span className="text-sm font-medium text-red-700 dark:text-red-300">
            {failedUploads.length} failed upload{failedUploads.length !== 1 ? 's' : ''}
          </span>
        </div>
        {onDismissAll && (
          <Button
            size="sm"
            variant="ghost"
            className="text-xs text-red-600 hover:text-red-700 hover:bg-red-200 dark:text-red-400 dark:hover:bg-red-900/40"
            onClick={(e) => {
              e.stopPropagation();
              onDismissAll();
            }}
          >
            Dismiss all
          </Button>
        )}
      </button>

      {/* Content */}
      {isExpanded && (
        <div className="p-2 space-y-2">
          {failedUploads.map((upload) => (
            <FailedUploadItem
              key={upload.assetId}
              upload={upload}
              onRetry={onRetry}
              onDismiss={onDismiss}
            />
          ))}
        </div>
      )}
    </div>
  );
}
