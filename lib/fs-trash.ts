import fsp from 'fs/promises';
import path from 'path';

// A recoverable trash for the file manager. Instead of `rm`, items are MOVED
// into a trash directory; they can be restored to their original location or
// purged permanently. Each trashed item is stored under a short, fixed-width id
// (`<id>` = data, `<id>.meta.json` = metadata) — the original path lives in the
// sidecar, NOT in the filename, so deeply-nested paths never overflow the
// 255-byte filename limit. The remembered originalPath is in the CLIENT's
// coordinate space (jail-relative for vendors, absolute for admin) so restore
// re-resolves it with the same resolver and never leaks a vendor's real home.

const META_SUFFIX = '.meta.json';
const posixBase = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '').split('/').pop() || p;

export interface TrashEntry {
  id: string; // pass this back to restore / purge
  name: string;
  originalPath: string; // client-space path it will be restored to
  deletedAt: string;
  type: 'dir' | 'file';
  size: number;
}

interface TrashMeta {
  originalPath: string;
  name: string;
  type: 'dir' | 'file';
  size: number;
  deletedAt: string;
}

/** Move across filesystems when a plain rename hits EXDEV (different mounts). */
async function moveAcross(from: string, to: string): Promise<void> {
  try {
    await fsp.rename(from, to);
  } catch (e: any) {
    if (e?.code === 'EXDEV') {
      await fsp.cp(from, to, { recursive: true });
      await fsp.rm(from, { recursive: true, force: true });
    } else {
      throw e;
    }
  }
}

/** Trash ids are bare tokens (digits / base36 / hyphen) — reject anything else. */
function dataPath(id: string, trashRoot: string): string | null {
  if (!id || !/^[A-Za-z0-9-]{1,64}$/.test(id)) return null;
  const root = path.resolve(trashRoot);
  const abs = path.resolve(root, id);
  if (abs !== root && !abs.startsWith(root + path.sep)) return null;
  return abs;
}

async function readMeta(trashRoot: string, id: string): Promise<TrashMeta | null> {
  try {
    return JSON.parse(await fsp.readFile(path.join(trashRoot, id + META_SUFFIX), 'utf8')) as TrashMeta;
  } catch {
    return null;
  }
}

/**
 * Move `abs` (resolved on disk) into the trash, remembering `inputPath`
 * (client-space) so it can be restored later.
 */
export async function moveToTrash(abs: string, inputPath: string, trashRoot: string): Promise<TrashEntry> {
  const st = await fsp.lstat(abs);
  await fsp.mkdir(trashRoot, { recursive: true });
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const meta: TrashMeta = {
    originalPath: inputPath,
    name: posixBase(inputPath),
    type: st.isDirectory() ? 'dir' : 'file',
    size: st.isDirectory() ? 0 : st.size,
    deletedAt: new Date(Date.now()).toISOString()
  };
  await moveAcross(abs, path.join(trashRoot, id));
  await fsp.writeFile(path.join(trashRoot, id + META_SUFFIX), JSON.stringify(meta), 'utf8');
  return { id, ...meta };
}

/** List trashed items, newest first. Silently ignores unparseable/orphan entries. */
export async function listTrash(trashRoot: string): Promise<TrashEntry[]> {
  let names: string[];
  try {
    names = await fsp.readdir(trashRoot);
  } catch {
    return [];
  }
  const out: TrashEntry[] = [];
  for (const n of names) {
    if (!n.endsWith(META_SUFFIX)) continue;
    const id = n.slice(0, -META_SUFFIX.length);
    const dp = dataPath(id, trashRoot);
    if (!dp) continue;
    const exists = await fsp
      .lstat(dp)
      .then(() => true)
      .catch(() => false);
    if (!exists) continue;
    const meta = await readMeta(trashRoot, id);
    if (!meta) continue;
    out.push({
      id,
      name: meta.name || posixBase(meta.originalPath),
      originalPath: meta.originalPath,
      deletedAt: meta.deletedAt,
      type: meta.type,
      size: meta.size
    });
  }
  out.sort((a, b) => (b.deletedAt || '').localeCompare(a.deletedAt || ''));
  return out;
}

/**
 * Restore a trashed item to its original location, picking a non-colliding name
 * (loops until free — never overwrites). `resolve` maps the remembered
 * client-space path back to a safe absolute path, so a vendor can only restore
 * into its own jail.
 */
export async function restoreFromTrash(
  id: string,
  trashRoot: string,
  resolve: (p: string) => string | null
): Promise<{ ok?: true; error?: string; restoredTo?: string }> {
  const dp = dataPath(id, trashRoot);
  if (!dp) return { error: 'invalid trash id' };
  const meta = await readMeta(trashRoot, id);
  if (!meta) return { error: 'trash item not found' };
  const onDisk = await fsp
    .lstat(dp)
    .then(() => true)
    .catch(() => false);
  if (!onDisk) return { error: 'trash item not found' };

  let dest = resolve(meta.originalPath);
  if (!dest) return { error: 'cannot restore outside the allowed area' };
  const exists = (p: string) =>
    fsp
      .stat(p)
      .then(() => true)
      .catch(() => false);
  if (await exists(dest)) {
    const ext = path.extname(dest);
    const stem = dest.slice(0, dest.length - ext.length);
    let candidate = `${stem} (restored)${ext}`;
    let n = 1;
    while (await exists(candidate)) candidate = `${stem} (restored ${n++})${ext}`;
    dest = candidate;
  }
  await fsp.mkdir(path.dirname(dest), { recursive: true });
  await moveAcross(dp, dest);
  await fsp.rm(path.join(trashRoot, id + META_SUFFIX), { force: true });
  return { ok: true, restoredTo: dest };
}

/** Permanently delete one trashed item (data + sidecar). */
export async function purgeTrashItem(id: string, trashRoot: string): Promise<{ ok?: true; error?: string }> {
  const dp = dataPath(id, trashRoot);
  if (!dp) return { error: 'invalid trash id' };
  await fsp.rm(dp, { recursive: true, force: true });
  await fsp.rm(path.join(trashRoot, id + META_SUFFIX), { force: true });
  return { ok: true };
}

/** Permanently delete everything in the trash. */
export async function emptyTrash(trashRoot: string): Promise<void> {
  let names: string[];
  try {
    names = await fsp.readdir(trashRoot);
  } catch {
    return;
  }
  await Promise.all(names.map((n) => fsp.rm(path.join(trashRoot, n), { recursive: true, force: true })));
}
