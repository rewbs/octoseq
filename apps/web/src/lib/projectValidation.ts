/**
 * Project validation.
 *
 * Validates project files on load. Only schema v2 (unified streams) is accepted;
 * older payloads are rejected outright — there is no migration path.
 */

import type { Project } from "@/lib/stores/types/project";

// ----------------------------
// Types
// ----------------------------

export interface ValidationResult {
  /** Whether the project is valid and can be loaded. */
  valid: boolean;
  /** Critical errors that prevent loading. */
  errors: string[];
  /** Non-critical warnings about the payload. */
  warnings: string[];
  /** The validated project (if valid). */
  project?: Project;
}

// ----------------------------
// Constants
// ----------------------------

/** Current schema version. The only supported version — no migrations. */
export const CURRENT_SCHEMA_VERSION = 2;

// ----------------------------
// Validation
// ----------------------------

/**
 * Validate a parsed project object.
 *
 * Rejects any payload whose version is not exactly the current schema version.
 * Never partially loads: an invalid payload yields no project.
 *
 * @param parsed - The parsed JSON data (unknown type)
 * @returns ValidationResult with errors, warnings, and the project
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

  // Only the current schema version is supported — v1 data must fail loudly.
  if (data.version !== CURRENT_SCHEMA_VERSION) {
    return {
      valid: false,
      errors: [
        `Incompatible project schema (expected v${CURRENT_SCHEMA_VERSION}, got v${data.version}); no migration available.`,
      ],
      warnings,
    };
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
  if (!Array.isArray(project.streams)) {
    errors.push("Missing or invalid project.streams");
  }
  if (!project.interpretation || typeof project.interpretation !== "object") {
    errors.push("Missing or invalid project.interpretation");
  }
  if (!project.scripts || typeof project.scripts !== "object") {
    errors.push("Missing or invalid project.scripts");
  }
  if (!project.uiState || typeof project.uiState !== "object") {
    errors.push("Missing or invalid project.uiState");
  }

  if (errors.length > 0) {
    return { valid: false, errors, warnings };
  }

  const validated = project as unknown as Project;

  // Ensure modifiedAt is set (createdAt is validated above)
  if (!validated.modifiedAt) {
    validated.modifiedAt = validated.createdAt;
  }

  return { valid: true, errors: [], warnings, project: validated };
}

/**
 * Validate unique IDs within a project.
 * Returns any duplicate ID warnings.
 */
export function validateProjectIds(project: Project): string[] {
  const warnings: string[] = [];
  const seenIds = new Set<string>();

  // Check stream IDs (mixdown/stems/bands)
  for (const stream of project.streams) {
    if (seenIds.has(stream.id)) {
      warnings.push(`Duplicate stream ID: ${stream.id}`);
    }
    seenIds.add(stream.id);
  }

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
