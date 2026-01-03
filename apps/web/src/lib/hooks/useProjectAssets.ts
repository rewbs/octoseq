'use client';

import { useCallback, useEffect, useState } from 'react';
import { getProjectAssetStatuses } from '@/lib/actions/project';
import type {
  AssetResolutionInfo,
  AssetResolutionStatus,
  ProjectAssetSummary,
} from '@/lib/assets/types';
import { emptyProjectAssetSummary } from '@/lib/assets/types';

// -----------------------------------------------------------------------------
// useProjectAssets Hook
// Fetches and tracks asset resolution status for a project
// -----------------------------------------------------------------------------

interface UseProjectAssetsOptions {
  /** Project ID to fetch asset statuses for */
  projectId: string | null;
  /** Polling interval in ms (0 to disable). Default: 0 (no polling) */
  pollInterval?: number;
  /** Whether to automatically fetch on mount. Default: true */
  autoFetch?: boolean;
}

interface UseProjectAssetsReturn {
  /** Current asset summary */
  summary: ProjectAssetSummary;
  /** Whether a fetch is in progress */
  isLoading: boolean;
  /** Error from last fetch attempt */
  error: Error | null;
  /** Manually trigger a refresh */
  refresh: () => Promise<void>;
  /** Get status for a specific asset */
  getAssetStatus: (assetId: string) => AssetResolutionStatus | undefined;
  /** Check if a specific asset is resolved */
  isAssetResolved: (assetId: string) => boolean;
}

export function useProjectAssets({
  projectId,
  pollInterval = 0,
  autoFetch = true,
}: UseProjectAssetsOptions): UseProjectAssetsReturn {
  const [summary, setSummary] = useState<ProjectAssetSummary>(emptyProjectAssetSummary());
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  // Build a lookup map for quick access
  const assetMap = new Map<string, AssetResolutionInfo>(
    summary.assets.map((a) => [a.assetId, a])
  );

  const refresh = useCallback(async () => {
    if (!projectId) {
      setSummary(emptyProjectAssetSummary());
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const result = await getProjectAssetStatuses({ projectId });

      if (result?.data) {
        setSummary({
          assets: result.data.assets as AssetResolutionInfo[],
          counts: result.data.counts,
          allResolved: result.data.allResolved,
          hasIssues: result.data.hasIssues,
        });
      } else if (result?.serverError) {
        setError(new Error(result.serverError));
      } else if (result?.validationErrors) {
        setError(new Error('Validation error'));
      }
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to fetch asset statuses'));
    } finally {
      setIsLoading(false);
    }
  }, [projectId]);

  // Auto-fetch on mount and projectId change
  useEffect(() => {
    if (autoFetch && projectId) {
      refresh();
    }
  }, [autoFetch, projectId, refresh]);

  // Polling
  useEffect(() => {
    if (!pollInterval || pollInterval <= 0 || !projectId) {
      return;
    }

    const intervalId = setInterval(() => {
      refresh();
    }, pollInterval);

    return () => clearInterval(intervalId);
  }, [pollInterval, projectId, refresh]);

  const getAssetStatus = useCallback(
    (assetId: string): AssetResolutionStatus | undefined => {
      return assetMap.get(assetId)?.status;
    },
    [assetMap]
  );

  const isAssetResolved = useCallback(
    (assetId: string): boolean => {
      return assetMap.get(assetId)?.status === 'resolved';
    },
    [assetMap]
  );

  return {
    summary,
    isLoading,
    error,
    refresh,
    getAssetStatus,
    isAssetResolved,
  };
}

// -----------------------------------------------------------------------------
// Helper hooks for common use cases
// -----------------------------------------------------------------------------

/**
 * Hook to check if all project assets are resolved (ready for snapshot).
 */
export function useCanCreateSnapshot(projectId: string | null): {
  canCreate: boolean;
  isLoading: boolean;
  pendingCount: number;
  failedCount: number;
  missingCount: number;
} {
  const { summary, isLoading } = useProjectAssets({ projectId });

  return {
    canCreate: summary.allResolved && summary.counts.total > 0,
    isLoading,
    pendingCount: summary.counts.pending,
    failedCount: summary.counts.failed,
    missingCount: summary.counts.missing,
  };
}

/**
 * Hook to get assets that need attention (failed or missing).
 */
export function useAssetsNeedingAttention(projectId: string | null): {
  assets: AssetResolutionInfo[];
  isLoading: boolean;
  hasIssues: boolean;
} {
  const { summary, isLoading } = useProjectAssets({ projectId });

  const problemAssets = summary.assets.filter(
    (a) => a.status === 'failed' || a.status === 'missing'
  );

  return {
    assets: problemAssets,
    isLoading,
    hasIssues: summary.hasIssues,
  };
}
