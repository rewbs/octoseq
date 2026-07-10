export interface AssetAccessRecord {
  ownerId: string | null;
  projects: Array<{
    project: {
      ownerId: string;
      isPublic: boolean;
    };
  }>;
  snapshots?: Array<{
    snapshot: {
      project: {
        ownerId: string;
        isPublic: boolean;
      };
    };
  }>;
}

/** Asset reads are allowed to the uploader, owners of referencing projects, and everyone for public projects. */
export function canReadAsset(userId: string | null, asset: AssetAccessRecord): boolean {
  if (userId && asset.ownerId === userId) return true;
  const canReadProject = (project: { ownerId: string; isPublic: boolean }) =>
    project.isPublic || Boolean(userId && project.ownerId === userId);
  return (
    asset.projects.some(({ project }) => canReadProject(project)) ||
    (asset.snapshots?.some(({ snapshot }) => canReadProject(snapshot.project)) ?? false)
  );
}
