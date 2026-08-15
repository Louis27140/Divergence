import { useState } from "react";
import type { Role, User } from "../types";
import { UserAvatar } from "./UserAvatar";

const API_BASE = import.meta.env.VITE_API_URL ?? "";

type ProvisionResult = {
  user: User;
  invite_token: string;
  invite_url?: string;
};

type Props = {
  token: string;
  currentUserId: string;
  users: User[];
  allRoles: Role[];
  onUserCreated: (user: User) => void;
  onUserUpdated: (user: User) => void;
  onUserDeleted: (userId: string) => void;
};

export function AdminUsersTab({
  token,
  currentUserId,
  users,
  allRoles,
  onUserCreated,
  onUserUpdated,
  onUserDeleted,
}: Props) {
  // Per-user expanded role assignment state
  const [userRoles, setUserRoles] = useState<Record<string, number[]>>({});
  const [loadingRolesFor, setLoadingRolesFor] = useState<string | null>(null);
  const [expandedUserId, setExpandedUserId] = useState<string | null>(null);
  const [savingRolesFor, setSavingRolesFor] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Create form
  const [newUsername, setNewUsername] = useState("");
  const [creating, setCreating] = useState(false);
  const [createResult, setCreateResult] = useState<ProvisionResult | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);

  function authHeaders() {
    return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  }

  async function loadUserRoles(userId: string) {
    setLoadingRolesFor(userId);
    try {
      const res = await fetch(`${API_BASE}/admin/users/${userId}/roles`, {
        headers: authHeaders(),
      });
      const data = await res.json();
      const ids: number[] = (data.roles ?? []).map((r: Role) => r.id);
      setUserRoles((prev) => ({ ...prev, [userId]: ids }));
    } finally {
      setLoadingRolesFor(null);
    }
  }

  function toggleExpand(userId: string) {
    if (expandedUserId === userId) {
      setExpandedUserId(null);
    } else {
      setExpandedUserId(userId);
      // Always reload when opening to stay in sync
      loadUserRoles(userId);
    }
  }

  function assignRoleToUser(userId: string, roleId: number) {
    setUserRoles((prev) => {
      const current = prev[userId] ?? [];
      if (current.includes(roleId)) return prev;
      return { ...prev, [userId]: [...current, roleId] };
    });
  }

  function removeRoleFromUser(userId: string, roleId: number) {
    setUserRoles((prev) => {
      const current = prev[userId] ?? [];
      if (!current.includes(roleId)) return prev;
      return { ...prev, [userId]: current.filter((id) => id !== roleId) };
    });
  }

  async function saveUserRoles(userId: string) {
    setSavingRolesFor(userId);
    try {
      await fetch(`${API_BASE}/admin/users/${userId}/roles`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ role_ids: userRoles[userId] ?? [] }),
      });
    } finally {
      setSavingRolesFor(null);
    }
  }

  async function toggleAdmin(user: User) {
    const res = await fetch(`${API_BASE}/admin/users/${user.id}`, {
      method: "PATCH",
      headers: authHeaders(),
      body: JSON.stringify({ is_admin: !user.is_admin }),
    });
    if (res.ok) {
      const data = await res.json();
      onUserUpdated(data.user);
    }
  }

  async function deleteUser(user: User) {
    if (!confirm(`Delete user "${user.username}"? This action cannot be undone.`)) return;
    setDeletingId(user.id);
    const res = await fetch(`${API_BASE}/admin/users/${user.id}`, {
      method: "DELETE",
      headers: authHeaders(),
    });
    if (res.ok) {
      onUserDeleted(user.id);
      if (expandedUserId === user.id) setExpandedUserId(null);
    }
    setDeletingId(null);
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!newUsername.trim() || creating) return;
    setCreating(true);
    setCreateError(null);
    setCreateResult(null);
    try {
      const res = await fetch(`${API_BASE}/admin/users`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ username: newUsername.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Error");
      setCreateResult(data);
      onUserCreated(data.user); // propagate to shared state
      setNewUsername("");
    } catch (err: any) {
      setCreateError(err?.message ?? "Error");
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="m-admin-tab-content">
      {/* Create user form */}
      <div className="m-admin-section">
        <div className="m-admin-section__title">Create user</div>
        <form className="m-admin-create-form" onSubmit={handleCreate}>
          <input
            className="m-admin-input"
            placeholder="Username"
            value={newUsername}
            onChange={(e) => setNewUsername(e.target.value)}
            disabled={creating}
            minLength={3}
            maxLength={32}
          />
          <button
            type="submit"
            className="m-admin-btn m-admin-btn--primary"
            disabled={creating || !newUsername.trim()}
          >
            {creating ? "Creating..." : "+ Create"}
          </button>
        </form>

        {createError && <div className="m-admin-error">{createError}</div>}

        {createResult && (
          <div className="m-admin-result">
            <div className="m-admin-result__row">
              <span className="m-admin-result__label">User</span>
              <span className="m-admin-result__value">{createResult.user.username}</span>
            </div>
            {createResult.invite_url ? (
              <div className="m-admin-result__row">
                <span className="m-admin-result__label">Invite link</span>
                <button
                  className="m-admin-btn m-admin-btn--sm"
                  onClick={() => navigator.clipboard.writeText(createResult.invite_url!)}
                  type="button"
                >
                  Copy link
                </button>
              </div>
            ) : (
              <div className="m-admin-result__row">
                <span className="m-admin-result__label">Token</span>
                <span className="m-admin-result__value m-admin-result__mono">{createResult.invite_token}</span>
                <button
                  className="m-admin-btn m-admin-btn--sm"
                  onClick={() => navigator.clipboard.writeText(createResult.invite_token)}
                  type="button"
                >
                  Copy
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* User list */}
      <div className="m-admin-section">
        <div className="m-admin-section__title">Users ({users.length})</div>
        <div className="m-admin-list">
          {users.map((user) => {
            const isExpanded = expandedUserId === user.id;
            const isSelf = user.id === currentUserId;
            const currentUserRoleIds = userRoles[user.id] ?? [];
            const isLoadingRoles = loadingRolesFor === user.id;
            const assignedRoles = allRoles.filter((role) => currentUserRoleIds.includes(role.id));
            const availableRoles = allRoles.filter((role) => !currentUserRoleIds.includes(role.id));

            return (
              <div key={user.id} className="m-admin-user-row">
                <div className="m-admin-user-row__main">
                  <UserAvatar username={user.username} avatarUrl={user.avatar_url} size={28} />
                  <button
                    type="button"
                    className="m-admin-user-row__name"
                    onClick={() => toggleExpand(user.id)}
                  >
                    {user.username}
                    {user.is_admin && <span className="m-admin-badge m-admin-badge--admin">ADMIN</span>}
                    {user.must_change_password && <span className="m-admin-badge m-admin-badge--pending">PENDING</span>}
                    <span className="m-admin-user-row__expand">{isExpanded ? "^" : "v"}</span>
                  </button>
                  <div className="m-admin-user-row__actions">
                    {!isSelf && (
                      <>
                        <button
                          type="button"
                          className="m-admin-btn m-admin-btn--sm"
                          onClick={() => toggleAdmin(user)}
                          title={user.is_admin ? "Demote admin" : "Promote admin"}
                        >
                          {user.is_admin ? "-admin" : "+admin"}
                        </button>
                        <button
                          type="button"
                          className="m-admin-btn m-admin-btn--sm m-admin-btn--danger"
                          onClick={() => deleteUser(user)}
                          disabled={deletingId === user.id}
                        >
                          Delete
                        </button>
                      </>
                    )}
                  </div>
                </div>

                {isExpanded && (
                  <div className="m-admin-user-row__roles">
                    <div className="m-admin-user-row__roles-title">Assigned roles</div>
                    {isLoadingRoles ? (
                      <div className="m-admin-empty">Loading...</div>
                    ) : allRoles.length === 0 ? (
                      <div className="m-admin-empty">No roles created</div>
                    ) : (
                      <>
                        <div className="m-perm-role__members">
                          {assignedRoles.length === 0 ? (
                            <span className="m-admin-empty">No assigned role</span>
                          ) : (
                            assignedRoles.map((role) => (
                              <span key={role.id} className="m-perm-role__member-chip">
                                <span className="m-admin-role-check__dot" style={{ background: role.color }} />
                                <span>{role.name}</span>
                                <button
                                  type="button"
                                  className="m-perm-role__member-remove"
                                  onClick={() => removeRoleFromUser(user.id, role.id)}
                                  disabled={savingRolesFor === user.id}
                                  title={`Remove ${role.name}`}
                                >
                                  x
                                </button>
                              </span>
                            ))
                          )}
                        </div>

                        <div className="m-perm-role__available">
                          <div className="m-perm-role__available-title">Add role</div>
                          {availableRoles.length === 0 ? (
                            <span className="m-admin-empty">All roles are already assigned</span>
                          ) : (
                            <div className="m-perm-role__available-list">
                              {availableRoles.map((role) => (
                                <button
                                  key={role.id}
                                  type="button"
                                  className="m-perm-role__available-chip"
                                  onClick={() => assignRoleToUser(user.id, role.id)}
                                  disabled={savingRolesFor === user.id}
                                  title={`Add ${role.name}`}
                                >
                                  <span className="m-admin-role-check__dot" style={{ background: role.color }} />
                                  <span>{role.name}</span>
                                  <span className="m-perm-role__available-plus">+</span>
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      </>
                    )}
                    {!isLoadingRoles && (
                      <button
                        type="button"
                        className="m-admin-btn m-admin-btn--primary m-admin-btn--sm"
                        onClick={() => saveUserRoles(user.id)}
                        disabled={savingRolesFor === user.id}
                        style={{ alignSelf: "flex-start", marginTop: 4 }}
                      >
                        {savingRolesFor === user.id ? "Saving..." : "Save"}
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

