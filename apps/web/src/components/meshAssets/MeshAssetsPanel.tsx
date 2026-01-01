"use client";

import { useRef, useEffect, useCallback, useState, useMemo } from "react";
import { Plus, Upload, RotateCw, ZoomIn, ZoomOut, Maximize2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useMeshAssetStore, useMeshAssets, useSelectedMeshAsset } from "@/lib/stores/meshAssetStore";
import { useInterpretationTreeStore, TREE_NODE_IDS } from "@/lib/stores/interpretationTreeStore";
import { getInspectorNodeType } from "@/lib/nodeTypes";

/**
 * Parse OBJ content to extract vertices and faces for rendering.
 */
function parseObj(content: string): { vertices: number[][]; faces: number[][] } {
  const vertices: number[][] = [];
  const faces: number[][] = [];

  const lines = content.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("v ")) {
      const parts = trimmed.slice(2).split(/\s+/).map(Number);
      if (parts.length >= 3) {
        vertices.push([parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0]);
      }
    } else if (trimmed.startsWith("f ")) {
      // Parse face indices (OBJ is 1-indexed, can have formats like "1", "1/2", "1/2/3", "1//3")
      const parts = trimmed.slice(2).split(/\s+/);
      const indices = parts.map((p) => {
        const idx = parseInt(p.split("/")[0] ?? "0", 10) - 1; // Convert to 0-indexed
        return idx;
      });
      if (indices.length >= 3) {
        faces.push(indices);
      }
    }
  }

  return { vertices, faces };
}

/**
 * Compute bounding box and center of vertices.
 */
function computeBounds(vertices: number[][]): {
  min: [number, number, number];
  max: [number, number, number];
  center: [number, number, number];
  scale: number;
} {
  if (vertices.length === 0) {
    return {
      min: [0, 0, 0],
      max: [0, 0, 0],
      center: [0, 0, 0],
      scale: 1,
    };
  }

  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];

  for (const v of vertices) {
    min[0] = Math.min(min[0], v[0] ?? 0);
    min[1] = Math.min(min[1], v[1] ?? 0);
    min[2] = Math.min(min[2], v[2] ?? 0);
    max[0] = Math.max(max[0], v[0] ?? 0);
    max[1] = Math.max(max[1], v[1] ?? 0);
    max[2] = Math.max(max[2], v[2] ?? 0);
  }

  const center: [number, number, number] = [
    (min[0] + max[0]) / 2,
    (min[1] + max[1]) / 2,
    (min[2] + max[2]) / 2,
  ];

  const size = Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]);
  const scale = size > 0 ? 1 / size : 1;

  return { min, max, center, scale };
}

/**
 * Rotate a point around the Y axis.
 */
function rotateY(point: [number, number, number], angle: number): [number, number, number] {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return [
    point[0] * cos + point[2] * sin,
    point[1],
    -point[0] * sin + point[2] * cos,
  ];
}

/**
 * Rotate a point around the X axis.
 */
function rotateX(point: [number, number, number], angle: number): [number, number, number] {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return [
    point[0],
    point[1] * cos - point[2] * sin,
    point[1] * sin + point[2] * cos,
  ];
}

/**
 * Project 3D point to 2D screen coordinates.
 */
function project(
  point: [number, number, number],
  width: number,
  height: number,
  zoom: number
): [number, number] {
  const scale = Math.min(width, height) * 0.4 * zoom;
  const x = width / 2 + point[0] * scale;
  const y = height / 2 - point[1] * scale; // Flip Y for screen coordinates
  return [x, y];
}

interface MeshPreviewProps {
  objContent: string;
  width: number;
  height: number;
}

/**
 * Canvas-based 3D wireframe preview of an OBJ mesh.
 */
