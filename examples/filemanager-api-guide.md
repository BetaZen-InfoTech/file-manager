# File Manager API — Integration Guide

This guide is everything a 3rd-party application needs to integrate with the File Manager API: a REST API for buckets, folders, files, shareable download links, a private file manager, and a real-time event feed. Every call is authenticated with a vendor API key and is automatically scoped to your tenant.

**Base URL:** `https://cdn.betazeninfotech.com/api/v1`
All endpoints below are relative to this base. All requests and responses are JSON unless noted (file uploads use `multipart/form-data`; the event feed is `text/event-stream`).

---

## 1. Authentication

Authenticate every request with a vendor API key (it looks like `fmsk_…`). Create one in your vendor dashboard under “API keys” — the secret is shown only once, so store it safely. Send it on every request as a Bearer token (or the `x-api-key` header). Each key carries a set of scopes (permissions) and may optionally be restricted to specific buckets; a request that needs a scope the key doesn’t have is rejected with `403`. The SAME key authenticates all three transports — the REST endpoints, the SSE feed (`/events`), and the WebSocket feed (`/ws`) — so one credential drives everything.

```bash
# Either header works:
-H "Authorization: Bearer fmsk_YOUR_KEY"
-H "x-api-key: fmsk_YOUR_KEY"
```

Every endpoint declares the scope it requires. Grant a key only the scopes it needs. The available scopes:

**Buckets**

| Scope | Grants |
| --- | --- |
| `bucket:read` | List & view buckets |
| `bucket:create` | Create buckets |
| `bucket:update` | Rename / change settings |
| `bucket:delete` | Delete buckets |

**Files**

| Scope | Grants |
| --- | --- |
| `file:list` | List files & folders |
| `file:read` | View details / read text / list links |
| `file:download` | Download files |
| `file:upload` | Upload, edit, copy, extract, multipart |
| `file:delete` | Trash & restore files |

**Folders**

| Scope | Grants |
| --- | --- |
| `folder:create` | Create folders |
| `folder:update` | Rename / move / delete folders |
| `folder:hide` | Hide / unhide files & folders |

**Share links**

| Scope | Grants |
| --- | --- |
| `publicurl:create` | Create share links |
| `publicurl:revoke` | Reset / revoke links |

**Realtime**

| Scope | Grants |
| --- | --- |
| `events:subscribe` | Subscribe to the realtime event feed |

---

## 2. Quick start

**1. Verify your key (list buckets)**

```bash
curl -H "Authorization: Bearer fmsk_YOUR_KEY" \
  https://cdn.betazeninfotech.com/api/v1/buckets
```

**2. Create a bucket**

```bash
curl -X POST https://cdn.betazeninfotech.com/api/v1/buckets \
  -H "Authorization: Bearer fmsk_YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"name":"invoices"}'
```

**3. Upload a file**

```bash
curl -X POST https://cdn.betazeninfotech.com/api/v1/buckets/BUCKET_ID/files \
  -H "Authorization: Bearer fmsk_YOUR_KEY" \
  -F "file=@/path/to/file.pdf" -F "path=/"
```

**4. Create a public share link**

```bash
curl -X POST https://cdn.betazeninfotech.com/api/v1/files/FILE_ID/links \
  -H "Authorization: Bearer fmsk_YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"type":"public"}'
```

**5. Receive real-time updates**

```bash
curl -N https://cdn.betazeninfotech.com/api/v1/events \
  -H "Authorization: Bearer fmsk_YOUR_KEY" \
  -H "Accept: text/event-stream"
```

---

## 3. Core concepts

**Buckets** — Top-level containers for your files (one tenant can have many). Names are unique per vendor. Creating a bucket also provisions a matching folder in your File Manager.

**Folders** — Optional hierarchy inside a bucket. Files can live at the bucket root or inside nested folders.

**Files** — Uploaded objects. Small files use a single multipart/form-data upload; large files use the multipart flow (init → upload parts → complete). Uploads are also mirrored into your File Manager so they show up there.

**Share links** — Three kinds of shareable download URLs: public (/p/…, anyone with the URL), temporary (/t/…, auto-expires), and private (/d/…, requires a 3rd-party JWT). Temporary links require an explicit expiresIn; public/private links can be made permanent with neverExpire. Links stream the file through the app, so they work from any browser.

**File Manager** — A private, jailed filesystem per tenant. You can create folders, read/write text files, upload, compress/extract, change permissions, hide files, and move items to a recoverable Trash (restore or permanently delete).

