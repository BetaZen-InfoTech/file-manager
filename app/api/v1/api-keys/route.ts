import { NextRequest } from 'next/server';
import { dbConnect } from '@/lib/db';
import { authenticate } from '@/lib/auth';
import { can } from '@/lib/rbac';
import {
  badRequest,
  forbidden,
  jsonOk,
  safeParseJson,
  unauthorized
} from '@/lib/http';
import { audit } from '@/lib/audit';
import { generateApiKey } from '@/lib/crypto';
import { createApiKeySchema } from '@/lib/validation';
import { ApiKey } from '@/models/ApiKey';
import { Vendor } from '@/models/Vendor';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const p = await authenticate(req);
  if (!p) return unauthorized();
  if (!p.vendorId) return forbidden();
  await dbConnect();
  const items = await ApiKey.find({ vendorId: p.vendorId })
    .sort({ createdAt: -1 })
    .select('-keyHash')
    .lean();
  return jsonOk({ items });
}

export async function POST(req: NextRequest) {
  const p = await authenticate(req);
  if (!p) return unauthorized();
  if (!p.vendorId) return forbidden();
  if (!can(p, 'apikey:create', { vendorId: p.vendorId })) return forbidden();
  const body = await safeParseJson(req);
  const parsed = createApiKeySchema.safeParse(body);
  if (!parsed.success) return badRequest('Invalid input', { issues: parsed.error.issues });
  await dbConnect();
  const vendor = await Vendor.findById(p.vendorId).lean();
  if (!vendor) return forbidden();
  const keyCount = await ApiKey.countDocuments({ vendorId: p.vendorId, status: 'active' });
  if (vendor.limits.maxApiKeys && keyCount >= vendor.limits.maxApiKeys) {
    return badRequest('API key limit reached');
  }
  const { plain, prefix, hash } = generateApiKey();
  const expiresAt = parsed.data.expiresAt ? new Date(parsed.data.expiresAt) : null;
  const doc = await ApiKey.create({
    vendorId: p.vendorId,
    name: parsed.data.name,
    keyHash: hash,
    prefix,
    permissions: parsed.data.permissions,
    bucketIds: parsed.data.bucketIds || [],
    status: 'active',
    expiresAt,
    createdBy: p.userId || null
  });
  await audit(p, req, {
    action: 'apikey.create',
    resourceType: 'apikey',
    resourceId: String(doc._id),
    meta: { prefix, permissions: parsed.data.permissions }
  });
  return jsonOk(
    {
      id: String(doc._id),
      name: doc.name,
      prefix: doc.prefix,
      permissions: doc.permissions,
      bucketIds: doc.bucketIds.map(String),
      expiresAt: doc.expiresAt,
      key: plain
    },
    201
  );
}
