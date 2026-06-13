import fsp from 'fs/promises';
import { createWriteStream } from 'fs';
import nodePath from 'path';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { storage } from './storage';
import { vendorHome, resolveInJail, vendorFolderKey } from './server-fs';
import { FileModel } from '@/models/File';
import { Bucket } from '@/models/Bucket';
import { Folder } from '@/models/Folder';
import { Vendor } from '@/models/Vendor';

function fullPath(path: string, name: string): string {
  return (path === '/' ? `/${name}` : `${path}/${name}`).replace(/^\/+/, '');
}

/**
 * Backfill a vendor's object-storage files onto the server filesystem so they
 * appear in the File Manager at /var/www/vendors/<username>/<bucket>/<folder>/<name>.
 * Idempotent — files already on disk (same size) are skipped. Streams each
 * object (no buffering). Best-effort: a single failure doesn't abort the rest.
 */
export async function backfillVendorFiles(
  vendorId: string,
  opts: { max?: number } = {}
): Promise<{ written: number; skipped: number; failed: number }> {
  const vendor = await Vendor.findById(vendorId).select('username').lean();
  const home = await vendorHome(vendorFolderKey({ username: (vendor as any)?.username, _id: vendorId }));

  const files = await FileModel.find({ vendorId, status: 'ready' })
    .select('bucketId folderId originalName storageKey sizeBytes')
    .limit(opts.max || 5000)
    .lean();
  if (!files.length) return { written: 0, skipped: 0, failed: 0 };

  const bIds = [...new Set(files.map((f: any) => String(f.bucketId)))];
  const fIds = [...new Set(files.map((f: any) => (f.folderId ? String(f.folderId) : '')).filter(Boolean))];
  const [buckets, folders] = await Promise.all([
    Bucket.find({ _id: { $in: bIds } }).select('name').lean(),
    fIds.length ? Folder.find({ _id: { $in: fIds } }).select('name path').lean() : Promise.resolve([] as any[])
  ]);
  const bMap = new Map(buckets.map((b: any) => [String(b._id), b.name]));
  const fMap = new Map(folders.map((f: any) => [String(f._id), fullPath(f.path || '/', f.name)]));

  let written = 0;
  let skipped = 0;
  let failed = 0;
  for (const f of files as any[]) {
    try {
      const bucketName = bMap.get(String(f.bucketId)) || 'imported';
      const folderPath = f.folderId ? fMap.get(String(f.folderId)) || '' : '';
      const fileName = String(f.originalName).split(/[\\/]/).pop()!.replace(/[^\w.\-]/g, '_');
      const rel = '/' + [bucketName, folderPath, fileName].filter(Boolean).join('/');
      const dest = resolveInJail(home, rel);
      if (!dest) {
        failed++;
        continue;
      }
      const st = await fsp.stat(dest).catch(() => null);
      if (st && st.size === f.sizeBytes) {
        skipped++;
        continue;
      }
      const obj = await storage.getObject(f.storageKey);
      await fsp.mkdir(nodePath.dirname(dest), { recursive: true });
      await pipeline(obj.stream as Readable, createWriteStream(dest));
      written++;
    } catch {
      failed++;
    }
  }
  return { written, skipped, failed };
}
