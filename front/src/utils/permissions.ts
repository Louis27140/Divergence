// Permission bitmask — must match back/src/routes/channels.ts
export const PERM = {
  NONE:   0,
  READ:   1,   // see channel, read messages
  WRITE:  2,   // send messages
  VOICE:  4,   // join voice
  MANAGE: 8,   // manage channel permissions
  ALL:    15,  // READ | WRITE | VOICE | MANAGE
  ADMIN:  -1,  // all permissions, overrides everything
} as const;

export type PermValue = -1 | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15;

/** Returns true if userPerm grants the requested flag. */
export function hasPerm(userPerm: number | undefined | null, flag: number): boolean {
  if (userPerm === undefined || userPerm === null) return false;
  if (userPerm === PERM.ADMIN) return true;
  return (userPerm & flag) !== 0;
}

/** Toggle a single bit. If current perm is ADMIN, demotes to all bits minus this one. */
export function togglePermBit(current: number, bit: number): number {
  if (current === PERM.ADMIN) return PERM.ALL & ~bit;
  return current ^ bit;
}

/** Toggle the ADMIN flag. Admin → ALL (15), non-admin → ADMIN (-1). */
export function toggleAdmin(current: number): number {
  return current === PERM.ADMIN ? PERM.ALL : PERM.ADMIN;
}

/** Human-readable notation: "ARWVM" with dimmed bits as "-" */
export function permLabel(perm: number): string {
  if (perm === PERM.ADMIN) return "ADMIN";
  const r = (perm & PERM.READ)   ? "R" : "·";
  const w = (perm & PERM.WRITE)  ? "W" : "·";
  const v = (perm & PERM.VOICE)  ? "V" : "·";
  const m = (perm & PERM.MANAGE) ? "M" : "·";
  return `${r}${w}${v}${m}`;
}
