/**
 * VPS filesystem cache for storage objects.
 *
 * S3/MinIO is the source of truth; this is a *delivery* cache in front of it.
 * Because the app streams object bytes THROUGH itself (the object store is
 * internal / 127.0.0.1, so presigned redirects are unreachable), every cache
 * HIT avoids an S3/MinIO round-trip and the associated GET + data-transfer cost.
 *
 * Design (matches the master-spec cache requirements):
 *   - Streaming only — objects are piped to disk and read back as streams; a
 *     large file is never buffered wholly in RAM.
 *   - Single-flight — concurrent MISSes for the same key trigger exactly ONE
 *     upstream fetch; the rest await it and then read the freshly-written file.
 *   - TTL per content class (image / video / document / other) + LRU eviction
 *     bounded by FILE_CACHE_MAX_SIZE_GB, plus a hard per-file size ceiling.
 *   - Content-addressed on the storage key (which itself embeds the fileId and
 *     never changes content — an edit writes a NEW key), so there is no stale
 *     invalidation problem; delete/edit calls `invalidate()` to be safe.
 *   - Automatic bypass for the `disk` driver (the primary is already local, so
 *     a second on-disk copy would only waste space) and when disabled.
 *
 * The CacheEntry Mongo model is the index; bytes live under FILE_CACHE_ROOT.
 * If anything in here throws, callers fall back to a direct storage read — the
 * cache can never make a download fail.
 */
import fs from 'fs';
import fsp from 'fs/promises';
import nodePath from 'path';
import crypto from 'crypto';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { env } from './env';
import { storage } from './storage';
import { CacheEntry } from '@/models/CacheEntry';

// ---------------------------------------------------------------------------
// Config (read once from env)
// ---------------------------------------------------------------------------
export type ContentClass = 'image' | 'video' | 'document' | 'other' | 'temp';

export interface CacheConfig {
  enabled: boolean;
  driver: string;
  root: string;
  maxSizeBytes: number;
  maxFileSizeBytes: number;
  ttl: Record<ContentClass, number>; // seconds
}

export const cacheConfig: CacheConfig = {
  enabled: env.FILE_CACHE_ENABLED,
  driver: env.STORAGE_DRIVER,
  root: env.FILE_CACHE_ROOT,
  maxSizeBytes: Math.max(0, env.FILE_CACHE_MAX_SIZE_GB) * 1024 * 1024 * 1024,
  maxFileSizeBytes: Math.max(0, env.FILE_CACHE_MAX_FILE_SIZE_MB) * 1024 * 1024,
  ttl: {
    image: env.FILE_CACHE_IMAGE_TTL_SECONDS,
    video: env.FILE_CACHE_VIDEO_TTL_SECONDS,
    document: env.FILE_CACHE_DOCUMENT_TTL_SECONDS,
    other: env.FILE_CACHE_DEFAULT_TTL_SECONDS,
    temp: env.FILE_CACHE_TEMP_TTL_SECONDS
  }
};

// Evict down to this fraction of the max when over the limit, so we don't evict
// one object per write once we're near full (which would thrash the cache).
const LOW_WATER = 0.9;

// Per-cron-run caps so a synchronized mass-expiry / over-limit state drains over
// several 15-minute ticks instead of one very long-running request.
const PURGE_BATCH = 5000;
const EVICT_BATCH = 2000;

// ---------------------------------------------------------------------------
// Pure helpers (no I/O — unit-tested in tests/cache-logic.test.js)
// ---------------------------------------------------------------------------
export function mimeClass(mimeType: string): ContentClass {
  const m = (mimeType || '').toLowerCase();
  if (m.startsWith('image/')) return 'image';
  if (m.startsWith('video/')) return 'video';
  if (
    m.startsWith('text/') ||
    m === 'application/pdf' ||
    m === 'application/json' ||
    m === 'application/xml' ||
    m === 'application/zip' ||
    m.startsWith('application/msword') ||
    m.startsWith('application/vnd')
  ) {
    return 'document';
  }
  return 'other';
}

