import { Vendor } from '@/models/Vendor';

/**
 * The storage/folder key for a vendor: its `username` when set (all new vendors),
 * else the Mongo id (legacy vendors created before usernames). This is the top
 * path segment for a vendor's objects, so files live at
 *   <root>/vendors/<username>/buckets/<bucketId>/<fileId>/<name>
 * Username is assigned once at creation and never edited, so it is stable enough
 * to embed in immutable storage keys.
 */
export function vendorFolderKey(v: { username?: string | null; _id: unknown }): string {
  return (v.username && String(v.username)) || String(v._id);
}

const cache = new Map<string, string>();

/** Resolve a vendor's folder key from its id (cached). */
export async function vendorFolderKeyById(vendorId: string): Promise<string> {
  const id = String(vendorId);
  const hit = cache.get(id);
  if (hit) return hit;
  const v: any = await Vendor.findById(id).select('username').lean();
  const key = (v?.username && String(v.username)) || id;
  cache.set(id, key);
  return key;
}