**Real-time events** — A live feed of everything happening on your account (uploads, deletes, link creation, file-manager operations…), delivered over a standard HTTPS stream (Server-Sent Events). Use it to keep a 3rd-party UI in sync instantly instead of polling.

---

## 4. API reference

Every endpoint is listed below with its required scope. For full request/response
details and a live tester, open the interactive explorer at `https://cdn.betazeninfotech.com/docs`.

### Buckets & Folders
Containers for files. Every query is scoped to your vendor.

| Method | Path | Scope | Description |
| --- | --- | --- | --- |
| `GET` | `/buckets` | `bucket:read` | List buckets |
| `POST` | `/buckets` | `bucket:create` | Create bucket |
| `GET` | `/buckets/:bid` | `bucket:read` | Bucket details |
| `PATCH` | `/buckets/:bid` | `bucket:update` | Update bucket |
| `DELETE` | `/buckets/:bid` | `bucket:delete` | Delete bucket |
| `GET` | `/buckets/:bid/folders` | `file:list` | List folders |
| `POST` | `/buckets/:bid/folders` | `folder:create` | Create folder |
| `PATCH` | `/folders/:id` | `folder:update` | Rename folder |
| `DELETE` | `/folders/:id` | `folder:update` | Delete folder |
| `PATCH` | `/folders/:id` | `folder:update` | Move folder |
| `POST` | `/folders/:id/hide` | `folder:hide` | Hide folder |
| `POST` | `/folders/:id/unhide` | `folder:hide` | Unhide folder |

### Files
Upload, fetch, update and download files. Uploads are multipart/form-data.

| Method | Path | Scope | Description |
| --- | --- | --- | --- |
| `GET` | `/buckets/:bid/files` | `file:list` | List files |
| `POST` | `/buckets/:bid/files` | `file:upload` | Upload file |
| `GET` | `/files/:id` | `file:read` | File details |
| `PATCH` | `/files/:id` | `file:upload` | Update file |
| `DELETE` | `/files/:id` | `file:delete` | Trash file |
| `GET` | `/files/:id/download` | `file:download` | Download file |
| `POST` | `/files/:id/restore` | `file:delete` | Restore from trash |
| `POST` | `/files/:id/copy` | `file:upload` | Copy file |
| `GET` | `/files/:id/content` | `file:read` | Read text content |
| `PUT` | `/files/:id/content` | `file:upload` | Edit text content |
| `POST` | `/files/:id/hide` | `folder:hide` | Hide file |
| `POST` | `/files/:id/unhide` | `folder:hide` | Unhide file |
| `POST` | `/files/:id/extract` | `file:upload` | Extract a .zip |
| `POST` | `/buckets/:bid/files/blank` | `file:upload` | Create a (text) file |
| `POST` | `/buckets/:bid/archive` | `file:read` | Zip files into an archive |

### Large uploads (multipart)
For big files, upload in parts: init → upload each part → complete. Abort to cancel.

| Method | Path | Scope | Description |
| --- | --- | --- | --- |
| `POST` | `/files/multipart/init` | `file:upload` | Start multipart upload |
| `PUT` | `/files/multipart/:uploadId/part/:n` | `file:upload` | Upload a part |
| `POST` | `/files/multipart/:uploadId/complete` | `file:upload` | Complete upload |
| `POST` | `/files/multipart/:uploadId/abort` | `file:upload` | Abort upload |

### Links
Three shareable link types: public, temporary (auto-expiring), private (JWT-gated).

| Method | Path | Scope | Description |
| --- | --- | --- | --- |
| `GET` | `/files/:id/links` | `file:read` | List links |
| `POST` | `/files/:id/links` | `publicurl:create` | Create link |
| `POST` | `/files/:id/links/reset` | `publicurl:revoke` | Reset all links |
| `DELETE` | `/links/:id` | `publicurl:revoke` | Revoke link |

### Realtime events
A live per-vendor activity feed (Server-Sent Events) so 3rd-party software gets pushed updates instead of polling — plus a JSON delta for fast catch-up.

| Method | Path | Scope | Description |
| --- | --- | --- | --- |
| `GET` | `/events` | `events:subscribe` | Event stream / delta |
| `GET` | `/ws` | `events:subscribe` | WebSocket stream |

### File manager (your private folder)
A private, jailed filesystem area per vendor. Every path is relative to your home folder — you can never reach a parent, the server root, or another vendor.

