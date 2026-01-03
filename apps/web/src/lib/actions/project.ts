'use server';

import { z } from 'zod';
import { prisma, AssetStatus } from '@/lib/db';
import {
  authAction,
  publicAction,
  assertOwnership,
  assertCanRead,
} from '@/lib/safe-action';
import { getDbUser } from '@/lib/auth/syncUser';

// -----------------------------------------------------------------------------
// Schemas
// -----------------------------------------------------------------------------

const createProjectSchema = z.object({
  name: z.string().min(1).max(255),
});

const projectIdSchema = z.object({
  projectId: z.string().min(1),
});

// InputJsonValue-compatible schema for Prisma JSON fields
const jsonValueSchema: z.ZodType<
  null | string | number | boolean | { [key: string]: unknown } | unknown[]
> = z.lazy(() =>
  z.union([
    z.null(),
    z.string(),
    z.number(),
    z.boolean(),
    z.record(z.string(), jsonValueSchema),
    z.array(jsonValueSchema),
  ])
);

const autosaveSchema = z.object({
  projectId: z.string().min(1),
  workingJson: z.record(z.string(), jsonValueSchema), // Loosely typed JSON object
});

// -----------------------------------------------------------------------------
// createProject
// Creates a new project for the authenticated user
// -----------------------------------------------------------------------------

export const createProject = authAction
  .schema(createProjectSchema)
  .action(async ({ parsedInput, ctx }) => {
    const { name } = parsedInput;
    const { user } = ctx;

    const project = await prisma.project.create({
      data: {
        name,
        ownerId: user.id,
        isPublic: true, // Default to public
      },
    });

    return { project };
  });

// -----------------------------------------------------------------------------
// loadProjectWorkingState
// Loads the working state for a project (public projects readable by anyone)
// -----------------------------------------------------------------------------

export const loadProjectWorkingState = publicAction
  .schema(projectIdSchema)
  .action(async ({ parsedInput }) => {
    const { projectId } = parsedInput;

    // Get the project with its working state
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      include: {
        workingState: true,
      },
    });

    if (!project) {
      throw new Error('Project not found');
    }

    // Check read permission
    const user = await getDbUser();
    assertCanRead(user, project.ownerId, project.isPublic, 'project');

    return {
      project: {
        id: project.id,
        name: project.name,
        ownerId: project.ownerId,
        isPublic: project.isPublic,
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
      },
      workingState: project.workingState?.workingJson ?? null,
      workingStateUpdatedAt: project.workingState?.updatedAt ?? null,
    };
  });

// -----------------------------------------------------------------------------
// autosaveProjectWorkingState
// Saves the working state for a project (owner only)
// -----------------------------------------------------------------------------

export const autosaveProjectWorkingState = authAction
  .schema(autosaveSchema)
  .action(async ({ parsedInput, ctx }) => {
    const { projectId, workingJson } = parsedInput;
    const { user } = ctx;

    // Get the project to check ownership
    const project = await prisma.project.findUnique({
      where: { id: projectId },
    });

    if (!project) {
      throw new Error('Project not found');
    }

    assertOwnership(user, project.ownerId, 'project');

    // Upsert the working state
    // Cast to Prisma-compatible JSON type - the schema already validated structure
    const jsonData = workingJson as Parameters<
      typeof prisma.projectWorkingState.create
    >[0]['data']['workingJson'];
    const workingState = await prisma.projectWorkingState.upsert({
      where: { projectId },
      update: {
        workingJson: jsonData,
      },
      create: {
        projectId,
        workingJson: jsonData,
      },
    });

    return {
      updatedAt: workingState.updatedAt,
    };
  });

// -----------------------------------------------------------------------------
// listPublicProjects
// Lists all public projects (no auth required)
// -----------------------------------------------------------------------------

