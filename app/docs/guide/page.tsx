import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { Logo } from '@/components/Logo';
import { env } from '@/lib/env';
import {
  API_BASE,
  VENDOR_API_GROUPS,
  ENDPOINT_SCOPE,
  METHOD_COLORS,
  SCOPE_GROUPS,
  EVENT_TYPE_GROUPS,
  EVENT_SAMPLE
} from '@/lib/api-catalog';
import {
  GUIDE_TITLE,
  GUIDE_INTRO,
  AUTH_PROSE,
  SCOPE_PROSE,
  CONCEPTS,
  EVENTS_PROSE,
  ERRORS_PROSE,
  ERROR_CODES,
  quickstart,
  downloads,
  nodeClient
} from '@/lib/integration-guide';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'API Integration Guide',
  description: 'Full integration guide for 3rd-party software: authentication, all endpoints, share links, and the real-time event feed.'
};

const TOC = [
  ['authentication', '1. Authentication'],
  ['quick-start', '2. Quick start'],
  ['concepts', '3. Core concepts'],
  ['api-reference', '4. API reference'],
  ['events', '5. Real-time events'],
  ['errors', '6. Responses & errors'],
  ['downloads', '7. Tools & downloads']
];

function Code({ children }: { children: string }) {
  return (
    <pre className="overflow-x-auto rounded-md border border-border bg-black/40 p-3 font-mono text-[12px] leading-relaxed text-gray-200">
      {children}
    </pre>
  );
}

function H({ id, children }: { id: string; children: ReactNode }) {
  return (
    <h2 id={id} className="scroll-mt-20 border-b border-border pb-2 text-lg font-semibold text-white">
      {children}
    </h2>
  );
}

