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
  if (
    vendor.limits.maxStorageBytes &&
    vendor.usage.storageBytes + fileSize > vendor.limits.maxStorageBytes
  ) {
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
  await Vendor.updateOne(
    { _id: vendorId },
    { $inc: { 'usage.storageBytes': -bytes, 'usage.fileCount': -files } }
  );
}
