import { NextRequest } from 'next/server';
import { dbConnect } from '@/lib/db';
import { authenticate } from '@/lib/auth';
import { can } from '@/lib/rbac';
import { forbidden, jsonOk, safeParseJson, unauthorized } from '@/lib/http';
import { audit } from '@/lib/audit';
import { syncVendorUsage, syncAllVendorsUsage } from '@/lib/vendor-stats';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

// POST { vendorId? } → reconcile cached storage counters to the real files.
// With a vendorId, syncs just that vendor; otherwise syncs every vendor.
export async function POST(req: NextRequest) {
  const p = await authenticate(req);
  if (!p) return unauthorized();
  if (!can(p, 'admin:usage:read')) return forbidden();
  await dbConnect();

  const body = (await safeParseJson(req)) as { vendorId?: string } | null;
  const vendorId = body?.vendorId && /^[a-f0-9]{24}$/i.test(body.vendorId) ? body.vendorId : null;

  if (vendorId) {
    const usage = await syncVendorUsage(vendorId);
    await audit(p, req, { action: 'usage.sync', resourceType: 'vendor', resourceId: vendorId, meta: { ...usage } });
    return jsonOk({ ok: true, vendorId, usage });
  }

  const result = await syncAllVendorsUsage();
  await audit(p, req, { action: 'usage.sync.all', resourceType: 'platform', meta: result });
  return jsonOk({ ok: true, ...result });
}
