import { NextRequest, NextResponse } from 'next/server';
import { dbConnect } from '@/lib/db';
import { env } from '@/lib/env';
import { purgeExpired, evictIfNeeded } from '@/lib/cache';

export const runtime = 'nodejs';

// TTL purge + LRU eviction for the VPS file cache. Wired into cron by
// scripts/setup.sh and scripts/setup-cron.sh (every 15 minutes). Authed with
// the same x-cron-secret header as the other internal crons.
export async function GET(req: NextRequest) {
  if ((req.headers.get('x-cron-secret') || '') !== env.INTERNAL_CRON_SECRET || !env.INTERNAL_CRON_SECRET) {
    return new NextResponse('unauthorized', { status: 401 });
  }
  await dbConnect();
  const expired = await purgeExpired(new Date());
  const { evicted, freedBytes } = await evictIfNeeded();
  return NextResponse.json({ ok: true, expired, evicted, freedBytes });
}
