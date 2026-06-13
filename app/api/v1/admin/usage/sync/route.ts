import { NextRequest } from 'next/server';
import { dbConnect } from '@/lib/db';
import { authenticate } from '@/lib/auth';
import { can } from '@/lib/rbac';
import { forbidden, jsonOk, safeParseJson, unauthorized } from '@/lib/http';
import { audit } from '@/lib/audit';
import { syncVendorUsage, syncAllVendorsUsage } from '@/lib/vendor-stats';
import { backfillVendorFiles } from '@/lib/file-mirror';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// POST { vendorId? } → reconcile cached storage counters to the real files, and
// (per-vendor) mirror its bucket files onto the File Manager. With a vendorId,
// syncs just that vendor; otherwise syncs every vendor's counters.
export async function POST(req: NextRequest) {
  const p = await authenticate(req);
  if (!p) return unauthorized();
  if (!can(p, 'admin:usage:read')) return forbidden();
  await dbConnect();

  const body = (await safeParseJson(req)) as { vendorId?: string } | null;
  const vendorId = body?.vendorId && /^[a-f0-9]{24}$/i.test(body.vendorId) ? body.vendorId : null;

  if (vendorId) {
    const usage = await syncVendorUsage(vendorId);
    // Also mirror this vendor's bucket files to the File Manager (idempotent).
    const mirror = await backfillVendorFiles(vendorId).catch(() => ({ written: 0, skipped: 0, failed: 0 }));
    await audit(p, req, { action: 'usage.sync', resourceType: 'vendor', resourceId: vendorId, meta: { ...usage, mirror } });
    return jsonOk({ ok: true, vendorId, usage, mirror });
  }

  const result = await syncAllVendorsUsage();
  await audit(p, req, { action: 'usage.sync.all', resourceType: 'platform', meta: result });
  return jsonOk({ ok: true, ...result });
}
