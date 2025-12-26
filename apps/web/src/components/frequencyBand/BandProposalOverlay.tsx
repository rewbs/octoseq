"use client";

import { useEffect, useRef, useCallback, type MouseEvent } from "react";
import type { BandProposal, MelConversionConfig } from "@octoseq/mir";
import { frequencyBoundsAt, hzToFeatureIndex } from "@octoseq/mir";

// ----------------------------
// Types
// ----------------------------

export type BandProposalOverlayProps = {
    /** Visible time range in seconds. */
    startTime: number;
    endTime: number;

    /** Canvas dimensions. */
    width: number;
    height: number;

    /** Band proposals to render. */
    proposals: BandProposal[];

    /** Currently inspected proposal ID. */
    inspectedProposalId: string | null;

    /** Mel spectrogram configuration for Hz to Y mapping. */
    melConfig: MelConversionConfig;

    /** Callback when a proposal is clicked. */
    onProposalClick?: (proposalId: string) => void;

    /** Callback when mouse hovers over a proposal. */
    onProposalHover?: (proposalId: string | null) => void;
};

// ----------------------------
// Constants
// ----------------------------

/** Proposal colors - using orange/amber tones to distinguish from regular bands. */
const PROPOSAL_COLOR = { r: 251, g: 146, b: 60 }; // Orange-400

// ----------------------------
// Helpers
// ----------------------------

/**
 * Convert Hz to Y pixel position.
 */
function hzToY(hz: number, height: number, melConfig: MelConversionConfig): number {
    const featureIndex = hzToFeatureIndex(hz, melConfig);
    const normalized = featureIndex / (melConfig.nMels - 1);
    return height * (1 - normalized);
}

/**
 * Convert time to X pixel position.
 */
function timeToX(time: number, startTime: number, endTime: number, width: number): number {
    if (endTime <= startTime) return 0;
    return ((time - startTime) / (endTime - startTime)) * width;
}

/**
 * Convert X pixel position to time.
 */
function xToTime(x: number, startTime: number, endTime: number, width: number): number {
    if (width <= 0) return startTime;
    return startTime + (x / width) * (endTime - startTime);
}

// ----------------------------
// Component
// ----------------------------

