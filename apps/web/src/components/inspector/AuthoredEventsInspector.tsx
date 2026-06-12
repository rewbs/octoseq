"use client";

import { AuthoredEventsContent } from "@/components/authored/AuthoredEventsContent";
import { useStreamStore } from "@/lib/streams";

/**
 * Inspector view for Authored Events.
 * Shows stream management and creation controls.
 * Import functionality is in the main AuthoredEventsPanel.
 */
export function AuthoredEventsInspector() {
  const audioDuration = useStreamStore((s) => s.getMixdown()?.audio.durationSec ?? 0);

  return (
    <div className="flex flex-col">
      <div className="p-2">
        <AuthoredEventsContent audioDuration={audioDuration} />
      </div>
    </div>
  );
}
