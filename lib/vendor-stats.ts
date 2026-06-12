import mongoose from 'mongoose';
import { FileModel } from '@/models/File';
import { Vendor } from '@/models/Vendor';
import { Bucket } from '@/models/Bucket';

export interface VendorUsage {
  storageBytes: number;
  fileCount: number;
}

// Statuses that occupy storage (and therefore count toward usage/quota) until a
// trashed file is purged. Matches the DELETE-then-purge lifecycle, so syncing to
// this basis can't drive the counter negative on the next purge.
const OCCUPYING = ['ready', 'trashed'];

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

/**
 * Reconcile the cached counters to reality for ONE vendor: recompute
 * Vendor.usage (storageBytes + fileCount) AND every bucket's storageBytes/
 * fileCount from the actual File records, then write them. Returns the new
 * vendor totals. Idempotent — safe to run anytime.
 */
export async function syncVendorUsage(vendorId: string): Promise<VendorUsage> {
  const vid = new mongoose.Types.ObjectId(String(vendorId));

  const totals = await FileModel.aggregate([
    { $match: { vendorId: vid, status: { $in: OCCUPYING } } },
    { $group: { _id: null, storageBytes: { $sum: '$sizeBytes' }, fileCount: { $sum: 1 } } }
  ]);
  const usage: VendorUsage = { storageBytes: totals[0]?.storageBytes || 0, fileCount: totals[0]?.fileCount || 0 };
  await Vendor.updateOne(
    { _id: vid },
    { $set: { 'usage.storageBytes': usage.storageBytes, 'usage.fileCount': usage.fileCount } }
  );

  // Per-bucket counters.
  const perBucket = await FileModel.aggregate([
    { $match: { vendorId: vid, status: { $in: OCCUPYING } } },
    { $group: { _id: '$bucketId', storageBytes: { $sum: '$sizeBytes' }, fileCount: { $sum: 1 } } }
  ]);
  for (const b of perBucket) {
    await Bucket.updateOne({ _id: b._id, vendorId: vid }, { $set: { storageBytes: b.storageBytes, fileCount: b.fileCount } });
  }
  // Zero out buckets that now have no files.
  await Bucket.updateMany(
    { vendorId: vid, _id: { $nin: perBucket.map((b) => b._id) } },
    { $set: { storageBytes: 0, fileCount: 0 } }
  );

  return usage;
}

/** Reconcile every vendor. Returns how many were processed. */
export async function syncAllVendorsUsage(): Promise<{ vendors: number }> {
  const vendors = await Vendor.find({}).select('_id').lean();
  for (const v of vendors) {
    await syncVendorUsage(String(v._id));
  }
  return { vendors: vendors.length };
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
