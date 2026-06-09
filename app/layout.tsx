import './globals.css';
import type { Metadata, Viewport } from 'next';
import { ReactNode } from 'react';
import { getSeo } from '@/lib/seo';

export async function generateMetadata(): Promise<Metadata> {
  const seo = await getSeo();
  return {
    metadataBase: new URL(seo.canonicalBaseUrl),
    title: { default: seo.defaultTitle, template: seo.titleTemplate },
    description: seo.description,
    keywords: seo.keywords,
    applicationName: seo.siteName,
    manifest: '/manifest.webmanifest',
    robots: seo.robotsIndex
      ? { index: true, follow: true }
      : { index: false, follow: false },
    appleWebApp: { capable: true, statusBarStyle: 'black-translucent', title: seo.siteName },
    icons: { icon: seo.faviconUrl, apple: seo.faviconUrl },
    openGraph: {
      type: 'website',
      siteName: seo.siteName,
      title: seo.defaultTitle,
      description: seo.description,
      url: seo.canonicalBaseUrl,
      images: seo.ogImageUrl ? [{ url: seo.ogImageUrl }] : undefined
    },
    twitter: {
      card: 'summary_large_image',
      title: seo.defaultTitle,
      description: seo.description,
      site: seo.twitterHandle || undefined,
      images: seo.ogImageUrl ? [seo.ogImageUrl] : undefined
    }
  };
}

export async function generateViewport(): Promise<Viewport> {
  const seo = await getSeo();
  return {
    themeColor: seo.themeColor,
    width: 'device-width',
    initialScale: 1,
    viewportFit: 'cover'
  };
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  const seo = await getSeo();
  return (
    <html lang="en">
      <head>
        <link rel="manifest" href="/manifest.webmanifest" />
        <meta name="theme-color" content={seo.themeColor} />
        <meta name="apple-mobile-web-app-capable" content="yes" />
      </head>
      <body>
        {children}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              if ('serviceWorker' in navigator) {
                window.addEventListener('load', () => {
                  navigator.serviceWorker.register('/sw.js').catch(() => {});
                });
              }
            `
          }}
        />
      </body>
    </html>
  );
}
