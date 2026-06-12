import { Vendor } from '@/models/Vendor';

export async function checkQuota(
  vendorId: string,
  fileSize: number
): Promise<{ ok: boolean; reason?: string }> {
  const vendor = await Vendor.findById(vendorId).lean();
  if (!vendor) return { ok: false, reason: 'vendor not found' };
  if (vendor.status !== 'active') return { ok: false, reason: 'vendor not active' };
  if (vendor.limits.maxFileSizeBytes && fileSize > vendor.limits.maxFileSizeBytes) {
    return { ok: false, reason: 'file too large' };
  }
  const used = Math.max(0, vendor.usage.storageBytes || 0);
  if (vendor.limits.maxStorageBytes && used + fileSize > vendor.limits.maxStorageBytes) {
    return { ok: false, reason: 'storage quota exceeded' };
  }
  return { ok: true };
}

export async function incrementUsage(vendorId: string, bytes: number, files = 1): Promise<void> {
  await Vendor.updateOne(
    { _id: vendorId },
    { $inc: { 'usage.storageBytes': bytes, 'usage.fileCount': files } }
  );
}

export async function decrementUsage(vendorId: string, bytes: number, files = 1): Promise<void> {
  // Clamp at 0 (aggregation-pipeline update) so accounting drift can never drive
  // usage negative and hand a vendor effectively unlimited extra quota.
  await Vendor.updateOne({ _id: vendorId }, [
    {
      $set: {
        'usage.storageBytes': { $max: [0, { $subtract: [{ $ifNull: ['$usage.storageBytes', 0] }, bytes] }] },
        'usage.fileCount': { $max: [0, { $subtract: [{ $ifNull: ['$usage.fileCount', 0] }, files] }] }
      }
    }
  ]);
}
