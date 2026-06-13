import { NextRequest } from 'next/server';
import fsp from 'fs/promises';
import { badRequest, forbidden, jsonOk, safeParseJson, unauthorized } from '@/lib/http';
import { fsOpSchema } from '@/lib/validation';
import { audit } from '@/lib/audit';
import { requireVendorFs, resolveInJail, toRel, jailParent, listDir } from '@/lib/server-fs';
import { executeFsOp } from '@/lib/fs-ops';
import { listTrash } from '@/lib/fs-trash';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// The vendor's recoverable trash lives inside their jailed home (hidden folder).
const vendorTrashRoot = (home: string) => resolveInJail(home, '/.trash');

// GET ?path=/rel/dir → listing, jailed. GET ?trash=1 → list trashed items.
export async function GET(req: NextRequest) {
  const g = await requireVendorFs(req);
  if ('error' in g) return g.error === 'forbidden' ? forbidden('vendor account required') : unauthorized();
  const { home } = g;
  const url = new URL(req.url);
  if (url.searchParams.get('trash') === '1') {
    const tr = vendorTrashRoot(home);
    return jsonOk({ trash: tr ? await listTrash(tr) : [] });
  }
  const rel = url.searchParams.get('path') || '/';
  const dir = resolveInJail(home, rel);
  if (!dir) return badRequest('invalid path');
  try {
    const st = await fsp.stat(dir);
    if (!st.isDirectory()) return badRequest('not a directory');
    const listing = await listDir(dir);
    // Return vendor-relative paths only — the real home is never exposed.
    return jsonOk({ path: toRel(home, dir), entries: listing.entries, parent: jailParent(home, dir), defaultPath: '/' });
  } catch (e: any) {
    return badRequest(e?.message || 'cannot read directory');
  }
}

// POST { action, ... } → mutating ops, all confined to the vendor's jail.
export async function POST(req: NextRequest) {
  const g = await requireVendorFs(req);
  if ('error' in g) return g.error === 'forbidden' ? forbidden('vendor account required') : unauthorized();
  const { p, home } = g;

  const body = await safeParseJson(req);
  const parsed = fsOpSchema.safeParse(body);
  if (!parsed.success) return badRequest('Invalid input', { issues: parsed.error.issues });
  const d = parsed.data;

  const r = await executeFsOp(d, (x) => resolveInJail(home, x), { trashRoot: vendorTrashRoot(home) });
  if (r.error) return badRequest(r.error);

  await audit(p, req, { action: `fs.${d.action}`, resourceType: 'vendor_filesystem', meta: { path: d.path, to: d.to } });
  return jsonOk({ ok: true });
}
