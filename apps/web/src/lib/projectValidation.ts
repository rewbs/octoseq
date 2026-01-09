/**
 * Project validation and migration.
 *
 * Validates project files on load and migrates older schema versions
 * to the current format.
 */

import type { Project, ProjectSerialized } from "@/lib/stores/types/project";

// ----------------------------
// Types
// ----------------------------

export interface ValidationResult {
  /** Whether the project is valid and can be loaded. */
  valid: boolean;
  /** Critical errors that prevent loading. */
  errors: string[];
  /** Non-critical warnings about missing or migrated fields. */
  warnings: string[];
  /** The validated and migrated project (if valid). */
  project?: Project;
}

// ----------------------------
// Constants
// ----------------------------

/** Current schema version. */
export const CURRENT_SCHEMA_VERSION = 1;

/** Minimum supported schema version. */
export const MIN_SUPPORTED_VERSION = 1;

// ----------------------------
// Validation
// ----------------------------

/**
 * Validate and migrate a parsed project object.
 *
 * @param parsed - The parsed JSON data (unknown type)
 * @returns ValidationResult with errors, warnings, and the migrated project
 */
export function validateProject(parsed: unknown): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Check basic structure
  if (!parsed || typeof parsed !== "object") {
    return { valid: false, errors: ["Invalid project format: expected an object"], warnings };
  }

  const data = parsed as Record<string, unknown>;

  // Check version field
  if (typeof data.version !== "number") {
    return { valid: false, errors: ["Missing or invalid version field"], warnings };
  }

  // Check version compatibility
  if (data.version < MIN_SUPPORTED_VERSION) {
    return {
      valid: false,
      errors: [`Unsupported project version: ${data.version}. Minimum supported: ${MIN_SUPPORTED_VERSION}`],
      warnings,
    };
  }

  if (data.version > CURRENT_SCHEMA_VERSION) {
    warnings.push(
      `Project version ${data.version} is newer than current ${CURRENT_SCHEMA_VERSION}. Some features may not work.`
    );
  }

  // Check project data exists
  if (!data.project || typeof data.project !== "object") {
    return { valid: false, errors: ["Missing project data"], warnings };
  }

  const project = data.project as Record<string, unknown>;

  // Validate required fields
  if (!project.id || typeof project.id !== "string") {
    errors.push("Missing or invalid project.id");
  }
  if (!project.name || typeof project.name !== "string") {
    errors.push("Missing or invalid project.name");
  }
  if (!project.createdAt || typeof project.createdAt !== "string") {
    errors.push("Missing or invalid project.createdAt");
  }

  // If required fields are missing, return early
  if (errors.length > 0) {
    return { valid: false, errors, warnings };
  }

  // Migrate project to current schema
  const migratedProject = migrateProject(project as Partial<Project>, data.version as number, warnings);

  return { valid: true, errors: [], warnings, project: migratedProject };
}

// ----------------------------
// Migration
// ----------------------------

/**
 * Migrate a project from an older schema version to the current version.
 *
 * @param project - The project data
 * @param version - The schema version of the project
 * @param warnings - Array to push migration warnings to
 * @returns The migrated project
 */
function migrateProject(
  project: Partial<Project>,
  version: number,
  warnings: string[]
): Project {
  let migrated = { ...project } as Project;

  // Migration from version 1 to current
  // (Currently we're at version 1, but this structure allows future migrations)
  if (version === 1) {
    // Add meshAssets if missing (added in this update)
    if (migrated.meshAssets === undefined) {
      migrated.meshAssets = null;
      warnings.push("Added missing meshAssets field (defaulting to null)");
    }

    // Ensure uiState has all required fields
    if (!migrated.uiState) {
      migrated.uiState = {
        treeExpandedNodes: ["project", "audio", "mixdown", "scripts"],
        treeSelectedNodeId: null,
        sidebarWidth: 280,
        inspectorHeight: 200,
        lastPlayheadPosition: 0,
      };
      warnings.push("Added missing uiState (using defaults)");
    } else {
      // Add individual missing fields
      if (migrated.uiState.inspectorHeight === undefined) {
        migrated.uiState = { ...migrated.uiState, inspectorHeight: 200 };
        warnings.push("Added missing uiState.inspectorHeight (defaulting to 200)");
      }
      if (migrated.uiState.lastPlayheadPosition === undefined) {
        migrated.uiState = { ...migrated.uiState, lastPlayheadPosition: 0 };
        warnings.push("Added missing uiState.lastPlayheadPosition (defaulting to 0)");
      }
    }

    // Ensure audio collection exists
    if (!migrated.audio) {
      migrated.audio = { mixdown: null, stems: [] };
      warnings.push("Added missing audio collection");
    }

    // Note: assetId on audio references is optional and populated on-demand
    // when audio is loaded. No migration needed for legacy projects without assetId.

    // Ensure interpretation exists
    if (!migrated.interpretation) {
      migrated.interpretation = {
        frequencyBands: null,
        musicalTime: null,
        authoredEvents: [],
        beatGrid: null,
        derivedSignals: null,
        composedSignals: null,
      };
      warnings.push("Added missing interpretation data");
    }

    // Ensure composedSignals exists (for projects created before this field was added)
    if (migrated.interpretation && migrated.interpretation.composedSignals === undefined) {
      migrated.interpretation.composedSignals = null;
    }

    // Ensure scripts exists
    if (!migrated.scripts) {
      migrated.scripts = { scripts: [], activeScriptId: null };
      warnings.push("Added missing scripts collection");
    }
  }

  // Ensure modifiedAt is set
  if (!migrated.modifiedAt) {
    migrated.modifiedAt = migrated.createdAt || new Date().toISOString();
  }

  return migrated;
}

/**
 * Validate unique IDs within a project.
 * Returns any duplicate ID warnings.
 */
export function validateProjectIds(project: Project): string[] {
  const warnings: string[] = [];
  const seenIds = new Set<string>();

  // Check script IDs
  for (const script of project.scripts.scripts) {
    if (seenIds.has(script.id)) {
      warnings.push(`Duplicate script ID: ${script.id}`);
    }
    seenIds.add(script.id);
  }

  // Check authored event stream IDs
  for (const stream of project.interpretation.authoredEvents) {
    if (seenIds.has(stream.id)) {
      warnings.push(`Duplicate event stream ID: ${stream.id}`);
    }
    seenIds.add(stream.id);

    // Check event IDs within stream
    for (const event of stream.events) {
      if (seenIds.has(event.id)) {
        warnings.push(`Duplicate event ID: ${event.id} in stream ${stream.name}`);
      }
      seenIds.add(event.id);
    }
  }

  // Check frequency band IDs
  if (project.interpretation.frequencyBands) {
    for (const band of project.interpretation.frequencyBands.bands) {
      if (seenIds.has(band.id)) {
        warnings.push(`Duplicate band ID: ${band.id}`);
      }
      seenIds.add(band.id);
    }
  }

  // Check mesh asset IDs
  if (project.meshAssets) {
    for (const asset of project.meshAssets.assets) {
      if (seenIds.has(asset.id)) {
        warnings.push(`Duplicate mesh asset ID: ${asset.id}`);
      }
      seenIds.add(asset.id);
    }
  }

  // Check derived signal IDs
  if (project.interpretation.derivedSignals) {
    for (const signal of project.interpretation.derivedSignals.signals) {
      if (seenIds.has(signal.id)) {
        warnings.push(`Duplicate derived signal ID: ${signal.id}`);
      }
      seenIds.add(signal.id);
    }
  }

  return warnings;
}
