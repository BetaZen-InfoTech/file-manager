import { NextRequest } from 'next/server';
import argon2 from 'argon2';
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
  suspended
} from '@/lib/http';
import { audit } from '@/lib/audit';
import { fireVendorWebhook } from '@/lib/webhook';
import { createLinkSchema } from '@/lib/validation';
import { clampExpiresIn, createLinkToken, linkUrl } from '@/lib/links';
import { Link } from '@/models/Link';
import { FileModel } from '@/models/File';

export const runtime = 'nodejs';

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const p = await authenticate(req);
  if (!p) return unauthorized();
  if (!p.vendorId) return forbidden();
  await dbConnect();
  const file = await FileModel.findOne({ _id: params.id, vendorId: p.vendorId }).lean();
  if (!file) return notFound('file not found');
  if (!can(p, 'file:read', { vendorId: p.vendorId, bucketId: String(file.bucketId) }))
    return forbidden();
  const links = await Link.find({
    fileId: params.id,
    vendorId: p.vendorId,
    status: 'active'
  })
    .sort({ createdAt: -1 })
    .lean();
  return jsonOk({
    items: links.map((l) => ({
      id: String(l._id),
      type: l.type,
      url: linkUrl(l.type, l.token),
      expiresAt: l.expiresAt,
      maxDownloads: l.maxDownloads,
      downloadCount: l.downloadCount,
      requiredScope: l.requiredScope,
      status: l.status
    }))
  });
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const p = await authenticate(req);
  if (!p) return unauthorized();
  if (!p.vendorId) return forbidden();
  if (p.vendorStatus === 'suspended') return suspended();
  if (!can(p, 'publicurl:create', { vendorId: p.vendorId })) return forbidden();
  const body = await safeParseJson(req);
  const parsed = createLinkSchema.safeParse(body);
  if (!parsed.success) return badRequest('Invalid input', { issues: parsed.error.issues });

  await dbConnect();
  const file = await FileModel.findOne({
    _id: params.id,
    vendorId: p.vendorId,
    status: 'ready'
  }).lean();
  if (!file) return notFound('file not found');

  // A temporary link must carry an explicit lifetime. Check the raw input —
  // clampExpiresIn() would otherwise silently substitute a 60s default and mask
  // a missing expiresIn.
  if (parsed.data.type === 'temporary' && !parsed.data.expiresIn) {
    return badRequest('temporary links require expiresIn');
  }
  const expiresAt = clampExpiresIn(parsed.data.expiresIn, !!parsed.data.neverExpire);

  const token = createLinkToken();
  const passwordHash = parsed.data.password
    ? await argon2.hash(parsed.data.password, { type: argon2.argon2id })
    : null;

  const link = await Link.create({
    vendorId: p.vendorId,
    fileId: file._id,
    type: parsed.data.type,
    token,
    expiresAt,
    maxDownloads: parsed.data.maxDownloads ?? null,
    downloadCount: 0,
    requiredScope: parsed.data.requiredScope || 'file:download',
    passwordHash,
    status: 'active',
    createdBy: p.userId || null,
    note:
      parsed.data.type === 'private'
        ? 'private link: send Authorization: Bearer <jwt> to download'
        : ''
  });

  await audit(p, req, {
    action: 'link.create',
    resourceType: 'link',
    resourceId: String(link._id),
    meta: { type: parsed.data.type, fileId: String(file._id) }
  });

  fireVendorWebhook({
    event: 'link.created',
    vendorId: p.vendorId,
    data: { id: String(link._id), type: link.type, fileId: String(file._id) }
  }).catch(() => {});

  return jsonOk(
    {
      id: String(link._id),
      type: link.type,
      fileId: String(file._id),
      accessUrl: linkUrl(link.type, token),
      expiresAt: link.expiresAt,
      maxDownloads: link.maxDownloads,
      note: link.note
    },
    201
  );
}
