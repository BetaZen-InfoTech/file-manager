import { NextRequest } from 'next/server';
import { forbidden, jsonOk, unauthorized } from '@/lib/http';
import { verifyTransferToken } from '@/lib/transfer-token';
import { readAllowlistedEnv, ENV_ALLOWLIST } from '@/lib/env-transfer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// SOURCE: return ONLY a curated allowlist of portable app settings from this
// server's .env (upload/rate limits + mail). Secrets, DB URI, storage config,
// domain, ports, and deploy/cron secrets are NEVER returned. Requires an
// instance-scoped transfer token (same trust level as the full export).
export async function GET(req: NextRequest) {
  const tok = await verifyTransferToken(req);
  if (!tok) return unauthorized('invalid transfer token');
  if (tok.kind !== 'instance') return forbidden('env transfer requires an instance-scoped token');
  return jsonOk({ env: readAllowlistedEnv(), allowlist: ENV_ALLOWLIST });
}
