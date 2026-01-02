"use client";

import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useProjectStore } from "@/lib/stores/projectStore";
import {
  useInterpretationTreeStore,
  TREE_NODE_IDS,
} from "@/lib/stores/interpretationTreeStore";

/**
 * Inspector for the Scripts section.
 * Shows list of all scripts and allows adding new ones.
 */
export function ScriptsInspector() {
  const activeProject = useProjectStore((s) => s.activeProject);
  const addScript = useProjectStore((s) => s.addScript);
  const setActiveScript = useProjectStore((s) => s.setActiveScript);
  const selectNode = useInterpretationTreeStore((s) => s.selectNode);
  const setExpanded = useInterpretationTreeStore((s) => s.setExpanded);

  const scripts = activeProject?.scripts.scripts ?? [];
  const activeScriptId = activeProject?.scripts.activeScriptId;

  const handleAddScript = () => {
    const newId = addScript(`Script ${scripts.length + 1}`);
    if (newId) {
      // Expand the Scripts section and select the new script
      setExpanded(TREE_NODE_IDS.SCRIPTS, true);
      selectNode(`scripts:${newId}`);
      setActiveScript(newId);
    }
  };

  const handleSelectScript = (scriptId: string) => {
    selectNode(`scripts:${scriptId}`);
    setActiveScript(scriptId);
  };

  return (
    <div className="p-2 space-y-3">
      <Button size="sm" variant="outline" className="w-full" onClick={handleAddScript}>
        <Plus className="h-4 w-4 mr-2" />
        Add Script
      </Button>

      {scripts.length === 0 ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          No scripts defined. Add a script to create visualizations using the
          Rhai scripting language.
        </p>
      ) : (
        <div className="space-y-2">
          {scripts.map((script) => (
            <button
              key={script.id}
              type="button"
              onClick={() => handleSelectScript(script.id)}
              className={`w-full text-left p-2 rounded border transition-colors ${
                activeScriptId === script.id
                  ? "border-blue-500 bg-blue-50 dark:bg-blue-950"
                  : "border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800"
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">{script.name}</span>
                {activeScriptId === script.id && (
                  <span className="text-xs bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300 px-1.5 py-0.5 rounded">
                    Active
                  </span>
                )}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
