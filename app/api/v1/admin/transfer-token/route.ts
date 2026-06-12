import { NextRequest } from 'next/server';
import { authenticate } from '@/lib/auth';
import { can } from '@/lib/rbac';
import { badRequest, forbidden, jsonOk, safeParseJson, unauthorized } from '@/lib/http';
import { transferTokenSchema } from '@/lib/validation';
import { audit } from '@/lib/audit';
import { dbConnect } from '@/lib/db';
import { sha256 } from '@/lib/crypto';
import { generateTransferToken } from '@/lib/transfer-token';
import { TransferToken } from '@/models/TransferToken';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// List active/recent tokens (never the hash or plaintext).
export async function GET(req: NextRequest) {
  const p = await authenticate(req);
  if (!p) return unauthorized();
  if (!can(p, 'admin:vendor:read')) return forbidden();
  await dbConnect();
  const tokens = await TransferToken.find()
    .sort({ createdAt: -1 })
    .limit(20)
    .select('label status scope expiresAt lastUsedAt createdAt')
    .lean();
  return jsonOk({ tokens });
}

export async function POST(req: NextRequest) {
  const p = await authenticate(req);
  if (!p) return unauthorized();
  if (!can(p, 'admin:maintenance:toggle')) return forbidden();

  const body = await safeParseJson(req);
  const parsed = transferTokenSchema.safeParse(body);
  if (!parsed.success) return badRequest('Invalid input', { issues: parsed.error.issues });
  const { action, hours, label, vendorId, id } = parsed.data;

  await dbConnect();

  if (action === 'revoke') {
    if (!id) return badRequest('id required');
    await TransferToken.updateOne({ _id: id }, { $set: { status: 'revoked' } });
    await audit(p, req, { action: 'transfer.token.revoke', resourceType: 'transfer_token', resourceId: String(id) });
    return jsonOk({ ok: true });
  }

  // create
  const plain = generateTransferToken();
  const expiresAt = new Date(Date.now() + (hours || 24) * 3600 * 1000);
  const doc = await TransferToken.create({
    tokenHash: sha256(plain),
    scope: vendorId ? { kind: 'vendor', vendorId } : { kind: 'instance' },
    label: label || '',
    expiresAt,
    createdBy: p.userId || null
  });
  await audit(p, req, { action: 'transfer.token.create', resourceType: 'transfer_token', resourceId: String(doc._id) });

  // Plaintext shown ONCE.
  return jsonOk({ id: String(doc._id), token: plain, expiresAt, label: doc.label });
}
