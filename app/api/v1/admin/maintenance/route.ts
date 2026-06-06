import { NextRequest } from 'next/server';
import { authenticate } from '@/lib/auth';
import { can } from '@/lib/rbac';
import {
  badRequest,
  forbidden,
  jsonOk,
  safeParseJson,
  unauthorized
} from '@/lib/http';
import { maintenanceSchema } from '@/lib/validation';
import { audit } from '@/lib/audit';
import { getMaintenance, setMaintenance } from '@/lib/maintenance';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const p = await authenticate(req);
  if (!p) return unauthorized();
  if (!can(p, 'admin:vendor:read')) return forbidden();
  const m = await getMaintenance();
  return jsonOk(m);
}

export async function POST(req: NextRequest) {
  const p = await authenticate(req);
  if (!p) return unauthorized();
  if (!can(p, 'admin:maintenance:toggle')) return forbidden();
  const body = await safeParseJson(req);
  const parsed = maintenanceSchema.safeParse(body);
  if (!parsed.success) return badRequest('Invalid input', { issues: parsed.error.issues });
  const m = await setMaintenance(
    parsed.data.enabled,
    parsed.data.message || 'Be right back — scheduled maintenance.',
    p.userId || null
  );
  await audit(p, req, {
    action: parsed.data.enabled ? 'maintenance.enable' : 'maintenance.disable',
    resourceType: 'platform_setting'
  });
  return jsonOk(m);
}
