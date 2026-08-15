import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import type { User } from "../types";
import { UserAvatar } from "./UserAvatar";

type Props = {
  token: string;
  onClose: () => void;
};

type ProvisionResponse = {
  user: User;
  temporary_password: string;
  invite_token: string;
  invite_url?: string | null;
};

function normalizeUsername(value: string): string {
  return value.trim();
}

export function UserProvisionModal({ token, onClose }: Props) {
  const [users, setUsers] = useState<User[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [creating, setCreating] = useState(false);
  const [username, setUsername] = useState("");
  const [temporaryPassword, setTemporaryPassword] = useState("");
  const [result, setResult] = useState<ProvisionResponse | null>(null);
  const [errorText, setErrorText] = useState("");

  const sortedUsers = useMemo(
    () => [...users].sort((a, b) => a.username.localeCompare(b.username)),
    [users],
  );

  const inviteUrl = useMemo(() => {
    if (!result) return "";
    if (result.invite_url) return result.invite_url;
    return `${window.location.origin}/?invite=${encodeURIComponent(result.invite_token)}`;
  }, [result]);

  async function loadUsers() {
    setLoadingUsers(true);
    try {
      const res = await api<{ users: User[] }>("/users", {}, token);
      setUsers(Array.isArray(res.users) ? res.users : []);
    } catch {
      setErrorText("Failed to load users.");
      setUsers([]);
    } finally {
      setLoadingUsers(false);
    }
  }

  useEffect(() => {
    loadUsers().catch(() => {});
  }, [token]);

  async function copyText(value: string) {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      setErrorText("Clipboard copy failed.");
    }
  }

  async function handleCreateUser() {
    const normalizedUsername = normalizeUsername(username);
    if (normalizedUsername.length < 3 || creating) return;

    setCreating(true);
    setErrorText("");
    setResult(null);

    try {
      const payload: { username: string; temporary_password?: string } = {
        username: normalizedUsername,
      };
      if (temporaryPassword.trim()) {
        payload.temporary_password = temporaryPassword.trim();
      }

      const created = await api<ProvisionResponse>(
        "/admin/users",
        {
          method: "POST",
          body: JSON.stringify(payload),
        },
        token,
      );

      setResult(created);
      setUsername("");
      setTemporaryPassword("");
      await loadUsers();
    } catch (error: any) {
      setErrorText(error?.message ?? "User creation failed.");
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="m-modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="m-modal m-user-admin">
        <div className="m-modal__header">
          <span className="m-modal__title">User Provisioning</span>
          <button className="m-modal__close" onClick={onClose} type="button">X</button>
        </div>

        <div className="m-user-admin__hint">
          Create managed accounts. New users must change their password on first login.
        </div>

        <div className="m-user-admin__form">
          <input
            className="m-user-admin__input"
            placeholder="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            disabled={creating}
          />
          <input
            className="m-user-admin__input"
            placeholder="temporary password (optional)"
            value={temporaryPassword}
            onChange={(e) => setTemporaryPassword(e.target.value)}
            disabled={creating}
          />
          <button
            className="m-user-admin__create-btn"
            type="button"
            onClick={() => handleCreateUser().catch(() => {})}
            disabled={creating || normalizeUsername(username).length < 3}
          >
            {creating ? "Creating..." : "Create User"}
          </button>
        </div>

        {result && (
          <div className="m-user-admin__result">
            <div className="m-user-admin__result-title">Credentials to share</div>
            <div className="m-user-admin__secret-row">
              <span className="m-user-admin__secret-label">Username</span>
              <code className="m-user-admin__secret-value">{result.user.username}</code>
              <button
                type="button"
                className="m-user-admin__copy-btn"
                onClick={() => copyText(result.user.username).catch(() => {})}
              >
                Copy
              </button>
            </div>
            <div className="m-user-admin__secret-row">
              <span className="m-user-admin__secret-label">Temporary password</span>
              <code className="m-user-admin__secret-value">{result.temporary_password}</code>
              <button
                type="button"
                className="m-user-admin__copy-btn"
                onClick={() => copyText(result.temporary_password).catch(() => {})}
              >
                Copy
              </button>
            </div>
            <div className="m-user-admin__secret-row">
              <span className="m-user-admin__secret-label">Invite link</span>
              <code className="m-user-admin__secret-value m-user-admin__secret-value--link">{inviteUrl}</code>
              <button
                type="button"
                className="m-user-admin__copy-btn"
                onClick={() => copyText(inviteUrl).catch(() => {})}
              >
                Copy
              </button>
            </div>
          </div>
        )}

        {errorText && <div className="m-perm__hint">{errorText}</div>}

        <div className="m-user-admin__users-title">Users ({sortedUsers.length})</div>
        <div className="m-user-admin__users">
          {loadingUsers ? (
            <div className="m-perm__empty">Loading...</div>
          ) : sortedUsers.length === 0 ? (
            <div className="m-perm__empty">No users</div>
          ) : (
            sortedUsers.map((user) => (
              <div className="m-user-admin__user-row" key={user.id}>
                <div className="m-user-admin__user-main">
                  <UserAvatar
                    className="m-user-admin__avatar"
                    username={user.username}
                    avatarUrl={user.avatar_url}
                    size={20}
                  />
                  <span className="m-user-admin__username">{user.username}</span>
                </div>
                <div className="m-user-admin__badges">
                  {user.is_admin && <span className="m-user-admin__badge m-user-admin__badge--admin">ADMIN</span>}
                  {user.must_change_password && (
                    <span className="m-user-admin__badge m-user-admin__badge--pending">PENDING</span>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
