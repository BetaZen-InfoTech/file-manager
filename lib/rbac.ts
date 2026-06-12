import type { Role } from '@/models/User';

export const PERMISSIONS = [
  'bucket:create',
  'bucket:read',
  'bucket:update',
  'bucket:delete',
  'file:upload',
  'file:read',
  'file:download',
  'file:delete',
  'file:list',
  'folder:create',
  'folder:update',
  'folder:hide',
  'publicurl:create',
  'publicurl:revoke',
  'apikey:create',
  'apikey:revoke',
  'member:invite',
  'member:remove',
  'settings:update',
  'admin:vendor:read',
  'admin:vendor:update',
  'admin:vendor:suspend',
  'admin:usage:read',
  'admin:audit:read',
  'admin:maintenance:toggle'
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const PLATFORM_PERMS: Permission[] = [
  'admin:vendor:read',
  'admin:vendor:update',
  'admin:vendor:suspend',
  'admin:usage:read',
  'admin:audit:read',
  'admin:maintenance:toggle'
];

const VENDOR_OWNER_PERMS: Permission[] = [
  'bucket:create',
  'bucket:read',
  'bucket:update',
  'bucket:delete',
  'file:upload',
  'file:read',
  'file:download',
  'file:delete',
  'file:list',
  'folder:create',
  'folder:update',
  'folder:hide',
  'publicurl:create',
  'publicurl:revoke',
  'apikey:create',
  'apikey:revoke',
  'member:invite',
  'member:remove',
  'settings:update'
];

const VENDOR_ADMIN_PERMS: Permission[] = VENDOR_OWNER_PERMS.filter(
  (p) => p !== 'settings:update'
);

const VENDOR_MEMBER_PERMS: Permission[] = [
  'bucket:read',
  'file:upload',
  'file:read',
  'file:download',
  'file:list',
  'folder:create'
];

export function permissionsForRole(role: Role): Permission[] {
  switch (role) {
    case 'super_admin':
      return [...PLATFORM_PERMS, ...VENDOR_OWNER_PERMS];
    case 'platform_staff':
      return PLATFORM_PERMS.filter(
        (p) => p !== 'admin:maintenance:toggle'
      );
    case 'vendor_owner':
      return VENDOR_OWNER_PERMS;
    case 'vendor_admin':
      return VENDOR_ADMIN_PERMS;
    case 'vendor_member':
      return VENDOR_MEMBER_PERMS;
    default:
      return [];
  }
}

export interface Principal {
  kind: 'session' | 'apikey' | 'jwt';
  userId?: string;
  apiKeyId?: string;
  vendorId: string | null;
  vendorStatus: 'active' | 'suspended' | 'pending' | 'none';
  role: Role | 'thirdparty';
  panel: 'admin' | 'vendor' | 'thirdparty';
  permissions: Permission[];
  email?: string;
  subject?: string;
  bucketIds?: string[];
  /** Set when this session is an admin impersonating a vendor user — the admin's userId. */
  impersonatorId?: string;
}

export interface ResourceRef {
  vendorId?: string | null;
  bucketId?: string;
}

const SUSPENDED_BLOCKED: Permission[] = [
  'file:upload',
  'file:download',
  'file:delete',
  'publicurl:create'
];

export function can(
  principal: Principal | null | undefined,
  permission: Permission,
  resource?: ResourceRef
): boolean {
  if (!principal) return false;
  if (principal.vendorStatus === 'suspended' && SUSPENDED_BLOCKED.includes(permission)) {
    return false;
  }
  if (resource && resource.vendorId !== undefined && resource.vendorId !== null) {
    if (principal.vendorId && resource.vendorId !== principal.vendorId) return false;
    if (!principal.vendorId && !PLATFORM_PERMS.includes(permission as Permission)) {
      return false;
    }
  }
  if (resource && resource.bucketId && principal.bucketIds && principal.bucketIds.length > 0) {
    if (!principal.bucketIds.includes(resource.bucketId)) return false;
  }
  return principal.permissions.includes(permission);
}

export function requireScopes(have: string[], need: string[]): boolean {
  return need.every((n) => have.includes(n));
}

/**
 * Who may "log in as" a vendor — only a real super_admin browser session.
 * Gated on role (not a stored permission) so already-seeded admins qualify
 * without a permissions migration, and API keys / impersonated sessions never do.
 */
export function canImpersonate(principal: Principal | null | undefined): boolean {
  return !!principal && principal.kind === 'session' && principal.role === 'super_admin';
}
