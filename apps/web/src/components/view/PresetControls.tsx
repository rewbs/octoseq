"use client";

import { useState } from "react";
import { Bookmark, Trash2 } from "lucide-react";
import { useViewStore } from "@/lib/streams";

/**
 * Minimal named-view presets (Phase 2, U2/U8-lite): save the current
 * compared-streams + analysis + panel visibility under a name; re-apply or
 * delete from a dropdown. Persisted via project uiState.
 */
export function PresetControls() {
  const presets = useViewStore((s) => s.presets);
  const savePreset = useViewStore((s) => s.savePreset);
  const applyPreset = useViewStore((s) => s.applyPreset);
  const deletePreset = useViewStore((s) => s.deletePreset);
  const comparedCount = useViewStore((s) => s.comparedStreamIds.size);

  const [selectedId, setSelectedId] = useState<string>("");

  const handleSave = () => {
    const name = window.prompt("Preset name", `View ${presets.length + 1}`);
    if (!name || name.trim().length === 0) return;
    const id = savePreset(name.trim());
    setSelectedId(id);
  };

  const handleApply = (id: string) => {
    setSelectedId(id);
    if (id) applyPreset(id);
  };

  const handleDelete = () => {
    if (!selectedId) return;
    deletePreset(selectedId);
    setSelectedId("");
  };

  if (presets.length === 0 && comparedCount === 0) return null;

  return (
    <div className="flex items-center gap-1.5 text-xs text-zinc-600 dark:text-zinc-400">
      <span className="hidden sm:inline">View:</span>
      <select
        value={selectedId}
        onChange={(e) => handleApply(e.target.value)}
        className="rounded border border-zinc-300 bg-white px-1.5 py-0.5 text-xs dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100"
        title="Apply a saved view preset"
      >
        <option value="">— preset —</option>
        {presets.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      <button
        onClick={handleSave}
        title="Save current view as preset"
        className="inline-flex items-center gap-1 rounded border border-zinc-300 px-1.5 py-0.5 hover:bg-zinc-100 dark:border-zinc-600 dark:hover:bg-zinc-800"
      >
        <Bookmark className="h-3 w-3" />
        Save
      </button>
      {selectedId && (
        <button
          onClick={handleDelete}
          title="Delete selected preset"
          className="inline-flex items-center rounded border border-zinc-300 px-1 py-0.5 hover:bg-zinc-100 dark:border-zinc-600 dark:hover:bg-zinc-800"
        >
          <Trash2 className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}
