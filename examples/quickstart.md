# Vendor API quickstart

A vendor should be able to integrate in 5 minutes. Pick your auth flavour and copy.

## 1. Authentication

Create an API key in the Vendor panel → API keys. Use it in `Authorization: Bearer ...`:

```bash
export FMS="https://files.yourdomain.com"
export KEY="fmsk_xxx"
```

## 2. Create a bucket

```bash
curl -X POST "$FMS/api/v1/buckets" \
  -H "Authorization: Bearer $KEY" -H "content-type: application/json" \
  -d '{"name":"invoices","description":"Invoices for 2026"}'
```

## 3. Upload a file (returns `id` + full details)

```bash
curl -X POST "$FMS/api/v1/buckets/$BID/files" \
  -H "Authorization: Bearer $KEY" \
  -F "file=@invoice.pdf" \
  -F "tags=invoice,2026"
```

Response:
```json
{
  "id": "66f...e21",
  "originalName": "invoice.pdf",
  "mimeType": "application/pdf",
  "sizeBytes": 482113,
  "extension": "pdf",
  "checksum": { "sha256": "a1b2..." },
  "bucketId": "...",
  "tags": ["invoice","2026"],
  "version": 1,
  "status": "ready",
  "createdAt": "2026-06-02T10:11:12Z"
}
```

## 4. Three link types

### Public (anyone with URL)
```bash
curl -X POST "$FMS/api/v1/files/$FID/links" \
  -H "Authorization: Bearer $KEY" -H "content-type: application/json" \
  -d '{"type":"public","neverExpire":true}'
```

### Temporary (1 minute → unlimited)
```bash
curl -X POST "$FMS/api/v1/files/$FID/links" \
  -H "Authorization: Bearer $KEY" -H "content-type: application/json" \
  -d '{"type":"temporary","expiresIn":600}'   # 10 minutes
```

### Private — JWT-Token-Auth
```bash
# Step A — vendor issues a scoped JWT for a partner
curl -X POST "$FMS/api/v1/jwt/issue" \
  -H "Authorization: Bearer $KEY" -H "content-type: application/json" \
  -d '{"subject":"partner-crm","scopes":["file:download"],"expiresIn":3600}'
# → { token: "...", expiresAt: ... }

# Step B — create the private link
curl -X POST "$FMS/api/v1/files/$FID/links" \
  -H "Authorization: Bearer $KEY" -H "content-type: application/json" \
  -d '{"type":"private","expiresIn":3600,"requiredScope":"file:download"}'
# → accessUrl: https://.../d/AbCd...

# Step C — partner downloads with the JWT
curl -fL -H "Authorization: Bearer $JWT" "https://.../d/AbCd..."
```

## 5. Reset (revoke) ALL links for a file

```bash
curl -X POST "$FMS/api/v1/files/$FID/links/reset" \
  -H "Authorization: Bearer $KEY" -H "content-type: application/json" \
  -d '{}'
```

Or revoke only certain types:
```bash
-d '{"types":["public","temporary"]}'
```

Or revoke + regenerate fresh tokens for each:
```bash
-d '{"regenerate":true}'
```

## 6. Hide / unhide (manual + API)

```bash
# folder
curl -X POST "$FMS/api/v1/folders/$FOLDER_ID/hide"   -H "Authorization: Bearer $KEY"
curl -X POST "$FMS/api/v1/folders/$FOLDER_ID/unhide" -H "Authorization: Bearer $KEY"

# file
curl -X POST "$FMS/api/v1/files/$FID/hide"           -H "Authorization: Bearer $KEY"
curl -X POST "$FMS/api/v1/files/$FID/unhide"         -H "Authorization: Bearer $KEY"
```

Hidden items don't appear in default lists. Show them with `?showHidden=true`.

## 7. JavaScript SDK

```js
import FileManager from './examples/sdk.js';
const fm = new FileManager({ apiKey: 'fmsk_xxx', baseUrl: 'https://files.yourdomain.com' });

const buckets = await fm.listBuckets();
const file    = await fm.upload(buckets.items[0]._id, blob, { tags: ['demo'] });
const link    = await fm.createLink(file.id, { type: 'temporary', expiresIn: 600 });
console.log(link.accessUrl);
await fm.resetLinks(file.id);
```

## 8. Rate limit + error shape

Every response with a non-2xx code:
```json
{ "error": { "code": "FORBIDDEN", "message": "..." } }
```

Codes you'll see most:
- `UNAUTHORIZED` — missing / invalid auth
- `FORBIDDEN` — auth ok but missing scope
- `VENDOR_SUSPENDED` — your vendor is suspended (uploads + downloads + links blocked)
- `QUOTA_EXCEEDED` — storage quota hit
- `BAD_REQUEST` — validation failure (see `issues[]`)
- `MAINTENANCE` — platform in maintenance mode (admins only)
- `EXPIRED` / `REVOKED` / `LIMIT_REACHED` — link is no longer usable

OpenAPI spec: `GET /api/v1/openapi.json` · Swagger UI: `/docs`.
