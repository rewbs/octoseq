import { Webhook } from 'svix';
import { headers } from 'next/headers';
import type { WebhookEvent } from '@clerk/nextjs/server';
import { prisma } from '@/lib/db';
import { env } from '@/lib/env';

export async function POST(req: Request) {

  const headerPayload = await headers();
  const svix_id = headerPayload.get('svix-id');
  const svix_timestamp = headerPayload.get('svix-timestamp');
  const svix_signature = headerPayload.get('svix-signature');

  if (!svix_id || !svix_timestamp || !svix_signature) {
    return new Response('Missing svix headers', { status: 400 });
  }

  const payload = await req.json();
  const body = JSON.stringify(payload);

  const wh = new Webhook(env.CLERK_WEBHOOK_SECRET);
  let evt: WebhookEvent;

  try {
    evt = wh.verify(body, {
      'svix-id': svix_id,
      'svix-timestamp': svix_timestamp,
      'svix-signature': svix_signature,
    }) as WebhookEvent;
  } catch (err) {
    console.error('Webhook verification failed:', err);
    return new Response('Webhook verification failed', { status: 400 });
  }

  const eventType = evt.type;

  if (eventType === 'user.created' || eventType === 'user.updated') {
    const { id, email_addresses, first_name, last_name, image_url } = evt.data;

    const primaryEmail = email_addresses.find(
      (e) => e.id === evt.data.primary_email_address_id
    )?.email_address;

    if (!primaryEmail) {
      console.error('No primary email for user:', id);
      return new Response('No primary email', { status: 400 });
    }

    await prisma.user.upsert({
      where: { clerkId: id },
      update: {
        email: primaryEmail,
        firstName: first_name ?? null,
        lastName: last_name ?? null,
        imageUrl: image_url ?? null,
        updatedAt: new Date(),
      },
      create: {
        clerkId: id,
        email: primaryEmail,
        firstName: first_name ?? null,
        lastName: last_name ?? null,
        imageUrl: image_url ?? null,
      },
    });
  }

  if (eventType === 'user.deleted') {
    const { id } = evt.data;

    if (id) {
      await prisma.user
        .delete({
          where: { clerkId: id },
        })
        .catch(() => {
          // User might not exist in DB yet
          console.warn('User not found for deletion:', id);
        });
    }
  }

  return new Response('OK', { status: 200 });
}