export const listPublicProjects = publicAction.action(async () => {
  const projects = await prisma.project.findMany({
    where: { isPublic: true },
    orderBy: { updatedAt: 'desc' },
    select: {
      id: true,
      name: true,
      ownerId: true,
      createdAt: true,
      updatedAt: true,
      owner: {
        select: {
          firstName: true,
          lastName: true,
          imageUrl: true,
        },
      },
    },
  });

  return { projects };
});

// -----------------------------------------------------------------------------
// listMyProjects
// Lists all projects owned by the authenticated user
// -----------------------------------------------------------------------------

export const listMyProjects = authAction.action(async ({ ctx }) => {
  const { user } = ctx;

  const projects = await prisma.project.findMany({
    //where: { ownerId: user.id },
    orderBy: { updatedAt: 'desc' },
    select: {
      id: true,
      name: true,
      isPublic: true,
      createdAt: true,
      updatedAt: true,
      workingState: {
        select: {
          updatedAt: true,
        },
      },
    },
  });

  return { projects };
});

// -----------------------------------------------------------------------------
// getProjectMetadata
// Gets project metadata (public projects readable by anyone)
// -----------------------------------------------------------------------------

export const getProjectMetadata = publicAction
  .schema(projectIdSchema)
  .action(async ({ parsedInput }) => {
    const { projectId } = parsedInput;

    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: {
        id: true,
        name: true,
        ownerId: true,
        isPublic: true,
        createdAt: true,
        updatedAt: true,
        owner: {
          select: {
            firstName: true,
            lastName: true,
            imageUrl: true,
          },
        },
      },
    });

    if (!project) {
      throw new Error('Project not found');
    }

    // Check read permission
    const user = await getDbUser();
    assertCanRead(user, project.ownerId, project.isPublic, 'project');

    return { project };
  });

// -----------------------------------------------------------------------------
// createProjectSnapshot
// Creates an immutable snapshot from the current working state
// Validates that all referenced assets are fully uploaded
// -----------------------------------------------------------------------------

/**
 * Extracts all asset IDs referenced in the project working state.
 * Supports audio assets (mixdown, stems) and mesh assets.
 */
function extractAssetIds(workingJson: Record<string, unknown>): string[] {
  const assetIds: string[] = [];

  try {
    const project = workingJson.project as Record<string, unknown> | undefined;
    if (!project) return assetIds;

    // Audio assets: project.audio.mixdown.assetId, project.audio.stems[].assetId
    const audio = project.audio as Record<string, unknown> | undefined;
    if (audio) {
      const mixdown = audio.mixdown as Record<string, unknown> | undefined;
      if (mixdown?.assetId && typeof mixdown.assetId === 'string') {
        assetIds.push(mixdown.assetId);
      }

      const stems = audio.stems as Array<Record<string, unknown>> | undefined;
      if (Array.isArray(stems)) {
        for (const stem of stems) {
          if (stem?.assetId && typeof stem.assetId === 'string') {
            assetIds.push(stem.assetId);
          }
        }
      }
    }

    // Mesh assets: project.meshAssets.assets[].assetId
    const meshAssets = project.meshAssets as Record<string, unknown> | undefined;
    if (meshAssets) {
      const assets = meshAssets.assets as Array<Record<string, unknown>> | undefined;
      if (Array.isArray(assets)) {
        for (const mesh of assets) {
          if (mesh?.assetId && typeof mesh.assetId === 'string') {
            assetIds.push(mesh.assetId);
          }
        }
      }
    }
  } catch {
    // If parsing fails, return empty array - validation will handle appropriately
  }

  return assetIds;
}

