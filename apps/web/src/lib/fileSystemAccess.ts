/**
 * File System Access API utilities with fallback to download.
 *
 * Provides a consistent API for saving and loading project files,
 * using the File System Access API when available (for "Save" behavior
 * that remembers the file handle) and falling back to standard download
 * when not available.
 */

import "@/types/file-system-access";

// ----------------------------
// Types
// ----------------------------

export interface SaveResult {
  success: boolean;
  fileName: string;
  handle?: FileSystemFileHandle;
  error?: "cancelled" | string;
}

export interface OpenResult {
  content: string;
  fileName: string;
  handle?: FileSystemFileHandle;
}

// ----------------------------
// Feature Detection
// ----------------------------

/**
 * Check if the File System Access API is available.
 */
export function isFileSystemAccessSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "showSaveFilePicker" in window &&
    "showOpenFilePicker" in window
  );
}

// ----------------------------
// Save Operations
// ----------------------------

/**
 * Save project using File System Access API or fallback to download.
 *
 * @param json - The JSON string to save
 * @param projectName - The project name (used for suggested filename)
 * @param existingHandle - An existing file handle to write to (for "Save" vs "Save As")
 * @returns SaveResult with success status and file handle if available
 */
export async function saveProjectFile(
  json: string,
  projectName: string,
  existingHandle: FileSystemFileHandle | null
): Promise<SaveResult> {
  const fileName = `${sanitizeFileName(projectName)}.octoseq.json`;

  // Try to use existing handle first (for "Save" behavior)
  if (existingHandle && isFileSystemAccessSupported()) {
    try {
      const writable = await existingHandle.createWritable();
      await writable.write(json);
      await writable.close();
      return { success: true, fileName: existingHandle.name, handle: existingHandle };
    } catch (e) {
      // Handle might be stale or permission revoked, fall through to picker
      console.warn("Failed to write to existing handle:", e);
    }
  }

  // Try File System Access API picker
  if (isFileSystemAccessSupported()) {
    try {
      const handle = await window.showSaveFilePicker!({
        suggestedName: fileName,
        types: [
          {
            description: "Octoseq Project",
            accept: { "application/json": [".octoseq.json", ".json"] },
          },
        ],
      });
      const writable = await handle.createWritable();
      await writable.write(json);
      await writable.close();
      return { success: true, fileName: handle.name, handle };
    } catch (e) {
      if ((e as Error).name === "AbortError") {
        return { success: false, fileName, error: "cancelled" };
      }
      // Fall through to download fallback
      console.warn("File System Access API failed, falling back to download:", e);
    }
  }

  // Fallback: trigger download
  downloadFile(json, fileName, "application/json");
  return { success: true, fileName };
}

/**
 * Save As - always show picker (or fallback to download).
 *
 * @param json - The JSON string to save
 * @param projectName - The project name (used for suggested filename)
 * @returns SaveResult with success status and file handle if available
 */
export async function saveProjectFileAs(
  json: string,
  projectName: string
): Promise<SaveResult> {
  return saveProjectFile(json, projectName, null);
}

// ----------------------------
// Open Operations
// ----------------------------

/**
 * Open project file using File System Access API.
 * Returns null if user cancels or if API is not supported.
 * Falls back to null (caller should use file input fallback).
 *
 * @returns OpenResult with file content and handle, or null if cancelled/unsupported
 */
export async function openProjectFile(): Promise<OpenResult | null> {
  if (!isFileSystemAccessSupported()) {
    return null;
  }

  try {
    const handles = await window.showOpenFilePicker!({
      types: [
        {
          description: "Octoseq Project",
          accept: { "application/json": [".octoseq.json", ".json"] },
        },
      ],
      multiple: false,
    });
    const handle = handles[0];
    if (!handle) return null;
    const file = await handle.getFile();
    const content = await file.text();
    return { content, fileName: file.name, handle };
  } catch (e) {
    if ((e as Error).name === "AbortError") {
      return null;
    }
    console.warn("File System Access API open failed:", e);
    return null;
  }
}

// ----------------------------
// Helpers
// ----------------------------

/**
 * Trigger a file download using the standard download mechanism.
 */
function downloadFile(content: string, fileName: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Sanitize a string for use in a filename.
 * Removes or replaces characters that are invalid in filenames.
 */
function sanitizeFileName(name: string): string {
  return name
    .replace(/[<>:"/\\|?*]/g, "_") // Replace invalid chars with underscore
    .replace(/\s+/g, " ") // Normalize whitespace
    .trim()
    .slice(0, 100); // Limit length
}
