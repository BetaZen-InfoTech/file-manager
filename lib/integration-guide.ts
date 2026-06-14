// Single source for the 3rd-party Integration Guide. The published page
// (app/docs/guide) renders these as styled HTML; /docs/guide/raw serves the
// generated Markdown for sharing. Endpoint / scope / event data comes from the
// API catalog so the guide never drifts. Real-time delivery is Server-Sent
// Events over HTTPS (no extra protocol or socket needed).

import {
  API_BASE,
  VENDOR_API_GROUPS,
  ENDPOINT_SCOPE,
  SCOPE_GROUPS,
  EVENT_TYPE_GROUPS,
  EVENT_SAMPLE
} from './api-catalog';

export const GUIDE_TITLE = 'File Manager API — Integration Guide';

export const GUIDE_INTRO =
  'This guide is everything a 3rd-party application needs to integrate with the File Manager API: a REST API for buckets, folders, files, shareable download links, a private file manager, and a real-time event feed. Every call is authenticated with a vendor API key and is automatically scoped to your tenant.';

export const AUTH_PROSE =
  'Authenticate every request with a vendor API key (it looks like `fmsk_…`). Create one in your vendor dashboard under “API keys” — the secret is shown only once, so store it safely. Send it on every request as a Bearer token (or the `x-api-key` header). Each key carries a set of scopes (permissions) and may optionally be restricted to specific buckets; a request that needs a scope the key doesn’t have is rejected with `403`. The SAME key authenticates all three transports — the REST endpoints, the SSE feed (`/events`), and the WebSocket feed (`/ws`) — so one credential drives everything.';

export const SCOPE_PROSE =
  'Every endpoint declares the scope it requires. Grant a key only the scopes it needs. The available scopes:';

export const CONCEPTS: { name: string; body: string }[] = [
  { name: 'Buckets', body: 'Top-level containers for your files (one tenant can have many). Names are unique per vendor. Creating a bucket also provisions a matching folder in your File Manager.' },
  { name: 'Folders', body: 'Optional hierarchy inside a bucket. Files can live at the bucket root or inside nested folders.' },
  { name: 'Files', body: 'Uploaded objects. Small files use a single multipart/form-data upload; large files use the multipart flow (init → upload parts → complete). Uploads are also mirrored into your File Manager so they show up there.' },
  { name: 'Share links', body: 'Three kinds of shareable download URLs: public (/p/…, anyone with the URL), temporary (/t/…, auto-expires), and private (/d/…, requires a 3rd-party JWT). Temporary links require an explicit expiresIn; public/private links can be made permanent with neverExpire. Links stream the file through the app, so they work from any browser.' },
  { name: 'File Manager', body: 'A private, jailed filesystem per tenant. You can create folders, read/write text files, upload, compress/extract, change permissions, hide files, and move items to a recoverable Trash (restore or permanently delete).' },
  { name: 'Real-time events', body: 'A live feed of everything happening on your account (uploads, deletes, link creation, file-manager operations…), delivered over a standard HTTPS stream (Server-Sent Events). Use it to keep a 3rd-party UI in sync instantly instead of polling.' }
];

export const EVENTS_PROSE =
  'Open `GET /events` with a streaming HTTP client and your API key; the server keeps the connection open and pushes one event per change as it happens. Each event is a small JSON object. The connection auto-recovers: on reconnect, send the `Last-Event-ID` header (the id of the last event you saw) and you’ll receive everything you missed. For a one-shot catch-up (e.g. on first load) call `GET /events?since=<cursor>` for a JSON list plus a cursor to continue from. Keys restricted to specific buckets only receive events for those buckets.';

export const ERRORS_PROSE =
  'A successful response returns the requested JSON directly (HTTP 200, or 201 on create). An error returns `{ "error": { "code": "…", "message": "…" } }` with an appropriate HTTP status:';

export const ERROR_CODES: { status: string; when: string }[] = [
  { status: '400', when: 'Invalid input (bad body, missing/!invalid field).' },
  { status: '401', when: 'Missing or invalid credentials.' },
  { status: '403', when: 'Authenticated, but the key lacks the required scope / bucket, or the vendor is suspended.' },
  { status: '404', when: 'Resource not found (or not visible to your tenant).' },
  { status: '410', when: 'A share link has expired or hit its download limit.' },
  { status: '429', when: 'Rate limited — back off and retry.' },
  { status: '5xx', when: 'Server error — safe to retry idempotent requests.' }
];

