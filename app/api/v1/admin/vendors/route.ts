import { NextRequest } from 'next/server';
import { dbConnect } from '@/lib/db';
import { authenticate, hashPassword } from '@/lib/auth';
import { can, permissionsForRole } from '@/lib/rbac';
import {
  badRequest,
  forbidden,
  jsonOk,
  safeParseJson,
  unauthorized
} from '@/lib/http';
import { createVendorSchema } from '@/lib/validation';
import { safeSearchRegExp } from '@/lib/search';
import { audit } from '@/lib/audit';
import { usernameFromName, disambiguateUsername } from '@/lib/username';
import { vendorHome } from '@/lib/server-fs';
import { Vendor } from '@/models/Vendor';
import { User } from '@/models/User';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const p = await authenticate(req);
  if (!p) return unauthorized();
  if (!can(p, 'admin:vendor:read')) return forbidden();
  await dbConnect();
  const url = new URL(req.url);
  const page = Math.max(1, Number(url.searchParams.get('page') || 1));
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit') || 25)));
  const filter: any = {};
  const qre = safeSearchRegExp(url.searchParams.get('q'));
  if (qre) filter.$or = [{ name: qre }, { slug: qre }];
  const [items, total] = await Promise.all([
    Vendor.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    Vendor.countDocuments(filter)
  ]);
  return jsonOk({ items, total, page, limit });
}

export async function POST(req: NextRequest) {
  const p = await authenticate(req);
  if (!p) return unauthorized();
  if (!can(p, 'admin:vendor:update')) return forbidden();
  const body = await safeParseJson(req);
  const parsed = createVendorSchema.safeParse(body);
  if (!parsed.success) return badRequest('Invalid input', { issues: parsed.error.issues });
  await dbConnect();
  const existing = await Vendor.findOne({ slug: parsed.data.slug });
  if (existing) return badRequest('slug already exists');

  // Auto-derive a folder-safe username ([a-z0-9_]) from the name, made unique
  // against existing usernames. This names the vendor's private server folder.
  const base = usernameFromName(parsed.data.name);
  const taken = await Vendor.find({ username: new RegExp(`^${base}(_\\d+)?$`) })
    .select('username')
    .lean();
  const username = disambiguateUsername(
    base,
    taken.map((t: any) => t.username).filter(Boolean)
  );

  const vendor = await Vendor.create({
    name: parsed.data.name,
    slug: parsed.data.slug,
    username,
    plan: parsed.data.plan || 'free',
    status: 'active',
    contactEmail: parsed.data.ownerEmail?.toLowerCase() || null,
    limits: {
      maxStorageBytes: parsed.data.limits?.maxStorageBytes ?? 10 * 1024 * 1024 * 1024,
      maxBuckets: parsed.data.limits?.maxBuckets ?? 10,
      maxApiKeys: parsed.data.limits?.maxApiKeys ?? 10,
      maxFileSizeBytes: parsed.data.limits?.maxFileSizeBytes ?? 500 * 1024 * 1024
    }
  });

  // Create the vendor's root folder now (/var/www/vendors/<username>). Best-effort:
  // it's also auto-created on first file-manager access, so a transient FS error
  // here must not fail vendor creation.
  try {
    await vendorHome(username);
  } catch (err) {
    console.error('vendor home folder create failed', err);
  }

  let ownerCreated = null;
  if (parsed.data.ownerEmail && parsed.data.ownerPassword) {
    const existingUser = await User.findOne({ email: parsed.data.ownerEmail.toLowerCase() });
    if (!existingUser) {
      ownerCreated = await User.create({
        vendorId: vendor._id,
        email: parsed.data.ownerEmail.toLowerCase(),
        passwordHash: await hashPassword(parsed.data.ownerPassword),
        role: 'vendor_owner',
        permissions: permissionsForRole('vendor_owner')
      });
    }
  }

  await audit(p, req, {
    action: 'vendor.create',
    resourceType: 'vendor',
    resourceId: String(vendor._id),
    vendorId: String(vendor._id),
    meta: { username }
  });

  return jsonOk(
    {
      vendor,
      owner: ownerCreated
        ? { id: String(ownerCreated._id), email: ownerCreated.email }
        : null
    },
    201
  );
}
