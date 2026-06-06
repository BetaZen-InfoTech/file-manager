import { NextRequest } from 'next/server';
import { cookies } from 'next/headers';
import { env } from '@/lib/env';
import { jsonOk } from '@/lib/http';
import { audit } from '@/lib/audit';
import { authenticate } from '@/lib/auth';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const principal = await authenticate(req);
  cookies().delete(env.SESSION_COOKIE_NAME);
  if (principal) await audit(principal, req, { action: 'auth.logout' });
  return jsonOk({ ok: true });
}
