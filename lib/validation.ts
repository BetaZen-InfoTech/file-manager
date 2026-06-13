import { z } from 'zod';

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6).max(200)
});

export const forgotPasswordSchema = z.object({
  email: z.string().email()
});

export const resetPasswordSchema = z.object({
  token: z.string().min(10).max(200),
  password: z.string().min(8).max(200)
});

export const createVendorSchema = z.object({
  name: z.string().min(2).max(120),
  slug: z
    .string()
    .min(2)
    .max(60)
    .regex(/^[a-z0-9_-]+$/),
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

export const serverActionSchema = z.object({
  action: z.enum(['issue-ssl', 'force-https', 'set-domain']),
  domain: z
    .string()
    .min(3)
    .max(253)
    .regex(/^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/, 'invalid domain'),
  email: z.string().email().max(254).optional()
});

// ---- Payments ----
export const paymentConfigSchema = z.object({
  razorpay: z
    .object({
      enabled: z.boolean().optional(),
      keyId: z.string().max(200).optional(),
      keySecret: z.string().max(400).optional()
    })
    .optional(),
  phonepe: z
    .object({
      enabled: z.boolean().optional(),
      merchantId: z.string().max(200).optional(),
      saltKey: z.string().max(400).optional(),
      saltIndex: z.string().max(10).optional(),
      env: z.enum(['sandbox', 'prod']).optional()
    })
    .optional()
});

export const smtpConfigSchema = z.object({
  action: z.enum(['save', 'test']).default('save'),
  enabled: z.boolean().optional(),
  host: z.string().max(255).optional(),
  port: z.number().int().min(1).max(65535).optional(),
  encryption: z.enum(['none', 'starttls', 'tls']).optional(),
  secure: z.boolean().optional(), // legacy — superseded by `encryption`
  user: z.string().max(255).optional(),
  pass: z.string().max(400).optional(),
  fromName: z.string().max(120).optional(),
  fromEmail: z.string().email().max(254).optional().or(z.literal('')),
  testTo: z.string().email().max(254).optional()
});

export const planUpsertSchema = z.object({
  code: z
    .string()
    .min(2)
    .max(40)
    .regex(/^[a-z0-9-]+$/, 'lowercase letters, digits, hyphens'),
  name: z.string().min(1).max(120),
  description: z.string().max(400).optional(),
  priceInr: z.number().int().min(0).max(10_000_000),
  interval: z.enum(['month', 'year']),
  limits: z.object({
    maxStorageBytes: z.number().int().min(0),
    maxBuckets: z.number().int().min(0),
    maxApiKeys: z.number().int().min(0),
    maxFileSizeBytes: z.number().int().min(0)
  }),
  active: z.boolean().optional(),
  sortOrder: z.number().int().optional()
});

export const checkoutSchema = z.object({
  planCode: z.string().min(2).max(40),
  gateway: z.enum(['razorpay', 'phonepe'])
});

export const razorpayVerifySchema = z.object({
  razorpayOrderId: z.string().min(1).max(120),
  razorpayPaymentId: z.string().min(1).max(120),
  razorpaySignature: z.string().min(1).max(256)
});

const migrationSourceSchema = z.object({
  endpoint: z.string().url().max(300),
  region: z.string().max(60).optional(),
  accessKey: z.string().min(1).max(200),
  secretKey: z.string().min(1).max(400),
  bucket: z.string().min(1).max(200),
  prefix: z.string().max(400).optional(),
  forcePathStyle: z.boolean().optional()
});

const migrationBcdnpSchema = z.object({
  baseUrl: z.string().url().max(300),
  token: z.string().min(8).max(400)
});

export const transferTokenSchema = z.object({
  action: z.enum(['create', 'revoke']).default('create'),
  hours: z.number().int().min(1).max(24 * 60).optional(),
  label: z.string().max(120).optional(),
  vendorId: z.string().max(64).optional(),
  id: z.string().max(64).optional()
});

export const migrationActionSchema = z
  .object({
    action: z.enum(['test', 'discover', 'start', 'resume', 'cancel']),
    sourceType: z.enum(['s3', 'bcdnp', 'bcdnp-full']).optional(),
    source: migrationSourceSchema.optional(),
    bcdnp: migrationBcdnpSchema.optional(),
    id: z.string().min(1).max(64).optional(),
    targetVendorId: z.string().min(1).max(64).optional(),
    targetBucketName: z
      .string()
      .min(1)
      .max(120)
      .regex(/^[a-zA-Z0-9._-]+$/, 'letters, digits, . _ - only')
      .optional()
  })
  .superRefine((v, ctx) => {
    const st = v.sourceType || 's3';
    const needsSource = v.action === 'test' || v.action === 'discover' || v.action === 'start';
    if (needsSource) {
      if (st === 's3' && !v.source) ctx.addIssue({ code: 'custom', message: 'source is required for s3' });
      if ((st === 'bcdnp' || st === 'bcdnp-full') && !v.bcdnp)
        ctx.addIssue({ code: 'custom', message: 'bcdnp (baseUrl, token) is required' });
    }
    // Full migration imports ALL vendors — no single target vendor/bucket needed.
    if (v.action === 'start' && st !== 'bcdnp-full' && (!v.targetVendorId || !v.targetBucketName)) {
      ctx.addIssue({ code: 'custom', message: 'targetVendorId and targetBucketName are required to start' });
    }
    if ((v.action === 'resume' || v.action === 'cancel') && !v.id) {
      ctx.addIssue({ code: 'custom', message: 'id is required' });
    }
  });

export const databaseUpdateSchema = z.object({
  // 'test' just probes the URI; 'apply' writes it to .env and reloads.
  action: z.enum(['test', 'apply']),
  uri: z
    .string()
    .min(12)
    .max(500)
    .regex(/^mongodb(\+srv)?:\/\//i, 'must start with mongodb:// or mongodb+srv://')
    // Require a database name in the path — a path-less URI silently binds the
    // whole app to the driver's default "test" database.
    .refine(
      (u) => /^mongodb(\+srv)?:\/\/[^/]+\/[^/?#]+/i.test(u),
      'URI must include a database name in the path, e.g. .../filemanager?retryWrites=true&w=majority'
    )
});

export const updateFileSchema = z.object({
  originalName: z.string().min(1).max(255).optional(),
  tags: z.array(z.string()).optional(),
  metadata: z.record(z.unknown()).optional(),
  // move: null = bucket root
  folderId: z.string().max(64).nullable().optional()
});

export const copyFileSchema = z.object({
  folderId: z.string().max(64).nullable().optional(),
  name: z.string().min(1).max(255).optional()
});

export const editContentSchema = z.object({
  content: z.string().max(5 * 1024 * 1024) // 5 MB text cap
});

export const blankFileSchema = z.object({
  name: z.string().min(1).max(255),
  folderId: z.string().max(64).nullable().optional(),
  path: z.string().max(1024).optional(), // server-folder path within the bucket (default "/")
  content: z.string().max(5 * 1024 * 1024).optional(),
  mimeType: z.string().max(120).optional()
});

export const archiveSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  fileIds: z.array(z.string().max(64)).max(2000).optional(),
  folderIds: z.array(z.string().max(64)).max(200).optional(),
  folderId: z.string().max(64).nullable().optional() // where to place the .zip
});

export const extractSchema = z.object({
  folderId: z.string().max(64).nullable().optional() // where to extract
});

export const moveFolderSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  parentId: z.string().max(64).nullable().optional()
});

export const multipartInitSchema = z.object({
  bucketId: z.string().regex(/^[a-f0-9]{24}$/i, 'invalid bucketId'),
  folderId: z.string().regex(/^[a-f0-9]{24}$/i, 'invalid folderId').nullable().optional(),
  originalName: z.string().min(1).max(255),
  mimeType: z.string().min(1).max(160),
  sizeBytes: z.number().int().nonnegative().optional()
});

export const multipartCompleteSchema = z.object({
  parts: z
    .array(z.object({ PartNumber: z.number().int().min(1).max(10000), ETag: z.string().min(1).max(256) }))
    .min(1)
    .max(10000),
  sizeBytes: z.number().int().nonnegative().optional()
});

// ---- Server filesystem (admin file manager) ----
export const fsOpSchema = z.object({
  action: z.enum(['mkdir', 'newfile', 'rename', 'delete', 'chmod', 'copy', 'write', 'zip', 'extract']),
  path: z.string().min(1).max(4096),
  to: z.string().max(4096).optional(),
  content: z.string().max(2 * 1024 * 1024).optional(),
  mode: z.string().regex(/^[0-7]{3,4}$/).optional(),
  paths: z.array(z.string().max(4096)).max(2000).optional(),
  name: z.string().max(255).optional()
});
