'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Logo } from '@/components/Logo';
import {
  // Show only what an API key can call — session/admin endpoints are hidden.
  VENDOR_API_GROUPS as API_GROUPS,
  VENDOR_API_ENDPOINTS as ALL_ENDPOINTS,
  AUTH_LABEL,
  METHOD_COLORS,
  ENDPOINT_SCOPE,
  ENDPOINT_BODY_PARAMS,
  paramRequirement,
  curlFor,
  postmanCollection,
  type ApiEndpoint
} from '@/lib/api-catalog';

function MethodBadge({ method }: { method: ApiEndpoint['method'] }) {
  return (
    <span className={`rounded border px-1.5 py-0.5 font-mono text-[10px] font-bold ${METHOD_COLORS[method]}`}>
      {method}
    </span>
  );
}

type ParamRow = { name: string; type: string; req: string; desc: string };

function ReqBadge({ req }: { req: string }) {
  const cls =
    req === 'required'
      ? 'bg-rose-500/15 text-rose-300 border-rose-500/30'
      : req === 'optional'
        ? 'bg-white/5 text-gray-400 border-border'
        : 'bg-amber-500/15 text-amber-300 border-amber-500/30';
  return <span className={`rounded border px-1.5 py-0.5 text-[10px] font-medium ${cls}`}>{req}</span>;
}

