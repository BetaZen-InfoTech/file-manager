import { NextRequest } from 'next/server';
import { exec } from 'child_process';
import { verifyGithubSignature } from '@/lib/github-signature';
import { env } from '@/lib/env';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const raw = await req.text();
  const sig = req.headers.get('x-hub-signature-256') || '';
  if (!env.GITHUB_WEBHOOK_SECRET) {
    return new Response('webhook not configured', { status: 503 });
  }
  if (!verifyGithubSignature(env.GITHUB_WEBHOOK_SECRET, raw, sig)) {
    return new Response('invalid signature', { status: 401 });
  }
  let body: { ref?: string; repository?: { full_name?: string } };
  try {
    body = JSON.parse(raw);
  } catch {
    return new Response('invalid payload', { status: 400 });
  }
  if (body.ref !== `refs/heads/${env.DEPLOY_BRANCH}`) {
    return new Response('ignored branch', { status: 200 });
  }
  exec(`${env.DEPLOY_SCRIPT} >> /var/log/deploy.log 2>&1 &`);
  return new Response('deploy started', { status: 202 });
}
