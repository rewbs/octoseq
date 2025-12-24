import { create } from "zustand";
import { devtools } from "zustand/middleware";
import type {
    BeatGrid,
    BeatPosition,
    MusicalTimeSegment,
    MusicalTimeStructure,
} from "@octoseq/mir";
import {
    computeBeatPositionFromStructure,
    createMusicalTimeStructure,
    createSegmentFromGrid,
    generateSegmentId,
    sortSegments,
    splitSegment as splitSegmentUtil,
    validateSegments,
} from "@octoseq/mir";

// ----------------------------
// Audio Identity (for persistence key)
// ----------------------------

export interface AudioIdentity {
    filename: string;
    duration: number;
    sampleRate: number;
}

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
 * Generate the localStorage key for a given audio identity.
 */
function getStorageKey(audio: AudioIdentity): string {
    const hash = simpleHash(`${audio.filename}:${audio.duration}:${audio.sampleRate}`);
    return `octoseq-musical-time-${hash}`;
}

// ----------------------------
// Persisted Structure
// ----------------------------

interface PersistedMusicalTime {
    version: 1;
    audioIdentity: AudioIdentity;
    structure: MusicalTimeStructure;
}

// ----------------------------
// Store State
// ----------------------------

interface MusicalTimeState {
    /** The authoritative musical time structure (null if not yet authored). */
    structure: MusicalTimeStructure | null;

    /** Audio identity for persistence (set when audio is loaded). */
    audioIdentity: AudioIdentity | null;

    /** Currently selected segment for editing. */
    selectedSegmentId: string | null;

    /** Whether the user is actively editing musical time. */
    isEditing: boolean;

    /** Last known beat position (for "freeze" behavior when outside segments). */
    lastKnownBeatPosition: BeatPosition | null;
}

// ----------------------------
// Store Actions
// ----------------------------

interface MusicalTimeActions {
    // Audio identity
    /** Set the audio identity (called when audio is loaded). */
    setAudioIdentity: (identity: AudioIdentity | null) => void;

    // Promotion workflow
    /** Promote a beat grid to a musical time segment. */
    promoteGrid: (grid: BeatGrid, startTime: number, endTime: number) => string;

    // Segment management
    /** Add a segment manually. Returns the new segment ID. */
    addSegment: (segment: Omit<MusicalTimeSegment, "id">) => string;

    /** Update an existing segment. */
    updateSegment: (id: string, updates: Partial<Omit<MusicalTimeSegment, "id">>) => void;

    /** Remove a segment by ID. */
    removeSegment: (id: string) => void;

    /** Split a segment at a given time. Returns IDs of the two new segments. */
    splitSegmentAt: (id: string, splitTime: number) => [string, string] | null;

    // Selection
    /** Select a segment for editing. */
    selectSegment: (id: string | null) => void;

    /** Toggle editing mode. */
    setEditing: (editing: boolean) => void;

    // Queries
    /** Get the segment containing a given time. */
    getSegmentAtTime: (time: number) => MusicalTimeSegment | null;

    /** Get beat position at a given time. Updates lastKnownBeatPosition. */
    getBeatPositionAt: (time: number) => BeatPosition | null;

    // Structure management
    /** Clear all musical time (revert to unauthored state). */
    clearStructure: () => void;

    /** Initialize or create an empty structure if none exists. */
    ensureStructure: () => void;

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

    /** Full reset (called on new audio load). */
    reset: () => void;
}

export type MusicalTimeStore = MusicalTimeState & MusicalTimeActions;

// ----------------------------
// Initial State
// ----------------------------

const initialState: MusicalTimeState = {
    structure: null,
    audioIdentity: null,
    selectedSegmentId: null,
    isEditing: false,
    lastKnownBeatPosition: null,
};

// ----------------------------
// Store Implementation
// ----------------------------

