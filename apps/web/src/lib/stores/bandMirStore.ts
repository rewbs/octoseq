import { create } from "zustand";
import { devtools } from "zustand/middleware";
import type {
    BandMir1DResult,
    BandMirFunctionId,
    BandCqt1DResult,
    BandCqtFunctionId,
    BandEventsResult,
    BandEventFunctionId,
} from "@octoseq/mir";

// ----------------------------
// Types
// ----------------------------

/** Cache key format: bandId:functionId */
type BandMirCacheKey = `${string}:${BandMirFunctionId}`;
type BandCqtCacheKey = `${string}:${BandCqtFunctionId}`;
type BandEventCacheKey = `${string}:${BandEventFunctionId}`;

/** Event data matching WASM EventStream events */
export interface BandEvent {
    time: number;
    weight: number;
    beatPosition?: number;
    beatPhase?: number;
    clusterId?: number;
}

/** Cached band event extraction result */
export interface BandEventData {
    bandId: string;
    bandLabel: string;
    events: BandEvent[];
    extractedAt: number; // Timestamp for cache management
}

function makeCacheKey(bandId: string, fn: BandMirFunctionId): BandMirCacheKey {
    return `${bandId}:${fn}`;
}

function makeCqtCacheKey(bandId: string, fn: BandCqtFunctionId): BandCqtCacheKey {
    return `${bandId}:${fn}`;
}

function makeEventCacheKey(bandId: string, fn: BandEventFunctionId): BandEventCacheKey {
    return `${bandId}:${fn}`;
}

interface BandMirState {
    /** Cached STFT band MIR results keyed by bandId:fn */
    cache: Map<BandMirCacheKey, BandMir1DResult>;

    /** Bands currently being computed */
    pendingBandIds: Set<string>;

    /** Version counter per band for cache invalidation */
    bandVersions: Map<string, number>;

    /** Global spectrogram version (invalidates all caches) */
    spectrogramVersion: number;

    /** Whether band signals are expanded in the UI */
    expanded: boolean;

    // === CQT Band Signals ===

    /** Cached CQT band results keyed by bandId:fn */
    cqtCache: Map<BandCqtCacheKey, BandCqt1DResult>;

    /** Bands currently having CQT computed */
    cqtPendingBandIds: Set<string>;

    // === Typed Band Events ===

    /** Cached band event extraction results keyed by bandId:fn */
    typedEventCache: Map<BandEventCacheKey, BandEventsResult>;

    /** Bands currently having typed events extracted */
    typedEventsPendingBandIds: Set<string>;

    /** Whether typed events are expanded in the UI */
    typedEventsExpanded: boolean;

    // === Legacy Band Events (for backwards compatibility) ===

    /** Cached band event extraction results keyed by bandId */
    eventCache: Map<string, BandEventData>;

    /** Bands currently having events extracted */
    eventsPendingBandIds: Set<string>;

    /** Whether band events are visible in the UI */
    eventsVisible: boolean;

    /** Per-band event visibility toggles */
    eventVisibilityByBand: Map<string, boolean>;
}

interface BandMirActions {
    /** Get cached result if valid */
    getCached: (bandId: string, fn: BandMirFunctionId) => BandMir1DResult | null;

    /** Store a computed result */
    setResult: (result: BandMir1DResult) => void;

    /** Store multiple results at once */
    setResults: (results: BandMir1DResult[]) => void;

    /** Invalidate cache for a specific band */
    invalidateBand: (bandId: string) => void;

    /** Invalidate all band caches (new audio/spectrogram) */
    invalidateAll: () => void;

    /** Mark band as computing */
    setPending: (bandId: string, pending: boolean) => void;

    /** Check if band is being computed */
    isPending: (bandId: string) => boolean;

    /** Get all cached results */
    getAllResults: () => BandMir1DResult[];

    /** Get results for a specific function */
    getResultsByFunction: (fn: BandMirFunctionId) => BandMir1DResult[];

    /** Get results for a specific band */
    getResultsByBand: (bandId: string) => BandMir1DResult[];

    /** Toggle expanded state */
    setExpanded: (expanded: boolean) => void;

    /** Clear all results and reset state */
    reset: () => void;

    // === CQT Band Actions ===

    /** Get cached CQT result */
    getCqtCached: (bandId: string, fn: BandCqtFunctionId) => BandCqt1DResult | null;

    /** Store CQT results */
    setCqtResults: (results: BandCqt1DResult[]) => void;

    /** Mark band as having CQT computed */
    setCqtPending: (bandId: string, pending: boolean) => void;

    /** Check if band CQT is being computed */
    isCqtPending: (bandId: string) => boolean;

