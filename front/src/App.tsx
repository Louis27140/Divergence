import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { api } from "./api";
import { AdminPanel } from "./components/AdminPanel";
import { AppTopbar } from "./components/AppTopbar";
import { ChannelDock } from "./components/ChannelDock";
import { LoginScreen } from "./components/LoginScreen";
import { MessageFeed } from "./components/MessageFeed";
import { UserContextMenuPopup } from "./components/UserContextMenuPopup";
import { VoiceWidget } from "./components/VoiceWidget";
import { socket } from "./socket";
import type { AudioDeviceConfig, AuthUser, Channel, UserColorConfig, VoiceUser } from "./types";
import { isVoiceCapableChannel } from "./utils/channel";
import { PERM, hasPerm } from "./utils/permissions";

const API_BASE = import.meta.env.VITE_API_URL ?? "";
const MAX_AVATAR_SIZE = 5 * 1024 * 1024;

type AdminTab = "users" | "roles" | "channels";

type UserCtxMenu = {
  x: number;
  y: number;
  userId: string;
  username: string;
  avatarUrl?: string | null;
};

export default function App() {
  const [token, setToken] = useState(() => localStorage.getItem("m_token") ?? "");
  const [userId, setUserId] = useState(() => localStorage.getItem("m_user_id") ?? "");
  const [username, setUsername] = useState(() => localStorage.getItem("m_username") ?? "");
  const [userAvatarUrl, setUserAvatarUrl] = useState<string | null>(() => localStorage.getItem("m_avatar_url"));
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [isAdmin, setIsAdmin] = useState(() => localStorage.getItem("m_is_admin") === "true");
  const [channels, setChannels] = useState<Channel[]>([]);
  const [selected, setSelected] = useState<Channel | null>(null);
  const [activeVoiceChannel, setActiveVoiceChannel] = useState<Channel | null>(null);
  const [voiceConnectTrigger, setVoiceConnectTrigger] = useState(0);
  const [voiceConnectChannelId, setVoiceConnectChannelId] = useState<string | null>(null);
  const [voiceUsersByChannel, setVoiceUsersByChannel] = useState<
    Record<string, VoiceUser[]>
  >({});
  const [channelMembersByChannel, setChannelMembersByChannel] = useState<Record<string, string[]>>({});
  const [voiceLiveByChannel, setVoiceLiveByChannel] = useState<Record<string, boolean>>({});
  const [voiceLiveTakeoverByChannel, setVoiceLiveTakeoverByChannel] = useState<
    Record<string, boolean>
  >({});
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [userColorConfig, setUserColorConfig] = useState<UserColorConfig>(() => {
    try {
      const stored = localStorage.getItem("m_user_color_config");
      return stored ? JSON.parse(stored) : { mode: "hash" };
    } catch {
      return { mode: "hash" };
    }
  });
  const [audioConfig, setAudioConfig] = useState<AudioDeviceConfig>(() => {
    try {
      const stored = localStorage.getItem("m_audio_config");
      return stored ? JSON.parse(stored) : {};
    } catch {
      return {};
    }
  });
  const [showAdminPanel, setShowAdminPanel] = useState(false);
  const [adminPanelTab, setAdminPanelTab] = useState<AdminTab>("users");
  const [userCtxMenu, setUserCtxMenu] = useState<UserCtxMenu | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const expandedLiveRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onVoiceState(payload: { channelId: string; users: VoiceUser[] }) {
      setVoiceUsersByChannel((prev) => ({ ...prev, [payload.channelId]: payload.users }));
    }
    socket.on("voice:state", onVoiceState);
    return () => { socket.off("voice:state", onVoiceState); };
  }, []);

  useEffect(() => {
    function onChannelPresence(payload: { channelId: string; users: string[] }) {
      setChannelMembersByChannel((prev) => ({ ...prev, [payload.channelId]: payload.users }));
    }
    socket.on("channel:presence", onChannelPresence);
    return () => { socket.off("channel:presence", onChannelPresence); };
  }, []);

  useEffect(() => {
    function onWizz(payload: { channelId: string; username: string }) {
      if (!selected || payload.channelId !== selected.id) return;
      if (payload.username === username) return;
      const root = rootRef.current;
      if (!root) return;
      root.classList.remove("m-root--wizz");
      void root.offsetWidth;
      root.classList.add("m-root--wizz");
      root.addEventListener("animationend", () => { root.classList.remove("m-root--wizz"); }, { once: true });
    }
    socket.on("wizz", onWizz);
    return () => { socket.off("wizz", onWizz); };
  }, [selected, username]);

  useEffect(() => {
    if (!token) return;
    api<{ channels: Channel[] }>("/channels", {}, token)
      .then((res) => {
        setChannels(res.channels);
        if (res.channels.length > 0 && !selected) setSelected(res.channels[0]);
      })
      .catch(console.error);
  }, [token]);

  // Re-fetch channel list (permissions are user-specific, must come from server)
  const refreshChannels = useCallback(() => {
    if (!token) return;
    api<{ channels: Channel[] }>("/channels", {}, token)
      .then((res) => setChannels(res.channels))
      .catch(console.error);
  }, [token]);

  useEffect(() => {
    if (!token || channels.length === 0) return;
    channels.forEach((ch) => { socket.emit("join", { channelId: ch.id, username }); });
    return () => { channels.forEach((ch) => { socket.emit("leave", { channelId: ch.id }); }); };
  }, [channels, token, username]);

  useEffect(() => {
    if (activeVoiceChannel) return;
    if (!selected) return;
    if (selected.type === "text") return;
    setActiveVoiceChannel(selected);
  }, [activeVoiceChannel, selected]);

  function handleLogin(tok: string, user: AuthUser) {
    setToken(tok);
    setUserId(user.id);
    setUsername(user.username);
    setIsAdmin(user.is_admin);
    setUserAvatarUrl(user.avatar_url ?? null);
    localStorage.setItem("m_token", tok);
    localStorage.setItem("m_user_id", user.id);
    localStorage.setItem("m_username", user.username);
    localStorage.setItem("m_is_admin", String(user.is_admin));
    localStorage.setItem("m_avatar_url", user.avatar_url ?? "");
    if (user.color_config) {
      setUserColorConfig(user.color_config);
      localStorage.setItem("m_user_color_config", JSON.stringify(user.color_config));
    }
  }

  async function handlePickAvatar(file: File) {
    if (!token || avatarUploading) return;
    if (!file.type.startsWith("image/")) { alert("Unsupported avatar format."); return; }
    if (file.size > MAX_AVATAR_SIZE) { alert("Avatar is too large (max 5 MB)."); return; }

    const formData = new FormData();
    formData.append("avatar", file);
    setAvatarUploading(true);
    try {
      const res = await fetch(`${API_BASE}/users/me/avatar`, {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      if (!res.ok) throw new Error((await res.text()) || "avatar_upload_failed");
      const payload = await res.json();
      if (payload?.user?.avatar_url !== undefined) {
        setUserAvatarUrl(payload.user.avatar_url ?? null);
        localStorage.setItem("m_avatar_url", payload.user.avatar_url ?? "");
      }
    } catch (error: any) {
      alert(`Avatar upload failed: ${error?.message ?? String(error)}`);
    } finally {
      setAvatarUploading(false);
    }
  }

  function handleLogout() {
    localStorage.removeItem("m_token");
    localStorage.removeItem("m_user_id");
    localStorage.removeItem("m_username");
    localStorage.removeItem("m_is_admin");
    localStorage.removeItem("m_avatar_url");
    setToken(""); setUserId(""); setUsername(""); setUserAvatarUrl(null);
    setAvatarUploading(false); setIsAdmin(false); setChannels([]);
    setSelected(null); setActiveVoiceChannel(null);
    setVoiceConnectTrigger(0); setVoiceConnectChannelId(null);
    setVoiceUsersByChannel({}); setChannelMembersByChannel({});
    setVoiceLiveByChannel({}); setVoiceLiveTakeoverByChannel({});
    setShowAdminPanel(false); setUserCtxMenu(null);
  }

  function handleChannelCreated(ch: Channel) {
    setChannels((prev) => [...prev, ch]);
    setSelected(ch);
  }

  function handleChannelSelect(ch: Channel) {
    setSelected(ch);
    if (isVoiceCapableChannel(ch)) setActiveVoiceChannel(ch);
  }

  function handleChannelVoiceOpen(ch: Channel) {
    setSelected(ch);
    if (isVoiceCapableChannel(ch)) {
      setActiveVoiceChannel(ch);
      setVoiceConnectChannelId(ch.id);
      setVoiceConnectTrigger((prev) => prev + 1);
    }
  }

  const handleVoiceLiveState = useCallback((channelId: string, isLive: boolean) => {
    setVoiceLiveByChannel((prev) => {
      if (prev[channelId] === isLive) return prev;
      return { ...prev, [channelId]: isLive };
    });
    if (!isLive) {
      setVoiceLiveTakeoverByChannel((prev) => {
        if (!prev[channelId]) return prev;
        return { ...prev, [channelId]: false };
      });
    }
  }, []);

  async function handleColorChange(config: UserColorConfig) {
    setUserColorConfig(config);
    localStorage.setItem("m_user_color_config", JSON.stringify(config));
    try {
      await fetch(`${API_BASE}/users/me/color`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ color_config: config.mode === "hash" ? null : config }),
      });
    } catch { /* ignore */ }
  }

  function handleAudioChange(config: AudioDeviceConfig) {
    setAudioConfig(config);
    localStorage.setItem("m_audio_config", JSON.stringify(config));
  }

  function handleToggleTheme() {
    setTheme((t: "dark" | "light") => (t === "dark" ? "light" : "dark"));
  }

  function handleOpenAdminPanel(tab: AdminTab = "users") {
    setAdminPanelTab(tab);
    setShowAdminPanel(true);
  }

  const handleToggleVoiceLiveTakeover = useCallback((channelId: string) => {
    setVoiceLiveTakeoverByChannel((prev) => ({ ...prev, [channelId]: !prev[channelId] }));
  }, []);

  useLayoutEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    if (!activeVoiceChannel) return;
    if (activeVoiceChannel.type !== "voice") return;
    if (!voiceLiveByChannel[activeVoiceChannel.id]) return;
    setVoiceLiveTakeoverByChannel((prev) => {
      if (prev[activeVoiceChannel.id]) return prev;
      return { ...prev, [activeVoiceChannel.id]: true };
    });
  }, [activeVoiceChannel, voiceLiveByChannel]);

  if (!token) {
    return <LoginScreen onLogin={handleLogin} />;
  }

  const voiceChannel = activeVoiceChannel ?? (isVoiceCapableChannel(selected) ? selected : null);
  const canVoice = hasPerm(voiceChannel?.my_permissions, PERM.VOICE);
  const voiceChannelHasLive = Boolean(voiceChannel && voiceLiveByChannel[voiceChannel.id]);
  const voiceChannelTakeover = Boolean(voiceChannel && voiceLiveTakeoverByChannel[voiceChannel.id]);
  const showExpandedLive =
    voiceChannelHasLive && voiceChannelTakeover && selected?.id === voiceChannel?.id;

  return (
    <div className="m-root" ref={rootRef}>
      <AppTopbar
        selected={selected}
        username={username}
        userAvatarUrl={userAvatarUrl}
        avatarUploading={avatarUploading}
        isAdmin={isAdmin}
        onPickAvatar={handlePickAvatar}
        onOpenAdmin={isAdmin ? () => handleOpenAdminPanel("users") : undefined}
        onLogout={handleLogout}
        userColorConfig={userColorConfig}
        audioConfig={audioConfig}
        onColorChange={handleColorChange}
        onAudioChange={handleAudioChange}
      />

      <div className="m-content">
        {!showExpandedLive && (
          <MessageFeed
            channel={selected}
            username={username}
            currentUserAvatarUrl={userAvatarUrl}
            token={token}
            theme={theme}
            isAdmin={isAdmin}
            currentUserId={userId}
            userColorConfig={userColorConfig}
            onUserContextMenu={setUserCtxMenu}
          />
        )}

        <div
          ref={expandedLiveRef}
          className="m-live-expanded"
          style={{ display: showExpandedLive ? "flex" : "none" }}
        />

        {voiceChannel && (
          <div className="m-voice-panel">
            <VoiceWidget
              channelId={voiceChannel.id}
              username={username}
              currentUserAvatarUrl={userAvatarUrl}
              token={token}
              theme={theme}
              voiceUsers={voiceUsersByChannel[voiceChannel.id] ?? []}
              channelMembers={channelMembersByChannel[voiceChannel.id] ?? []}
              connectTrigger={voiceConnectTrigger}
              connectChannelId={voiceConnectChannelId}
              canVoice={canVoice}
              micDeviceId={audioConfig.inputDeviceId}
              outputDeviceId={audioConfig.outputDeviceId}
              onLiveStateChange={handleVoiceLiveState}
              onToggleLiveTakeover={handleToggleVoiceLiveTakeover}
              liveTakeoverActive={voiceChannelTakeover}
              expandedContainerRef={expandedLiveRef}
            />
          </div>
        )}
      </div>

      <ChannelDock
        channels={channels}
        selected={selected}
        voiceUsersByChannel={voiceUsersByChannel}
        token={token}
        theme={theme}
        canCreate={isAdmin}
        onSelect={handleChannelSelect}
        onOpen={handleChannelVoiceOpen}
        onCreated={handleChannelCreated}
        onToggleTheme={handleToggleTheme}
      />

      {isAdmin && showAdminPanel && (
        <AdminPanel
          token={token}
          currentUserId={userId}
          initialTab={adminPanelTab}
          selectedChannel={selected}
          onClose={() => setShowAdminPanel(false)}
        />
      )}

      {userCtxMenu && (
        <UserContextMenuPopup
          x={userCtxMenu.x}
          y={userCtxMenu.y}
          userId={userCtxMenu.userId}
          username={userCtxMenu.username}
          avatarUrl={userCtxMenu.avatarUrl}
          isAdmin={isAdmin}
          token={token}
          onClose={() => setUserCtxMenu(null)}
        />
      )}
    </div>
  );
}
