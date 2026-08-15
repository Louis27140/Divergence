import { pool } from './db';

// Permission bitmask constants (must match front/src/utils/permissions.ts)
export const PERM_READ   = 1;
export const PERM_WRITE  = 2;
export const PERM_VOICE  = 4;
export const PERM_MANAGE = 8;
export const PERM_ADMIN  = -1;

export function hasPermission(userPerm: number | null | undefined, flag: number): boolean {
  if (userPerm === null || userPerm === undefined) return false;
  if (userPerm === PERM_ADMIN) return true;
  return (userPerm & flag) !== 0;
}

/**
 * Build the effective-permission SQL fragment for a single (user, channel) pair.
 *
 * Logic:
 * 1. Channel has no rows in channel_role_access → open channel.
 *    Effective perm = OR-union of the user's global role permissions.
 *    Fallback to channel.default_permissions when the user has no roles.
 * 2. Channel has rows → restricted channel.
 *    Only roles listed in channel_role_access count.
 *    If none match → 0 (no access).
 *    per-role permission override in channel_role_access.permissions (NULL = use role's global permissions).
 */
export function globalRolePermissionsSql(userParam: string, channelParam: string): string {
  return `
    SELECT CASE
      -- Open channel (no access rules)
      WHEN NOT EXISTS (
        SELECT 1 FROM channel_role_access cra2 WHERE cra2.channel_id = ${channelParam}
      ) THEN (
        SELECT COALESCE(
          CASE
            WHEN COUNT(*) FILTER (WHERE r.permissions = ${PERM_ADMIN}) > 0 THEN ${PERM_ADMIN}
            ELSE
              (CASE WHEN COUNT(*) FILTER (WHERE (r.permissions & ${PERM_READ})   != 0) > 0 THEN ${PERM_READ}   ELSE 0 END) |
              (CASE WHEN COUNT(*) FILTER (WHERE (r.permissions & ${PERM_WRITE})  != 0) > 0 THEN ${PERM_WRITE}  ELSE 0 END) |
              (CASE WHEN COUNT(*) FILTER (WHERE (r.permissions & ${PERM_VOICE})  != 0) > 0 THEN ${PERM_VOICE}  ELSE 0 END) |
              (CASE WHEN COUNT(*) FILTER (WHERE (r.permissions & ${PERM_MANAGE}) != 0) > 0 THEN ${PERM_MANAGE} ELSE 0 END)
          END,
          NULL
        )
        FROM role_members rm
        JOIN roles r ON r.id = rm.role_id
        WHERE rm.user_id = ${userParam}
      )
      -- Restricted channel: intersect user roles with access list
      ELSE (
        SELECT CASE
          WHEN COUNT(*) = 0 THEN 0
          WHEN COUNT(*) FILTER (WHERE COALESCE(cra.permissions, r.permissions) = ${PERM_ADMIN}) > 0 THEN ${PERM_ADMIN}
          ELSE
            (CASE WHEN COUNT(*) FILTER (WHERE (COALESCE(cra.permissions, r.permissions) & ${PERM_READ})   != 0) > 0 THEN ${PERM_READ}   ELSE 0 END) |
            (CASE WHEN COUNT(*) FILTER (WHERE (COALESCE(cra.permissions, r.permissions) & ${PERM_WRITE})  != 0) > 0 THEN ${PERM_WRITE}  ELSE 0 END) |
            (CASE WHEN COUNT(*) FILTER (WHERE (COALESCE(cra.permissions, r.permissions) & ${PERM_VOICE})  != 0) > 0 THEN ${PERM_VOICE}  ELSE 0 END) |
            (CASE WHEN COUNT(*) FILTER (WHERE (COALESCE(cra.permissions, r.permissions) & ${PERM_MANAGE}) != 0) > 0 THEN ${PERM_MANAGE} ELSE 0 END)
          END
        FROM role_members rm
        JOIN roles r ON r.id = rm.role_id
        JOIN channel_role_access cra ON cra.role_id = r.id AND cra.channel_id = ${channelParam}
        WHERE rm.user_id = ${userParam}
      )
    END AS role_permissions
  `;
}

export async function getEffectivePermission(channelId: string, userId: string): Promise<number | null> {
  const res = await pool.query(
    `SELECT CASE
       WHEN u.is_admin THEN ${PERM_ADMIN}
       ELSE COALESCE(role_perm.role_permissions, c.default_permissions)
     END AS effective
     FROM channels c
     JOIN users u ON u.id = $2
     LEFT JOIN LATERAL (
       ${globalRolePermissionsSql('$2', 'c.id')}
     ) role_perm ON TRUE
     WHERE c.id = $1`,
    [channelId, userId],
  );

  if (res.rowCount === 0) return null;
  return Number(res.rows[0].effective);
}

// Legacy alias — kept so existing callers compile during migration.
// Prefer globalRolePermissionsSql for new code.
export function rolePermissionsSql(userExpr: string, channelExpr: string): string {
  return globalRolePermissionsSql(userExpr, channelExpr);
}
