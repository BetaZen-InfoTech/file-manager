import { NextRequest } from 'next/server';
import { handleLinkDownload } from '@/lib/link-handler';

export const runtime = 'nodejs';

export async function GET(req: NextRequest, { params }: { params: { token: string } }) {
  return handleLinkDownload(req, params.token, 'private');
}
