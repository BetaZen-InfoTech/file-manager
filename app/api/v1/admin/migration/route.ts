import { NextRequest } from 'next/server';
import { authenticate } from '@/lib/auth';
import { can } from '@/lib/rbac';
import { badRequest, forbidden, jsonOk, safeParseJson, unauthorized } from '@/lib/http';
import { migrationActionSchema } from '@/lib/validation';
import { audit } from '@/lib/audit';
import { dbConnect } from '@/lib/db';
import { encryptSecret } from '@/lib/crypto';
import { testSource, discoverSource, runMigration, testBcdnp, discoverBcdnp, runBcdnpTransfer, runFullMigration } from '@/lib/migration';
import { Migration } from '@/models/Migration';
import { Vendor } from '@/models/Vendor';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function redact(j: any) {
  if (!j) return j;
  const o = typeof j.toObject === 'function' ? j.toObject() : j;
  if (o.source) o.source = { ...o.source, accessKeyEnc: undefined, secretKeyEnc: undefined };
  if (o.bcdnp) o.bcdnp = { ...o.bcdnp, tokenEnc: undefined };
  return o;
}

export async function GET(req: NextRequest) {
  const p = await authenticate(req);
  if (!p) return unauthorized();
  if (!can(p, 'admin:vendor:read')) return forbidden();
  await dbConnect();
  const id = new URL(req.url).searchParams.get('id');
  if (id) {
    const job = await Migration.findById(id).lean();
    if (!job) return badRequest('not found');
    return jsonOk(redact(job));
  }
  const jobs = await Migration.find().sort({ createdAt: -1 }).limit(20).lean();
  return jsonOk({ jobs: jobs.map(redact) });
}

export async function POST(req: NextRequest) {
  const p = await authenticate(req);
  if (!p) return unauthorized();
  if (!can(p, 'admin:maintenance:toggle')) return forbidden();

  const body = await safeParseJson(req);
  const parsed = migrationActionSchema.safeParse(body);
  if (!parsed.success) return badRequest('Invalid input', { issues: parsed.error.issues });
  const { action, source, bcdnp, sourceType, id, targetVendorId, targetBucketName } = parsed.data;
  const st = sourceType || 's3';

  const isBcdnp = st === 'bcdnp' || st === 'bcdnp-full';

  // ---- test / discover ----
  if (action === 'test') {
    return jsonOk(isBcdnp ? await testBcdnp(bcdnp!.baseUrl, bcdnp!.token) : await testSource(source!));
  }
  if (action === 'discover') {
    return jsonOk(isBcdnp ? await discoverBcdnp(bcdnp!.baseUrl, bcdnp!.token) : await discoverSource(source!));
  }

  await dbConnect();

  // ---- resume / cancel ----
  if (action === 'resume') {
    const job = await Migration.findById(id).lean();
    if (!job) return badRequest('job not found');
    await audit(p, req, { action: 'migration.resume', resourceType: 'migration', resourceId: String(id) });
    const stype = (job as any).sourceType;
    if (stype === 'bcdnp-full') void runFullMigration(String(id));
    else if (stype === 'bcdnp') void runBcdnpTransfer(String(id));
    else void runMigration(String(id));
    return jsonOk({ id, status: 'running' });
  }
  if (action === 'cancel') {
    await Migration.updateOne({ _id: id, status: { $in: ['pending', 'running'] } }, { $set: { status: 'cancelled' } });
    await audit(p, req, { action: 'migration.cancel', resourceType: 'migration', resourceId: String(id) });
    return jsonOk({ id, status: 'cancelled' });
  }

  // ---- start: full platform migration (no single target vendor) ----
  if (st === 'bcdnp-full') {
    const t = await testBcdnp(bcdnp!.baseUrl, bcdnp!.token);
    if (!t.ok) return badRequest(`Source not reachable: ${t.message}`);
    const job = await Migration.create({
      sourceType: 'bcdnp-full',
      bcdnp: { baseUrl: bcdnp!.baseUrl.replace(/\/+$/, ''), tokenEnc: encryptSecret(bcdnp!.token) },
      targetBucketName: 'full-migration',
      status: 'pending',
      createdBy: p.userId || null
    });
    await audit(p, req, { action: 'migration.start', resourceType: 'migration', resourceId: String(job._id), meta: { sourceType: 'bcdnp-full' } });
    void runFullMigration(String(job._id));
    return jsonOk({ id: String(job._id), status: 'pending' });
  }

  // ---- start: single-bucket file import ----
  const vendor = await Vendor.findById(targetVendorId).lean();
  if (!vendor) return badRequest('target vendor not found');

  if (st === 'bcdnp') {
    const t = await testBcdnp(bcdnp!.baseUrl, bcdnp!.token);
    if (!t.ok) return badRequest(`Source not reachable: ${t.message}`);
    const job = await Migration.create({
      sourceType: 'bcdnp',
      bcdnp: { baseUrl: bcdnp!.baseUrl.replace(/\/+$/, ''), tokenEnc: encryptSecret(bcdnp!.token) },
      targetVendorId,
      targetBucketName,
      status: 'pending',
      createdBy: p.userId || null
    });
    await audit(p, req, { action: 'migration.start', resourceType: 'migration', resourceId: String(job._id), meta: { sourceType: 'bcdnp' } });
    void runBcdnpTransfer(String(job._id));
    return jsonOk({ id: String(job._id), status: 'pending' });
  }

  // s3
  const t = await testSource(source!);
  if (!t.ok) return badRequest(`Source not reachable: ${t.message}`);
  const job = await Migration.create({
    sourceType: 's3',
    source: {
      endpoint: source!.endpoint,
      region: source!.region || 'us-east-1',
      accessKeyEnc: encryptSecret(source!.accessKey),
      secretKeyEnc: encryptSecret(source!.secretKey),
      bucket: source!.bucket,
      prefix: source!.prefix || '',
      forcePathStyle: source!.forcePathStyle !== false
    },
    targetVendorId,
    targetBucketName,
    status: 'pending',
    createdBy: p.userId || null
  });
  await audit(p, req, { action: 'migration.start', resourceType: 'migration', resourceId: String(job._id), meta: { sourceType: 's3' } });
  void runMigration(String(job._id));
  return jsonOk({ id: String(job._id), status: 'pending' });
}
