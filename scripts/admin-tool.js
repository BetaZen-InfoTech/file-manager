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

async function connect() {
  const uri = process.env.MONGODB_URI;
  if (!uri) { console.error('MONGODB_URI not set in .env'); process.exit(1); }
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 8000 });
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

  console.error('Unknown subcommand. Use: list | set-email | set-password | ping');
  process.exit(2);
}

main()
  .then(() => mongoose.disconnect())
  .catch((err) => { console.error(err.message || err); mongoose.disconnect().finally(() => process.exit(1)); });
