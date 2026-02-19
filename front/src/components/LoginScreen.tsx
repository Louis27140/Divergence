import { useState } from "react";
import { api } from "../api";

type LoginScreenProps = {
  onLogin: (token: string, username: string) => void;
};

export function LoginScreen({ onLogin }: LoginScreenProps) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit() {
    const u = username.trim();
    if (!u || !password) return;

    setLoading(true);
    setError("");

    try {
      const res = await api<{ token: string }>("/auth/login", {
        method: "POST",
        body: JSON.stringify({ username: u, password }),
      });
      onLogin(res.token, u);
    } catch (err: any) {
      setError(err?.message ?? "Connection failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="m-login">
      <div className="m-login__card">
        <div className="m-login__brand">Divergence</div>
        <div className="m-login__subtitle">Authentication Required</div>

        <div
          className="m-login__form"
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSubmit().catch(() => {});
          }}
        >
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

          {error && <div className="m-login__error">{error}</div>}

          <button
            className="m-login__submit"
            onClick={() => handleSubmit().catch(() => {})}
            disabled={loading || !username.trim() || !password}
          >
            {loading ? "Connecting..." : "Authenticate"}
          </button>
        </div>
      </div>
    </div>
  );
}
