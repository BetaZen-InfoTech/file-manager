import { NextRequest, NextResponse } from 'next/server';
import { dbConnect } from '@/lib/db';
import { env } from '@/lib/env';
import { syncAllVendorsUsage } from '@/lib/vendor-stats';

export const runtime = 'nodejs';
export const maxDuration = 300;

// Periodic reconciliation of cached storage counters. Uses the same routine as
// the admin "Sync" button, so cron and manual sync stay identical (and both fix
// per-bucket counters as well as Vendor.usage).
export async function GET(req: NextRequest) {
  if ((req.headers.get('x-cron-secret') || '') !== env.INTERNAL_CRON_SECRET) {
    return new NextResponse('unauthorized', { status: 401 });
  }
  await dbConnect();
  const result = await syncAllVendorsUsage();
  return NextResponse.json({ ok: true, updated: result.vendors, ...result });
}
