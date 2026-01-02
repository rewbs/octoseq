/**
 * Type declarations for the File System Access API.
 * https://wicg.github.io/file-system-access/
 *
 * Note: FileSystemFileHandle and related types are already in TypeScript's
 * DOM lib. We only need to augment Window with the picker methods.
 */

interface SaveFilePickerOptions {
  excludeAcceptAllOption?: boolean;
  suggestedName?: string;
  types?: FilePickerAcceptType[];
}

interface OpenFilePickerOptions {
  excludeAcceptAllOption?: boolean;
  multiple?: boolean;
  types?: FilePickerAcceptType[];
}

interface FilePickerAcceptType {
  description?: string;
  accept: Record<string, string | string[]>;
}

declare global {
  interface Window {
    showSaveFilePicker?(
      options?: SaveFilePickerOptions
    ): Promise<FileSystemFileHandle>;
    showOpenFilePicker?(
      options?: OpenFilePickerOptions
    ): Promise<FileSystemFileHandle[]>;
  }
}

export {};