    /** Invalidate CQT cache for a band */
    invalidateCqtBand: (bandId: string) => void;

    /** Invalidate all CQT caches */
    invalidateAllCqt: () => void;

    /** Get CQT results by function */
    getCqtResultsByFunction: (fn: BandCqtFunctionId) => BandCqt1DResult[];

    // === Typed Band Event Actions ===

    /** Get cached typed events */
    getTypedEventsCached: (bandId: string, fn: BandEventFunctionId) => BandEventsResult | null;

    /** Store typed event results */
    setTypedEventResults: (results: BandEventsResult[]) => void;

    /** Mark band as having typed events extracted */
    setTypedEventsPending: (bandId: string, pending: boolean) => void;

    /** Check if typed events are being extracted */
    isTypedEventsPending: (bandId: string) => boolean;

    /** Invalidate typed events for a band */
    invalidateTypedEventsBand: (bandId: string) => void;

    /** Invalidate all typed events */
    invalidateAllTypedEvents: () => void;

    /** Get typed event results by function */
    getTypedEventsByFunction: (fn: BandEventFunctionId) => BandEventsResult[];

    /** Toggle typed events expanded state */
    setTypedEventsExpanded: (expanded: boolean) => void;

    // === Legacy Band Event Actions (backwards compatibility) ===

    /** Get cached events for a band */
    getEventsCached: (bandId: string) => BandEventData | null;

    /** Store extracted events for a band */
    setEventResult: (bandId: string, bandLabel: string, events: BandEvent[]) => void;

    /** Invalidate events for a specific band */
    invalidateBandEvents: (bandId: string) => void;

    /** Invalidate all band events */
    invalidateAllEvents: () => void;

    /** Mark band as having events being extracted */
    setEventsPending: (bandId: string, pending: boolean) => void;

    /** Check if band events are being extracted */
    isEventsPending: (bandId: string) => boolean;

    /** Get all cached event results */
    getAllEventResults: () => BandEventData[];

    /** Set global events visibility */
    setEventsVisible: (visible: boolean) => void;

    /** Set event visibility for a specific band */
    setBandEventVisibility: (bandId: string, visible: boolean) => void;

    /** Get event visibility for a specific band (defaults to true) */
    isBandEventVisible: (bandId: string) => boolean;
}

export type BandMirStore = BandMirState & BandMirActions;

// ----------------------------
// Initial State
// ----------------------------

const initialState: BandMirState = {
    cache: new Map(),
    pendingBandIds: new Set(),
    bandVersions: new Map(),
    spectrogramVersion: 0,
    expanded: true,
    // CQT
    cqtCache: new Map(),
    cqtPendingBandIds: new Set(),
    // Typed Events
    typedEventCache: new Map(),
    typedEventsPendingBandIds: new Set(),
    typedEventsExpanded: true,
    // Legacy Events
    eventCache: new Map(),
    eventsPendingBandIds: new Set(),
    eventsVisible: true,
    eventVisibilityByBand: new Map(),
};

// ----------------------------
// Store
// ----------------------------

