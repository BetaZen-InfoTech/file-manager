import mongoose, { Schema, InferSchemaType, Model } from 'mongoose';

/**
 * One row per object currently held in the VPS filesystem cache. This is the
 * INDEX over the cache — the bytes live on disk under FILE_CACHE_ROOT; this doc
 * records where, how big, when it expires, and when it was last read (for LRU
 * eviction). S3/disk storage remains the source of truth; deleting every row
 * here (and the files) only forces the next read to re-fetch. See lib/cache.ts.
 *
 * NOTE: intentionally NOT a Mongo TTL index on `expiresAt` — a TTL index would
 * delete the doc but leave the file orphaned on disk. Expiry is handled by the
 * cache-cleanup cron, which unlinks the file first, then removes the row.
 */
const CacheEntrySchema = new Schema(
  {
    // The storage object key this cached copy mirrors (stable per stored object;
    // an edited file is written to a NEW key, so a key never changes content).
    storageKey: { type: String, required: true, unique: true, index: true },
    sizeBytes: { type: Number, required: true, default: 0 },
    mimeType: { type: String, default: 'application/octet-stream' },
    // image | video | document | other — drives which TTL applies.
    contentClass: { type: String, default: 'other' },
    hits: { type: Number, default: 0 },
    // Last time this cached copy was served — the LRU ordering key.
    lastAccessAt: { type: Date, default: Date.now, index: true },
    // When this copy goes stale and must be re-fetched. Purged by the cron.
    expiresAt: { type: Date, required: true, index: true }
  },
  { timestamps: true }
);

export type CacheEntryDoc = InferSchemaType<typeof CacheEntrySchema> & {
  _id: mongoose.Types.ObjectId;
};

export const CacheEntry: Model<CacheEntryDoc> =
  (mongoose.models.CacheEntry as Model<CacheEntryDoc>) ||
  mongoose.model<CacheEntryDoc>('CacheEntry', CacheEntrySchema);
