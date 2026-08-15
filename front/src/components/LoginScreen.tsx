import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import type { AuthUser } from "../types";

type LoginScreenProps = {
  onLogin: (token: string, user: AuthUser) => void;
};

type LoginSuccessPayload = {
  token: string;
  user: AuthUser;
  requires_password_change?: false;
};

type LoginRequiresPasswordChangePayload = {
  requires_password_change: true;
  user: AuthUser;
};

type PasswordChangePayload = {
  token: string;
  user: AuthUser;
};

function isPasswordChangeRequired(
  payload: LoginSuccessPayload | LoginRequiresPasswordChangePayload,
): payload is LoginRequiresPasswordChangePayload {
  return (payload as LoginRequiresPasswordChangePayload).requires_password_change === true;
}

export function LoginScreen({ onLogin }: LoginScreenProps) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newPasswordConfirm, setNewPasswordConfirm] = useState("");
  // For the regular requires_password_change flow (non-invite)
  const [temporaryPassword, setTemporaryPassword] = useState("");
  const [firstLoginUsername, setFirstLoginUsername] = useState("");
  const [requiresPasswordChange, setRequiresPasswordChange] = useState(false);
  // Invite flow state
  const [inviteUsername, setInviteUsername] = useState("");
  const [inviteLookupDone, setInviteLookupDone] = useState(false);
  const [inviteError, setInviteError] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const inviteToken = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("invite");
  }, []);

  useEffect(() => {
    if (!inviteToken) return;
    let cancelled = false;
    api<{ username: string }>(`/auth/invite/${encodeURIComponent(inviteToken)}`)
      .then((res) => {
        if (cancelled) return;
        setInviteUsername(res.username);
        setInviteError("");
      })
      .catch(() => {
        if (cancelled) return;
        setInviteError("Invalid or expired invite link.");
      })
      .finally(() => {
        if (!cancelled) setInviteLookupDone(true);
      });
    return () => { cancelled = true; };
  }, [inviteToken]);

  // Invite token present, lookup done, no error → show set-password form directly
  const showInviteActivate = Boolean(inviteToken && inviteLookupDone && !inviteError);

  async function handleLoginSubmit() {
    const u = username.trim();
    if (!u || !password) return;
    setLoading(true);
    setError("");
    try {
      const res = await api<LoginSuccessPayload | LoginRequiresPasswordChangePayload>(
        "/auth/login",
        { method: "POST", body: JSON.stringify({ username: u, password }) },
      );
      if (isPasswordChangeRequired(res)) {
        setRequiresPasswordChange(true);
        setFirstLoginUsername(u);
        setTemporaryPassword(password);
        setPassword("");
        setNewPassword("");
        setNewPasswordConfirm("");
        return;
      }
      onLogin(res.token, res.user);
    } catch (err: any) {
      setError(err?.message ?? "Connection failed");
    } finally {
      setLoading(false);
    }
  }

  async function handleInitialPasswordChange() {
    if (!requiresPasswordChange) return;
    if (!firstLoginUsername || !temporaryPassword) return;
    if (!newPassword || !newPasswordConfirm) return;
    if (newPassword !== newPasswordConfirm) { setError("The new passwords do not match."); return; }
    if (newPassword.length < 8) { setError("New password must contain at least 8 characters."); return; }
    setLoading(true);
    setError("");
    try {
      const res = await api<PasswordChangePayload>("/auth/change-initial-password", {
        method: "POST",
        body: JSON.stringify({
          username: firstLoginUsername,
          current_password: temporaryPassword,
          new_password: newPassword,
        }),
      });
      onLogin(res.token, res.user);
    } catch (err: any) {
      setError(err?.message ?? "Password update failed");
    } finally {
      setLoading(false);
    }
  }

  async function handleInviteActivate() {
    if (!inviteToken) return;
    if (!newPassword || !newPasswordConfirm) return;
    if (newPassword !== newPasswordConfirm) { setError("The new passwords do not match."); return; }
    if (newPassword.length < 8) { setError("New password must contain at least 8 characters."); return; }
    setLoading(true);
    setError("");
    try {
      const res = await api<PasswordChangePayload>(
        `/auth/invite/${encodeURIComponent(inviteToken)}/activate`,
        { method: "POST", body: JSON.stringify({ new_password: newPassword }) },
      );
      // Remove ?invite= from URL
      const nextUrl = new URL(window.location.href);
      nextUrl.searchParams.delete("invite");
      const nextSearch = nextUrl.search ? nextUrl.search : "";
      window.history.replaceState({}, "", `${nextUrl.pathname}${nextSearch}`);
      onLogin(res.token, res.user);
    } catch (err: any) {
      setError(err?.message ?? "Activation failed");
    } finally {
      setLoading(false);
    }
  }

  const canSubmitLogin = !loading && !requiresPasswordChange && username.trim().length > 0 && password.length > 0;
  const canSubmitPasswordChange = !loading && requiresPasswordChange && newPassword.length > 0 && newPasswordConfirm.length > 0;
  const canSubmitInviteActivate = !loading && newPassword.length > 0 && newPasswordConfirm.length > 0;

  return (
    <div className="m-login">
      <div className="m-login__card">
        <div className="m-login__brand">Divergence</div>
        <div className="m-login__subtitle">Authentication Required</div>

        {inviteError && <div className="m-login__error">{inviteError}</div>}

        <div
          className="m-login__form"
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            if (showInviteActivate) { handleInviteActivate().catch(() => {}); return; }
            if (requiresPasswordChange) { handleInitialPasswordChange().catch(() => {}); return; }
            handleLoginSubmit().catch(() => {});
          }}
        >
          {showInviteActivate ? (
            <>
              <div className="m-login__hint">
                Set your password for <strong>{inviteUsername}</strong>.
              </div>
              <input
                className="m-login__input"
                value={inviteUsername}
                readOnly
                disabled
                placeholder="> username"
              />
              <input
                className="m-login__input"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="> new password"
                type="password"
                autoFocus
              />
              <input
                className="m-login__input"
                value={newPasswordConfirm}
                onChange={(e) => setNewPasswordConfirm(e.target.value)}
                placeholder="> confirm password"
                type="password"
              />
            </>
          ) : !requiresPasswordChange ? (
            <>
              <input
                className="m-login__input"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="> username"
                autoFocus
              />
              <input
                className="m-login__input"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="> password"
                type="password"
              />
            </>
          ) : (
            <>
              <div className="m-login__hint">
                First login for <strong>{firstLoginUsername}</strong>: choose your new password.
              </div>
              <input
                className="m-login__input"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="> new password"
                type="password"
                autoFocus
              />
              <input
                className="m-login__input"
                value={newPasswordConfirm}
                onChange={(e) => setNewPasswordConfirm(e.target.value)}
                placeholder="> confirm new password"
                type="password"
              />
            </>
          )}

          {error && <div className="m-login__error">{error}</div>}

          {showInviteActivate ? (
            <button
              className="m-login__submit"
              onClick={() => handleInviteActivate().catch(() => {})}
              disabled={!canSubmitInviteActivate}
            >
              {loading ? "Saving..." : "Set Password"}
            </button>
          ) : !requiresPasswordChange ? (
            <button
              className="m-login__submit"
              onClick={() => handleLoginSubmit().catch(() => {})}
              disabled={!canSubmitLogin}
            >
              {loading ? "Connecting..." : "Authenticate"}
            </button>
          ) : (
            <>
              <button
                className="m-login__submit"
                onClick={() => handleInitialPasswordChange().catch(() => {})}
                disabled={!canSubmitPasswordChange}
              >
                {loading ? "Saving..." : "Set New Password"}
              </button>
              <button
                className="m-login__submit m-login__submit--secondary"
                onClick={() => {
                  setRequiresPasswordChange(false);
                  setTemporaryPassword("");
                  setFirstLoginUsername("");
                  setNewPassword("");
                  setNewPasswordConfirm("");
                  setPassword("");
                  setError("");
                }}
                disabled={loading}
                type="button"
              >
                Back
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
