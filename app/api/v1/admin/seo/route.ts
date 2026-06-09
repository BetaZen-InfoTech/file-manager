import { NextRequest } from 'next/server';
import { authenticate } from '@/lib/auth';
import { can } from '@/lib/rbac';
import { badRequest, forbidden, jsonOk, safeParseJson, unauthorized } from '@/lib/http';
import { seoSchema } from '@/lib/validation';
import { audit } from '@/lib/audit';
import { getSeo, setSeo } from '@/lib/seo';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const p = await authenticate(req);
  if (!p) return unauthorized();
  if (!can(p, 'admin:vendor:read')) return forbidden();
  return jsonOk(await getSeo());
}

export async function POST(req: NextRequest) {
  const p = await authenticate(req);
  if (!p) return unauthorized();
  if (!can(p, 'admin:maintenance:toggle')) return forbidden();
  const body = await safeParseJson(req);
  const parsed = seoSchema.safeParse(body);
  if (!parsed.success) return badRequest('Invalid input', { issues: parsed.error.issues });
  const updated = await setSeo(parsed.data, p.userId || null);
  await audit(p, req, { action: 'seo.update', resourceType: 'platform_setting' });
  return jsonOk(updated);
}
