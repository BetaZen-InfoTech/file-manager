import { NextResponse } from 'next/server';
import { env } from '@/lib/env';
import { guideMarkdown } from '@/lib/integration-guide';

export const runtime = 'nodejs';

// The full Integration Guide as a single Markdown file — hand it to a 3rd party.
// Stable URL: {APP_URL}/docs/guide/raw
export async function GET() {
  const md = guideMarkdown(env.APP_URL);
  return new NextResponse(md, {
    headers: {
      'cache-control': 'public, max-age=300',
      'content-type': 'text/markdown; charset=utf-8',
      'content-disposition': 'attachment; filename="filemanager-api-guide.md"'
    }
  });
}
