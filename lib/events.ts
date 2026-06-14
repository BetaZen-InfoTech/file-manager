import { EventEmitter } from 'events';

// In-process domain-event bus that powers the realtime feed (GET /v1/events,
// SSE). The app runs as a single Node process (next start, fork mode, 1
// instance), so an in-memory bus is sufficient — no Redis. If the app is ever
// clustered, swap this for a shared pub/sub or the Mongo change-stream backend;
// the public contract (DomainEvent) stays the same.
//
// Events are published from the audit() choke-point, so every audited mutation
// (upload, delete, link.create, bucket.*, fs.*, …) becomes a feed event, scoped
// to the acting vendor. The event id IS the AuditLog _id (a time-ordered
// ObjectId), so it doubles as the resume/delta cursor.

export interface DomainEvent {
  id: string; // AuditLog _id (hex) — also the Last-Event-ID / ?since cursor
  type: string; // the audit action, e.g. 'file.upload', 'link.create'
  vendorId: string;
  resourceType?: string | null;
  resourceId?: string | null;
  bucketId?: string | null; // present when the audit meta carried one
  actorType?: string;
  at: string; // ISO timestamp
}

// Persist the bus + ring on globalThis so dev hot-reload / multiple module
// evaluations share ONE emitter (otherwise subscribers and publishers split).
const g = globalThis as unknown as {
  __fmEventBus?: EventEmitter;
  __fmEventRing?: DomainEvent[];
};
const bus: EventEmitter = g.__fmEventBus || (g.__fmEventBus = new EventEmitter());
bus.setMaxListeners(0); // one listener per open SSE connection
const RING_MAX = 500;
const ring: DomainEvent[] = g.__fmEventRing || (g.__fmEventRing = []);

export function publishEvent(evt: DomainEvent): void {
  ring.push(evt);
  if (ring.length > RING_MAX) ring.splice(0, ring.length - RING_MAX);
  bus.emit('event', evt);
}

export function subscribe(handler: (evt: DomainEvent) => void): () => void {
  bus.on('event', handler);
  return () => {
    bus.off('event', handler);
  };
}

/** Events buffered in THIS process after `id` (best-effort, in-memory resume;
 * the durable backfill path is the Mongo ?since delta). */
export function bufferedSince(id: string | null): DomainEvent[] {
  if (!id) return [];
  const idx = ring.findIndex((e) => e.id === id);
  return idx >= 0 ? ring.slice(idx + 1) : [];
}

/**
 * May this principal receive this event? Always tenant-scoped to the vendor.
 * A bucket-scoped API key only sees events for its buckets — and events whose
 * bucket can't be determined are WITHHELD (fail closed), never leaked.
 */
export function canSeeEvent(
  p: { vendorId: string | null; bucketIds?: string[] },
  e: DomainEvent
): boolean {
  if (!p.vendorId || e.vendorId !== p.vendorId) return false;
  if (p.bucketIds && p.bucketIds.length > 0) {
    return !!e.bucketId && p.bucketIds.includes(e.bucketId);
  }
  return true;
}

/** Serialize one event as an SSE frame. */
export function sseFrame(e: DomainEvent): string {
  return `id: ${e.id}\nevent: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`;
}