export const useMusicalTimeStore = create<MusicalTimeStore>()(
    devtools(
        (set, get) => ({
            ...initialState,

            // ----------------------------
            // Audio Identity
            // ----------------------------

            setAudioIdentity: (identity) => {
                set({ audioIdentity: identity }, false, "setAudioIdentity");

                // Try to load persisted data for this audio
                if (identity) {
                    get().loadFromLocalStorage();
                }
            },

            // ----------------------------
            // Promotion Workflow
            // ----------------------------

            promoteGrid: (grid, startTime, endTime) => {
                const { structure, audioIdentity } = get();

                // Create segment from grid
                const segment = createSegmentFromGrid(grid, startTime, endTime);

                // Create or update structure
                const now = new Date().toISOString();
                const newStructure: MusicalTimeStructure = structure
                    ? {
                        ...structure,
                        segments: sortSegments([...structure.segments, segment]),
                        modifiedAt: now,
                    }
                    : {
                        version: 1,
                        segments: [segment],
                        createdAt: now,
                        modifiedAt: now,
                    };

                // Validate
                const errors = validateSegments(newStructure.segments);
                if (errors.length > 0) {
                    console.error("Validation errors after promotion:", errors);
                    // Still proceed - validation errors are warnings for now
                }

                set({ structure: newStructure }, false, "promoteGrid");

                // Auto-save
                if (audioIdentity) {
                    get().saveToLocalStorage();
                }

                return segment.id;
            },

            // ----------------------------
            // Segment Management
            // ----------------------------

            addSegment: (segmentData) => {
                const { structure, audioIdentity } = get();
                const now = new Date().toISOString();

                const segment: MusicalTimeSegment = {
                    ...segmentData,
                    id: generateSegmentId(),
                };

                const newStructure: MusicalTimeStructure = structure
                    ? {
                        ...structure,
                        segments: sortSegments([...structure.segments, segment]),
                        modifiedAt: now,
                    }
                    : {
                        version: 1,
                        segments: [segment],
                        createdAt: now,
                        modifiedAt: now,
                    };

                set({ structure: newStructure }, false, "addSegment");

                if (audioIdentity) {
                    get().saveToLocalStorage();
                }

                return segment.id;
            },

            updateSegment: (id, updates) => {
                const { structure, audioIdentity } = get();
                if (!structure) return;

                const now = new Date().toISOString();
                const newSegments = structure.segments.map((seg) =>
                    seg.id === id ? { ...seg, ...updates } : seg
                );

                set(
                    {
                        structure: {
                            ...structure,
                            segments: sortSegments(newSegments),
                            modifiedAt: now,
                        },
                    },
                    false,
                    "updateSegment"
                );

                if (audioIdentity) {
                    get().saveToLocalStorage();
                }
            },

            removeSegment: (id) => {
                const { structure, selectedSegmentId, audioIdentity } = get();
                if (!structure) return;

                const now = new Date().toISOString();
                const newSegments = structure.segments.filter((seg) => seg.id !== id);

                set(
                    {
                        structure: {
                            ...structure,
                            segments: newSegments,
                            modifiedAt: now,
                        },
                        selectedSegmentId: selectedSegmentId === id ? null : selectedSegmentId,
                    },
                    false,
                    "removeSegment"
                );

                if (audioIdentity) {
                    get().saveToLocalStorage();
                }
            },

            splitSegmentAt: (id, splitTime) => {
                const { structure, audioIdentity } = get();
                if (!structure) return null;

                const segment = structure.segments.find((seg) => seg.id === id);
                if (!segment) return null;

                try {
                    const [before, after] = splitSegmentUtil(segment, splitTime);
                    const now = new Date().toISOString();

                    const newSegments = sortSegments([
                        ...structure.segments.filter((seg) => seg.id !== id),
                        before,
                        after,
                    ]);

                    set(
                        {
                            structure: {
                                ...structure,
                                segments: newSegments,
                                modifiedAt: now,
                            },
                        },
                        false,
                        "splitSegmentAt"
                    );

                    if (audioIdentity) {
                        get().saveToLocalStorage();
                    }

                    return [before.id, after.id];
                } catch (error) {
                    console.error("Failed to split segment:", error);
                    return null;
                }
            },

            // ----------------------------
            // Selection
            // ----------------------------

            selectSegment: (id) => {
                set({ selectedSegmentId: id }, false, "selectSegment");
            },

            setEditing: (editing) => {
                set({ isEditing: editing }, false, "setEditing");
            },

            // ----------------------------
            // Queries
            // ----------------------------

            getSegmentAtTime: (time) => {
                const { structure } = get();
                if (!structure) return null;

                for (const segment of structure.segments) {
                    if (time >= segment.startTime && time < segment.endTime) {
                        return segment;
                    }
                }
                return null;
            },

            getBeatPositionAt: (time) => {
                const { structure, lastKnownBeatPosition } = get();
                const beatPos = computeBeatPositionFromStructure(time, structure);

                if (beatPos) {
                    // Update last known position
                    set({ lastKnownBeatPosition: beatPos }, false, "updateLastKnownBeatPosition");
                    return beatPos;
                }

                // Return last known position ("freeze" behavior)
                return lastKnownBeatPosition;
            },

            // ----------------------------
            // Structure Management
            // ----------------------------

            clearStructure: () => {
                const { audioIdentity } = get();
                set(
                    {
                        structure: null,
                        selectedSegmentId: null,
                        lastKnownBeatPosition: null,
                    },
                    false,
                    "clearStructure"
                );

                if (audioIdentity) {
                    get().clearLocalStorage();
                }
            },

            ensureStructure: () => {
                const { structure } = get();
                if (!structure) {
                    set({ structure: createMusicalTimeStructure() }, false, "ensureStructure");
                }
            },

            // ----------------------------
            // Persistence
            // ----------------------------

            saveToLocalStorage: () => {
                const { structure, audioIdentity } = get();
                if (!structure || !audioIdentity) return;

                const key = getStorageKey(audioIdentity);
                const persisted: PersistedMusicalTime = {
                    version: 1,
                    audioIdentity,
                    structure,
                };

                try {
                    localStorage.setItem(key, JSON.stringify(persisted));
                } catch (error) {
                    console.error("Failed to save musical time to localStorage:", error);
                }
            },

            loadFromLocalStorage: () => {
                const { audioIdentity } = get();
                if (!audioIdentity) return false;

                const key = getStorageKey(audioIdentity);

                try {
                    const json = localStorage.getItem(key);
                    if (!json) return false;

                    const persisted = JSON.parse(json) as PersistedMusicalTime;

                    // Version check
                    if (persisted.version !== 1) {
                        console.warn(`Unknown musical time version: ${persisted.version}`);
                        return false;
                    }

                    // Validate audio identity matches
                    const { filename, duration, sampleRate } = persisted.audioIdentity;
                    if (
                        filename !== audioIdentity.filename ||
                        Math.abs(duration - audioIdentity.duration) > 0.1 ||
                        sampleRate !== audioIdentity.sampleRate
                    ) {
                        console.warn("Audio identity mismatch - not loading persisted data");
                        return false;
                    }

                    set(
                        {
                            structure: persisted.structure,
                            selectedSegmentId: null,
                            lastKnownBeatPosition: null,
                        },
                        false,
                        "loadFromLocalStorage"
                    );

                    return true;
                } catch (error) {
                    console.error("Failed to load musical time from localStorage:", error);
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
                    console.error("Failed to clear musical time from localStorage:", error);
                }
            },

            exportToJSON: () => {
                const { structure } = get();
                if (!structure) return null;
                return JSON.stringify(structure, null, 2);
            },

            importFromJSON: (json) => {
                try {
                    const structure = JSON.parse(json) as MusicalTimeStructure;

                    // Basic validation
                    if (structure.version !== 1 || !Array.isArray(structure.segments)) {
                        console.error("Invalid musical time structure");
                        return false;
                    }

                    const errors = validateSegments(structure.segments);
                    if (errors.length > 0) {
                        console.warn("Validation warnings on import:", errors);
                    }

                    const { audioIdentity } = get();
                    set(
                        {
                            structure,
                            selectedSegmentId: null,
                            lastKnownBeatPosition: null,
                        },
                        false,
                        "importFromJSON"
                    );

                    if (audioIdentity) {
                        get().saveToLocalStorage();
                    }

                    return true;
                } catch (error) {
                    console.error("Failed to import musical time:", error);
                    return false;
                }
            },

            // ----------------------------
            // Reset
            // ----------------------------

            reset: () => {
                set(initialState, false, "reset");
            },
        }),
        { name: "musical-time-store" }
    )
);
