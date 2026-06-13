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
      },
      {
        id: 'folders-move',
        method: 'PATCH',
        path: '/folders/:id',
        summary: 'Move folder',
        description: 'Move a folder under a new parent (same bucket). Descendant paths are updated automatically.',
        auth: 'apikey',
        pathParams: [{ name: 'id', desc: 'Folder id', required: true }],
        body: { parentId: '<targetFolderId>' }
      },
      {
        id: 'folders-hide',
        method: 'POST',
        path: '/folders/:id/hide',
        summary: 'Hide folder',
        description: 'Hide a folder (and exclude it from default listings).',
        auth: 'apikey',
        pathParams: [{ name: 'id', desc: 'Folder id', required: true }]
      },
      {
        id: 'folders-unhide',
        method: 'POST',
        path: '/folders/:id/unhide',
        summary: 'Unhide folder',
        description: 'Reverse a previous folder hide.',
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
        description: 'Restore a trashed file back to "ready". Re-checks quota and suspension.',
        auth: 'apikey',
        pathParams: [{ name: 'id', desc: 'File id', required: true }]
      },
      {
        id: 'files-copy',
        method: 'POST',
        path: '/files/:id/copy',
        summary: 'Copy file',
        description:
          'Duplicate a file within the same bucket (optionally into a folder, with a new name). Storage-cheap — the underlying object is shared (de-duplicated), so the copy is instant.',
        auth: 'apikey',
        pathParams: [{ name: 'id', desc: 'Source file id', required: true }],
        body: { folderId: null, name: 'Copy of report.pdf' }
      },
      {
        id: 'files-content-get',
        method: 'GET',
        path: '/files/:id/content',
        summary: 'Read text content',
        description: 'Return the UTF-8 contents of a text file (≤ 1 MB) for inline editing.',
        auth: 'apikey',
        pathParams: [{ name: 'id', desc: 'File id', required: true }]
      },
      {
        id: 'files-content-put',
        method: 'PUT',
        path: '/files/:id/content',
        summary: 'Edit text content',
        description:
          'Overwrite a text file with new contents (≤ 5 MB). Writes a new version of the object and reclaims the old one. Enforces the per-file size cap.',
        auth: 'apikey',
        pathParams: [{ name: 'id', desc: 'File id', required: true }],
        body: { content: 'updated file contents…' }
      },
      {
        id: 'files-hide',
        method: 'POST',
        path: '/files/:id/hide',
        summary: 'Hide file',
        description: 'Hide a file from default listings (still accessible by id). Use showHidden=true to list it.',
        auth: 'apikey',
        pathParams: [{ name: 'id', desc: 'File id', required: true }]
      },
      {
        id: 'files-unhide',
        method: 'POST',
        path: '/files/:id/unhide',
        summary: 'Unhide file',
        description: 'Reverse a previous hide.',
        auth: 'apikey',
        pathParams: [{ name: 'id', desc: 'File id', required: true }]
      },
      {
        id: 'files-extract',
        method: 'POST',
        path: '/files/:id/extract',
        summary: 'Extract a .zip',
        description:
          'Unzip an uploaded archive into the bucket, recreating its folder structure. Guards against zip-bombs (≤ 2 GB uncompressed) and path traversal. Optionally extract into a target folder.',
        auth: 'apikey',
        pathParams: [{ name: 'id', desc: 'Zip file id', required: true }],
        body: { folderId: null }
      },
      {
        id: 'files-blank',
        method: 'POST',
        path: '/buckets/:bid/files/blank',
        summary: 'Create a (text) file',
        description: 'Create a new file from inline text content (≤ 5 MB) without a multipart upload — handy for notes, configs, READMEs.',
        auth: 'apikey',
        pathParams: [{ name: 'bid', desc: 'Bucket id', required: true }],
        body: { name: 'notes.txt', content: 'hello world', folderId: null }
      },
      {
        id: 'files-archive',
        method: 'POST',
        path: '/buckets/:bid/archive',
        summary: 'Zip files into an archive',
        description:
          'Create a .zip from selected files and/or folders and store it back in the bucket. Total source ≤ 1 GB.',
        auth: 'apikey',
        pathParams: [{ name: 'bid', desc: 'Bucket id', required: true }],
        body: { name: 'export.zip', fileIds: ['<fileId>'], folderIds: [], folderId: null }
      }
    ]
  },
  {
    name: 'Large uploads (multipart)',
    blurb: 'For big files, upload in parts: init → upload each part → complete. Abort to cancel.',
    endpoints: [
      {
        id: 'mp-init',
        method: 'POST',
        path: '/files/multipart/init',
        summary: 'Start multipart upload',
        description:
          'Begin a multipart upload. Returns an uploadId + storage key. Quota and per-file/bucket size limits are checked here and again on complete.',
        auth: 'apikey',
        body: { bucketId: '<bucketId>', originalName: 'big-video.mp4', mimeType: 'video/mp4', sizeBytes: 524288000 }
      },
      {
        id: 'mp-part',
        method: 'PUT',
        path: '/files/multipart/:uploadId/part/:n',
        summary: 'Upload a part',
        description: 'Upload part number :n (1–10000) as the raw request body. Returns the part ETag — collect these for "complete".',
        auth: 'apikey',
        pathParams: [
          { name: 'uploadId', desc: 'From init', required: true },
          { name: 'n', desc: 'Part number (1-based)', required: true }
        ]
      },
      {
        id: 'mp-complete',
        method: 'POST',
        path: '/files/multipart/:uploadId/complete',
        summary: 'Complete upload',
        description:
          'Finalize the object from its uploaded parts. The server reads the authoritative stored size (HeadObject) and re-checks quota/limits before marking the file ready.',
        auth: 'apikey',
        pathParams: [{ name: 'uploadId', desc: 'From init', required: true }],
        body: { parts: [{ PartNumber: 1, ETag: '"<etag>"' }] }
      },
      {
        id: 'mp-abort',
        method: 'POST',
        path: '/files/multipart/:uploadId/abort',
        summary: 'Abort upload',
        description: 'Cancel an in-progress multipart upload and release its uploaded parts.',
        auth: 'apikey',
        pathParams: [{ name: 'uploadId', desc: 'From init', required: true }]
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
    name: 'File manager (your private folder)',
    blurb:
      'A private, jailed filesystem area per vendor. Every path is relative to your home folder — you can never reach a parent, the server root, or another vendor.',
    endpoints: [
      {
        id: 'fs-list',
        method: 'GET',
        path: '/fs',
        summary: 'List a directory',
        description: 'List the contents of a path inside your private folder. Defaults to the root ("/").',
        auth: 'apikey',
        query: [{ name: 'path', desc: 'Directory to list (relative, e.g. /docs)' }]
      },
      {
        id: 'fs-op',
        method: 'POST',
        path: '/fs',
        summary: 'File operation',
        description:
          'Run a filesystem action: mkdir, newfile, write, rename, delete, copy, chmod, zip, extract. All paths are confined to your folder.',
        auth: 'apikey',
        body: { action: 'mkdir', path: '/reports' }
      },
      {
        id: 'fs-read',
        method: 'GET',
        path: '/fs/read',
        summary: 'Read a text file',
        description: 'Return the UTF-8 contents of a text file (≤ 2 MB) inside your folder.',
        auth: 'apikey',
        query: [{ name: 'path', desc: 'File path (relative)', required: true }]
      },
      {
        id: 'fs-download',
        method: 'GET',
        path: '/fs/download',
        summary: 'Download a file',
        description: 'Stream any file from your folder as an attachment.',
        auth: 'apikey',
        query: [{ name: 'path', desc: 'File path (relative)', required: true }]
      },
      {
        id: 'fs-upload',
        method: 'POST',
        path: '/fs/upload',
        summary: 'Upload into a folder',
        description: 'Upload a file (multipart/form-data) into a directory of your private folder. Fields: "dir" + "file".',
        auth: 'apikey',
        multipart: true
      }
    ]
  },
  {
    name: 'Shareable download URLs',
    blurb:
      'Public-facing URLs returned by "Create link". These live at the site root (NOT under /api/v1) and need no API key — open them in a browser. Private links require a 3rd-party JWT.',
    endpoints: [
      {
        id: 'dl-public',
        method: 'GET',
        path: '/p/:token',
        summary: 'Public download',
        description: 'Open a public link. 302-redirects to a short-lived presigned URL. Base = site root, e.g. https://cdn.betazeninfotech.com/p/:token',
        auth: 'public',
        pathParams: [{ name: 'token', desc: 'Public link token', required: true }]
      },
      {
        id: 'dl-temp',
        method: 'GET',
        path: '/t/:token',
        summary: 'Temporary download',
        description: 'Open a time-limited link; 410 once expired or over maxDownloads.',
        auth: 'public',
        pathParams: [{ name: 'token', desc: 'Temporary link token', required: true }]
      },
      {
        id: 'dl-private',
        method: 'GET',
        path: '/d/:token',
        summary: 'Private download (JWT)',
        description:
          'Open a private link. Send Authorization: Bearer <3rd-party JWT> with the matching scope (and bucket scope) for the file.',
        auth: 'apikey',
        pathParams: [{ name: 'token', desc: 'Private link token', required: true }]
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

// The docs portal, Postman export, and OpenAPI present ONLY what an API-key
// integrator can call: vendor key endpoints + the public/JWT download URLs that
// serve the links you create. Session-only bootstrap (auth) and admin/platform
// endpoints are excluded — they aren't usable with an `fmsk_` token.
// Account / credential / billing management is NOT an API-key action — API keys
// can't create or revoke keys/JWTs or run checkout, so these are hidden from the
// key-scoped docs (and their scopes are removed from the key picker).
const ACCOUNT_ENDPOINTS = new Set(['keys-list', 'keys-create', 'keys-revoke', 'jwt-issue', 'jwt-revoke', 'billing-checkout']);
export function isVendorApiEndpoint(ep: ApiEndpoint): boolean {
  if (ep.auth === 'admin') return false;
  if (ACCOUNT_ENDPOINTS.has(ep.id)) return false;
  if (ep.auth === 'apikey') return true;
  return ['dl-public', 'dl-temp', 'dl-private'].includes(ep.id);
}
export const VENDOR_API_GROUPS: ApiGroup[] = API_GROUPS
  .map((g) => ({ ...g, endpoints: g.endpoints.filter(isVendorApiEndpoint) }))
  .filter((g) => g.endpoints.length > 0);
export const VENDOR_API_ENDPOINTS: ApiEndpoint[] = VENDOR_API_GROUPS.flatMap((g) => g.endpoints);

export const METHOD_COLORS: Record<Method, string> = {
  GET: 'text-emerald-300 border-emerald-500/40 bg-emerald-500/10',
  POST: 'text-sky-300 border-sky-500/40 bg-sky-500/10',
  PATCH: 'text-amber-300 border-amber-500/40 bg-amber-500/10',
  PUT: 'text-amber-300 border-amber-500/40 bg-amber-500/10',
  DELETE: 'text-rose-300 border-rose-500/40 bg-rose-500/10'
};

// ---- API-key scopes -------------------------------------------------------
// The RBAC permission each endpoint enforces (mirrors the `can(p, '…')` checks
// in the route handlers). Drives BOTH the per-endpoint scope badge in the docs
// and the scope picker when creating an API key — so they can never drift.
// Endpoints not listed need only a valid key/session (e.g. the file manager and
// shareable URLs), or are admin/public.
export const ENDPOINT_SCOPE: Record<string, string> = {
  // Buckets & folders
  'buckets-list': 'bucket:read',
  'buckets-create': 'bucket:create',
  'buckets-get': 'bucket:read',
  'buckets-update': 'bucket:update',
  'buckets-delete': 'bucket:delete',
  'folders-list': 'file:list',
  'folders-create': 'folder:create',
  'folders-rename': 'folder:update',
  'folders-delete': 'folder:update',
  'folders-move': 'folder:update',
  'folders-hide': 'folder:hide',
  'folders-unhide': 'folder:hide',
  // Files
  'files-list': 'file:list',
  'files-upload': 'file:upload',
  'files-get': 'file:read',
  'files-update': 'file:upload',
  'files-delete': 'file:delete',
  'files-download': 'file:download',
  'files-restore': 'file:delete',
  'files-copy': 'file:upload',
  'files-content-get': 'file:read',
  'files-content-put': 'file:upload',
  'files-hide': 'folder:hide',
  'files-unhide': 'folder:hide',
  'files-extract': 'file:upload',
  'files-blank': 'file:upload',
  'files-archive': 'file:read',
  // Multipart
  'mp-init': 'file:upload',
  'mp-part': 'file:upload',
  'mp-complete': 'file:upload',
  'mp-abort': 'file:upload',
  // Links
  'links-list': 'file:read',
  'links-create': 'publicurl:create',
  'links-reset': 'publicurl:revoke',
  'links-revoke': 'publicurl:revoke',
  // API keys & JWT (account)
  'keys-create': 'apikey:create',
  'keys-revoke': 'apikey:revoke',
  'jwt-issue': 'apikey:create',
  'jwt-revoke': 'apikey:revoke',
  // Billing
  'billing-checkout': 'settings:update'
};

export interface ScopeDef {
  id: string;
  label: string;
}
export interface ScopeGroup {
  group: string;
  scopes: ScopeDef[];
}

// Grouped, human-labelled scopes for the API-key creation UI. Covers every
// vendor permission an endpoint can require (see ENDPOINT_SCOPE).
export const SCOPE_GROUPS: ScopeGroup[] = [
  {
    group: 'Buckets',
    scopes: [
      { id: 'bucket:read', label: 'List & view buckets' },
      { id: 'bucket:create', label: 'Create buckets' },
      { id: 'bucket:update', label: 'Rename / change settings' },
      { id: 'bucket:delete', label: 'Delete buckets' }
    ]
  },
  {
    group: 'Files',
    scopes: [
      { id: 'file:list', label: 'List files & folders' },
      { id: 'file:read', label: 'View details / read text / list links' },
      { id: 'file:download', label: 'Download files' },
      { id: 'file:upload', label: 'Upload, edit, copy, extract, multipart' },
      { id: 'file:delete', label: 'Trash & restore files' }
    ]
  },
  {
    group: 'Folders',
    scopes: [
      { id: 'folder:create', label: 'Create folders' },
      { id: 'folder:update', label: 'Rename / move / delete folders' },
      { id: 'folder:hide', label: 'Hide / unhide files & folders' }
    ]
  },
  {
    group: 'Share links',
    scopes: [
      { id: 'publicurl:create', label: 'Create share links' },
      { id: 'publicurl:revoke', label: 'Reset / revoke links' }
    ]
  }
];

export const ALL_SCOPES: string[] = SCOPE_GROUPS.flatMap((g) => g.scopes.map((s) => s.id));

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

/** Build a Postman v2.1 collection from the catalog (descriptions + path vars). */
export function postmanCollection(baseUrl: string, token: string) {
  return {
    info: {
      name: 'BetaZen CDN — File Manager API',
      description:
        'Multi-tenant file manager API. Auth: send `Authorization: Bearer {{token}}` (an API key `fmsk_…` or a session/3rd-party JWT). Set the `baseUrl` and `token` collection variables, then run any request. Generated from the live API catalog.',
      schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json'
    },
    auth: { type: 'bearer', bearer: [{ key: 'token', value: '{{token}}', type: 'string' }] },
    variable: [
      { key: 'baseUrl', value: baseUrl, type: 'string' },
      { key: 'token', value: token || 'fmsk_xxx', type: 'string' }
    ],
    item: VENDOR_API_GROUPS.map((g) => ({
      name: g.name,
      description: g.blurb,
      item: g.endpoints.map((ep) => {
        const segments = ep.path.replace(/^\//, '').split('/');
        const headers: Array<Record<string, string>> = [];
        if (ep.auth !== 'public' && ep.auth !== 'webhook') {
          headers.push({ key: 'Authorization', value: 'Bearer {{token}}' });
        }
        if (ep.body && !ep.multipart) headers.push({ key: 'Content-Type', value: 'application/json' });
        const req: Record<string, unknown> = {
          method: ep.method,
          description: ep.description + (ENDPOINT_SCOPE[ep.id] ? `\n\nAPI-key scope required: ${ENDPOINT_SCOPE[ep.id]}` : ''),
          header: headers,
          url: {
            raw: `{{baseUrl}}${ep.path}`,
            host: ['{{baseUrl}}'],
            path: segments,
            ...(ep.pathParams && ep.pathParams.length
              ? {
                  variable: ep.pathParams.map((pp) => ({
                    key: pp.name,
                    value: `<${pp.name}>`,
                    description: pp.desc
                  }))
                }
              : {}),
            ...(ep.query && ep.query.length
              ? { query: ep.query.map((q) => ({ key: q.name, value: '', description: q.desc, disabled: true })) }
              : {})
          }
        };
        if (ep.multipart) {
          req.body = {
            mode: 'formdata',
            formdata: [
              { key: ep.id === 'fs-upload' ? 'dir' : 'file', value: ep.id === 'fs-upload' ? '/' : '', type: ep.id === 'fs-upload' ? 'text' : 'file', src: [] },
              ...(ep.id === 'fs-upload' ? [{ key: 'file', type: 'file', src: [] }] : [])
            ]
          };
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

/** Build an OpenAPI 3.0.3 document from the same catalog. */
export function openApiSpec(appUrl: string, sessionCookieName: string) {
  const paths: Record<string, any> = {};
  for (const ep of VENDOR_API_ENDPOINTS) {
    // Convert ":param" → "{param}" for OpenAPI path templating.
    const oaPath = ep.path.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
    paths[oaPath] = paths[oaPath] || {};
    const op: any = {
      tags: [API_GROUPS.find((g) => g.endpoints.includes(ep))?.name || 'API'],
      summary: ep.summary,
      description: ep.description + (ENDPOINT_SCOPE[ep.id] ? ` (API-key scope: ${ENDPOINT_SCOPE[ep.id]})` : ''),
      operationId: ep.id,
      security: ep.auth === 'public' || ep.auth === 'webhook' ? [] : [{ bearer: [] }, { cookie: [] }]
    };
    if (ENDPOINT_SCOPE[ep.id]) op['x-required-scope'] = ENDPOINT_SCOPE[ep.id];
    const params: any[] = [];
    for (const pp of ep.pathParams || []) {
      params.push({ name: pp.name, in: 'path', required: true, description: pp.desc, schema: { type: 'string' } });
    }
    for (const q of ep.query || []) {
      params.push({ name: q.name, in: 'query', required: !!q.required, description: q.desc, schema: { type: 'string' } });
    }
    if (params.length) op.parameters = params;
    if (ep.multipart) {
      op.requestBody = {
        required: true,
        content: { 'multipart/form-data': { schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } } } }
      };
    } else if (ep.body) {
      op.requestBody = {
        required: ep.method !== 'GET',
        content: { 'application/json': { schema: { type: 'object', example: ep.body } } }
      };
    }
    op.responses = { '200': { description: 'OK' }, '400': { description: 'Bad request' }, '401': { description: 'Unauthorized' } };
    paths[oaPath][ep.method.toLowerCase()] = op;
  }
  return {
    openapi: '3.0.3',
    info: {
      title: 'BetaZen CDN — File Manager API',
      version: '1.1.0',
      description:
        'Multi-tenant file manager. Authenticate with `Authorization: Bearer fmsk_…` (API key), a session cookie (UI), or a 3rd-party JWT for private downloads.'
    },
    servers: [{ url: appUrl + API_BASE }, { url: appUrl, description: 'Site root (shareable /p /t /d URLs)' }],
    components: {
      securitySchemes: {
        bearer: { type: 'http', scheme: 'bearer', bearerFormat: 'fmsk_xxx | jwt' },
        cookie: { type: 'apiKey', in: 'cookie', name: sessionCookieName }
      }
    },
    security: [{ bearer: [] }, { cookie: [] }],
    tags: VENDOR_API_GROUPS.map((g) => ({ name: g.name, description: g.blurb })),
    paths
  };
}
