import { NextRequest } from 'next/server';
import mongoose from 'mongoose';
import { dbConnect } from '@/lib/db';
import { authenticate } from '@/lib/auth';
import { can } from '@/lib/rbac';
import { forbidden, unauthorized, suspended, jsonOk } from '@/lib/http';
import { AuditLog } from '@/models/AuditLog';
import { subscribe, canSeeEvent, sseFrame, type DomainEvent } from '@/lib/events';
import type { Principal } from '@/lib/rbac';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Long-lived stream. If the platform caps this, the SSE client auto-reconnects
// and resumes from Last-Event-ID, so a periodic re-connect is harmless.
export const maxDuration = 3600;

const isObjId = (s: string) => /^[a-f0-9]{24}$/i.test(s);

function docToEvent(d: any): DomainEvent {
  return {
    id: String(d._id),
    type: d.action,
    vendorId: String(d.vendorId),
    resourceType: d.resourceType ?? null,
    resourceId: d.resourceId ?? null,
    bucketId: d.meta?.bucketId ? String(d.meta.bucketId) : null,
    actorType: d.actorType,
    at: d.createdAt ? new Date(d.createdAt).toISOString() : new Date(Date.now()).toISOString()
  };
}

// Durable catch-up from the audit log. With a cursor → events strictly after it
// (ascending). Without → the most recent page (so a fresh client can fast-load).
async function deltaEvents(p: Principal, sinceId: string, limit: number): Promise<DomainEvent[]> {
  const q: Record<string, unknown> = { vendorId: new mongoose.Types.ObjectId(p.vendorId as string) };
  // Bucket-scoped keys only get events attributable to their buckets (fail closed).
  if (p.bucketIds && p.bucketIds.length > 0) q['meta.bucketId'] = { $in: p.bucketIds };
  if (sinceId && isObjId(sinceId)) {
    q._id = { $gt: new mongoose.Types.ObjectId(sinceId) };
    const docs = await AuditLog.find(q).sort({ _id: 1 }).limit(limit).lean();
    return docs.map(docToEvent);
  }
  const docs = await AuditLog.find(q).sort({ _id: -1 }).limit(limit).lean();
  return docs.map(docToEvent).reverse(); // oldest → newest
}

export async function GET(req: NextRequest) {
  const p = await authenticate(req);
  if (!p) return unauthorized();
  if (!p.vendorId) return forbidden('vendor credential required');
  if (p.vendorStatus === 'suspended') return suspended();
  if (!can(p, 'events:subscribe')) return forbidden('missing events:subscribe scope');
  await dbConnect();

  const url = new URL(req.url);

  // ---- delta / catch-up mode (one-shot JSON) ----
  if (url.searchParams.has('since') || url.searchParams.get('mode') === 'delta') {
    const since = url.searchParams.get('since') || '';
    const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '100', 10) || 100, 1), 500);
    const events = await deltaEvents(p, since, limit);
    const cursor = events.length ? events[events.length - 1].id : isObjId(since) ? since : null;
    return jsonOk({ events, cursor, count: events.length });
  }

  // ---- live SSE stream ----
  const enc = new TextEncoder();
  const lastEventId = req.headers.get('last-event-id') || url.searchParams.get('lastEventId') || '';
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const safeEnqueue = (s: string) => {
        if (closed) return;
        try {
          controller.enqueue(enc.encode(s));
        } catch {
          /* controller already closed */
        }
      };
      // Tell the client to retry after 5s, and open the stream.
      safeEnqueue('retry: 5000\n: connected\n\n');
      // Resume: backfill anything missed since the client's last seen id.
      if (lastEventId && isObjId(lastEventId)) {
        try {
          for (const e of await deltaEvents(p, lastEventId, 500)) safeEnqueue(sseFrame(e));
        } catch {
          /* backfill best-effort */
        }
      }
      const unsub = subscribe((e) => {
        if (canSeeEvent(p, e)) safeEnqueue(sseFrame(e));
      });
      // Heartbeat keeps nginx/proxies from idling the connection shut.
      const hb = setInterval(() => safeEnqueue(': ping\n\n'), 25000);
      const onAbort = () => {
        if (closed) return;
        closed = true;
        clearInterval(hb);
        unsub();
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };
      req.signal.addEventListener('abort', onAbort);
    }
  });

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      // Disable nginx proxy buffering so frames flush immediately.
      'x-accel-buffering': 'no'
    }
  });
}