export function ttlForClass(cfg: CacheConfig, cls: ContentClass): number {
  return cfg.ttl[cls] ?? cfg.ttl.other;
}

export function isExpired(entry: { expiresAt: Date | string | number }, now: number): boolean {
  return new Date(entry.expiresAt).getTime() <= now;
}

/**
 * Whether a given read should skip the cache entirely. Kept pure so the policy
 * is unit-testable and identical everywhere.
 */
export function shouldBypass(cfg: CacheConfig, sizeHint?: number): boolean {
  if (!cfg.enabled) return true;
  // The disk driver's primary copy is already on this box — caching it again
  // would just double the storage for zero latency benefit.
  if (cfg.driver === 'disk') return true;
  if (typeof sizeHint === 'number' && sizeHint > 0 && cfg.maxFileSizeBytes > 0 && sizeHint > cfg.maxFileSizeBytes) {
    return true;
  }
  return false;
}

/** SHA-1 of the storage key — a fixed-length, path-safe cache filename. */
export function cacheKeyHash(storageKey: string): string {
  return crypto.createHash('sha1').update(storageKey).digest('hex');
}

/**
 * Absolute on-disk path for a cached object. Sharded by the first two hex chars
 * to avoid one gigantic directory. Never contains any user-controlled path
 * segment (only a hash), so it cannot traverse outside the cache root.
 */
export function cacheFilePath(root: string, storageKey: string): string {
  const h = cacheKeyHash(storageKey);
  return nodePath.join(root, 'objects', h.slice(0, 2), h);
}

/**
 * Given LRU-ordered entries (oldest lastAccessAt first), current total bytes,
 * the max, and a low-water fraction, return the prefix of entries to evict to
 * get back under `max * lowWater`. Pure — the caller does the unlink/delete.
 */
