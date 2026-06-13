import fsp from 'fs/promises';
import { createWriteStream } from 'fs';
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
import { moveToTrash, restoreFromTrash, purgeTrashItem, emptyTrash } from './fs-trash';

type Resolve = (p: string) => string | null;

export interface FsOp {
  action: string;
  path?: string;
  to?: string;
  content?: string;
  mode?: string;
  paths?: string[];
  name?: string;
  id?: string;
}

// Path-based actions that must NEVER target the resolver's root (FS root for
// admin, the vendor's home for vendors) — otherwise a defaulted/empty path could
// wipe or archive the whole tree.
const ROOT_PROTECTED = new Set([
  'delete',
  'trash',
  'rename',
  'copy',
  'chmod',
  'hide',
  'unhide',
  'write',
  'newfile',
  'mkdir',
  'zip',
  'extract'
]);
const MAX_EXTRACT_BYTES = 2 * 1024 * 1024 * 1024; // 2 GB uncompressed (zip-bomb guard)

export interface FsOpOptions {
  /** Where deleted items go for the recoverable trash (null = trash disabled). */
  trashRoot?: string | null;
}

const posixDir = (p: string) => {
  const s = p.replace(/\\/g, '/').replace(/\/+$/, '');
  const i = s.lastIndexOf('/');
  return i <= 0 ? '/' : s.slice(0, i);
};
const posixBase = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '').split('/').pop() || p;

/**
 * Execute a filesystem mutation. `resolve` maps an input path to a safe
 * absolute path (or null) — admin uses safePath (full FS / FS_ROOT jail),
 * vendor uses resolveInJail (per-vendor home). All path inputs go through it,
 * so a vendor op can never escape its jail.
 */
export async function executeFsOp(
  d: FsOp,
  resolve: Resolve,
  opts: FsOpOptions = {}
): Promise<{ ok?: true; error?: string }> {
  // Trash management actions key off an id (a stored trash filename) rather than
  // a real path, so they're handled before the path is resolved.
  try {
    if (d.action === 'restore') {
      if (!opts.trashRoot) return { error: 'trash not available here' };
      return await restoreFromTrash(d.id || '', opts.trashRoot, resolve);
    }
    if (d.action === 'trash-purge') {
      if (!opts.trashRoot) return { error: 'trash not available here' };
      return await purgeTrashItem(d.id || '', opts.trashRoot);
    }
    if (d.action === 'trash-empty') {
      if (!opts.trashRoot) return { error: 'trash not available here' };
      await emptyTrash(opts.trashRoot);
      return { ok: true };
    }
  } catch (e: any) {
    return { error: e?.message || 'operation failed' };
  }

  const inputPath = d.path || '';
  const target = resolve(inputPath);
  if (!target) return { error: 'invalid path' };
  // Refuse to let any destructive/path action operate on the resolver's own root
  // (FS root for admin, the vendor home) — defends against a defaulted/empty or
  // explicit '/' path. resolve('/') yields that root for both resolvers.
  const rootAbs = resolve('/');
  if (rootAbs && target === rootAbs && ROOT_PROTECTED.has(d.action)) {
    return { error: 'cannot operate on the root directory' };
  }
  try {
    switch (d.action) {
      case 'trash': {
        if (!opts.trashRoot) return { error: 'trash not available here' };
        const root = opts.trashRoot;
        // Never trash the trash itself, anything inside it, OR a folder that
        // CONTAINS it (which would move the trash into its own subtree).
        if (
          target === root ||
          target.startsWith(root + '/') ||
          target.startsWith(root + '\\') ||
          root.startsWith(target + '/') ||
          root.startsWith(target + '\\')
        ) {
          return { error: 'cannot trash the trash folder' };
        }
        await moveToTrash(target, inputPath, root);
        break;
      }
      case 'hide':
      case 'unhide': {
        const base = posixBase(inputPath);
        const dir = posixDir(inputPath);
        const newBase =
          d.action === 'hide'
            ? base.startsWith('.')
              ? base
              : `.${base}`
            : base.replace(/^\.+/, '');
        if (!newBase) return { error: 'invalid name' };
        if (newBase === base) break; // already in the requested state
        const toInput = dir === '/' ? `/${newBase}` : `${dir}/${newBase}`;
        const to = resolve(toInput);
        if (!to) return { error: 'invalid destination' };
        // Auto-derived destination — don't silently clobber an existing entry.
        const clash = await fsp.lstat(to).catch(() => null);
        if (clash) return { error: `a file named "${newBase}" already exists` };
        await renamePath(target, to);
        break;
      }
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
        const baseDir = posixDir(inputPath);
        const destInput = d.to || (baseDir === '/' ? `/${d.name || 'archive'}.zip` : `${baseDir}/${d.name || 'archive'}.zip`);
        const dest = resolve(destInput);
        if (!dest) return { error: 'invalid destination' };
        const items = (d.paths && d.paths.length ? d.paths : [inputPath]).map(resolve).filter(Boolean) as string[];
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
        // Validate EVERY entry through the same resolver + a strict boundary
        // check rather than trusting unzipper's prefix guard (which a sibling
        // name like "<jail>-evil" can bypass — a jail escape / zip-slip).
        const toInput = d.to || posixDir(inputPath);
        const dest = resolve(toInput);
        if (!dest) return { error: 'invalid destination' };
        const directory = await unzipper.Open.file(target);
        let totalBytes = 0;
        for (const entry of directory.files) {
          if (entry.type !== 'File') continue;
          const rawPath = String(entry.path || '');
          if (!rawPath || rawPath.includes('\0') || rawPath.split(/[\\/]/).includes('..')) continue;
          totalBytes += entry.uncompressedSize || 0;
          if (totalBytes > MAX_EXTRACT_BYTES) return { error: 'archive too large to extract' };
          const entryInput = toInput === '/' ? `/${rawPath}` : `${toInput}/${rawPath}`;
          const abs = resolve(entryInput);
          // Must resolve AND stay strictly inside the chosen destination.
          if (!abs || (abs !== dest && !abs.startsWith(dest + path.sep))) continue;
          await fsp.mkdir(path.dirname(abs), { recursive: true });
          await new Promise<void>((res, rej) => {
            entry
              .stream()
              .pipe(createWriteStream(abs))
              .on('finish', () => res())
              .on('error', rej);
          });
        }
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
