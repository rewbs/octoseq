"use server";

import { z } from "zod";
import { prisma, AssetType, AssetStatus } from "@/lib/db";
import { authActionModerate, publicActionLenient } from "@/lib/safe-action";
import { getDbUser } from "@/lib/auth/syncUser";
import { canReadAsset } from "@/lib/auth/assetAccess";
import {
  deleteObject,
  generateR2Key,
  generateUploadUrl,
  generateDownloadUrl,
  inspectObject,
} from "@/lib/r2";

const MAX_ASSET_BYTES = 512 * 1024 * 1024;
const contentTypeSchema = z
  .string()
  .max(255)
  .regex(/^[\w.+-]+\/[\w.+-]+$/, "Invalid MIME type");

const assetAccessInclude = {
  projects: { select: { project: { select: { ownerId: true, isPublic: true } } } },
  snapshots: {
    select: {
      snapshot: { select: { project: { select: { ownerId: true, isPublic: true } } } },
    },
  },
} as const;

// -----------------------------------------------------------------------------
// Schemas
// -----------------------------------------------------------------------------

const registerAssetSchema = z.object({
  contentHash: z.string().regex(/^[a-f0-9]{64}$/i, "Expected a SHA-256 content hash"),
  type: z.nativeEnum(AssetType),
  contentType: contentTypeSchema,
  metadata: z
    .object({
      fileName: z.string().optional(),
      fileSize: z.number().int().positive().max(MAX_ASSET_BYTES).optional(),
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

export const registerAsset = authActionModerate
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
      const r2Key = existingAsset.r2Key || generateR2Key(user.id, existingAsset.id);
      if (!existingAsset.r2Key) {
        await prisma.asset.update({ where: { id: existingAsset.id }, data: { r2Key } });
      }

      // Asset already exists - return it without creating a new one
      // If it's already uploaded, no need for a new upload URL
      if (existingAsset.status === AssetStatus.UPLOADED) {
        return {
          asset: {
            id: existingAsset.id,
            status: existingAsset.status,
            r2Key,
          },
          uploadUrl: null, // No upload needed
          isExisting: true,
        };
      }

      // Asset exists but is pending/failed - generate a new upload URL
      const uploadUrl = await generateUploadUrl(r2Key, contentType);

      return {
        asset: {
          id: existingAsset.id,
          status: existingAsset.status,
          r2Key,
        },
        uploadUrl,
        isExisting: true,
      };
    }

    // Generate both identifiers before insertion so a partially-created row can
    // never retain an empty storage key.
    const assetId = crypto.randomUUID();
    const r2Key = generateR2Key(user.id, assetId);
    const asset = await prisma.asset.create({
      data: {
        id: assetId,
        ownerId: user.id,
        contentHash,
        r2Key,
        type,
        metadataJson: { ...metadata, contentType },
        status: AssetStatus.PENDING,
      },
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

export const confirmAssetUpload = authActionModerate
  .schema(assetIdSchema)
  .action(async ({ parsedInput, ctx }) => {
    const { assetId } = parsedInput;
    const { user } = ctx;

    // Get the asset and verify ownership
    const asset = await prisma.asset.findUnique({
      where: { id: assetId },
    });

    if (!asset) {
      throw new Error("Asset not found");
    }

    if (asset.ownerId !== user.id) {
      throw new Error("You do not have permission to modify this asset");
    }

    // Only allow confirming pending or failed assets
    if (asset.status === AssetStatus.UPLOADED) {
      return { asset: { id: asset.id, status: asset.status } };
    }

    const object = await inspectObject(asset.r2Key);
    const metadata = (asset.metadataJson as Record<string, unknown> | null) ?? {};
    const expectedSize = metadata.fileSize;
    const expectedType = metadata.contentType;

    if (object.contentLength <= 0 || object.contentLength > MAX_ASSET_BYTES) {
      await deleteObject(asset.r2Key);
      throw new Error("Uploaded asset is empty or exceeds the maximum size");
    }
    if (typeof expectedSize === "number" && object.contentLength !== expectedSize) {
      await deleteObject(asset.r2Key);
      throw new Error("Uploaded asset size does not match the registered file");
    }
    if (
      typeof expectedType === "string" &&
      object.contentType &&
      object.contentType.toLowerCase() !== expectedType.toLowerCase()
    ) {
      await deleteObject(asset.r2Key);
      throw new Error("Uploaded asset type does not match the registered file");
    }

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

export const markAssetFailed = authActionModerate
  .schema(markAssetFailedSchema)
  .action(async ({ parsedInput, ctx }) => {
    const { assetId, error } = parsedInput;
    const { user } = ctx;

    // Get the asset and verify ownership
    const asset = await prisma.asset.findUnique({
      where: { id: assetId },
    });

    if (!asset) {
      throw new Error("Asset not found");
    }

    if (asset.ownerId !== user.id) {
      throw new Error("You do not have permission to modify this asset");
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
        >[0]["data"]["metadataJson"],
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
  contentType: contentTypeSchema,
});

export const getAssetUploadUrl = authActionModerate
  .schema(getUploadUrlSchema)
  .action(async ({ parsedInput, ctx }) => {
    const { assetId, contentType } = parsedInput;
    const { user } = ctx;

    // Get the asset and verify ownership
    const asset = await prisma.asset.findUnique({
      where: { id: assetId },
    });

    if (!asset) {
      throw new Error("Asset not found");
    }

    if (asset.ownerId !== user.id) {
      throw new Error("You do not have permission to access this asset");
    }

    const metadata = (asset.metadataJson as Record<string, unknown> | null) ?? {};
    if (
      typeof metadata.contentType === "string" &&
      metadata.contentType.toLowerCase() !== contentType.toLowerCase()
    ) {
      throw new Error("Upload content type does not match the registered asset");
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

export const getAssetDownloadUrl = publicActionLenient
  .schema(getDownloadUrlSchema)
  .action(async ({ parsedInput }) => {
    const { assetId } = parsedInput;
    const user = await getDbUser();

    // Get the asset
    const asset = await prisma.asset.findUnique({
      where: {
        id: assetId,
        status: AssetStatus.UPLOADED,
      },
      include: assetAccessInclude,
    });

    if (!asset) {
      throw new Error("Asset not found");
    }
    if (!canReadAsset(user?.id ?? null, asset)) {
      throw new Error("You do not have permission to access this asset");
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
  assetIds: z.array(z.string().min(1)).max(100),
});

export const getAssetDownloadUrls = publicActionLenient
  .schema(getDownloadUrlsSchema)
  .action(async ({ parsedInput }) => {
    const { assetIds } = parsedInput;
    const user = await getDbUser();

    if (assetIds.length === 0) {
      return { assets: [] };
    }

    // Get all assets
    const candidateAssets = await prisma.asset.findMany({
      where: {
        id: { in: assetIds },
        status: AssetStatus.UPLOADED,
      },
      include: assetAccessInclude,
    });
    const assets = candidateAssets.filter((asset) => canReadAsset(user?.id ?? null, asset));

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
