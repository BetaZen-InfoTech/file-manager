import { randomToken } from './crypto';
import { env } from './env';
import type { LinkType } from '@/models/Link';

export interface LinkRecord {
  type: LinkType;
  status: 'active' | 'revoked' | 'expired';
  expiresAt: Date | null;
  maxDownloads: number | null;
  downloadCount: number;
}

export type LinkVerdict = 'OK' | 'REVOKED' | 'EXPIRED' | 'LIMIT_REACHED' | 'NOT_FOUND';

export function isLinkUsable(link: LinkRecord | null, now: Date = new Date()): LinkVerdict {
  if (!link) return 'NOT_FOUND';
  if (link.status === 'revoked') return 'REVOKED';
  if (link.status === 'expired') return 'EXPIRED';
  if (link.expiresAt && new Date(link.expiresAt) <= now) return 'EXPIRED';
  if (link.maxDownloads !== null && link.downloadCount >= link.maxDownloads) return 'LIMIT_REACHED';
  return 'OK';
}

export function createLinkToken(): string {
  return randomToken(env.PUBLIC_TOKEN_BYTES);
}

export function linkUrl(type: LinkType, token: string, base: string = env.PUBLIC_URL_BASE): string {
  const trimmed = base.replace(/\/+$/, '');
  switch (type) {
    case 'public':
      return `${trimmed}/p/${token}`;
    case 'temporary':
      return `${trimmed}/t/${token}`;
    case 'private':
      return `${trimmed}/d/${token}`;
  }
}

export function clampExpiresIn(
  expiresInSeconds: number | null | undefined,
  neverExpire: boolean
): Date | null {
  if (neverExpire) return null;
  if (!expiresInSeconds || expiresInSeconds < 60) return new Date(Date.now() + 60_000);
  const MAX = 60 * 60 * 24 * 365 * 10;
  const clamped = Math.min(expiresInSeconds, MAX);
  return new Date(Date.now() + clamped * 1000);
}

export interface PrivateAccessInput {
  link: { vendorId: string; requiredScope: string };
  jwt: { vendorId: string; scopes: string[] } | null;
}

export type PrivateAccessVerdict = 'OK' | 'NO_TOKEN' | 'WRONG_TENANT' | 'MISSING_SCOPE';

export function canAccessPrivateLink(input: PrivateAccessInput): PrivateAccessVerdict {
  if (!input.jwt) return 'NO_TOKEN';
  if (input.jwt.vendorId !== input.link.vendorId) return 'WRONG_TENANT';
  if (!input.jwt.scopes.includes(input.link.requiredScope)) return 'MISSING_SCOPE';
  return 'OK';
}
