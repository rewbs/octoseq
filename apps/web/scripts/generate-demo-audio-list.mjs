#!/usr/bin/env node
/**
 * Scans public/audio directory and generates a JSON file with the list of demo audio files.
 * Run this as part of the build process.
 */

import { readdirSync, statSync, writeFileSync, mkdirSync } from "fs";
import { join, dirname, extname, basename } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const AUDIO_DIR = join(__dirname, "../public/audio");
const OUTPUT_FILE = join(__dirname, "../src/lib/generated/demo-audio-list.json");

// Supported audio extensions
const AUDIO_EXTENSIONS = new Set([".mp3", ".wav", ".ogg", ".flac", ".m4a", ".aac", ".webm"]);

function formatFileSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function generateDisplayName(filename) {
  // Remove extension
  let name = basename(filename, extname(filename));

  // Clean up common patterns
  name = name
    .replace(/[-_]/g, " ")  // Replace dashes/underscores with spaces
    .replace(/\s+/g, " ")   // Collapse multiple spaces
    .trim();

  return name;
}

function scanAudioFiles() {
  try {
    const files = readdirSync(AUDIO_DIR);
    const audioFiles = [];

    for (const file of files) {
      const ext = extname(file).toLowerCase();
      if (!AUDIO_EXTENSIONS.has(ext)) continue;

      const filePath = join(AUDIO_DIR, file);
      const stats = statSync(filePath);

      audioFiles.push({
        name: generateDisplayName(file),
        path: `/audio/${file}`,
        filename: file,
        size: stats.size,
        sizeFormatted: formatFileSize(stats.size),
      });
    }

    // Sort by name
    audioFiles.sort((a, b) => a.name.localeCompare(b.name));

    return audioFiles;
  } catch (error) {
    console.error("Error scanning audio directory:", error.message);
    return [];
  }
}

function main() {
  console.log("Scanning audio files in:", AUDIO_DIR);

  const audioFiles = scanAudioFiles();

  console.log(`Found ${audioFiles.length} audio files`);

  // Ensure output directory exists
  const outputDir = dirname(OUTPUT_FILE);
  try {
    readdirSync(outputDir);
  } catch {
    mkdirSync(outputDir, { recursive: true });
  }

  writeFileSync(OUTPUT_FILE, JSON.stringify(audioFiles, null, 2));
  console.log("Generated:", OUTPUT_FILE);
}

main();
