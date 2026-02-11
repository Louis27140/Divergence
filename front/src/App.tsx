import React, { useEffect, useMemo, useRef, useState } from "react";
import { socket } from "./socket";
import { VoiceButton } from "./components/VoiceButton";

type ChannelType = "text" | "voice" | "both";
type Channel = { id: string; name: string; type: ChannelType };

type Message = {
  id: string;
  channel_id: string;
  author_id: string;
  author_username: string;
  content: string;
  created_at: string;
};
const API = import.meta.env.VITE_API_URL;


async function api<T>(path: string, opts: RequestInit = {}, token?: string): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(opts.headers ?? {}),
    },
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`${res.status} ${txt}`);
  }
  return res.json();
}

export default function App() {
  const [token, setToken] = useState<string>("");

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  const [channels, setChannels] = useState<Channel[]>([]);
  const [selected, setSelected] = useState<Channel | null>(null);

  const [messages, setMessages] = useState<Message[]>([]);
  const [content, setContent] = useState("");

  // ✅ voice presence state (INSIDE App)
  const [voiceUsers, setVoiceUsers] = useState<{ username: string }[]>([]);

  // Create channel UI
  const [newChannelName, setNewChannelName] = useState("");
  const [newChannelType, setNewChannelType] = useState<ChannelType>("both");

  const joinedRef = useRef<string | null>(null);

  // messages socket listener
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

  // voice presence listener
  useEffect(() => {
    function onVoiceState(payload: { channelId: string; users: { username: string }[] }) {
      if (selected && payload.channelId === selected.id) {
        setVoiceUsers(payload.users);
      }
    }

    socket.on("voice:state", onVoiceState);
    return () => {
      socket.off("voice:state", onVoiceState);
    };
  }, [selected]);

  async function login() {
    const res = await api<{ token: string }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
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

  async function createChannel() {
    if (!token) return;
    const name = newChannelName.trim();
    if (!name) return;

    const res = await api<{ channel: Channel }>(
      "/channels",
      {
        method: "POST",
        body: JSON.stringify({ name, type: newChannelType }),
      },
      token
    );

    setChannels((prev) => [res.channel, ...prev]);
    setSelected(res.channel);
    setNewChannelName("");
    setNewChannelType("both");
  }

  useEffect(() => {
    if (!token) return;
    loadChannels(token).catch(console.error);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // selecting a channel: fetch + join socket room
  useEffect(() => {
    if (!token || !selected) return;

    // messages only if channel supports text
    if (selected.type === "text" || selected.type === "both") {
      loadMessages(selected.id, token).catch(console.error);
    } else {
      setMessages([]);
    }

    // reset voice users display on channel switch (optional)
    setVoiceUsers([]);

    // leave previous socket room
    if (joinedRef.current) socket.emit("leave", { channelId: joinedRef.current });
    // join new socket room
    socket.emit("join", { channelId: selected.id });
    joinedRef.current = selected.id;
  }, [selected, token]);

  async function sendMessage() {
    if (!token || !selected) return;
    if (!(selected.type === "text" || selected.type === "both")) return;

    const text = content.trim();
    if (!text) return;

    await api(
      `/channels/${selected.id}/messages`,
      {
        method: "POST",
        body: JSON.stringify({ content: text }),
      },
      token
    );

    setContent("");
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
        </div>
      ) : (
        <>
          <div style={{ width: 280 }}>
            {/* Voice area */}
            {selected && (selected.type === "voice" || selected.type === "both") && (
              <div style={{ marginBottom: 10, border: "1px solid #ddd", padding: 8 }}>
                <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 6 }}>
                  Voice presence: {voiceUsers.length}
                </div>
                {voiceUsers.length > 0 && (
                  <div style={{ fontSize: 13, marginBottom: 8 }}>
                    {voiceUsers.map((u, i) => (
                      <div key={`${u.username}-${i}`}>• {u.username}</div>
                    ))}
                  </div>
                )}

                {/* ✅ pass channelId + username so VoiceButton can emit join/leave */}
                <VoiceButton key={selected.id} channelId={selected.id} username={username} token={token} />
              </div>
            )}

            <h3>Channels</h3>

            {/* Create channel */}
            <div style={{ display: "grid", gap: 6, marginBottom: 10 }}>
              <input
                value={newChannelName}
                onChange={(e) => setNewChannelName(e.target.value)}
                placeholder="New channel name"
                onKeyDown={(e) => {
                  if (e.key === "Enter") createChannel().catch(console.error);
                }}
              />

              <div style={{ display: "flex", gap: 6 }}>
                <button onClick={() => setNewChannelType("text")} style={{ flex: 1, background: newChannelType === "text" ? "#eee" : "white" }}>
                  Text
                </button>
                <button onClick={() => setNewChannelType("voice")} style={{ flex: 1, background: newChannelType === "voice" ? "#eee" : "white" }}>
                  Voice
                </button>
                <button onClick={() => setNewChannelType("both")} style={{ flex: 1, background: newChannelType === "both" ? "#eee" : "white" }}>
                  Both
                </button>
              </div>

              <button onClick={() => createChannel().catch(console.error)}>Create</button>
            </div>

            <button onClick={() => loadChannels(token).catch(console.error)} style={{ width: "100%", marginBottom: 8 }}>
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
                    background: selected?.id === c.id ? "#eee" : "white",
                  }}
                >
                  #{c.name} <span style={{ opacity: 0.6 }}>({c.type})</span>
                </button>
              ))}
            </div>
          </div>

          <div style={{ flex: 1 }}>
            <h3>{selected ? `#${selected.name}` : "Select a channel"}</h3>

            {/* Message composer only for text/both */}
            {selected && (selected.type === "text" || selected.type === "both") ? (
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
            ) : (
              <div style={{ opacity: 0.7, marginBottom: 8 }}>Voice-only channel.</div>
            )}

            <div style={{ border: "1px solid #ddd", padding: 8, minHeight: 360 }}>
              {messages.length === 0 ? (
                <p style={{ opacity: 0.7 }}>No messages.</p>
              ) : (
                messages.map((m) => (
                  <div key={m.id} style={{ padding: "6px 0", borderBottom: "1px solid #eee" }}>
                    <div style={{ fontSize: 12, opacity: 0.7 }}>
                      {m.author_username} • {new Date(m.created_at).toLocaleString()}
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
