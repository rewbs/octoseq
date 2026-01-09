"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, X, GripVertical, ChevronDown, ChevronRight } from "lucide-react";
import { useState, useCallback } from "react";
import {
  TRANSFORM_LABELS,
  type TransformStep,
  type TransformChain,
  type TransformSmooth,
  type TransformNormalize,
  type TransformScale,
  type TransformPolarity,
  type TransformClamp,
  type TransformRemap,
} from "@/lib/stores/types/derivedSignal";

interface TransformChainEditorProps {
  transforms: TransformChain;
  onChange: (transforms: TransformChain) => void;
}

// Default values for new transforms
function createDefaultTransform(kind: TransformStep["kind"]): TransformStep {
  switch (kind) {
    case "smooth":
      return { kind: "smooth", algorithm: "movingAverage", windowMs: 50 };
    case "normalize":
      return { kind: "normalize", method: "minMax", targetMin: 0, targetMax: 1 };
    case "scale":
      return { kind: "scale", scale: 1, offset: 0 };
    case "polarity":
      return { kind: "polarity", mode: "signed" };
    case "clamp":
      return { kind: "clamp", min: 0, max: 1 };
    case "remap":
      return { kind: "remap", inputMin: 0, inputMax: 1, outputMin: 0, outputMax: 1, curve: 1 };
  }
}

/**
 * Editor for transform chains.
 * Allows adding, removing, reordering, and configuring transforms.
 */
