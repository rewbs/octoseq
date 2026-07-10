"use server";

import { z } from "zod";
import { prisma, AssetStatus } from "@/lib/db";
import {
  assertCanRead,
  assertOwnership,
  authActionLenient,
  authActionModerate,
  authActionStrict,
  publicActionModerate,
} from "@/lib/safe-action";
import { getDbUser } from "@/lib/auth/syncUser";

// -----------------------------------------------------------------------------
// Schemas
// -----------------------------------------------------------------------------

const createProjectSchema = z.object({
  name: z.string().min(1).max(255),
});

const listProjectsSchema = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(100).default(50),
});

const updateProjectVisibilitySchema = z.object({
  projectId: z.string().min(1),
  isPublic: z.boolean(),
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
  expectedRevision: z.number().int().nonnegative(),
  workingJson: z.record(z.string(), jsonValueSchema), // Loosely typed JSON object
});

class SaveConflictError extends Error {}

// -----------------------------------------------------------------------------
// createProject
// Creates a new project for the authenticated user
// -----------------------------------------------------------------------------

export const createProject = authActionStrict
  .schema(createProjectSchema)
  .action(async ({ parsedInput, ctx }) => {
    const { name } = parsedInput;
    const { user } = ctx;

    const project = await prisma.project.create({
      data: {
        name,
        ownerId: user.id,
        isPublic: false,
      },
    });

    return { project };
  });

// -----------------------------------------------------------------------------
// loadProjectWorkingState
// Loads the working state for a project (public projects readable by anyone)
// -----------------------------------------------------------------------------

export const loadProjectWorkingState = publicActionModerate
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
      throw new Error("Project not found");
    }

    // Check read permission
    const user = await getDbUser();
    assertCanRead(user, project.ownerId, project.isPublic, "project");

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
      workingStateRevision: project.workingState?.revision ?? 0,
      workingStateUpdatedAt: project.workingState?.updatedAt ?? null,
      canEdit: user?.id === project.ownerId,
    };
  });

// -----------------------------------------------------------------------------
// autosaveProjectWorkingState
// Saves the working state for a project (owner only)
// -----------------------------------------------------------------------------

export const autosaveProjectWorkingState = authActionLenient
  .schema(autosaveSchema)
  .action(async ({ parsedInput, ctx }) => {
    const { projectId, workingJson, expectedRevision } = parsedInput;
    const { user } = ctx;

    // Get the project to check ownership
    const project = await prisma.project.findUnique({
      where: { id: projectId },
    });

    if (!project) {
      throw new Error("Project not found");
    }

    assertOwnership(user, project.ownerId, "project");

    // Upsert the working state
    // Cast to Prisma-compatible JSON type - the schema already validated structure
    const jsonData = workingJson as Parameters<
      typeof prisma.projectWorkingState.create
    >[0]["data"]["workingJson"];
    const assetIds = extractAssetIds(workingJson);
    const uniqueAssetIds = [...new Set(assetIds)];

    const readableAssets = uniqueAssetIds.length
      ? await prisma.asset.findMany({
          where: {
            id: { in: uniqueAssetIds },
            status: AssetStatus.UPLOADED,
            OR: [
              { ownerId: user.id },
              { projects: { some: { project: { ownerId: user.id } } } },
              { projects: { some: { project: { isPublic: true } } } },
              { snapshots: { some: { snapshot: { project: { ownerId: user.id } } } } },
              { snapshots: { some: { snapshot: { project: { isPublic: true } } } } },
            ],
          },
          select: { id: true },
        })
      : [];

    if (readableAssets.length !== uniqueAssetIds.length) {
      throw new Error("Project references an unavailable asset");
    }

    let workingState;
    try {
      workingState = await prisma.$transaction(async (tx) => {
        const existing = await tx.projectWorkingState.findUnique({ where: { projectId } });
        if (existing) {
          const update = await tx.projectWorkingState.updateMany({
            where: { projectId, revision: expectedRevision },
            data: { workingJson: jsonData, revision: { increment: 1 } },
          });
          if (update.count !== 1) {
            throw new SaveConflictError("Project changed on the server");
          }
        } else {
          if (expectedRevision !== 0) {
            throw new SaveConflictError("Project changed on the server");
          }
          await tx.projectWorkingState.create({
            data: { projectId, workingJson: jsonData, revision: 1 },
          });
        }

        await tx.projectAsset.deleteMany({ where: { projectId } });
        if (uniqueAssetIds.length > 0) {
          await tx.projectAsset.createMany({
            data: uniqueAssetIds.map((assetId) => ({ projectId, assetId })),
            skipDuplicates: true,
          });
        }

        return tx.projectWorkingState.findUniqueOrThrow({ where: { projectId } });
      });
    } catch (error) {
      if (!(error instanceof SaveConflictError)) throw error;
      const current = await prisma.projectWorkingState.findUnique({ where: { projectId } });
      return {
        updatedAt: current?.updatedAt ?? null,
        revision: current?.revision ?? 0,
        conflict: true,
      };
    }

    return {
      updatedAt: workingState.updatedAt,
      revision: workingState.revision,
      conflict: false,
    };
  });

