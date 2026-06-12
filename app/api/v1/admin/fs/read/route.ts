import { NextRequest } from 'next/server';
import { badRequest, forbidden, jsonOk, unauthorized } from '@/lib/http';
import { requireFsAdmin, safePath, readTextFile } from '@/lib/server-fs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const p = await requireFsAdmin(req);
  if (!p) return p === null ? forbidden('super-admin only') : unauthorized();
  const target = safePath(new URL(req.url).searchParams.get('path') || '');
  if (!target) return badRequest('invalid path');
  try {
    const content = await readTextFile(target);
    return jsonOk({ content });
  } catch (e: any) {
    return badRequest(e?.message || 'cannot read file');
  }
}
