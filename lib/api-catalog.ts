// Single source of truth for the API docs page, the live test portal, and the
// downloadable Postman collection.

export type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE' | 'PUT';
export type Auth = 'apikey' | 'session' | 'admin' | 'public' | 'webhook';

export interface ApiParam {
  name: string;
  desc: string;
  required?: boolean;
}

export interface ApiEndpoint {
  id: string;
  method: Method;
  path: string; // relative to /api/v1, may contain :param
  summary: string;
  description: string;
  auth: Auth;
  pathParams?: ApiParam[];
  query?: ApiParam[];
  multipart?: boolean;
  body?: Record<string, unknown>; // example JSON body
}

export interface ApiGroup {
  name: string;
  blurb: string;
  endpoints: ApiEndpoint[];
}

export const API_BASE = '/api/v1';

export const AUTH_LABEL: Record<Auth, string> = {
  apikey: 'API key / session',
  session: 'Session',
  admin: 'Admin',
  public: 'Public',
  webhook: 'Webhook (HMAC)'
};

export const API_GROUPS: ApiGroup[] = [
  {
    name: 'Auth',
    blurb: 'Sign in to get a session cookie, or use an API key as a bearer token.',
    endpoints: [
      {
        id: 'auth-login',
        method: 'POST',
        path: '/auth/login',
        summary: 'Sign in',
        description: 'Authenticate with email + password. Sets an HTTP-only session cookie used by the UI.',
        auth: 'public',
        body: { email: 'admin@yourdomain.com', password: 'StrongPassword123' }
      },
      {
        id: 'auth-forgot',
        method: 'POST',
        path: '/auth/forgot-password',
        summary: 'Request password reset',
        description: 'Emails a single-use, 1-hour reset link. Always returns 200 (never reveals whether the email exists).',
        auth: 'public',
        body: { email: 'you@example.com' }
      },
      {
        id: 'auth-reset',
        method: 'POST',
        path: '/auth/reset-password',
        summary: 'Reset password',
        description: 'Set a new password using the token from the reset email.',
        auth: 'public',
        body: { token: '<token-from-email-link>', password: 'newStrongPassword' }
      },
      {
        id: 'auth-me',
        method: 'GET',
        path: '/auth/me',
        summary: 'Current principal',
        description: 'Returns the authenticated user/key: role, vendor, permissions.',
        auth: 'session'
      },
      {
        id: 'auth-logout',
        method: 'POST',
        path: '/auth/logout',
        summary: 'Sign out',
        description: 'Clears the session cookie.',
        auth: 'session'
      }
    ]
  },
  {
    name: 'Buckets & Folders',
    blurb: 'Containers for files. Every query is scoped to your vendor.',
    endpoints: [
      {
        id: 'buckets-list',
        method: 'GET',
        path: '/buckets',
        summary: 'List buckets',
        description: 'All buckets for the current vendor.',
        auth: 'apikey'
      },
      {
        id: 'buckets-create',
        method: 'POST',
        path: '/buckets',
        summary: 'Create bucket',
        description: 'Create a new bucket. Names are unique per vendor.',
        auth: 'apikey',
        body: { name: 'invoices', isPublic: false }
      },
      {
        id: 'buckets-get',
        method: 'GET',
        path: '/buckets/:bid',
        summary: 'Bucket details',
        description: 'Fetch one bucket by id.',
        auth: 'apikey',
        pathParams: [{ name: 'bid', desc: 'Bucket id', required: true }]
      },
      {
        id: 'buckets-update',
        method: 'PATCH',
        path: '/buckets/:bid',
        summary: 'Update bucket',
        description: 'Rename or change settings.',
        auth: 'apikey',
        pathParams: [{ name: 'bid', desc: 'Bucket id', required: true }],
        body: { name: 'invoices-2026' }
      },
      {
        id: 'buckets-delete',
        method: 'DELETE',
        path: '/buckets/:bid',
        summary: 'Delete bucket',
        description: 'Delete a bucket. It must be empty.',
        auth: 'apikey',
        pathParams: [{ name: 'bid', desc: 'Bucket id', required: true }]
      },
      {
        id: 'folders-list',
        method: 'GET',
        path: '/buckets/:bid/folders',
        summary: 'List folders',
        description: 'Folders in a bucket. Pass showHidden=true to include hidden folders.',
        auth: 'apikey',
        pathParams: [{ name: 'bid', desc: 'Bucket id', required: true }],
        query: [{ name: 'showHidden', desc: 'true to include hidden' }]
      },
      {
        id: 'folders-create',
        method: 'POST',
        path: '/buckets/:bid/folders',
        summary: 'Create folder',
        description: 'Create a folder (optionally nested via parentId).',
        auth: 'apikey',
        pathParams: [{ name: 'bid', desc: 'Bucket id', required: true }],
        body: { name: '2026', parentId: null }
      },
      {
        id: 'folders-rename',
        method: 'PATCH',
        path: '/folders/:id',
        summary: 'Rename folder',
        description: 'Rename a folder.',
        auth: 'apikey',
        pathParams: [{ name: 'id', desc: 'Folder id', required: true }],
        body: { name: 'archive' }
      },
      {
        id: 'folders-delete',
        method: 'DELETE',
        path: '/folders/:id',
        summary: 'Delete folder',
        description: 'Delete a folder. It must be empty.',
        auth: 'apikey',
        pathParams: [{ name: 'id', desc: 'Folder id', required: true }]
      }
    ]
  },
  {
    name: 'Files',
    blurb: 'Upload, fetch, update and download files. Uploads are multipart/form-data.',
    endpoints: [
      {
        id: 'files-list',
        method: 'GET',
        path: '/buckets/:bid/files',
        summary: 'List files',
        description: 'List files in a bucket. Filter by folderId or a text query q.',
        auth: 'apikey',
        pathParams: [{ name: 'bid', desc: 'Bucket id', required: true }],
        query: [
          { name: 'folderId', desc: 'Limit to a folder' },
          { name: 'q', desc: 'Text search on name/tags' }
        ]
      },
      {
        id: 'files-upload',
        method: 'POST',
        path: '/buckets/:bid/files',
        summary: 'Upload file',
        description: 'Upload a file (multipart/form-data, field name "file"). Returns the file id + full details.',
        auth: 'apikey',
        multipart: true,
        pathParams: [{ name: 'bid', desc: 'Bucket id', required: true }]
      },
      {
        id: 'files-get',
        method: 'GET',
        path: '/files/:id',
        summary: 'File details',
        description: 'Full metadata for a file (size, mime, checksum, tags, …).',
        auth: 'apikey',
        pathParams: [{ name: 'id', desc: 'File id', required: true }]
      },
      {
        id: 'files-update',
        method: 'PATCH',
        path: '/files/:id',
        summary: 'Update file',
        description: 'Rename or set tags / metadata.',
        auth: 'apikey',
        pathParams: [{ name: 'id', desc: 'File id', required: true }],
        body: { originalName: 'invoice-final.pdf', tags: ['paid', '2026'] }
      },
      {
        id: 'files-delete',
        method: 'DELETE',
        path: '/files/:id',
        summary: 'Trash file',
        description: 'Soft-delete (move to trash). Restore with /files/:id/restore.',
        auth: 'apikey',
        pathParams: [{ name: 'id', desc: 'File id', required: true }]
      },
      {
        id: 'files-download',
        method: 'GET',
        path: '/files/:id/download',
        summary: 'Download file',
        description: 'Redirects (302) to a short-lived presigned URL for the object.',
        auth: 'apikey',
        pathParams: [{ name: 'id', desc: 'File id', required: true }]
      },
      {
        id: 'files-restore',
        method: 'POST',
        path: '/files/:id/restore',
        summary: 'Restore from trash',
        description: 'Restore a trashed file.',
        auth: 'apikey',
        pathParams: [{ name: 'id', desc: 'File id', required: true }]
      }
    ]
  },
  {
    name: 'Links',
    blurb: 'Three shareable link types: public, temporary (auto-expiring), private (JWT-gated).',
    endpoints: [
      {
        id: 'links-list',
        method: 'GET',
        path: '/files/:id/links',
        summary: 'List links',
        description: 'Active links for a file.',
        auth: 'apikey',
        pathParams: [{ name: 'id', desc: 'File id', required: true }]
      },
      {
        id: 'links-create',
        method: 'POST',
        path: '/files/:id/links',
        summary: 'Create link',
        description: 'Create a public, temporary, or private link. expiresIn is seconds; maxDownloads and a password are optional.',
        auth: 'apikey',
        pathParams: [{ name: 'id', desc: 'File id', required: true }],
        body: { type: 'temporary', expiresIn: 3600, maxDownloads: 5 }
      },
      {
        id: 'links-reset',
        method: 'POST',
        path: '/files/:id/links/reset',
        summary: 'Reset all links',
        description: 'Revoke every active link for the file. Optionally regenerate fresh ones.',
        auth: 'apikey',
        pathParams: [{ name: 'id', desc: 'File id', required: true }],
        body: { regenerate: false }
      },
      {
        id: 'links-revoke',
        method: 'DELETE',
        path: '/links/:id',
        summary: 'Revoke link',
        description: 'Revoke a single link by id.',
        auth: 'apikey',
        pathParams: [{ name: 'id', desc: 'Link id', required: true }]
      }
    ]
  },
  {
    name: 'API keys & JWT',
    blurb: 'Programmatic credentials: long-lived API keys (fmsk_…) and short-lived 3rd-party JWTs.',
    endpoints: [
      {
        id: 'keys-list',
        method: 'GET',
        path: '/api-keys',
        summary: 'List API keys',
        description: 'Lists keys with their visible prefix only (never the secret).',
        auth: 'apikey'
      },
      {
        id: 'keys-create',
        method: 'POST',
        path: '/api-keys',
        summary: 'Create API key',
        description: 'Create a key with specific permissions. The plaintext key is shown ONCE in the response.',
        auth: 'apikey',
        body: { name: 'ci-uploader', permissions: ['file:upload', 'file:read'] }
      },
      {
        id: 'keys-revoke',
        method: 'DELETE',
        path: '/api-keys/:id',
        summary: 'Revoke API key',
        description: 'Permanently revoke a key.',
        auth: 'apikey',
        pathParams: [{ name: 'id', desc: 'API key id', required: true }]
      },
      {
        id: 'jwt-issue',
        method: 'POST',
        path: '/jwt/issue',
        summary: 'Issue 3rd-party JWT',
        description: 'Mint a scoped, expiring JWT for a partner. Use it as a Bearer token on private (/d/:token) downloads.',
        auth: 'apikey',
        body: { subject: 'partner-acme', scopes: ['file:download'], expiresIn: 3600 }
      },
      {
        id: 'jwt-revoke',
        method: 'POST',
        path: '/jwt/revoke',
        summary: 'Revoke JWT',
        description: 'Revoke a previously-issued JWT by its jti.',
        auth: 'apikey',
        body: { jti: '<jti-from-issued-token>' }
      }
    ]
  },
  {
    name: 'Plans & Billing',
    blurb: 'Subscription plans paid via Razorpay or PhonePe.',
    endpoints: [
      {
        id: 'plans-list',
        method: 'GET',
        path: '/plans',
        summary: 'List plans',
        description: 'Active subscription plans and which gateways are enabled.',
        auth: 'session'
      },
      {
        id: 'billing-checkout',
        method: 'POST',
        path: '/billing/checkout',
        summary: 'Start checkout',
        description: 'Create an order for a plan. Returns Razorpay order params or a PhonePe redirect URL. Vendor owner only.',
        auth: 'session',
        body: { planCode: 'pro', gateway: 'razorpay' }
      }
    ]
  },
  {
    name: 'Admin',
    blurb: 'Platform-admin endpoints. Require a super-admin / platform-staff session.',
    endpoints: [
      { id: 'admin-vendors', method: 'GET', path: '/admin/vendors', summary: 'List vendors', description: 'All vendors on the platform.', auth: 'admin' },
      { id: 'admin-vendor-create', method: 'POST', path: '/admin/vendors', summary: 'Create vendor', description: 'Provision a new tenant.', auth: 'admin', body: { name: 'Acme Co', slug: 'acme', plan: 'free' } },
      { id: 'admin-vendor-suspend', method: 'POST', path: '/admin/vendors/:id/suspend', summary: 'Suspend vendor', description: 'Suspend a tenant (blocks uploads/downloads/links).', auth: 'admin', pathParams: [{ name: 'id', desc: 'Vendor id', required: true }] },
      { id: 'admin-vendor-activate', method: 'POST', path: '/admin/vendors/:id/activate', summary: 'Activate vendor', description: 'Re-activate a suspended tenant.', auth: 'admin', pathParams: [{ name: 'id', desc: 'Vendor id', required: true }] },
      { id: 'admin-usage', method: 'GET', path: '/admin/usage', summary: 'Usage stats', description: 'Global storage/usage stats.', auth: 'admin' },
      { id: 'admin-audit', method: 'GET', path: '/admin/audit-logs', summary: 'Audit logs', description: 'Browse the audit trail.', auth: 'admin' },
      { id: 'admin-maintenance', method: 'POST', path: '/admin/maintenance', summary: 'Toggle maintenance', description: 'Enable/disable maintenance mode.', auth: 'admin', body: { enabled: true, message: 'Back soon.' } },
      { id: 'admin-seo', method: 'POST', path: '/admin/seo', summary: 'Update SEO', description: 'Update site SEO/meta settings.', auth: 'admin', body: { siteName: 'File Manager', robotsIndex: true } },
      { id: 'admin-payments', method: 'POST', path: '/admin/payments', summary: 'Gateway config', description: 'Configure Razorpay / PhonePe credentials (encrypted at rest).', auth: 'admin', body: { razorpay: { enabled: true, keyId: 'rzp_live_xxx', keySecret: 'secret' } } },
      { id: 'admin-database', method: 'POST', path: '/admin/database', summary: 'Update Mongo URI', description: 'Test (and apply) a new MONGODB_URI.', auth: 'admin', body: { action: 'test', uri: 'mongodb+srv://user:pass@cluster.mongodb.net/filemanager' } }
    ]
  }
];

