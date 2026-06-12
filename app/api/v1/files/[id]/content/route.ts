import { NextRequest } from 'next/server';
import { Readable } from 'stream';
import { dbConnect } from '@/lib/db';
import { authenticate } from '@/lib/auth';
import { can } from '@/lib/rbac';
import { badRequest, forbidden, jsonOk, notFound, quotaExceeded, safeParseJson, suspended, unauthorized } from '@/lib/http';
import { audit } from '@/lib/audit';
import { editContentSchema } from '@/lib/validation';
import { storage } from '@/lib/storage';
import { checkQuota, incrementUsage } from '@/lib/quota';
import { sha256, md5 } from '@/lib/crypto';
import { FileModel } from '@/models/File';
import { Bucket } from '@/models/Bucket';

export const runtime = 'nodejs';

const TEXT_MAX = 1024 * 1024; // 1 MB editable
function isTextual(mime: string, name: string): boolean {
  return (
    /^text\//i.test(mime) ||
    /(json|xml|csv|javascript|typescript|html|x-sh|x-yaml|yaml|markdown)/i.test(mime) ||
    /\.(txt|md|json|csv|xml|html?|css|js|ts|tsx|jsx|yml|yaml|sh|env|ini|conf|log)$/i.test(name)
  );
}

async function toBuffer(body: unknown): Promise<Buffer> {
  const stream = body as Readable;
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
  return Buffer.concat(chunks);
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const p = await authenticate(req);
  if (!p) return unauthorized();
  if (!p.vendorId) return forbidden();
  if (!can(p, 'file:read', { vendorId: p.vendorId })) return forbidden();
  await dbConnect();
  const file = await FileModel.findOne({ _id: params.id, vendorId: p.vendorId, status: 'ready' }).lean();
  if (!file) return notFound('file not found');
  if (!isTextual(file.mimeType, file.originalName)) return badRequest('not a text file');
  if (file.sizeBytes > TEXT_MAX) return badRequest('file too large to edit inline (max 1 MB)');
  const { stream } = await storage.getObject(file.storageKey);
  const buf = await toBuffer(stream);
  return jsonOk({ content: buf.toString('utf8'), mimeType: file.mimeType, sizeBytes: file.sizeBytes });
}

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const p = await authenticate(req);
  if (!p) return unauthorized();
  if (!p.vendorId) return forbidden();
  if (p.vendorStatus === 'suspended') return suspended();
  if (!can(p, 'file:upload', { vendorId: p.vendorId })) return forbidden();

  const body = await safeParseJson(req);
  const parsed = editContentSchema.safeParse(body);
  if (!parsed.success) return badRequest('Invalid input');

  await dbConnect();
  const file = await FileModel.findOne({ _id: params.id, vendorId: p.vendorId, status: 'ready' });
  if (!file) return notFound('file not found');
  if (!isTextual(file.mimeType, file.originalName)) return badRequest('not a text file');

  const buf = Buffer.from(parsed.data.content, 'utf8');
  const delta = buf.byteLength - file.sizeBytes;
  if (delta > 0) {
    const quota = await checkQuota(p.vendorId, delta);
    if (!quota.ok) return quotaExceeded();
  }

  await storage.ensureBucket();
  // Write to a NEW key (don't overwrite a possibly-shared/deduped object).
  const safe = file.originalName.replace(/[^\w.\-]/g, '_');
  const newKey = `vendors/${p.vendorId}/buckets/${file.bucketId}/${file._id}/v${Date.now()}-${safe}`;
  await storage.putObject(newKey, buf, { mimeType: file.mimeType });

  file.storageKey = newKey;
  file.sizeBytes = buf.byteLength;
  file.checksum = { sha256: sha256(buf), md5: md5(buf) };
  (file as any).version = ((file as any).version || 1) + 1;
  await file.save();

  await Promise.all([
    incrementUsage(p.vendorId, delta, 0),
    Bucket.updateOne({ _id: file.bucketId }, { $inc: { storageBytes: delta } })
  ]);

  await audit(p, req, { action: 'file.edit', resourceType: 'file', resourceId: String(file._id) });
  return jsonOk({ ok: true, sizeBytes: file.sizeBytes });
}