export function BandProposalOverlay({
    startTime,
    endTime,
    width,
    height,
    proposals,
    inspectedProposalId,
    melConfig,
    onProposalClick,
    onProposalHover,
}: BandProposalOverlayProps) {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const hoveredProposalRef = useRef<string | null>(null);

    // Render proposals to canvas
    const renderProposals = useCallback(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        // Clear canvas
        ctx.clearRect(0, 0, width, height);

        if (proposals.length === 0) return;

        // Sample time points for rendering band shapes
        const numSamples = Math.max(2, Math.ceil(width / 4));
        const timeStep = (endTime - startTime) / (numSamples - 1);

        // Render each proposal
        proposals.forEach((proposal) => {
            const band = proposal.band;
            const isInspected = proposal.id === inspectedProposalId;
            const isHovered = proposal.id === hoveredProposalRef.current;

            // Determine visual style based on salience and state
            let fillAlpha = 0.15 + proposal.salience * 0.1;
            let strokeAlpha = 0.5 + proposal.salience * 0.3;
            let strokeWidth = 1.5;

            if (isInspected) {
                fillAlpha = 0.3 + proposal.salience * 0.1;
                strokeAlpha = 0.9;
                strokeWidth = 2.5;
            } else if (isHovered) {
                fillAlpha = 0.25 + proposal.salience * 0.1;
                strokeAlpha = 0.8;
                strokeWidth = 2;
            }

            // Build the band shape as a polygon
            const topPoints: { x: number; y: number }[] = [];
            const bottomPoints: { x: number; y: number }[] = [];

            for (let i = 0; i < numSamples; i++) {
                const t = startTime + i * timeStep;
                const bounds = frequencyBoundsAt(band, t);

                if (bounds) {
                    const x = timeToX(t, startTime, endTime, width);
                    const yHigh = hzToY(bounds.highHz, height, melConfig);
                    const yLow = hzToY(bounds.lowHz, height, melConfig);

                    topPoints.push({ x, y: yHigh });
                    bottomPoints.push({ x, y: yLow });
                }
            }

            if (topPoints.length < 2) return;

            // Draw filled polygon
            ctx.beginPath();
            ctx.moveTo(topPoints[0]!.x, topPoints[0]!.y);

            // Top edge (high frequency)
            for (let i = 1; i < topPoints.length; i++) {
                ctx.lineTo(topPoints[i]!.x, topPoints[i]!.y);
            }

            // Bottom edge (low frequency) - reversed
            for (let i = bottomPoints.length - 1; i >= 0; i--) {
                ctx.lineTo(bottomPoints[i]!.x, bottomPoints[i]!.y);
            }

            ctx.closePath();

            // Fill with lower opacity
            ctx.fillStyle = `rgba(${PROPOSAL_COLOR.r}, ${PROPOSAL_COLOR.g}, ${PROPOSAL_COLOR.b}, ${fillAlpha})`;
            ctx.fill();

            // Dashed stroke to distinguish from real bands
            ctx.strokeStyle = `rgba(${PROPOSAL_COLOR.r}, ${PROPOSAL_COLOR.g}, ${PROPOSAL_COLOR.b}, ${strokeAlpha})`;
            ctx.lineWidth = strokeWidth;
            ctx.setLineDash([6, 4]); // Dashed line
            ctx.stroke();
            ctx.setLineDash([]); // Reset

            // Draw salience indicator bar at left edge
            if (isInspected || isHovered) {
                const barWidth = 4;
                const barHeight = Math.abs(
                    hzToY(band.frequencyShape[0]?.highHzStart ?? 0, height, melConfig) -
                    hzToY(band.frequencyShape[0]?.lowHzStart ?? 0, height, melConfig)
                );
                const barX = topPoints[0]!.x - barWidth - 2;
                const barY = topPoints[0]!.y;

                // Background
                ctx.fillStyle = `rgba(0, 0, 0, 0.3)`;
                ctx.fillRect(barX, barY, barWidth, barHeight);

                // Salience fill (from bottom)
                const salienceHeight = barHeight * proposal.salience;
                ctx.fillStyle = `rgba(${PROPOSAL_COLOR.r}, ${PROPOSAL_COLOR.g}, ${PROPOSAL_COLOR.b}, 0.9)`;
                ctx.fillRect(barX, barY + barHeight - salienceHeight, barWidth, salienceHeight);
            }

            // Draw label if inspected
            if (isInspected) {
                const labelX = topPoints[0]!.x + 8;
                const labelY = (topPoints[0]!.y + bottomPoints[0]!.y) / 2;

                ctx.font = "12px sans-serif";
                ctx.fillStyle = `rgba(${PROPOSAL_COLOR.r}, ${PROPOSAL_COLOR.g}, ${PROPOSAL_COLOR.b}, 1.0)`;
                ctx.textBaseline = "middle";

                // Draw reason text
                const text = proposal.reason;
                const textWidth = ctx.measureText(text).width;

                // Background for text
                ctx.fillStyle = "rgba(0, 0, 0, 0.7)";
                ctx.fillRect(labelX - 4, labelY - 10, textWidth + 8, 20);

                // Text
                ctx.fillStyle = `rgba(${PROPOSAL_COLOR.r}, ${PROPOSAL_COLOR.g}, ${PROPOSAL_COLOR.b}, 1.0)`;
                ctx.fillText(text, labelX, labelY);
            }
        });
    }, [proposals, inspectedProposalId, startTime, endTime, width, height, melConfig]);

    // Re-render when dependencies change
    useEffect(() => {
        renderProposals();
    }, [renderProposals]);

    // Hit test: find which proposal is under the cursor
    const hitTestProposal = useCallback(
        (clientX: number, clientY: number): string | null => {
            const canvas = canvasRef.current;
            if (!canvas || proposals.length === 0) return null;

            const rect = canvas.getBoundingClientRect();
            const x = clientX - rect.left;
            const y = clientY - rect.top;

            if (x < 0 || x > width || y < 0 || y > height) return null;

            const time = xToTime(x, startTime, endTime, width);

            // Check proposals in reverse order
            for (let i = proposals.length - 1; i >= 0; i--) {
                const proposal = proposals[i];
                if (!proposal) continue;

                const bounds = frequencyBoundsAt(proposal.band, time);
                if (!bounds) continue;

                const yHigh = hzToY(bounds.highHz, height, melConfig);
                const yLow = hzToY(bounds.lowHz, height, melConfig);

                if (y >= yHigh && y <= yLow) {
                    return proposal.id;
                }
            }

            return null;
        },
        [proposals, startTime, endTime, width, height, melConfig]
    );

    // Mouse handlers
    const handleMouseMove = useCallback(
        (e: MouseEvent<HTMLCanvasElement>) => {
            const proposalId = hitTestProposal(e.clientX, e.clientY);

            // Update cursor
            const canvas = canvasRef.current;
            if (canvas) {
                canvas.style.cursor = proposalId ? "pointer" : "default";
            }

            // Track hover state for rendering
            if (proposalId !== hoveredProposalRef.current) {
                hoveredProposalRef.current = proposalId;
                renderProposals();
            }

            onProposalHover?.(proposalId);
        },
        [hitTestProposal, onProposalHover, renderProposals]
    );

    const handleMouseLeave = useCallback(() => {
        hoveredProposalRef.current = null;
        renderProposals();
        onProposalHover?.(null);

        const canvas = canvasRef.current;
        if (canvas) {
            canvas.style.cursor = "default";
        }
    }, [onProposalHover, renderProposals]);

    const handleClick = useCallback(
        (e: MouseEvent<HTMLCanvasElement>) => {
            const proposalId = hitTestProposal(e.clientX, e.clientY);
            if (proposalId) {
                onProposalClick?.(proposalId);
            }
        },
        [hitTestProposal, onProposalClick]
    );

    return (
        <canvas
            ref={canvasRef}
            width={width}
            height={height}
            className="absolute top-0 left-0 pointer-events-auto"
            style={{ width, height }}
            onMouseMove={handleMouseMove}
            onMouseLeave={handleMouseLeave}
            onClick={handleClick}
        />
    );
}
