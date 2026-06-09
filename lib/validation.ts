import { z } from 'zod';

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6).max(200)
});

export const createVendorSchema = z.object({
  name: z.string().min(2).max(120),
  slug: z
    .string()
    .min(2)
    .max(60)
    .regex(/^[a-z0-9-]+$/),
  plan: z.enum(['free', 'pro', 'enterprise']).optional(),
  ownerEmail: z.string().email().optional(),
  ownerPassword: z.string().min(8).optional(),
  limits: z
    .object({
      maxStorageBytes: z.number().int().positive().optional(),
      maxBuckets: z.number().int().positive().optional(),
      maxApiKeys: z.number().int().positive().optional(),
      maxFileSizeBytes: z.number().int().positive().optional()
    })
    .optional()
});

export const updateVendorSchema = z.object({
  name: z.string().min(2).max(120).optional(),
  plan: z.enum(['free', 'pro', 'enterprise']).optional(),
  limits: z
    .object({
      maxStorageBytes: z.number().int().positive().optional(),
      maxBuckets: z.number().int().positive().optional(),
      maxApiKeys: z.number().int().positive().optional(),
      maxFileSizeBytes: z.number().int().positive().optional()
    })
    .optional()
});

export const suspendVendorSchema = z.object({
  reason: z.string().max(500).optional()
});

export const createBucketSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(63)
    .regex(/^[a-z0-9][a-z0-9-]{0,62}$/),
  description: z.string().max(500).optional(),
  isPublic: z.boolean().optional(),
  settings: z
    .object({
      allowedMimeTypes: z.array(z.string()).optional(),
      maxFileSizeBytes: z.number().int().nonnegative().optional()
    })
    .optional()
});

export const updateBucketSchema = createBucketSchema.partial();

export const createFolderSchema = z.object({
  name: z.string().min(1).max(255),
  parentId: z.string().optional().nullable()
});

export const createLinkSchema = z.object({
  type: z.enum(['public', 'private', 'temporary']),
  expiresIn: z.number().int().min(60).max(60 * 60 * 24 * 365 * 10).optional(),
  neverExpire: z.boolean().optional(),
  maxDownloads: z.number().int().positive().nullable().optional(),
  requiredScope: z.string().optional(),
  password: z.string().min(4).max(100).optional()
});

export const resetLinksSchema = z.object({
  types: z.array(z.enum(['public', 'private', 'temporary'])).optional(),
  regenerate: z.boolean().optional()
});

export const createApiKeySchema = z.object({
  name: z.string().min(1).max(120),
  permissions: z.array(z.string()).min(1),
  bucketIds: z.array(z.string()).optional(),
  expiresAt: z.string().optional()
});

export const issueJwtSchema = z.object({
  subject: z.string().min(1).max(120),
  scopes: z.array(z.string()).min(1),
  bucketIds: z.array(z.string()).optional(),
  expiresIn: z.number().int().min(60).max(60 * 60 * 24 * 365)
});

export const maintenanceSchema = z.object({
  enabled: z.boolean(),
  message: z.string().max(500).optional()
});

export const seoSchema = z.object({
  siteName: z.string().min(1).max(120).optional(),
  defaultTitle: z.string().min(1).max(200).optional(),
  titleTemplate: z
    .string()
    .min(1)
    .max(200)
    .refine((s) => s.includes('%s'), { message: 'titleTemplate must contain %s' })
    .optional(),
  description: z.string().max(400).optional(),
  keywords: z.array(z.string().max(60)).max(40).optional(),
  canonicalBaseUrl: z.string().url().max(300).optional(),
  ogImageUrl: z.string().max(500).optional(),
  twitterHandle: z.string().max(40).optional(),
  themeColor: z.string().max(40).optional(),
  faviconUrl: z.string().max(500).optional(),
  organizationName: z.string().max(120).optional(),
  robotsIndex: z.boolean().optional()
});

export const updateFileSchema = z.object({
  originalName: z.string().min(1).max(255).optional(),
  tags: z.array(z.string()).optional(),
  metadata: z.record(z.unknown()).optional()
});
