// Pure helpers for admin "log in as vendor" (impersonation).
// Kept dependency-free so the security gate (`npm test`) can exercise them.

/** Vendor roles an admin may impersonate, most-privileged first. */
const VENDOR_ROLE_RANK: Record<string, number> = {
  vendor_owner: 0,
  vendor_admin: 1,
  vendor_member: 2
};

export interface ImpersonationCandidate {
  role: string;
  status?: string;
  createdAt?: Date | string | number | null;
}

/**
 * Choose which of a vendor's users an admin should be logged in as.
 * Preference: vendor_owner → vendor_admin → vendor_member; oldest account wins ties.
 * Platform roles (super_admin / platform_staff) and non-active users are never
 * impersonation targets. Returns null when the vendor has no eligible user.
 */
export function selectImpersonationTarget<T extends ImpersonationCandidate>(
  users: T[]
): T | null {
  const eligible = users.filter(
    (u) => u.role in VENDOR_ROLE_RANK && (u.status === undefined || u.status === 'active')
  );
  if (eligible.length === 0) return null;
  eligible.sort((a, b) => {
    const byRole = VENDOR_ROLE_RANK[a.role] - VENDOR_ROLE_RANK[b.role];
    if (byRole !== 0) return byRole;
    return new Date(a.createdAt ?? 0).getTime() - new Date(b.createdAt ?? 0).getTime();
  });
  return eligible[0];
}

const ADMIN_ROLES = ['super_admin', 'platform_staff'];

/** A "Stop impersonating" request can only restore an account that is still an active admin. */
export function canRestoreAdmin(
  admin: { status?: string; role?: string } | null | undefined
): boolean {
  return !!admin && admin.status === 'active' && ADMIN_ROLES.includes(admin.role || '');
}
