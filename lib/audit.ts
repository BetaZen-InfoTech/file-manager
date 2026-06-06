import { NextRequest } from 'next/server';
import { dbConnect } from './db';
import { AuditLog } from '@/models/AuditLog';
import type { Principal } from './rbac';

export interface AuditInput {
  action: string;
  resourceType?: string;
  resourceId?: string;
  meta?: Record<string, unknown>;
  vendorId?: string | null;
}

export async function audit(
  principal: Principal | null,
  req: NextRequest | null,
  input: AuditInput
): Promise<void> {
  try {
    await dbConnect();
    const ip =
      req?.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
      req?.headers.get('x-real-ip') ||
      null;
    const userAgent = req?.headers.get('user-agent') || null;
    await AuditLog.create({
      vendorId: input.vendorId ?? principal?.vendorId ?? null,
      actorId: principal?.userId || principal?.apiKeyId || null,
      actorType: principal?.kind === 'apikey' ? 'apikey' : principal?.kind === 'session' ? 'user' : 'system',
      actorEmail: principal?.email || null,
      action: input.action,
      resourceType: input.resourceType || null,
      resourceId: input.resourceId || null,
      ip,
      userAgent,
      meta: input.meta || {}
    });
  } catch (err) {
    console.error('audit log failed', err);
  }
}
