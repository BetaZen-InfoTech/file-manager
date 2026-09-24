import { NextRequest } from 'next/server';
import { dbConnect } from '@/lib/db';
import { authenticate } from '@/lib/auth';
import { can } from '@/lib/rbac';
import { forbidden, jsonOk, unauthorized } from '@/lib/http';
import { audit } from '@/lib/audit';
import { stats, clearAll } from '@/lib/cache';

export const runtime = 'nodejs';

// GET: cache observability (hit rate, size, eviction counters). Any platform
// admin who can read usage may read cache stats.
export async function GET(req: NextRequest) {
  const p = await authenticate(req);
  if (!p) return unauthorized();
  if (!can(p, 'admin:usage:read')) return forbidden();
  await dbConnect();
  return jsonOk(await stats());
}

// DELETE: manual "clear cache" — gated on the maintenance-toggle permission
// (super_admin), since it forces every subsequent download to re-fetch from S3.
export async function DELETE(req: NextRequest) {
  const p = await authenticate(req);
  if (!p) return unauthorized();
  if (!can(p, 'admin:maintenance:toggle')) return forbidden();
  await dbConnect();
  await clearAll();
  await audit(p, req, { action: 'admin.cache.clear', resourceType: 'cache', resourceId: 'all' });
  return jsonOk({ ok: true });
}
