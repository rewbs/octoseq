'use client';

import { useState, useEffect } from 'react';
import { FolderOpen, Loader2, Calendar, Globe, Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { listMyProjects, loadProjectWorkingState } from '@/lib/actions/project';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

interface MyProject {
  id: string;
  name: string;
  isPublic: boolean;
  createdAt: Date;
  updatedAt: Date;
  workingState: {
    updatedAt: Date;
  } | null;
}

interface LoadedProject {
  id: string;
  name: string;
  ownerId: string;
  isPublic: boolean;
  workingState: Record<string, unknown> | null;
}

interface MyProjectsModalProps {
  /** Whether modal is open */
  open: boolean;
  /** Callback to change open state */
  onOpenChange: (open: boolean) => void;
  /** Called after a project is successfully loaded */
  onProjectLoaded: (project: LoadedProject) => void;
}

// -----------------------------------------------------------------------------
// Component
// -----------------------------------------------------------------------------

export function MyProjectsModal({ open, onOpenChange, onProjectLoaded }: MyProjectsModalProps) {
  const [projects, setProjects] = useState<MyProject[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingProject, setLoadingProject] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Fetch projects when modal opens
  useEffect(() => {
    if (!open) return;

    const fetchProjects = async () => {
      setLoading(true);
      setError(null);

      try {
        const result = await listMyProjects();

        if (result?.data?.projects) {
          setProjects(result.data.projects as MyProject[]);
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

  const handleLoad = async (project: MyProject) => {
    setLoadingProject(project.id);
    setError(null);

    try {
      const result = await loadProjectWorkingState({ projectId: project.id });

      if (result?.data) {
        onOpenChange(false);
        onProjectLoaded({
          id: result.data.project.id,
          name: result.data.project.name,
          ownerId: result.data.project.ownerId,
          isPublic: result.data.project.isPublic,
          workingState: result.data.workingState as Record<string, unknown> | null,
        });
      } else if (result?.serverError) {
        setError(result.serverError);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load project');
    } finally {
      setLoadingProject(null);
    }
  };

  const formatDate = (date: Date) => {
    return new Date(date).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const getLastSaved = (project: MyProject) => {
    if (project.workingState?.updatedAt) {
      return formatDate(project.workingState.updatedAt);
    }
    return 'Never saved';
  };

  return (
    <Modal title="My Projects" open={open} onOpenChange={onOpenChange}>
      <p className="text-sm text-zinc-600 dark:text-zinc-400 mb-4">
        Select a project to load:
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
          <p>You don&apos;t have any saved projects yet.</p>
          <p className="text-xs mt-2">Create a project and save it to the cloud to see it here.</p>
        </div>
      ) : (
        <div className="grid gap-2 max-h-[60vh] overflow-y-auto">
          {projects.map((project) => (
            <button
              key={project.id}
              onClick={() => void handleLoad(project)}
              disabled={loadingProject !== null}
              className="flex items-start justify-between w-full px-4 py-3 text-left rounded-lg border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  {loadingProject === project.id ? (
                    <Loader2 className="h-4 w-4 animate-spin text-zinc-400 shrink-0" />
                  ) : (
                    <FolderOpen className="h-4 w-4 text-zinc-400 shrink-0" />
                  )}
                  <span className="truncate font-medium">{project.name}</span>
                  {project.isPublic ? (
                    <span title="Public">
                      <Globe className="h-3 w-3 text-emerald-500 shrink-0" />
                    </span>
                  ) : (
                    <span title="Private">
                      <Lock className="h-3 w-3 text-zinc-400 shrink-0" />
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-4 mt-1 text-xs text-zinc-500 dark:text-zinc-400 ml-6">
                  <span className="flex items-center gap-1">
                    <Calendar className="h-3 w-3" />
                    {getLastSaved(project)}
                  </span>
                </div>
              </div>
              <span className="text-xs text-zinc-400 ml-2 shrink-0">
                {loadingProject === project.id ? 'Loading...' : 'Load'}
              </span>
            </button>
          ))}
        </div>
      )}
    </Modal>
  );
}
