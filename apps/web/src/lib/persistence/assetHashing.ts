/**
 * Asset Hashing Module
 *
 * Provides content-addressable hashing for audio assets.
 * Uses SHA-256 via Web Crypto API for deduplication.
 */

/**
 * Compute SHA-256 hash of binary content.
 *
 * @param data - The binary data to hash
 * @returns Promise resolving to hex-encoded hash string
 */
export async function computeContentHash(data: ArrayBuffer): Promise<string> {
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Compute hash from a File object.
 *
 * @param file - The file to hash
 * @returns Promise resolving to hex-encoded hash string
 */
export async function hashFile(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  return computeContentHash(buffer);
}

/**
 * Check if two hashes are equal.
 * Case-insensitive comparison.
 *
 * @param hash1 - First hash
 * @param hash2 - Second hash
 * @returns true if hashes match
 */
export function hashesEqual(hash1: string, hash2: string): boolean {
  return hash1.toLowerCase() === hash2.toLowerCase();
}

/**
 * Truncate a hash for display purposes.
 *
 * @param hash - The full hash
 * @param length - Number of characters to show (default 8)
 * @returns Truncated hash with ellipsis
 */
export function truncateHash(hash: string, length = 8): string {
  if (hash.length <= length) return hash;
  return `${hash.slice(0, length)}...`;
}
