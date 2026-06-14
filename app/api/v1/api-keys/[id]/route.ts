import { NextRequest } from 'next/server';
import mongoose from 'mongoose';
import { dbConnect } from '@/lib/db';
import { authenticate } from '@/lib/auth';
import { can } from '@/lib/rbac';
import { badRequest, forbidden, jsonOk, notFound, safeParseJson, unauthorized } from '@/lib/http';
import { audit } from '@/lib/audit';
import { updateApiKeyScopesSchema } from '@/lib/validation';
import { ALL_SCOPES } from '@/lib/api-catalog';
import { ApiKey } from '@/models/ApiKey';

export const runtime = 'nodejs';

// PATCH { permissions } → update an existing key's scopes (panel "Edit scopes").
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const p = await authenticate(req);
  if (!p) return unauthorized();
  if (!p.vendorId) return forbidden();
  // Managing keys requires the create capability — API keys don't carry it, so a
  // key can never escalate its own (or another key's) scopes.
  if (!can(p, 'apikey:create', { vendorId: p.vendorId })) return forbidden();
  if (!mongoose.Types.ObjectId.isValid(params.id)) return notFound('api key not found');
  const body = await safeParseJson(req);
  const parsed = updateApiKeyScopesSchema.safeParse(body);
  if (!parsed.success) return badRequest('Invalid input', { issues: parsed.error.issues });
  // Only ever allow the grantable vendor scopes (never admin/platform scopes).
  const allowed = new Set(ALL_SCOPES);
  const grantable = [...new Set(parsed.data.permissions)].filter((s) => allowed.has(s));
  if (grantable.length === 0) return badRequest('No valid scopes provided');
  await dbConnect();
  const existing = await ApiKey.findOne({ _id: params.id, vendorId: p.vendorId, status: 'active' })
    .select('permissions')
    .lean();
  if (!existing) return notFound('api key not found');
  // Preserve any pre-existing non-grantable scopes (never silently drop them);
  // only the grantable subset is editable here.
  const preserved = ((existing as any).permissions || []).filter((s: string) => !allowed.has(s));
  const finalPerms = [...new Set([...preserved, ...grantable])];
  const k = await ApiKey.findOneAndUpdate(
    { _id: params.id, vendorId: p.vendorId, status: 'active' },
    { $set: { permissions: finalPerms } },
    { new: true }
  )
    .select('-keyHash')
    .lean();
  if (!k) return notFound('api key not found');
  await audit(p, req, {
    action: 'apikey.update',
    resourceType: 'apikey',
    resourceId: String((k as any)._id),
    meta: { permissions: finalPerms }
  });
  return jsonOk({
    id: String((k as any)._id),
    name: (k as any).name,
    prefix: (k as any).prefix,
    permissions: (k as any).permissions,
    status: (k as any).status
  });
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const p = await authenticate(req);
  if (!p) return unauthorized();
  if (!p.vendorId) return forbidden();
  if (!can(p, 'apikey:revoke', { vendorId: p.vendorId })) return forbidden();
  await dbConnect();
  const k = await ApiKey.findOneAndUpdate(
    { _id: params.id, vendorId: p.vendorId, status: 'active' },
    { $set: { status: 'revoked' } },
    { new: true }
  );
  if (!k) return notFound('api key not found');
  await audit(p, req, {
    action: 'apikey.revoke',
    resourceType: 'apikey',
    resourceId: String(k._id)
  });
  return jsonOk({ ok: true });
}
