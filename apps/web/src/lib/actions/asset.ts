'use server';

import { z } from 'zod';
import { prisma, AssetType, AssetStatus } from '@/lib/db';
import { authAction } from '@/lib/safe-action';
import { generateR2Key, generateUploadUrl, generateDownloadUrl } from '@/lib/r2';

// -----------------------------------------------------------------------------
// Schemas
// -----------------------------------------------------------------------------

const registerAssetSchema = z.object({
  contentHash: z.string().min(1),
  type: z.nativeEnum(AssetType),
  contentType: z.string().min(1), // MIME type for upload URL
  metadata: z
    .object({
      fileName: z.string().optional(),
      fileSize: z.number().optional(),
      // Audio-specific metadata
      sampleRate: z.number().optional(),
      channels: z.number().optional(),
      duration: z.number().optional(),
      // Mesh-specific metadata
      vertexCount: z.number().optional(),
      faceCount: z.number().optional(),
    })
    .optional(),
});

// -----------------------------------------------------------------------------
// registerAsset
// Creates an Asset record with PENDING status and returns a pre-signed upload URL
// This is the authoritative entry point for asset uploads
// -----------------------------------------------------------------------------

export const registerAsset = authAction
  .schema(registerAssetSchema)
  .action(async ({ parsedInput, ctx }) => {
    const { contentHash, type, contentType, metadata } = parsedInput;
    const { user } = ctx;

    // Check if asset already exists for this user with this content hash
    const existingAsset = await prisma.asset.findUnique({
      where: {
        ownerId_contentHash: {
          ownerId: user.id,
          contentHash,
        },
      },
    });

    if (existingAsset) {
      // Asset already exists - return it without creating a new one
      // If it's already uploaded, no need for a new upload URL
      if (existingAsset.status === AssetStatus.UPLOADED) {
        return {
          asset: {
            id: existingAsset.id,
            status: existingAsset.status,
            r2Key: existingAsset.r2Key,
          },
          uploadUrl: null, // No upload needed
          isExisting: true,
        };
      }

      // Asset exists but is pending/failed - generate a new upload URL
      const uploadUrl = await generateUploadUrl(existingAsset.r2Key, contentType);

      return {
        asset: {
          id: existingAsset.id,
          status: existingAsset.status,
          r2Key: existingAsset.r2Key,
        },
        uploadUrl,
        isExisting: true,
      };
    }

    // Create new asset with PENDING status
    const asset = await prisma.asset.create({
      data: {
        ownerId: user.id,
        contentHash,
        r2Key: '', // Temporary - will be set below
        type,
        metadataJson: metadata ?? undefined,
        status: AssetStatus.PENDING,
      },
    });

    // Generate deterministic R2 key from user ID and asset ID
    const r2Key = generateR2Key(user.id, asset.id);

    // Update asset with the R2 key
    await prisma.asset.update({
      where: { id: asset.id },
      data: { r2Key },
    });

    // Generate pre-signed upload URL
    const uploadUrl = await generateUploadUrl(r2Key, contentType);

    return {
      asset: {
        id: asset.id,
        status: asset.status,
        r2Key,
      },
      uploadUrl,
      isExisting: false,
    };
  });

// -----------------------------------------------------------------------------
// confirmAssetUpload
// Marks an asset as successfully uploaded after client confirms R2 upload
// -----------------------------------------------------------------------------

const assetIdSchema = z.object({
  assetId: z.string().min(1),
});

export const confirmAssetUpload = authAction
  .schema(assetIdSchema)
  .action(async ({ parsedInput, ctx }) => {
    const { assetId } = parsedInput;
    const { user } = ctx;

    // Get the asset and verify ownership
    const asset = await prisma.asset.findUnique({
      where: { id: assetId },
    });

    if (!asset) {
      throw new Error('Asset not found');
    }

    if (asset.ownerId !== user.id) {
      throw new Error('You do not have permission to modify this asset');
    }

    // Only allow confirming pending or failed assets
    if (asset.status === AssetStatus.UPLOADED) {
      return { asset: { id: asset.id, status: asset.status } };
    }

    // Mark as uploaded
    const updated = await prisma.asset.update({
      where: { id: assetId },
      data: { status: AssetStatus.UPLOADED },
    });

    return {
      asset: {
        id: updated.id,
        status: updated.status,
      },
    };
  });

// -----------------------------------------------------------------------------
// markAssetFailed
// Marks an asset as failed after upload error
// -----------------------------------------------------------------------------

const markAssetFailedSchema = z.object({
  assetId: z.string().min(1),
  error: z.string().optional(),
});

