import { NextResponse } from 'next/server';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { dbConnect } from '@/lib/db';
import { storage } from '@/lib/storage';

export const runtime = 'nodejs';

const STARTED_AT = Date.now();

let cachedSha: string | null = null;
function getGitSha(): string {
  if (cachedSha !== null) return cachedSha;
  try {
    cachedSha = execSync('git rev-parse --short HEAD', {
      stdio: ['ignore', 'pipe', 'ignore']
    })
      .toString()
      .trim();
  } catch {
    cachedSha = 'unknown';
  }
  return cachedSha;
}

let cachedVersion: string | null = null;
function getVersion(): string {
  if (cachedVersion !== null) return cachedVersion;
  try {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8')
    );
    cachedVersion = pkg.version || '0.0.0';
  } catch {
    cachedVersion = '0.0.0';
  }
  return cachedVersion;
}

export async function GET() {
  const checks: Record<string, { ok: boolean; error?: string; latencyMs?: number }> = {};

  const dbStart = Date.now();
  try {
    await dbConnect();
    checks.db = { ok: true, latencyMs: Date.now() - dbStart };
  } catch (err: any) {
    checks.db = { ok: false, error: err?.message, latencyMs: Date.now() - dbStart };
  }

  const stStart = Date.now();
  try {
    await storage.ensureBucket();
    checks.storage = { ok: true, latencyMs: Date.now() - stStart };
  } catch (err: any) {
    checks.storage = { ok: false, error: err?.message, latencyMs: Date.now() - stStart };
  }

  const ok = Object.values(checks).every((c) => c.ok);
  return NextResponse.json(
    {
      ok,
      version: getVersion(),
      gitSha: getGitSha(),
      uptimeSec: Math.floor((Date.now() - STARTED_AT) / 1000),
      checks,
      timestamp: new Date().toISOString()
    },
    { status: ok ? 200 : 503 }
  );
}