export const createProjectSnapshot = authAction
  .schema(projectIdSchema)
  .action(async ({ parsedInput, ctx }) => {
    const { projectId } = parsedInput;
    const { user } = ctx;

    // Get the project with its working state
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      include: {
        workingState: true,
      },
    });

    if (!project) {
      throw new Error('Project not found');
    }

    assertOwnership(user, project.ownerId, 'project');

    // Must have a working state to create a snapshot
    if (!project.workingState) {
      throw new Error('No working state to snapshot');
    }

    const workingJson = project.workingState.workingJson as Record<string, unknown>;

    // Extract all asset IDs from the working state
    const assetIds = extractAssetIds(workingJson);

    // Validate all referenced assets exist and are uploaded
    if (assetIds.length > 0) {
      const assets = await prisma.asset.findMany({
        where: {
          id: { in: assetIds },
          ownerId: user.id,
        },
        select: {
          id: true,
          status: true,
        },
      });

      // Check for missing assets
      const foundIds = new Set(assets.map((a) => a.id));
      const missingIds = assetIds.filter((id) => !foundIds.has(id));
      if (missingIds.length > 0) {
        throw new Error(
          `Cannot create snapshot: ${missingIds.length} referenced asset(s) not found`
        );
      }

      // Check for non-uploaded assets
      const pendingAssets = assets.filter((a) => a.status !== AssetStatus.UPLOADED);
      if (pendingAssets.length > 0) {
        const statuses = pendingAssets.map((a) => `${a.id}: ${a.status}`).join(', ');
        throw new Error(
          `Cannot create snapshot: ${pendingAssets.length} asset(s) not fully uploaded (${statuses})`
        );
      }
    }

    // Create the snapshot (immutable copy of working state)
    const snapshot = await prisma.projectSnapshot.create({
      data: {
        projectId,
        snapshotJson: workingJson as Parameters<
          typeof prisma.projectSnapshot.create
        >[0]['data']['snapshotJson'],
      },
    });

    return {
      snapshot: {
        id: snapshot.id,
        projectId: snapshot.projectId,
        createdAt: snapshot.createdAt,
      },
    };
  });

// -----------------------------------------------------------------------------
// cloneProject
// Clones a project's latest snapshot into a new project owned by the caller
// Assets are referenced (not duplicated), making cloning efficient
// -----------------------------------------------------------------------------

const cloneProjectSchema = z.object({
  sourceProjectId: z.string().min(1),
  name: z.string().min(1).max(255).optional(),
});

