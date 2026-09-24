import { NextRequest } from 'next/server';
import { dbConnect } from '@/lib/db';
import { authenticate } from '@/lib/auth';
import { can } from '@/lib/rbac';
import {
  badRequest,
  forbidden,
  jsonOk,
  notFound,
  safeParseJson,
  unauthorized,
  isObjectIdHex
} from '@/lib/http';
import { audit } from '@/lib/audit';
import { resetLinksSchema } from '@/lib/validation';
import { createLinkToken, linkUrl } from '@/lib/links';
import { Link } from '@/models/Link';
import { FileModel } from '@/models/File';

export const runtime = 'nodejs';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const p = await authenticate(req);
  if (!p) return unauthorized();
  if (!p.vendorId) return forbidden();
  const body = await safeParseJson(req);
  const parsed = resetLinksSchema.safeParse(body ?? {});
  if (!parsed.success) return badRequest('Invalid input');

  if (!isObjectIdHex(params.id)) return notFound('file not found');
  await dbConnect();
  const file = await FileModel.findOne({ _id: params.id, vendorId: p.vendorId }).lean();
  if (!file) return notFound('file not found');
  if (!can(p, 'publicurl:revoke', { vendorId: p.vendorId, bucketId: String(file.bucketId) }))
    return forbidden();

  const filter: any = { fileId: file._id, vendorId: p.vendorId, status: 'active' };
  if (parsed.data.types && parsed.data.types.length > 0) filter.type = { $in: parsed.data.types };

  const previously = await Link.find(filter).lean();
  await Link.updateMany(filter, { $set: { status: 'revoked' } });

  let regenerated: Array<{
    id: string;
    type: string;
    accessUrl: string;
    expiresAt: Date | null;
  }> = [];
  if (parsed.data.regenerate) {
    regenerated = await Promise.all(
      previously.map(async (l) => {
        const token = createLinkToken();
        // Give the rotated link a FRESH lifetime instead of copying the old
        // absolute `expiresAt`. Every link's expiry is created from a duration
        // (expiresIn) or `neverExpire`, so preserving the original DURATION from
        // now is faithful to how it was made — and, crucially, never produces a
        // link that is born already-expired (which copying a past `expiresAt`
        // did, e.g. rotating a short-TTL or already-expired temporary link).
        let newExpiresAt: Date | null = null;
        if (l.expiresAt) {
          const createdMs = (l as any).createdAt ? new Date((l as any).createdAt).getTime() : Date.now();
          const durationMs = new Date(l.expiresAt).getTime() - createdMs;
          newExpiresAt = new Date(Date.now() + Math.max(durationMs, 60_000));
        }
        const nl = await Link.create({
          vendorId: l.vendorId,
          fileId: l.fileId,
          type: l.type,
          token,
          expiresAt: newExpiresAt,
          maxDownloads: l.maxDownloads,
          requiredScope: l.requiredScope,
          // Carry over the access protection — a rotated link MUST keep the same
          // password gate and label, otherwise regeneration silently downgrades a
          // password-protected link to a public one.
          passwordHash: l.passwordHash,
          note: l.note,
          status: 'active',
          createdBy: p.userId || null
        });
        return {
          id: String(nl._id),
          type: nl.type,
          accessUrl: linkUrl(nl.type, token),
          expiresAt: nl.expiresAt
        };
      })
    );
  }

  await audit(p, req, {
    action: 'link.reset',
    resourceType: 'file',
    resourceId: String(file._id),
    meta: { revokedCount: previously.length, regenerated: regenerated.length }
  });

  return jsonOk({
    revoked: previously.length,
    regenerated
  });
}
