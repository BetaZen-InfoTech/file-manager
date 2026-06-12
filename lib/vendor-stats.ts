import mongoose from 'mongoose';
import { FileModel } from '@/models/File';

export interface VendorUsage {
  storageBytes: number;
  fileCount: number;
}

/**
 * Real, storage-backed usage aggregated from the actual `File` records (which
 * mirror what's in object storage) rather than the cached Vendor.usage counter,
 * which can drift from out-of-band deletes or interrupted writes. Only 'ready'
 * files are counted — i.e. live, downloadable objects.
 */
export async function realUsageByVendor(): Promise<Map<string, VendorUsage>> {
  const rows = await FileModel.aggregate([
    { $match: { status: 'ready' } },
    { $group: { _id: '$vendorId', storageBytes: { $sum: '$sizeBytes' }, fileCount: { $sum: 1 } } }
  ]);
  const m = new Map<string, VendorUsage>();
  for (const r of rows) {
    m.set(String(r._id), { storageBytes: r.storageBytes || 0, fileCount: r.fileCount || 0 });
  }
  return m;
}

export async function realUsageForVendor(vendorId: string): Promise<VendorUsage> {
  const rows = await FileModel.aggregate([
    { $match: { vendorId: new mongoose.Types.ObjectId(String(vendorId)), status: 'ready' } },
    { $group: { _id: null, storageBytes: { $sum: '$sizeBytes' }, fileCount: { $sum: 1 } } }
  ]);
  const r = rows[0];
  return { storageBytes: r?.storageBytes || 0, fileCount: r?.fileCount || 0 };
}

export function fmtBytes(n: number): string {
  if (!n || n < 0) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${u[i]}`;
}
