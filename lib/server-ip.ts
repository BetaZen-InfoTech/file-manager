import os from 'os';

// The server's own IP address, shown in the admin panel so you always know which
// machine you're looking at (the domain in the address bar hides it when several
// servers share a hostname).
//
// Resolution order:
//   1. SERVER_IP env var (explicit override — set this if auto-detect is wrong,
//      e.g. behind NAT where the public IP isn't bound to a local interface).
//   2. First non-internal IPv4 on a physical interface, preferring a public
//      address over private/docker ranges (10/8, 172.16/12, 192.168/16, etc.).
//   3. '' if nothing can be determined.

let cached: string | null = null;

function isPrivate(ip: string): boolean {
  return (
    /^10\./.test(ip) ||
    /^192\.168\./.test(ip) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(ip) ||
    /^169\.254\./.test(ip) || // link-local
    /^127\./.test(ip)
  );
}

export function serverIp(): string {
  if (cached !== null) return cached;

  const fromEnv = (process.env.SERVER_IP || '').trim();
  if (fromEnv) {
    cached = fromEnv;
    return cached;
  }

  const publicIps: string[] = [];
  const privateIps: string[] = [];
  try {
    const ifaces = os.networkInterfaces();
    for (const name of Object.keys(ifaces)) {
      // Skip virtual/container bridges — their addresses aren't the host's IP.
      if (/^(docker|br-|veth|lo|virbr|tun|tap)/i.test(name)) continue;
      for (const ni of ifaces[name] || []) {
        if (!ni || ni.internal) continue;
        // node <18 reports family as 'IPv4'; node >=18 may report 4.
        const fam = String((ni as { family: string | number }).family);
        if (fam !== 'IPv4' && fam !== '4') continue;
        (isPrivate(ni.address) ? privateIps : publicIps).push(ni.address);
      }
    }
  } catch {
    // os.networkInterfaces can throw in restricted sandboxes — fall through to ''.
  }

  cached = publicIps[0] || privateIps[0] || '';
  return cached;
}
