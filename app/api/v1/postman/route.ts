import { NextResponse } from 'next/server';
import { env } from '@/lib/env';
import { postmanCollection } from '@/lib/api-catalog';

export const runtime = 'nodejs';

// Always-current Postman v2.1 collection, generated from the API catalog.
// Stable shareable URL for 3rd parties: {APP_URL}/api/v1/postman
export async function GET() {
  const collection = postmanCollection(`${env.APP_URL}/api/v1`, '');
  return NextResponse.json(collection, {
    headers: {
      'cache-control': 'public, max-age=300',
      'content-type': 'application/json',
      'content-disposition': 'attachment; filename="filemanager-api.postman_collection.json"'
    }
  });
}
