import { useCallback } from "react";
import {
    generateBandProposals,
    type BandProposalConfig,
    type FrequencyBand,
} from "@octoseq/mir";
import { useAudioInputStore } from "../audioInputStore";
import { MIXDOWN_ID } from "../types/audioInput";
import { useFrequencyBandStore } from "../frequencyBandStore";
import { useBandProposalStore } from "../bandProposalStore";

/**
 * Hook that provides band proposal actions.
 *
 * Handles computing proposals from audio and promoting them to real bands.
 */
export function useBandProposalActions() {
    /**
     * Compute band proposals from the specified audio source.
     * @param sourceId - The audio source ID ("mixdown" or a stem ID). Defaults to "mixdown".
     * @param config - Optional configuration for proposal generation.
     */
    const computeProposals = useCallback(async (sourceId: string = MIXDOWN_ID, config?: BandProposalConfig) => {
        // Get the correct audio buffer based on sourceId
        const audioInputStore = useAudioInputStore.getState();
        const audioDuration = audioInputStore.getAudioDuration();
        const audioInput = audioInputStore.getInputById(sourceId);

        if (!audioInput?.audioBuffer) {
            useBandProposalStore.getState().setError(`No audio loaded for source: ${sourceId}`);
            return;
        }

        const proposalStore = useBandProposalStore.getState();

        // Set computing state
        proposalStore.setComputing(true);
        proposalStore.setError(null);
        proposalStore.setLastConfig(config ?? null);

        try {
            // Use the audio buffer from the specified source
            const audioBuffer = audioInput.audioBuffer;
            const ch0 = audioBuffer.getChannelData(0);
            const mono = new Float32Array(ch0);
            const audioLike = {
                sampleRate: audioBuffer.sampleRate,
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
     * @param proposalId - The ID of the proposal to promote.
     * @param sourceId - The audio source ID to assign to the band. Defaults to "mixdown".
     */
    const promoteProposal = useCallback((proposalId: string, sourceId: string = MIXDOWN_ID) => {
        const proposalStore = useBandProposalStore.getState();
        const frequencyBandStore = useFrequencyBandStore.getState();

        const proposal = proposalStore.getProposalById(proposalId);
        if (!proposal) return;

        // Ensure band structure exists
        frequencyBandStore.ensureStructure();

        // Add the band with updated provenance and correct sourceId
        const bandToAdd: Omit<FrequencyBand, "id"> = {
            ...proposal.band,
            // Override sourceId with the correct audio source
            sourceId,
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
     * @param sourceId - The audio source ID to assign to all promoted bands. Defaults to "mixdown".
     */
    const promoteAllProposals = useCallback((sourceId: string = MIXDOWN_ID) => {
        const proposalStore = useBandProposalStore.getState();
        const proposals = [...proposalStore.proposals];

        for (const proposal of proposals) {
            promoteProposal(proposal.id, sourceId);
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
