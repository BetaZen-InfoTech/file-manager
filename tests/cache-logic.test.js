/*
 * Dependency-free tests for the VPS file-cache pure logic (lib/cache.ts).
 *
 * Mirrors the repo convention (see core-logic.test.js): the algorithm is
 * re-implemented inline and asserted, so the test documents the intended
 * behaviour and runs under `node --test` with no TS/DB/FS dependencies.
 *
 *   [1] mimeClass       — content-class routing
 *   [2] ttlForClass     — per-class TTL selection
 *   [3] isExpired       — TTL boundary
 *   [4] shouldBypass    — disabled / disk-driver / oversize bypass policy
 *   [5] cacheFilePath   — deterministic, sharded, traversal-free path
 *   [6] selectEvictions — LRU eviction down to the low-water mark
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');

// ----------------------------- impl (mirror of lib/cache.ts) ---------------
function mimeClass(mimeType) {
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

function ttlForClass(cfg, cls) {
  return cfg.ttl[cls] ?? cfg.ttl.other;
}

function isExpired(entry, now) {
  return new Date(entry.expiresAt).getTime() <= now;
}

function shouldBypass(cfg, sizeHint) {
  if (!cfg.enabled) return true;
  if (cfg.driver === 'disk') return true;
  if (typeof sizeHint === 'number' && sizeHint > 0 && cfg.maxFileSizeBytes > 0 && sizeHint > cfg.maxFileSizeBytes) {
    return true;
  }
  return false;
}

function cacheKeyHash(storageKey) {
  return crypto.createHash('sha1').update(storageKey).digest('hex');
}

function cacheFilePath(root, storageKey) {
  const h = cacheKeyHash(storageKey);
  return path.join(root, 'objects', h.slice(0, 2), h);
}

function selectEvictions(entriesOldestFirst, currentBytes, maxBytes, lowWater = 0.9) {
  if (maxBytes <= 0 || currentBytes <= maxBytes) return [];
  const target = Math.floor(maxBytes * lowWater);
  const out = [];
  let total = currentBytes;
  for (const e of entriesOldestFirst) {
    if (total <= target) break;
    out.push(e);
    total -= e.sizeBytes || 0;
  }
  return out;
}

const CFG = {
  enabled: true,
  driver: 's3',
  root: '/var/cache/file-manager',
  maxSizeBytes: 1000,
  maxFileSizeBytes: 100,
  ttl: { image: 700, video: 300, document: 200, other: 100, temp: 50 }
};

// ----------------------------- tests ---------------------------------------
test('[1] mimeClass routes by content type', () => {
  assert.equal(mimeClass('image/png'), 'image');
  assert.equal(mimeClass('IMAGE/JPEG'), 'image'); // case-insensitive
  assert.equal(mimeClass('video/mp4'), 'video');
  assert.equal(mimeClass('application/pdf'), 'document');
  assert.equal(mimeClass('text/plain'), 'document');
  assert.equal(mimeClass('application/vnd.ms-excel'), 'document');
  assert.equal(mimeClass('application/octet-stream'), 'other');
  assert.equal(mimeClass(''), 'other');
});

test('[2] ttlForClass picks the class TTL, falling back to other', () => {
  assert.equal(ttlForClass(CFG, 'image'), 700);
  assert.equal(ttlForClass(CFG, 'video'), 300);
  assert.equal(ttlForClass(CFG, 'document'), 200);
  assert.equal(ttlForClass(CFG, 'other'), 100);
  // Unknown class → default (other).
  assert.equal(ttlForClass(CFG, 'nope'), 100);
});

test('[3] isExpired is true at/after expiry, false before', () => {
  const now = 1_000_000;
  assert.equal(isExpired({ expiresAt: new Date(now - 1) }, now), true);
  assert.equal(isExpired({ expiresAt: new Date(now) }, now), true); // boundary = expired
  assert.equal(isExpired({ expiresAt: new Date(now + 1) }, now), false);
});

test('[4] shouldBypass: disabled, disk driver, and oversize files bypass', () => {
  assert.equal(shouldBypass(CFG, 50), false); // normal cacheable read
  assert.equal(shouldBypass({ ...CFG, enabled: false }, 50), true); // disabled
  assert.equal(shouldBypass({ ...CFG, driver: 'disk' }, 50), true); // primary already local
  assert.equal(shouldBypass(CFG, 101), true); // over the per-file ceiling
  assert.equal(shouldBypass(CFG, 100), false); // exactly at ceiling is cacheable
  assert.equal(shouldBypass(CFG, undefined), false); // unknown size → cache
});

test('[5] cacheFilePath is deterministic, sharded, and traversal-free', () => {
  const key = 'vendors/acme/buckets/b1/f1/report.pdf';
  const p1 = cacheFilePath('/cache', key);
  const p2 = cacheFilePath('/cache', key);
  assert.equal(p1, p2); // deterministic
  const h = cacheKeyHash(key);
  assert.equal(p1, path.join('/cache', 'objects', h.slice(0, 2), h));
  // A malicious key can't escape the root — only its hash appears in the path.
  const evil = cacheFilePath('/cache', '../../etc/passwd');
  assert.ok(evil.includes(path.join('/cache', 'objects')));
  assert.ok(!evil.includes('..'));
});

test('[6] selectEvictions removes LRU entries down to the low-water mark', () => {
  // Oldest first. Total = 900, under max(1000) → nothing evicted.
  const under = [
    { storageKey: 'a', sizeBytes: 300, lastAccessAt: 1 },
    { storageKey: 'b', sizeBytes: 600, lastAccessAt: 2 }
  ];
  assert.deepEqual(selectEvictions(under, 900, 1000), []);

  // Total = 1400 > max(1000). Low-water target = 900. Evict oldest until <= 900:
  // drop a(300)->1100, drop b(400)->700 (<=900) → evict [a, b].
  const over = [
    { storageKey: 'a', sizeBytes: 300, lastAccessAt: 1 },
    { storageKey: 'b', sizeBytes: 400, lastAccessAt: 2 },
    { storageKey: 'c', sizeBytes: 700, lastAccessAt: 3 }
  ];
  const victims = selectEvictions(over, 1400, 1000);
  assert.deepEqual(victims.map((v) => v.storageKey), ['a', 'b']);

  // maxBytes = 0 (unbounded) → never evict.
  assert.deepEqual(selectEvictions(over, 1400, 0), []);
});
