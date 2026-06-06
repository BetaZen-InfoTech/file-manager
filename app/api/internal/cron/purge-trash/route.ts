import { NextRequest, NextResponse } from 'next/server';
import { dbConnect } from '@/lib/db';
import { env } from '@/lib/env';
import { storage } from '@/lib/storage';
import { FileModel } from '@/models/File';
import { decrementUsage } from '@/lib/quota';
import { Bucket } from '@/models/Bucket';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  if ((req.headers.get('x-cron-secret') || '') !== env.INTERNAL_CRON_SECRET) {
    return new NextResponse('unauthorized', { status: 401 });
  }
  await dbConnect();
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const expired = await FileModel.find({
    status: 'trashed',
    deletedAt: { $lte: cutoff }
  }).lean();
  let purged = 0;
  for (const f of expired) {
    try {
      await storage.deleteObject(f.storageKey);
    } catch {}
    await FileModel.deleteOne({ _id: f._id });
    await decrementUsage(String(f.vendorId), f.sizeBytes, 1);
    await Bucket.updateOne(
      { _id: f.bucketId },
      { $inc: { storageBytes: -f.sizeBytes, fileCount: -1 } }
    );
    purged += 1;
  }
  return NextResponse.json({ ok: true, purged });
}
