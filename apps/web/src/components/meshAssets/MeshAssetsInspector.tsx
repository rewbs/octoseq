"use client";

import { useRef, useCallback } from "react";
import { Plus, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useMeshAssetStore, useMeshAssets } from "@/lib/stores/meshAssetStore";
import { useCloudAssetUploader } from "@/lib/hooks/useCloudAssetUploader";
import { computeContentHash } from "@/lib/persistence/assetHashing";

/**
 * Inspector for the 3D Objects (mesh assets) section.
 * Shows list of loaded mesh assets and allows adding/removing them.
 */
export function MeshAssetsInspector() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const assets = useMeshAssets();
  const selectedAssetId = useMeshAssetStore((s) => s.selectedAssetId);
  const selectAsset = useMeshAssetStore((s) => s.selectAsset);
  const addAsset = useMeshAssetStore((s) => s.addAsset);
  const removeAsset = useMeshAssetStore((s) => s.removeAsset);
  const renameAsset = useMeshAssetStore((s) => s.renameAsset);
  const setCloudAssetId = useMeshAssetStore((s) => s.setCloudAssetId);
  const clearRawBytes = useMeshAssetStore((s) => s.clearRawBytes);

  // Cloud upload
  const { uploadToCloud, isSignedIn } = useCloudAssetUploader();

  const handleFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (!files || files.length === 0) return;

      for (const file of Array.from(files)) {
        if (!file.name.toLowerCase().endsWith(".obj")) {
          console.warn(`Skipping non-OBJ file: ${file.name}`);
          continue;
        }

        // Read file as both text (for rendering) and bytes (for upload)
        const [content, rawBytes] = await Promise.all([
          file.text(),
          file.arrayBuffer(),
        ]);

        // Compute content hash for deduplication
        const contentHash = await computeContentHash(rawBytes);

        // Add asset to store with raw bytes for potential cloud upload
        const assetId = addAsset(file.name, content, {
          rawBytes,
          mimeType: file.type || "application/octet-stream",
          contentHash,
        });

        // Start cloud upload if signed in
        if (isSignedIn) {
          console.log("[MeshUpload] Starting cloud upload for:", file.name);
          uploadToCloud({
            file,
            type: "MESH",
            metadata: {
              fileName: file.name,
              fileSize: file.size,
            },
            onComplete: (cloudAssetId) => {
              console.log("[MeshUpload] Upload complete:", cloudAssetId);
              setCloudAssetId(assetId, cloudAssetId);
              clearRawBytes(assetId);
            },
            onError: (error) => {
              console.error("[MeshUpload] Upload failed:", error);
            },
          });
        }
      }

      // Reset input so the same file can be re-selected
      e.target.value = "";
    },
    [addAsset, isSignedIn, uploadToCloud, setCloudAssetId, clearRawBytes]
  );

  const handleAddClick = () => {
    fileInputRef.current?.click();
  };

  const handleDelete = (id: string) => {
    removeAsset(id);
  };

  return (
    <div className="p-2 space-y-3">
      <Button size="sm" variant="outline" className="w-full" onClick={handleAddClick}>
        <Plus className="h-4 w-4 mr-2" />
        Add .obj File
      </Button>
      <input
        ref={fileInputRef}
        type="file"
        accept=".obj"
        multiple
        onChange={handleFileChange}
        className="hidden"
      />

      {assets.length === 0 ? (
        <div className="text-center py-6">
          <Upload className="h-8 w-8 mx-auto mb-2 text-zinc-400" />
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            No 3D objects loaded.
          </p>
          <p className="text-xs text-zinc-400 dark:text-zinc-500 mt-1">
            Load .obj files to use as mesh assets in your scripts.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {assets.map((asset) => (
            <div
              key={asset.id}
              className={`flex items-center justify-between p-2 rounded border transition-colors cursor-pointer ${
                selectedAssetId === asset.id
                  ? "border-blue-500 bg-blue-50 dark:bg-blue-950"
                  : "border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800"
              }`}
              onClick={() => selectAsset(asset.id)}
            >
              <div className="flex-1 min-w-0">
                <input
                  type="text"
                  value={asset.name}
                  onChange={(e) => renameAsset(asset.id, e.target.value)}
                  onClick={(e) => e.stopPropagation()}
                  className="w-full text-sm font-medium bg-transparent border-b border-transparent hover:border-zinc-300 dark:hover:border-zinc-600 focus:border-blue-500 focus:outline-none"
                />
                <div className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                  {asset.vertexCount.toLocaleString()} vertices, {asset.faceCount.toLocaleString()} faces
                </div>
              </div>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 w-7 p-0 ml-2"
                onClick={(e) => {
                  e.stopPropagation();
                  handleDelete(asset.id);
                }}
              >
                <Trash2 className="h-4 w-4 text-zinc-400 hover:text-red-500" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
