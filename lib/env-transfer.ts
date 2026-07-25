import fs from 'fs';
import path from 'path';

// SAFE, portable app settings that MAY be copied between installs during a full
// migration (opt-in). Everything NOT here — DB URI, JWT/session secrets, storage
// driver/root, S3 creds, cookie/domain/port, deploy & cron secrets — is
// per-server and must NEVER leave the box, so it is not exported or applied.
export const ENV_ALLOWLIST = [
  'MAX_UPLOAD_BYTES',
  'RATE_LIMIT_PER_MIN',
  'PUBLIC_TOKEN_BYTES',
  'MAIL_DRIVER',
  'MAIL_HOST',
  'MAIL_PORT',
  'MAIL_USER',
  'MAIL_PASS',
  'MAIL_FROM'
] as const;

// Hard denylist — a second guard so these can never be exported or written even
// if the allowlist is edited carelessly.
const DENY = new Set<string>([
  'MONGODB_URI', 'MONGO_USER', 'MONGO_PASSWORD',
  'JWT_SECRET', 'SESSION_COOKIE_SECRET', 'SESSION_COOKIE_NAME', 'COOKIE_SECURE',
  'STORAGE_DRIVER', 'STORAGE_DISK_ROOT',
  'S3_ENDPOINT', 'S3_REGION', 'S3_ACCESS_KEY', 'S3_SECRET_KEY', 'S3_FORCE_PATH_STYLE', 'S3_USE_SSL', 'S3_DEFAULT_BUCKET',
  'GITHUB_WEBHOOK_SECRET', 'INTERNAL_CRON_SECRET',
  'APP_URL', 'PUBLIC_URL_BASE', 'PORT', 'NODE_ENV', 'DEPLOY_SCRIPT', 'DEPLOY_BRANCH',
  'REDIS_URL', 'CLAMAV_HOST', 'CLAMAV_PORT'
]);

const safe = (k: string) => (ENV_ALLOWLIST as readonly string[]).includes(k) && !DENY.has(k);

/** Read the allowlisted env values from THIS server's process.env (source side). */
export function readAllowlistedEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of ENV_ALLOWLIST) {
    if (!safe(k)) continue;
    const v = process.env[k];
    if (v != null && String(v) !== '') out[k] = String(v);
  }
  return out;
}

function envFilePath(): string {
  return path.join(process.cwd(), '.env');
}

/**
 * Update ONLY the allowlisted keys in this server's .env, preserving every other
 * line. Never creates a stray .env and never writes denylisted keys. Returns the
 * keys actually written. A `pm2 reload --update-env` is needed to apply them.
 */
export function applyEnvToFile(values: Record<string, string>): string[] {
  const fp = envFilePath();
  if (!fs.existsSync(fp)) return []; // don't create a stray .env in the wrong cwd
  const lines = fs.readFileSync(fp, 'utf8').split('\n');
  const written: string[] = [];
  for (const key of Object.keys(values || {})) {
    if (!safe(key)) continue;
    const val = String(values[key]);
    const line = `${key}=${val}`;
    const idx = lines.findIndex((l) => new RegExp(`^\\s*${key}\\s*=`).test(l));
    if (idx >= 0) lines[idx] = line;
    else lines.push(line);
    written.push(key);
  }
  if (written.length) fs.writeFileSync(fp, lines.join('\n'));
  return written;
}