| Method | Path | Scope | Description |
| --- | --- | --- | --- |
| `GET` | `/fs` | — | List a directory |
| `POST` | `/fs` | — | File operation |
| `GET` | `/fs/read` | — | Read a text file |
| `GET` | `/fs/download` | — | Download a file |
| `POST` | `/fs/upload` | — | Upload into a folder |

### Shareable download URLs
Public-facing URLs returned by "Create link". These live at the site root (NOT under /api/v1) and need no API key — open them in a browser. Private links require a 3rd-party JWT.

| Method | Path | Scope | Description |
| --- | --- | --- | --- |
| `GET` | `/p/:token` | — | Public download |
| `GET` | `/t/:token` | — | Temporary download |
| `GET` | `/d/:token` | — | Private download (JWT) |

---

## 5. Real-time events (Server-Sent Events)

Open `GET /events` with a streaming HTTP client and your API key; the server keeps the connection open and pushes one event per change as it happens. Each event is a small JSON object. The connection auto-recovers: on reconnect, send the `Last-Event-ID` header (the id of the last event you saw) and you’ll receive everything you missed. For a one-shot catch-up (e.g. on first load) call `GET /events?since=<cursor>` for a JSON list plus a cursor to continue from. Keys restricted to specific buckets only receive events for those buckets.

**Event payload**

```json
{
  "id": "6a2e7012c12f65f87232a1f3",
  "type": "file.upload",
  "vendorId": "6a2d7e0a626116c181d92a71",
  "resourceType": "file",
  "resourceId": "6a2e70b4c12f65f87232a201",
  "bucketId": "6a2e6fc6c12f65f87232a172",
  "actorType": "apikey",
  "at": "2026-06-14T09:10:42.615Z"
}
```

**Event types** — the `type` field is one of:

**Files**

| Event type | Meaning |
| --- | --- |
| `file.upload` | A file was uploaded to a bucket. |
| `file.create` | A file was created from inline text (blank file). |
| `file.update` | File metadata changed (rename, tags, move…). |
| `file.edit` | A text file’s contents were overwritten. |
| `file.copy` | A file was duplicated. |
| `file.delete` | A file was moved to trash. |
| `file.restore` | A trashed file was restored. |
| `file.download` | A file was downloaded via the API. |
| `file.hide` | A file was hidden. |
| `file.unhide` | A file was un-hidden. |
| `file.zip` | Files/folders were archived into a .zip. |
| `file.extract` | A .zip was extracted into the bucket. |
| `file.multipart.init` | A large (multipart) upload started. |
| `file.multipart.complete` | A multipart upload finished — file is ready. |
| `file.multipart.abort` | A multipart upload was aborted. |

**Buckets**

| Event type | Meaning |
| --- | --- |
| `bucket.create` | A bucket was created. |
| `bucket.update` | A bucket was renamed or reconfigured. |
| `bucket.delete` | A bucket was deleted. |

**Folders**

| Event type | Meaning |
| --- | --- |
| `folder.create` | A folder was created. |
| `folder.update` | A folder was renamed or moved. |
| `folder.delete` | A folder was deleted. |
| `folder.hide` | A folder was hidden. |
| `folder.unhide` | A folder was un-hidden. |

**Share links**

| Event type | Meaning |
| --- | --- |
| `link.create` | A share link was created. |
| `link.reset` | A file’s links were reset / regenerated. |
| `link.revoke` | A share link was revoked. |
| `link.download.public` | A public link was opened / downloaded. |
| `link.download.temporary` | A temporary link was opened / downloaded. |
| `link.download.private` | A private (JWT) link was opened / downloaded. |

**File manager (jailed FS)**

| Event type | Meaning |
| --- | --- |
| `fs.mkdir` | A directory was created. |
| `fs.newfile` | An empty file was created. |
| `fs.write` | A file was written / edited. |
| `fs.upload` | A file was uploaded into the file manager. |
| `fs.rename` | An item was renamed / moved. |
| `fs.copy` | An item was copied. |
| `fs.delete` | An item was permanently deleted. |
| `fs.trash` | An item was moved to the trash. |
| `fs.restore` | An item was restored from the trash. |
| `fs.chmod` | Permissions were changed. |
| `fs.zip` | Items were compressed. |
| `fs.extract` | A zip was extracted. |
| `fs.hide` | An item was hidden. |
| `fs.unhide` | An item was un-hidden. |

**Reference client (Node 18+, no dependencies)**

