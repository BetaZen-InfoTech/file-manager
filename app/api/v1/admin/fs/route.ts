import { NextRequest } from 'next/server';
import fsp from 'fs/promises';
import path from 'path';
import { badRequest, forbidden, jsonOk, safeParseJson, unauthorized } from '@/lib/http';
import { fsOpSchema } from '@/lib/validation';
import { audit } from '@/lib/audit';
import { requireFsAdmin, safePath, listDir, FS_DEFAULT_PATH } from '@/lib/server-fs';
import { executeFsOp } from '@/lib/fs-ops';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// GET ?path=/abs/dir → directory listing.
export async function GET(req: NextRequest) {
  const p = await requireFsAdmin(req);
  if (!p) return p === null ? forbidden('super-admin only') : unauthorized();
  const raw = new URL(req.url).searchParams.get('path') || FS_DEFAULT_PATH;
  const dir = safePath(raw);
  if (!dir) return badRequest('invalid path');
  try {
    const st = await fsp.stat(dir);
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

  const r = await executeFsOp(d, safePath);
  if (r.error) return badRequest(r.error);

  await audit(p, req, { action: `fs.${d.action}`, resourceType: 'filesystem', meta: { path: d.path, to: d.to } });
  return jsonOk({ ok: true });
}