export function quickstart(appUrl: string): { title: string; code: string }[] {
  const b = `${appUrl}${API_BASE}`;
  const K = 'fmsk_YOUR_KEY';
  return [
    { title: '1. Verify your key (list buckets)', code: `curl -H "Authorization: Bearer ${K}" \\\n  ${b}/buckets` },
    { title: '2. Create a bucket', code: `curl -X POST ${b}/buckets \\\n  -H "Authorization: Bearer ${K}" \\\n  -H "Content-Type: application/json" \\\n  -d '{"name":"invoices"}'` },
    { title: '3. Upload a file', code: `curl -X POST ${b}/buckets/BUCKET_ID/files \\\n  -H "Authorization: Bearer ${K}" \\\n  -F "file=@/path/to/file.pdf" -F "path=/"` },
    { title: '4. Create a public share link', code: `curl -X POST ${b}/files/FILE_ID/links \\\n  -H "Authorization: Bearer ${K}" \\\n  -H "Content-Type: application/json" \\\n  -d '{"type":"public"}'` },
    { title: '5. Receive real-time updates', code: `curl -N ${b}/events \\\n  -H "Authorization: Bearer ${K}" \\\n  -H "Accept: text/event-stream"` }
  ];
}

export function downloads(appUrl: string): { label: string; url: string; note: string }[] {
  return [
    { label: 'Interactive API explorer', url: `${appUrl}/docs`, note: 'Browse every endpoint and run it live in your browser.' },
    { label: 'Postman collection', url: `${appUrl}${API_BASE}/postman`, note: 'Import into Postman — pre-filled requests for every endpoint.' },
    { label: 'OpenAPI 3 spec', url: `${appUrl}${API_BASE}/openapi`, note: 'Machine-readable spec — generate a client in any language.' },
    { label: 'This guide (Markdown)', url: `${appUrl}/docs/guide/raw`, note: 'A single self-contained document to hand to your developers.' }
  ];
}

// ---- WebSocket (wss) ------------------------------------------------------
export const WS_PROSE =
  'The same real-time feed is also available over WebSocket — for 3rd-party platforms that require it. It carries the identical event objects as the SSE feed and uses the same API key (events:subscribe scope). Bucket-scoped keys only receive their buckets’ events.';

export function wsUrl(appUrl: string): string {
  return appUrl.replace(/^http/i, 'ws') + '/api/v1/ws';
}

export function wsExamples(appUrl: string): { title: string; code: string }[] {
  const W = wsUrl(appUrl);
  return [
    {
      title: 'Node (ws package — server-to-server, header auth)',
      code: `import WebSocket from 'ws';
const ws = new WebSocket('${W}', {
  headers: { Authorization: 'Bearer fmsk_YOUR_KEY' }   // or x-api-key
});
ws.on('open', () => console.log('connected'));
ws.on('message', (data) => {
  const e = JSON.parse(data.toString());
  if (e.type === '__connected') return;                // hello + resume cursor
  console.log(e.type, e.resourceId, e.at);
});
ws.on('close', () => setTimeout(reconnect, 1000));     // reconnect with ?since=<lastId>`
    },
    {
      title: 'Browser (headers not allowed — use the query param)',
      code: `const ws = new WebSocket('${W}?api_key=fmsk_YOUR_KEY');
ws.onmessage = (m) => { const e = JSON.parse(m.data); console.log(e.type); };`
    },
    {
      title: 'Quick test (wscat)',
      code: `wscat -c "${W}" -H "Authorization: Bearer fmsk_YOUR_KEY"`
    }
  ];
}

// ---- Markdown generator (served at /docs/guide/raw) -----------------------
const NODE_CLIENT = `const BASE = '__BASE__';
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
    while ((i = buf.indexOf('\\n\\n')) >= 0) {
      const frame = buf.slice(0, i); buf = buf.slice(i + 2);
      const line = frame.split('\\n').find((l) => l.startsWith('data: '));
      if (line) { const e = JSON.parse(line.slice(6)); cursor = e.id; handle(e); }
    }
  }
  setTimeout(stream, 1000); // reconnect on drop
}

function handle(e) { console.log(e.type, e.resourceId, e.at); }
await catchUp();
stream();`;

export function nodeClient(appUrl: string): string {
  return NODE_CLIENT.replace('__BASE__', `${appUrl}${API_BASE}`);
}