export const cloneProject = authAction
  .schema(cloneProjectSchema)
  .action(async ({ parsedInput, ctx }) => {
    const { sourceProjectId, name } = parsedInput;
    const { user } = ctx;

    // Get the source project with its latest snapshot
    const sourceProject = await prisma.project.findUnique({
      where: { id: sourceProjectId },
      include: {
        snapshots: {
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
        workingState: true,
      },
    });

    if (!sourceProject) {
      throw new Error('Source project not found');
    }

    // Check read permission (public projects can be cloned by anyone)
    assertCanRead(user, sourceProject.ownerId, sourceProject.isPublic, 'project');

    // Determine the source JSON: prefer latest snapshot, fall back to working state
    let sourceJson: Record<string, unknown> | null = null;

    const latestSnapshot = sourceProject.snapshots[0];
    if (latestSnapshot) {
      sourceJson = latestSnapshot.snapshotJson as Record<string, unknown>;
    } else if (sourceProject.workingState) {
      sourceJson = sourceProject.workingState.workingJson as Record<string, unknown>;
    }

    if (!sourceJson) {
      throw new Error('Source project has no content to clone');
    }

    // Generate a name for the cloned project
    const clonedName = name ?? `${sourceProject.name} (Copy)`;

    // Create the new project with working state in a transaction
    const result = await prisma.$transaction(async (tx) => {
      // Create the new project
      const newProject = await tx.project.create({
        data: {
          name: clonedName,
          ownerId: user.id,
          isPublic: false, // Clones start as private
        },
      });

      // Update the cloned JSON with the new project metadata
      const clonedJson = updateClonedProjectMetadata(sourceJson, newProject.id, clonedName);

      // Create the working state for the new project
      await tx.projectWorkingState.create({
        data: {
          projectId: newProject.id,
          workingJson: clonedJson as Parameters<
            typeof tx.projectWorkingState.create
          >[0]['data']['workingJson'],
        },
      });

      return newProject;
    });

    return {
      project: {
        id: result.id,
        name: result.name,
        ownerId: result.ownerId,
        isPublic: result.isPublic,
        createdAt: result.createdAt,
        updatedAt: result.updatedAt,
      },
    };
  });

/**
 * Updates the project metadata in the cloned JSON.
 * Preserves asset references but updates project identity.
 */
function updateClonedProjectMetadata(
  sourceJson: Record<string, unknown>,
  newProjectId: string,
  newName: string
): Record<string, unknown> {
  const cloned = JSON.parse(JSON.stringify(sourceJson)) as Record<string, unknown>;

  // Update project-level metadata if it exists
  if (cloned.project && typeof cloned.project === 'object') {
    const project = cloned.project as Record<string, unknown>;
    project.id = newProjectId;
    project.name = newName;
    project.createdAt = new Date().toISOString();
    project.modifiedAt = new Date().toISOString();
  }

  return cloned;
}

// -----------------------------------------------------------------------------
// getProjectAssetStatuses
// Gets the status of all assets referenced in a project's working state
// Used by UI to show unresolved asset indicators
// -----------------------------------------------------------------------------

export const getProjectAssetStatuses = publicAction
  .schema(projectIdSchema)
  .action(async ({ parsedInput }) => {
    const { projectId } = parsedInput;

    // Get the project with working state
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      include: {
        workingState: true,
      },
    });

    if (!project) {
      throw new Error('Project not found');
    }

    // Check read permission
    const user = await getDbUser();
    assertCanRead(user, project.ownerId, project.isPublic, 'project');

    // If no working state, return empty
    if (!project.workingState) {
      return {
        assets: [],
        counts: { resolved: 0, pending: 0, failed: 0, missing: 0, total: 0 },
        allResolved: true,
        hasIssues: false,
      };
    }

    const workingJson = project.workingState.workingJson as Record<string, unknown>;
    const assetIds = extractAssetIds(workingJson);

    if (assetIds.length === 0) {
      return {
        assets: [],
        counts: { resolved: 0, pending: 0, failed: 0, missing: 0, total: 0 },
        allResolved: true,
        hasIssues: false,
      };
    }

    // Fetch asset statuses from database
    const assets = await prisma.asset.findMany({
      where: { id: { in: assetIds } },
      select: {
        id: true,
        status: true,
        type: true,
        r2Key: true,
        metadataJson: true,
      },
    });

    // Build resolution info
    const foundIds = new Set(assets.map((a) => a.id));
    const assetInfos = [];

    // Add found assets
    for (const asset of assets) {
      const metadata = asset.metadataJson as Record<string, unknown> | null;
      assetInfos.push({
        assetId: asset.id,
        status:
          asset.status === 'UPLOADED'
            ? 'resolved'
            : asset.status === 'PENDING'
              ? 'pending'
              : 'failed',
        type: asset.type,
        r2Key: asset.status === 'UPLOADED' ? asset.r2Key : undefined,
        error: metadata?.uploadError as string | undefined,
      });
    }

    // Add missing assets
    for (const assetId of assetIds) {
      if (!foundIds.has(assetId)) {
        assetInfos.push({
          assetId,
          status: 'missing' as const,
        });
      }
    }

    // Compute counts
    const counts = {
      resolved: assetInfos.filter((a) => a.status === 'resolved').length,
      pending: assetInfos.filter((a) => a.status === 'pending').length,
      failed: assetInfos.filter((a) => a.status === 'failed').length,
      missing: assetInfos.filter((a) => a.status === 'missing').length,
      total: assetInfos.length,
    };

    return {
      assets: assetInfos,
      counts,
      allResolved: counts.resolved === counts.total,
      hasIssues: counts.failed > 0 || counts.missing > 0,
    };
  });
