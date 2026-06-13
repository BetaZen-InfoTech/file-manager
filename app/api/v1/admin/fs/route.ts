import { NextRequest } from 'next/server';
import fsp from 'fs/promises';
import path from 'path';
import { badRequest, forbidden, jsonOk, safeParseJson, unauthorized } from '@/lib/http';
import { fsOpSchema } from '@/lib/validation';
import { audit } from '@/lib/audit';
import { requireFsAdmin, safePath, listDir, FS_DEFAULT_PATH, FS_ROOT, FS_VENDOR_ROOT } from '@/lib/server-fs';
import { executeFsOp } from '@/lib/fs-ops';
import { listTrash } from '@/lib/fs-trash';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// Recoverable trash location for the server file manager. The default is kept
// inside FS_ROOT so a confined deployment (FS_ROOT set to a subtree) still has a
// reachable trash; override with FS_TRASH_ROOT (must resolve within FS_ROOT).
function adminTrashRoot(): string | null {
  const fallback = FS_ROOT && FS_ROOT !== '/' ? path.join(FS_ROOT, '.fs-trash') : '/var/www/.fs-trash';
  return safePath(process.env.FS_TRASH_ROOT || fallback);
}

// GET ?path=/abs/dir → directory listing. GET ?trash=1 → list trashed items.
export async function GET(req: NextRequest) {
  const p = await requireFsAdmin(req);
  if (!p) return p === null ? forbidden('super-admin only') : unauthorized();
  const url = new URL(req.url);
  if (url.searchParams.get('trash') === '1') {
    const tr = adminTrashRoot();
    return jsonOk({ trash: tr ? await listTrash(tr) : [] });
  }
  const raw = url.searchParams.get('path') || FS_DEFAULT_PATH;
  const dir = safePath(raw);
  if (!dir) return badRequest('invalid path');
  try {
    let st = await fsp.stat(dir).catch(() => null);
    // "Open folder" may target a vendor home that hasn't been used yet — create
    // it on demand (only within the vendor jail root, never arbitrary paths).
    const vendorRoot = path.resolve(FS_VENDOR_ROOT);
    if (!st && (dir === vendorRoot || dir.startsWith(vendorRoot + path.sep))) {
      await fsp.mkdir(dir, { recursive: true });
      st = await fsp.stat(dir).catch(() => null);
    }
    if (!st) return badRequest('cannot read directory');
    if (!st.isDirectory()) return badRequest('not a directory');
    const listing = await listDir(dir);
    return jsonOk({ ...listing, parent: path.dirname(dir), defaultPath: FS_DEFAULT_PATH });
  } catch (e: any) {
    return badRequest(e?.message || 'cannot read directory');
  }
}

// POST { action, ... } → mutating operations (full FS, super-admin only).
export async function POST(req: NextRequest) {
  const p = await requireFsAdmin(req);
  if (!p) return p === null ? forbidden('super-admin only') : unauthorized();

  const body = await safeParseJson(req);
  const parsed = fsOpSchema.safeParse(body);
  if (!parsed.success) return badRequest('Invalid input', { issues: parsed.error.issues });
  const d = parsed.data;

  const r = await executeFsOp(d, safePath, { trashRoot: adminTrashRoot() });
  if (r.error) return badRequest(r.error);

  await audit(p, req, { action: `fs.${d.action}`, resourceType: 'filesystem', meta: { path: d.path, to: d.to } });
  return jsonOk({ ok: true });
}
