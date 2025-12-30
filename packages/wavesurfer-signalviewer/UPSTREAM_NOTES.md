# Wavesurfer Plugin Developer Notes

This document records observations about Wavesurfer 8.0's plugin APIs and extensibility points, based on our experience building a custom signal visualization plugin.

**Important context:** WaveSurfer is fundamentally an audio waveform visualization library, and it does that job well. Our use case (visualizing arbitrary time-indexed MIR signals) is outside its core purpose. These notes focus on the plugin API rather than suggesting WaveSurfer should change its core mission.

---

## What Worked Well

### 1. New Plugin Architecture (v8)

The composition-based plugin pattern is clean and well-designed:

```typescript
const MyPlugin = createPlugin<MyOptions>(manifest, (context, options) => {
  // Full access to store, resources, DOM
  return { actions: { ... } };
});
```

**Strengths:**
- Clear separation of concerns (manifest vs. initialization)
- Resource management via `ResourcePool` ensures proper cleanup
- Reactive store subscriptions with `select()` and `selectMany()`
- Debounce/throttle operators on streams

### 2. Store State Access

The reactive state store provides everything needed to stay synchronized:

```typescript
store.select((state) => ({
  minPxPerSec: state.view.minPxPerSec,
  scrollLeft: state.view.scrollLeft,
  containerWidth: state.view.containerWidth,
  duration: state.audio.duration,
})).subscribe((view) => render(view));
```

This allowed us to keep our custom visualizations perfectly aligned with the main waveform during zoom and scroll.

### 3. DOM Insertion Points

Access to the waveform wrapper via `getWrapper()` allows sensible positioning of plugin DOM elements:

```typescript
const wrapper = getWrapper();
wrapper.parentElement?.insertBefore(container, wrapper.nextSibling);
```

### 4. Clean Lifecycle Management

The `resources.addCleanup()` pattern makes it easy to ensure proper teardown:

```typescript
resources.addCleanup(() => {
  container.remove();
  subscription.unsubscribe();
});
```

---

## Suggestions for Plugin API Improvements

These are minor improvements that would make plugin development smoother, without changing WaveSurfer's core focus.

### 1. Plugin Rendering Order / Z-Index Control

**Observation:** There's no built-in way to control z-index relative to the main waveform or other plugins.

**Current approach:** We use CSS `z-index` on our plugin container.

**Suggestion:** Consider documenting recommended z-index ranges for plugins, or allowing an optional `zIndex` field in the manifest.

### 2. Shared Event Coordinates

**Observation:** Each plugin must compute time coordinates from mouse events independently:

```typescript
container.addEventListener("mousemove", (e) => {
  const rect = container.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const time = startTime + (x / rect.width) * (endTime - startTime);
  // ...
});
```

**Suggestion:** Consider a utility function or event wrapper that provides pre-computed time coordinates, e.g.:

```typescript
// Hypothetical helper
context.onHover((event) => {
  const { time, x, y } = event; // time already computed
});
```

### 3. Playhead Position Stream

**Observation:** `store.select((s) => s.playback.currentTime)` works but may not update at animation-frame rate during playback.

**Suggestion:** Document the expected update frequency, or provide guidance on using `requestAnimationFrame` for smooth cursor tracking during playback.

### 4. Computed Peaks Access

**Observation:** While `getDecodedData()` provides the raw `AudioBuffer`, there's no way to access the computed peaks array used for the waveform rendering.

**Why it matters for plugins:** A plugin that wants to overlay annotations aligned to the exact visual waveform shape must recompute peaks independently.

**Suggestion:** Consider exposing the peaks via `store.select((s) => s.audio.peaks)` or a getter, to allow plugins to align with the rendered waveform.

---

## TypeScript Integration Notes

### Type Exports

The v8 plugin types are well-designed but require importing from the main module:

```typescript
import type {
  Plugin,
  PluginManifest,
  PluginContext,
  PluginInstance
} from "wavesurfer.js";
```

This works well. For discoverability, it might help to document these prominently in the plugin authoring guide.

### Store State Types

The `WaveSurferState` interface is useful for typing store selectors. Currently accessed via:

```typescript
import type { WaveSurferState } from "wavesurfer.js/dist/state/state.types";
```

**Suggestion:** Consider re-exporting state types from the main entry point for easier access.

---

## Our Approach (for reference)

Since our use case (visualizing non-audio signals) is outside WaveSurfer's scope, we built our own rendering layer on top of the plugin API:

- **Custom canvas rendering** with DPI scaling
- **Decimation algorithms** (LTTB, min-max) for efficient rendering of large datasets
- **Flexible normalization** (global, viewport-local, percentile-based)
- **Configurable baseline** (bottom for positive-only data, center for bipolar)

This worked well because WaveSurfer's plugin architecture gave us:
- Reactive zoom/scroll state to stay synchronized
- DOM insertion points for positioning
- Clean resource lifecycle management

We didn't need WaveSurfer to handle any of this for us—the plugin API provided the right hooks to build it ourselves.

---

## Conclusion

WaveSurfer 8.0's plugin architecture is excellent for extending audio visualization. The reactive store, resource management, and DOM access patterns made it straightforward to build a companion visualization plugin that stays perfectly synchronized with the main waveform.

The suggestions above are minor quality-of-life improvements for plugin authors. WaveSurfer's focus on audio is the right design choice—plugins can handle specialized use cases without the core needing to accommodate them.

---

*Document created as part of the `@octoseq/wavesurfer-signalviewer` plugin development.*
