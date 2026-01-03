/**
 * Asset Reference Types
 *
 * These types define how assets are referenced in project working state.
 * Assets are always referenced by ID, never by inline content or URLs.
 */

import type { AssetStatus, AssetType } from '@/lib/db';

// -----------------------------------------------------------------------------
// Asset Reference (stored in project working JSON)
// -----------------------------------------------------------------------------

/**
 * Reference to an asset stored in R2.
 * This is what gets stored in the project working JSON.
 */
export interface AssetReference {
  /** The asset ID (primary key in Asset table) */
  assetId: string;
}

/**
 * Extended asset reference with metadata for audio.
 * Stored in project.audio.mixdown and project.audio.stems[]
 */
export interface AudioAssetReference extends AssetReference {
  /** Original input ID for linking */
  id: string;
  /** User-facing label */
  label: string;
  /** Role in the collection */
  role: 'mixdown' | 'stem';
  /** Audio metadata */
  metadata: {
    sampleRate: number;
    totalSamples: number;
    duration: number;
  };
  /** Order index for stems */
  orderIndex?: number;
}

/**
 * Extended asset reference with metadata for meshes.
 * Stored in project.meshAssets.assets[]
 */
export interface MeshAssetReference extends AssetReference {
  /** Unique identifier */
  id: string;
  /** Display name */
  name: string;
  /** Original file name */
  fileName: string;
  /** Number of vertices */
  vertexCount: number;
  /** Number of faces */
  faceCount: number;
  /** Creation timestamp */
  createdAt: string;
}

// -----------------------------------------------------------------------------
// Asset Resolution Status (for UI display)
// -----------------------------------------------------------------------------

export type AssetResolutionStatus =
  | 'resolved' // Asset exists and is uploaded
  | 'pending' // Asset exists but upload in progress
  | 'failed' // Asset exists but upload failed
  | 'missing'; // Asset reference exists but asset not found

/**
 * Status of an asset reference with details.
 */
export interface AssetResolutionInfo {
  assetId: string;
  status: AssetResolutionStatus;
  type?: AssetType;
  /** Error message if failed */
  error?: string;
  /** R2 key for resolved assets */
  r2Key?: string;
}

/**
 * Summary of all asset statuses in a project.
 */
export interface ProjectAssetSummary {
  /** All asset references found in the project */
  assets: AssetResolutionInfo[];
  /** Count by status */
  counts: {
    resolved: number;
    pending: number;
    failed: number;
    missing: number;
    total: number;
  };
  /** Whether all assets are resolved (ready for snapshot) */
  allResolved: boolean;
  /** Whether any assets have issues that need attention */
  hasIssues: boolean;
}

// -----------------------------------------------------------------------------
// Utility Functions
// -----------------------------------------------------------------------------

/**
 * Maps database AssetStatus to resolution status.
 */
export function toResolutionStatus(dbStatus: AssetStatus): AssetResolutionStatus {
  switch (dbStatus) {
    case 'UPLOADED':
      return 'resolved';
    case 'PENDING':
      return 'pending';
    case 'FAILED':
      return 'failed';
    default:
      return 'pending';
  }
}

/**
 * Creates an empty project asset summary.
 */
export function emptyProjectAssetSummary(): ProjectAssetSummary {
  return {
    assets: [],
    counts: {
      resolved: 0,
      pending: 0,
      failed: 0,
      missing: 0,
      total: 0,
    },
    allResolved: true,
    hasIssues: false,
  };
}

/**
 * Computes summary from asset resolution info array.
 */
export function computeAssetSummary(assets: AssetResolutionInfo[]): ProjectAssetSummary {
  const counts = {
    resolved: 0,
    pending: 0,
    failed: 0,
    missing: 0,
    total: assets.length,
  };

  for (const asset of assets) {
    counts[asset.status]++;
  }

  return {
    assets,
    counts,
    allResolved: counts.resolved === counts.total,
    hasIssues: counts.failed > 0 || counts.missing > 0,
  };
}