function table(headers: string[], rows: string[][]): string {
  const head = `| ${headers.join(' | ')} |`;
  const sep = `| ${headers.map(() => '---').join(' | ')} |`;
  const body = rows.map((r) => `| ${r.join(' | ')} |`).join('\n');
  return `${head}\n${sep}\n${body}`;
}

export function guideMarkdown(appUrl: string): string {
  const b = `${appUrl}${API_BASE}`;
  const scopeBlocks = SCOPE_GROUPS.map(
    (g) => `**${g.group}**\n\n${table(['Scope', 'Grants'], g.scopes.map((s) => ['`' + s.id + '`', s.label]))}`
  ).join('\n\n');
  const endpointBlocks = VENDOR_API_GROUPS.map((g) => {
    const rows = g.endpoints.map((ep) => [
      '`' + ep.method + '`',
      '`' + ep.path + '`',
      ENDPOINT_SCOPE[ep.id] ? '`' + ENDPOINT_SCOPE[ep.id] + '`' : '—',
      ep.summary
    ]);
    return `### ${g.name}\n${g.blurb}\n\n${table(['Method', 'Path', 'Scope', 'Description'], rows)}`;
  }).join('\n\n');
  const eventBlocks = EVENT_TYPE_GROUPS.map(
    (g) => `**${g.group}**\n\n${table(['Event type', 'Meaning'], g.types.map((t) => ['`' + t.type + '`', t.desc]))}`
  ).join('\n\n');
  const quick = quickstart(appUrl)
    .map((s) => `**${s.title}**\n\n\`\`\`bash\n${s.code}\n\`\`\``)
    .join('\n\n');
  const dl = downloads(appUrl)
    .map((d) => `- **${d.label}** — ${d.url}\n  ${d.note}`)
    .join('\n');

  return `# ${GUIDE_TITLE}

${GUIDE_INTRO}

**Base URL:** \`${b}\`
All endpoints below are relative to this base. All requests and responses are JSON unless noted (file uploads use \`multipart/form-data\`; the event feed is \`text/event-stream\`).

---

## 1. Authentication

${AUTH_PROSE}

\`\`\`bash
# Either header works:
-H "Authorization: Bearer fmsk_YOUR_KEY"
-H "x-api-key: fmsk_YOUR_KEY"
\`\`\`

${SCOPE_PROSE}

${scopeBlocks}

---

## 2. Quick start

${quick}

---

## 3. Core concepts

${CONCEPTS.map((c) => `**${c.name}** — ${c.body}`).join('\n\n')}

---

## 4. API reference

Every endpoint is listed below with its required scope. For full request/response
details and a live tester, open the interactive explorer at \`${appUrl}/docs\`.

${endpointBlocks}

---

## 5. Real-time events (Server-Sent Events)

${EVENTS_PROSE}

**Event payload**

\`\`\`json
${JSON.stringify(EVENT_SAMPLE, null, 2)}
\`\`\`

**Event types** — the \`type\` field is one of:

${eventBlocks}

**Reference client (Node 18+, no dependencies)**

\`\`\`js
${nodeClient(appUrl)}
\`\`\`

### WebSocket (\`wss://\`)

${WS_PROSE}

- **URL:** \`${wsUrl(appUrl)}\`
- **Auth (handshake):** \`Authorization: Bearer fmsk_YOUR_KEY\` (or \`x-api-key\`). Browsers can't set handshake headers — use \`?api_key=fmsk_YOUR_KEY\` (note: query keys can appear in logs) or pass the key as the \`Sec-WebSocket-Protocol\`.
- **On connect** the server sends a hello: \`{"type":"__connected","vendorId":"…","cursor":"…"}\`, then one JSON message per event (same payload shape as above).
- **Resume:** reconnect with \`?since=<cursor>\` (the \`id\` of the last event you saw) to receive anything missed.
- **Heartbeat:** the server pings every 30s; standard clients auto-reply. You may also send \`{"type":"ping"}\` to get \`{"type":"pong"}\`.

${wsExamples(appUrl)
  .map((s) => `**${s.title}**\n\n\`\`\`js\n${s.code}\n\`\`\``)
  .join('\n\n')}

---

## 6. Responses & errors

${ERRORS_PROSE}

${table(['HTTP', 'When'], ERROR_CODES.map((e) => ['`' + e.status + '`', e.when]))}

---

## 7. Tools & downloads

${dl}

---

_Generated from the live API catalog — always current with the running server._
`;
}