export function selectEvictions<T extends { sizeBytes: number }>(
  entriesOldestFirst: T[],
  currentBytes: number,
  maxBytes: number,
  lowWater = LOW_WATER
): T[] {
  if (maxBytes <= 0 || currentBytes <= maxBytes) return [];
  const target = Math.floor(maxBytes * lowWater);
  const out: T[] = [];
  let total = currentBytes;
  for (const e of entriesOldestFirst) {
    if (total <= target) break;
    out.push(e);
    total -= e.sizeBytes || 0;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Observability counters (in-memory, since process start)
// ---------------------------------------------------------------------------
const counters = {
  hits: 0,
  misses: 0,
  bypass: 0,
  errors: 0,
  fetchBytes: 0, // bytes actually pulled from upstream storage on a MISS
  savedBytes: 0, // bytes served from cache on a HIT (i.e. NOT pulled from S3)
  evictions: 0,
  evictedBytes: 0
};

export function cacheCounters() {
  return { ...counters };
}

// ---------------------------------------------------------------------------
// Single-flight registry
// ---------------------------------------------------------------------------
const inflight = new Map<string, Promise<void>>();

export interface CachedObject {
  stream: Readable;
  contentLength?: number;
  contentType?: string;
  cache: 'HIT' | 'MISS' | 'BYPASS';
}

async function fileSize(fp: string): Promise<number | null> {
  try {
    const st = await fsp.stat(fp);
    return st.size;
  } catch {
    return null;
  }
}

/**
 * Fetch the object from upstream storage exactly once (single-flight per key),
 * stream it to a temp file, then atomically rename into place and upsert the
 * CacheEntry. Waiters for the same in-flight key await this and then read disk.
 */
async function populate(
  storageKey: string,
  fp: string,
  opts: { mimeType?: string }
): Promise<void> {
  const existing = inflight.get(storageKey);
  if (existing) return existing;

  const task = (async () => {
    await fsp.mkdir(nodePath.dirname(fp), { recursive: true });
    const tmp = `${fp}.tmp-${crypto.randomBytes(6).toString('hex')}`;
    let size = 0;
    let contentType = opts.mimeType || 'application/octet-stream';
    try {
      const obj = await storage.getObject(storageKey);
      if (obj.contentType) contentType = opts.mimeType || obj.contentType;
      await pipeline(obj.stream, fs.createWriteStream(tmp));
      const st = await fsp.stat(tmp);
      size = st.size;
      await fsp.rename(tmp, fp);
    } catch (err) {
      await fsp.rm(tmp, { force: true }).catch(() => {});
      throw err;
    }

    const cls = mimeClass(contentType);
    const expiresAt = new Date(Date.now() + ttlForClass(cacheConfig, cls) * 1000);
    await CacheEntry.updateOne(
      { storageKey },
      {
        $set: {
          storageKey,
          sizeBytes: size,
          mimeType: contentType,
          contentClass: cls,
          lastAccessAt: new Date(),
          expiresAt
        }
      },
      { upsert: true }
    );
    counters.fetchBytes += size;
    // Fire-and-forget eviction so the write path stays fast.
    void evictIfNeeded().catch(() => {});
  })().finally(() => {
    inflight.delete(storageKey);
  });

  inflight.set(storageKey, task);
  return task;
}

/**
 * Cache-aware read. Returns a stream shaped like storage.getObject() plus a
 * `cache` verdict. On ANY internal error it degrades to a direct storage read,
 * so the cache can never break a download.
 */
export async function getObjectCached(
  storageKey: string,
  opts: { mimeType?: string; sizeHint?: number } = {}
): Promise<CachedObject> {
  if (shouldBypass(cacheConfig, opts.sizeHint)) {
    counters.bypass += 1;
    const obj = await storage.getObject(storageKey);
    return { ...obj, cache: 'BYPASS' };
  }

  const fp = cacheFilePath(cacheConfig.root, storageKey);
  try {
    const entry = await CacheEntry.findOne({ storageKey }).lean();
    if (entry && !isExpired(entry, Date.now())) {
      const size = await fileSize(fp);
      if (size !== null) {
        counters.hits += 1;
        counters.savedBytes += size;
        // Touch LRU + hit counter without blocking the response.
        void CacheEntry.updateOne(
          { storageKey },
          { $set: { lastAccessAt: new Date() }, $inc: { hits: 1 } }
        ).catch(() => {});
        return {
          stream: fs.createReadStream(fp),
          contentLength: size,
          contentType: entry.mimeType,
          cache: 'HIT'
        };
      }
    }

    // MISS (or stale / file vanished) — fetch once, then read the fresh file.
    counters.misses += 1;
    await populate(storageKey, fp, { mimeType: opts.mimeType });
    const size = await fileSize(fp);
    if (size === null) {
      // populate() succeeded but the file isn't there (races / disk issue) —
      // fall back to a direct read rather than 404-ing a file that exists.
      const obj = await storage.getObject(storageKey);
      return { ...obj, cache: 'BYPASS' };
    }
    return {
      stream: fs.createReadStream(fp),
      contentLength: size,
      contentType: opts.mimeType,
      cache: 'MISS'
    };
  } catch (err) {
    counters.errors += 1;
    // Never let a cache fault fail the request — read straight from storage.
    const obj = await storage.getObject(storageKey);
    return { ...obj, cache: 'BYPASS' };
  }
}

// ---------------------------------------------------------------------------
// Maintenance operations (invalidate / evict / purge / clear / stats)
// ---------------------------------------------------------------------------
async function removeFile(storageKey: string): Promise<void> {
  await fsp.rm(cacheFilePath(cacheConfig.root, storageKey), { force: true }).catch(() => {});
}

/** Drop a single object from the cache (call on delete / content-replace). */
export async function invalidate(storageKey: string): Promise<void> {
  if (!storageKey) return;
  try {
    await removeFile(storageKey);
    await CacheEntry.deleteOne({ storageKey });
  } catch {
    /* best-effort */
  }
}

/**
 * Delete expired entries (unlink file first, then the row). Bounded per run so
 * a synchronized mass-expiry drains over several cron ticks rather than blocking
 * one request; the next 15-minute run picks up the remainder. Returns count.
 */
export async function purgeExpired(now = new Date()): Promise<number> {
  const expired = await CacheEntry.find({ expiresAt: { $lte: now } })
    .sort({ expiresAt: 1 })
    .limit(PURGE_BATCH)
    .select('storageKey sizeBytes')
    .lean();
  let removed = 0;
  for (const e of expired) {
    await removeFile(e.storageKey);
    await CacheEntry.deleteOne({ _id: e._id });
    removed += 1;
  }
  return removed;
}

/** Evict least-recently-used objects until under the size limit. */
export async function evictIfNeeded(): Promise<{ evicted: number; freedBytes: number }> {
  const maxBytes = cacheConfig.maxSizeBytes;
  if (maxBytes <= 0) return { evicted: 0, freedBytes: 0 };
  const agg = await CacheEntry.aggregate([
    { $group: { _id: null, total: { $sum: '$sizeBytes' } } }
  ]);
  const total = agg[0]?.total || 0;
  if (total <= maxBytes) return { evicted: 0, freedBytes: 0 };

  // Oldest-accessed first; cap per run so a huge cache is drained over several
  // cron ticks rather than in one long-running request.
  const candidates = await CacheEntry.find({})
    .sort({ lastAccessAt: 1 })
    .limit(EVICT_BATCH)
    .select('storageKey sizeBytes')
    .lean();
  const victims = selectEvictions(candidates, total, maxBytes);
  let freed = 0;
  let evicted = 0;
  for (const v of victims) {
    await removeFile(v.storageKey);
    // Only count an eviction we actually performed — under concurrent passes a
    // sibling run may already have deleted this row, so guard the stats on the
    // real deletedCount rather than double-counting the same victim.
    const res = await CacheEntry.deleteOne({ _id: v._id });
    if (res.deletedCount) {
      freed += v.sizeBytes || 0;
      evicted += 1;
      counters.evictions += 1;
      counters.evictedBytes += v.sizeBytes || 0;
    }
  }
  return { evicted, freedBytes: freed };
}

/** Wipe the entire cache (rows + files). For the admin "clear cache" action. */
export async function clearAll(): Promise<void> {
  await CacheEntry.deleteMany({});
  await fsp.rm(nodePath.join(cacheConfig.root, 'objects'), { recursive: true, force: true }).catch(() => {});
}

export interface CacheStats {
  enabled: boolean;
  bypassed: boolean; // driver=disk or disabled → cache is a no-op
  driver: string;
  entries: number;
  totalBytes: number;
  maxBytes: number;
  usagePercent: number;
  hitRate: number;
  counters: ReturnType<typeof cacheCounters>;
  config: { maxSizeGB: number; maxFileSizeMB: number; ttlSeconds: Record<ContentClass, number> };
}

export async function stats(): Promise<CacheStats> {
  const agg = await CacheEntry.aggregate([
    { $group: { _id: null, total: { $sum: '$sizeBytes' }, count: { $sum: 1 } } }
  ]);
  const totalBytes = agg[0]?.total || 0;
  const entries = agg[0]?.count || 0;
  const c = cacheCounters();
  const lookups = c.hits + c.misses;
  return {
    enabled: cacheConfig.enabled,
    bypassed: cacheConfig.driver === 'disk' || !cacheConfig.enabled,
    driver: cacheConfig.driver,
    entries,
    totalBytes,
    maxBytes: cacheConfig.maxSizeBytes,
    usagePercent: cacheConfig.maxSizeBytes > 0 ? Math.round((totalBytes / cacheConfig.maxSizeBytes) * 100) : 0,
    hitRate: lookups > 0 ? Math.round((c.hits / lookups) * 100) : 0,
    counters: c,
    config: {
      maxSizeGB: env.FILE_CACHE_MAX_SIZE_GB,
      maxFileSizeMB: env.FILE_CACHE_MAX_FILE_SIZE_MB,
      ttlSeconds: cacheConfig.ttl
    }
  };
}
