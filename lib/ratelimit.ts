import { NextResponse } from 'next/server';
import { env } from './env';

type Bucket = { count: number; resetAt: number };

const memoryBuckets = new Map<string, Bucket>();

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
  limit: number;
}

export function applyRateLimitHeaders(res: NextResponse, r: RateLimitResult): NextResponse {
  res.headers.set('X-RateLimit-Limit', String(r.limit));
  res.headers.set('X-RateLimit-Remaining', String(r.remaining));
  res.headers.set('X-RateLimit-Reset', String(Math.ceil(r.resetAt / 1000)));
  return res;
}

export function rateLimit(key: string, limit?: number, windowMs = 60_000): RateLimitResult {
  const max = limit ?? env.RATE_LIMIT_PER_MIN;
  const now = Date.now();
  const b = memoryBuckets.get(key);
  if (!b || b.resetAt <= now) {
    const nb = { count: 1, resetAt: now + windowMs };
    memoryBuckets.set(key, nb);
    return { allowed: true, remaining: max - 1, resetAt: nb.resetAt, limit: max };
  }
  b.count += 1;
  const allowed = b.count <= max;
  return { allowed, remaining: Math.max(0, max - b.count), resetAt: b.resetAt, limit: max };
}

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of memoryBuckets) {
    if (v.resetAt <= now) memoryBuckets.delete(k);
  }
}, 60_000).unref?.();
