import fs from 'fs';
import path from 'path';

// Read the app version once from package.json (single source of truth, same as
// /api/health). Server-only (uses fs) — import from server components.
let cached: string | null = null;

export function appVersion(): string {
  if (cached !== null) return cached;
  let v = '0.0.0';
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'));
    v = pkg.version || '0.0.0';
  } catch {
    /* keep default */
  }
  cached = v;
  return v;
}