export function TransformChainEditor({ transforms, onChange }: TransformChainEditorProps) {
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);

  const handleAddTransform = (kind: TransformStep["kind"]) => {
    const newTransform = createDefaultTransform(kind);
    onChange([...transforms, newTransform]);
    setExpandedIndex(transforms.length);
  };

  const handleRemoveTransform = (index: number) => {
    const newTransforms = transforms.filter((_, i) => i !== index);
    onChange(newTransforms);
    if (expandedIndex === index) {
      setExpandedIndex(null);
    } else if (expandedIndex !== null && expandedIndex > index) {
      setExpandedIndex(expandedIndex - 1);
    }
  };

  const handleUpdateTransform = (index: number, updates: Partial<TransformStep>) => {
    const newTransforms = transforms.map((t, i) =>
      i === index ? { ...t, ...updates } as TransformStep : t
    );
    onChange(newTransforms);
  };

  const handleMoveTransform = useCallback(
    (fromIndex: number, toIndex: number) => {
      if (fromIndex === toIndex) return;
      const newTransforms = [...transforms];
      const [moved] = newTransforms.splice(fromIndex, 1);
      newTransforms.splice(toIndex, 0, moved!);
      onChange(newTransforms);
      if (expandedIndex === fromIndex) {
        setExpandedIndex(toIndex);
      }
    },
    [transforms, onChange, expandedIndex]
  );

  const handleDragStart = (e: React.DragEvent, index: number) => {
    setDraggedIndex(index);
    e.dataTransfer.effectAllowed = "move";
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (draggedIndex !== null && draggedIndex !== index) {
      handleMoveTransform(draggedIndex, index);
      setDraggedIndex(index);
    }
  };

  const handleDragEnd = () => {
    setDraggedIndex(null);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-medium">Transform Chain</h4>
        <div className="relative">
          <select
            onChange={(e) => {
              if (e.target.value) {
                handleAddTransform(e.target.value as TransformStep["kind"]);
                e.target.value = "";
              }
            }}
            className="h-7 appearance-none rounded-md border border-zinc-300 bg-white pl-7 pr-2 text-xs dark:border-zinc-600 dark:bg-zinc-800"
            defaultValue=""
          >
            <option value="" disabled>
              Add...
            </option>
            {(Object.keys(TRANSFORM_LABELS) as TransformStep["kind"][]).map((kind) => (
              <option key={kind} value={kind}>
                {TRANSFORM_LABELS[kind]}
              </option>
            ))}
          </select>
          <Plus className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500" />
        </div>
      </div>

      {transforms.length === 0 ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          No transforms. Signal passes through unchanged.
        </p>
      ) : (
        <div className="space-y-1">
          {transforms.map((transform, index) => (
            <div
              key={index}
              className={`rounded-md border ${
                draggedIndex === index
                  ? "border-blue-500 bg-blue-50 dark:bg-blue-950/20"
                  : "border-zinc-200 dark:border-zinc-700"
              }`}
              draggable
              onDragStart={(e) => handleDragStart(e, index)}
              onDragOver={(e) => handleDragOver(e, index)}
              onDragEnd={handleDragEnd}
            >
              {/* Transform header */}
              <div
                className="flex cursor-pointer items-center gap-1 p-2 hover:bg-zinc-50 dark:hover:bg-zinc-800"
                onClick={() => setExpandedIndex(expandedIndex === index ? null : index)}
              >
                <GripVertical className="h-4 w-4 cursor-grab text-zinc-400" />
                <span className="mr-1 text-xs text-zinc-400">{index + 1}.</span>
                {expandedIndex === index ? (
                  <ChevronDown className="h-4 w-4 text-zinc-400" />
                ) : (
                  <ChevronRight className="h-4 w-4 text-zinc-400" />
                )}
                <span className="flex-1 text-sm font-medium">{TRANSFORM_LABELS[transform.kind]}</span>
                <span className="text-xs text-zinc-500 dark:text-zinc-400">
                  {getTransformSummary(transform)}
                </span>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-6 w-6"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleRemoveTransform(index);
                  }}
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>

              {/* Transform params */}
              {expandedIndex === index && (
                <div className="border-t border-zinc-200 p-3 dark:border-zinc-700">
                  <TransformParams
                    transform={transform}
                    onChange={(updates) => handleUpdateTransform(index, updates)}
                  />
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Get a short summary of transform parameters.
 */
function getTransformSummary(transform: TransformStep): string {
  switch (transform.kind) {
    case "smooth":
      if (transform.algorithm === "exponential") {
        return `${transform.algorithm} (${transform.timeConstantMs ?? 50}ms)`;
      }
      return `${transform.algorithm} (${transform.windowMs ?? 50}ms)`;
    case "normalize":
      return `${transform.method} → ${transform.targetMin ?? 0}-${transform.targetMax ?? 1}`;
    case "scale":
      return `×${transform.scale} + ${transform.offset}`;
    case "polarity":
      return transform.mode;
    case "clamp":
      return `${transform.min} – ${transform.max}`;
    case "remap":
      return `${transform.inputMin}-${transform.inputMax} → ${transform.outputMin}-${transform.outputMax}`;
  }
}

interface TransformParamsProps {
  transform: TransformStep;
  onChange: (updates: Partial<TransformStep>) => void;
}

/**
 * Parameter editor for individual transform types.
 */
function TransformParams({ transform, onChange }: TransformParamsProps) {
  switch (transform.kind) {
    case "smooth":
      return <SmoothParams transform={transform} onChange={onChange} />;
    case "normalize":
      return <NormalizeParams transform={transform} onChange={onChange} />;
    case "scale":
      return <ScaleParams transform={transform} onChange={onChange} />;
    case "polarity":
      return <PolarityParams transform={transform} onChange={onChange} />;
    case "clamp":
      return <ClampParams transform={transform} onChange={onChange} />;
    case "remap":
      return <RemapParams transform={transform} onChange={onChange} />;
    default:
      return null;
  }
}

function SmoothParams({
  transform,
  onChange,
}: {
  transform: TransformSmooth;
  onChange: (updates: Partial<TransformSmooth>) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <label className="w-20 text-sm">Algorithm</label>
        <select
          value={transform.algorithm}
          onChange={(e) => onChange({ algorithm: e.target.value as TransformSmooth["algorithm"] })}
          className="flex-1 rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-zinc-600 dark:bg-zinc-800"
        >
          <option value="movingAverage">Moving Average</option>
          <option value="exponential">Exponential</option>
          <option value="gaussian">Gaussian</option>
        </select>
      </div>
      {transform.algorithm === "exponential" ? (
        <div className="flex items-center gap-2">
          <label className="w-20 text-sm">Time Const</label>
          <Input
            type="number"
            value={transform.timeConstantMs ?? 50}
            onChange={(e) => onChange({ timeConstantMs: Number(e.target.value) })}
            className="w-20"
            min={1}
          />
          <span className="text-sm text-zinc-500">ms</span>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <label className="w-20 text-sm">Window</label>
          <Input
            type="number"
            value={transform.windowMs ?? 50}
            onChange={(e) => onChange({ windowMs: Number(e.target.value) })}
            className="w-20"
            min={1}
          />
          <span className="text-sm text-zinc-500">ms</span>
        </div>
      )}
    </div>
  );
}

function NormalizeParams({
  transform,
  onChange,
}: {
  transform: TransformNormalize;
  onChange: (updates: Partial<TransformNormalize>) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <label className="w-20 text-sm">Method</label>
        <select
          value={transform.method}
          onChange={(e) => onChange({ method: e.target.value as TransformNormalize["method"] })}
          className="flex-1 rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-zinc-600 dark:bg-zinc-800"
        >
          <option value="minMax">Min-Max</option>
          <option value="robust">Robust (Percentile)</option>
          <option value="zScore">Z-Score</option>
        </select>
      </div>
      {transform.method === "robust" && (
        <div className="flex items-center gap-2">
          <label className="w-20 text-sm">Percentiles</label>
          <Input
            type="number"
            value={transform.percentileLow ?? 5}
            onChange={(e) => onChange({ percentileLow: Number(e.target.value) })}
            className="w-16"
            min={0}
            max={50}
          />
          <span className="text-sm text-zinc-500">–</span>
          <Input
            type="number"
            value={transform.percentileHigh ?? 95}
            onChange={(e) => onChange({ percentileHigh: Number(e.target.value) })}
            className="w-16"
            min={50}
            max={100}
          />
        </div>
      )}
      <div className="flex items-center gap-2">
        <label className="w-20 text-sm">Target</label>
        <Input
          type="number"
          value={transform.targetMin ?? 0}
          onChange={(e) => onChange({ targetMin: Number(e.target.value) })}
          className="w-16"
          step={0.1}
        />
        <span className="text-sm text-zinc-500">–</span>
        <Input
          type="number"
          value={transform.targetMax ?? 1}
          onChange={(e) => onChange({ targetMax: Number(e.target.value) })}
          className="w-16"
          step={0.1}
        />
      </div>
    </div>
  );
}

function ScaleParams({
  transform,
  onChange,
}: {
  transform: TransformScale;
  onChange: (updates: Partial<TransformScale>) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <label className="w-20 text-sm">Scale</label>
        <Input
          type="number"
          value={transform.scale}
          onChange={(e) => onChange({ scale: Number(e.target.value) })}
          className="w-24"
          step={0.1}
        />
      </div>
      <div className="flex items-center gap-2">
        <label className="w-20 text-sm">Offset</label>
        <Input
          type="number"
          value={transform.offset}
          onChange={(e) => onChange({ offset: Number(e.target.value) })}
          className="w-24"
          step={0.1}
        />
      </div>
      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        output = input × scale + offset
      </p>
    </div>
  );
}

function PolarityParams({
  transform,
  onChange,
}: {
  transform: TransformPolarity;
  onChange: (updates: Partial<TransformPolarity>) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <label className="w-20 text-sm">Mode</label>
      <select
        value={transform.mode}
        onChange={(e) => onChange({ mode: e.target.value as TransformPolarity["mode"] })}
        className="flex-1 rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-zinc-600 dark:bg-zinc-800"
      >
        <option value="signed">Signed (keep negatives)</option>
        <option value="magnitude">Magnitude (abs value)</option>
      </select>
    </div>
  );
}

function ClampParams({
  transform,
  onChange,
}: {
  transform: TransformClamp;
  onChange: (updates: Partial<TransformClamp>) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <label className="w-20 text-sm">Range</label>
      <Input
        type="number"
        value={transform.min}
        onChange={(e) => onChange({ min: Number(e.target.value) })}
        className="w-20"
        step={0.1}
      />
      <span className="text-sm text-zinc-500">–</span>
      <Input
        type="number"
        value={transform.max}
        onChange={(e) => onChange({ max: Number(e.target.value) })}
        className="w-20"
        step={0.1}
      />
    </div>
  );
}

function RemapParams({
  transform,
  onChange,
}: {
  transform: TransformRemap;
  onChange: (updates: Partial<TransformRemap>) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <label className="w-20 text-sm">Input</label>
        <Input
          type="number"
          value={transform.inputMin}
          onChange={(e) => onChange({ inputMin: Number(e.target.value) })}
          className="w-16"
          step={0.1}
        />
        <span className="text-sm text-zinc-500">–</span>
        <Input
          type="number"
          value={transform.inputMax}
          onChange={(e) => onChange({ inputMax: Number(e.target.value) })}
          className="w-16"
          step={0.1}
        />
      </div>
      <div className="flex items-center gap-2">
        <label className="w-20 text-sm">Output</label>
        <Input
          type="number"
          value={transform.outputMin}
          onChange={(e) => onChange({ outputMin: Number(e.target.value) })}
          className="w-16"
          step={0.1}
        />
        <span className="text-sm text-zinc-500">–</span>
        <Input
          type="number"
          value={transform.outputMax}
          onChange={(e) => onChange({ outputMax: Number(e.target.value) })}
          className="w-16"
          step={0.1}
        />
      </div>
      <div className="flex items-center gap-2">
        <label className="w-20 text-sm">Curve</label>
        <Input
          type="number"
          value={transform.curve ?? 1}
          onChange={(e) => onChange({ curve: Number(e.target.value) })}
          className="w-20"
          step={0.1}
          min={0.1}
        />
        <span className="text-xs text-zinc-500 dark:text-zinc-400">
          (1 = linear, {">"} 1 = ease-in, {"<"} 1 = ease-out)
        </span>
      </div>
    </div>
  );
}