export const useBandMirStore = create<BandMirStore>()(
    devtools(
        (set, get) => ({
            ...initialState,

            getCached: (bandId, fn) => {
                const key = makeCacheKey(bandId, fn);
                return get().cache.get(key) ?? null;
            },

            setResult: (result) => {
                set(
                    (state) => {
                        const newCache = new Map(state.cache);
                        const key = makeCacheKey(result.bandId, result.fn);
                        newCache.set(key, result);
                        return { cache: newCache };
                    },
                    false,
                    "setResult"
                );
            },

            setResults: (results) => {
                set(
                    (state) => {
                        const newCache = new Map(state.cache);
                        for (const result of results) {
                            const key = makeCacheKey(result.bandId, result.fn);
                            newCache.set(key, result);
                        }
                        return { cache: newCache };
                    },
                    false,
                    "setResults"
                );
            },

            invalidateBand: (bandId) => {
                set(
                    (state) => {
                        const newCache = new Map(state.cache);
                        const newVersions = new Map(state.bandVersions);

                        // Remove all cached results for this band
                        for (const key of newCache.keys()) {
                            if (key.startsWith(`${bandId}:`)) {
                                newCache.delete(key);
                            }
                        }

                        // Increment version
                        const currentVersion = newVersions.get(bandId) ?? 0;
                        newVersions.set(bandId, currentVersion + 1);

                        return { cache: newCache, bandVersions: newVersions };
                    },
                    false,
                    "invalidateBand"
                );
            },

            invalidateAll: () => {
                set(
                    (state) => ({
                        cache: new Map(),
                        bandVersions: new Map(),
                        spectrogramVersion: state.spectrogramVersion + 1,
                    }),
                    false,
                    "invalidateAll"
                );
            },

            setPending: (bandId, pending) => {
                set(
                    (state) => {
                        const newPending = new Set(state.pendingBandIds);
                        if (pending) {
                            newPending.add(bandId);
                        } else {
                            newPending.delete(bandId);
                        }
                        return { pendingBandIds: newPending };
                    },
                    false,
                    "setPending"
                );
            },

            isPending: (bandId) => {
                return get().pendingBandIds.has(bandId);
            },

            getAllResults: () => {
                return Array.from(get().cache.values());
            },

            getResultsByFunction: (fn) => {
                const results: BandMir1DResult[] = [];
                for (const [key, result] of get().cache.entries()) {
                    if (key.endsWith(`:${fn}`)) {
                        results.push(result);
                    }
                }
                return results;
            },

            getResultsByBand: (bandId) => {
                const results: BandMir1DResult[] = [];
                for (const [key, result] of get().cache.entries()) {
                    if (key.startsWith(`${bandId}:`)) {
                        results.push(result);
                    }
                }
                return results;
            },

            setExpanded: (expanded) => {
                set({ expanded }, false, "setExpanded");
            },

            reset: () => {
                set(
                    {
                        cache: new Map(),
                        pendingBandIds: new Set(),
                        bandVersions: new Map(),
                        spectrogramVersion: 0,
                        cqtCache: new Map(),
                        cqtPendingBandIds: new Set(),
                        typedEventCache: new Map(),
                        typedEventsPendingBandIds: new Set(),
                        typedEventsExpanded: true,
                        eventCache: new Map(),
                        eventsPendingBandIds: new Set(),
                        eventsVisible: true,
                        eventVisibilityByBand: new Map(),
                    },
                    false,
                    "reset"
                );
            },

            // === CQT Band Actions ===

            getCqtCached: (bandId, fn) => {
                const key = makeCqtCacheKey(bandId, fn);
                return get().cqtCache.get(key) ?? null;
            },

            setCqtResults: (results) => {
                set(
                    (state) => {
                        const newCache = new Map(state.cqtCache);
                        for (const result of results) {
                            const key = makeCqtCacheKey(result.bandId, result.fn);
                            newCache.set(key, result);
                        }
                        return { cqtCache: newCache };
                    },
                    false,
                    "setCqtResults"
                );
            },

            setCqtPending: (bandId, pending) => {
                set(
                    (state) => {
                        const newPending = new Set(state.cqtPendingBandIds);
                        if (pending) {
                            newPending.add(bandId);
                        } else {
                            newPending.delete(bandId);
                        }
                        return { cqtPendingBandIds: newPending };
                    },
                    false,
                    "setCqtPending"
                );
            },

            isCqtPending: (bandId) => {
                return get().cqtPendingBandIds.has(bandId);
            },

            invalidateCqtBand: (bandId) => {
                set(
                    (state) => {
                        const newCache = new Map(state.cqtCache);
                        for (const key of newCache.keys()) {
                            if (key.startsWith(`${bandId}:`)) {
                                newCache.delete(key);
                            }
                        }
                        return { cqtCache: newCache };
                    },
                    false,
                    "invalidateCqtBand"
                );
            },

            invalidateAllCqt: () => {
                set({ cqtCache: new Map() }, false, "invalidateAllCqt");
            },

            getCqtResultsByFunction: (fn) => {
                const results: BandCqt1DResult[] = [];
                for (const [key, result] of get().cqtCache.entries()) {
                    if (key.endsWith(`:${fn}`)) {
                        results.push(result);
                    }
                }
                return results;
            },

            // === Typed Band Event Actions ===

            getTypedEventsCached: (bandId, fn) => {
                const key = makeEventCacheKey(bandId, fn);
                return get().typedEventCache.get(key) ?? null;
            },

            setTypedEventResults: (results) => {
                set(
                    (state) => {
                        const newCache = new Map(state.typedEventCache);
                        for (const result of results) {
                            const key = makeEventCacheKey(result.bandId, result.fn);
                            newCache.set(key, result);
                        }
                        return { typedEventCache: newCache };
                    },
                    false,
                    "setTypedEventResults"
                );
            },

            setTypedEventsPending: (bandId, pending) => {
                set(
                    (state) => {
                        const newPending = new Set(state.typedEventsPendingBandIds);
                        if (pending) {
                            newPending.add(bandId);
                        } else {
                            newPending.delete(bandId);
                        }
                        return { typedEventsPendingBandIds: newPending };
                    },
                    false,
                    "setTypedEventsPending"
                );
            },

            isTypedEventsPending: (bandId) => {
                return get().typedEventsPendingBandIds.has(bandId);
            },

            invalidateTypedEventsBand: (bandId) => {
                set(
                    (state) => {
                        const newCache = new Map(state.typedEventCache);
                        for (const key of newCache.keys()) {
                            if (key.startsWith(`${bandId}:`)) {
                                newCache.delete(key);
                            }
                        }
                        return { typedEventCache: newCache };
                    },
                    false,
                    "invalidateTypedEventsBand"
                );
            },

            invalidateAllTypedEvents: () => {
                set({ typedEventCache: new Map() }, false, "invalidateAllTypedEvents");
            },

            getTypedEventsByFunction: (fn) => {
                const results: BandEventsResult[] = [];
                for (const [key, result] of get().typedEventCache.entries()) {
                    if (key.endsWith(`:${fn}`)) {
                        results.push(result);
                    }
                }
                return results;
            },

            setTypedEventsExpanded: (expanded) => {
                set({ typedEventsExpanded: expanded }, false, "setTypedEventsExpanded");
            },

            // === Legacy Band Event Actions ===

            getEventsCached: (bandId) => {
                return get().eventCache.get(bandId) ?? null;
            },

            setEventResult: (bandId, bandLabel, events) => {
                set(
                    (state) => {
                        const newEventCache = new Map(state.eventCache);
                        newEventCache.set(bandId, {
                            bandId,
                            bandLabel,
                            events,
                            extractedAt: Date.now(),
                        });
                        return { eventCache: newEventCache };
                    },
                    false,
                    "setEventResult"
                );
            },

            invalidateBandEvents: (bandId) => {
                set(
                    (state) => {
                        const newEventCache = new Map(state.eventCache);
                        newEventCache.delete(bandId);
                        return { eventCache: newEventCache };
                    },
                    false,
                    "invalidateBandEvents"
                );
            },

            invalidateAllEvents: () => {
                set({ eventCache: new Map() }, false, "invalidateAllEvents");
            },

            setEventsPending: (bandId, pending) => {
                set(
                    (state) => {
                        const newPending = new Set(state.eventsPendingBandIds);
                        if (pending) {
                            newPending.add(bandId);
                        } else {
                            newPending.delete(bandId);
                        }
                        return { eventsPendingBandIds: newPending };
                    },
                    false,
                    "setEventsPending"
                );
            },

            isEventsPending: (bandId) => {
                return get().eventsPendingBandIds.has(bandId);
            },

            getAllEventResults: () => {
                return Array.from(get().eventCache.values());
            },

            setEventsVisible: (visible) => {
                set({ eventsVisible: visible }, false, "setEventsVisible");
            },

            setBandEventVisibility: (bandId, visible) => {
                set(
                    (state) => {
                        const newVisibility = new Map(state.eventVisibilityByBand);
                        newVisibility.set(bandId, visible);
                        return { eventVisibilityByBand: newVisibility };
                    },
                    false,
                    "setBandEventVisibility"
                );
            },

            isBandEventVisible: (bandId) => {
                const state = get();
                // Default to global visibility if not explicitly set per band
                return state.eventVisibilityByBand.get(bandId) ?? state.eventsVisible;
            },
        }),
        { name: "band-mir-store" }
    )
);

