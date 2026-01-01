"use client";

import { StemManagementContent } from "@/components/stems/StemManagementContent";

/**
 * Inspector view for the Stems section.
 * Shows stem import and management controls.
 */
export function StemsInspector() {
  return (
    <div className="p-2">
      <StemManagementContent />
    </div>
  );
}
