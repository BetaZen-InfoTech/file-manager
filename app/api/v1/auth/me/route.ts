import { NextRequest } from 'next/server';
import { authenticate } from '@/lib/auth';
import { jsonOk, unauthorized } from '@/lib/http';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const p = await authenticate(req);
  if (!p) return unauthorized();
  return jsonOk({
    kind: p.kind,
    userId: p.userId || null,
    vendorId: p.vendorId,
    vendorStatus: p.vendorStatus,
    role: p.role,
    panel: p.panel,
    email: p.email || null,
    permissions: p.permissions
  });
}
