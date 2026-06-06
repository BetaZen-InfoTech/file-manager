import { NextRequest } from 'next/server';
import { dbConnect } from '@/lib/db';
import { authenticate } from '@/lib/auth';
import { can } from '@/lib/rbac';
import { forbidden, jsonOk, unauthorized } from '@/lib/http';
import { AuditLog } from '@/models/AuditLog';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const p = await authenticate(req);
  if (!p) return unauthorized();
  if (!can(p, 'admin:audit:read')) return forbidden();
  await dbConnect();
  const url = new URL(req.url);
  const vendorId = url.searchParams.get('vendorId');
  const action = url.searchParams.get('action');
  const page = Math.max(1, Number(url.searchParams.get('page') || 1));
  const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit') || 50)));
  const filter: any = {};
  if (vendorId) filter.vendorId = vendorId;
  if (action) filter.action = action;
  const [items, total] = await Promise.all([
    AuditLog.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    AuditLog.countDocuments(filter)
  ]);
  return jsonOk({ items, total, page, limit });
}
