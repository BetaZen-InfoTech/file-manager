import { NextRequest } from 'next/server';
import mongoose from 'mongoose';
import { dbConnect } from '@/lib/db';
import { jsonOk, unauthorized } from '@/lib/http';
import { verifyTransferToken } from '@/lib/transfer-token';
import { Bucket } from '@/models/Bucket';
import { Folder } from '@/models/Folder';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Full path of a folder, RELATIVE (no leading slash). folder.path is the
// PARENT's full path, so the folder's own full path is path + '/' + name.
function folderFullPath(path: string, name: string): string {
  const full = path === '/' ? `/${name}` : `${path}/${name}`;
  return full.replace(/^\/+/, '');
}

// SOURCE folder manifest: paginated list of ALL folders (keyset by _id),
// including EMPTY ones — so a destination can recreate the full directory
// structure even for folders that contain no files. Scope is enforced INSIDE
// the query so a vendor-scoped token can't read the whole instance.
export async function GET(req: NextRequest) {
  const tok = await verifyTransferToken(req);
  if (!tok) return unauthorized('invalid transfer token');

  await dbConnect();
  const url = new URL(req.url);
  const after = url.searchParams.get('after');
  const limit = Math.min(2000, Math.max(1, Number(url.searchParams.get('limit') || 1000)));

  const scope: any = {};
  if (tok.kind === 'vendor' && tok.vendorId) scope.vendorId = tok.vendorId;
  if (tok.bucketIds && tok.bucketIds.length) scope.bucketId = { $in: tok.bucketIds };

  const pageFilter = { ...scope };
  if (after && mongoose.Types.ObjectId.isValid(after)) {
    pageFilter._id = { $gt: new mongoose.Types.ObjectId(after) };
  }

  const docs = await Folder.find(pageFilter)
    .sort({ _id: 1 })
    .limit(limit)
    .select('_id bucketId path name isHidden')
    .lean();

  const bucketIds = [...new Set(docs.map((d: any) => String(d.bucketId)))];
  const buckets = await Bucket.find({ _id: { $in: bucketIds } })
    .select('name')
    .lean();
  const bMap = new Map(buckets.map((b: any) => [String(b._id), b.name]));

  const folders = docs.map((d: any) => ({
    bucketName: bMap.get(String(d.bucketId)) || 'imported',
    fullPath: folderFullPath(d.path || '/', d.name),
    name: d.name,
    isHidden: !!d.isHidden
  }));

  const nextAfter = docs.length === limit ? String(docs[docs.length - 1]._id) : null;

  const body: any = { folders, nextAfter };
  if (!after) body.total = await Folder.countDocuments(scope);
  return jsonOk(body);
}
