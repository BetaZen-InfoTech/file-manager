import { NextRequest } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import { authenticate } from './auth';
import { dbConnect } from './db';
import { Vendor } from '@/models/Vendor';

// Where the file manager opens by default (configurable). Full filesystem is
// browsable above/below it — this is just the landing directory. Defaults to the
// per-vendor root so the admin lands on the vendor folders.
export const FS_DEFAULT_PATH = process.env.FS_DEFAULT_PATH || '/var/www/vendors';
// Optional jail. Default '/' = full server access (super-admin only). Set
// FS_ROOT=/var/www to confine the file manager to a subtree.
export const FS_ROOT = process.env.FS_ROOT || '/';

export interface FsEntry {
  name: string;
  type: 'dir' | 'file' | 'symlink' | 'other';
  size: number;
  mode: string; // e.g. -rw-r--r--
  modeOctal: string; // e.g. 644
  mtime: string;
  isHidden: boolean;
  symlinkTarget?: string;
}

/** Only platform super_admins may use the server file manager. */
export async function requireFsAdmin(req: NextRequest) {
  const p = await authenticate(req);
  if (!p) return null;
  if (p.role !== 'super_admin') return null;
  return p;
}

/** Normalize + jail. Rejects null bytes and escapes outside FS_ROOT. */
export function safePath(input: string): string | null {
  if (!input || input.includes('\0')) return null;
  const resolved = path.resolve(input.startsWith('/') ? input : `/${input}`);
  const root = path.resolve(FS_ROOT);
  if (root !== '/' && resolved !== root && !resolved.startsWith(root + path.sep)) return null;
  return resolved;
}

function modeToString(mode: number, type: FsEntry['type']): string {
  const t = type === 'dir' ? 'd' : type === 'symlink' ? 'l' : '-';
  const rwx = (m: number) => `${m & 4 ? 'r' : '-'}${m & 2 ? 'w' : '-'}${m & 1 ? 'x' : '-'}`;
  return t + rwx((mode >> 6) & 7) + rwx((mode >> 3) & 7) + rwx(mode & 7);
}

export async function listDir(dir: string): Promise<{ path: string; entries: FsEntry[] }> {
  const names = await fs.readdir(dir);
  const entries: FsEntry[] = [];
  for (const name of names) {
    const full = path.join(dir, name);
    try {
      const st = await fs.lstat(full);
      let type: FsEntry['type'] = 'other';
      let symlinkTarget: string | undefined;
      if (st.isSymbolicLink()) {
        type = 'symlink';
        symlinkTarget = await fs.readlink(full).catch(() => '');
      } else if (st.isDirectory()) type = 'dir';
      else if (st.isFile()) type = 'file';
      const octal = (st.mode & 0o777).toString(8).padStart(3, '0');
      entries.push({
        name,
        type,
        size: st.size,
        mode: modeToString(st.mode & 0o777, type),
        modeOctal: octal,
        mtime: st.mtime.toISOString(),
        isHidden: name.startsWith('.'),
        symlinkTarget
      });
    } catch {
      /* unreadable entry — skip */
    }
  }
  entries.sort((a, b) => {
    if (a.type === 'dir' && b.type !== 'dir') return -1;
    if (a.type !== 'dir' && b.type === 'dir') return 1;
    return a.name.localeCompare(b.name);
  });
  return { path: dir, entries };
}

export async function statEntry(p: string): Promise<FsEntry> {
  const st = await fs.lstat(p);
  const type: FsEntry['type'] = st.isDirectory() ? 'dir' : st.isSymbolicLink() ? 'symlink' : st.isFile() ? 'file' : 'other';
  return {
    name: path.basename(p),
    type,
    size: st.size,
    mode: modeToString(st.mode & 0o777, type),
    modeOctal: (st.mode & 0o777).toString(8).padStart(3, '0'),
    mtime: st.mtime.toISOString(),
    isHidden: path.basename(p).startsWith('.')
  };
}

export async function readTextFile(p: string, maxBytes = 2 * 1024 * 1024): Promise<string> {
  const st = await fs.stat(p);
  if (st.size > maxBytes) throw new Error('file too large to edit inline');
  return fs.readFile(p, 'utf8');
}

export async function writeTextFile(p: string, content: string): Promise<void> {
  await fs.writeFile(p, content, 'utf8');
}

export async function makeDir(p: string): Promise<void> {
  await fs.mkdir(p, { recursive: false });
}