function ParamTable({ title, rows }: { title: string; rows: ParamRow[] }) {
  if (!rows.length) return null;
  return (
    <div className="space-y-1.5">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">{title}</div>
      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full border-collapse text-left">
          <tbody>
            {rows.map((r) => (
              <tr key={r.name} className="border-t border-border first:border-t-0 align-top">
                <td className="whitespace-nowrap py-1.5 pl-3 pr-3 font-mono text-[11px] text-gray-200">{r.name}</td>
                <td className="whitespace-nowrap py-1.5 pr-3 font-mono text-[11px] text-gray-500">{r.type}</td>
                <td className="whitespace-nowrap py-1.5 pr-3"><ReqBadge req={r.req} /></td>
                <td className="py-1.5 pr-3 text-[11px] leading-relaxed text-gray-400">{r.desc}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ParamsBlock({ ep }: { ep: ApiEndpoint }) {
  const body = ENDPOINT_BODY_PARAMS[ep.id] || [];
  const pathRows: ParamRow[] = (ep.pathParams || []).map((p) => ({
    name: `:${p.name}`,
    type: 'string',
    req: p.required ? 'required' : 'optional',
    desc: p.desc
  }));
  const queryRows: ParamRow[] = (ep.query || []).map((q) => ({
    name: q.name,
    type: 'string',
    req: q.required ? 'required' : 'optional',
    desc: q.desc
  }));
  const bodyRows: ParamRow[] = body.map((f) => ({
    name: f.name,
    type: f.type,
    req: paramRequirement(f),
    desc: f.desc
  }));
  if (!pathRows.length && !queryRows.length && !bodyRows.length) return null;
  const bodyTitle = body.length && body[0].form ? 'Form fields (multipart/form-data)' : 'Body parameters';
  return (
    <div className="space-y-3">
      <ParamTable title="Path parameters" rows={pathRows} />
      <ParamTable title="Query parameters" rows={queryRows} />
      <ParamTable title={bodyTitle} rows={bodyRows} />
    </div>
  );
}

function TryPanel({
  ep,
  baseUrl,
  token
}: {
  ep: ApiEndpoint;
  baseUrl: string;
  token: string;
}) {
  const [pathVals, setPathVals] = useState<Record<string, string>>({});
  const [queryVals, setQueryVals] = useState<Record<string, string>>({});
  const [bodyText, setBodyText] = useState(ep.body ? JSON.stringify(ep.body, null, 2) : '');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<{ status: number; ms: number; body: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function send() {
    setBusy(true);
    setErr(null);
    setRes(null);
    try {
      let p = ep.path;
      for (const pp of ep.pathParams || []) {
        p = p.replace(`:${pp.name}`, encodeURIComponent(pathVals[pp.name] || `:${pp.name}`));
      }
      const qs = (ep.query || [])
        .filter((q) => queryVals[q.name])
        .map((q) => `${q.name}=${encodeURIComponent(queryVals[q.name])}`)
        .join('&');
      const url = `${baseUrl}${p}${qs ? `?${qs}` : ''}`;

      const headers: Record<string, string> = {};
      if (ep.auth !== 'public' && ep.auth !== 'webhook' && token) {
        headers['Authorization'] = `Bearer ${token}`;
      }
      let bodyInit: BodyInit | undefined;
      if (ep.multipart) {
        if (file) {
          const fd = new FormData();
          fd.append('file', file);
          bodyInit = fd;
        }
      } else if (bodyText.trim() && ep.method !== 'GET' && ep.method !== 'DELETE') {
        headers['Content-Type'] = 'application/json';
        bodyInit = bodyText;
      }

      const t0 = performance.now();
      const r = await fetch(url, { method: ep.method, headers, body: bodyInit, credentials: 'include' });
      const text = await r.text();
      let pretty = text;
      try {
        pretty = JSON.stringify(JSON.parse(text), null, 2);
      } catch {
        /* not json */
      }
      setRes({ status: r.status, ms: Math.round(performance.now() - t0), body: pretty.slice(0, 20000) });
    } catch (e: any) {
      setErr(e?.message || 'Request failed (CORS or network).');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3 rounded-lg border border-border bg-[#0e0e10] p-4">
      <div className="text-xs font-semibold text-gray-300">Try it</div>

      {(ep.pathParams?.length || 0) > 0 && (
        <div className="grid gap-2 sm:grid-cols-2">
          {ep.pathParams!.map((pp) => (
            <label key={pp.name} className="text-[11px] text-gray-400">
              {`:${pp.name}`} {pp.required && <span className="text-rose-400">*</span>}
              <input
                className="input mt-1"
                placeholder={pp.desc}
                value={pathVals[pp.name] || ''}
                onChange={(e) => setPathVals((v) => ({ ...v, [pp.name]: e.target.value }))}
              />
            </label>
          ))}
        </div>
      )}

      {(ep.query?.length || 0) > 0 && (
        <div className="grid gap-2 sm:grid-cols-2">
          {ep.query!.map((q) => (
            <label key={q.name} className="text-[11px] text-gray-400">
              ?{q.name}
              <input
                className="input mt-1"
                placeholder={q.desc}
                value={queryVals[q.name] || ''}
                onChange={(e) => setQueryVals((v) => ({ ...v, [q.name]: e.target.value }))}
              />
            </label>
          ))}
        </div>
      )}

      {ep.multipart ? (
        <div>
          <div className="text-[11px] text-gray-400">file</div>
          <input type="file" className="mt-1 text-xs text-gray-300" onChange={(e) => setFile(e.target.files?.[0] || null)} />
        </div>
      ) : (
        ep.method !== 'GET' &&
        ep.method !== 'DELETE' && (
          <div>
            <div className="text-[11px] text-gray-400">Body (JSON)</div>
            <textarea
              className="input mt-1 min-h-[120px] font-mono text-xs"
              value={bodyText}
              onChange={(e) => setBodyText(e.target.value)}
              spellCheck={false}
            />
          </div>
        )
      )}

      <button className="btn" disabled={busy} onClick={send}>
        {busy ? 'Sending…' : `Send ${ep.method}`}
      </button>

      {err && <div className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">{err}</div>}

      {res && (
        <div className="space-y-1.5">
          <div className="flex items-center gap-2 text-xs">
            <span
              className={`rounded px-1.5 py-0.5 font-mono font-bold ${
                res.status < 300
                  ? 'bg-emerald-500/15 text-emerald-300'
                  : res.status < 500
                    ? 'bg-amber-500/15 text-amber-300'
                    : 'bg-rose-500/15 text-rose-300'
              }`}
            >
              {res.status}
            </span>
            <span className="text-gray-500">{res.ms} ms</span>
          </div>
          <pre className="max-h-80 overflow-auto rounded-md border border-border bg-black/40 p-3 font-mono text-[11px] leading-relaxed text-gray-200">
            {res.body}
          </pre>
        </div>
      )}
    </div>
  );
}

export default function DocsClient() {
  const defaultBase =
    typeof window !== 'undefined' ? `${window.location.origin}/api/v1` : '/api/v1';
  const [baseUrl, setBaseUrl] = useState(defaultBase);
  const [token, setToken] = useState('');
  const [activeId, setActiveId] = useState(ALL_ENDPOINTS[0].id);
  const [copied, setCopied] = useState(false);

  const ep = useMemo(() => ALL_ENDPOINTS.find((e) => e.id === activeId)!, [activeId]);

  function downloadPostman() {
    const data = postmanCollection(baseUrl, token);
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'file-manager-api.postman_collection.json';
    a.click();
    URL.revokeObjectURL(url);
  }

  async function copyCurl() {
    try {
      await navigator.clipboard.writeText(curlFor(ep, baseUrl, token));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="min-h-screen">
      {/* top bar */}
      <header className="sticky top-0 z-20 border-b border-border bg-bg/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-4 py-3">
          <Link href="/" className="flex items-center gap-2">
            <Logo className="h-7 w-7" />
            <span className="text-sm font-semibold text-white">API Docs</span>
          </Link>
          <div className="flex flex-1 flex-wrap items-center gap-2">
            <input
              className="input h-9 max-w-[260px] flex-1 text-xs"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="Base URL"
              aria-label="Base URL"
            />
            <input
              className="input h-9 max-w-[280px] flex-1 text-xs"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="Bearer token (fmsk_… or JWT)"
              aria-label="Token"
            />
          </div>
          <button className="btn h-9 px-3 text-xs" onClick={downloadPostman}>
            ⬇ Postman
          </button>
        </div>
      </header>

      <div className="mx-auto flex max-w-6xl gap-6 px-4 py-6">
        {/* sidebar */}
        <aside className="hidden w-56 shrink-0 md:block">
          <nav className="sticky top-20 space-y-4">
            {API_GROUPS.map((g) => (
              <div key={g.name}>
                <div className="px-2 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                  {g.name}
                </div>
                <div className="mt-1 space-y-0.5">
                  {g.endpoints.map((e) => (
                    <button
                      key={e.id}
                      onClick={() => setActiveId(e.id)}
                      className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition ${
                        e.id === activeId ? 'bg-[#1c1c20] text-white' : 'text-gray-400 hover:bg-[#16161a]'
                      }`}
                    >
                      <MethodBadge method={e.method} />
                      <span className="truncate">{e.summary}</span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </nav>
        </aside>

        {/* main */}
        <main className="min-w-0 flex-1 space-y-5">
          {/* intro */}
          <div className="card space-y-2">
            <h1 className="text-xl font-semibold text-white">File Manager API</h1>
            <p className="text-sm text-gray-400">
              REST API for buckets, files, links, folders and your file manager. Authenticate with an
              API key (<code className="text-gray-300">Authorization: Bearer fmsk_…</code>). Only endpoints
              you can call with an API key are listed — each shows the <strong>scope</strong> it needs.
              Set your <strong>base URL</strong> and <strong>token</strong> above, then use <em>Try it</em>,
              or download the Postman collection.
            </p>
            <div className="flex flex-wrap gap-2 pt-1">
              <span className="chip">Base: <code className="ml-1">{baseUrl}</code></span>
              <span className="chip">{ALL_ENDPOINTS.length} endpoints</span>
              <a className="chip hover:border-accent/50" href="/api/v1/openapi" target="_blank" rel="noreferrer">
                OpenAPI JSON ↗
              </a>
            </div>
          </div>

          {/* mobile endpoint picker */}
          <div className="md:hidden">
            <select
              className="input"
              value={activeId}
              onChange={(e) => setActiveId(e.target.value)}
            >
              {API_GROUPS.map((g) => (
                <optgroup key={g.name} label={g.name}>
                  {g.endpoints.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.method} · {e.summary}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>

          {/* endpoint detail */}
          <div className="card space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <MethodBadge method={ep.method} />
              <code className="break-all text-sm text-white">{ep.path}</code>
              {ENDPOINT_SCOPE[ep.id] && (
                <span className="chip" title="API-key scope required for this action">
                  scope <code className="ml-1 text-accent">{ENDPOINT_SCOPE[ep.id]}</code>
                </span>
              )}
              <span className="chip ml-auto">{AUTH_LABEL[ep.auth]}</span>
            </div>
            <p className="text-sm text-gray-400">{ep.description}</p>
            {ep.auth === 'apikey' && !ENDPOINT_SCOPE[ep.id] && (
              <p className="text-[11px] text-gray-500">Needs any valid API key or session — no specific scope.</p>
            )}

            {/* parameters */}
            <ParamsBlock ep={ep} />

            {/* curl */}
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-medium text-gray-500">cURL</span>
                <button className="text-[11px] text-accent hover:underline" onClick={copyCurl}>
                  {copied ? 'Copied!' : 'Copy'}
                </button>
              </div>
              <pre className="overflow-auto rounded-md border border-border bg-black/40 p-3 font-mono text-[11px] leading-relaxed text-gray-200">
                {curlFor(ep, baseUrl, token)}
              </pre>
            </div>

            <TryPanel ep={ep} baseUrl={baseUrl} token={token} />
          </div>
        </main>
      </div>
    </div>
  );
}
