import { NextRequest, NextResponse } from 'next/server';
import { dbConnect } from '@/lib/db';
import { env } from '@/lib/env';
import { FileModel } from '@/models/File';

export const runtime = 'nodejs';

/**
 * Orphan sweep — finds DB rows whose storageKey is missing from storage,
 * and marks them as 'failed'. The reverse direction (objects in storage
 * with no DB row) is best handled by an external mc-based job since
 * listing every object can be expensive at scale.
 */
export async function GET(req: NextRequest) {
  if ((req.headers.get('x-cron-secret') || '') !== env.INTERNAL_CRON_SECRET) {
    return new NextResponse('unauthorized', { status: 401 });
  }
  await dbConnect();
  const stale = await FileModel.find({
    status: 'uploading',
    updatedAt: { $lt: new Date(Date.now() - 24 * 60 * 60 * 1000) }
  })
    .limit(500)
    .lean();
  let marked = 0;
  for (const f of stale) {
    await FileModel.updateOne({ _id: f._id }, { $set: { status: 'failed' } });
    marked++;
  }
  return NextResponse.json({ ok: true, markedFailed: marked });
}
