# Realtime events — 3rd-party integration

A live, per-vendor activity feed so your software updates instantly instead of
polling. One endpoint, two modes:

- **Live stream (SSE):** `GET /api/v1/events` → `text/event-stream`
- **Delta / fast-load (JSON):** `GET /api/v1/events?since=<cursor>`

Authenticate with your vendor API key exactly like the rest of the API:
`Authorization: Bearer fmsk_…` (or `x-api-key: fmsk_…`). Requires the
**`events:subscribe`** scope on the key.

Each event:

```json
{ "id": "665f…", "type": "file.upload", "vendorId": "…",
  "resourceType": "file", "resourceId": "…", "bucketId": "…", "at": "2026-06-13T…Z" }
```

`type` mirrors the audit action: `file.upload`, `file.update`, `file.delete`,
`file.restore`, `link.create`, `bucket.create`, `fs.trash`, … `id` is also the
cursor — pass the last one you saw as `Last-Event-ID` (stream) or `?since=`
(delta) to resume with no gaps. Bucket-scoped keys only receive their buckets'
events.

---

## Fast initial load, then poll (simplest, most robust)

```js
const BASE = 'https://cdn.betazeninfotech.com/api/v1';
const KEY = process.env.FM_API_KEY; // fmsk_…
let cursor = null;

async function pull() {
  const url = new URL(`${BASE}/events`);
  if (cursor) url.searchParams.set('since', cursor);
  const r = await fetch(url, { headers: { Authorization: `Bearer ${KEY}` } });
  const { events, cursor: next } = (await r.json()).data;
  for (const e of events) handle(e); // your handler
  if (next) cursor = next;
}
setInterval(pull, 3000); // first call (no cursor) returns the most recent page
```

## Live push (Node 18+, no deps)

```js
// SSE over fetch — lets you send the Authorization header (EventSource cannot).
const res = await fetch(`${BASE}/events`, {
  headers: { Authorization: `Bearer ${KEY}`, Accept: 'text/event-stream' }
});
const reader = res.body.getReader();
const dec = new TextDecoder();
let buf = '';
for (;;) {
  const { value, done } = await reader.read();
  if (done) break;
  buf += dec.decode(value, { stream: true });
  let i;
  while ((i = buf.indexOf('\n\n')) >= 0) {
    const frame = buf.slice(0, i); buf = buf.slice(i + 2);
    const data = frame.split('\n').find((l) => l.startsWith('data: '));
    if (data) handle(JSON.parse(data.slice(6)));
  }
}
// On disconnect, reconnect with header `Last-Event-ID: <last id>` to resume.
```

## curl (quick test)

```bash
curl -N -H "Authorization: Bearer $FM_API_KEY" \
  "https://cdn.betazeninfotech.com/api/v1/events"          # live stream
curl -H "Authorization: Bearer $FM_API_KEY" \
  "https://cdn.betazeninfotech.com/api/v1/events?since="    # JSON delta (recent page)
```

## Browser

`EventSource` can't send headers, so use the fetch-stream snippet above with the
key kept server-side, **or** proxy the stream through your own backend. Avoid
putting the key in the URL — it leaks into logs and history.
