"use client";

import { CandidateEventsContent } from "@/components/candidates/CandidateEventsContent";
import { useStreamStore } from "@/lib/streams";

/**
 * Inspector view for Candidate Events.
 * Shows generation controls, filters, and stream list.
 */
export function CandidateEventsInspector() {
  const audioDuration = useStreamStore((s) => s.getMixdown()?.audio.durationSec ?? 0);

  return (
    <div className="p-2">
      <CandidateEventsContent audioDuration={audioDuration} />
    </div>
  );
}
