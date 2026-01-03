"use client";

import { CandidateEventsContent } from "@/components/candidates/CandidateEventsContent";
import { useAudioInputStore } from "@/lib/stores/audioInputStore";

/**
 * Inspector view for Candidate Events.
 * Shows generation controls, filters, and stream list.
 */
export function CandidateEventsInspector() {
  const audioDuration = useAudioInputStore((s) => s.getAudioDuration());

  return (
    <div className="p-2">
      <CandidateEventsContent audioDuration={audioDuration} />
    </div>
  );
}
