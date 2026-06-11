import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';

const pExecFile = promisify(execFile);

// Path to the privileged helper installed by setup.sh. Override in dev/tests.
const HELPER = process.env.FMS_SSL_HELPER || '/usr/local/sbin/fms-ssl-helper';

const DOMAIN_RE = /^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/;
const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

export function isValidDomain(d: string): boolean {
  return typeof d === 'string' && d.length <= 253 && DOMAIN_RE.test(d);
}
export function isValidEmail(e: string): boolean {
  return typeof e === 'string' && e.length <= 254 && EMAIL_RE.test(e);
}

/** Extract the hostname from a URL or bare host string. */
export function domainFromUrl(url: string | undefined | null): string {
  if (!url) return '';
  try {
    return new URL(url).hostname;
  } catch {
    return String(url).replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  }
}

function buildInvocation(sub: string, rest: string[]): { cmd: string; args: string[] } {
  // When the app already runs as root (default PM2 setup), call the helper
  // directly. Otherwise rely on the restricted sudoers entry (`sudo -n`).
  const asRoot = typeof process.getuid === 'function' && process.getuid() === 0;
  return asRoot
    ? { cmd: HELPER, args: [sub, ...rest] }
    : { cmd: 'sudo', args: ['-n', HELPER, sub, ...rest] };
}

function helperError(e: unknown): string {
  const err = e as NodeJS.ErrnoException & { stdout?: string; stderr?: string };
  if (err?.code === 'ENOENT') return 'SSL helper not installed on this host (re-run setup.sh).';
  // The helper prints a JSON error on stdout even on non-zero exit.
  const out = (err?.stdout || '').trim();
  if (out) {
    try {
      const j = JSON.parse(out.split('\n').pop() || '{}');
      if (j?.message) return String(j.message);
    } catch {
      /* fall through */
    }
  }
  if (/sudo:/.test(err?.stderr || '')) return 'Not permitted to run the SSL helper (sudoers).';
  return err?.message || 'SSL helper failed.';
}

async function run(sub: string, rest: string[]): Promise<string> {
  const { cmd, args } = buildInvocation(sub, rest);
  const { stdout } = await pExecFile(cmd, args, { timeout: 180_000, maxBuffer: 1 << 20 });
  return stdout;
}

export interface SslStatus {
  domain: string;
  certPresent: boolean;
  certExpiry: string;
  redirectEnabled: boolean;
  nginxOk: boolean;
  available: boolean; // false → helper missing / not permitted
  error?: string;
}

function unavailable(domain: string, error: string): SslStatus {
  return {
    domain,
    certPresent: false,
    certExpiry: '',
    redirectEnabled: false,
    nginxOk: false,
    available: false,
    error
  };
}

export async function sslStatus(domain: string): Promise<SslStatus> {
  if (!isValidDomain(domain)) return unavailable(domain, 'invalid domain');
  try {
    const out = await run('status', [domain]);
    const j = JSON.parse(out.trim());
    return {
      domain: String(j.domain || domain),
      certPresent: Boolean(j.certPresent),
      certExpiry: String(j.certExpiry || ''),
      redirectEnabled: Boolean(j.redirectEnabled),
      nginxOk: Boolean(j.nginxOk),
      available: true
    };
  } catch (e) {
    return unavailable(domain, helperError(e));
  }
}

export interface HelperResult {
  ok: boolean;
  message: string;
}

async function action(sub: string, rest: string[]): Promise<HelperResult> {
  try {
    const out = await run(sub, rest);
    const j = JSON.parse((out.trim().split('\n').pop() || '{}'));
    return { ok: Boolean(j.ok), message: String(j.message || '') };
  } catch (e) {
    return { ok: false, message: helperError(e) };
  }
}

export async function issueSsl(domain: string, email: string): Promise<HelperResult> {
  if (!isValidDomain(domain)) return { ok: false, message: 'invalid domain' };
  if (!isValidEmail(email)) return { ok: false, message: 'invalid email' };
  return action('issue', [domain, email]);
}

export async function forceHttps(domain: string): Promise<HelperResult> {
  if (!isValidDomain(domain)) return { ok: false, message: 'invalid domain' };
  return action('force-https', [domain]);
}

export async function setVhostDomain(domain: string): Promise<HelperResult> {
  if (!isValidDomain(domain)) return { ok: false, message: 'invalid domain' };
  return action('set-vhost', [domain]);
}

/**
 * Reload the PM2 app after a short delay, detached from this request so the
 * HTTP response is sent first (the reload restarts the very process serving it).
 * Used after changing env that needs a restart (e.g. MONGODB_URI).
 */
export function schedulePanelReload(delaySeconds = 2): void {
  try {
    // CRITICAL: a changed .env value (e.g. MONGODB_URI) only takes effect with a
    // FULL restart. `pm2 reload --update-env` keeps PM2's CACHED env, and this
    // process already has the OLD value in process.env (loaded at boot), so the
    // old DB would persist. So: (1) strip the .env-managed keys from the child
    // env so the fresh `pm2 start` doesn't re-capture our stale in-memory values,
    // and (2) delete + start (not reload) so PM2's env cache is cleared and
    // Next.js re-reads .env from scratch.
    const env = { ...process.env };
    delete env.MONGODB_URI;
    delete env.APP_URL;
    delete env.PUBLIC_URL_BASE;
    const child = spawn(
      'bash',
      [
        '-c',
        `sleep ${delaySeconds}; pm2 delete filemanager >/dev/null 2>&1; pm2 start ecosystem.config.js >/dev/null 2>&1 || pm2 restart filemanager; pm2 save >/dev/null 2>&1`
      ],
      { detached: true, stdio: 'ignore', env, cwd: process.cwd() }
    );
    child.unref();
  } catch {
    /* best-effort */
  }
}
