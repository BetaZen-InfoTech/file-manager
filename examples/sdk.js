/*
 * Tiny JavaScript SDK for the File Manager SaaS API.
 * No build step — drop this into any Node 18+ or modern browser project.
 *
 *   const fm = new FileManager({ apiKey: 'fmsk_...', baseUrl: 'https://files.yourdomain.com' });
 *   const file = await fm.upload(bucketId, fileBlob, { tags: ['invoice','2026'] });
 *   const link = await fm.createLink(file.id, { type: 'temporary', expiresIn: 600 });
 *   await fm.resetLinks(file.id);
 *   const jwt = await fm.issueJwt({ subject: 'partner', scopes: ['file:download'], expiresIn: 3600 });
 *
 * For session auth from a browser, omit `apiKey` — cookies are sent automatically.
 */

class FileManagerError extends Error {
  constructor(code, message, status) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export class FileManager {
  constructor({ apiKey, baseUrl = '' } = {}) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  _headers(extra = {}) {
    const h = { ...extra };
    if (this.apiKey) h['Authorization'] = `Bearer ${this.apiKey}`;
    return h;
  }

  async _fetch(path, init = {}) {
    const res = await fetch(`${this.baseUrl}/api/v1${path}`, {
      credentials: 'include',
      ...init,
      headers: this._headers(init.headers || {})
    });
    const ct = res.headers.get('content-type') || '';
    const body = ct.includes('json') ? await res.json() : await res.text();
    if (!res.ok) {
      const err = (body && body.error) || { code: 'HTTP_' + res.status, message: String(body) };
      throw new FileManagerError(err.code, err.message, res.status);
    }
    return body;
  }

  // ---- auth ----
  me() {
    return this._fetch('/auth/me');
  }

  // ---- buckets ----
  listBuckets() {
    return this._fetch('/buckets');
  }
  createBucket({ name, description, isPublic, settings }) {
    return this._fetch('/buckets', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, description, isPublic, settings })
    });
  }
  deleteBucket(bucketId) {
    return this._fetch(`/buckets/${bucketId}`, { method: 'DELETE' });
  }

  // ---- folders ----
  createFolder(bucketId, { name, parentId = null }) {
    return this._fetch(`/buckets/${bucketId}/folders`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, parentId })
    });
  }
  listFolders(bucketId, { showHidden = false, parentId = null } = {}) {
    const qs = new URLSearchParams();
    if (showHidden) qs.set('showHidden', 'true');
    if (parentId) qs.set('parentId', parentId);
    return this._fetch(`/buckets/${bucketId}/folders?${qs}`);
  }
  hideFolder(folderId) {
    return this._fetch(`/folders/${folderId}/hide`, { method: 'POST' });
  }
  unhideFolder(folderId) {
    return this._fetch(`/folders/${folderId}/unhide`, { method: 'POST' });
  }

  // ---- files ----
  async upload(bucketId, fileOrBlob, { name, folderId, tags, metadata } = {}) {
    const fd = new FormData();
    if (typeof fileOrBlob === 'string') {
      throw new TypeError('Pass a Blob/File, not a string');
    }
    fd.append('file', fileOrBlob, name);
    if (folderId) fd.append('folderId', folderId);
    if (tags && tags.length) fd.append('tags', tags.join(','));
    if (metadata) fd.append('metadata', JSON.stringify(metadata));
    return this._fetch(`/buckets/${bucketId}/files`, { method: 'POST', body: fd });
  }
  listFiles(bucketId, { folderId = null, showHidden = false, q = '', page = 1, limit = 50 } = {}) {
    const qs = new URLSearchParams({ page: String(page), limit: String(limit) });
    if (folderId) qs.set('folderId', folderId);
    if (showHidden) qs.set('showHidden', 'true');
    if (q) qs.set('q', q);
    return this._fetch(`/buckets/${bucketId}/files?${qs}`);
  }
  getFile(fileId) {
    return this._fetch(`/files/${fileId}`);
  }
  updateFile(fileId, patch) {
    return this._fetch(`/files/${fileId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(patch)
    });
  }
  downloadUrl(fileId) {
    return `${this.baseUrl}/api/v1/files/${fileId}/download`;
  }
  hideFile(fileId) {
    return this._fetch(`/files/${fileId}/hide`, { method: 'POST' });
  }
  unhideFile(fileId) {
    return this._fetch(`/files/${fileId}/unhide`, { method: 'POST' });
  }
  deleteFile(fileId) {
    return this._fetch(`/files/${fileId}`, { method: 'DELETE' });
  }
  restoreFile(fileId) {
    return this._fetch(`/files/${fileId}/restore`, { method: 'POST' });
  }

  // ---- links ----
  createLink(fileId, { type, expiresIn, neverExpire, maxDownloads, requiredScope, password }) {
    return this._fetch(`/files/${fileId}/links`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type, expiresIn, neverExpire, maxDownloads, requiredScope, password })
    });
  }
  listLinks(fileId) {
    return this._fetch(`/files/${fileId}/links`);
  }
  resetLinks(fileId, { types, regenerate = false } = {}) {
    return this._fetch(`/files/${fileId}/links/reset`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ types, regenerate })
    });
  }
  revokeLink(linkId) {
    return this._fetch(`/links/${linkId}`, { method: 'DELETE' });
  }

  // ---- api keys ----
  listApiKeys() {
    return this._fetch('/api-keys');
  }
  createApiKey({ name, permissions, bucketIds, expiresAt }) {
    return this._fetch('/api-keys', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, permissions, bucketIds, expiresAt })
    });
  }
  revokeApiKey(id) {
    return this._fetch(`/api-keys/${id}`, { method: 'DELETE' });
  }

  // ---- 3rd-party JWT ----
  issueJwt({ subject, scopes, bucketIds, expiresIn }) {
    return this._fetch('/jwt/issue', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ subject, scopes, bucketIds, expiresIn })
    });
  }
  revokeJwt(jti) {
    return this._fetch('/jwt/revoke', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jti })
    });
  }
}

export { FileManagerError };
export default FileManager;
