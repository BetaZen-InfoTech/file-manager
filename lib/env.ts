function required(key: string, fallback?: string): string {
  const v = process.env[key];
  if (v && v.length > 0) return v;
  if (fallback !== undefined) return fallback;
  if (process.env.NODE_ENV === 'production') {
    throw new Error(`Missing required env var: ${key}`);
  }
  return '';
}

export const env = {
  NODE_ENV: process.env.NODE_ENV || 'development',
  APP_URL: process.env.APP_URL || 'http://localhost:3000',
  PORT: Number(process.env.PORT || 3000),

  JWT_SECRET: required('JWT_SECRET', 'dev-jwt-secret-change-me-in-production-please'),
  SESSION_COOKIE_SECRET: required(
    'SESSION_COOKIE_SECRET',
    'dev-session-secret-change-me-in-production-please'
  ),
  SESSION_COOKIE_NAME: process.env.SESSION_COOKIE_NAME || 'fms_session',
  // Whether the session cookie carries the `Secure` flag. Secure cookies are
  // ONLY stored by browsers over HTTPS — so an HTTP-only deploy (bare IP / no
  // TLS) must set COOKIE_SECURE=false or login silently fails (cookie dropped).
  // When unset, defaults to Secure in production (the safe default for HTTPS).
  COOKIE_SECURE:
    (process.env.COOKIE_SECURE && process.env.COOKIE_SECURE.length > 0
      ? process.env.COOKIE_SECURE
      : process.env.NODE_ENV === 'production' ? 'true' : 'false') === 'true',
  SESSION_TTL_HOURS: Number(process.env.SESSION_TTL_HOURS || 12),

  MONGODB_URI: required('MONGODB_URI', 'mongodb://127.0.0.1:27017/filemanager'),

  STORAGE_DRIVER: (process.env.STORAGE_DRIVER || 'minio') as 'minio' | 's3' | 'disk',
  S3_ENDPOINT: process.env.S3_ENDPOINT || 'http://127.0.0.1:9000',
  S3_REGION: process.env.S3_REGION || 'us-east-1',
  S3_ACCESS_KEY: process.env.S3_ACCESS_KEY || 'minioadmin',
  S3_SECRET_KEY: process.env.S3_SECRET_KEY || 'minioadmin',
  S3_FORCE_PATH_STYLE: (process.env.S3_FORCE_PATH_STYLE || 'true') === 'true',
  S3_USE_SSL: (process.env.S3_USE_SSL || 'false') === 'true',
  S3_DEFAULT_BUCKET: process.env.S3_DEFAULT_BUCKET || 'filemanager',

  PUBLIC_URL_BASE: process.env.PUBLIC_URL_BASE || process.env.APP_URL || 'http://localhost:3000',
  PUBLIC_TOKEN_BYTES: Number(process.env.PUBLIC_TOKEN_BYTES || 24),

  GITHUB_WEBHOOK_SECRET: process.env.GITHUB_WEBHOOK_SECRET || '',
  DEPLOY_BRANCH: process.env.DEPLOY_BRANCH || 'main',
  DEPLOY_SCRIPT: process.env.DEPLOY_SCRIPT || '/var/www/app/scripts/deploy.sh',

  MAX_UPLOAD_BYTES: Number(process.env.MAX_UPLOAD_BYTES || 524288000),

  REDIS_URL: process.env.REDIS_URL || '',
  CLAMAV_HOST: process.env.CLAMAV_HOST || '',
  CLAMAV_PORT: Number(process.env.CLAMAV_PORT || 3310),

  MAIL_DRIVER: (process.env.MAIL_DRIVER || 'smtp') as 'smtp' | 'resend' | 'ses' | 'noop',
  MAIL_HOST: process.env.MAIL_HOST || '',
  MAIL_PORT: Number(process.env.MAIL_PORT || 587),
  MAIL_USER: process.env.MAIL_USER || '',
  MAIL_PASS: process.env.MAIL_PASS || '',
  MAIL_FROM: process.env.MAIL_FROM || 'File Manager <no-reply@example.com>',

  INTERNAL_CRON_SECRET: process.env.INTERNAL_CRON_SECRET || '',
  RATE_LIMIT_PER_MIN: Number(process.env.RATE_LIMIT_PER_MIN || 100)
};

export type Env = typeof env;
