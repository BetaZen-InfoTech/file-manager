import { NextRequest, NextResponse } from 'next/server';
import { dbConnect } from '@/lib/db';
import { env } from '@/lib/env';
import { Link } from '@/models/Link';

export const runtime = 'nodejs';

function authorized(req: NextRequest): boolean {
  if (!env.INTERNAL_CRON_SECRET) return false;
  const auth = req.headers.get('x-cron-secret') || '';
  return auth === env.INTERNAL_CRON_SECRET;
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return new NextResponse('unauthorized', { status: 401 });
  await dbConnect();
  const result = await Link.updateMany(
    { status: 'active', expiresAt: { $ne: null, $lte: new Date() } },
    { $set: { status: 'expired' } }
  );
  return NextResponse.json({ ok: true, modified: result.modifiedCount });
}
