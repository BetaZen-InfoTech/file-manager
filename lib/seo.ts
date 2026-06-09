import { dbConnect } from './db';
import { PlatformSettings } from '@/models/PlatformSettings';

export interface SeoSettings {
  siteName: string;
  defaultTitle: string;
  titleTemplate: string; // must contain %s, e.g. "%s · File Manager"
  description: string;
  keywords: string[];
  canonicalBaseUrl: string;
  ogImageUrl: string;
  twitterHandle: string;
  themeColor: string;
  faviconUrl: string;
  organizationName: string;
  robotsIndex: boolean; // false → noindex,nofollow + Disallow: /
  updatedAt: Date | null;
}

function envBase(): string {
  return (
    process.env.APP_URL ||
    process.env.PUBLIC_URL_BASE ||
    'https://cdn.betazeninfotech.com'
  ).replace(/\/+$/, '');
}

export function seoDefaults(): SeoSettings {
  return {
    siteName: 'File Manager',
    defaultTitle: 'File Manager',
    titleTemplate: '%s · File Manager',
    description: 'Multi-tenant file manager — secure uploads and shareable links.',
    keywords: ['file manager', 'cdn', 'file sharing', 'secure links'],
    canonicalBaseUrl: envBase(),
    ogImageUrl: '/icons/512.png',
    twitterHandle: '',
    themeColor: '#0b0b0c',
    faviconUrl: '/icons/192.png',
    organizationName: 'BetaZen InfoTech',
    robotsIndex: true,
    updatedAt: null
  };
}

let cache: { value: SeoSettings; loadedAt: number } | null = null;
const CACHE_TTL_MS = 10_000;

export async function getSeo(): Promise<SeoSettings> {
  const now = Date.now();
  if (cache && now - cache.loadedAt < CACHE_TTL_MS) return cache.value;
  const defaults = seoDefaults();
  try {
    await dbConnect();
    const doc = await PlatformSettings.findOne({ key: 'seo' }).lean();
    const v = (doc?.value || {}) as Partial<SeoSettings>;
    const value: SeoSettings = {
      ...defaults,
      ...v,
      keywords: Array.isArray(v.keywords) ? v.keywords : defaults.keywords,
      robotsIndex: typeof v.robotsIndex === 'boolean' ? v.robotsIndex : defaults.robotsIndex,
      canonicalBaseUrl: (v.canonicalBaseUrl || defaults.canonicalBaseUrl).replace(/\/+$/, ''),
      updatedAt: doc?.updatedAt ? new Date(doc.updatedAt) : null
    };
    cache = { value, loadedAt: now };
    return value;
  } catch {
    // DB not reachable (e.g. build time) — fall back to defaults, don't crash render.
    return defaults;
  }
}

export async function setSeo(
  patch: Partial<SeoSettings>,
  updatedBy: string | null
): Promise<SeoSettings> {
  await dbConnect();
  const current = await getSeo();
  const merged: SeoSettings = { ...current, ...patch };
  // Persist only the editable fields (updatedAt is managed by mongoose timestamps).
  const store = {
    siteName: merged.siteName,
    defaultTitle: merged.defaultTitle,
    titleTemplate: merged.titleTemplate,
    description: merged.description,
    keywords: merged.keywords,
    canonicalBaseUrl: merged.canonicalBaseUrl,
    ogImageUrl: merged.ogImageUrl,
    twitterHandle: merged.twitterHandle,
    themeColor: merged.themeColor,
    faviconUrl: merged.faviconUrl,
    organizationName: merged.organizationName,
    robotsIndex: merged.robotsIndex
  };
  await PlatformSettings.findOneAndUpdate(
    { key: 'seo' },
    { $set: { value: store, updatedBy } },
    { upsert: true }
  );
  cache = null;
  return getSeo();
}
