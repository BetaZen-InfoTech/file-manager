import { NextRequest } from 'next/server';
import fsp from 'fs/promises';
import { createReadStream, createWriteStream } from 'fs';
import path from 'path';
import archiver from 'archiver';
import unzipper from 'unzipper';
import { badRequest, forbidden, jsonOk, safeParseJson, unauthorized } from '@/lib/http';
import { fsOpSchema } from '@/lib/validation';
import { audit } from '@/lib/audit';
import {
  requireFsAdmin,
  safePath,
  listDir,
  FS_DEFAULT_PATH,
  makeDir,
  createEmptyFile,
  renamePath,
  removePath,
  chmodPath,
  copyPath,
  writeTextFile
} from '@/lib/server-fs';

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

// POST { action, ... } → mutating operations.
export async function POST(req: NextRequest) {
  const p = await requireFsAdmin(req);
  if (!p) return p === null ? forbidden('super-admin only') : unauthorized();

  const body = await safeParseJson(req);
  const parsed = fsOpSchema.safeParse(body);
  if (!parsed.success) return badRequest('Invalid input', { issues: parsed.error.issues });
  const d = parsed.data;
  const target = safePath(d.path);
  if (!target) return badRequest('invalid path');

  try {
    switch (d.action) {
      case 'mkdir':
        await makeDir(target);
        break;
      case 'newfile':
        await createEmptyFile(target);
        break;
      case 'write':
        await writeTextFile(target, d.content || '');
        break;
      case 'chmod':
        if (!d.mode) return badRequest('mode required');
        await chmodPath(target, d.mode);
        break;
      case 'delete':
        await removePath(target);
        break;
      case 'rename': {
        const to = safePath(d.to || '');
        if (!to) return badRequest('invalid destination');
        await renamePath(target, to);
        break;
      }
      case 'copy': {
        const to = safePath(d.to || '');
        if (!to) return badRequest('invalid destination');
        await copyPath(target, to);
        break;
      }
      case 'zip': {
        const dest = safePath(d.to || path.join(path.dirname(target), `${d.name || 'archive'}.zip`));
        if (!dest) return badRequest('invalid destination');
        const items = (d.paths && d.paths.length ? d.paths : [d.path]).map((x) => safePath(x)).filter(Boolean) as string[];
        await new Promise<void>((resolve, reject) => {
          const output = createWriteStream(dest);
          const archive = archiver('zip', { zlib: { level: 6 } });
          output.on('close', () => resolve());
          archive.on('error', reject);
          archive.pipe(output);
          for (const it of items) {
            archive.file(it, { name: path.basename(it) }); // dirs handled below
          }
          // append directories
          Promise.all(
            items.map(async (it) => {
              const st = await fsp.lstat(it).catch(() => null);
              if (st?.isDirectory()) archive.directory(it, path.basename(it));
            })
          ).then(() => archive.finalize());
        });
        break;
      }
      case 'extract': {
        const dest = safePath(d.to || path.dirname(target));
        if (!dest) return badRequest('invalid destination');
        await new Promise<void>((resolve, reject) => {
          createReadStream(target)
            .pipe(unzipper.Extract({ path: dest }))
            .on('close', () => resolve())
            .on('error', reject);
        });
        break;
      }
      default:
        return badRequest('unknown action');
    }
  } catch (e: any) {
    return badRequest(e?.message || 'operation failed');
  }

  await audit(p, req, { action: `fs.${d.action}`, resourceType: 'filesystem', meta: { path: d.path, to: d.to } });
  return jsonOk({ ok: true });
}
