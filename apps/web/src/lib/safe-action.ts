import { createSafeActionClient } from 'next-safe-action';
import { headers } from 'next/headers';
import { getDbUser } from '@/lib/auth/syncUser';
import type { User } from '@/lib/db';
import {
  checkRateLimit,
  getClientIdentifier,
  RATE_LIMITS,
} from '@/lib/rateLimit';

import type { RateLimitConfig } from '@/lib/rateLimit';

// -----------------------------------------------------------------------------
// Base action client with error handling
// -----------------------------------------------------------------------------

const baseClient = createSafeActionClient({
  handleServerError: (error) => {
    console.error('Server action error:', error);

    // Return generic message in production, detailed in dev
    if (process.env.NODE_ENV === 'development') {
      return error.message;
    }
    return 'An unexpected error occurred';
  },
});

// -----------------------------------------------------------------------------
// Public action client (no auth required)
// Optionally includes user if authenticated
// -----------------------------------------------------------------------------

export const publicAction = baseClient;

// -----------------------------------------------------------------------------
// Authenticated action client
// Requires authentication, lazy-creates user record, adds user to context
// -----------------------------------------------------------------------------

export const authAction = baseClient.use(async ({ next }) => {
  const user = await getDbUser();

  if (!user) {
    throw new Error('Unauthorized');
  }

  return next({ ctx: { user } });
});

// -----------------------------------------------------------------------------
// Rate-limited action clients
// -----------------------------------------------------------------------------

/**
 * Create a rate-limited action client with custom configuration.
 *
 * @param rateLimitConfig - Rate limit configuration (from RATE_LIMITS constants)
 * @param useUserIdentifier - If true, uses user ID for rate limiting (requires auth).
 *                            If false, uses IP address (works for public actions).
 */
function createRateLimitedClient(
  rateLimitConfig: RateLimitConfig,
  useUserIdentifier = false
) {
  return baseClient.use(async ({ next }) => {
    // Get identifier for rate limiting
    const identifier = useUserIdentifier
      ? (await getDbUser())?.id ?? getClientIdentifier(await headers())
      : getClientIdentifier(await headers());

    // Check rate limit
    const result = await checkRateLimit(identifier, rateLimitConfig);

    if (!result.success) {
      const resetDate = new Date(result.reset);
      throw new Error(
        `Rate limit exceeded. Please try again at ${resetDate.toLocaleTimeString()}`
      );
    }

    return next({ ctx: {} });
  });
}

/**
 * Public action with strict rate limiting (5 req/min by IP).
 * Use for expensive or sensitive public operations (e.g., account creation).
 */
export const publicActionStrict = createRateLimitedClient(RATE_LIMITS.STRICT, false);

/**
 * Public action with moderate rate limiting (20 req/min by IP).
 * Use for standard public operations (e.g., viewing public projects).
 */
export const publicActionModerate = createRateLimitedClient(RATE_LIMITS.MODERATE, false);

/**
 * Authenticated action with strict rate limiting (5 req/min per user).
 * Use for expensive write operations (e.g., project creation, deletion).
 */
export const authActionStrict = createRateLimitedClient(RATE_LIMITS.STRICT, true).use(
  async ({ next }) => {
    const user = await getDbUser();

    if (!user) {
      throw new Error('Unauthorized');
    }

    return next({ ctx: { user } });
  }
);

/**
 * Authenticated action with moderate rate limiting (20 req/min per user).
 * Use for standard write operations (e.g., updating projects, creating bands).
 */
export const authActionModerate = createRateLimitedClient(RATE_LIMITS.MODERATE, true).use(
  async ({ next }) => {
    const user = await getDbUser();

    if (!user) {
      throw new Error('Unauthorized');
    }

    return next({ ctx: { user } });
  }
);

/**
 * Authenticated action with lenient rate limiting (60 req/min per user).
 * Use for frequent read operations or lightweight updates (e.g., fetching data).
 */
export const authActionLenient = createRateLimitedClient(RATE_LIMITS.LENIENT, true).use(
  async ({ next }) => {
    const user = await getDbUser();

    if (!user) {
      throw new Error('Unauthorized');
    }

    return next({ ctx: { user } });
  }
);

// -----------------------------------------------------------------------------
// Type exports for use in actions
// -----------------------------------------------------------------------------

export type ActionContext = {
  user: User;
};

// -----------------------------------------------------------------------------
// Ownership check utilities
// -----------------------------------------------------------------------------

/**
 * Checks if the user owns the resource.
 * Throws an error if ownership check fails.
 */
export function assertOwnership(
  user: User,
  resourceOwnerId: string,
  resourceType = 'resource'
): void {
  if (user.id !== resourceOwnerId) {
    throw new Error(`You do not have permission to modify this ${resourceType}`);
  }
}

/**
 * Checks if the user can read the resource.
 * Public resources can be read by anyone, private resources require ownership.
 */
export function canRead(
  user: User | null,
  resourceOwnerId: string,
  isPublic: boolean
): boolean {
  if (isPublic) return true;
  if (!user) return false;
  return user.id === resourceOwnerId;
}

/**
 * Asserts that the user can read the resource.
 * Throws an error if the check fails.
 */
export function assertCanRead(
  user: User | null,
  resourceOwnerId: string,
  isPublic: boolean,
  resourceType = 'resource'
): void {
  if (!canRead(user, resourceOwnerId, isPublic)) {
    throw new Error(`You do not have permission to view this ${resourceType}`);
  }
}
