import { NextRequest } from 'next/server';
import mongoose from 'mongoose';
import { dbConnect } from '@/lib/db';
import { jsonOk, unauthorized } from '@/lib/http';
import { verifyTransferToken } from '@/lib/transfer-token';
import { FileModel } from '@/models/File';
import { Bucket } from '@/models/Bucket';
import { Folder } from '@/models/Folder';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function folderFullPath(path: string, name: string): string {
  const full = path === '/' ? `/${name}` : `${path}/${name}`;
  return full.replace(/^\/+/, ''); // relative, no leading slash
}

// SOURCE manifest: paginated list of ready files (keyset by _id) + folder paths.
export async function GET(req: NextRequest) {
  const tok = await verifyTransferToken(req);
  if (!tok) return unauthorized('invalid transfer token');

  await dbConnect();
  const url = new URL(req.url);
  const after = url.searchParams.get('after');
  const limit = Math.min(2000, Math.max(1, Number(url.searchParams.get('limit') || 1000)));

  // Tenant scope lives INSIDE the query so a vendor token can't read the instance.
  const scope: any = { status: 'ready' };
  if (tok.kind === 'vendor' && tok.vendorId) scope.vendorId = tok.vendorId;
  if (tok.bucketIds && tok.bucketIds.length) scope.bucketId = { $in: tok.bucketIds };

  const pageFilter = { ...scope };
  if (after && mongoose.Types.ObjectId.isValid(after)) {
    pageFilter._id = { $gt: new mongoose.Types.ObjectId(after) };
  }

  const docs = await FileModel.find(pageFilter)
    .sort({ _id: 1 })
    .limit(limit)
    .select('_id vendorId bucketId folderId originalName sizeBytes mimeType checksum')
    .lean();

  // Resolve bucket names + folder full-paths for this page.
  const bucketIds = [...new Set(docs.map((d: any) => String(d.bucketId)))];
  const folderIds = [...new Set(docs.map((d: any) => (d.folderId ? String(d.folderId) : '')).filter(Boolean))];
  const [buckets, folders] = await Promise.all([
    Bucket.find({ _id: { $in: bucketIds } }).select('name').lean(),
    Folder.find({ _id: { $in: folderIds } }).select('name path').lean()
  ]);
  const bMap = new Map(buckets.map((b: any) => [String(b._id), b.name]));
  const fMap = new Map(folders.map((f: any) => [String(f._id), folderFullPath(f.path || '/', f.name)]));

  const files = docs.map((d: any) => ({
    id: String(d._id),
    bucketName: bMap.get(String(d.bucketId)) || 'imported',
    folderPath: d.folderId ? fMap.get(String(d.folderId)) || '' : '',
    originalName: d.originalName,
    sizeBytes: d.sizeBytes,
    mimeType: d.mimeType,
    sha256: d.checksum?.sha256 || ''
  }));

  const nextAfter = docs.length === limit ? String(docs[docs.length - 1]._id) : null;

  const body: any = { files, nextAfter };
  if (!after) {
    const agg = await FileModel.aggregate([
      { $match: scope },
      { $group: { _id: null, objects: { $sum: 1 }, bytes: { $sum: '$sizeBytes' } } }
    ]);
    body.summary = { objects: agg[0]?.objects || 0, bytes: agg[0]?.bytes || 0 };
  }
  return jsonOk(body);
}
