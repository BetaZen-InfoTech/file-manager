import { NextRequest } from 'next/server';
import { authenticate } from '@/lib/auth';
import { can } from '@/lib/rbac';
import { badRequest, forbidden, jsonOk, safeParseJson, unauthorized } from '@/lib/http';
import { planUpsertSchema } from '@/lib/validation';
import { audit } from '@/lib/audit';
import { dbConnect } from '@/lib/db';
import { Plan } from '@/models/Plan';
import { listPlans } from '@/lib/payments/plans';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const p = await authenticate(req);
  if (!p) return unauthorized();
  if (!can(p, 'admin:vendor:read')) return forbidden();
  return jsonOk({ plans: await listPlans(false) });
}

export async function POST(req: NextRequest) {
  const p = await authenticate(req);
  if (!p) return unauthorized();
  if (!can(p, 'admin:maintenance:toggle')) return forbidden();
  const body = await safeParseJson(req);
  const parsed = planUpsertSchema.safeParse(body);
  if (!parsed.success) return badRequest('Invalid input', { issues: parsed.error.issues });

  await dbConnect();
  const d = parsed.data;
  const updated = await Plan.findOneAndUpdate(
    { code: d.code },
    {
      $set: {
        name: d.name,
        description: d.description || '',
        priceInr: d.priceInr,
        interval: d.interval,
        limits: d.limits,
        active: d.active ?? true,
        sortOrder: d.sortOrder ?? 0
      }
    },
    { upsert: true, new: true }
  ).lean();

  await audit(p, req, { action: 'plan.upsert', resourceType: 'plan', meta: { code: d.code } });
  return jsonOk(updated);
}
