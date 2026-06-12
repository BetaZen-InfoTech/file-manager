#!/usr/bin/env node
/*
 * Migration: drop the UNIQUE index on files.storageKey and replace it with a
 * plain (non-unique) index.
 *
 * Why: content de-duplication intentionally lets multiple File rows reference
 * one storage object, and purge-trash only deletes the object when no other row
 * references it. A unique index on storageKey makes the 2nd identical-content
 * upload fail with E11000. Idempotent — safe to run repeatedly.
 *
 *   node scripts/migrate-files-storagekey-index.js
 *
 * Reads MONGODB_URI from ../.env (same loader as seed-admin.js / admin-tool.js).
 */
const path = require('path');
const fs = require('fs');
const dotenvPath = path.resolve(__dirname, '..', '.env');
if (fs.existsSync(dotenvPath)) {
  for (const line of fs.readFileSync(dotenvPath, 'utf8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.+?)\s*$/i.exec(line);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
}
const mongoose = require('mongoose');

(async () => {
  const uri = process.env.MONGODB_URI;
  if (!uri) { console.error('MONGODB_URI not set'); process.exit(1); }
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 20000 });
  const files = mongoose.connection.collection('files');
  const indexes = await files.indexes();
  const existing = indexes.find((i) => i.key && i.key.storageKey === 1);

  if (existing && existing.unique) {
    await files.dropIndex(existing.name);
    console.log(`Dropped unique index ${existing.name}.`);
  } else if (existing) {
    console.log(`storageKey index already non-unique (${existing.name}). Nothing to drop.`);
  } else {
    console.log('No storageKey index present.');
  }

  // Recreate as a plain non-unique index (used by dedup + purge refcount lookups).
  await files.createIndex({ storageKey: 1 }, { name: 'storageKey_1' });
  console.log('Ensured non-unique storageKey_1 index.');

  await mongoose.disconnect();
})().catch((e) => { console.error(e.message || e); mongoose.disconnect().finally(() => process.exit(1)); });
