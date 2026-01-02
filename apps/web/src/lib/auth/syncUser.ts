import { currentUser } from '@clerk/nextjs/server';
import { prisma, type User } from '@/lib/db';

/**
 * Syncs the current Clerk user to the database.
 * Creates the user if they don't exist, updates if they do.
 */
export async function syncCurrentUser(): Promise<User | null> {
  const clerkUser = await currentUser();

  if (!clerkUser) {
    return null;
  }

  const primaryEmail = clerkUser.emailAddresses.find(
    (e) => e.id === clerkUser.primaryEmailAddressId
  )?.emailAddress;

  if (!primaryEmail) {
    console.error('No primary email for user:', clerkUser.id);
    return null;
  }

  const user = await prisma.user.upsert({
    where: { clerkId: clerkUser.id },
    update: {
      email: primaryEmail,
      firstName: clerkUser.firstName ?? null,
      lastName: clerkUser.lastName ?? null,
      imageUrl: clerkUser.imageUrl ?? null,
    },
    create: {
      clerkId: clerkUser.id,
      email: primaryEmail,
      firstName: clerkUser.firstName ?? null,
      lastName: clerkUser.lastName ?? null,
      imageUrl: clerkUser.imageUrl ?? null,
    },
  });

  return user;
}

/**
 * Gets the current user from the database.
 * Falls back to syncing if the user doesn't exist (webhook may have failed).
 */
export async function getDbUser(): Promise<User | null> {
  const clerkUser = await currentUser();

  if (!clerkUser) {
    return null;
  }

  const existingUser = await prisma.user.findUnique({
    where: { clerkId: clerkUser.id },
  });

  if (existingUser) {
    return existingUser;
  }

  // User doesn't exist - webhook might have failed, sync now
  return syncCurrentUser();
}
