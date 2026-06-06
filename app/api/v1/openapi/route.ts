import { NextResponse } from 'next/server';
import { env } from '@/lib/env';

export const runtime = 'nodejs';

const spec = {
  openapi: '3.0.3',
  info: {
    title: 'File Manager SaaS API',
    version: '1.0.0',
    description:
      'Multi-tenant file manager. Two auth modes: session cookie (UI) or `Authorization: Bearer fmsk_xxx` (API key).'
  },
  servers: [{ url: env.APP_URL + '/api/v1' }],
  components: {
    securitySchemes: {
      bearer: { type: 'http', scheme: 'bearer', bearerFormat: 'fmsk_xxx | jwt' },
      cookie: { type: 'apiKey', in: 'cookie', name: env.SESSION_COOKIE_NAME }
    }
  },
  security: [{ bearer: [] }, { cookie: [] }],
  paths: {
    '/auth/login': {
      post: {
        summary: 'Sign in (sets session cookie)',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['email', 'password'],
                properties: {
                  email: { type: 'string', format: 'email' },
                  password: { type: 'string', minLength: 6 }
                }
              }
            }
          }
        }
      }
    },
    '/auth/logout': { post: { summary: 'Sign out' } },
    '/auth/me': { get: { summary: 'Current principal' } },
    '/admin/vendors': {
      get: { summary: 'List vendors (admin)' },
      post: { summary: 'Create vendor (admin)' }
    },
    '/admin/vendors/{id}': {
      get: { summary: 'Vendor details (admin)' },
      patch: { summary: 'Update vendor (admin)' }
    },
    '/admin/vendors/{id}/suspend': { post: { summary: 'Suspend vendor (admin)' } },
    '/admin/vendors/{id}/activate': { post: { summary: 'Activate vendor (admin)' } },
    '/admin/usage': { get: { summary: 'Global usage stats (admin)' } },
    '/admin/audit-logs': { get: { summary: 'Browse audit logs (admin)' } },
    '/admin/maintenance': {
      get: { summary: 'Read maintenance flag (admin)' },
      post: { summary: 'Toggle maintenance mode (admin)' }
    },
    '/buckets': {
      get: { summary: 'List buckets (vendor)' },
      post: { summary: 'Create bucket (vendor)' }
    },
    '/buckets/{bid}': {
      get: { summary: 'Bucket details' },
      patch: { summary: 'Update bucket' },
      delete: { summary: 'Delete bucket (must be empty)' }
    },
    '/buckets/{bid}/folders': {
      get: { summary: 'List folders (showHidden=true to include hidden)' },
      post: { summary: 'Create folder' }
    },
    '/buckets/{bid}/files': {
      get: { summary: 'List files' },
      post: {
        summary: 'Upload file → returns id + full details',
        requestBody: {
          required: true,
          content: { 'multipart/form-data': { schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } } } }
        }
      }
    },
    '/folders/{id}': { patch: { summary: 'Rename folder' }, delete: { summary: 'Delete folder (must be empty)' } },
    '/folders/{id}/hide': { post: { summary: 'Hide folder' } },
    '/folders/{id}/unhide': { post: { summary: 'Unhide folder' } },
    '/files/{id}': {
      get: { summary: 'File details (full)' },
      patch: { summary: 'Update name/tags/metadata' },
      delete: { summary: 'Soft delete (trash)' }
    },
    '/files/{id}/download': { get: { summary: 'Download (redirects to presigned URL)' } },
    '/files/{id}/hide': { post: { summary: 'Hide file' } },
    '/files/{id}/unhide': { post: { summary: 'Unhide file' } },
    '/files/{id}/restore': { post: { summary: 'Restore from trash' } },
    '/files/{id}/links': {
      get: { summary: 'List active links' },
      post: {
        summary: 'Create link (public / private / temporary)',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['type'],
                properties: {
                  type: { type: 'string', enum: ['public', 'private', 'temporary'] },
                  expiresIn: { type: 'integer', minimum: 60 },
                  neverExpire: { type: 'boolean' },
                  maxDownloads: { type: 'integer' },
                  requiredScope: { type: 'string' },
                  password: { type: 'string' }
                }
              }
            }
          }
        }
      }
    },
    '/files/{id}/links/reset': {
      post: {
        summary: 'Revoke ALL active links for a file (optionally regenerate)',
        requestBody: {
          required: false,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  types: { type: 'array', items: { type: 'string', enum: ['public', 'private', 'temporary'] } },
                  regenerate: { type: 'boolean' }
                }
              }
            }
          }
        }
      }
    },
    '/links/{id}': { delete: { summary: 'Revoke a single link' } },
    '/api-keys': {
      get: { summary: 'List API keys (prefix-only)' },
      post: { summary: 'Create API key — plain key shown ONCE' }
    },
    '/api-keys/{id}': { delete: { summary: 'Revoke API key' } },
    '/jwt/issue': {
      post: {
        summary: 'Issue 3rd-party JWT with RBAC scopes',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['subject', 'scopes', 'expiresIn'],
                properties: {
                  subject: { type: 'string' },
                  scopes: { type: 'array', items: { type: 'string' } },
                  bucketIds: { type: 'array', items: { type: 'string' } },
                  expiresIn: { type: 'integer', minimum: 60 }
                }
              }
            }
          }
        }
      }
    },
    '/jwt/revoke': { post: { summary: 'Revoke a JWT by jti' } },
    '/deploy/github': { post: { summary: 'GitHub deploy webhook (HMAC-signed)' } }
  }
};

export async function GET() {
  return NextResponse.json(spec, {
    headers: {
      'cache-control': 'public, max-age=300',
      'content-type': 'application/json'
    }
  });
}
