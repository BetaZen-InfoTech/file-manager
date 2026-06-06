#!/usr/bin/env node
/*
 * Seed the first super_admin into the users collection.
 *   node scripts/seed-admin.js --email you@x.com --password 'secret123'
 * If args are missing it prompts (and accepts SUPER_ADMIN_EMAIL / SUPER_ADMIN_PASSWORD env vars).
 */
const path = require('path');
const fs = require('fs');
const readline = require('readline');
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
  const argv = process.argv.slice(2);
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

function prompt(question, { hidden = false } = {}) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    if (hidden) {
      const stdin = process.openStdin();
      process.stdout.write(question);
      let value = '';
      stdin.on('data', (ch) => {
        ch = ch + '';
        if (ch === '\n' || ch === '\r' || ch === '') {
          process.stdout.write('\n');
          stdin.pause();
          resolve(value);
        } else {
          value += ch.replace(/[\r\n]/g, '');
          process.stdout.write('*');
        }
      });
    } else {
      rl.question(question, (a) => {
        rl.close();
        resolve(a.trim());
      });
    }
  });
}

const PERMISSIONS_ALL = [
  'bucket:create','bucket:read','bucket:update','bucket:delete',
  'file:upload','file:read','file:download','file:delete','file:list',
  'folder:create','folder:update','folder:hide',
  'publicurl:create','publicurl:revoke','apikey:create','apikey:revoke',
  'member:invite','member:remove','settings:update',
  'admin:vendor:read','admin:vendor:update','admin:vendor:suspend',
  'admin:usage:read','admin:audit:read','admin:maintenance:toggle'
];

async function main() {
  const args = parseArgs();
  let email = args.email || process.env.SUPER_ADMIN_EMAIL;
  let password = args.password || process.env.SUPER_ADMIN_PASSWORD;
  if (!email) email = await prompt('Super admin email: ');
  if (!password) password = await prompt('Password: ', { hidden: true });
  if (!email || !password) {
    console.error('email and password are required');
    process.exit(1);
  }

  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGODB_URI not set');
    process.exit(1);
  }
  await mongoose.connect(uri);
  const User = mongoose.connection.collection('users');
  const existing = await User.findOne({ email: email.toLowerCase() });
  if (existing) {
    console.log(`User ${email} already exists — skipping.`);
    await mongoose.disconnect();
    return;
  }
  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
  await User.insertOne({
    vendorId: null,
    email: email.toLowerCase(),
    name: 'Super Admin',
    passwordHash,
    role: 'super_admin',
    permissions: PERMISSIONS_ALL,
    status: 'active',
    twoFactor: { enabled: false, secret: null },
    createdAt: new Date(),
    updatedAt: new Date()
  });
  console.log(`Created super_admin: ${email}`);
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
