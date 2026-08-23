import { NextRequest } from 'next/server';
import fsp from 'fs/promises';
import path from 'path';
import { badRequest, forbidden, jsonOk, unauthorized, internalError } from '@/lib/http';
import { audit } from '@/lib/audit';
import { requireVendorFs, resolveInJail, toRel } from '@/lib/server-fs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// POST multipart: field "dir" = target directory (vendor-relative), "file" = upload.
export async function POST(req: NextRequest) {
  const g = await requireVendorFs(req);
  if ('error' in g) return g.error === 'forbidden' ? forbidden('vendor account required') : unauthorized();
  const { p, home } = g;

  const ct = req.headers.get('content-type') || '';
  if (!ct.toLowerCase().startsWith('multipart/form-data')) return badRequest('multipart/form-data required');
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return badRequest('invalid multipart body');
  }
  const file = form.get('file');
  if (!(file instanceof Blob)) return badRequest('file required');

  // Prefer an explicit destination "path" (vendor-relative, may include subdirs —
  // used for whole-folder drag-and-drop uploads). Fall back to "dir" + filename.
  const relPath = form.get('path');
  let dest: string | null;
  if (typeof relPath === 'string' && relPath.trim()) {
    dest = resolveInJail(home, relPath);
  } else {
    const dir = resolveInJail(home, String(form.get('dir') || '/'));
    if (!dir) return badRequest('invalid dir');
    const name = ((file as any).name || 'upload').replace(/[/\\]/g, '_');
    dest = resolveInJail(home, toRel(home, path.join(dir, name)));
  }
  if (!dest) return badRequest('invalid destination');
  if (dest === home) return badRequest('invalid destination'); // never write over the jail root

  try {
    const buf = Buffer.from(await file.arrayBuffer());
    const st = await fsp.stat(dest).catch(() => null);
    if (st && st.isDirectory()) return badRequest('a folder with that name already exists');
    await fsp.mkdir(path.dirname(dest), { recursive: true }); // create parent dirs for nested uploads
    await fsp.writeFile(dest, buf);
  } catch (err) {
    // EISDIR / ENOTDIR / ENOSPC / EACCES etc. must not escape the handler as an
    // empty-body 500 — return a JSON error the client can render.
    console.error('fs.upload failed', err);
    return internalError('could not save the file');
  }

  await audit(p, req, { action: 'fs.upload', resourceType: 'vendor_filesystem', meta: { path: toRel(home, dest) } });
  return jsonOk({ ok: true, path: toRel(home, dest) });
}
