import { create } from "zustand";
import { devtools } from "zustand/middleware";
import type {
    FrequencyBand,
    FrequencyBandStructure,
} from "@octoseq/mir";
import {
    createBandStructure,
    createStandardBands,
    generateBandId,
    sortBands,
    validateBandStructure,
    validateFrequencyBand,
} from "@octoseq/mir";
import type { AudioIdentity } from "./musicalTimeStore";

// ----------------------------
// Invalidation Events
// ----------------------------

/**
 * Events emitted when band definitions change.
 * Dependents can subscribe to these to invalidate derived data.
 */
export type BandInvalidationEvent =
    | { kind: "band_added"; bandId: string }
    | { kind: "band_removed"; bandId: string }
    | { kind: "band_updated"; bandId: string; changedFields: string[] }
    | { kind: "band_enabled_changed"; bandId: string; enabled: boolean }
    | { kind: "structure_cleared" }
    | { kind: "structure_imported" };

/**
 * Callback type for invalidation listeners.
 */
export type BandInvalidationCallback = (event: BandInvalidationEvent) => void;

// ----------------------------
// Storage Key Generation
// ----------------------------

/**
 * Simple hash function for generating storage keys.
 */
function simpleHash(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(36);
}

/**
 * Generate the localStorage key for frequency bands.
 */
function getStorageKey(audio: AudioIdentity): string {
    const hash = simpleHash(`${audio.filename}:${audio.duration}:${audio.sampleRate}`);
    return `octoseq-frequency-bands-${hash}`;
}

// ----------------------------
// Persisted Structure
// ----------------------------

interface PersistedFrequencyBands {
    version: 1;
    audioIdentity: AudioIdentity;
    structure: FrequencyBandStructure;
}

// ----------------------------
// Migration
// ----------------------------

/**
 * Legacy v1 band structure (without sourceId).
 */
type LegacyFrequencyBandV1 = Omit<FrequencyBand, "sourceId">;

/**
 * Migrate a v1 structure to v2 by adding sourceId to all bands.
 * Existing bands without sourceId default to "mixdown".
 */
function migrateStructureV1ToV2(
    structure: { version: 1; bands: LegacyFrequencyBandV1[]; createdAt: string; modifiedAt: string }
): FrequencyBandStructure {
    return {
        version: 2,
        bands: structure.bands.map((band) => ({
            ...band,
            sourceId: "mixdown", // Default to mixdown for migrated bands
        })),
        createdAt: structure.createdAt,
        modifiedAt: new Date().toISOString(),
    };
}

/**
 * Migrate a structure from any version to the current version.
 */
function migrateStructure(structure: unknown): FrequencyBandStructure | null {
    if (!structure || typeof structure !== "object") return null;

    const s = structure as Record<string, unknown>;

    // Already v2 - validate it has sourceId on bands
    if (s.version === 2 && Array.isArray(s.bands)) {
        // Ensure all bands have sourceId (defensive check)
        const bands = (s.bands as FrequencyBand[]).map((band) => ({
            ...band,
            sourceId: band.sourceId ?? "mixdown",
        }));
        return {
            version: 2,
            bands,
            createdAt: s.createdAt as string,
            modifiedAt: s.modifiedAt as string,
        };
    }

    // Migrate from v1
    if (s.version === 1 && Array.isArray(s.bands)) {
        return migrateStructureV1ToV2(s as {
            version: 1;
            bands: LegacyFrequencyBandV1[];
            createdAt: string;
            modifiedAt: string;
        });
    }

    console.warn(`Unknown frequency band structure version: ${s.version}`);
    return null;
}

// ----------------------------
// UI State Types (F2)
// ----------------------------

/** Snap mode for time alignment during editing. */
export type BandSnapMode = "none" | "beats" | "frames" | "keyframes";

/** Drag interaction state during direct manipulation. */
export type BandDragState = {
    bandId: string;
    mode: "low-edge" | "high-edge" | "body" | "keyframe-time";
    /** Initial value at drag start (Hz or time depending on mode). */
    startValue: number;
    /** Initial mouse Y/X position at drag start. */
    startPosition: number;
} | null;