export default function GuidePage() {
  const appUrl = env.APP_URL;
  const base = `${appUrl}${API_BASE}`;
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 border-b border-border bg-bg/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-4 py-3">
          <Link href="/" className="flex items-center gap-2">
            <Logo className="h-7 w-7" />
            <span className="text-sm font-semibold text-white">Integration Guide</span>
          </Link>
          <div className="ml-auto flex flex-wrap items-center gap-2 text-xs">
            <Link className="chip hover:border-accent/50" href="/docs">⚡ API explorer</Link>
            <a className="chip hover:border-accent/50" href={`${API_BASE}/postman`}>⬇ Postman</a>
            <a className="chip hover:border-accent/50" href={`${API_BASE}/openapi`} target="_blank" rel="noreferrer">OpenAPI ↗</a>
            <a className="chip hover:border-accent/50" href="/docs/guide/raw">⬇ Markdown</a>
          </div>
        </div>
      </header>

      <div className="mx-auto flex max-w-6xl gap-8 px-4 py-8">
        {/* TOC */}
        <aside className="hidden w-52 shrink-0 lg:block">
          <nav className="sticky top-24 space-y-1 text-xs">
            <div className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-gray-500">On this page</div>
            {TOC.map(([id, label]) => (
              <a key={id} href={`#${id}`} className="block rounded-md px-2 py-1.5 text-gray-400 hover:bg-[#16161a] hover:text-white">
                {label}
              </a>
            ))}
          </nav>
        </aside>

        {/* content */}
        <main className="min-w-0 flex-1 space-y-10">
          <section className="space-y-3">
            <h1 className="text-2xl font-semibold text-white">{GUIDE_TITLE}</h1>
            <p className="text-sm leading-relaxed text-gray-400">{GUIDE_INTRO}</p>
            <div className="flex flex-wrap items-center gap-2 pt-1 text-xs">
              <span className="chip">Base URL: <code className="ml-1 text-gray-200">{base}</code></span>
              <span className="chip">{VENDOR_API_GROUPS.reduce((n, g) => n + g.endpoints.length, 0)} endpoints</span>
            </div>
          </section>

          {/* 1. Auth */}
          <section className="space-y-4">
            <H id="authentication">1. Authentication</H>
            <p className="text-sm leading-relaxed text-gray-400">{AUTH_PROSE}</p>
            <Code>{`# Either header works:
-H "Authorization: Bearer fmsk_YOUR_KEY"
-H "x-api-key: fmsk_YOUR_KEY"`}</Code>
            <p className="text-sm text-gray-400">{SCOPE_PROSE}</p>
            <div className="grid gap-4 sm:grid-cols-2">
              {SCOPE_GROUPS.map((g) => (
                <div key={g.group} className="rounded-lg border border-border">
                  <div className="border-b border-border bg-[#16161a] px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-400">{g.group}</div>
                  <table className="w-full text-left text-xs">
                    <tbody>
                      {g.scopes.map((s) => (
                        <tr key={s.id} className="border-t border-border/40 first:border-t-0">
                          <td className="whitespace-nowrap py-1.5 pl-3 pr-3 font-mono text-[11px] text-accent">{s.id}</td>
                          <td className="py-1.5 pr-3 text-gray-400">{s.label}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
          </section>

          {/* 2. Quick start */}
          <section className="space-y-4">
            <H id="quick-start">2. Quick start</H>
            {quickstart(appUrl).map((s) => (
              <div key={s.title} className="space-y-1.5">
                <div className="text-sm font-medium text-gray-200">{s.title}</div>
                <Code>{s.code}</Code>
              </div>
            ))}
          </section>

          {/* 3. Concepts */}
          <section className="space-y-3">
            <H id="concepts">3. Core concepts</H>
            <dl className="space-y-3">
              {CONCEPTS.map((c) => (
                <div key={c.name} className="rounded-lg border border-border p-3">
                  <dt className="text-sm font-semibold text-white">{c.name}</dt>
                  <dd className="mt-1 text-sm leading-relaxed text-gray-400">{c.body}</dd>
                </div>
              ))}
            </dl>
          </section>

          {/* 4. API reference */}
          <section className="space-y-4">
            <H id="api-reference">4. API reference</H>
            <p className="text-sm text-gray-400">
              Every endpoint with its required scope. For full request/response details and a live tester, open the{' '}
              <Link href="/docs" className="text-accent hover:underline">interactive explorer</Link>.
            </p>
            {VENDOR_API_GROUPS.map((g) => (
              <div key={g.name} className="space-y-2">
                <div className="text-sm font-semibold text-white">{g.name}</div>
                <p className="text-xs text-gray-500">{g.blurb}</p>
                <div className="overflow-x-auto rounded-lg border border-border">
                  <table className="w-full text-left text-xs">
                    <tbody>
                      {g.endpoints.map((ep) => (
                        <tr key={ep.id} className="border-t border-border/40 first:border-t-0 align-top">
                          <td className="py-1.5 pl-3 pr-2">
                            <span className={`rounded border px-1.5 py-0.5 font-mono text-[10px] font-bold ${METHOD_COLORS[ep.method]}`}>{ep.method}</span>
                          </td>
                          <td className="whitespace-nowrap py-1.5 pr-3 font-mono text-[11px] text-gray-200">{ep.path}</td>
                          <td className="whitespace-nowrap py-1.5 pr-3 font-mono text-[10px] text-accent">{ENDPOINT_SCOPE[ep.id] || '—'}</td>
                          <td className="py-1.5 pr-3 text-gray-400">{ep.summary}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </section>

          {/* 5. Events */}
          <section className="space-y-4">
            <H id="events">5. Real-time events (Server-Sent Events)</H>
            <p className="text-sm leading-relaxed text-gray-400">{EVENTS_PROSE}</p>
            <div className="space-y-1.5">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Event payload</div>
              <Code>{JSON.stringify(EVENT_SAMPLE, null, 2)}</Code>
            </div>
            <div className="space-y-1.5">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Event types (the <code className="text-gray-300">type</code> field)</div>
              <div className="grid gap-4 sm:grid-cols-2">
                {EVENT_TYPE_GROUPS.map((g) => (
                  <div key={g.group} className="rounded-lg border border-border">
                    <div className="border-b border-border bg-[#16161a] px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-400">{g.group}</div>
                    <table className="w-full text-left text-xs">
                      <tbody>
                        {g.types.map((t) => (
                          <tr key={t.type} className="border-t border-border/40 first:border-t-0 align-top">
                            <td className="whitespace-nowrap py-1.5 pl-3 pr-3 font-mono text-[11px] text-accent">{t.type}</td>
                            <td className="py-1.5 pr-3 text-gray-400">{t.desc}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ))}
              </div>
            </div>
            <div className="space-y-1.5">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Reference client (Node 18+, no dependencies)</div>
              <Code>{nodeClient(appUrl)}</Code>
            </div>
          </section>

          {/* 6. Errors */}
          <section className="space-y-3">
            <H id="errors">6. Responses & errors</H>
            <p className="text-sm leading-relaxed text-gray-400">{ERRORS_PROSE}</p>
            <Code>{`{ "error": { "code": "FORBIDDEN", "message": "missing events:subscribe scope" } }`}</Code>
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-left text-xs">
                <tbody>
                  {ERROR_CODES.map((e) => (
                    <tr key={e.status} className="border-t border-border/40 first:border-t-0 align-top">
                      <td className="whitespace-nowrap py-1.5 pl-3 pr-3 font-mono text-[11px] text-gray-200">{e.status}</td>
                      <td className="py-1.5 pr-3 text-gray-400">{e.when}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* 7. Downloads */}
          <section className="space-y-3">
            <H id="downloads">7. Tools & downloads</H>
            <div className="grid gap-3 sm:grid-cols-2">
              {downloads(appUrl).map((d) => (
                <a key={d.label} href={d.url} className="rounded-lg border border-border p-3 transition hover:border-accent/50">
                  <div className="text-sm font-semibold text-white">{d.label}</div>
                  <div className="mt-1 text-xs text-gray-400">{d.note}</div>
                  <div className="mt-1 break-all font-mono text-[10px] text-accent">{d.url}</div>
                </a>
              ))}
            </div>
          </section>

          <footer className="border-t border-border pt-4 text-xs text-gray-500">
            Generated from the live API catalog — always current with the running server.
          </footer>
        </main>
      </div>
    </div>
  );
}
