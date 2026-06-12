import { NextRequest, NextResponse } from 'next/server';
import { dbConnect } from '@/lib/db';
import { env } from '@/lib/env';
import { storage } from '@/lib/storage';
import { FileModel } from '@/models/File';

export const runtime = 'nodejs';

/**
 * Orphan sweep — aborts and fails multipart uploads abandoned mid-flight.
 * Drafts stuck in 'uploading' past 24h have their S3/MinIO multipart upload
 * aborted (so the already-uploaded parts stop consuming storage) and are then
 * marked 'failed'. The reverse direction (objects in storage with no DB row) is
 * best handled by an external mc-based job since listing every object is costly.
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
  let aborted = 0;
  for (const f of stale) {
    // Abort the live multipart upload first so its uploaded parts don't linger in
    // the bucket forever (S3/MinIO never auto-expire incomplete uploads here).
    const uploadId = (f as any).metadata?.uploadId;
    if (uploadId && f.storageKey) {
      try {
        await storage.abortMultipart(f.storageKey, uploadId);
        aborted++;
      } catch {
        /* best-effort — still mark failed below */
      }
    }
    await FileModel.updateOne({ _id: f._id }, { $set: { status: 'failed' } });
    marked++;
  }
  return NextResponse.json({ ok: true, markedFailed: marked, multipartAborted: aborted });
}