function MeshPreview({ objContent, width, height }: MeshPreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [rotation, setRotation] = useState<[number, number]>([0.3, 0]); // [rotY, rotX]
  const [zoom, setZoom] = useState(1);
  const [isDragging, setIsDragging] = useState(false);
  const lastMouseRef = useRef<[number, number]>([0, 0]);

  const parsedMesh = useMemo(() => parseObj(objContent), [objContent]);
  const bounds = useMemo(() => computeBounds(parsedMesh.vertices), [parsedMesh.vertices]);

  // Draw the mesh
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Clear canvas
    ctx.fillStyle = "#18181b"; // zinc-900
    ctx.fillRect(0, 0, width, height);

    const { vertices, faces } = parsedMesh;
    if (vertices.length === 0) return;

    // Transform vertices: center, scale, rotate
    const transformedVertices: [number, number, number][] = vertices.map((v) => {
      let point: [number, number, number] = [
        ((v[0] ?? 0) - bounds.center[0]) * bounds.scale,
        ((v[1] ?? 0) - bounds.center[1]) * bounds.scale,
        ((v[2] ?? 0) - bounds.center[2]) * bounds.scale,
      ];
      point = rotateY(point, rotation[0]);
      point = rotateX(point, rotation[1]);
      return point;
    });

    // Project to 2D
    const projectedVertices = transformedVertices.map((v) =>
      project(v, width, height, zoom)
    );

    // Draw edges (wireframe)
    ctx.strokeStyle = "#3b82f6"; // blue-500
    ctx.lineWidth = 1;
    ctx.beginPath();

    for (const face of faces) {
      if (face.length < 3) continue;

      // Draw edges of the face
      for (let i = 0; i < face.length; i++) {
        const i1 = face[i];
        const i2 = face[(i + 1) % face.length];

        if (i1 === undefined || i2 === undefined) continue;
        const p1 = projectedVertices[i1];
        const p2 = projectedVertices[i2];

        if (!p1 || !p2) continue;

        ctx.moveTo(p1[0], p1[1]);
        ctx.lineTo(p2[0], p2[1]);
      }
    }

    ctx.stroke();

    // Draw vertices as small dots
    ctx.fillStyle = "#60a5fa"; // blue-400
    for (const p of projectedVertices) {
      ctx.beginPath();
      ctx.arc(p[0], p[1], 1.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }, [parsedMesh, bounds, rotation, zoom, width, height]);

  // Mouse handlers for rotation
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    setIsDragging(true);
    lastMouseRef.current = [e.clientX, e.clientY];
  }, []);

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!isDragging) return;

      const dx = e.clientX - lastMouseRef.current[0];
      const dy = e.clientY - lastMouseRef.current[1];

      setRotation((prev) => [
        prev[0] + dx * 0.01,
        Math.max(-Math.PI / 2, Math.min(Math.PI / 2, prev[1] + dy * 0.01)),
      ]);

      lastMouseRef.current = [e.clientX, e.clientY];
    },
    [isDragging]
  );

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    setZoom((prev) => Math.max(0.5, Math.min(3, prev - e.deltaY * 0.001)));
  }, []);

  const handleReset = () => {
    setRotation([0.3, 0]);
    setZoom(1);
  };

  return (
    <div className="relative">
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        className="rounded cursor-grab active:cursor-grabbing"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onWheel={handleWheel}
      />
      <div className="absolute bottom-2 right-2 flex gap-1">
        <Button
          size="sm"
          variant="ghost"
          className="h-7 w-7 p-0 bg-zinc-800/80 hover:bg-zinc-700/80"
          onClick={() => setZoom((z) => Math.min(3, z + 0.25))}
        >
          <ZoomIn className="h-4 w-4 text-zinc-300" />
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 w-7 p-0 bg-zinc-800/80 hover:bg-zinc-700/80"
          onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))}
        >
          <ZoomOut className="h-4 w-4 text-zinc-300" />
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 w-7 p-0 bg-zinc-800/80 hover:bg-zinc-700/80"
          onClick={handleReset}
        >
          <Maximize2 className="h-4 w-4 text-zinc-300" />
        </Button>
      </div>
    </div>
  );
}

/**
 * Main panel for 3D Objects (mesh assets) display in the main content area.
 * Shows a 3D preview of the selected mesh asset.
 */
export function MeshAssetsPanel() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(400);

  const selectedNodeId = useInterpretationTreeStore((s) => s.selectedNodeId);
  const nodeType = getInspectorNodeType(selectedNodeId);
  const assets = useMeshAssets();
  const selectedAsset = useSelectedMeshAsset();
  const addAsset = useMeshAssetStore((s) => s.addAsset);
  const selectAsset = useMeshAssetStore((s) => s.selectAsset);

  // Only show when 3D Objects is selected
  const isVisible = nodeType === "mesh-assets";

  // Measure container width
  useEffect(() => {
    if (!containerRef.current) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerWidth(entry.contentRect.width);
      }
    });

    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  const handleFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (!files || files.length === 0) return;

      for (const file of Array.from(files)) {
        if (!file.name.toLowerCase().endsWith(".obj")) {
          console.warn(`Skipping non-OBJ file: ${file.name}`);
          continue;
        }

        const content = await file.text();
        addAsset(file.name, content);
      }

      e.target.value = "";
    },
    [addAsset]
  );

  const handleAddClick = () => {
    fileInputRef.current?.click();
  };

  if (!isVisible) {
    return null;
  }

  return (
    <div
      ref={containerRef}
      className="border-b border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900/50"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-200 dark:border-zinc-700">
        <h2 className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
          3D Objects
        </h2>
        <Button size="sm" variant="outline" onClick={handleAddClick}>
          <Plus className="h-4 w-4 mr-1" />
          Add .obj
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".obj"
          multiple
          onChange={handleFileChange}
          className="hidden"
        />
      </div>

      {assets.length === 0 ? (
        /* Empty state */
        <div className="flex flex-col items-center justify-center py-12 px-4">
          <Upload className="h-12 w-12 mb-3 text-zinc-400" />
          <p className="text-sm text-zinc-500 dark:text-zinc-400 text-center">
            No 3D objects loaded
          </p>
          <p className="text-xs text-zinc-400 dark:text-zinc-500 mt-1 text-center">
            Load .obj files to use as mesh assets in your scripts
          </p>
          <Button
            size="sm"
            variant="outline"
            className="mt-4"
            onClick={handleAddClick}
          >
            <Upload className="h-4 w-4 mr-1" />
            Load .obj file
          </Button>
        </div>
      ) : (
        <div className="p-3">
          {/* Asset list as horizontal chips */}
          <div className="flex flex-wrap gap-2 mb-3">
            {assets.map((asset) => (
              <button
                key={asset.id}
                type="button"
                onClick={() => selectAsset(asset.id)}
                className={`px-3 py-1.5 text-sm rounded border transition-colors ${
                  selectedAsset?.id === asset.id
                    ? "border-blue-500 bg-blue-50 dark:bg-blue-950 text-blue-700 dark:text-blue-300"
                    : "border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-700"
                }`}
              >
                {asset.name}
              </button>
            ))}
          </div>

          {/* 3D Preview */}
          {selectedAsset && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-zinc-500 dark:text-zinc-400">
                  {selectedAsset.vertexCount.toLocaleString()} vertices,{" "}
                  {selectedAsset.faceCount.toLocaleString()} faces
                </span>
                <span className="text-xs text-zinc-400">
                  Drag to rotate, scroll to zoom
                </span>
              </div>
              <MeshPreview
                objContent={selectedAsset.objContent}
                width={containerWidth - 24}
                height={300}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
