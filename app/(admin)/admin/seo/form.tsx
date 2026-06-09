'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { SeoSettings } from '@/lib/seo';

export default function SeoForm({ initial }: { initial: SeoSettings }) {
  const router = useRouter();
  const [f, setF] = useState({
    siteName: initial.siteName,
    defaultTitle: initial.defaultTitle,
    titleTemplate: initial.titleTemplate,
    description: initial.description,
    keywords: (initial.keywords || []).join(', '),
    canonicalBaseUrl: initial.canonicalBaseUrl,
    ogImageUrl: initial.ogImageUrl,
    twitterHandle: initial.twitterHandle,
    themeColor: initial.themeColor,
    faviconUrl: initial.faviconUrl,
    organizationName: initial.organizationName,
    robotsIndex: initial.robotsIndex
  });
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  function set<K extends keyof typeof f>(k: K, v: (typeof f)[K]) {
    setF((prev) => ({ ...prev, [k]: v }));
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setStatus(null);
    const payload = {
      ...f,
      keywords: f.keywords
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    };
    const res = await fetch('/api/v1/admin/seo', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload)
    });
    setBusy(false);
    if (res.ok) {
      setStatus('Saved.');
      router.refresh();
    } else {
      const j = await res.json().catch(() => null);
      setStatus(j?.error?.message ? `Failed: ${j.error.message}` : 'Failed to save.');
    }
  }

  const Field = ({
    label,
    k,
    placeholder,
    hint
  }: {
    label: string;
    k: keyof typeof f;
    placeholder?: string;
    hint?: string;
  }) => (
    <div className="space-y-1">
      <label className="text-xs text-gray-400">{label}</label>
      <input
        className="input"
        value={String(f[k] ?? '')}
        placeholder={placeholder}
        onChange={(e) => set(k, e.target.value as never)}
      />
      {hint && <p className="text-[11px] text-gray-500">{hint}</p>}
    </div>
  );

  return (
    <form onSubmit={save} className="card space-y-4">
      <Field label="Site name" k="siteName" placeholder="File Manager" />
      <Field label="Default title" k="defaultTitle" placeholder="File Manager" />
      <Field
        label="Title template"
        k="titleTemplate"
        placeholder="%s · File Manager"
        hint="Used for sub-pages. Must contain %s (the page title)."
      />
      <div className="space-y-1">
        <label className="text-xs text-gray-400">Meta description</label>
        <textarea
          className="input min-h-[70px]"
          value={f.description}
          onChange={(e) => set('description', e.target.value)}
        />
      </div>
      <Field
        label="Keywords (comma-separated)"
        k="keywords"
        placeholder="file manager, cdn, sharing"
      />
      <Field
        label="Canonical base URL"
        k="canonicalBaseUrl"
        placeholder="https://cdn.betazeninfotech.com"
        hint="Used for canonical links, Open Graph URL, robots & sitemap."
      />
      <Field label="OG / social image URL" k="ogImageUrl" placeholder="/icons/512.png" />
      <Field label="Favicon URL" k="faviconUrl" placeholder="/icons/192.png" />
      <div className="grid grid-cols-2 gap-3">
        <Field label="Twitter handle" k="twitterHandle" placeholder="@betazen" />
        <Field label="Theme color" k="themeColor" placeholder="#0b0b0c" />
      </div>
      <Field label="Organization name" k="organizationName" placeholder="BetaZen InfoTech" />
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={f.robotsIndex}
          onChange={(e) => set('robotsIndex', e.target.checked)}
        />
        <span className="text-sm text-gray-200">
          Allow search engines to index the site (uncheck to add <code>noindex</code>)
        </span>
      </label>
      {status && <div className="text-xs text-gray-400">{status}</div>}
      <button className="btn w-full" disabled={busy}>
        {busy ? 'Saving…' : 'Save SEO settings'}
      </button>
    </form>
  );
}