export async function createEmptyFile(p: string): Promise<void> {
  const fh = await fs.open(p, 'wx');
  await fh.close();
}

export async function renamePath(from: string, to: string): Promise<void> {
  await fs.rename(from, to);
}

export async function removePath(p: string): Promise<void> {
  await fs.rm(p, { recursive: true, force: false });
}

export async function chmodPath(p: string, octal: string): Promise<void> {
  const mode = parseInt(octal, 8);
  if (Number.isNaN(mode)) throw new Error('invalid mode');
  await fs.chmod(p, mode);
}

export async function copyPath(from: string, to: string): Promise<void> {
  await fs.cp(from, to, { recursive: true, force: false, errorOnExist: true });
}

// ---- per-vendor jail -------------------------------------------------------
// Each vendor gets a private home directory. The vendor file manager is
// confined to it — they can't reach the parent, the server root, or another
// vendor's files.
export const FS_VENDOR_ROOT = process.env.FS_VENDOR_ROOT || '/var/www/vendors';

/**
 * The on-disk folder name for a vendor: its `username` when set (new vendors),
 * else the Mongo id (legacy vendors created before usernames existed). Keeping
 * the id fallback means existing vendors' files stay exactly where they are.
 */
export function vendorFolderKey(v: { username?: string | null; _id: unknown }): string {
  return (v.username && String(v.username)) || String(v._id);
}

/** Resolve (and create) a vendor's private home directory from its folder key. */
export async function vendorHome(folderKey: string): Promise<string> {
  const home = path.join(path.resolve(FS_VENDOR_ROOT), String(folderKey));
  await fs.mkdir(home, { recursive: true });
  return home;
}

/** Recursively total the real disk bytes + file count under a directory. */
export async function dirSizeBytes(dir: string): Promise<{ bytes: number; files: number }> {
  let bytes = 0;
  let files = 0;
  async function walk(d: string): Promise<void> {
    let entries: import('fs').Dirent[];
    try {
      entries = await fs.readdir(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) {
        await walk(full);
      } else if (e.isFile()) {
        try {
          const st = await fs.stat(full);
          bytes += st.size;
          files += 1;
        } catch {
          /* unreadable — skip */
        }
      }
    }
  }
  await walk(dir);
  return { bytes, files };
}

/** Disk usage of a vendor's private file-manager folder (NOT billed/quota). */
export async function vendorDiskUsage(folderKey: string): Promise<{ bytes: number; files: number }> {
  const home = path.join(path.resolve(FS_VENDOR_ROOT), String(folderKey));
  return dirSizeBytes(home);
}

/** Resolve a vendor-relative path inside the jail. Returns null on escape. */
export function resolveInJail(home: string, rel: string): string | null {
  if (rel == null || rel.includes('\0')) return null;
  const r = rel.startsWith('/') ? rel : `/${rel}`;
  const abs = path.resolve(home, '.' + r);
  if (abs !== home && !abs.startsWith(home + path.sep)) return null;
  return abs;
}

/** Map an absolute path inside the jail back to the vendor-facing path. */
export function toRel(home: string, abs: string): string {
  if (abs === home) return '/';
  return '/' + path.relative(home, abs).split(path.sep).join('/');
}

/** Parent path, clamped so a vendor can never step above their home ('/'). */
export function jailParent(home: string, abs: string): string {
  if (abs === home) return '/';
  return toRel(home, path.dirname(abs));
}

/**
 * Gate the vendor file manager. Requires an authenticated principal bound to a
 * vendor that isn't suspended, and returns the vendor's jailed home directory.
 * `error` is set when the caller should respond unauthorized/forbidden.
 */
export async function requireVendorFs(
  req: NextRequest
): Promise<{ p: NonNullable<Awaited<ReturnType<typeof authenticate>>>; home: string } | { error: 'unauthorized' | 'forbidden' }> {
  const p = await authenticate(req);
  if (!p) return { error: 'unauthorized' };
  if (!p.vendorId || p.vendorStatus === 'suspended') return { error: 'forbidden' };
  await dbConnect();
  const vendor = await Vendor.findById(p.vendorId).lean();
  // Folder is keyed by username (new vendors) and falls back to the id (legacy).
  const home = await vendorHome(vendorFolderKey({ username: vendor?.username, _id: p.vendorId }));
  return { p, home };
}
