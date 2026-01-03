import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { env } from './env';

// -----------------------------------------------------------------------------
// R2 Client Configuration
// Cloudflare R2 is S3-compatible, so we use the AWS SDK
// -----------------------------------------------------------------------------

const r2Client = new S3Client({
  region: 'auto',
  endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
  },
});

// -----------------------------------------------------------------------------
// R2 Key Generation
// Deterministic key generation from asset ID for consistent storage paths
// -----------------------------------------------------------------------------

/**
 * Generates a deterministic R2 object key from user ID and asset ID.
 * Includes backend ID for environment isolation and user ID for ownership.
 *
 * Format: {backendId}/assets/{userId}/{first 2 chars of assetId}/{assetId}
 *
 * Example: prod/assets/clx1abc123/cl/clx9xyz789def456
 */
export function generateR2Key(userId: string, assetId: string): string {
  const prefix = assetId.slice(0, 2);
  return `${env.BACKEND_ID}/assets/${userId}/${prefix}/${assetId}`;
}

// -----------------------------------------------------------------------------
// Pre-signed URL Generation
// -----------------------------------------------------------------------------

/**
 * Generates a pre-signed PUT URL for uploading an asset to R2.
 *
 * @param r2Key - The R2 object key (from generateR2Key)
 * @param contentType - The MIME type of the asset
 * @param expiresIn - URL expiration time in seconds (default: 1 hour)
 * @returns Pre-signed URL for PUT request
 */
export async function generateUploadUrl(
  r2Key: string,
  contentType: string,
  expiresIn: number = 3600
): Promise<string> {
  const command = new PutObjectCommand({
    Bucket: env.R2_BUCKET_NAME,
    Key: r2Key,
    ContentType: contentType,
  });

  const url = await getSignedUrl(r2Client, command, { expiresIn });
  return url;
}

/**
 * Generates a pre-signed GET URL for downloading an asset from R2.
 *
 * @param r2Key - The R2 object key
 * @param expiresIn - URL expiration time in seconds (default: 1 hour)
 * @returns Pre-signed URL for GET request
 */
export async function generateDownloadUrl(
  r2Key: string,
  expiresIn: number = 3600
): Promise<string> {
  const command = new GetObjectCommand({
    Bucket: env.R2_BUCKET_NAME,
    Key: r2Key,
  });

  const url = await getSignedUrl(r2Client, command, { expiresIn });
  return url;
}

/**
 * Gets the public URL for an asset (if bucket has public access).
 * For private buckets, use generateDownloadUrl instead.
 */
export function getPublicAssetUrl(r2Key: string): string {
  // R2 public bucket URL format
  // This assumes a custom domain or R2.dev subdomain is configured
  return `https://${env.R2_BUCKET_NAME}.r2.dev/${r2Key}`;
}

export { r2Client };
