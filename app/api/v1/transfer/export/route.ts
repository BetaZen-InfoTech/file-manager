import { NextRequest } from 'next/server';
import mongoose from 'mongoose';
import { dbConnect } from '@/lib/db';
import { badRequest, forbidden, jsonOk, unauthorized } from '@/lib/http';
import { verifyTransferToken } from '@/lib/transfer-token';
import { decryptSecret } from '@/lib/crypto';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Collections a full migration can pull. File BYTES come from /transfer/file/:id/stream.
const COLLECTIONS: Record<string, string> = {
  vendors: 'vendors',
  users: 'users',
  apikeys: 'apikeys',
  buckets: 'buckets',
  folders: 'folders',
  files: 'files',
  links: 'links',
  plans: 'plans',
  payments: 'payments',
  platformsettings: 'platformsettings',
  auditlogs: 'auditlogs',
  jwtrevocations: 'jwtrevocations'
};

// SOURCE full-export: paginated raw documents per collection (keyset by _id).
// Requires an INSTANCE-scoped transfer token (a vendor token must not read the
// whole platform). Secrets in platform settings are DECRYPTED here so the target
// can re-encrypt them with its own key; password/api-key hashes pass through
// (keyless — they keep working on any server).
export async function GET(req: NextRequest) {
  const tok = await verifyTransferToken(req);
  if (!tok) return unauthorized('invalid transfer token');
  if (tok.kind !== 'instance') return forbidden('full export requires an instance-scoped transfer token');

  await dbConnect();
  const url = new URL(req.url);
  const collection = url.searchParams.get('collection') || '';
  const real = COLLECTIONS[collection];
  if (!real) return badRequest('unknown collection');
  const after = url.searchParams.get('after');
  const limit = Math.min(1000, Math.max(1, Number(url.searchParams.get('limit') || 500)));

  const coll = mongoose.connection.collection(real);
  const filter: any = {};
  if (collection === 'files') filter.status = 'ready'; // only streamable bytes
  if (after && mongoose.Types.ObjectId.isValid(after)) filter._id = { $gt: new mongoose.Types.ObjectId(after) };
  const items = await coll.find(filter).sort({ _id: 1 }).limit(limit).toArray();

  if (collection === 'platformsettings') {
    for (const d of items as any[]) {
      if (d.key === 'payments' && d.value) {
        if (d.value.razorpay?.keySecret) d.value.razorpay.keySecret = decryptSecret(String(d.value.razorpay.keySecret));
        if (d.value.phonepe?.saltKey) d.value.phonepe.saltKey = decryptSecret(String(d.value.phonepe.saltKey));
      }
      if (d.key === 'smtp' && d.value?.pass) d.value.pass = decryptSecret(String(d.value.pass));
    }
  }

  const nextAfter = items.length === limit ? String((items[items.length - 1] as any)._id) : null;
  const body: any = { collection, items, nextAfter };
  if (!after) body.total = await coll.countDocuments(filter);
  return jsonOk(body);
}
