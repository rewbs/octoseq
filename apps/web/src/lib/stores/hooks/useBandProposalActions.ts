import { useCallback } from "react";
import {
    generateBandProposals,
    type BandProposalConfig,
    type FrequencyBand,
} from "@octoseq/mir";
import { useAudioStore } from "../audioStore";
import { useFrequencyBandStore } from "../frequencyBandStore";
import { useBandProposalStore } from "../bandProposalStore";

/**
 * Hook that provides band proposal actions.
 *
 * Handles computing proposals from audio and promoting them to real bands.
 */
export function useBandProposalActions() {
    /**
     * Compute band proposals from the current audio.
     */
    const computeProposals = useCallback(async (config?: BandProposalConfig) => {
        const { audio, audioDuration } = useAudioStore.getState();
        if (!audio) {
            useBandProposalStore.getState().setError("No audio loaded");
            return;
        }

        const proposalStore = useBandProposalStore.getState();

        // Set computing state
        proposalStore.setComputing(true);
        proposalStore.setError(null);
        proposalStore.setLastConfig(config ?? null);

        try {
            // Create AudioBufferLike from AudioBuffer
            const ch0 = audio.getChannelData(0);
            const mono = new Float32Array(ch0);
            const audioLike = {
                sampleRate: audio.sampleRate,
                numberOfChannels: 1,
                getChannelData: () => mono,
            };

            // Generate proposals
            const result = await generateBandProposals(audioLike, audioDuration, {
                config,
            });

            // Store results
            proposalStore.setProposals(result.proposals);
        } catch (error) {
            const message = error instanceof Error ? error.message : "Unknown error";
            proposalStore.setError(message);
        } finally {
            proposalStore.setComputing(false);
        }
    }, []);

    /**
     * Promote a proposal to a real FrequencyBand.
     * The proposal is removed from the proposal list after promotion.
     */
    const promoteProposal = useCallback((proposalId: string) => {
        const proposalStore = useBandProposalStore.getState();
        const frequencyBandStore = useFrequencyBandStore.getState();

        const proposal = proposalStore.getProposalById(proposalId);
        if (!proposal) return;

        // Ensure band structure exists
        frequencyBandStore.ensureStructure();

        // Add the band with updated provenance
        const bandToAdd: Omit<FrequencyBand, "id"> = {
            ...proposal.band,
            // Update provenance to indicate it was imported from a proposal
            provenance: {
                source: "imported",
                createdAt: new Date().toISOString(),
            },
        };

        frequencyBandStore.addBand(bandToAdd);

        // Remove from proposals
        proposalStore.dismissProposal(proposalId);
    }, []);

    /**
     * Promote all proposals to real FrequencyBands.
     */
    const promoteAllProposals = useCallback(() => {
        const proposalStore = useBandProposalStore.getState();
        const proposals = [...proposalStore.proposals];

        for (const proposal of proposals) {
            promoteProposal(proposal.id);
        }
    }, [promoteProposal]);

    /**
     * Dismiss a proposal (remove it without promoting).
     */
    const dismissProposal = useCallback((proposalId: string) => {
        useBandProposalStore.getState().dismissProposal(proposalId);
    }, []);

    /**
     * Dismiss all proposals.
     */
    const dismissAllProposals = useCallback(() => {
        useBandProposalStore.getState().clearProposals();
    }, []);

    /**
     * Start auditioning a proposal (for audio preview).
     */
    const startAudition = useCallback((proposalId: string) => {
        useBandProposalStore.getState().startAudition(proposalId);
    }, []);

    /**
     * Stop auditioning.
     */
    const stopAudition = useCallback(() => {
        useBandProposalStore.getState().stopAudition();
    }, []);

    /**
     * Inspect a proposal (show details).
     */
    const inspectProposal = useCallback((proposalId: string | null) => {
        useBandProposalStore.getState().inspectProposal(proposalId);
    }, []);

    return {
        computeProposals,
        promoteProposal,
        promoteAllProposals,
        dismissProposal,
        dismissAllProposals,
        startAudition,
        stopAudition,
        inspectProposal,
    };
}
