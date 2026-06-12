import fsp from 'fs/promises';
import { createReadStream, createWriteStream } from 'fs';
import path from 'path';
import archiver from 'archiver';
import unzipper from 'unzipper';
import {
  makeDir,
  createEmptyFile,
  writeTextFile,
  chmodPath,
  removePath,
  renamePath,
  copyPath
} from './server-fs';

type Resolve = (p: string) => string | null;

export interface FsOp {
  action: string;
  path: string;
  to?: string;
  content?: string;
  mode?: string;
  paths?: string[];
  name?: string;
}

/**
 * Execute a filesystem mutation. `resolve` maps an input path to a safe
 * absolute path (or null) — admin uses safePath (full FS / FS_ROOT jail),
 * vendor uses resolveInJail (per-vendor home). All path inputs go through it,
 * so a vendor op can never escape its jail.
 */
export async function executeFsOp(d: FsOp, resolve: Resolve): Promise<{ ok?: true; error?: string }> {
  const target = resolve(d.path);
  if (!target) return { error: 'invalid path' };
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
        if (!d.mode) return { error: 'mode required' };
        await chmodPath(target, d.mode);
        break;
      case 'delete':
        await removePath(target);
        break;
      case 'rename': {
        const to = resolve(d.to || '');
        if (!to) return { error: 'invalid destination' };
        await renamePath(target, to);
        break;
      }
      case 'copy': {
        const to = resolve(d.to || '');
        if (!to) return { error: 'invalid destination' };
        await copyPath(target, to);
        break;
      }
      case 'zip': {
        const destInput = d.to || path.join(path.dirname(d.path), `${d.name || 'archive'}.zip`);
        const dest = resolve(destInput);
        if (!dest) return { error: 'invalid destination' };
        const items = (d.paths && d.paths.length ? d.paths : [d.path]).map(resolve).filter(Boolean) as string[];
        if (!items.length) return { error: 'nothing to zip' };
        await new Promise<void>((resolve2, reject) => {
          const output = createWriteStream(dest);
          const archive = archiver('zip', { zlib: { level: 6 } });
          // Both ends must reject — pipe() does NOT forward dest errors to the
          // source, so without output.on('error') a dest write failure (EACCES/
          // ENOSPC/EISDIR) would hang the Promise forever and crash on the
          // unhandled 'error' event.
          output.on('error', reject);
          output.on('close', () => resolve2());
          archive.on('error', reject);
          archive.pipe(output);
          Promise.all(
            items.map(async (it) => {
              const st = await fsp.lstat(it).catch(() => null);
              if (st?.isDirectory()) archive.directory(it, path.basename(it));
              else if (st?.isFile()) archive.file(it, { name: path.basename(it) });
            })
          )
            .then(() => archive.finalize())
            .catch(reject);
        });
        break;
      }
      case 'extract': {
        const dest = resolve(d.to || path.dirname(d.path));
        if (!dest) return { error: 'invalid destination' };
        await new Promise<void>((resolve2, reject) => {
          createReadStream(target)
            .pipe(unzipper.Extract({ path: dest }))
            .on('close', () => resolve2())
            .on('error', reject);
        });
        break;
      }
      default:
        return { error: 'unknown action' };
    }
  } catch (e: any) {
    return { error: e?.message || 'operation failed' };
  }
  return { ok: true };
}
