/**
 * Types for 3D mesh asset management.
 */

/**
 * A 3D mesh asset loaded from a file.
 */
export interface MeshAsset {
  /** Unique identifier for the mesh asset. */
  id: string;

  /** Display name for the mesh. */
  name: string;

  /** Original file name. */
  fileName: string;

  /** Raw OBJ file content (for serialization and passing to visualiser). */
  objContent: string;

  /** Number of vertices in the mesh. */
  vertexCount: number;

  /** Number of faces in the mesh. */
  faceCount: number;

  /** Timestamp when the asset was added. */
  createdAt: string;
}

/**
 * Container for all mesh assets in a project.
 */
export interface MeshAssetStructure {
  /** All mesh assets. */
  assets: MeshAsset[];

  /** Last modification timestamp. */
  modifiedAt: string;
}

/**
 * Create an empty mesh asset structure.
 */
export function createEmptyMeshAssetStructure(): MeshAssetStructure {
  return {
    assets: [],
    modifiedAt: new Date().toISOString(),
  };
}

/**
 * Parse OBJ content to extract basic metadata.
 */
export function parseObjMetadata(content: string): { vertexCount: number; faceCount: number } {
  let vertexCount = 0;
  let faceCount = 0;

  const lines = content.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("v ")) {
      vertexCount++;
    } else if (trimmed.startsWith("f ")) {
      faceCount++;
    }
  }

  return { vertexCount, faceCount };
}
