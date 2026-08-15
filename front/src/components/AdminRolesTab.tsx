import { useState } from "react";
import type { Role, User } from "../types";
import { PERM } from "../utils/permissions";
import { PermGrid } from "./PermGrid";
import { UserAvatar } from "./UserAvatar";

const API_BASE = import.meta.env.VITE_API_URL ?? "";

type Props = {
  token: string;
  allRoles: Role[];
  allUsers: User[];
  onRoleCreated: (role: Role) => void;
  onRoleUpdated: (role: Role) => void;
  onRoleDeleted: (roleId: number) => void;
  onMemberCountChanged: (roleId: number, delta: number) => void;
};

type RoleDraft = {
  id: number;
  name: string;
  color: string;
  permissions: number;
  isDefault: boolean;
  memberIds: string[];
  membersLoaded: boolean;
};

export function AdminRolesTab({
  token,
  allRoles,
  allUsers,
  onRoleCreated,
  onRoleUpdated,
  onRoleDeleted,
  onMemberCountChanged,
}: Props) {
  // Local draft state per role (edits before save)
  const [drafts, setDrafts] = useState<Record<number, RoleDraft>>({});
  const [expandedRoleId, setExpandedRoleId] = useState<number | null>(null);
  const [saving, setSaving] = useState<number | null>(null);
  const [deleting, setDeleting] = useState<number | null>(null);
  const [loadingMembersFor, setLoadingMembersFor] = useState<number | null>(null);

  // New role form
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState("#7aa2ff");
  const [newPerms, setNewPerms] = useState(PERM.READ | PERM.WRITE | PERM.VOICE);
  const [creating, setCreating] = useState(false);

  function authHeaders() {
    return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  }

  function getDraft(role: Role): RoleDraft {
    return drafts[role.id] ?? {
      id: role.id,
      name: role.name,
      color: role.color,
      permissions: role.permissions,
      isDefault: role.is_default ?? false,
      memberIds: [],
      membersLoaded: false,
    };
  }

  function patchDraft(roleId: number, patch: Partial<RoleDraft>) {
    setDrafts((prev) => {
      const current = prev[roleId] ?? getDraft(allRoles.find((r) => r.id === roleId)!);
      return { ...prev, [roleId]: { ...current, ...patch } };
    });
  }

  async function loadMembers(roleId: number) {
    setLoadingMembersFor(roleId);
    try {
      const res = await fetch(`${API_BASE}/admin/roles/${roleId}/members`, {
        headers: authHeaders(),
      });
      const data = await res.json();
      const ids: string[] = (data.members ?? []).map((u: User) => u.id);
      patchDraft(roleId, { memberIds: ids, membersLoaded: true });
    } finally {
      setLoadingMembersFor(null);
    }
  }

  function toggleExpand(role: Role) {
    if (expandedRoleId === role.id) {
      setExpandedRoleId(null);
    } else {
      setExpandedRoleId(role.id);
      // Always reload members when opening to stay in sync
      const draft = getDraft(role);
      // Initialize draft from current role data
      if (!drafts[role.id]) {
        setDrafts((prev) => ({
          ...prev,
          [role.id]: {
            id: role.id,
            name: role.name,
            color: role.color,
            permissions: role.permissions,
            isDefault: role.is_default ?? false,
            memberIds: [],
            membersLoaded: false,
          },
        }));
      }
      loadMembers(role.id);
    }
  }

  async function saveRole(roleId: number) {
    const draft = drafts[roleId];
    if (!draft) return;
    const prevRole = allRoles.find((r) => r.id === roleId);
    if (!prevRole) return;

    setSaving(roleId);
    try {
      // Save role metadata
      const metaRes = await fetch(`${API_BASE}/admin/roles/${roleId}`, {
        method: "PATCH",
        headers: authHeaders(),
        body: JSON.stringify({
          name: draft.name,
          color: draft.color,
          permissions: draft.permissions,
          is_default: draft.isDefault,
        }),
      });
      if (metaRes.ok) {
        const data = await metaRes.json();
        onRoleUpdated(data.role);
      }

      // Save members
      const prevMemberCount = prevRole.member_count ?? 0;
      await fetch(`${API_BASE}/admin/roles/${roleId}/members`, {
        method: "PUT",
        headers: authHeaders(),
        body: JSON.stringify({ user_ids: draft.memberIds }),
      });

      const delta = draft.memberIds.length - prevMemberCount;
      if (delta !== 0) onMemberCountChanged(roleId, delta);
    } finally {
      setSaving(null);
    }
  }

  async function deleteRole(role: Role) {
    if (!confirm(`Delete role "${role.name}"?`)) return;
    setDeleting(role.id);
    const res = await fetch(`${API_BASE}/admin/roles/${role.id}`, {
      method: "DELETE",
      headers: authHeaders(),
    });
    if (res.ok) {
      onRoleDeleted(role.id);
      if (expandedRoleId === role.id) setExpandedRoleId(null);
      setDrafts((prev) => {
        const next = { ...prev };
        delete next[role.id];
        return next;
      });
    }
    setDeleting(null);
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim() || creating) return;
    setCreating(true);
    try {
      const res = await fetch(`${API_BASE}/admin/roles`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ name: newName.trim(), color: newColor, permissions: newPerms }),
      });
      const data = await res.json();
      if (res.ok) {
        onRoleCreated(data.role); // propagate to shared state
        setNewName("");
        setNewColor("#7aa2ff");
        setNewPerms(PERM.READ | PERM.WRITE | PERM.VOICE);
      }
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="m-admin-tab-content">
      <div className="m-admin-section">
        <div className="m-admin-section__title">Global roles ({allRoles.length})</div>

        <div className="m-admin-list">
          {allRoles.length === 0 && (
            <div className="m-admin-empty">No roles - create one below</div>
          )}

          {allRoles.map((role) => {
            const isExpanded = expandedRoleId === role.id;
            const isSaving = saving === role.id;
            const isDeleting = deleting === role.id;
            const isLoadingMembers = loadingMembersFor === role.id;
            const draft = getDraft(role);
            const availableUsers = allUsers.filter((u) => !draft.memberIds.includes(u.id));

            return (
              <div key={role.id} className="m-admin-role-row">
                <div className="m-admin-role-row__header">
                  <span className="m-admin-role-row__dot" style={{ background: role.color }} />
                  <button
                    type="button"
                    className="m-admin-role-row__name"
                    onClick={() => toggleExpand(role)}
                  >
                    {role.name}
                    <span className="m-admin-role-row__count">({role.member_count ?? 0})</span>
                    {role.is_default && <span className="m-admin-badge m-admin-badge--default">DEFAULT</span>}
                    <span className="m-admin-user-row__expand">{isExpanded ? "▲" : "▼"}</span>
                  </button>
                  <button
                    type="button"
                    className="m-admin-btn m-admin-btn--sm m-admin-btn--danger"
                    onClick={() => deleteRole(role)}
                    disabled={isDeleting}
                  >
                    Delete
                  </button>
                </div>

                {isExpanded && (
                  <div className="m-admin-role-row__body">
                    <div className="m-admin-row">
                      <label className="m-admin-label">Name</label>
                      <input
                        className="m-admin-input"
                        value={draft.name}
                        onChange={(e) => patchDraft(role.id, { name: e.target.value })}
                        disabled={isSaving}
                      />
                    </div>

                    <div className="m-admin-row">
                      <label className="m-admin-label">Color</label>
                      <input
                        type="color"
                        className="m-admin-color"
                        value={draft.color}
                        onChange={(e) => patchDraft(role.id, { color: e.target.value })}
                        disabled={isSaving}
                      />
                      <span className="m-admin-color-preview" style={{ background: draft.color }}>
                        {draft.color}
                      </span>
                    </div>

                    <div className="m-admin-row">
                      <label className="m-admin-label">Permissions</label>
                      <PermGrid
                        value={draft.permissions}
                        onChange={(v) => patchDraft(role.id, { permissions: v })}
                        disabled={isSaving}
                      />
                    </div>

                    <div className="m-admin-row">
                      <label className="m-admin-label">Default</label>
                      <label className="m-admin-role-check" style={{ gap: 8 }}>
                        <input
                          type="checkbox"
                          checked={draft.isDefault}
                          onChange={(e) => patchDraft(role.id, { isDefault: e.target.checked })}
                          disabled={isSaving}
                        />
                        <span style={{ color: "var(--m-text-2)", fontSize: 12 }}>
                          Auto-assign to new users
                        </span>
                      </label>
                    </div>

                    <div className="m-admin-role-members">
                      <div className="m-admin-label">Members</div>

                      {isLoadingMembers ? (
                        <div className="m-admin-empty">Loading members...</div>
                      ) : (
                        <>
                          <div className="m-perm-role__members">
                            {draft.memberIds.length === 0 ? (
                              <span className="m-admin-empty">No members</span>
                            ) : (
                              draft.memberIds.map((memberId) => {
                                const user = allUsers.find((u) => u.id === memberId);
                                return (
                                  <span key={memberId} className="m-perm-role__member-chip">
                                    {user && (
                                      <UserAvatar
                                        className="m-perm-role__member-avatar"
                                        username={user.username}
                                        avatarUrl={user.avatar_url}
                                        size={16}
                                      />
                                    )}
                                    {user?.username ?? memberId}
                                    <button
                                      type="button"
                                      className="m-perm-role__member-remove"
                                      onClick={() =>
                                        patchDraft(role.id, {
                                          memberIds: draft.memberIds.filter((id) => id !== memberId),
                                        })
                                      }
                                      disabled={isSaving}
                                    >
                                      x
                                    </button>
                                  </span>
                                );
                              })
                            )}
                          </div>

                          {availableUsers.length > 0 && (
                            <div className="m-perm-role__available">
                              <div className="m-perm-role__available-title">Add member</div>
                              <div className="m-perm-role__available-list">
                                {availableUsers.map((u) => (
                                  <button
                                    key={u.id}
                                    type="button"
                                    className="m-perm-role__available-chip"
                                    onClick={() => {
                                      patchDraft(role.id, {
                                        memberIds: [...draft.memberIds, u.id],
                                      });
                                    }}
                                    disabled={isSaving}
                                    title={`Add ${u.username}`}
                                  >
                                    <UserAvatar
                                      className="m-perm-role__member-avatar"
                                      username={u.username}
                                      avatarUrl={u.avatar_url}
                                      size={16}
                                    />
                                    <span>{u.username}</span>
                                    <span className="m-perm-role__available-plus">+</span>
                                  </button>
                                ))}
                              </div>
                            </div>
                          )}
                        </>
                      )}
                    </div>

                    <button
                      type="button"
                      className="m-admin-btn m-admin-btn--primary"
                      onClick={() => saveRole(role.id)}
                      disabled={isSaving}
                    >
                      {isSaving ? "Saving..." : "Save"}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Create role form */}
      <div className="m-admin-section">
        <div className="m-admin-section__title">Create role</div>
        <form className="m-admin-create-form" onSubmit={handleCreate}>
          <input
            className="m-admin-input"
            placeholder="Role name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            disabled={creating}
          />
          <input
            type="color"
            className="m-admin-color"
            value={newColor}
            onChange={(e) => setNewColor(e.target.value)}
            disabled={creating}
            title="Role color"
          />
          <PermGrid value={newPerms} onChange={setNewPerms} disabled={creating} />
          <button
            type="submit"
            className="m-admin-btn m-admin-btn--primary"
            disabled={creating || !newName.trim()}
          >
            {creating ? "Creating..." : "+ Create"}
          </button>
        </form>
      </div>
    </div>
  );
}
