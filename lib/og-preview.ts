import { getSeo } from './seo';

// Social / link-unfurling crawlers that want Open Graph HTML, not the file bytes.
const CRAWLER_RE =
  /(facebookexternalhit|Facebot|Twitterbot|Slackbot|Slack-ImgProxy|Discordbot|WhatsApp|LinkedInBot|TelegramBot|Pinterest|redditbot|Googlebot|bingbot|Applebot|SkypeUriPreview|vkShare|Embedly|Quora Link Preview|outbrain|nuzzel|XING-contenttabreceiver|Google-PageRenderer|Iframely)/i;

export function isSocialCrawler(ua: string | null | undefined): boolean {
  return !!ua && CRAWLER_RE.test(ua);
}

function esc(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmtBytes(n: number): string {
  if (!n || n < 1024) return `${n || 0} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 10 ? 0 : 1)} ${units[i]}`;
}

/**
 * Renders a minimal HTML document carrying Open Graph + Twitter Card tags so a
 * shared download link unfurls into a rich preview. Served only to crawlers and
 * only for non-private, non-password links.
 */
export async function ogPreviewHtml(opts: {
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  pageUrl: string; // canonical URL of the link (no query)
}): Promise<string> {
  const seo = await getSeo();
  const isImage = /^image\//i.test(opts.mimeType);
  const title = opts.fileName;
  const desc = `${opts.mimeType || 'file'} · ${fmtBytes(opts.sizeBytes)} — shared via ${seo.siteName}`;
  // For images, point og:image at the file itself via ?raw=1 (bypasses this branch).
  const rawImg = isImage ? `${opts.pageUrl}?raw=1` : null;
  let img = rawImg || seo.ogImageUrl || '';
  if (img && !/^https?:\/\//i.test(img)) img = `${seo.canonicalBaseUrl}${img}`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}" />
<link rel="canonical" href="${esc(opts.pageUrl)}" />
<meta property="og:type" content="${isImage ? 'image' : 'website'}" />
<meta property="og:site_name" content="${esc(seo.siteName)}" />
<meta property="og:title" content="${esc(title)}" />
<meta property="og:description" content="${esc(desc)}" />
<meta property="og:url" content="${esc(opts.pageUrl)}" />
${img ? `<meta property="og:image" content="${esc(img)}" />` : ''}
<meta name="twitter:card" content="${isImage ? 'summary_large_image' : 'summary'}" />
${seo.twitterHandle ? `<meta name="twitter:site" content="${esc(seo.twitterHandle)}" />` : ''}
<meta name="twitter:title" content="${esc(title)}" />
<meta name="twitter:description" content="${esc(desc)}" />
${img ? `<meta name="twitter:image" content="${esc(img)}" />` : ''}
</head>
<body style="font-family:system-ui,sans-serif;background:#0b0b0c;color:#e5e5e5;text-align:center;padding:48px">
<h1 style="font-size:18px">${esc(title)}</h1>
<p style="color:#9ca3af">${esc(desc)}</p>
<p><a href="${esc(opts.pageUrl)}?raw=1" style="color:#60a5fa">Download</a></p>
</body>
</html>`;
}
