import { useEffect, useState } from "react";
import type { Channel, ChannelAccess, Role } from "../types";
import { PERM } from "../utils/permissions";
import { PermGrid } from "./PermGrid";

const API_BASE = import.meta.env.VITE_API_URL ?? "";

type Props = {
  token: string;
  allRoles: Role[];
};

type AccessDraft = ChannelAccess & {
  dirty: boolean;
};

export function AdminChannelsTab({ token, allRoles }: Props) {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [expandedChannelId, setExpandedChannelId] = useState<string | null>(null);
  const [accessDrafts, setAccessDrafts] = useState<Record<string, AccessDraft>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // New channel form
  const [newName, setNewName] = useState("");
  const [newType, setNewType] = useState<"text" | "voice" | "both">("both");
  const [creating, setCreating] = useState(false);

  function authHeaders() {
    return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  }

  useEffect(() => {
    setLoading(true);
    fetch(`${API_BASE}/channels`, { headers: authHeaders() })
      .then((r) => r.json())
      .then((res) => setChannels(res.channels ?? []))
      .finally(() => setLoading(false));
  }, [token]);

  async function loadAccess(channelId: string) {
    const res = await fetch(`${API_BASE}/channels/${channelId}/access`, {
      headers: authHeaders(),
    });
    const data: ChannelAccess = await res.json();
    setAccessDrafts((prev) => ({
      ...prev,
      [channelId]: { ...data, dirty: false },
    }));
  }

  function toggleExpand(channelId: string) {
    if (expandedChannelId === channelId) {
      setExpandedChannelId(null);
    } else {
      setExpandedChannelId(channelId);
      if (!(channelId in accessDrafts)) {
        loadAccess(channelId);
      }
    }
  }

  function patchDraft(channelId: string, patch: Partial<AccessDraft>) {
    setAccessDrafts((prev) => ({
      ...prev,
      [channelId]: { ...prev[channelId], ...patch, dirty: true },
    }));
  }

  function toggleRestricted(channelId: string, restricted: boolean) {
    setAccessDrafts((prev) => ({
      ...prev,
      [channelId]: { ...prev[channelId], restricted, entries: restricted ? prev[channelId]?.entries ?? [] : [], dirty: true },
    }));
  }

  function addRoleToAccess(channelId: string, roleId: number) {
    const role = allRoles.find((r) => r.id === roleId);
    if (!role) return;
    const draft = accessDrafts[channelId];
    if (!draft) return;
    if (draft.entries.some((e) => e.role_id === roleId)) return;
    patchDraft(channelId, {
      entries: [
        ...draft.entries,
        { role_id: roleId, role_name: role.name, role_color: role.color, permissions: null },
      ],
    });
  }

  function removeRoleFromAccess(channelId: string, roleId: number) {
    const draft = accessDrafts[channelId];
    if (!draft) return;
    patchDraft(channelId, {
      entries: draft.entries.filter((e) => e.role_id !== roleId),
    });
  }

  function setEntryPerm(channelId: string, roleId: number, perm: number | null) {
    const draft = accessDrafts[channelId];
    if (!draft) return;
    patchDraft(channelId, {
      entries: draft.entries.map((e) =>
        e.role_id === roleId ? { ...e, permissions: perm } : e,
      ),
    });
  }

  async function saveAccess(channelId: string) {
    const draft = accessDrafts[channelId];
    if (!draft) return;
    setSaving(channelId);
    try {
      await fetch(`${API_BASE}/channels/${channelId}/access`, {
        method: "PUT",
        headers: authHeaders(),
        body: JSON.stringify({
          restricted: draft.restricted,
          entries: draft.entries.map((e) => ({
            role_id: e.role_id,
            permissions: e.permissions,
          })),
        }),
      });
      patchDraft(channelId, { dirty: false });
    } finally {
      setSaving(null);
    }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim() || creating) return;
    setCreating(true);
    try {
      const res = await fetch(`${API_BASE}/channels`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ name: newName.trim(), type: newType }),
      });
      const data = await res.json();
      if (res.ok) {
        setChannels((prev) => [...prev, data.channel]);
        setNewName("");
        setNewType("both");
      }
    } finally {
      setCreating(false);
    }
  }

  if (loading) return <div className="m-admin-loading">Loading...</div>;

  return (
    <div className="m-admin-tab-content">
      <div className="m-admin-section">
        <div className="m-admin-section__title">Channels ({channels.length})</div>

        <div className="m-admin-list">
          {channels.map((channel) => {
            const isExpanded = expandedChannelId === channel.id;
            const draft = accessDrafts[channel.id];
            const isSaving = saving === channel.id;
            const availableRoles = allRoles.filter(
              (r) => !draft?.entries.some((e) => e.role_id === r.id),
            );

            return (
              <div key={channel.id} className="m-admin-channel-row">
                <div className="m-admin-channel-row__header">
                  <span className="m-admin-channel-row__type">{channel.type}</span>
                  <button
                    type="button"
                    className="m-admin-role-row__name"
                    onClick={() => toggleExpand(channel.id)}
                  >
                    #{channel.name}
                    <span className="m-admin-user-row__expand">{isExpanded ? "▲" : "▼"}</span>
                  </button>
                </div>

                {isExpanded && (
                  <div className="m-admin-channel-row__body">
                    {!draft ? (
                      <div className="m-admin-loading">Loading access...</div>
                    ) : (
                      <>
                        <div className="m-admin-row">
                          <label className="m-admin-label">Access</label>
                          <div className="m-admin-toggle-group">
                            <button
                              type="button"
                              className={`m-admin-toggle${!draft.restricted ? " m-admin-toggle--active" : ""}`}
                              onClick={() => toggleRestricted(channel.id, false)}
                            >
                              Open
                            </button>
                            <button
                              type="button"
                              className={`m-admin-toggle${draft.restricted ? " m-admin-toggle--active" : ""}`}
                              onClick={() => toggleRestricted(channel.id, true)}
                            >
                              Restricted
                            </button>
                          </div>
                        </div>

                        {!draft.restricted && (
                          <div className="m-admin-hint">
                            All users have access based on their global role permissions.
                          </div>
                        )}

                        {draft.restricted && (
                          <div className="m-admin-access-list">
                            {draft.entries.length === 0 && (
                              <div className="m-admin-hint">No roles - nobody has access.</div>
                            )}
                            {draft.entries.map((entry) => (
                              <div key={entry.role_id} className="m-admin-access-entry">
                                <span
                                  className="m-admin-role-row__dot"
                                  style={{ background: entry.role_color }}
                                />
                                <span className="m-admin-access-entry__name">{entry.role_name}</span>
                                <span className="m-admin-access-entry__perm-label">
                                  {entry.permissions === null ? "inherited" : ""}
                                </span>
                                <PermGrid
                                  value={entry.permissions ?? allRoles.find((r) => r.id === entry.role_id)?.permissions ?? PERM.READ}
                                  onChange={(v) => setEntryPerm(channel.id, entry.role_id, v)}
                                  disabled={isSaving}
                                />
                                <label className="m-admin-inherit-label">
                                  <input
                                    type="checkbox"
                                    checked={entry.permissions === null}
                                    onChange={(e) =>
                                      setEntryPerm(
                                        channel.id,
                                        entry.role_id,
                                        e.target.checked ? null : allRoles.find((r) => r.id === entry.role_id)?.permissions ?? PERM.READ,
                                      )
                                    }
                                    disabled={isSaving}
                                  />
                                  Inherit
                                </label>
                                <button
                                  type="button"
                                  className="m-admin-btn m-admin-btn--sm m-admin-btn--danger"
                                  onClick={() => removeRoleFromAccess(channel.id, entry.role_id)}
                                  disabled={isSaving}
                                >
                                  ✕
                                </button>
                              </div>
                            ))}

                            {availableRoles.length > 0 && (
                              <div className="m-perm__add-row">
                                <select
                                  className="m-perm__select"
                                  defaultValue=""
                                  onChange={(e) => {
                                    const id = parseInt(e.target.value, 10);
                                    if (!isNaN(id)) addRoleToAccess(channel.id, id);
                                    e.target.value = "";
                                  }}
                                  disabled={isSaving}
                                >
                                  <option value="">Add a role...</option>
                                  {availableRoles.map((r) => (
                                    <option key={r.id} value={r.id}>{r.name}</option>
                                  ))}
                                </select>
                              </div>
                            )}
                          </div>
                        )}

                        <button
                          type="button"
                          className="m-admin-btn m-admin-btn--primary"
                          onClick={() => saveAccess(channel.id)}
                          disabled={isSaving || !draft.dirty}
                        >
                          {isSaving ? "Saving..." : "Save"}
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Create channel form */}
      <div className="m-admin-section">
        <div className="m-admin-section__title">Create channel</div>
        <form className="m-admin-create-form" onSubmit={handleCreate}>
          <input
            className="m-admin-input"
            placeholder="Channel name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            disabled={creating}
          />
          <select
            className="m-admin-input"
            value={newType}
            onChange={(e) => setNewType(e.target.value as any)}
            disabled={creating}
          >
            <option value="both">Text + Voice</option>
            <option value="text">Text only</option>
            <option value="voice">Voice only</option>
          </select>
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
