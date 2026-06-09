import fs from 'node:fs';
import path from 'node:path';

// The app's working dir is the repo root (PM2 cwd '.'), so .env sits beside it.
function envPath(): string {
  return process.env.FMS_ENV_FILE || path.join(process.cwd(), '.env');
}

export function readEnvFile(): string {
  try {
    return fs.readFileSync(envPath(), 'utf8');
  } catch {
    return '';
  }
}

export function getEnvValue(key: string): string {
  const re = new RegExp(`^${key}=(.*)$`, 'm');
  const m = re.exec(readEnvFile());
  return m ? m[1].replace(/^['"]|['"]$/g, '') : process.env[key] || '';
}

/**
 * Update (or append) a single KEY=value in .env, preserving every other line.
 * Backs up the previous file and keeps mode 600. Returns the path written.
 */
export function setEnvValue(key: string, value: string): string {
  const p = envPath();
  let content = readEnvFile();
  const line = `${key}=${value}`;
  const re = new RegExp(`^${key}=.*$`, 'm');
  if (re.test(content)) {
    content = content.replace(re, line);
  } else {
    content = content.replace(/\n?$/, `\n${line}\n`);
  }
  try {
    if (fs.existsSync(p)) fs.copyFileSync(p, `${p}.bak`);
  } catch {
    /* best-effort backup */
  }
  fs.writeFileSync(p, content, { mode: 0o600 });
  return p;
}
