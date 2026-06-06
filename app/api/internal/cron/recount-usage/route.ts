import { NextRequest, NextResponse } from 'next/server';
import { dbConnect } from '@/lib/db';
import { env } from '@/lib/env';
import { Vendor } from '@/models/Vendor';
import { FileModel } from '@/models/File';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  if ((req.headers.get('x-cron-secret') || '') !== env.INTERNAL_CRON_SECRET) {
    return new NextResponse('unauthorized', { status: 401 });
  }
  await dbConnect();
  const totals = await FileModel.aggregate([
    { $match: { status: 'ready' } },
    {
      $group: {
        _id: '$vendorId',
        storageBytes: { $sum: '$sizeBytes' },
        fileCount: { $sum: 1 }
      }
    }
  ]);
  let updated = 0;
  for (const t of totals) {
    await Vendor.updateOne(
      { _id: t._id },
      { $set: { 'usage.storageBytes': t.storageBytes, 'usage.fileCount': t.fileCount } }
    );
    updated++;
  }
  // Zero out vendors with no remaining files
  await Vendor.updateMany(
    { _id: { $nin: totals.map((t) => t._id) } },
    { $set: { 'usage.storageBytes': 0, 'usage.fileCount': 0 } }
  );
  return NextResponse.json({ ok: true, updated });
}
