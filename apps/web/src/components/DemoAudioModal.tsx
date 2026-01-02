"use client";

import { useState } from "react";
import { Music, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { DEMO_AUDIO_FILES, type DemoAudioFile } from "@/lib/demoAudio";

interface DemoAudioModalProps {
  onSelectDemo: (demo: DemoAudioFile) => Promise<void>;
}

export function DemoAudioModal({ onSelectDemo }: DemoAudioModalProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState<string | null>(null);

  const handleSelect = async (demo: DemoAudioFile) => {
    setLoading(demo.path);
    try {
      await onSelectDemo(demo);
      setOpen(false);
    } finally {
      setLoading(null);
    }
  };

  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <Music className="h-4 w-4 mr-1" />
        Demos
      </Button>

      <Modal title="Load Demo Audio" open={open} onOpenChange={setOpen}>
        <p className="text-sm text-zinc-600 dark:text-zinc-400 mb-4">
          Select a demo audio file to load:
        </p>
        <div className="grid gap-2 max-h-[60vh] overflow-y-auto">
          {DEMO_AUDIO_FILES.map((demo) => (
            <button
              key={demo.path}
              onClick={() => void handleSelect(demo)}
              disabled={loading !== null}
              className="flex items-center justify-between w-full px-3 py-2 text-left rounded-lg border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <div className="flex items-center gap-3 min-w-0">
                {loading === demo.path ? (
                  <Loader2 className="h-4 w-4 animate-spin text-zinc-400 shrink-0" />
                ) : (
                  <Music className="h-4 w-4 text-zinc-400 shrink-0" />
                )}
                <span className="truncate font-medium">{demo.name}</span>
              </div>
              <span className="text-xs text-zinc-500 dark:text-zinc-400 ml-2 shrink-0">
                {demo.sizeFormatted}
              </span>
            </button>
          ))}
        </div>
      </Modal>
    </>
  );
}
