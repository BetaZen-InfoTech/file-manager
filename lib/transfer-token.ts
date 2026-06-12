import { NextRequest } from 'next/server';
import crypto from 'crypto';
import { dbConnect } from './db';
import { sha256 } from './crypto';
import { TransferToken } from '@/models/TransferToken';

export interface TransferScope {
  kind: 'instance' | 'vendor';
  vendorId?: string;
  bucketIds?: string[];
}

// Opaque token (NOT a JWT): fmt_<base64url(32 random bytes)>.
export function generateTransferToken(): string {
  return 'fmt_' + crypto.randomBytes(32).toString('base64url');
}

/**
 * Verify a transfer-token bearer on the SOURCE's transfer endpoints. Standalone
 * — never routed through authenticate()/can(): transfer tokens are a separate
 * credential that grants ONLY the transfer API, time-limited and revocable.
 */
export async function verifyTransferToken(req: NextRequest): Promise<TransferScope | null> {
  const auth = req.headers.get('authorization') || '';
  if (!auth.toLowerCase().startsWith('bearer ')) return null;
  const plain = auth.slice(7).trim();
  if (!plain.startsWith('fmt_')) return null;

  await dbConnect();
  const tok: any = await TransferToken.findOne({ tokenHash: sha256(plain) }).lean();
  if (!tok || tok.status !== 'active') return null;
  if (tok.expiresAt && new Date(tok.expiresAt) < new Date()) return null;

  TransferToken.updateOne({ _id: tok._id }, { $set: { lastUsedAt: new Date() } }).catch(() => {});

  return {
    kind: tok.scope?.kind === 'vendor' ? 'vendor' : 'instance',
    vendorId: tok.scope?.vendorId ? String(tok.scope.vendorId) : undefined,
    bucketIds: (tok.scope?.bucketIds || []).map((b: any) => String(b))
  };
}
