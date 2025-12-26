import { create } from "zustand";
import { devtools } from "zustand/middleware";
import type { BandProposal, BandProposalConfig } from "@octoseq/mir";

// ----------------------------
// Store State
// ----------------------------

interface BandProposalState {
    /**
     * Current set of proposals (ephemeral, never persisted).
     * Proposals are cleared on audio change or explicit user action.
     */
    proposals: BandProposal[];

    /** Whether proposals are currently being computed. */
    isComputing: boolean;

    /** Last computation error, if any. */
    error: string | null;

    /** Config used for last computation. */
    lastConfig: BandProposalConfig | null;

    /** ID of proposal currently being inspected. */
    inspectedProposalId: string | null;

    /** ID of proposal currently being auditioned. */
    auditioningProposalId: string | null;
}

// ----------------------------
// Store Actions
// ----------------------------

interface BandProposalActions {
    /** Set the proposals (called after computation). */
    setProposals: (proposals: BandProposal[]) => void;

    /** Clear all proposals. */
    clearProposals: () => void;

    /** Set computing state. */
    setComputing: (computing: boolean) => void;

    /** Set error state. */
    setError: (error: string | null) => void;

    /** Set the last config used. */
    setLastConfig: (config: BandProposalConfig | null) => void;

    /** Set the inspected proposal ID. */
    inspectProposal: (id: string | null) => void;

    /** Start auditioning a proposal. */
    startAudition: (id: string) => void;

    /** Stop auditioning. */
    stopAudition: () => void;

    /**
     * Dismiss a proposal (remove it from the list).
     * This is different from promotion - dismissed proposals are just removed.
     */
    dismissProposal: (id: string) => void;

    /**
     * Get a proposal by ID.
     */
    getProposalById: (id: string) => BandProposal | null;

    /** Full reset (called on audio change). */
    reset: () => void;
}

export type BandProposalStore = BandProposalState & BandProposalActions;

// ----------------------------
// Initial State
// ----------------------------

const initialState: BandProposalState = {
    proposals: [],
    isComputing: false,
    error: null,
    lastConfig: null,
    inspectedProposalId: null,
    auditioningProposalId: null,
};

// ----------------------------
// Store Implementation
// ----------------------------

export const useBandProposalStore = create<BandProposalStore>()(
    devtools(
        (set, get) => ({
            ...initialState,

            setProposals: (proposals) => {
                set(
                    {
                        proposals,
                        error: null,
                        inspectedProposalId: null,
                        auditioningProposalId: null,
                    },
                    false,
                    "setProposals"
                );
            },

            clearProposals: () => {
                set(
                    {
                        proposals: [],
                        error: null,
                        inspectedProposalId: null,
                        auditioningProposalId: null,
                    },
                    false,
                    "clearProposals"
                );
            },

            setComputing: (computing) => {
                set({ isComputing: computing }, false, "setComputing");
            },

            setError: (error) => {
                set({ error, isComputing: false }, false, "setError");
            },

            setLastConfig: (config) => {
                set({ lastConfig: config }, false, "setLastConfig");
            },

            inspectProposal: (id) => {
                set({ inspectedProposalId: id }, false, "inspectProposal");
            },

            startAudition: (id) => {
                set({ auditioningProposalId: id }, false, "startAudition");
            },

            stopAudition: () => {
                set({ auditioningProposalId: null }, false, "stopAudition");
            },

            dismissProposal: (id) => {
                const { proposals, inspectedProposalId, auditioningProposalId } = get();

                set(
                    {
                        proposals: proposals.filter((p) => p.id !== id),
                        inspectedProposalId: inspectedProposalId === id ? null : inspectedProposalId,
                        auditioningProposalId: auditioningProposalId === id ? null : auditioningProposalId,
                    },
                    false,
                    "dismissProposal"
                );
            },

            getProposalById: (id) => {
                const { proposals } = get();
                return proposals.find((p) => p.id === id) ?? null;
            },

            reset: () => {
                set(initialState, false, "reset");
            },
        }),
        { name: "band-proposal-store" }
    )
);
