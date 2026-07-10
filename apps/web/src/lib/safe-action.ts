import { createSafeActionClient } from "next-safe-action";
import { headers } from "next/headers";
import { getDbUser } from "@/lib/auth/syncUser";
import type { User } from "@/lib/db";
import { checkRateLimit, getClientIdentifier, RATE_LIMITS } from "@/lib/rateLimit";

import type { RateLimitConfig } from "@/lib/rateLimit";

// -----------------------------------------------------------------------------
// Base action client with error handling
// -----------------------------------------------------------------------------

const baseClient = createSafeActionClient({
  handleServerError: (error) => {
    console.error("Server action error:", error);

    // Return generic message in production, detailed in dev
    if (process.env.NODE_ENV === "development") {
      return error.message;
    }
    return "An unexpected error occurred";
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
    throw new Error("Unauthorized");
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
 */
function createRateLimitedClient(rateLimitConfig: RateLimitConfig, namespace: string) {
  return baseClient.use(async ({ next }) => {
    const identifier = getClientIdentifier(await headers());
    const result = await checkRateLimit(`${namespace}:${identifier}`, rateLimitConfig);

    if (!result.success) {
      const resetDate = new Date(result.reset);
      throw new Error(`Rate limit exceeded. Please try again at ${resetDate.toLocaleTimeString()}`);
    }

    return next({ ctx: {} });
  });
}

function createAuthenticatedRateLimitedClient(rateLimitConfig: RateLimitConfig, namespace: string) {
  return baseClient.use(async ({ next }) => {
    const user = await getDbUser();
    if (!user) throw new Error("Unauthorized");

    const result = await checkRateLimit(`${namespace}:${user.id}`, rateLimitConfig);
    if (!result.success) {
      const resetDate = new Date(result.reset);
      throw new Error(`Rate limit exceeded. Please try again at ${resetDate.toLocaleTimeString()}`);
    }

    return next({ ctx: { user } });
  });
}

/**
 * Public action with strict rate limiting (5 req/min by IP).
 * Use for expensive or sensitive public operations (e.g., account creation).
 */
export const publicActionStrict = createRateLimitedClient(RATE_LIMITS.STRICT, "public-strict");

/**
 * Public action with moderate rate limiting (20 req/min by IP).
 * Use for standard public operations (e.g., viewing public projects).
 */
export const publicActionModerate = createRateLimitedClient(
  RATE_LIMITS.MODERATE,
  "public-moderate"
);

/** Public read action with lenient rate limiting (60 req/min by IP). */
export const publicActionLenient = createRateLimitedClient(RATE_LIMITS.LENIENT, "public-lenient");

/**
 * Authenticated action with strict rate limiting (5 req/min per user).
 * Use for expensive write operations (e.g., project creation, deletion).
 */
export const authActionStrict = createAuthenticatedRateLimitedClient(
  RATE_LIMITS.STRICT,
  "auth-strict"
);

/**
 * Authenticated action with moderate rate limiting (20 req/min per user).
 * Use for standard write operations (e.g., updating projects, creating bands).
 */
export const authActionModerate = createAuthenticatedRateLimitedClient(
  RATE_LIMITS.MODERATE,
  "auth-moderate"
);

/**
 * Authenticated action with lenient rate limiting (60 req/min per user).
 * Use for frequent read operations or lightweight updates (e.g., fetching data).
 */
export const authActionLenient = createAuthenticatedRateLimitedClient(
  RATE_LIMITS.LENIENT,
  "auth-lenient"
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
  resourceType = "resource"
): void {
  if (user.id !== resourceOwnerId) {
    throw new Error(`You do not have permission to modify this ${resourceType}`);
  }
}

/**
 * Checks if the user can read the resource.
 * Public resources can be read by anyone, private resources require ownership.
 */
export function canRead(user: User | null, resourceOwnerId: string, isPublic: boolean): boolean {
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
  resourceType = "resource"
): void {
  if (!canRead(user, resourceOwnerId, isPublic)) {
    throw new Error(`You do not have permission to view this ${resourceType}`);
  }
}