```js
const BASE = 'https://cdn.betazeninfotech.com/api/v1';
const KEY = process.env.FM_API_KEY; // fmsk_...

// 1) Fast initial load + resume cursor
let cursor = null;
async function catchUp() {
  const url = new URL(BASE + '/events');
  if (cursor) url.searchParams.set('since', cursor);
  const r = await fetch(url, { headers: { Authorization: 'Bearer ' + KEY } });
  const { events, cursor: next } = await r.json();
  events.forEach(handle);
  if (next) cursor = next;
}

// 2) Live stream (auto-reconnect with Last-Event-ID)
async function stream() {
  const res = await fetch(BASE + '/events', {
    headers: { Authorization: 'Bearer ' + KEY, Accept: 'text/event-stream',
               ...(cursor ? { 'Last-Event-ID': cursor } : {}) }
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
      const line = frame.split('\n').find((l) => l.startsWith('data: '));
      if (line) { const e = JSON.parse(line.slice(6)); cursor = e.id; handle(e); }
    }
  }
  setTimeout(stream, 1000); // reconnect on drop
}

function handle(e) { console.log(e.type, e.resourceId, e.at); }
await catchUp();
stream();
```

### WebSocket (`wss://`)

The same real-time feed is also available over WebSocket — for 3rd-party platforms that require it. It carries the identical event objects as the SSE feed and uses the same API key (events:subscribe scope). Bucket-scoped keys only receive their buckets’ events.

- **URL:** `wss://cdn.betazeninfotech.com/api/v1/ws`
- **Auth (handshake):** `Authorization: Bearer fmsk_YOUR_KEY` (or `x-api-key`). Browsers can't set handshake headers — use `?api_key=fmsk_YOUR_KEY` (note: query keys can appear in logs) or pass the key as the `Sec-WebSocket-Protocol`.
- **On connect** the server sends a hello: `{"type":"__connected","vendorId":"…","cursor":"…"}`, then one JSON message per event (same payload shape as above).
- **Resume:** reconnect with `?since=<cursor>` (the `id` of the last event you saw) to receive anything missed.
- **Heartbeat:** the server pings every 30s; standard clients auto-reply. You may also send `{"type":"ping"}` to get `{"type":"pong"}`.

**Node (ws package — server-to-server, header auth)**

```js
import WebSocket from 'ws';
const ws = new WebSocket('wss://cdn.betazeninfotech.com/api/v1/ws', {
  headers: { Authorization: 'Bearer fmsk_YOUR_KEY' }   // or x-api-key
});
ws.on('open', () => console.log('connected'));
ws.on('message', (data) => {
  const e = JSON.parse(data.toString());
  if (e.type === '__connected') return;                // hello + resume cursor
  console.log(e.type, e.resourceId, e.at);
});
ws.on('close', () => setTimeout(reconnect, 1000));     // reconnect with ?since=<lastId>
```

**Browser (headers not allowed — use the query param)**

```js
const ws = new WebSocket('wss://cdn.betazeninfotech.com/api/v1/ws?api_key=fmsk_YOUR_KEY');
ws.onmessage = (m) => { const e = JSON.parse(m.data); console.log(e.type); };
```

**Quick test (wscat)**

```js
wscat -c "wss://cdn.betazeninfotech.com/api/v1/ws" -H "Authorization: Bearer fmsk_YOUR_KEY"
```

---

## 6. Responses & errors

A successful response returns the requested JSON directly (HTTP 200, or 201 on create). An error returns `{ "error": { "code": "…", "message": "…" } }` with an appropriate HTTP status:

| HTTP | When |
| --- | --- |
| `400` | Invalid input (bad body, missing/!invalid field). |
| `401` | Missing or invalid credentials. |
| `403` | Authenticated, but the key lacks the required scope / bucket, or the vendor is suspended. |
| `404` | Resource not found (or not visible to your tenant). |
| `410` | A share link has expired or hit its download limit. |
| `429` | Rate limited — back off and retry. |
| `5xx` | Server error — safe to retry idempotent requests. |

---

## 7. Tools & downloads

- **Interactive API explorer** — https://cdn.betazeninfotech.com/docs
  Browse every endpoint and run it live in your browser.
- **Postman collection** — https://cdn.betazeninfotech.com/api/v1/postman
  Import into Postman — pre-filled requests for every endpoint.
- **OpenAPI 3 spec** — https://cdn.betazeninfotech.com/api/v1/openapi
  Machine-readable spec — generate a client in any language.
- **This guide (Markdown)** — https://cdn.betazeninfotech.com/docs/guide/raw
  A single self-contained document to hand to your developers.

---

_Generated from the live API catalog — always current with the running server._
