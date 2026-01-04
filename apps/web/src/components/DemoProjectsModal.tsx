'use client';

import { useState, useEffect } from 'react';
import { Rocket, FolderOpen, Loader2, User, Calendar } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { listPublicProjects, cloneProject } from '@/lib/actions/project';
import { DEMO_PROJECT_IDS } from '@/lib/demoProjects';

interface DemoProject {
  id: string;
  name: string;
  ownerId: string;
  createdAt: Date;
  updatedAt: Date;
  owner: {
    firstName: string | null;
    lastName: string | null;
    imageUrl: string | null;
  } | null;
}

interface DemoProjectsModalProps {
  /** Called after a project is successfully cloned */
  onProjectCloned: (project: { id: string; name: string }) => void;
}

export function DemoProjectsModal({ onProjectCloned }: DemoProjectsModalProps) {
  const [open, setOpen] = useState(false);
  const [projects, setProjects] = useState<DemoProject[]>([]);
  const [loading, setLoading] = useState(false);
  const [cloning, setCloning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Fetch projects when modal opens
  useEffect(() => {
    if (!open) return;

    const fetchProjects = async () => {
      setLoading(true);
      setError(null);

      try {
        const result = await listPublicProjects();

        if (result?.data?.projects) {
          let projectList = result.data.projects as DemoProject[];

          // Filter to demo projects if IDs are configured
          if (DEMO_PROJECT_IDS.length > 0) {
            const demoIdSet = new Set(DEMO_PROJECT_IDS);
            projectList = projectList.filter((p) => demoIdSet.has(p.id));
          }

          setProjects(projectList);
        } else if (result?.serverError) {
          setError(result.serverError);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load projects');
      } finally {
        setLoading(false);
      }
    };

    void fetchProjects();
  }, [open]);

  const handleClone = async (project: DemoProject) => {
    setCloning(project.id);
    setError(null);

    try {
      const result = await cloneProject({
        sourceProjectId: project.id,
      });

      if (result?.data?.project) {
        setOpen(false);
        onProjectCloned({
          id: result.data.project.id,
          name: result.data.project.name,
        });
      } else if (result?.serverError) {
        setError(result.serverError);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to clone project');
    } finally {
      setCloning(null);
    }
  };

  const formatDate = (date: Date) => {
    return new Date(date).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  const getOwnerName = (owner: DemoProject['owner']) => {
    if (!owner) return 'Unknown';
    const parts = [owner.firstName, owner.lastName].filter(Boolean);
    return parts.length > 0 ? parts.join(' ') : 'Unknown';
  };

  return (
    <>
      <Button className='animate-pulse-glow-blue' size="sm" variant="outline" onClick={() => setOpen(true)}>
        <Rocket className="h-2 w-2 mr-1" />
        Demos
      </Button>

      <Modal title="Demo Projects" open={open} onOpenChange={setOpen}>
        <p className="text-sm text-zinc-600 dark:text-zinc-400 mb-4">
          Select a demo project to clone into your workspace:
        </p>

        {error && (
          <div className="mb-4 p-3 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 text-sm">
            {error}
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-zinc-400" />
            <span className="ml-2 text-zinc-500">Loading projects...</span>
          </div>
        ) : projects.length === 0 ? (
          <div className="text-center py-8 text-zinc-500">
            No demo projects available yet.
          </div>
        ) : (
          <div className="grid gap-3 max-h-[60vh] overflow-y-auto">
            {projects.map((project) => (
              <button
                key={project.id}
                onClick={() => void handleClone(project)}
                disabled={cloning !== null}
                className="flex items-start justify-between w-full px-4 py-3 text-left rounded-lg border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    {cloning === project.id ? (
                      <Loader2 className="h-4 w-4 animate-spin text-zinc-400 shrink-0" />
                    ) : (
                      <FolderOpen className="h-4 w-4 text-zinc-400 shrink-0" />
                    )}
                    <span className="truncate font-medium">{project.name}</span>
                  </div>
                  <div className="flex items-center gap-4 mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                    <span className="flex items-center gap-1">
                      <User className="h-3 w-3" />
                      {getOwnerName(project.owner)}
                    </span>
                    <span className="flex items-center gap-1">
                      <Calendar className="h-3 w-3" />
                      {formatDate(project.updatedAt)}
                    </span>
                  </div>
                </div>
                <span className="text-xs text-zinc-400 ml-2 shrink-0">
                  {cloning === project.id ? 'Cloning...' : 'Clone'}
                </span>
              </button>
            ))}
          </div>
        )}
      </Modal>
    </>
  );
}
