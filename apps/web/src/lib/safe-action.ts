import { createSafeActionClient } from 'next-safe-action';
import { getDbUser } from '@/lib/auth/syncUser';
import type { User } from '@/lib/db';

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
