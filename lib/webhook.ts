import crypto from 'crypto';
import { dbConnect } from './db';
import { Webhook } from '@/models/Webhook';

export interface WebhookEvent {
  event: string;
  vendorId: string;
  data: Record<string, unknown>;
}

export async function fireVendorWebhook(evt: WebhookEvent): Promise<void> {
  await dbConnect();
  const hooks = await Webhook.find({ vendorId: evt.vendorId, status: 'active' }).lean();
  await Promise.all(
    hooks
      .filter((h) => h.events.length === 0 || h.events.includes(evt.event))
      .map((h) => deliver(h.url, h.secret, evt))
  );
}

async function deliver(url: string, secret: string, evt: WebhookEvent): Promise<void> {
  const body = JSON.stringify({ event: evt.event, vendorId: evt.vendorId, data: evt.data });
  const sig = 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex');
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-fms-signature': sig },
      body,
      signal: AbortSignal.timeout(8_000)
    });
    await Webhook.updateOne(
      { url, secret },
      { $set: { lastDeliveryAt: new Date(), lastStatusCode: res.status } }
    ).catch(() => {});
  } catch (err) {
    await Webhook.updateOne({ url, secret }, { $inc: { failureCount: 1 } }).catch(() => {});
  }
}