// ----------------------------
// Store State
// ----------------------------

interface FrequencyBandState {
    /** The authoritative frequency band structure (null if no bands defined). */
    structure: FrequencyBandStructure | null;

    /** Audio identity for persistence (set when audio is loaded). */
    audioIdentity: AudioIdentity | null;

    /** Currently selected band for editing. */
    selectedBandId: string | null;

    /** Whether the user is actively editing bands. */
    isEditing: boolean;

    /** Registered invalidation listeners. */
    invalidationListeners: Map<string, BandInvalidationCallback>;

    // ----------------------------
    // UI State (F2)
    // ----------------------------

    /** Currently hovered band (for visual feedback). */
    hoveredBandId: string | null;

    /** Currently hovered keyframe time (for visual feedback). */
    hoveredKeyframeTime: number | null;

    /** Active drag operation state. */
    dragState: BandDragState;

    /** Time snapping mode during editing. */
    snapMode: BandSnapMode;

    /** Band currently soloed for audio auditioning (null = no solo). */
    soloedBandId: string | null;

    /** Set of band IDs that are muted (visual only, not audio filtering). */
    mutedBandIds: Set<string>;

    /** Whether the sidebar panel is open. */
    sidebarOpen: boolean;
}

// ----------------------------
// Store Actions
// ----------------------------

interface FrequencyBandActions {
    // Audio identity
    /** Set the audio identity (called when audio is loaded). */
    setAudioIdentity: (identity: AudioIdentity | null) => void;

    // Band management
    /** Add a band. Returns the new band ID. */
    addBand: (band: Omit<FrequencyBand, "id">) => string;

    /** Update an existing band. */
    updateBand: (id: string, updates: Partial<Omit<FrequencyBand, "id">>) => void;

    /** Remove a band by ID. */
    removeBand: (id: string) => void;

    /** Enable or disable a band. */
    setBandEnabled: (id: string, enabled: boolean) => void;

    /** Reorder bands by specifying the new order of IDs. */
    reorderBands: (orderedIds: string[]) => void;

    // Selection
    /** Select a band for editing. */
    selectBand: (id: string | null) => void;

    /** Toggle editing mode. */
    setEditing: (editing: boolean) => void;

    // Queries (read-only, no side effects)
    /** Get a band by its ID. */
    getBandById: (id: string) => FrequencyBand | null;

    /** Get all enabled bands sorted by sortOrder. */
    getEnabledBands: () => FrequencyBand[];

    /** Get all bands for a specific audio source, sorted by sortOrder. */
    getBandsForSource: (sourceId: string) => FrequencyBand[];

    /** Get all enabled bands for a specific audio source, sorted by sortOrder. */
    getEnabledBandsForSource: (sourceId: string) => FrequencyBand[];

    // Structure management
    /** Clear all frequency bands. */
    clearStructure: () => void;

    /** Ensure a structure exists (creates empty if none). */
    ensureStructure: () => void;

    /** Initialize with standard 6-band frequency split for a specific source. */
    initializeWithStandardBands: (duration: number, sourceId?: string) => void;

    /** Clear all bands belonging to a specific source (e.g., when stem is removed). */
    clearBandsForSource: (sourceId: string) => void;

    // Persistence
    /** Save to localStorage. */
    saveToLocalStorage: () => void;

    /** Load from localStorage. Returns true if data was loaded. */
    loadFromLocalStorage: () => boolean;

    /** Clear persisted data from localStorage. */
    clearLocalStorage: () => void;

    /** Export structure to JSON string. */
    exportToJSON: () => string | null;

    /** Import structure from JSON string. */
    importFromJSON: (json: string) => boolean;

    // Invalidation
    /** Register an invalidation listener. Returns unsubscribe function. */
    onBandInvalidation: (id: string, callback: BandInvalidationCallback) => () => void;

