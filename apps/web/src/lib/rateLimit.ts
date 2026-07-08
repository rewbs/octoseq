/**
 * In-memory rate limiter for server actions.
 *
 * IMPORTANT: This implementation is suitable for development and single-instance
 * deployments. For production multi-server setups, consider using a distributed
 * rate limiting solution like @upstash/ratelimit with Redis.
 *
 * Features:
 * - Sliding window rate limiting
 * - Per-user and per-IP tracking
 * - Automatic cleanup of old entries
 * - Configurable limits per action type
 */

interface RateLimitEntry {
    timestamps: number[];
    lastCleanup: number;
}

export interface RateLimitConfig {
    /**
     * Maximum number of requests allowed within the window
     */
    maxRequests: number;

    /**
     * Time window in milliseconds
     */
    windowMs: number;
}

/**
 * Predefined rate limit configurations for different action types
 */
export const RATE_LIMITS = {
    /** Very strict: 5 requests per minute (e.g., project creation) */
    STRICT: {
        maxRequests: 5,
        windowMs: 60 * 1000, // 1 minute
    },

    /** Moderate: 20 requests per minute (e.g., project updates) */
    MODERATE: {
        maxRequests: 20,
        windowMs: 60 * 1000, // 1 minute
    },

    /** Lenient: 60 requests per minute (e.g., fetching data) */
    LENIENT: {
        maxRequests: 60,
        windowMs: 60 * 1000, // 1 minute
    },

    /** Very lenient: 120 requests per minute (e.g., real-time updates) */
    VERY_LENIENT: {
        maxRequests: 120,
        windowMs: 60 * 1000, // 1 minute
    },
} as const;

class InMemoryRateLimiter {
    private store = new Map<string, RateLimitEntry>();
    private cleanupInterval: ReturnType<typeof setInterval> | null = null;

    constructor() {
        // Cleanup old entries every 5 minutes
        this.startCleanup();
    }

    /**
     * Check if a request should be rate limited.
     *
     * @param identifier - Unique identifier (e.g., userId or IP address)
     * @param config - Rate limit configuration
     * @returns Object with success flag and remaining requests
     */
    check(
        identifier: string,
        config: RateLimitConfig
    ): { success: boolean; remaining: number; reset: number } {
        const now = Date.now();
        const windowStart = now - config.windowMs;

        // Get or create entry
        let entry = this.store.get(identifier);
        if (!entry) {
            entry = { timestamps: [], lastCleanup: now };
            this.store.set(identifier, entry);
        }

        // Remove timestamps outside the current window
        entry.timestamps = entry.timestamps.filter((ts) => ts > windowStart);

        // Check if limit exceeded
        if (entry.timestamps.length >= config.maxRequests) {
            const oldestTimestamp = entry.timestamps[0] || now;
            const reset = oldestTimestamp + config.windowMs;

            return {
                success: false,
                remaining: 0,
                reset,
            };
        }

        // Add current timestamp
        entry.timestamps.push(now);
        entry.lastCleanup = now;

        return {
            success: true,
            remaining: config.maxRequests - entry.timestamps.length,
            reset: now + config.windowMs,
        };
    }

    /**
     * Reset rate limit for a specific identifier.
     * Useful for testing or manual overrides.
     */
    reset(identifier: string): void {
        this.store.delete(identifier);
    }

    /**
     * Start automatic cleanup of old entries
     */
    private startCleanup(): void {
        if (this.cleanupInterval) return;

        this.cleanupInterval = setInterval(() => {
            const now = Date.now();
            const maxAge = 10 * 60 * 1000; // 10 minutes

            for (const [key, entry] of this.store.entries()) {
                if (now - entry.lastCleanup > maxAge) {
                    this.store.delete(key);
                }
            }
        }, 5 * 60 * 1000); // Run every 5 minutes
    }

    /**
     * Stop automatic cleanup (for testing or shutdown)
     */
    stopCleanup(): void {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
            this.cleanupInterval = null;
        }
    }

    /**
     * Get statistics about the rate limiter
     */
    getStats(): { totalIdentifiers: number; totalRequests: number } {
        let totalRequests = 0;

        for (const entry of this.store.values()) {
            totalRequests += entry.timestamps.length;
        }

        return {
            totalIdentifiers: this.store.size,
            totalRequests,
        };
    }
}

// Singleton instance
const rateLimiter = new InMemoryRateLimiter();

/**
 * Check rate limit for an identifier with the given configuration.
 *
 * Example usage:
 * ```ts
 * const result = await checkRateLimit(userId, RATE_LIMITS.STRICT);
 * if (!result.success) {
 *   throw new Error('Rate limit exceeded. Please try again later.');
 * }
 * ```
 *
 * @param identifier - Unique identifier (user ID, IP address, etc.)
 * @param config - Rate limit configuration
 * @returns Result object with success flag and metadata
 */
export async function checkRateLimit(
    identifier: string,
    config: RateLimitConfig = RATE_LIMITS.MODERATE
): Promise<{ success: boolean; remaining: number; reset: number }> {
    return rateLimiter.check(identifier, config);
}

/**
 * Reset rate limit for a specific identifier.
 * Useful for testing or administrative overrides.
 */
export function resetRateLimit(identifier: string): void {
    rateLimiter.reset(identifier);
}

/**
 * Get rate limiter statistics.
 */
export function getRateLimiterStats(): { totalIdentifiers: number; totalRequests: number } {
    return rateLimiter.getStats();
}

/**
 * Helper to get client identifier from headers.
 * Falls back to a default value if headers are unavailable.
 *
 * @param headers - Request headers (from Next.js headers() or similar)
 * @returns IP address or 'unknown'
 */
export function getClientIdentifier(headers: Headers): string {
    // Try to get real IP from various headers (handle reverse proxies)
    const forwarded = headers.get('x-forwarded-for');
    if (forwarded) {
        const firstIp = forwarded.split(',')[0];
        if (firstIp) {
            return firstIp.trim();
        }
    }

    const realIp = headers.get('x-real-ip');
    if (realIp) {
        return realIp;
    }

    // Fallback to 'unknown' - still better than no rate limiting
    return 'unknown';
}
