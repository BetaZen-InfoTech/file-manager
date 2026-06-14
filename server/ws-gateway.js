'use strict';
/*
 * WebSocket gateway for the realtime event feed (wss://<host>/api/v1/ws).
 *
 * Runs as its OWN process (PM2 app "filemanager-ws") so the main Next app
 * (`next start`) is never touched — if this gateway restarts/crashes, the site
 * stays up. nginx proxies /api/v1/ws here. It authenticates the handshake with a
 * vendor API key (same fmsk_ key as the REST API, events:subscribe scope) and
 * pushes the same event objects the SSE feed emits — tailed from the audit log,
 * so it works on any MongoDB topology (no replica set / change streams needed).
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const { MongoClient, ObjectId } = require('mongodb');

// --- minimal .env loader (the gateway runs outside Next) ---
(function loadEnv() {
  for (const f of [path.join(process.cwd(), '.env'), '/var/www/app/.env']) {
    if (!fs.existsSync(f)) continue;
    for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.+?)\s*$/i.exec(line);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
    }
    break;
  }
})();

const PORT = parseInt(process.env.WS_PORT || '3001', 10);
const POLL_MS = parseInt(process.env.WS_POLL_MS || '1000', 10);
const PATHNAME = '/api/v1/ws';
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const isObjId = (s) => typeof s === 'string' && /^[a-f0-9]{24}$/i.test(s);

let mongo = null;
let db = null;
async function getDb() {
  if (db) return db;
  mongo = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 15000 });
  await mongo.connect();
  db = mongo.db();
  return db;
}

// Validate the API key → tenant principal (mirrors lib/auth + the events:subscribe gate).
async function authKey(token) {
  if (!token || !token.startsWith('fmsk_')) return null;
  const d = await getDb();
  const k = await d.collection('apikeys').findOne({ keyHash: sha256(token) });
  if (!k || k.status !== 'active') return null;
  if (k.expiresAt && new Date(k.expiresAt) < new Date()) return null;
  if (!(k.permissions || []).includes('events:subscribe')) return null;
  const v = await d.collection('vendors').findOne({ _id: k.vendorId });
  if (!v || v.status === 'suspended') return null;
  return { vendorId: String(k.vendorId), vendorOid: k.vendorId, bucketIds: (k.bucketIds || []).map(String) };
}

function docToEvent(x) {
  return {
    id: String(x._id),
    type: x.action,
    vendorId: String(x.vendorId),
    resourceType: x.resourceType || null,
    resourceId: x.resourceId || null,
    bucketId: x.meta && x.meta.bucketId ? String(x.meta.bucketId) : null,
    actorType: x.actorType,
    at: x.createdAt ? new Date(x.createdAt).toISOString() : new Date().toISOString()
  };
}

// Audit-log query for one tenant (bucket-scoped keys fail closed).
function vendorQuery(p, sinceId) {
  const q = { vendorId: p.vendorOid };
  if (p.bucketIds.length) q['meta.bucketId'] = { $in: p.bucketIds };
  if (sinceId && isObjId(sinceId)) q._id = { $gt: new ObjectId(sinceId) };
  return q;
}
async function fetchSince(p, sinceId, limit) {
  const d = await getDb();
  const docs = await d.collection('auditlogs').find(vendorQuery(p, sinceId)).sort({ _id: 1 }).limit(limit).toArray();
  return docs.map(docToEvent);
}
async function latestCursor(p) {
  const d = await getDb();
  const last = await d.collection('auditlogs').find(vendorQuery(p, null)).sort({ _id: -1 }).limit(1).toArray();
  return last.length ? String(last[0]._id) : null;
}

const server = http.createServer((req, res) => {
  if (req.url === '/healthz') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, ws: true, path: PATHNAME }));
    return;
  }
  res.writeHead(426, { 'content-type': 'text/plain' });
  res.end('Upgrade Required — connect via WebSocket to ' + PATHNAME);
});

const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });

server.on('upgrade', async (req, socket, head) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname !== PATHNAME) {
      socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    // Auth precedence: Authorization/x-api-key header → subprotocol → query param.
    const auth = (req.headers['authorization'] || '').trim();
    let token = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : (req.headers['x-api-key'] || '').trim();
    if (!token) {
      const proto = req.headers['sec-websocket-protocol'];
      if (proto) token = proto.split(',').map((s) => s.trim()).find((s) => s.startsWith('fmsk_')) || '';
    }
    if (!token) token = url.searchParams.get('api_key') || url.searchParams.get('token') || '';
    const principal = await authKey(token);
    if (!principal) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req, principal, url));
  } catch (e) {
    try { socket.destroy(); } catch (_) {}
  }
});

wss.on('connection', async (ws, req, principal, url) => {
  let closed = false;
  let cursor = url.searchParams.get('since') || null;
  const send = (obj) => {
    if (closed || ws.readyState !== ws.OPEN) return;
    try { ws.send(JSON.stringify(obj)); } catch (_) {}
  };

  // Resume from a cursor (backfill) or start live from the latest position.
  try {
    if (cursor && isObjId(cursor)) {
      for (const e of await fetchSince(principal, cursor, 500)) { send(e); cursor = e.id; }
    } else {
      cursor = await latestCursor(principal);
    }
  } catch (_) {}
  send({ type: '__connected', vendorId: principal.vendorId, cursor, at: new Date().toISOString() });

  const poll = setInterval(async () => {
    if (closed) return;
    try {
      for (const e of await fetchSince(principal, cursor, 200)) { send(e); cursor = e.id; }
    } catch (_) {}
  }, POLL_MS);

  // Heartbeat — drop dead connections.
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  const hb = setInterval(() => {
    if (closed) return;
    if (!ws.isAlive) { try { ws.terminate(); } catch (_) {} return; }
    ws.isAlive = false;
    try { ws.ping(); } catch (_) {}
  }, 30000);

  ws.on('message', (raw) => {
    try {
      const m = JSON.parse(raw.toString());
      if (m && m.type === 'ping') send({ type: 'pong', at: new Date().toISOString() });
    } catch (_) {}
  });

  const cleanup = () => { closed = true; clearInterval(poll); clearInterval(hb); };
  ws.on('close', cleanup);
  ws.on('error', cleanup);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[ws-gateway] HTTP+WS on 127.0.0.1:${PORT}, path ${PATHNAME}, poll ${POLL_MS}ms`);
});
process.on('unhandledRejection', (e) => console.error('[ws-gateway] unhandledRejection', e && e.message));
