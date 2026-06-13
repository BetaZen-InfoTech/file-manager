import { NextRequest, NextResponse } from 'next/server';
import { Readable } from 'stream';
import argon2 from 'argon2';
import { dbConnect } from './db';
import { storage } from './storage';
import { isLinkUsable, canAccessPrivateLink } from './links';
import { verifyThirdPartyJwt } from './jwt';
import { audit } from './audit';
import { jsonError } from './http';
import { Link } from '@/models/Link';
import { FileModel } from '@/models/File';
import { Vendor } from '@/models/Vendor';
import { JwtRevocation } from '@/models/JwtRevocation';
import { getMaintenance } from './maintenance';
import { isSocialCrawler, ogPreviewHtml } from './og-preview';
import type { LinkType } from '@/models/Link';

export async function handleLinkDownload(
  req: NextRequest,
  token: string,
  expectedType: LinkType
): Promise<Response> {
  const m = await getMaintenance();
  if (m.enabled) return jsonError('MAINTENANCE', m.message, 503);

  await dbConnect();
  const link = await Link.findOne({ token });
  if (!link || link.type !== expectedType) {
    return jsonError('NOT_FOUND', 'link not found', 404);
  }

  // Suspension comes first — a suspended vendor's links must be inert
  // even if the link itself is still valid (§9 of the spec).
  const vendor = await Vendor.findById(link.vendorId).lean();
  if (!vendor) return jsonError('NOT_FOUND', 'vendor not found', 404);
  if (vendor.status === 'suspended') {
    return jsonError('VENDOR_SUSPENDED', 'This vendor is suspended.', 403);
  }

  const verdict = isLinkUsable(
    {
      type: link.type,
      status: link.status as any,
      expiresAt: link.expiresAt,
      maxDownloads: link.maxDownloads,
      downloadCount: link.downloadCount
    },
    new Date()
  );
  if (verdict === 'REVOKED') return jsonError('REVOKED', 'link revoked', 410);
  if (verdict === 'EXPIRED') {
    if (link.status !== 'expired') {
      link.status = 'expired';
      await link.save();
    }
    return jsonError('EXPIRED', 'link expired', 410);
  }
  if (verdict === 'LIMIT_REACHED')
    return jsonError('LIMIT_REACHED', 'download limit reached', 410);
  if (verdict !== 'OK') return jsonError('UNAVAILABLE', 'unavailable', 410);

  // Social-crawler rich preview (Open Graph). Only for shareable, non-secret
  // links: public/temporary, no password, and not the explicit ?raw=1 fetch.
  // This serves HTML metadata instead of the bytes and does NOT count as a
  // download. Private/password links never leak a preview.
  const reqUrl = new URL(req.url);
  const isRaw = reqUrl.searchParams.get('raw') === '1';
  if (
    !isRaw &&
    link.type !== 'private' &&
    !link.passwordHash &&
    isSocialCrawler(req.headers.get('user-agent'))
  ) {
    const previewFile = await FileModel.findOne({
      _id: link.fileId,
      vendorId: link.vendorId,
      status: 'ready'
    })
      .select('originalName mimeType sizeBytes')
      .lean();
    if (previewFile) {
      const pageUrl = `${reqUrl.origin}${reqUrl.pathname}`;
      const html = await ogPreviewHtml({
        fileName: previewFile.originalName,
        mimeType: previewFile.mimeType,
        sizeBytes: previewFile.sizeBytes,
        pageUrl
      });
      return new NextResponse(html, {
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=300' }
      });
    }
  }

  if (link.passwordHash) {
    // Accept the password only via header (never the query string — a ?p= value
    // leaks into proxy/CDN logs, browser history, and the Referer header).
    const pwd = req.headers.get('x-link-password') || '';
    const ok = pwd ? await argon2.verify(link.passwordHash, pwd).catch(() => false) : false;
    if (!ok) return jsonError('PASSWORD_REQUIRED', 'password required', 401);
  }

  // Carries the verified third-party JWT (private links) so its bucket scope can
  // be enforced once the file — and therefore the file's bucket — is known.
  let privateJwt: { vendorId: string; scopes: string[]; bucketIds?: string[] } | null = null;
  if (link.type === 'private') {
    const auth = req.headers.get('authorization') || '';
    const bearer = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : '';
    const jwt = bearer && !bearer.startsWith('fmsk_') ? await verifyThirdPartyJwt(bearer) : null;
    const access = canAccessPrivateLink({
      link: { vendorId: String(link.vendorId), requiredScope: link.requiredScope },
      jwt: jwt ? { vendorId: jwt.vendorId, scopes: jwt.scopes } : null
    });
    if (access === 'NO_TOKEN') return jsonError('NO_TOKEN', 'jwt required', 401);
    if (access === 'WRONG_TENANT')
      return jsonError('WRONG_TENANT', 'token from other vendor', 403);
    if (access === 'MISSING_SCOPE') return jsonError('MISSING_SCOPE', 'missing scope', 403);
    if (jwt?.jti) {
      const revoked = await JwtRevocation.findOne({ jti: jwt.jti, vendorId: jwt.vendorId }).lean();
      if (revoked) return jsonError('REVOKED', 'jwt revoked', 401);
    }
    privateJwt = jwt;
  }

  const file = await FileModel.findOne({
    _id: link.fileId,
    vendorId: link.vendorId,
    status: 'ready'
  }).lean();
  if (!file) return jsonError('NOT_FOUND', 'file not found', 404);

  // Enforce the JWT's bucket scope (a token scoped to specific buckets must not
  // download a private link pointing at a file in a different bucket).
  if (privateJwt?.bucketIds && privateJwt.bucketIds.length > 0) {
    if (!privateJwt.bucketIds.includes(String(file.bucketId))) {
      return jsonError('WRONG_BUCKET', "token is not scoped to this file's bucket", 403);
    }
  }

  // Atomically consume one download slot. This — not the earlier snapshot check —
  // is the real maxDownloads gate; the conditional $inc closes the TOCTOU where
  // concurrent requests on a 1-download link would all pass a stale count read.
  const consumed = await Link.findOneAndUpdate(
    {
      _id: link._id,
      status: 'active',
      $or: [{ maxDownloads: null }, { $expr: { $lt: ['$downloadCount', '$maxDownloads'] } }]
    },
    { $inc: { downloadCount: 1 } },
    { new: true }
  );
  if (!consumed) return jsonError('LIMIT_REACHED', 'download limit reached', 410);

  // Stream the bytes THROUGH the app rather than 302-redirecting to a presigned
  // storage URL — the object store is internal (127.0.0.1) and unreachable by the
  // visitor, so a redirect breaks. Streaming serves it from this public host.
  const obj = await storage.getObject(file.storageKey);

  await audit(null, req, {
    action: `link.download.${link.type}`,
    resourceType: 'link',
    resourceId: String(link._id),
    vendorId: String(link.vendorId),
    meta: { fileId: String(file._id) }
  });

  const fileName = (file.originalName.split(/[\\/]/).pop() || 'download').replace(/"/g, '');
  const headers: Record<string, string> = {
    'content-type': obj.contentType || file.mimeType || 'application/octet-stream',
    'content-disposition': `inline; filename="${encodeURIComponent(fileName)}"`,
    'cache-control': 'private, no-store',
    'accept-ranges': 'bytes'
  };
  const len = obj.contentLength ?? file.sizeBytes;
  if (len) headers['content-length'] = String(len);
  const node = obj.stream as any;
  req.signal.addEventListener('abort', () => node?.destroy?.());
  const web = Readable.toWeb(node) as ReadableStream<Uint8Array>;
  return new NextResponse(web, { status: 200, headers });
}
