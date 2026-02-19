import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";
import { AppTopbar } from "./components/AppTopbar";
import { ChannelDock } from "./components/ChannelDock";
import { LoginScreen } from "./components/LoginScreen";
import { MessageFeed } from "./components/MessageFeed";
import { VoiceWidget } from "./components/VoiceWidget";
import { socket } from "./socket";
import type { Channel, VoiceUser } from "./types";
import { isVoiceCapableChannel } from "./utils/channel";

export default function App() {
  const [token, setToken] = useState("");
  const [username, setUsername] = useState("");
  const [channels, setChannels] = useState<Channel[]>([]);
  const [selected, setSelected] = useState<Channel | null>(null);
  const [activeVoiceChannel, setActiveVoiceChannel] = useState<Channel | null>(null);
  const [voiceConnectTrigger, setVoiceConnectTrigger] = useState(0);
  const [voiceConnectChannelId, setVoiceConnectChannelId] = useState<string | null>(null);
  const [voiceUsersByChannel, setVoiceUsersByChannel] = useState<
    Record<string, VoiceUser[]>
  >({});
  const [voiceLiveByChannel, setVoiceLiveByChannel] = useState<Record<string, boolean>>({});
  const [voiceLiveTakeoverByChannel, setVoiceLiveTakeoverByChannel] = useState<
    Record<string, boolean>
  >({});
  const rootRef = useRef<HTMLDivElement>(null);
  // Must be declared before any early return to respect Rules of Hooks
  const expandedLiveRef = useRef<HTMLDivElement>(null);

  // Voice state listener (global)
  useEffect(() => {
    function onVoiceState(payload: { channelId: string; users: VoiceUser[] }) {
      setVoiceUsersByChannel((prev) => ({
        ...prev,
        [payload.channelId]: payload.users,
      }));
    }
    socket.on("voice:state", onVoiceState);
    return () => {
      socket.off("voice:state", onVoiceState);
    };
  }, []);

  // Wizz easter egg (shake on remote /wizz in current channel)
  useEffect(() => {
    function onWizz(payload: { channelId: string; username: string }) {
      if (!selected || payload.channelId !== selected.id) return;
      if (payload.username === username) return;

      const root = rootRef.current;
      if (!root) return;

      root.classList.remove("m-root--wizz");
      void root.offsetWidth;
      root.classList.add("m-root--wizz");
      root.addEventListener(
        "animationend",
        () => {
          root.classList.remove("m-root--wizz");
        },
        { once: true },
      );
    }

    socket.on("wizz", onWizz);
    return () => {
      socket.off("wizz", onWizz);
    };
  }, [selected, username]);

  // Load channels when authenticated
  useEffect(() => {
    if (!token) return;
    api<{ channels: Channel[] }>("/channels", {}, token)
      .then((res) => {
        setChannels(res.channels);
        if (res.channels.length > 0 && !selected) {
          setSelected(res.channels[0]);
        }
      })
      .catch(console.error);
  }, [token]);

  // Join/leave socket rooms for all channels
  useEffect(() => {
    if (!token || channels.length === 0) return;

    channels.forEach((ch) => {
      socket.emit("join", { channelId: ch.id });
    });

    return () => {
      channels.forEach((ch) => {
        socket.emit("leave", { channelId: ch.id });
      });
    };
  }, [channels, token]);

  // Keep a sticky active voice channel when a voice-capable channel becomes selected programmatically.
  useEffect(() => {
    if (activeVoiceChannel) return;
    if (!selected) return;
    if (selected.type === "text") return;
    setActiveVoiceChannel(selected);
  }, [activeVoiceChannel, selected]);

  function handleLogin(tok: string, user: string) {
    setToken(tok);
    setUsername(user);
  }

  function handleLogout() {
    setToken("");
    setUsername("");
    setChannels([]);
    setSelected(null);
    setActiveVoiceChannel(null);
    setVoiceConnectTrigger(0);
    setVoiceConnectChannelId(null);
    setVoiceUsersByChannel({});
    setVoiceLiveByChannel({});
    setVoiceLiveTakeoverByChannel({});
  }

  function handleChannelCreated(ch: Channel) {
    setChannels((prev) => [ch, ...prev]);
    setSelected(ch);
  }

  function handleChannelSelect(ch: Channel) {
    setSelected(ch);
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
      return {
        ...prev,
        [channelId]: isLive,
      };
    });
    if (!isLive) {
      setVoiceLiveTakeoverByChannel((prev) => {
        if (!prev[channelId]) return prev;
        return {
          ...prev,
          [channelId]: false,
        };
      });
    }
  }, []);

  const handleToggleVoiceLiveTakeover = useCallback((channelId: string) => {
    setVoiceLiveTakeoverByChannel((prev) => ({
      ...prev,
      [channelId]: !prev[channelId],
    }));
  }, []);

  // Auto-takeover for voice-only channels: when a live starts, show it on the left automatically
  useEffect(() => {
    if (!activeVoiceChannel) return;
    if (activeVoiceChannel.type !== "voice") return;
    if (!voiceLiveByChannel[activeVoiceChannel.id]) return;
    setVoiceLiveTakeoverByChannel((prev) => {
      if (prev[activeVoiceChannel.id]) return prev;
      return { ...prev, [activeVoiceChannel.id]: true };
    });
  }, [activeVoiceChannel, voiceLiveByChannel]);

  // Login screen
  if (!token) {
    return <LoginScreen onLogin={handleLogin} />;
  }

  const voiceChannel = activeVoiceChannel ?? (isVoiceCapableChannel(selected) ? selected : null);

  const voiceChannelHasLive = Boolean(voiceChannel && voiceLiveByChannel[voiceChannel.id]);
  const voiceChannelTakeover = Boolean(voiceChannel && voiceLiveTakeoverByChannel[voiceChannel.id]);
  // Show expanded live only when the selected channel IS the active voice channel
  // (navigating to another channel shows that channel's text feed instead)
  const showExpandedLive =
    voiceChannelHasLive && voiceChannelTakeover && selected?.id === voiceChannel?.id;

  return (
    <div className="m-root" ref={rootRef}>
      {/* Top bar */}
      <AppTopbar selected={selected} username={username} onLogout={handleLogout} />

      {/* Main content area */}
      <div className="m-content">
        {/* Left area: text/voice feed, hidden when live takeover shows instead */}
        {!showExpandedLive && (
          <MessageFeed channel={selected} username={username} token={token} />
        )}

        {/* Expanded live container — always in DOM so the ref stays valid for tile moves */}
        <div
          ref={expandedLiveRef}
          className="m-live-expanded"
          style={{ display: showExpandedLive ? "flex" : "none" }}
        />

        {/* Voice panel — always on the right, fixed 300px width */}
        {voiceChannel && (
          <div className="m-voice-panel">
            <VoiceWidget
              channelId={voiceChannel.id}
              username={username}
              token={token}
              voiceUsers={voiceUsersByChannel[voiceChannel.id] ?? []}
              connectTrigger={voiceConnectTrigger}
              connectChannelId={voiceConnectChannelId}
              onLiveStateChange={handleVoiceLiveState}
              onToggleLiveTakeover={handleToggleVoiceLiveTakeover}
              liveTakeoverActive={voiceChannelTakeover}
              expandedContainerRef={expandedLiveRef}
            />
          </div>
        )}
      </div>

      {/* Channel dock (bottom) */}
      <ChannelDock
        channels={channels}
        selected={selected}
        voiceUsersByChannel={voiceUsersByChannel}
        token={token}
        onSelect={handleChannelSelect}
        onOpen={handleChannelVoiceOpen}
        onCreated={handleChannelCreated}
      />
    </div>
  );
}
