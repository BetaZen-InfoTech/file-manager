import { NextRequest } from 'next/server';
import { dbConnect } from './db';
import { AuditLog } from '@/models/AuditLog';
import { getRequestMeta, lookupGeo } from './request-meta';
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
    const m = req ? getRequestMeta(req) : null;
    const doc = await AuditLog.create({
      vendorId: input.vendorId ?? principal?.vendorId ?? null,
      actorId: principal?.userId || principal?.apiKeyId || null,
      actorType: principal?.kind === 'apikey' ? 'apikey' : principal?.kind === 'session' ? 'user' : 'system',
      actorEmail: principal?.email || null,
      action: input.action,
      resourceType: input.resourceType || null,
      resourceId: input.resourceId || null,
      ip: m?.ip || null,
      ipChain: m?.ipChain || null,
      method: m?.method || null,
      url: m?.url || null,
      host: m?.host || null,
      referer: m?.referer || null,
      country: m?.country || null,
      city: m?.city || null,
      region: m?.region || null,
      userAgent: m?.userAgent || null,
      // Stamp the acting admin onto every action taken while impersonating, so
      // a vendor-user audit trail stays attributable to the real operator.
      meta: principal?.impersonatorId
        ? { ...(input.meta || {}), impersonatorId: principal.impersonatorId }
        : input.meta || {}
    });

    // Enrich with geolocation in the background (never block the request). Only
    // runs for a public IP with no CDN geo header already present.
    if (m?.ip && !m.country) {
      lookupGeo(m.ip)
        .then((geo) => {
          if (geo && (geo.country || geo.city)) {
            return AuditLog.updateOne(
              { _id: doc._id },
              { $set: { country: geo.country, city: geo.city, region: geo.region } }
            );
          }
        })
        .catch(() => {});
    }
  } catch (err) {
    console.error('audit log failed', err);
  }
}