export const ALL_ENDPOINTS: ApiEndpoint[] = API_GROUPS.flatMap((g) => g.endpoints);

export const METHOD_COLORS: Record<Method, string> = {
  GET: 'text-emerald-300 border-emerald-500/40 bg-emerald-500/10',
  POST: 'text-sky-300 border-sky-500/40 bg-sky-500/10',
  PATCH: 'text-amber-300 border-amber-500/40 bg-amber-500/10',
  PUT: 'text-amber-300 border-amber-500/40 bg-amber-500/10',
  DELETE: 'text-rose-300 border-rose-500/40 bg-rose-500/10'
};

// ---- generators -----------------------------------------------------------

export function curlFor(ep: ApiEndpoint, baseUrl: string, token: string): string {
  const url = `${baseUrl}${ep.path}`;
  const lines = [`curl -X ${ep.method} "${url}"`];
  if (ep.auth !== 'public' && ep.auth !== 'webhook') {
    lines.push(`  -H "Authorization: Bearer ${token || '<TOKEN>'}"`);
  }
  if (ep.multipart) {
    lines.push('  -F "file=@/path/to/file.pdf"');
  } else if (ep.body) {
    lines.push('  -H "Content-Type: application/json"');
    lines.push(`  -d '${JSON.stringify(ep.body)}'`);
  }
  return lines.join(' \\\n');
}

