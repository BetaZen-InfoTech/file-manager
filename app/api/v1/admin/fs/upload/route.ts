import { NextRequest } from 'next/server';
import fsp from 'fs/promises';
import path from 'path';
import { badRequest, forbidden, jsonOk, unauthorized } from '@/lib/http';
import { audit } from '@/lib/audit';
import { requireFsAdmin, safePath } from '@/lib/server-fs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// POST multipart: field "dir" = target directory, "file" = the upload.
export async function POST(req: NextRequest) {
  const p = await requireFsAdmin(req);
  if (!p) return p === null ? forbidden('super-admin only') : unauthorized();

  const ct = req.headers.get('content-type') || '';
  if (!ct.toLowerCase().startsWith('multipart/form-data')) return badRequest('multipart/form-data required');
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return badRequest('invalid multipart body');
  }
  const dirRaw = String(form.get('dir') || '');
  const dir = safePath(dirRaw);
  if (!dir) return badRequest('invalid dir');
  const file = form.get('file');
  if (!(file instanceof Blob)) return badRequest('file required');

  const name = ((file as any).name || 'upload').replace(/[/\\]/g, '_');
  const dest = safePath(path.join(dir, name));
  if (!dest) return badRequest('invalid destination');

  const buf = Buffer.from(await file.arrayBuffer());
  await fsp.writeFile(dest, buf);

  await audit(p, req, { action: 'fs.upload', resourceType: 'filesystem', meta: { path: dest } });
  return jsonOk({ ok: true, path: dest });
}
