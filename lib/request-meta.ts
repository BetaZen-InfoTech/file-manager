import type { NextRequest } from 'next/server';

export interface RequestMeta {
  ip: string | null;
  ipChain: string | null;
  method: string | null;
  url: string | null; // sanitized path + query
  host: string | null; // which server/domain served it
  referer: string | null;
  userAgent: string | null;
  country: string | null;
  city: string | null;
  region: string | null;
}

// Query params that must never be persisted (secrets that travel in the URL).
const SENSITIVE_QS = new Set(['p', 'password', 'pass', 'token', 'key', 'secret', 'jwt', 'apikey', 'api_key']);

function normalizeIp(ip: string): string {
  return ip.replace(/^::ffff:/i, '').trim();
}

export function clientIp(req: NextRequest): string | null {
  const xff = req.headers.get('x-forwarded-for');
  if (xff) {
    const first = xff.split(',')[0]?.trim();
    if (first) return normalizeIp(first);
  }
  const xreal = req.headers.get('x-real-ip');
  if (xreal) return normalizeIp(xreal);
  return null;
}

export function getRequestMeta(req: NextRequest): RequestMeta {
  let parsed: URL | null = null;
  try {
    parsed = new URL(req.url);
  } catch {
    parsed = null;
  }
  let url: string | null = null;
  if (parsed) {
    const qs = new URLSearchParams();
    parsed.searchParams.forEach((val, k) => qs.set(k, SENSITIVE_QS.has(k.toLowerCase()) ? '***' : val));
    const q = qs.toString();
    url = parsed.pathname + (q ? `?${q}` : '');
  }
  return {
    ip: clientIp(req),
    ipChain: req.headers.get('x-forwarded-for') || null,
    method: req.method || null,
    url,
    host: req.headers.get('host') || (parsed ? parsed.host : null),
    referer: req.headers.get('referer') || null,
    userAgent: req.headers.get('user-agent') || null,
    // Geo from a CDN/edge header when present (Cloudflare / Vercel / nginx geoip).
    country:
      req.headers.get('cf-ipcountry') ||
      req.headers.get('x-vercel-ip-country') ||
      req.headers.get('x-geo-country') ||
      null,
    city: req.headers.get('x-vercel-ip-city') || req.headers.get('x-geo-city') || null,
    region:
      req.headers.get('x-vercel-ip-country-region') || req.headers.get('x-geo-region') || null
  };
}

function isPublicIp(ip: string | null): ip is string {
  if (!ip) return false;
  if (ip === '127.0.0.1' || ip === '::1' || ip === 'localhost') return false;
  if (/^10\./.test(ip)) return false;
  if (/^192\.168\./.test(ip)) return false;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return false;
  if (/^169\.254\./.test(ip)) return false;
  if (/^(fc|fd|fe80)/i.test(ip)) return false;
  return true;
}

// Small in-memory cache so we don't hit the geo API for every request.
const geoCache = new Map<string, { country: string | null; city: string | null; region: string | null }>();

export async function lookupGeo(
  ip: string | null
): Promise<{ country: string | null; city: string | null; region: string | null } | null> {
  if (!isPublicIp(ip)) return null;
  if (geoCache.has(ip)) return geoCache.get(ip)!;
  if (process.env.AUDIT_GEOIP === '0') return null;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 2500);
    const r = await fetch(`https://ipapi.co/${encodeURIComponent(ip)}/json/`, {
      signal: ctrl.signal,
      headers: { 'user-agent': 'betazen-cdn-audit/1.0' }
    });
    clearTimeout(t);
    if (!r.ok) return null;
    const j: any = await r.json();
    if (j?.error) return null;
    const geo = {
      country: j.country_name || j.country || null,
      city: j.city || null,
      region: j.region || null
    };
    if (geoCache.size < 5000) geoCache.set(ip, geo);
    return geo;
  } catch {
    return null;
  }
}

/** Compact, human-readable "OS · Browser" from a user-agent string. */
export function summarizeUA(ua: string | null | undefined): string {
  if (!ua) return '';
  const os = /Windows NT 10/.test(ua)
    ? 'Windows'
    : /Windows/.test(ua)
      ? 'Windows'
      : /Android/.test(ua)
        ? 'Android'
        : /iPhone|iPad|iOS/.test(ua)
          ? 'iOS'
          : /Mac OS X/.test(ua)
            ? 'macOS'
            : /Linux/.test(ua)
              ? 'Linux'
              : '';
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /OPR\/|Opera/.test(ua)
      ? 'Opera'
      : /Chrome\//.test(ua)
        ? 'Chrome'
        : /Firefox\//.test(ua)
          ? 'Firefox'
          : /Safari\//.test(ua)
            ? 'Safari'
            : /curl\//i.test(ua)
              ? 'curl'
              : /node|axios|python|go-http/i.test(ua)
                ? 'API client'
                : '';
  return [os, browser].filter(Boolean).join(' · ') || ua.slice(0, 40);
}
