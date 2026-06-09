import { NextRequest } from 'next/server';
import { authenticate } from '@/lib/auth';
import { can } from '@/lib/rbac';
import { badRequest, forbidden, jsonOk, safeParseJson, unauthorized } from '@/lib/http';
import { serverActionSchema } from '@/lib/validation';
import { audit } from '@/lib/audit';
import { getSeo, setSeo } from '@/lib/seo';
import {
  sslStatus,
  issueSsl,
  forceHttps,
  setVhostDomain,
  domainFromUrl
} from '@/lib/server-control';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function currentDomain(req: NextRequest): Promise<string> {
  const q = new URL(req.url).searchParams.get('domain');
  if (q) return q;
  const seo = await getSeo();
  return domainFromUrl(seo.canonicalBaseUrl) || domainFromUrl(process.env.APP_URL) || '';
}

export async function GET(req: NextRequest) {
  const p = await authenticate(req);
  if (!p) return unauthorized();
  if (!can(p, 'admin:vendor:read')) return forbidden();
  const domain = await currentDomain(req);
  const status = await sslStatus(domain);
  return jsonOk(status);
}

export async function POST(req: NextRequest) {
  const p = await authenticate(req);
  if (!p) return unauthorized();
  if (!can(p, 'admin:maintenance:toggle')) return forbidden();

  const body = await safeParseJson(req);
  const parsed = serverActionSchema.safeParse(body);
  if (!parsed.success) return badRequest('Invalid input', { issues: parsed.error.issues });
  const { action, domain, email } = parsed.data;

  let result: { ok: boolean; message: string };

  if (action === 'issue-ssl') {
    if (!email) return badRequest('email is required to issue SSL');
    result = await issueSsl(domain, email);
  } else if (action === 'force-https') {
    result = await forceHttps(domain);
  } else {
    // set-domain: repoint the nginx vhost, then make the panel's canonical URL follow.
    result = await setVhostDomain(domain);
    if (result.ok) await setSeo({ canonicalBaseUrl: `https://${domain}` }, p.userId || null);
  }

  await audit(p, req, {
    action: `server.${action}`,
    resourceType: 'platform_setting',
    meta: { domain, ok: result.ok }
  });

  if (!result.ok) return badRequest(result.message || 'action failed');
  return jsonOk(result);
}