    /** Internal: emit an invalidation event to all listeners. */
    _emitInvalidation: (event: BandInvalidationEvent) => void;

    /** Full reset (called on new audio load). */
    reset: () => void;

    // ----------------------------
    // UI Actions (F2)
    // ----------------------------

    /** Set hovered band ID. */
    setHoveredBandId: (id: string | null) => void;

    /** Set hovered keyframe time. */
    setHoveredKeyframeTime: (time: number | null) => void;

    /** Start a drag operation. */
    startDrag: (state: NonNullable<BandDragState>) => void;

    /** End the current drag operation. */
    endDrag: () => void;

    /** Set snap mode. */
    setSnapMode: (mode: BandSnapMode) => void;

    /** Solo a band for auditioning (or null to unsolo). */
    setSoloedBandId: (id: string | null) => void;

    /** Toggle mute state for a band. */
    toggleMuted: (id: string) => void;

    /** Set muted state for a band. */
    setMuted: (id: string, muted: boolean) => void;

    /** Clear all mutes. */
    clearMutes: () => void;

    /** Toggle sidebar open/closed. */
    toggleSidebar: () => void;

    /** Set sidebar open state. */
    setSidebarOpen: (open: boolean) => void;
}

export type FrequencyBandStore = FrequencyBandState & FrequencyBandActions;

// ----------------------------
// Initial State
// ----------------------------

const initialState: FrequencyBandState = {
    structure: null,
    audioIdentity: null,
    selectedBandId: null,
    isEditing: false,
    invalidationListeners: new Map(),
    // UI State (F2)
    hoveredBandId: null,
    hoveredKeyframeTime: null,
    dragState: null,
    snapMode: "none",
    soloedBandId: null,
    mutedBandIds: new Set(),
    sidebarOpen: false,
};

// ----------------------------
// Store Implementation
// ----------------------------

