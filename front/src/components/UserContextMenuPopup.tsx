import { useEffect, useState } from "react";
import type { Role } from "../types";
import { UserAvatar } from "./UserAvatar";

const API_BASE = import.meta.env.VITE_API_URL ?? "";

type Props = {
  x: number;
  y: number;
  userId: string;
  username: string;
  avatarUrl?: string | null;
  isAdmin: boolean;
  token: string;
  onClose: () => void;
};

export function UserContextMenuPopup({
  x,
  y,
  userId,
  username,
  avatarUrl,
  isAdmin,
  token,
  onClose,
}: Props) {
  const [showRoles, setShowRoles] = useState(false);
  const [allRoles, setAllRoles] = useState<Role[]>([]);
  const [userRoleIds, setUserRoleIds] = useState<number[]>([]);
  const [loadingRoles, setLoadingRoles] = useState(false);
  const [savingRoles, setSavingRoles] = useState(false);

  // ESC to close
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function authHeaders() {
    return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  }

  async function openRoles() {
    setShowRoles(true);
    setLoadingRoles(true);
    try {
      const [allRes, userRes] = await Promise.all([
        fetch(`${API_BASE}/admin/roles`, { headers: authHeaders() }).then((r) => r.json()),
        fetch(`${API_BASE}/admin/users/${userId}/roles`, { headers: authHeaders() }).then((r) => r.json()),
      ]);
      setAllRoles(allRes.roles ?? []);
      setUserRoleIds((userRes.roles ?? []).map((r: Role) => r.id));
    } finally {
      setLoadingRoles(false);
    }
  }

  function toggleRole(roleId: number) {
    setUserRoleIds((prev) =>
      prev.includes(roleId) ? prev.filter((id) => id !== roleId) : [...prev, roleId],
    );
  }

  async function saveRoles() {
    setSavingRoles(true);
    try {
      await fetch(`${API_BASE}/admin/users/${userId}/roles`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ role_ids: userRoleIds }),
      });
    } finally {
      setSavingRoles(false);
    }
  }

  async function promoteAdmin() {
    await fetch(`${API_BASE}/admin/users/${userId}`, {
      method: "PATCH",
      headers: authHeaders(),
      body: JSON.stringify({ is_admin: true }),
    });
    onClose();
  }

  async function deleteUser() {
    if (!confirm(`Delete user "${username}"? This action cannot be undone.`)) return;
    await fetch(`${API_BASE}/admin/users/${userId}`, {
      method: "DELETE",
      headers: authHeaders(),
    });
    onClose();
  }

  return (
    <>
      <button
        type="button"
        className="m-user-ctx-backdrop"
        onClick={onClose}
        aria-label="Close"
      />
      <div className="m-user-ctx" style={{ left: x, top: y }}>
        <div className="m-user-ctx__header">
          <UserAvatar username={username} avatarUrl={avatarUrl} size={22} />
          <span>{username}</span>
        </div>

        {!showRoles ? (
          <>
            {isAdmin && (
              <button
                type="button"
                className="m-user-ctx__item"
                onClick={openRoles}
              >
                Assign roles
              </button>
            )}
            {isAdmin && (
              <button
                type="button"
                className="m-user-ctx__item"
                onClick={promoteAdmin}
              >
                Promote admin
              </button>
            )}
            {isAdmin && (
              <button
                type="button"
                className="m-user-ctx__item m-user-ctx__item--danger"
                onClick={deleteUser}
              >
                Delete user
              </button>
            )}
            {!isAdmin && (
              <div className="m-user-ctx__item" style={{ color: "var(--m-text-3)", cursor: "default" }}>
                {username}
              </div>
            )}
          </>
        ) : (
          <div className="m-user-ctx__roles">
            <div className="m-user-ctx__roles-title">Roles for {username}</div>
            {loadingRoles ? (
              <div className="m-user-ctx__item" style={{ color: "var(--m-text-3)" }}>Loading...</div>
            ) : allRoles.length === 0 ? (
              <div className="m-user-ctx__item" style={{ color: "var(--m-text-3)" }}>No roles created</div>
            ) : (
              allRoles.map((role) => (
                <label key={role.id} className="m-user-ctx__role-row">
                  <input
                    type="checkbox"
                    checked={userRoleIds.includes(role.id)}
                    onChange={() => toggleRole(role.id)}
                    disabled={savingRoles}
                  />
                  <span className="m-user-ctx__role-dot" style={{ background: role.color }} />
                  <span>{role.name}</span>
                </label>
              ))
            )}
            <button
              type="button"
              className="m-user-ctx__save-btn"
              onClick={saveRoles}
              disabled={savingRoles || loadingRoles}
            >
              {savingRoles ? "Saving..." : "Save"}
            </button>
          </div>
        )}
      </div>
    </>
  );
}
