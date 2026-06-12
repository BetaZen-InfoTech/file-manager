#!/usr/bin/env node
/*
 * Admin maintenance helper used by the `bcdnp` console.
 *   node scripts/admin-tool.js list
 *   node scripts/admin-tool.js set-email    --current old@x.com --new new@x.com
 *   node scripts/admin-tool.js set-password --email you@x.com --password 'secret123'
 *   node scripts/admin-tool.js ping
 *
 * Reads MONGODB_URI from ../.env (same loader as seed-admin.js).
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
const argon2 = require('argon2');
const crypto = require('crypto');

function parseArgs() {
  const args = {};
  const argv = process.argv.slice(3); // skip node, script, subcommand
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const val = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true';
      args[key] = val;
    }
  }
  return args;
}

// Database name from a Mongo URI path; '' when absent.
function dbNameFromUri(uri) {
  const afterHost = String(uri).split(/[?#]/)[0].replace(/^mongodb(\+srv)?:\/\/[^/]+/i, '');
  return afterHost.replace(/^\//, '').split('/')[0];
}

async function connect() {
  const uri = process.env.MONGODB_URI;
  if (!uri) { console.error('MONGODB_URI not set in .env'); process.exit(1); }
  // Generous timeouts so a cold/remote managed cluster isn't falsely rejected.
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 20000, connectTimeoutMS: 20000 });
  return mongoose.connection.collection('users');
}

async function main() {
  const sub = process.argv[2];
  const args = parseArgs();

  if (sub === 'ping') {
    await connect();
    const res = await mongoose.connection.db.admin().command({ ping: 1 });
    console.log(`Mongo OK (ping=${res.ok})`);
    return;
  }

  // Test an ARBITRARY uri (used by `bcdnp` before applying a new MONGODB_URI).
  // Prints a single JSON line so the caller can parse it. Exits non-zero on
  // connection failure.
  if (sub === 'ping-uri') {
    const uri = args.uri;
    if (!uri) { console.error('Usage: ping-uri --uri <mongodb-uri>'); process.exit(2); }
    const dbName = dbNameFromUri(uri);
    if (!dbName) {
      console.error('URI must include a database name in the path (e.g. .../filemanager).');
      process.exit(2);
    }
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 20000, connectTimeoutMS: 20000 });
    // Probe the named db explicitly (a path-less URI would default to "test").
    const users = mongoose.connection.useDb(dbName).collection('users');
    const n = await users.countDocuments({ role: 'super_admin' });
    console.log(JSON.stringify({ ok: true, hasSuperAdmin: n > 0, superAdmins: n, dbName }));
    return;
  }

  if (sub === 'list') {
    const Users = await connect();
    const admins = await Users.find({ role: 'super_admin' })
      .project({ email: 1, status: 1, createdAt: 1 }).toArray();
    if (!admins.length) { console.log('No super_admin accounts found.'); return; }
    for (const a of admins) {
      console.log(`- ${a.email}  [${a.status || 'active'}]  created ${a.createdAt ? new Date(a.createdAt).toISOString().slice(0, 10) : '?'}`);
    }
    return;
  }

  if (sub === 'set-email') {
    const current = (args.current || '').toLowerCase();
    const next = (args.new || '').toLowerCase();
    if (!current || !next) { console.error('Usage: set-email --current <email> --new <email>'); process.exit(2); }
    const Users = await connect();
    const dupe = await Users.findOne({ email: next });
    if (dupe) { console.error(`A user with ${next} already exists.`); process.exit(1); }
    const r = await Users.updateOne(
      { email: current, role: 'super_admin' },
      { $set: { email: next, updatedAt: new Date() } }
    );
    if (r.matchedCount === 0) { console.error(`No super_admin found with email ${current}.`); process.exit(1); }
    console.log(`Updated super_admin email: ${current} -> ${next}`);
    return;
  }

  if (sub === 'set-password') {
    const email = (args.email || '').toLowerCase();
    const password = args.password || '';
    if (!email || !password) { console.error('Usage: set-password --email <email> --password <pw>'); process.exit(2); }
    if (password.length < 8) { console.error('Password must be at least 8 characters.'); process.exit(2); }
    const Users = await connect();
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    const r = await Users.updateOne(
      { email, role: 'super_admin' },
      { $set: { passwordHash, updatedAt: new Date() } }
    );
    if (r.matchedCount === 0) { console.error(`No super_admin found with email ${email}.`); process.exit(1); }
    console.log(`Password updated for ${email}.`);
    return;
  }

  // Mint a server-to-server transfer token (prints the plaintext to STDOUT).
  // The collection name MUST equal TRANSFER_TOKEN_COLLECTION in models/TransferToken.ts.
  if (sub === 'mint-transfer-token') {
    const hours = Number(args.hours || 24);
    const label = args.label || 'cli';
    await connect();
    const plain = 'fmt_' + crypto.randomBytes(32).toString('base64url');
    const tokenHash = crypto.createHash('sha256').update(plain).digest('hex'); // matches lib/crypto sha256()
    const coll = mongoose.connection.collection('transfertokens');
    const expiresAt = new Date(Date.now() + hours * 3600 * 1000);
    const now = new Date();
    const r = await coll.insertOne({
      tokenHash,
      scope: { kind: 'instance', vendorId: null, bucketIds: [] },
      status: 'active',
      label,
      expiresAt,
      lastUsedAt: null,
      createdBy: null,
      createdAt: now,
      updatedAt: now
    });
    const check = await coll.findOne({ _id: r.insertedId });
    if (!check) { console.error('FAILED: token not found after insert (collection mismatch).'); process.exit(1); }
    console.log(plain);
    console.error(`(transfer token valid ${hours}h — expires ${expiresAt.toISOString()})`);
    return;
  }

  console.error('Unknown subcommand. Use: list | set-email | set-password | ping | ping-uri | mint-transfer-token');
  process.exit(2);
}

main()
  .then(() => mongoose.disconnect())
  .catch((err) => { console.error(err.message || err); mongoose.disconnect().finally(() => process.exit(1)); });