/** Build a Postman v2.1 collection from the catalog. */
export function postmanCollection(baseUrl: string, token: string) {
  return {
    info: {
      name: 'File Manager SaaS API',
      description: 'Auto-generated from the API docs. Set {{baseUrl}} and {{token}} in the collection variables.',
      schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json'
    },
    auth: { type: 'bearer', bearer: [{ key: 'token', value: '{{token}}', type: 'string' }] },
    variable: [
      { key: 'baseUrl', value: baseUrl },
      { key: 'token', value: token || 'fmsk_xxx' }
    ],
    item: API_GROUPS.map((g) => ({
      name: g.name,
      item: g.endpoints.map((ep) => {
        const segments = ep.path.replace(/^\//, '').split('/');
        const req: Record<string, unknown> = {
          method: ep.method,
          header: ep.body && !ep.multipart ? [{ key: 'Content-Type', value: 'application/json' }] : [],
          url: {
            raw: `{{baseUrl}}${ep.path}`,
            host: ['{{baseUrl}}'],
            path: segments,
            ...(ep.query && ep.query.length
              ? { query: ep.query.map((q) => ({ key: q.name, value: '', disabled: true })) }
              : {})
          }
        };
        if (ep.multipart) {
          req.body = { mode: 'formdata', formdata: [{ key: 'file', type: 'file', src: [] }] };
        } else if (ep.body) {
          req.body = {
            mode: 'raw',
            raw: JSON.stringify(ep.body, null, 2),
            options: { raw: { language: 'json' } }
          };
        }
        return { name: `${ep.method} ${ep.summary}`, request: req };
      })
    }))
  };
}
