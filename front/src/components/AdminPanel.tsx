import { useEffect, useState } from "react";
import type { Channel, Role, User } from "../types";
import { AdminChannelsTab } from "./AdminChannelsTab";
import { AdminRolesTab } from "./AdminRolesTab";
import { AdminUsersTab } from "./AdminUsersTab";

const API_BASE = import.meta.env.VITE_API_URL ?? "";

type Tab = "users" | "roles" | "channels";

type Props = {
  token: string;
  currentUserId: string;
  initialTab: Tab;
  selectedChannel: Channel | null;
  onClose: () => void;
};

const TAB_LABELS: { id: Tab; label: string }[] = [
  { id: "users", label: "Users" },
  { id: "roles", label: "Roles" },
  { id: "channels", label: "Channels" },
];

export function AdminPanel({ token, currentUserId, initialTab, selectedChannel, onClose }: Props) {
  const [tab, setTab] = useState<Tab>(initialTab);

  // Shared state — loaded once here, passed to all tabs
  const [users, setUsers] = useState<User[]>([]);
  const [allRoles, setAllRoles] = useState<Role[]>([]);
  const [loading, setLoading] = useState(true);

  function authHeaders() {
    return { Authorization: `Bearer ${token}` };
  }

  // Load users + roles on mount
  useEffect(() => {
    setLoading(true);
    Promise.all([
      fetch(`${API_BASE}/users`, { headers: authHeaders() }).then((r) => r.json()),
      fetch(`${API_BASE}/admin/roles`, { headers: authHeaders() }).then((r) => r.json()),
    ])
      .then(([usersRes, rolesRes]) => {
        setUsers(usersRes.users ?? []);
        setAllRoles(rolesRes.roles ?? []);
      })
      .finally(() => setLoading(false));
  }, [token]);

  // ESC to close
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Shared callbacks — keep shared state in sync after mutations
  function handleUserCreated(user: User) {
    setUsers((prev) => [...prev, user]);
  }
  function handleUserUpdated(user: User) {
    setUsers((prev) => prev.map((u) => (u.id === user.id ? user : u)));
  }
  function handleUserDeleted(userId: string) {
    setUsers((prev) => prev.filter((u) => u.id !== userId));
  }
  function handleRoleCreated(role: Role) {
    setAllRoles((prev) => [...prev, { ...role, member_count: 0 }]);
  }
  function handleRoleUpdated(role: Role) {
    setAllRoles((prev) => prev.map((r) => (r.id === role.id ? { ...r, ...role } : r)));
  }
  function handleRoleDeleted(roleId: number) {
    setAllRoles((prev) => prev.filter((r) => r.id !== roleId));
  }
  function handleRoleMemberCountChanged(roleId: number, delta: number) {
    setAllRoles((prev) =>
      prev.map((r) => (r.id === roleId ? { ...r, member_count: Math.max(0, (r.member_count ?? 0) + delta) } : r)),
    );
  }

  return (
    <div className="m-admin-panel-backdrop">
      <div className="m-admin-panel__header">
        <span className="m-admin-panel__title">ADMIN</span>

        <nav className="m-admin-panel__tabs">
          {TAB_LABELS.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              className={`m-admin-tab${tab === id ? " m-admin-tab--active" : ""}`}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </nav>

        <button type="button" className="m-modal__close" onClick={onClose} title="Close (Esc)">
          X
        </button>
      </div>

      <div className="m-admin-panel__body">
        {loading ? (
          <div className="m-admin-loading">Loading...</div>
        ) : (
          <>
            {tab === "users" && (
              <AdminUsersTab
                token={token}
                currentUserId={currentUserId}
                users={users}
                allRoles={allRoles}
                onUserCreated={handleUserCreated}
                onUserUpdated={handleUserUpdated}
                onUserDeleted={handleUserDeleted}
              />
            )}
            {tab === "roles" && (
              <AdminRolesTab
                token={token}
                allRoles={allRoles}
                allUsers={users}
                onRoleCreated={handleRoleCreated}
                onRoleUpdated={handleRoleUpdated}
                onRoleDeleted={handleRoleDeleted}
                onMemberCountChanged={handleRoleMemberCountChanged}
              />
            )}
            {tab === "channels" && (
              <AdminChannelsTab token={token} allRoles={allRoles} />
            )}
          </>
        )}
      </div>
    </div>
  );
}
