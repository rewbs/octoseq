/**
 * Browser download helper for Interpretation Packages.
 */

import type { InterpretationPackageV1 } from "./types";

/**
 * Serialize the package and trigger a browser download named
 * `${projectName || "interpretation"}-package.json`.
 */
export function downloadInterpretationPackage(pkg: InterpretationPackageV1): void {
  const json = JSON.stringify(pkg);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${pkg.projectName || "interpretation"}-package.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    URL.revokeObjectURL(url);
  }
}
