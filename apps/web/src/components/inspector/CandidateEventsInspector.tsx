"use client";

import { CandidateEventsContent } from "@/components/candidates/CandidateEventsContent";
import { useAudioStore } from "@/lib/stores/audioStore";

/**
 * Inspector view for Candidate Events.
 * Shows generation controls, filters, and stream list.
 */
export function CandidateEventsInspector() {
  const audioDuration = useAudioStore((s) => s.audioDuration);

  return (
    <div className="p-2">
      <CandidateEventsContent audioDuration={audioDuration} />
    </div>
  );
}
