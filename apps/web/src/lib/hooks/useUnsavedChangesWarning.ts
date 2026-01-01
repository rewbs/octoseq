/**
 * Hook to warn users before leaving the page when there are unsaved changes.
 *
 * Uses the browser's beforeunload event to show a confirmation dialog
 * when the user tries to navigate away or close the tab.
 */

import { useEffect } from "react";
import { useProjectStore } from "@/lib/stores/projectStore";

/**
 * Adds a beforeunload warning when the project has unsaved changes.
 * The browser will show a generic confirmation dialog - custom messages
 * are no longer supported for security reasons.
 */
export function useUnsavedChangesWarning() {
  const isDirty = useProjectStore((s) => s.isDirty);
  const hasProject = useProjectStore((s) => s.activeProject !== null);

  useEffect(() => {
    // Only warn if there's an active project with unsaved changes
    if (!hasProject || !isDirty) return;

    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      // Modern browsers ignore custom messages for security reasons,
      // but setting returnValue triggers the browser's default dialog
      e.preventDefault();
      // For older browsers
      e.returnValue = "";
      return "";
    };

    window.addEventListener("beforeunload", handleBeforeUnload);

    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [isDirty, hasProject]);
}
