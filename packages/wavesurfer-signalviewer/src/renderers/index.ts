/**
 * Renderer exports
 */

export { renderLine, getBaselineY, type LineRenderOptions } from "./line.js";
export { renderStepped, type SteppedRenderOptions } from "./stepped.js";
export {
  renderImpulses,
  renderMarkers,
  renderSparseEvents,
  type ImpulseRenderOptions,
  type MarkerRenderOptions,
} from "./impulse.js";
export {
  renderHeatStrip,
  renderContinuousHeatStrip,
  type HeatStripRenderOptions,
} from "./heat-strip.js";
