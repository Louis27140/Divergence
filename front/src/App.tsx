import React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { socket } from "./socket";

type Channel = { id: string; name: string };
type Message = {
  id: string;
  channel_id: string;
  author_id: string;
  content: string;
  created_at: string;
};

const API = import.meta.env.VITE_API_URL ?? "http://localhost:3000";

async function api<T>(path: string, opts: RequestInit = {}, token?: string): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(opts.headers ?? {})
    }
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`${res.status} ${txt}`);
  }
  return res.json();
}

export default function App() {
  const [token, setToken] = useState<string>("");
  const [username, setUsername] = useState("louis");
  const [password, setPassword] = useState("123456");

  const [channels, setChannels] = useState<Channel[]>([]);
  const [selected, setSelected] = useState<Channel | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [content, setContent] = useState("");

  const joinedRef = useRef<string | null>(null);

  // socket listener
  useEffect(() => {
    function onNewMessage(msg: Message) {
      if (selected && msg.channel_id === selected.id) {
        setMessages((prev) => [msg, ...prev]);
      }
    }
    socket.on("new_message", onNewMessage);
    return () => {
      socket.off("new_message", onNewMessage);
    };
  }, [selected]);

  async function login() {
    const res = await api<{ token: string }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password })
    });
    setToken(res.token);
  }

  async function loadChannels(t: string) {
    const res = await api<{ channels: Channel[] }>("/channels", {}, t);
    setChannels(res.channels);
    if (!selected && res.channels.length) setSelected(res.channels[0]);
  }

  async function loadMessages(channelId: string, t: string) {
    const res = await api<{ messages: Message[] }>(`/channels/${channelId}/messages`, {}, t);
    setMessages(res.messages);
  }

  useEffect(() => {
    if (!token) return;
    loadChannels(token).catch(console.error);
  }, [token]);

  // when selecting a channel: fetch + join room
  useEffect(() => {
    if (!token || !selected) return;

    loadMessages(selected.id, token).catch(console.error);

    // leave previous
    if (joinedRef.current) socket.emit("leave", { channelId: joinedRef.current });
    // join new
    socket.emit("join", { channelId: selected.id });
    joinedRef.current = selected.id;
  }, [selected, token]);

  async function sendMessage() {
    if (!token || !selected) return;
    const text = content.trim();
    if (!text) return;

    // POST message (DB + broadcast)
    await api(`/channels/${selected.id}/messages`, {
      method: "POST",
      body: JSON.stringify({ content: text })
    }, token);

    setContent("");
    // pas besoin d'ajouter localement: tu vas le recevoir via socket
  }

  const authed = useMemo(() => Boolean(token), [token]);

  return (
    <div style={{ fontFamily: "system-ui", padding: 16, display: "flex", gap: 16 }}>
      {!authed ? (
        <div style={{ maxWidth: 320 }}>
          <h2>Login</h2>
          <div style={{ display: "grid", gap: 8 }}>
            <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="username" />
            <input value={password} onChange={(e) => setPassword(e.target.value)} placeholder="password" type="password" />
            <button onClick={login}>Login</button>
          </div>
          <p style={{ opacity: 0.7, marginTop: 12 }}>
            UI moche, mais ça cause. 😄
          </p>
        </div>
      ) : (
        <>
          <div style={{ width: 220 }}>
            <h3>Channels</h3>
            <button
              onClick={() => loadChannels(token).catch(console.error)}
              style={{ width: "100%", marginBottom: 8 }}
            >
              Refresh
            </button>
            <div style={{ display: "grid", gap: 6 }}>
              {channels.map((c) => (
                <button
                  key={c.id}
                  onClick={() => setSelected(c)}
                  style={{
                    textAlign: "left",
                    padding: 8,
                    border: "1px solid #ccc",
                    background: selected?.id === c.id ? "#eee" : "white"
                  }}
                >
                  #{c.name}
                </button>
              ))}
            </div>
          </div>

          <div style={{ flex: 1 }}>
            <h3>{selected ? `#${selected.name}` : "Select a channel"}</h3>

            <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
              <input
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="Message..."
                style={{ flex: 1 }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") sendMessage().catch(console.error);
                }}
              />
              <button onClick={() => sendMessage().catch(console.error)}>Send</button>
            </div>

            <div style={{ border: "1px solid #ddd", padding: 8, minHeight: 360 }}>
              {messages.length === 0 ? (
                <p style={{ opacity: 0.7 }}>No messages.</p>
              ) : (
                messages.map((m) => (
                  <div key={m.id} style={{ padding: "6px 0", borderBottom: "1px solid #eee" }}>
                    <div style={{ fontSize: 12, opacity: 0.7 }}>
                      {new Date(m.created_at).toLocaleString()}
                    </div>
                    <div>{m.content}</div>
                  </div>
                ))
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