export const markAssetFailed = authAction
  .schema(markAssetFailedSchema)
  .action(async ({ parsedInput, ctx }) => {
    const { assetId, error } = parsedInput;
    const { user } = ctx;

    // Get the asset and verify ownership
    const asset = await prisma.asset.findUnique({
      where: { id: assetId },
    });

    if (!asset) {
      throw new Error('Asset not found');
    }

    if (asset.ownerId !== user.id) {
      throw new Error('You do not have permission to modify this asset');
    }

    // Mark as failed, optionally store error in metadata
    const existingMetadata = (asset.metadataJson as Record<string, unknown>) ?? {};
    const updatedMetadata = error
      ? { ...existingMetadata, uploadError: error, failedAt: new Date().toISOString() }
      : existingMetadata;

    const updated = await prisma.asset.update({
      where: { id: assetId },
      data: {
        status: AssetStatus.FAILED,
        metadataJson: updatedMetadata as Parameters<
          typeof prisma.asset.update
        >[0]['data']['metadataJson'],
      },
    });

    return {
      asset: {
        id: updated.id,
        status: updated.status,
      },
    };
  });

// -----------------------------------------------------------------------------
// getAssetUploadUrl
// Gets a fresh pre-signed upload URL for retrying a failed upload
// -----------------------------------------------------------------------------

const getUploadUrlSchema = z.object({
  assetId: z.string().min(1),
  contentType: z.string().min(1),
});

export const getAssetUploadUrl = authAction
  .schema(getUploadUrlSchema)
  .action(async ({ parsedInput, ctx }) => {
    const { assetId, contentType } = parsedInput;
    const { user } = ctx;

    // Get the asset and verify ownership
    const asset = await prisma.asset.findUnique({
      where: { id: assetId },
    });

    if (!asset) {
      throw new Error('Asset not found');
    }

    if (asset.ownerId !== user.id) {
      throw new Error('You do not have permission to access this asset');
    }

    // Generate fresh upload URL
    const uploadUrl = await generateUploadUrl(asset.r2Key, contentType);

    return { uploadUrl };
  });

// -----------------------------------------------------------------------------
// getAssetDownloadUrl
// Gets a pre-signed download URL for an asset
// -----------------------------------------------------------------------------

const getDownloadUrlSchema = z.object({
  assetId: z.string().min(1),
});

export const getAssetDownloadUrl = authAction
  .schema(getDownloadUrlSchema)
  .action(async ({ parsedInput, ctx }) => {
    const { assetId } = parsedInput;
    const { user } = ctx;

    // Get the asset
    const asset = await prisma.asset.findUnique({
      where: { id: assetId },
    });

    if (!asset) {
      throw new Error('Asset not found');
    }

    // Check access: owner or asset is part of a public project
    // For now, allow owners and public access (we'll refine this later)
    const isOwner = asset.ownerId === user.id;

    if (!isOwner) {
      // Check if asset is part of a public project the user can access
      // For simplicity, we'll allow access to any uploaded asset for now
      // TODO: Add proper access control based on project visibility
      if (asset.status !== AssetStatus.UPLOADED) {
        throw new Error('You do not have permission to access this asset');
      }
    }

    // Only allow downloading uploaded assets
    if (asset.status !== AssetStatus.UPLOADED) {
      throw new Error('Asset is not available for download');
    }

    // Generate pre-signed download URL
    const downloadUrl = await generateDownloadUrl(asset.r2Key);

    return {
      downloadUrl,
      type: asset.type,
      metadata: asset.metadataJson as Record<string, unknown> | null,
    };
  });

// -----------------------------------------------------------------------------
// getAssetDownloadUrls
// Gets pre-signed download URLs for multiple assets
// -----------------------------------------------------------------------------

const getDownloadUrlsSchema = z.object({
  assetIds: z.array(z.string().min(1)),
});

export const getAssetDownloadUrls = authAction
  .schema(getDownloadUrlsSchema)
  .action(async ({ parsedInput, ctx }) => {
    const { assetIds } = parsedInput;
    const { user } = ctx;

    if (assetIds.length === 0) {
      return { assets: [] };
    }

    // Get all assets
    const assets = await prisma.asset.findMany({
      where: {
        id: { in: assetIds },
        status: AssetStatus.UPLOADED,
      },
    });

    // Generate download URLs for each asset
    const results = await Promise.all(
      assets.map(async (asset) => {
        const downloadUrl = await generateDownloadUrl(asset.r2Key);
        return {
          id: asset.id,
          downloadUrl,
          type: asset.type,
          metadata: asset.metadataJson as Record<string, unknown> | null,
        };
      })
    );

    return { assets: results };
  });
