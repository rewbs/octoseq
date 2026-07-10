ALTER TABLE "Project" ALTER COLUMN "isPublic" SET DEFAULT false;
ALTER TABLE "ProjectWorkingState" ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Asset" DROP CONSTRAINT "Asset_ownerId_fkey";
ALTER TABLE "Asset" ALTER COLUMN "ownerId" DROP NOT NULL;
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "ProjectAsset" (
    "projectId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProjectAsset_pkey" PRIMARY KEY ("projectId", "assetId")
);

CREATE INDEX "ProjectAsset_assetId_idx" ON "ProjectAsset"("assetId");
ALTER TABLE "ProjectAsset" ADD CONSTRAINT "ProjectAsset_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProjectAsset" ADD CONSTRAINT "ProjectAsset_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "ProjectSnapshotAsset" (
    "snapshotId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProjectSnapshotAsset_pkey" PRIMARY KEY ("snapshotId", "assetId")
);

CREATE INDEX "ProjectSnapshotAsset_assetId_idx" ON "ProjectSnapshotAsset"("assetId");
ALTER TABLE "ProjectSnapshotAsset" ADD CONSTRAINT "ProjectSnapshotAsset_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "ProjectSnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProjectSnapshotAsset" ADD CONSTRAINT "ProjectSnapshotAsset_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "RateLimitBucket" (
    "key" TEXT NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "count" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "RateLimitBucket_pkey" PRIMARY KEY ("key")
);
CREATE INDEX "RateLimitBucket_expiresAt_idx" ON "RateLimitBucket"("expiresAt");

-- Backfill audio references from existing working state.
INSERT INTO "ProjectAsset" ("projectId", "assetId")
SELECT DISTINCT pws."projectId", COALESCE(stream->'audio'->>'cloudAssetId', stream->'audio'->>'assetId')
FROM "ProjectWorkingState" pws
CROSS JOIN LATERAL jsonb_array_elements(
    CASE
        WHEN jsonb_typeof(pws."workingJson"->'project'->'streams') = 'array'
        THEN pws."workingJson"->'project'->'streams'
        ELSE '[]'::jsonb
    END
) stream
JOIN "Asset" asset ON asset."id" = COALESCE(stream->'audio'->>'cloudAssetId', stream->'audio'->>'assetId')
WHERE stream->>'kind' IN ('mixdown', 'stem')
ON CONFLICT DO NOTHING;

-- Retain audio references from existing immutable snapshots.
INSERT INTO "ProjectSnapshotAsset" ("snapshotId", "assetId")
SELECT DISTINCT snapshot."id", COALESCE(stream->'audio'->>'cloudAssetId', stream->'audio'->>'assetId')
FROM "ProjectSnapshot" snapshot
CROSS JOIN LATERAL jsonb_array_elements(
    CASE
        WHEN jsonb_typeof(snapshot."snapshotJson"->'project'->'streams') = 'array'
        THEN snapshot."snapshotJson"->'project'->'streams'
        ELSE '[]'::jsonb
    END
) stream
JOIN "Asset" asset ON asset."id" = COALESCE(stream->'audio'->>'cloudAssetId', stream->'audio'->>'assetId')
WHERE stream->>'kind' IN ('mixdown', 'stem')
ON CONFLICT DO NOTHING;

-- Retain mesh references from existing immutable snapshots.
INSERT INTO "ProjectSnapshotAsset" ("snapshotId", "assetId")
SELECT DISTINCT snapshot."id", COALESCE(mesh->>'cloudAssetId', mesh->>'assetId')
FROM "ProjectSnapshot" snapshot
CROSS JOIN LATERAL jsonb_array_elements(
    CASE
        WHEN jsonb_typeof(snapshot."snapshotJson"->'project'->'meshAssets'->'assets') = 'array'
        THEN snapshot."snapshotJson"->'project'->'meshAssets'->'assets'
        ELSE '[]'::jsonb
    END
) mesh
JOIN "Asset" asset ON asset."id" = COALESCE(mesh->>'cloudAssetId', mesh->>'assetId')
ON CONFLICT DO NOTHING;

-- Backfill mesh references from existing working state.
INSERT INTO "ProjectAsset" ("projectId", "assetId")
SELECT DISTINCT pws."projectId", COALESCE(mesh->>'cloudAssetId', mesh->>'assetId')
FROM "ProjectWorkingState" pws
CROSS JOIN LATERAL jsonb_array_elements(
    CASE
        WHEN jsonb_typeof(pws."workingJson"->'project'->'meshAssets'->'assets') = 'array'
        THEN pws."workingJson"->'project'->'meshAssets'->'assets'
        ELSE '[]'::jsonb
    END
) mesh
JOIN "Asset" asset ON asset."id" = COALESCE(mesh->>'cloudAssetId', mesh->>'assetId')
ON CONFLICT DO NOTHING;
