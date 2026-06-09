import { NextRequest } from 'next/server';
import { authenticate } from '@/lib/auth';
import { can } from '@/lib/rbac';
import { badRequest, forbidden, jsonOk, safeParseJson, unauthorized } from '@/lib/http';
import { databaseUpdateSchema } from '@/lib/validation';
import { audit } from '@/lib/audit';
import { getEnvValue, setEnvValue } from '@/lib/env-file';
import { testMongoUri, maskMongoUri, liveDbConnected } from '@/lib/db-admin';
import { schedulePanelReload } from '@/lib/server-control';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const p = await authenticate(req);
  if (!p) return unauthorized();
  if (!can(p, 'admin:vendor:read')) return forbidden();
  return jsonOk({
    maskedUri: maskMongoUri(getEnvValue('MONGODB_URI')),
    connected: liveDbConnected()
  });
}

export async function POST(req: NextRequest) {
  const p = await authenticate(req);
  if (!p) return unauthorized();
  if (!can(p, 'admin:maintenance:toggle')) return forbidden();

  const body = await safeParseJson(req);
  const parsed = databaseUpdateSchema.safeParse(body);
  if (!parsed.success) return badRequest('Invalid input', { issues: parsed.error.issues });
  const { action, uri } = parsed.data;

  const test = await testMongoUri(uri);

  if (action === 'test') {
    return jsonOk({ tested: true, ...test });
  }

  // action === 'apply' — never persist a URI we couldn't connect to.
  if (!test.ok) return badRequest(`Won't apply — ${test.message}`);

  setEnvValue('MONGODB_URI', uri);
  await audit(p, req, {
    action: 'database.uri.update',
    resourceType: 'platform_setting',
    meta: { hasSuperAdmin: test.hasSuperAdmin }
  });
  schedulePanelReload(2);

  return jsonOk({
    applied: true,
    hasSuperAdmin: test.hasSuperAdmin,
    message: test.hasSuperAdmin
      ? 'MongoDB URI updated. The panel is reloading to apply…'
      : 'MongoDB URI updated, but the target database has no super_admin — you may need to seed one. Reloading…'
  });
}
