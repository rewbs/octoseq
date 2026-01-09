'use client';

import { useState } from 'react';
import { Eye, Copy, Cloud, CloudOff, Check, Loader2, AlertCircle, Upload, FolderOpen } from 'lucide-react';
import Link from 'next/link';
import { SignedOut, SignInButton, SignedIn, UserButton } from '@clerk/nextjs';
import { Button } from '@/components/ui/button';
import { cloneProject, createProject } from '@/lib/actions/project';
import { MyProjectsModal } from './MyProjectsModal';
import { DemoProjectsModal } from '@/components/DemoProjectsModal';
import type { ServerAutosaveStatus } from '@/lib/hooks/useServerAutosave';
import Image from 'next/image';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

interface LoadedProject {
  id: string;
  name: string;
  ownerId: string;
  isPublic: boolean;
  workingState: Record<string, unknown> | null;
}

interface ProjectHeaderProps {
  /** Project name */
  projectName: string;
  /** Whether the current user owns the project */
  isOwner: boolean;
  /** Whether server sync is enabled */
  isServerSyncEnabled: boolean;
  /** Server autosave status */
  serverStatus: ServerAutosaveStatus;
  /** Last saved timestamp */
  lastSavedAt: string | null;
  /** Backend project ID (for cloning) */
  backendProjectId: string | null;
  /** Whether user is signed in */
  isSignedIn: boolean;
  /** Callback when project is cloned */
  onCloned?: (project: { id: string; name: string }) => void;
  /** Callback when project is saved to cloud */
  onSaveToCloud?: (project: { id: string; name: string }) => void;
  /** Callback when a project is loaded from the server */
  onLoadProject?: (project: LoadedProject) => void;
  /** Callback when a demo project is cloned */
  onDemoProjectCloned?: (project: { id: string; name: string }) => void;
}

// -----------------------------------------------------------------------------
// Save Status Indicator
// -----------------------------------------------------------------------------

function SaveStatusIndicator({
  isOwner,
  isServerSyncEnabled,
  serverStatus,
}: Pick<ProjectHeaderProps, 'isOwner' | 'isServerSyncEnabled' | 'serverStatus'>) {
  if (!isServerSyncEnabled) {
    return (
      <div className="flex items-center gap-1.5 text-xs text-zinc-500">
        <CloudOff className="h-3.5 w-3.5" />
        <span>Local only</span>
      </div>
    );
  }

  if (!isOwner) {
    return (
      <div className="flex items-center gap-1.5 text-xs text-zinc-500">
        <Eye className="h-3.5 w-3.5" />
        <span>Read-only</span>
      </div>
    );
  }

  switch (serverStatus) {
    case 'saving':
      return (
        <div className="flex items-center gap-1.5 text-xs text-zinc-500">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          <span>Saving...</span>
        </div>
      );
    case 'saved':
      return (
        <div className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400">
          <Check className="h-3.5 w-3.5" />
          <span>Saved</span>
        </div>
      );
    case 'error':
      return (
        <div className="flex items-center gap-1.5 text-xs text-red-600 dark:text-red-400">
          <AlertCircle className="h-3.5 w-3.5" />
          <span>Save failed</span>
        </div>
      );
    default:
      return (
        <div className="flex items-center gap-1.5 text-xs text-zinc-500">
          <Cloud className="h-3.5 w-3.5" />
          <span>Synced</span>
        </div>
      );
  }
}

// -----------------------------------------------------------------------------
// Save to Cloud Button
// -----------------------------------------------------------------------------