export const useFrequencyBandStore = create<FrequencyBandStore>()(
    devtools(
        (set, get) => ({
            ...initialState,

            // ----------------------------
            // Audio Identity
            // ----------------------------

            setAudioIdentity: (identity) => {
                const prev = get().audioIdentity;
                const invalidationListeners = get().invalidationListeners;

                const isSameAudio =
                    prev &&
                    identity &&
                    prev.filename === identity.filename &&
                    Math.abs(prev.duration - identity.duration) <= 0.1 &&
                    prev.sampleRate === identity.sampleRate;

                // On audio change (or clearing), reset authored/UI state but preserve invalidation listeners.
                // This prevents bands from leaking across tracks while keeping derived-cache wiring intact.
                if (!identity) {
                    set(
                        {
                            ...initialState,
                            invalidationListeners,
                            audioIdentity: null,
                        },
                        false,
                        "setAudioIdentity"
                    );
                    get()._emitInvalidation({ kind: "structure_cleared" });
                    return;
                }

                if (!isSameAudio) {
                    set(
                        {
                            ...initialState,
                            invalidationListeners,
                            audioIdentity: identity,
                        },
                        false,
                        "setAudioIdentity"
                    );
                    get()._emitInvalidation({ kind: "structure_cleared" });
                } else {
                    set({ audioIdentity: identity }, false, "setAudioIdentity");
                }

                // Try to load persisted data for this audio
                get().loadFromLocalStorage();
            },

            // ----------------------------
            // Band Management
            // ----------------------------

            addBand: (bandData) => {
                const { structure, audioIdentity } = get();
                const now = new Date().toISOString();

                const band: FrequencyBand = {
                    ...bandData,
                    id: generateBandId(),
                };

                // Validate
                const errors = validateFrequencyBand(band);
                if (errors.length > 0) {
                    console.warn("Band validation warnings:", errors);
                }

                const newStructure: FrequencyBandStructure = structure
                    ? {
                        ...structure,
                        bands: sortBands([...structure.bands, band]),
                        modifiedAt: now,
                    }
                    : {
                        version: 2,
                        bands: [band],
                        createdAt: now,
                        modifiedAt: now,
                    };

                set({ structure: newStructure }, false, "addBand");
                get()._emitInvalidation({ kind: "band_added", bandId: band.id });

                if (audioIdentity) {
                    get().saveToLocalStorage();
                }

                return band.id;
            },

            updateBand: (id, updates) => {
                const { structure, audioIdentity } = get();
                if (!structure) return;

                const now = new Date().toISOString();
                const changedFields = Object.keys(updates);

                const newBands = structure.bands.map((band) =>
                    band.id === id ? { ...band, ...updates } : band
                );

                set(
                    {
                        structure: {
                            ...structure,
                            bands: sortBands(newBands),
                            modifiedAt: now,
                        },
                    },
                    false,
                    "updateBand"
                );

                get()._emitInvalidation({ kind: "band_updated", bandId: id, changedFields });

                if (audioIdentity) {
                    get().saveToLocalStorage();
                }
            },

            removeBand: (id) => {
                const { structure, selectedBandId, audioIdentity } = get();
                if (!structure) return;

                const now = new Date().toISOString();

                set(
                    {
                        structure: {
                            ...structure,
                            bands: structure.bands.filter((b) => b.id !== id),
                            modifiedAt: now,
                        },
                        selectedBandId: selectedBandId === id ? null : selectedBandId,
                    },
                    false,
                    "removeBand"
                );

                get()._emitInvalidation({ kind: "band_removed", bandId: id });

                if (audioIdentity) {
                    get().saveToLocalStorage();
                }
            },

            setBandEnabled: (id, enabled) => {
                const { structure } = get();
                if (!structure) return;

                const band = structure.bands.find((b) => b.id === id);
                if (!band || band.enabled === enabled) return;

                get().updateBand(id, { enabled });
                get()._emitInvalidation({ kind: "band_enabled_changed", bandId: id, enabled });
            },

            reorderBands: (orderedIds) => {
                const { structure, audioIdentity } = get();
                if (!structure) return;

                const now = new Date().toISOString();
                const newBands = structure.bands.map((band) => {
                    const newOrder = orderedIds.indexOf(band.id);
                    return { ...band, sortOrder: newOrder >= 0 ? newOrder : band.sortOrder };
                });

                set(
                    {
                        structure: {
                            ...structure,
                            bands: sortBands(newBands),
                            modifiedAt: now,
                        },
                    },
                    false,
                    "reorderBands"
                );

                if (audioIdentity) {
                    get().saveToLocalStorage();
                }
            },

            // ----------------------------
            // Selection
            // ----------------------------

            selectBand: (id) => {
                set({ selectedBandId: id }, false, "selectBand");
            },

            setEditing: (editing) => {
                set({ isEditing: editing }, false, "setEditing");
            },

            // ----------------------------
            // Queries
            // ----------------------------

            getBandById: (id) => {
                const { structure } = get();
                return structure?.bands.find((b) => b.id === id) ?? null;
            },

            getEnabledBands: () => {
                const { structure } = get();
                if (!structure) return [];
                return sortBands(structure.bands.filter((b) => b.enabled));
            },

            getBandsForSource: (sourceId) => {
                const { structure } = get();
                if (!structure) return [];
                return sortBands(structure.bands.filter((b) => b.sourceId === sourceId));
            },

            getEnabledBandsForSource: (sourceId) => {
                const { structure } = get();
                if (!structure) return [];
                return sortBands(
                    structure.bands.filter((b) => b.sourceId === sourceId && b.enabled)
                );
            },

            // ----------------------------
            // Structure Management
            // ----------------------------

            clearStructure: () => {
                const { audioIdentity } = get();
                set(
                    {
                        structure: null,
                        selectedBandId: null,
                    },
                    false,
                    "clearStructure"
                );
                get()._emitInvalidation({ kind: "structure_cleared" });

                if (audioIdentity) {
                    get().clearLocalStorage();
                }
            },

            ensureStructure: () => {
                const { structure } = get();
                if (!structure) {
                    set({ structure: createBandStructure() }, false, "ensureStructure");
                }
            },

            initializeWithStandardBands: (duration, sourceId = "mixdown") => {
                const { structure, audioIdentity } = get();
                const now = new Date().toISOString();
                const newBands = createStandardBands(duration, sourceId);

                // If we have an existing structure, add to it; otherwise create new
                const newStructure: FrequencyBandStructure = structure
                    ? {
                        ...structure,
                        bands: sortBands([...structure.bands, ...newBands]),
                        modifiedAt: now,
                    }
                    : {
                        version: 2,
                        bands: newBands,
                        createdAt: now,
                        modifiedAt: now,
                    };

                set({ structure: newStructure }, false, "initializeWithStandardBands");
                get()._emitInvalidation({ kind: "structure_imported" });

                if (audioIdentity) {
                    get().saveToLocalStorage();
                }
            },

            clearBandsForSource: (sourceId) => {
                const { structure, audioIdentity, selectedBandId } = get();
                if (!structure) return;

                const now = new Date().toISOString();
                const removedBandIds = structure.bands
                    .filter((b) => b.sourceId === sourceId)
                    .map((b) => b.id);

                if (removedBandIds.length === 0) return;

                set(
                    {
                        structure: {
                            ...structure,
                            bands: structure.bands.filter((b) => b.sourceId !== sourceId),
                            modifiedAt: now,
                        },
                        // Clear selection if the selected band was removed
                        selectedBandId: removedBandIds.includes(selectedBandId ?? "")
                            ? null
                            : selectedBandId,
                    },
                    false,
                    "clearBandsForSource"
                );

                // Emit invalidation for each removed band
                for (const bandId of removedBandIds) {
                    get()._emitInvalidation({ kind: "band_removed", bandId });
                }

                if (audioIdentity) {
                    get().saveToLocalStorage();
                }
            },

            // ----------------------------
            // Persistence
            // ----------------------------

            saveToLocalStorage: () => {
                const { structure, audioIdentity } = get();
                if (!structure || !audioIdentity) return;

                const key = getStorageKey(audioIdentity);
                const persisted: PersistedFrequencyBands = {
                    version: 1,
                    audioIdentity,
                    structure,
                };

                try {
                    localStorage.setItem(key, JSON.stringify(persisted));
                } catch (error) {
                    console.error("Failed to save frequency bands to localStorage:", error);
                }
            },

            loadFromLocalStorage: () => {
                const { audioIdentity } = get();
                if (!audioIdentity) return false;

                const key = getStorageKey(audioIdentity);

                try {
                    const json = localStorage.getItem(key);
                    if (!json) return false;

                    const persisted = JSON.parse(json) as PersistedFrequencyBands;

                    // Version check for persistence wrapper
                    if (persisted.version !== 1) {
                        console.warn(`Unknown persistence version: ${persisted.version}`);
                        return false;
                    }

                    // Validate audio identity matches
                    const { filename, duration, sampleRate } = persisted.audioIdentity;
                    if (
                        filename !== audioIdentity.filename ||
                        Math.abs(duration - audioIdentity.duration) > 0.1 ||
                        sampleRate !== audioIdentity.sampleRate
                    ) {
                        console.warn("Audio identity mismatch - not loading persisted bands");
                        return false;
                    }

                    // Migrate structure if needed (handles v1 -> v2 migration)
                    const migratedStructure = migrateStructure(persisted.structure);
                    if (!migratedStructure) {
                        console.error("Failed to migrate frequency band structure");
                        return false;
                    }

                    set(
                        {
                            structure: migratedStructure,
                            selectedBandId: null,
                        },
                        false,
                        "loadFromLocalStorage"
                    );

                    return true;
                } catch (error) {
                    console.error("Failed to load frequency bands from localStorage:", error);
                    return false;
                }
            },

            clearLocalStorage: () => {
                const { audioIdentity } = get();
                if (!audioIdentity) return;

                const key = getStorageKey(audioIdentity);

                try {
                    localStorage.removeItem(key);
                } catch (error) {
                    console.error("Failed to clear frequency bands from localStorage:", error);
                }
            },

            exportToJSON: () => {
                const { structure } = get();
                if (!structure) return null;
                return JSON.stringify(structure, null, 2);
            },

            importFromJSON: (json) => {
                try {
                    const parsed = JSON.parse(json);

                    // Migrate structure if needed (handles v1 -> v2 migration)
                    const structure = migrateStructure(parsed);
                    if (!structure) {
                        console.error("Invalid frequency band structure");
                        return false;
                    }

                    const errors = validateBandStructure(structure);
                    if (errors.length > 0) {
                        console.warn("Validation warnings on import:", errors);
                    }

                    const { audioIdentity } = get();
                    set(
                        {
                            structure,
                            selectedBandId: null,
                        },
                        false,
                        "importFromJSON"
                    );

                    get()._emitInvalidation({ kind: "structure_imported" });

                    if (audioIdentity) {
                        get().saveToLocalStorage();
                    }

                    return true;
                } catch (error) {
                    console.error("Failed to import frequency bands:", error);
                    return false;
                }
            },

            // ----------------------------
            // Invalidation
            // ----------------------------

            onBandInvalidation: (id, callback) => {
                const { invalidationListeners } = get();
                const newListeners = new Map(invalidationListeners);
                newListeners.set(id, callback);
                set({ invalidationListeners: newListeners }, false, "registerInvalidationListener");

                // Return unsubscribe function
                return () => {
                    const current = get().invalidationListeners;
                    const updated = new Map(current);
                    updated.delete(id);
                    set({ invalidationListeners: updated }, false, "unregisterInvalidationListener");
                };
            },

            _emitInvalidation: (event) => {
                const { invalidationListeners } = get();
                invalidationListeners.forEach((callback) => {
                    try {
                        callback(event);
                    } catch (error) {
                        console.error("Invalidation callback error:", error);
                    }
                });
            },

            // ----------------------------
            // Reset
            // ----------------------------

            reset: () => {
                const invalidationListeners = get().invalidationListeners;
                set({ ...initialState, invalidationListeners }, false, "reset");
                get()._emitInvalidation({ kind: "structure_cleared" });
            },

            // ----------------------------
            // UI Actions (F2)
            // ----------------------------

            setHoveredBandId: (id) => {
                set({ hoveredBandId: id }, false, "setHoveredBandId");
            },

            setHoveredKeyframeTime: (time) => {
                set({ hoveredKeyframeTime: time }, false, "setHoveredKeyframeTime");
            },

            startDrag: (state) => {
                set({ dragState: state }, false, "startDrag");
            },

            endDrag: () => {
                set({ dragState: null }, false, "endDrag");
            },

            setSnapMode: (mode) => {
                set({ snapMode: mode }, false, "setSnapMode");
            },

            setSoloedBandId: (id) => {
                set({ soloedBandId: id }, false, "setSoloedBandId");
            },

            toggleMuted: (id) => {
                const { mutedBandIds } = get();
                const newMuted = new Set(mutedBandIds);
                if (newMuted.has(id)) {
                    newMuted.delete(id);
                } else {
                    newMuted.add(id);
                }
                set({ mutedBandIds: newMuted }, false, "toggleMuted");
            },

            setMuted: (id, muted) => {
                const { mutedBandIds } = get();
                const newMuted = new Set(mutedBandIds);
                if (muted) {
                    newMuted.add(id);
                } else {
                    newMuted.delete(id);
                }
                set({ mutedBandIds: newMuted }, false, "setMuted");
            },

            clearMutes: () => {
                set({ mutedBandIds: new Set() }, false, "clearMutes");
            },

            toggleSidebar: () => {
                const { sidebarOpen } = get();
                set({ sidebarOpen: !sidebarOpen }, false, "toggleSidebar");
            },

            setSidebarOpen: (open) => {
                set({ sidebarOpen: open }, false, "setSidebarOpen");
            },
        }),
        { name: "frequency-band-store" }
    )
);
