"use client";

import { AuthoredEventsContent } from "@/components/authored/AuthoredEventsContent";
import { useAudioInputStore } from "@/lib/stores/audioInputStore";

/**
 * Inspector view for Authored Events.
 * Shows stream management and creation controls.
 * Import functionality is in the main AuthoredEventsPanel.
 */
export function AuthoredEventsInspector() {
  const audioDuration = useAudioInputStore((s) => s.getAudioDuration());

  return (
    <div className="flex flex-col">
      <div className="p-2">
        <AuthoredEventsContent audioDuration={audioDuration} />
      </div>
    </div>
  );
}
