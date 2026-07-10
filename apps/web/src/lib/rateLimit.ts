import { Prisma, prisma } from "@/lib/db";
import { createHash } from "node:crypto";

export interface RateLimitConfig {
  maxRequests: number;
  windowMs: number;
}

export const RATE_LIMITS = {
  STRICT: { maxRequests: 5, windowMs: 60_000 },
  MODERATE: { maxRequests: 20, windowMs: 60_000 },
  LENIENT: { maxRequests: 60, windowMs: 60_000 },
  VERY_LENIENT: { maxRequests: 120, windowMs: 60_000 },
} as const;

interface RateLimitRow {
  count: number;
  expiresAt: Date;
}

/**
 * Atomically increment a fixed-window counter in PostgreSQL. The bucket key
 * includes the policy so two action tiers cannot consume one another's quota.
 */
export async function checkRateLimit(
  identifier: string,
  config: RateLimitConfig = RATE_LIMITS.MODERATE
): Promise<{ success: boolean; remaining: number; reset: number }> {
  const now = Date.now();
  const windowStartMs = Math.floor(now / config.windowMs) * config.windowMs;
  const windowStart = new Date(windowStartMs);
  const expiresAt = new Date(windowStartMs + config.windowMs);
  const identifierHash = createHash("sha256").update(identifier).digest("hex");
  const key = `${config.maxRequests}:${config.windowMs}:${identifierHash}`;

  const rows = await prisma.$queryRaw<RateLimitRow[]>(Prisma.sql`
    INSERT INTO "RateLimitBucket" ("key", "windowStart", "count", "expiresAt")
    VALUES (${key}, ${windowStart}, 1, ${expiresAt})
    ON CONFLICT ("key") DO UPDATE SET
      "count" = CASE
        WHEN "RateLimitBucket"."windowStart" = EXCLUDED."windowStart"
          THEN "RateLimitBucket"."count" + 1
        ELSE 1
      END,
      "windowStart" = EXCLUDED."windowStart",
      "expiresAt" = EXCLUDED."expiresAt"
    RETURNING "count", "expiresAt"
  `);

  const row = rows[0];
  if (!row) throw new Error("Rate limit storage did not return a counter");

  // Opportunistic cleanup keeps the table bounded without a separate worker.
  if (Math.random() < 0.01) {
    await prisma.rateLimitBucket.deleteMany({ where: { expiresAt: { lt: new Date(now) } } });
  }

  return {
    success: row.count <= config.maxRequests,
    remaining: Math.max(0, config.maxRequests - row.count),
    reset: row.expiresAt.getTime(),
  };
}

export function getClientIdentifier(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  const firstForwarded = forwarded?.split(",")[0]?.trim();
  if (firstForwarded) return firstForwarded;

  const realIp = headers.get("x-real-ip");
  return realIp || "unknown";
}