/**
 * Set up cross-store invalidation subscription.
 *
 * Call this once during app initialization to wire up:
 * - Band definition changes → invalidate band MIR results and events
 *
 * Returns an unsubscribe function.
 */
export function setupBandMirInvalidation(): () => void {
    // Dynamically import to avoid circular dependency
    const { useFrequencyBandStore } = require("./frequencyBandStore");

    const unsubscribe = useFrequencyBandStore.getState().onBandInvalidation(
        "bandMirStore",
        (event: { kind: string; bandId?: string }) => {
            const store = useBandMirStore.getState();

            switch (event.kind) {
                case "band_added":
                case "band_updated":
                case "band_removed":
                case "band_enabled_changed":
                    if (event.bandId) {
                        // Invalidate all caches for this band
                        store.invalidateBand(event.bandId);
                        store.invalidateCqtBand(event.bandId);
                        store.invalidateTypedEventsBand(event.bandId);
                        store.invalidateBandEvents(event.bandId);
                    }
                    break;

                case "structure_cleared":
                case "structure_imported":
                    // Invalidate all caches
                    store.invalidateAll();
                    store.invalidateAllCqt();
                    store.invalidateAllTypedEvents();
                    store.invalidateAllEvents();
                    break;
            }
        }
    );

    return unsubscribe;
}
