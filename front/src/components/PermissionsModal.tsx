import { useEffect, useMemo, useState } from "react";
import type { Channel, User } from "../types";
import { PERM, hasPerm, toggleAdmin, togglePermBit } from "../utils/permissions";
import { UserAvatar } from "./UserAvatar";

const API_BASE = import.meta.env.VITE_API_URL ?? "";

const BIT_DEFS: { label: string; flag: number; title: string }[] = [
  { label: "R", flag: PERM.READ, title: "Read - see channel and messages" },
  { label: "W", flag: PERM.WRITE, title: "Write - send messages" },
  { label: "V", flag: PERM.VOICE, title: "Voice - join voice channel" },
  { label: "M", flag: PERM.MANAGE, title: "Manage - edit channel roles" },
];

type RoleDraft = {
  name: string;
  permissions: number;
  members: string[];
};

type Props = {
  channel: Channel;
  token: string;
  onClose: () => void;
};

function PermGrid({
  perm,
  onChange,
  disabled,
}: {
  perm: number;
  onChange: (next: number) => void;
  disabled?: boolean;
}) {
  const isAdmin = perm === PERM.ADMIN;

  return (
    <div className="m-perm-grid">
      <button
        type="button"
        className={`m-perm-bit${isAdmin ? " m-perm-bit--on" : " m-perm-bit--off"}`}
        onClick={() => !disabled && onChange(toggleAdmin(perm))}
        title="Admin - all permissions"
      >
        A
      </button>

      {BIT_DEFS.map(({ label, flag, title }) => {
        const active = isAdmin || (perm & flag) !== 0;
        return (
          <button
            key={flag}
            type="button"
            className={`m-perm-bit${active ? " m-perm-bit--on" : " m-perm-bit--off"}${isAdmin ? " m-perm-bit--inherited" : ""}`}
            onClick={() => !disabled && !isAdmin && onChange(togglePermBit(perm, flag))}
            title={title}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

export function PermissionsModal({ channel, token, onClose }: Props) {
  const [defaultPerm, setDefaultPerm] = useState<number>(PERM.ALL ^ PERM.MANAGE);
  const [roles, setRoles] = useState<RoleDraft[]>([]);
  const [allUsers, setAllUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);

  const canManage = hasPerm(channel.my_permissions, PERM.MANAGE);

  const usersById = useMemo(() => {
    return new Map(allUsers.map((u) => [u.id, u]));
  }, [allUsers]);

  useEffect(() => {
    setLoading(true);
    setErrorText(null);

    Promise.all([
      fetch(`${API_BASE}/channels/${channel.id}/members`, {
        headers: { Authorization: `Bearer ${token}` },
      }).then((r) => r.json()),
      fetch(`${API_BASE}/users`, {
        headers: { Authorization: `Bearer ${token}` },
      }).then((r) => r.json()),
    ])
      .then(([membersRes, usersRes]) => {
        setDefaultPerm(membersRes.default_permissions ?? 7);
        setAllUsers(usersRes.users ?? []);

        const roleRows: any[] = Array.isArray(membersRes.roles) ? membersRes.roles : [];
        setRoles(
          roleRows.map((role, index) => {
            const roleMembers: any[] = Array.isArray(role.members) ? role.members : [];
            const memberIds = roleMembers
              .map((member) => member?.id)
              .filter((id) => typeof id === "string");

            return {
              name: typeof role.name === "string" && role.name.trim().length > 0
                ? role.name
                : `role-${index + 1}`,
              permissions: typeof role.permissions === "number" ? role.permissions : 0,
              members: Array.from(new Set(memberIds)),
            } as RoleDraft;
          }),
        );
      })
      .catch(() => {
        setErrorText("Loading failed");
      })
      .finally(() => setLoading(false));
  }, [channel.id, token]);

  function setRoleAt(index: number, nextRole: RoleDraft) {
    setRoles((prev) => prev.map((role, i) => (i === index ? nextRole : role)));
  }

  function handleAddRole() {
    setRoles((prev) => [
      ...prev,
      {
        name: `role-${prev.length + 1}`,
        permissions: PERM.READ | PERM.WRITE | PERM.VOICE,
        members: [],
      },
    ]);
  }

  function handleRemoveRole(index: number) {
    setRoles((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSave() {
    if (!canManage || saving) return;

    const payloadRoles = roles.map((role) => ({
      name: role.name.trim(),
      permissions: role.permissions,
      members: role.members,
    }));

    setSaving(true);
    setErrorText(null);
    try {
      const res = await fetch(`${API_BASE}/channels/${channel.id}/members`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          default_permissions: defaultPerm,
          roles: payloadRoles,
        }),
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || "save_failed");
      }
    } catch (error: any) {
      setErrorText(error?.message ?? "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="m-modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="m-modal">
        <div className="m-modal__header">
          <span className="m-modal__title">Roles - #{channel.name}</span>
          <button className="m-modal__close" onClick={onClose} type="button">X</button>
        </div>

        {loading ? (
          <div className="m-perm__empty">Loading...</div>
        ) : (
          <>
            <div className="m-perm-legend">
              <span className="m-perm-legend__item"><span className="m-perm-legend__key">A</span> Admin</span>
              <span className="m-perm-legend__item"><span className="m-perm-legend__key">R</span> Read</span>
              <span className="m-perm-legend__item"><span className="m-perm-legend__key">W</span> Write</span>
              <span className="m-perm-legend__item"><span className="m-perm-legend__key">V</span> Voice</span>
              <span className="m-perm-legend__item"><span className="m-perm-legend__key">M</span> Manage</span>
            </div>

            <div className="m-perm__section">
              <div className="m-perm__label">Default permissions</div>
              <div className="m-perm__user m-perm__user--default">
                <span className="m-perm__user-name">
                  <span className="m-perm__user-dot">O</span>
                  Everyone
                </span>
                <PermGrid
                  perm={defaultPerm}
                  onChange={setDefaultPerm}
                  disabled={saving || !canManage}
                />
              </div>
            </div>

            <div className="m-perm__section">
              <div className="m-perm__label">
                Roles
                <span className="m-perm__count"> ({roles.length})</span>
              </div>

              <div className="m-perm-role-list">
                {roles.length === 0 ? (
                  <div className="m-perm__empty">No roles yet</div>
                ) : (
                  roles.map((role, roleIndex) => {
                    const availableUsers = allUsers.filter((u) => !role.members.includes(u.id));

                    return (
                      <div className="m-perm-role" key={`${role.name}-${roleIndex}`}>
                        <div className="m-perm-role__top">
                          <input
                            className="m-perm-role__name"
                            value={role.name}
                            onChange={(e) => {
                              setRoleAt(roleIndex, { ...role, name: e.target.value });
                            }}
                            disabled={!canManage || saving}
                            placeholder="role-name"
                          />
                          {canManage && (
                            <button
                              type="button"
                              className="m-perm__remove-btn"
                              onClick={() => handleRemoveRole(roleIndex)}
                              disabled={saving}
                              title="Remove role"
                            >
                              X
                            </button>
                          )}
                        </div>

                        <PermGrid
                          perm={role.permissions}
                          onChange={(next) => setRoleAt(roleIndex, { ...role, permissions: next })}
                          disabled={!canManage || saving}
                        />

                        <div className="m-perm-role__members">
                          {role.members.length === 0 ? (
                            <span className="m-perm-role__members-empty">No members</span>
                          ) : (
                            role.members.map((memberId) => (
                              <span key={memberId} className="m-perm-role__member-chip">
                                {(() => {
                                  const member = usersById.get(memberId);
                                  if (!member) return memberId;

                                  return (
                                    <>
                                      <UserAvatar
                                        className="m-perm-role__member-avatar"
                                        username={member.username}
                                        avatarUrl={member.avatar_url}
                                        size={16}
                                      />
                                      {member.username}
                                    </>
                                  );
                                })()}
                                {canManage && (
                                  <button
                                    type="button"
                                    className="m-perm-role__member-remove"
                                    onClick={() => {
                                      setRoleAt(roleIndex, {
                                        ...role,
                                        members: role.members.filter((id) => id !== memberId),
                                      });
                                    }}
                                    disabled={saving}
                                    title="Remove member"
                                  >
                                    x
                                  </button>
                                )}
                              </span>
                            ))
                          )}
                        </div>

                        {canManage && (
                          <div className="m-perm-role__available">
                            <div className="m-perm-role__available-title">Add members</div>
                            {availableUsers.length === 0 ? (
                              <span className="m-perm-role__members-empty">All users already added</span>
                            ) : (
                              <div className="m-perm-role__available-list">
                                {availableUsers.map((u) => (
                                  <button
                                    key={u.id}
                                    type="button"
                                    className="m-perm-role__available-chip"
                                    onClick={() => {
                                      setRoleAt(roleIndex, {
                                        ...role,
                                        members: [...role.members, u.id],
                                      });
                                    }}
                                    disabled={saving}
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
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>

              {canManage && (
                <button
                  type="button"
                  className="m-perm__add-btn m-perm__add-role-btn"
                  onClick={handleAddRole}
                  disabled={saving}
                >
                  + Add role
                </button>
              )}
            </div>

            {errorText && <div className="m-perm__hint">{errorText}</div>}

            {canManage ? (
              <div className="m-perm__actions-row">
                <button
                  type="button"
                  className="m-perm__save-btn"
                  onClick={() => handleSave().catch(() => {})}
                  disabled={saving}
                >
                  {saving ? "Saving..." : "Save changes"}
                </button>
              </div>
            ) : (
              <div className="m-perm__hint">
                You do not have MANAGE permission for this channel.
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
