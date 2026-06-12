import { NextResponse } from 'next/server';
import { env } from '@/lib/env';
import { openApiSpec } from '@/lib/api-catalog';

export const runtime = 'nodejs';

// Generated from the single source-of-truth API catalog so the OpenAPI doc, the
// docs page, and the Postman collection never drift apart.
export async function GET() {
  const spec = openApiSpec(env.APP_URL, env.SESSION_COOKIE_NAME);
  return NextResponse.json(spec, {
    headers: {
      'cache-control': 'public, max-age=300',
      'content-type': 'application/json'
    }
  });
}
