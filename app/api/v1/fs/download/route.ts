import { NextRequest } from 'next/server';
import { createReadStream } from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import { Readable } from 'stream';
import { badRequest, forbidden, unauthorized } from '@/lib/http';
import { requireVendorFs, resolveInJail } from '@/lib/server-fs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const g = await requireVendorFs(req);
  if ('error' in g) return g.error === 'forbidden' ? forbidden('vendor account required') : unauthorized();
  const target = resolveInJail(g.home, new URL(req.url).searchParams.get('path') || '');
  if (!target) return badRequest('invalid path');
  try {
    const st = await fsp.stat(target);
    if (!st.isFile()) return badRequest('not a file');
    const node = createReadStream(target);
    req.signal.addEventListener('abort', () => node.destroy());
    const web = Readable.toWeb(node) as ReadableStream<Uint8Array>;
    return new Response(web, {
      headers: {
        'content-type': 'application/octet-stream',
        'content-length': String(st.size),
        'content-disposition': `attachment; filename="${encodeURIComponent(path.basename(target))}"`,
        'cache-control': 'no-store'
      }
    });
  } catch (e: any) {
    return badRequest(e?.message || 'cannot download');
  }
}