// -----------------------------------------------------------------------------
// listPublicProjects
// Lists all public projects (no auth required)
// -----------------------------------------------------------------------------

export const listPublicProjects = publicActionModerate
  .schema(listProjectsSchema)
  .action(async ({ parsedInput }) => {
    const { cursor, limit } = parsedInput;
    const projects = await prisma.project.findMany({
      where: { isPublic: true },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
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

    const hasMore = projects.length > limit;
    const page = hasMore ? projects.slice(0, limit) : projects;
    return { projects: page, nextCursor: hasMore ? (page.at(-1)?.id ?? null) : null };
  });

// -----------------------------------------------------------------------------
// listMyProjects
// Lists all projects owned by the authenticated user
// -----------------------------------------------------------------------------

export const listMyProjects = authActionLenient
  .schema(listProjectsSchema)
  .action(async ({ parsedInput, ctx }) => {
    const { cursor, limit } = parsedInput;
    const { user } = ctx;

    const projects = await prisma.project.findMany({
      where: { ownerId: user.id },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
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

    const hasMore = projects.length > limit;
    const page = hasMore ? projects.slice(0, limit) : projects;
    return { projects: page, nextCursor: hasMore ? (page.at(-1)?.id ?? null) : null };
  });

export const updateProjectVisibility = authActionModerate
  .schema(updateProjectVisibilitySchema)
  .action(async ({ parsedInput, ctx }) => {
    const { projectId, isPublic } = parsedInput;
    const project = await prisma.project.findUnique({ where: { id: projectId } });
    if (!project) throw new Error("Project not found");
    assertOwnership(ctx.user, project.ownerId, "project");

    const updated = await prisma.project.update({
      where: { id: projectId },
      data: { isPublic },
      select: { id: true, isPublic: true, updatedAt: true },
    });
    return { project: updated };
  });

// -----------------------------------------------------------------------------
// getProjectMetadata
// Gets project metadata (public projects readable by anyone)
// -----------------------------------------------------------------------------

export const getProjectMetadata = publicActionModerate
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
      throw new Error("Project not found");
    }

    // Check read permission
    const user = await getDbUser();
    assertCanRead(user, project.ownerId, project.isPublic, "project");

    return { project };
  });

// -----------------------------------------------------------------------------
// createProjectSnapshot
// Creates an immutable snapshot from the current working state
// Validates that all referenced assets are fully uploaded
// -----------------------------------------------------------------------------

/**
 * Extracts all asset IDs referenced in the project working state.
 * Supports audio assets (audio streams in project.streams) and mesh assets.
 */
function extractAssetIds(workingJson: Record<string, unknown>): string[] {
  const assetIds: string[] = [];

  try {
    const project = workingJson.project as Record<string, unknown> | undefined;
    if (!project) return assetIds;

    // Audio assets: project.streams[] (kind "mixdown" | "stem"),
    // referenced via audio.cloudAssetId (falling back to audio.assetId)
    const streams = project.streams as Array<Record<string, unknown>> | undefined;
    if (Array.isArray(streams)) {
      for (const stream of streams) {
        if (stream?.kind !== "mixdown" && stream?.kind !== "stem") continue;
        const audio = stream.audio as Record<string, unknown> | undefined;
        const assetId = audio?.cloudAssetId ?? audio?.assetId;
        if (assetId && typeof assetId === "string") {
          assetIds.push(assetId);
        }
      }
    }

    // Mesh assets: project.meshAssets.assets[].assetId
    const meshAssets = project.meshAssets as Record<string, unknown> | undefined;
    if (meshAssets) {
      const assets = meshAssets.assets as Array<Record<string, unknown>> | undefined;
      if (Array.isArray(assets)) {
        for (const mesh of assets) {
          const assetId = mesh?.cloudAssetId ?? mesh?.assetId;
          if (assetId && typeof assetId === "string") {
            assetIds.push(assetId);
          }
        }
      }
    }
  } catch {
    // If parsing fails, return empty array - validation will handle appropriately
  }

  return assetIds;
}

export const createProjectSnapshot = authActionModerate
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
      throw new Error("Project not found");
    }

    assertOwnership(user, project.ownerId, "project");

    // Must have a working state to create a snapshot
    if (!project.workingState) {
      throw new Error("No working state to snapshot");
    }

    const workingJson = project.workingState.workingJson as Record<string, unknown>;

    // Extract all asset IDs from the working state
    const assetIds = extractAssetIds(workingJson);

    // Validate all referenced assets exist and are uploaded
    if (assetIds.length > 0) {
      const assets = await prisma.asset.findMany({
        where: {
          id: { in: assetIds },
          OR: [
            { ownerId: user.id },
            { projects: { some: { project: { ownerId: user.id } } } },
            { projects: { some: { project: { isPublic: true } } } },
            { snapshots: { some: { snapshot: { project: { ownerId: user.id } } } } },
            { snapshots: { some: { snapshot: { project: { isPublic: true } } } } },
          ],
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
        const statuses = pendingAssets.map((a) => `${a.id}: ${a.status}`).join(", ");
        throw new Error(
          `Cannot create snapshot: ${pendingAssets.length} asset(s) not fully uploaded (${statuses})`
        );
      }
    }

    // Create the snapshot and retain its asset references atomically.
    const uniqueAssetIds = [...new Set(assetIds)];
    const snapshot = await prisma.$transaction(async (tx) => {
      const created = await tx.projectSnapshot.create({
        data: {
          projectId,
          snapshotJson: workingJson as Parameters<
            typeof tx.projectSnapshot.create
          >[0]["data"]["snapshotJson"],
        },
      });
      if (uniqueAssetIds.length > 0) {
        await tx.projectSnapshotAsset.createMany({
          data: uniqueAssetIds.map((assetId) => ({ snapshotId: created.id, assetId })),
          skipDuplicates: true,
        });
      }
      return created;
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

export const cloneProject = authActionStrict
  .schema(cloneProjectSchema)
  .action(async ({ parsedInput, ctx }) => {
    const { sourceProjectId, name } = parsedInput;
    const { user } = ctx;

    // Get the source project with its latest snapshot
    const sourceProject = await prisma.project.findUnique({
      where: { id: sourceProjectId },
      include: {
        snapshots: {
          orderBy: { createdAt: "desc" },
          take: 1,
          include: { assets: { select: { assetId: true } } },
        },
        workingState: true,
        assets: { select: { assetId: true } },
      },
    });

    if (!sourceProject) {
      throw new Error("Source project not found");
    }

    // Check read permission (public projects can be cloned by anyone)
    assertCanRead(user, sourceProject.ownerId, sourceProject.isPublic, "project");

    // Determine the source JSON: prefer latest snapshot, fall back to working state
    let sourceJson: Record<string, unknown> | null = null;

    const latestSnapshot = sourceProject.snapshots[0];
    let sourceAssetIds: string[];
    if (latestSnapshot) {
      sourceJson = latestSnapshot.snapshotJson as Record<string, unknown>;
      sourceAssetIds = latestSnapshot.assets.map(({ assetId }) => assetId);
    } else if (sourceProject.workingState) {
      sourceJson = sourceProject.workingState.workingJson as Record<string, unknown>;
      sourceAssetIds = sourceProject.assets.map(({ assetId }) => assetId);
    } else {
      sourceAssetIds = [];
    }

    if (!sourceJson) {
      throw new Error("Source project has no content to clone");
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
          >[0]["data"]["workingJson"],
        },
      });

      if (sourceAssetIds.length > 0) {
        await tx.projectAsset.createMany({
          data: sourceAssetIds.map((assetId) => ({
            projectId: newProject.id,
            assetId,
          })),
          skipDuplicates: true,
        });
      }

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
  if (cloned.project && typeof cloned.project === "object") {
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

export const getProjectAssetStatuses = publicActionModerate
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
      throw new Error("Project not found");
    }

    // Check read permission
    const user = await getDbUser();
    assertCanRead(user, project.ownerId, project.isPublic, "project");

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
          asset.status === "UPLOADED"
            ? "resolved"
            : asset.status === "PENDING"
              ? "pending"
              : "failed",
        type: asset.type,
        r2Key: asset.status === "UPLOADED" ? asset.r2Key : undefined,
        error: metadata?.uploadError as string | undefined,
      });
    }

    // Add missing assets
    for (const assetId of assetIds) {
      if (!foundIds.has(assetId)) {
        assetInfos.push({
          assetId,
          status: "missing" as const,
        });
      }
    }

    // Compute counts
    const counts = {
      resolved: assetInfos.filter((a) => a.status === "resolved").length,
      pending: assetInfos.filter((a) => a.status === "pending").length,
      failed: assetInfos.filter((a) => a.status === "failed").length,
      missing: assetInfos.filter((a) => a.status === "missing").length,
      total: assetInfos.length,
    };

    return {
      assets: assetInfos,
      counts,
      allResolved: counts.resolved === counts.total,
      hasIssues: counts.failed > 0 || counts.missing > 0,
    };
  });