function SaveToCloudButton({
  projectName,
  onSaveToCloud,
}: {
  projectName: string;
  onSaveToCloud?: (project: { id: string; name: string }) => void;
}) {
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSaveToCloud = async () => {
    setIsSaving(true);
    setError(null);

    try {
      const result = await createProject({ name: projectName });

      if (result?.data?.project) {
        onSaveToCloud?.({
          id: result.data.project.id,
          name: result.data.project.name,
        });
      } else if (result?.serverError) {
        setError(result.serverError);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="flex items-center gap-2">
      <Button
        size="sm"
        variant="outline"
        onClick={() => void handleSaveToCloud()}
        disabled={isSaving}
        className="h-7 text-xs"
      >
        {isSaving ? (
          <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
        ) : (
          <Upload className="h-3.5 w-3.5 mr-1.5" />
        )}
        {isSaving ? 'Saving...' : 'Save Project'}
      </Button>
      {error && <span className="text-xs text-red-600 dark:text-red-400">{error}</span>}
    </div>
  );
}

// -----------------------------------------------------------------------------
// Read-Only Banner
// -----------------------------------------------------------------------------

function ReadOnlyBanner({
  backendProjectId,
  onCloned,
}: Pick<ProjectHeaderProps, 'backendProjectId' | 'onCloned'>) {
  const [isCloning, setIsCloning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleClone = async () => {
    if (!backendProjectId) return;

    setIsCloning(true);
    setError(null);

    try {
      const result = await cloneProject({ sourceProjectId: backendProjectId });

      if (result?.data?.project) {
        onCloned?.({
          id: result.data.project.id,
          name: result.data.project.name,
        });
      } else if (result?.serverError) {
        setError(result.serverError);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to clone');
    } finally {
      setIsCloning(false);
    }
  };

  return (
    <div className="flex items-center gap-3 px-3 py-2 bg-amber-50 dark:bg-amber-900/20 border-b border-amber-200 dark:border-amber-800">

      <div className="flex items-center gap-2 text-amber-700 dark:text-amber-300">
        <Eye className="h-4 w-4" />
        <span className="text-sm font-medium">Viewing read-only project</span>
      </div>
      <Button
        size="sm"
        variant="outline"
        onClick={() => void handleClone()}
        disabled={isCloning || !backendProjectId}
        className="ml-auto"
      >
        {isCloning ? (
          <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
        ) : (
          <Copy className="h-4 w-4 mr-1.5" />
        )}
        {isCloning ? 'Cloning...' : 'Clone to edit'}
      </Button>
      {error && <span className="text-xs text-red-600 dark:text-red-400">{error}</span>}
    </div>
  );
}

// -----------------------------------------------------------------------------
// Main Component
// -----------------------------------------------------------------------------

export function ProjectHeader({
  projectName,
  isOwner,
  isServerSyncEnabled,
  serverStatus,
  backendProjectId,
  isSignedIn,
  onCloned,
  onSaveToCloud,
  onLoadProject,
  onDemoProjectCloned,
}: ProjectHeaderProps) {
  const [showMyProjects, setShowMyProjects] = useState(false);

  // Show "Save to cloud" button when local-only and user is signed in
  const showSaveToCloud = !isServerSyncEnabled && isSignedIn;

  return (
    <div className="flex flex-col">
      {/* Read-only banner for non-owners */}
      {isServerSyncEnabled && !isOwner && (
        <ReadOnlyBanner backendProjectId={backendProjectId} onCloned={onCloned} />
      )}

      {/* Project info bar */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/50 gap-6">
        <div className="relative flex flex-col  items-center justify-center mr-4">
          <Image
            src="/SquidPlain.png"
            alt="Octoseq"
            width={36}
            height={36}
            className="h-14 w-14 rounded-3xl bg-stone-200 p-1 dark:bg-stone-800 hover:scale-125 hover:rotate-180 transition-all"
          />
          <div className="absolute bottom-10 inset-0 flex items-center justify-center  pointer-events-none">
            <p className="w-full text-tiny tracking-[0.25em] font font-mono  text-zinc-900 dark:text-zinc-100 text-shadow-lg text-shadow-stone-500/50 dark:text-shadow-stone-100/50 text-center backdrop-blur-lg backdrop-opacity-20 ">
              octoseq
            </p>
          </div>
          <span className="absolute bottom-0 bg-red-800/60 text-white text-tiny tracking-[0.125em] font font-mono  font-light px-0.5 py-0.125 rounded-sm shadow-sm  pointer-events-none">
            alpha
          </span>
        </div>

        <div className="flex items-center gap-3">
          {/* Load project button - only for signed in users */}
          {(
            <Button
              size="sm"
              variant="outline"
              onClick={() => setShowMyProjects(true)}
              className="h-7 text-xs"
            >
              <FolderOpen className="h-3.5 w-3.5 mr-1.5" />
              Load Project
            </Button>
          )}

          {showSaveToCloud ? (
            <SaveToCloudButton projectName={projectName} onSaveToCloud={onSaveToCloud} />
          ) : (
            <SaveStatusIndicator
              isOwner={isOwner}
              isServerSyncEnabled={isServerSyncEnabled}
              serverStatus={serverStatus}
            />
          )}
        </div>

        {/* Demo projects loader */}
        {onDemoProjectCloned && <DemoProjectsModal onProjectCloned={onDemoProjectCloned} />}


        {/* Right side: About and Auth */}
        <div className="flex items-center gap-2 ml-auto">
          <Link href="https://blog.octoseq.xyz/posts/hello-octoseq" target="_blank">
            <Button size="sm" variant="outline">
              About
            </Button>
          </Link>
          <SignedOut>
            <SignInButton>
              <Button size="sm" className="bg-blue-400 dark:bg-blue-700">Sign In</Button>
            </SignInButton>
          </SignedOut>
          <SignedIn>
            <UserButton />
          </SignedIn>
        </div>
      </div>

      {/* My Projects Modal */}
      <MyProjectsModal
        open={showMyProjects}
        onOpenChange={setShowMyProjects}
        onProjectLoaded={(project) => {
          onLoadProject?.(project);
        }}
      />
    </div>
  );
}
