import { ConnectionState, RemoteParticipant, Room, RoomEvent, Track } from "livekit-client";
import { useEffect, useRef, useState } from "react";
import { socket } from "../socket";
import type { User, VoiceUser } from "../types";
import { PERM, hasPerm } from "../utils/permissions";
import { usernameColor, type ThemeMode } from "../utils/userColor";
import { StreamPanel } from "./StreamPanel";
import { UserAvatar } from "./UserAvatar";

const API = import.meta.env.VITE_API_URL;
const LIVEKIT_URL = import.meta.env.VITE_LIVEKIT_URL;

type LogLine = { t: string; msg: string };

type VoiceWidgetProps = {
  channelId: string;
  username: string;
  currentUserAvatarUrl?: string | null;
  token: string;
  theme: ThemeMode;
  voiceUsers: VoiceUser[];
  channelMembers: string[];
  connectTrigger?: number;
  connectChannelId?: string | null;
  /** Whether the current user has VOICE permission on this channel */
  canVoice?: boolean;
  micDeviceId?: string;
  outputDeviceId?: string;
  onLiveStateChange?: (channelId: string, isLive: boolean) => void;
  onToggleLiveTakeover?: (channelId: string) => void;
  liveTakeoverActive?: boolean;
  /** Container in the main area where tiles are moved when live takeover is active */
  expandedContainerRef?: { current: HTMLDivElement | null };
};

export function VoiceWidget({
  channelId,
  username,
  currentUserAvatarUrl,
  token,
  theme,
  voiceUsers,
  channelMembers,
  connectTrigger = 0,
  connectChannelId = null,
  canVoice = true,
  micDeviceId = undefined,
  outputDeviceId = undefined,
  onLiveStateChange,
  onToggleLiveTakeover,
  liveTakeoverActive = false,
  expandedContainerRef,
}: VoiceWidgetProps) {
  const roomRef = useRef<Room | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioElsRef = useRef<Map<string, HTMLAudioElement>>(new Map());
  const gainNodesRef = useRef<Map<string, GainNode>>(new Map());
  const [joined, setJoined] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [pingMs, setPingMs] = useState<number | null>(null);
  const [showDebug, setShowDebug] = useState(false);
  const [logs, setLogs] = useState<LogLine[]>([]);

  const [sidebarTab, setSidebarTab] = useState<"members" | "voice">("members");
  const [accessibleMembers, setAccessibleMembers] = useState<Array<User>>([]);
  const [allUsers, setAllUsers] = useState<Array<User>>([]);
  const [membersLoading, setMembersLoading] = useState(false);

  const [userVolumes, setUserVolumes] = useState<Record<string, number>>({});
  const userVolumesRef = useRef<Record<string, number>>({});
  const [volMenu, setVolMenu] = useState<{ username: string; x: number; y: number } | null>(null);

  const [muted, setMuted] = useState(false);
  const [screenSharing, setScreenSharing] = useState(false);
  const [remoteScreenShareCount, setRemoteScreenShareCount] = useState(0);
  const screenShareContainerRef = useRef<HTMLDivElement>(null);
  const previousJoinedRef = useRef(false);
  // Ref so non-reactive DOM functions (addScreenShareTile) always see the current value
  const liveTakeoverActiveRef = useRef(liveTakeoverActive);

  function setUserVolume(identity: string, vol: number) {
    userVolumesRef.current = { ...userVolumesRef.current, [identity]: vol };
    setUserVolumes({ ...userVolumesRef.current });
    const gain = gainNodesRef.current.get(identity);
    if (gain) {
      gain.gain.value = vol;
    } else {
      const el = audioElsRef.current.get(identity);
      if (el) el.volume = Math.min(1, vol);
    }
  }

  function log(msg: string) {
    const t = new Date().toLocaleTimeString();
    setLogs((prev) => [...prev.slice(-200), { t, msg }]);
  }

  function requestFullscreen(el: HTMLElement) {
    const withVendor = el as HTMLElement & {
      webkitRequestFullscreen?: () => void;
      msRequestFullscreen?: () => void;
    };

    if (el.requestFullscreen) {
      void el.requestFullscreen().catch(() => {});
      return;
    }

    if (withVendor.webkitRequestFullscreen) {
      withVendor.webkitRequestFullscreen();
      return;
    }

    if (withVendor.msRequestFullscreen) {
      withVendor.msRequestFullscreen();
    }
  }

  function removeScreenShareTile(tileId: string) {
    // Search in both containers (small panel and expanded view)
    for (const container of [screenShareContainerRef.current, expandedContainerRef?.current]) {
      if (!container) continue;
      const tile = container.querySelector<HTMLElement>(`[data-screen-share-tile="${tileId}"]`);
      if (!tile) continue;
      const video = tile.querySelector<HTMLVideoElement>("video");
      if (video) video.srcObject = null;
      tile.remove();
      return;
    }
  }

  function addScreenShareTile(videoEl: HTMLVideoElement, tileId: string, title: string) {
    // Add to the currently active container
    const container = liveTakeoverActiveRef.current
      ? (expandedContainerRef?.current ?? screenShareContainerRef.current)
      : screenShareContainerRef.current;
    if (!container) return;

    removeScreenShareTile(tileId);

    videoEl.autoplay = true;
    videoEl.setAttribute("playsinline", "true");
    videoEl.className = "m-screen-share__video";

    const tile = document.createElement("div");
    tile.className = "m-screen-share__tile";
    tile.dataset.screenShareTile = tileId;

    const header = document.createElement("div");
    header.className = "m-screen-share__tile-header";

    const titleNode = document.createElement("span");
    titleNode.className = "m-screen-share__tile-title";
    titleNode.textContent = title;

    const fullscreenBtn = document.createElement("button");
    fullscreenBtn.type = "button";
    fullscreenBtn.className = "m-screen-share__fullscreen-btn";
    fullscreenBtn.textContent = "Fullscreen";
    fullscreenBtn.onclick = () => requestFullscreen(videoEl);

    header.appendChild(titleNode);
    header.appendChild(fullscreenBtn);

    const body = document.createElement("div");
    body.className = "m-screen-share__tile-body";
    body.appendChild(videoEl);

    tile.appendChild(header);
    tile.appendChild(body);
    container.appendChild(tile);
  }

  function getAudioContext() {
    if (typeof window === "undefined") return null;
    const AudioCtor = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtor) return null;

    if (!audioContextRef.current) {
      audioContextRef.current = new AudioCtor();
    }

    if (audioContextRef.current.state === "suspended") {
      void audioContextRef.current.resume().catch(() => {});
    }

    return audioContextRef.current;
  }

  function playTone(frequency: number, durationMs: number, volume = 0.02) {
    const audioContext = getAudioContext();
    if (!audioContext) return;

    const now = audioContext.currentTime;
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();

    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(frequency, now);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(volume, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + durationMs / 1000);

    oscillator.connect(gain);
    gain.connect(audioContext.destination);
    oscillator.start(now);
    oscillator.stop(now + durationMs / 1000 + 0.02);
  }

  function playConnectSound() {
    playTone(880, 120, 0.018);
  }

  function playDisconnectSound() {
    playTone(240, 130, 0.016);
  }

  // Cleanup on unmount / channel change
  useEffect(() => {
    return () => {
      if (!roomRef.current) return;
      socket.emit("voice:leave", { channelId });
      roomRef.current.disconnect();
      roomRef.current = null;
      audioElsRef.current.forEach((el) => el.remove());
      audioElsRef.current.clear();
      gainNodesRef.current.clear();
      setScreenSharing(false);
      setRemoteScreenShareCount(0);
      if (screenShareContainerRef.current) {
        screenShareContainerRef.current.innerHTML = "";
      }
      if (expandedContainerRef?.current) {
        expandedContainerRef.current.innerHTML = "";
      }
    };
  }, [channelId]);

  // Keep the ref in sync so addScreenShareTile always targets the right container
  useEffect(() => {
    liveTakeoverActiveRef.current = liveTakeoverActive;
  }, [liveTakeoverActive]);

  // Move tiles between the small panel (right) and the expanded view (left) on takeover toggle
  useEffect(() => {
    const small = screenShareContainerRef.current;
    const big = expandedContainerRef?.current;
    if (!small || !big) return;
    const source = liveTakeoverActive ? small : big;
    const target = liveTakeoverActive ? big : small;
    Array.from(source.children).forEach((tile) => target.appendChild(tile));
  }, [liveTakeoverActive]);

  useEffect(() => {
    if (joined && !previousJoinedRef.current) {
      playConnectSound();
    }

    if (!joined && previousJoinedRef.current) {
      playDisconnectSound();
    }

    previousJoinedRef.current = joined;
  }, [joined]);

  useEffect(() => {
    if (!joined) {
      setPingMs(null);
      return;
    }

    let canceled = false;

    const checkPing = () => {
      const startedAt = performance.now();
      socket.emit("voice:ping", { channelId }, () => {
        if (canceled) return;
        setPingMs(Math.max(0, Math.round(performance.now() - startedAt)));
      });
    };

    checkPing();
    const intervalId = setInterval(checkPing, 5000);

    return () => {
      canceled = true;
      clearInterval(intervalId);
    };
  }, [joined, channelId]);

  useEffect(() => {
    return () => {
      if (!audioContextRef.current) return;
      void audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    };
  }, []);

  // Join voice on trigger (double-click) — blocked if no VOICE permission
  const lastTriggerRef = useRef(0);
  useEffect(() => {
    if (connectTrigger <= 0) return;
    if (connectChannelId !== channelId) return;
    if (lastTriggerRef.current === connectTrigger) return;
    lastTriggerRef.current = connectTrigger;
    if (!canVoice) return;
    setSidebarTab("voice");
    void join();
  }, [channelId, connectChannelId, connectTrigger, canVoice]);

  async function join() {
    if (roomRef.current || connecting) return;
    setSidebarTab("voice");
    setConnecting(true);
    log("[VOICE] join requested");

    try {
      const res = await fetch(`${API}/voice/token`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ channelId }),
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(text);
      }

      const data = await res.json();
      const lkToken = data?.token;
      if (!lkToken || typeof lkToken !== "string") {
        throw new Error("LiveKit token missing or invalid");
      }

      log("[VOICE] requesting microphone access");
      await navigator.mediaDevices.getUserMedia({
        audio: micDeviceId ? { deviceId: { exact: micDeviceId } } : true,
      });
      log("[VOICE] microphone access granted");

      const room = new Room();

      room.on(RoomEvent.ConnectionStateChanged, (state: ConnectionState) => {
        log(`[LK] state=${state}`);
      });

      room.on(RoomEvent.Disconnected, (reason) => {
        log(`[LK] disconnected reason=${String(reason)}`);
        setJoined(false);
        setConnecting(false);
      });

      room.on(RoomEvent.TrackSubscribed, async (track, publication, participant) => {
        if (track.kind === Track.Kind.Audio) {
          const el = track.attach() as HTMLAudioElement;
          el.autoplay = true;
          el.setAttribute("playsinline", "true");
          document.body.appendChild(el);
          audioElsRef.current.set(participant.identity, el);
          if (outputDeviceId && typeof (el as any).setSinkId === "function") {
            void (el as any).setSinkId(outputDeviceId).catch(() => {});
          }

          // Route through GainNode so volume can exceed 100%
          const ctx = getAudioContext();
          if (ctx) {
            try {
              const source = ctx.createMediaElementSource(el);
              const gain = ctx.createGain();
              gain.gain.value = userVolumesRef.current[participant.identity] ?? 1;
              source.connect(gain);
              gain.connect(ctx.destination);
              gainNodesRef.current.set(participant.identity, gain);
            } catch {
              el.volume = Math.min(1, userVolumesRef.current[participant.identity] ?? 1);
            }
          }

          try {
            await el.play();
          } catch (error: any) {
            log(`[LK] audio play blocked: ${error?.message ?? error}`);
          }
        } else if (track.kind === Track.Kind.Video && publication.source === Track.Source.ScreenShare) {
          const el = track.attach() as HTMLVideoElement;
          const tileId = `remote:${track.sid}`;
          const title = participant?.identity ? `${participant.identity} screen` : "Remote screen";
          addScreenShareTile(el, tileId, title);
          setRemoteScreenShareCount((prev) => prev + 1);
        }
      });

      room.on(RoomEvent.TrackUnsubscribed, (track, publication, participant: RemoteParticipant) => {
        log(`[LK] track unsubscribed kind=${track.kind}`);
        track.detach().forEach((el) => {
          const tile = (el as HTMLElement).closest(".m-screen-share__tile");
          if (tile) {
            tile.remove();
            return;
          }
          el.remove();
        });

        if (track.kind === Track.Kind.Audio) {
          audioElsRef.current.delete(participant.identity);
          gainNodesRef.current.delete(participant.identity);
        } else if (track.kind === Track.Kind.Video && publication.source === Track.Source.ScreenShare) {
          removeScreenShareTile(`remote:${track.sid}`);
          setRemoteScreenShareCount((prev) => Math.max(0, prev - 1));
        }
      });

      room.on(RoomEvent.LocalTrackUnpublished, (publication) => {
        if (publication.source === Track.Source.ScreenShare) {
          setScreenSharing(false);
          removeScreenShareTile("local");
          log("[SCREEN] local screen share stopped");
        }
      });

      room.on(RoomEvent.LocalTrackPublished, (publication) => {
        if (publication.source !== Track.Source.ScreenShare) return;
        if (!publication.track) return;

        const el = publication.track.attach() as HTMLVideoElement;
        el.muted = true;
        addScreenShareTile(el, "local", "Your screen");
        setScreenSharing(true);
        log("[SCREEN] local screen share started");
      });

      await room.connect(LIVEKIT_URL, lkToken);
      await room.localParticipant.setMicrophoneEnabled(true, {
        deviceId: micDeviceId,
      });
      socket.emit("voice:join", { channelId, username });

      roomRef.current = room;
      setMuted(false);
      setJoined(true);
      log("[VOICE] connected");
    } catch (error: any) {
      setJoined(false);
      log(`[FAIL] ${error?.message ?? String(error)}`);
    } finally {
      setConnecting(false);
    }
  }

  async function leave() {
    socket.emit("voice:leave", { channelId });
    roomRef.current?.disconnect();
    roomRef.current = null;
    audioElsRef.current.forEach((el) => el.remove());
    audioElsRef.current.clear();
    gainNodesRef.current.clear();
    setScreenSharing(false);
    setMuted(false);
    setRemoteScreenShareCount(0);
    if (screenShareContainerRef.current) {
      screenShareContainerRef.current.innerHTML = "";
    }
    setJoined(false);
    setConnecting(false);
    log("[VOICE] disconnected");
  }

  async function toggleMute() {
    if (!roomRef.current) return;
    const newMuted = !muted;
    try {
      await roomRef.current.localParticipant.setMicrophoneEnabled(!newMuted);
      setMuted(newMuted);
    } catch (error: any) {
      log(`[MIC] error: ${error?.message ?? error}`);
    }
  }

  async function toggleScreenShare() {
    if (!roomRef.current) return;
    const newState = !screenSharing;

    try {
      await roomRef.current.localParticipant.setScreenShareEnabled(newState);
      setScreenSharing(newState);

      if (newState) {
        const publication = roomRef.current.localParticipant.getTrackPublication(
          Track.Source.ScreenShare,
        );
        if (publication?.track) {
          const el = publication.track.attach() as HTMLVideoElement;
          el.muted = true;
          addScreenShareTile(el, "local", "Your screen");
        }
      } else {
        removeScreenShareTile("local");
      }
    } catch (error: any) {
      log(`[SCREEN] error: ${error?.message ?? error}`);
    }
  }

  const statusDotClass = connecting
    ? "m-voice__status-dot--connecting"
    : joined
      ? "m-voice__status-dot--connected"
      : "m-voice__status-dot--disconnected";

  const statusText = connecting ? "Connecting..." : joined ? "Connected" : "Disconnected";
  const pingText = pingMs === null ? "-- ms" : `${pingMs} ms`;
  const pingClass = pingMs === null
    ? "m-voice__ping--unknown"
    : pingMs > 220
      ? "m-voice__ping--high"
      : pingMs > 120
        ? "m-voice__ping--mid"
        : "m-voice__ping--low";
  const showScreenSharePreview = remoteScreenShareCount > 0 || screenSharing;

  useEffect(() => {
    onLiveStateChange?.(channelId, showScreenSharePreview);
  }, [channelId, onLiveStateChange, showScreenSharePreview]);

  useEffect(() => {
    return () => {
      onLiveStateChange?.(channelId, false);
    };
  }, [channelId, onLiveStateChange]);

  // Reset to members tab when changing channel
  useEffect(() => {
    setSidebarTab("members");
  }, [channelId]);

  // Load all channel members (including offline) from permission model.
  useEffect(() => {
    let cancelled = false;
    setMembersLoading(true);

    Promise.all([
      fetch(`${API}/channels/${channelId}/members`, {
        headers: { Authorization: `Bearer ${token}` },
      }).then((r) => r.json()),
      fetch(`${API}/users`, {
        headers: { Authorization: `Bearer ${token}` },
      }).then((r) => r.json()),
    ])
      .then(([membersRes, usersRes]) => {
        if (cancelled) return;

        const defaultPerm = typeof membersRes?.default_permissions === "number"
          ? membersRes.default_permissions
          : 7;
        const overrides: Array<{ id: string; permissions: number }> = Array.isArray(membersRes?.users)
          ? membersRes.users
          : [];
        const users: Array<User> = Array.isArray(usersRes?.users)
          ? usersRes.users
          : [];
        setAllUsers(users);

        const overridePermByUserId = new Map(overrides.map((u) => [u.id, u.permissions]));
        const nextMembers = users
          .filter((user) => {
            const effectivePerm = overridePermByUserId.has(user.id)
              ? overridePermByUserId.get(user.id)!
              : defaultPerm;
            return hasPerm(effectivePerm, PERM.READ);
          })
          .sort((a, b) => a.username.localeCompare(b.username));

        setAccessibleMembers(nextMembers);
      })
      .catch(() => {
        if (!cancelled) {
          setAllUsers([]);
          setAccessibleMembers([]);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setMembersLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [channelId, token]);

  const activeChannelMembers = new Set(channelMembers);
  const activeVoiceMembers = new Set(voiceUsers.map((user) => user.username));
  const avatarByUsername = new Map(allUsers.map((user) => [user.username, user.avatar_url ?? null]));

  const onlineMembers = accessibleMembers
    .filter((member) => activeChannelMembers.has(member.username) || activeVoiceMembers.has(member.username))
    .sort((a, b) => a.username.localeCompare(b.username));

  const offlineMembers = accessibleMembers
    .filter((member) => !activeChannelMembers.has(member.username) && !activeVoiceMembers.has(member.username))
    .sort((a, b) => a.username.localeCompare(b.username));

  return (
    <>
      <div className="m-voice">
        <div className="m-voice__card">
          <div className="m-voice__body">
              {/* Tab bar */}
              <div className="m-voice__tabs">
                <button
                  className={`m-voice__tab${sidebarTab === "members" ? " m-voice__tab--active" : ""}`}
                  onClick={() => setSidebarTab("members")}
                >
                  Members
                </button>
                <button
                  className={`m-voice__tab${sidebarTab === "voice" ? " m-voice__tab--active" : ""}`}
                  onClick={() => setSidebarTab("voice")}
                >
                  Voice
                  {voiceUsers.length > 0 && (
                    <span className="m-voice__tab-badge">{voiceUsers.length}</span>
                  )}
                </button>
              </div>

              {sidebarTab === "members" ? (
                /* Members tab - sorted by online/offline */
                <div className="m-member-list">
                  {membersLoading ? (
                    <div className="m-voice__empty">Loading...</div>
                  ) : accessibleMembers.length > 0 ? (
                    <>
                      <div className="m-member-group__title">Online ({onlineMembers.length})</div>
                      {onlineMembers.map((member) => {
                        const inVoice = activeVoiceMembers.has(member.username);
                        return (
                          <div
                            key={member.id}
                            className={`m-member-entry${inVoice ? " m-member-entry--in-voice" : ""}`}
                          >
                            <UserAvatar
                              className="m-member-entry__avatar"
                              username={member.username}
                              avatarUrl={
                                member.username === username
                                  ? (currentUserAvatarUrl ?? member.avatar_url)
                                  : member.avatar_url
                              }
                              size={18}
                              accentColor={
                                inVoice
                                  ? "var(--m-green)"
                                  : usernameColor(member.username, theme)
                              }
                            />
                            <span className="m-member-entry__name">{member.username}</span>
                            {inVoice ? (
                              <span className="m-member-entry__status m-member-entry__status--voice">Voice</span>
                            ) : (
                              <span className="m-member-entry__status m-member-entry__status--online">Online</span>
                            )}
                          </div>
                        );
                      })}

                      <div className="m-member-group__title m-member-group__title--offline">
                        Offline ({offlineMembers.length})
                      </div>
                      {offlineMembers.map((member) => (
                        <div key={member.id} className="m-member-entry">
                          <UserAvatar
                            className="m-member-entry__avatar"
                            username={member.username}
                            avatarUrl={
                              member.username === username
                                ? (currentUserAvatarUrl ?? member.avatar_url)
                                : member.avatar_url
                            }
                            size={18}
                            accentColor={usernameColor(member.username, theme)}
                          />
                          <span className="m-member-entry__name">{member.username}</span>
                          <span className="m-member-entry__status m-member-entry__status--offline">
                            Offline
                          </span>
                        </div>
                      ))}
                    </>
                  ) : (
                    <div className="m-voice__empty">No members with read access</div>
                  )}
                </div>
              ) : (
                /* Voice tab — current voice presence + controls */
                <>
                  {voiceUsers.length > 0 ? (
                    <div className="m-voice__users">
                      {voiceUsers.map((user, i) => {
                        const vol = userVolumes[user.username] ?? 1;
                        const isSelf = user.username === username;
                        return (
                          <div
                            className={`m-voice__user${!isSelf ? " m-voice__user--has-vol" : ""}`}
                            key={`${user.username}-${i}`}
                            onContextMenu={!isSelf ? (e: { preventDefault: () => void; clientX: number; clientY: number }) => {
                              e.preventDefault();
                              setVolMenu({ username: user.username, x: e.clientX, y: e.clientY });
                            } : undefined}
                          >
                            <UserAvatar
                              className="m-voice__user-avatar"
                              username={user.username}
                              avatarUrl={
                                user.username === username
                                  ? (currentUserAvatarUrl ?? user.avatar_url ?? (avatarByUsername.get(user.username) as string | null))
                                  : (user.avatar_url ?? (avatarByUsername.get(user.username) as string | null))
                              }
                              size={16}
                              accentColor={usernameColor(user.username, theme)}
                            />
                            {user.username}
                            {!isSelf && vol !== 1 && (
                              <span className="m-voice__user-vol-badge">
                                {Math.round(vol * 100)}%
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="m-voice__empty">No users in voice</div>
                  )}

                  {volMenu && (
                    <>
                      <div className="m-vol-backdrop" onClick={() => setVolMenu(null)} />
                      <div
                        className="m-vol-menu"
                        style={{ left: volMenu.x, top: volMenu.y }}
                        onClick={(e: { stopPropagation: () => void }) => e.stopPropagation()}
                      >
                        <div className="m-vol-menu__title">{volMenu.username}</div>
                        <div className="m-vol-menu__row">
                          <span className="m-vol-menu__icon">
                            {(userVolumes[volMenu.username] ?? 1) === 0 ? "🔇" : "🔊"}
                          </span>
                          <input
                            type="range"
                            min={0}
                            max={2}
                            step={0.02}
                            value={userVolumes[volMenu.username] ?? 1}
                            className="m-vol-menu__slider"
                            onChange={(e: { target: HTMLInputElement }) =>
                              setUserVolume(volMenu.username, parseFloat(e.target.value))
                            }
                          />
                          <span className="m-vol-menu__pct">
                            {Math.round((userVolumes[volMenu.username] ?? 1) * 100)}%
                          </span>
                        </div>
                      </div>
                    </>
                  )}

                  <button className="m-debug-toggle" onClick={() => setShowDebug((p) => !p)}>
                    {showDebug ? "hide logs" : "debug"}
                  </button>

                  {showDebug && (
                    <div className="m-debug">
                      {logs.length === 0 ? (
                        <div style={{ opacity: 0.5 }}>No logs yet.</div>
                      ) : (
                        logs.map((line, i) => (
                          <div className="m-debug__line" key={i}>
                            <span className="m-debug__time">{line.t}</span> {line.msg}
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </>
              )}
          </div>

          <div className="m-voice__bottom">
            <div className="m-voice__bottom-controls">
              <div className="m-voice__controls">
                {joined ? (
                  <div className="m-voice__controls-stack">
                    <button
                      className="m-voice__btn m-voice__btn--leave"
                      onClick={() => leave().catch(console.error)}
                    >
                      Disconnect
                    </button>
                    <div className="m-voice__controls-row">
                      <button
                        className={`m-voice__btn ${muted ? "m-voice__btn--muted" : "m-voice__btn--mute"}`}
                        onClick={toggleMute}
                      >
                        {muted ? "Unmute" : "Mute"}
                      </button>
                      <button
                        className={`m-voice__btn ${screenSharing ? "m-voice__btn--sharing" : "m-voice__btn--share"}`}
                        onClick={toggleScreenShare}
                      >
                        {screenSharing ? "Stop" : "Share"}
                      </button>
                    </div>
                  </div>
                ) : canVoice ? (
                  <button
                    className="m-voice__btn m-voice__btn--join"
                    onClick={() => join().catch(console.error)}
                    disabled={connecting}
                  >
                    {connecting ? "Connecting..." : "Join voice"}
                  </button>
                ) : (
                  <button className="m-voice__btn" disabled title="You do not have voice permission">
                    Voice disabled
                  </button>
                )}
              </div>
            </div>

            <StreamPanel
              expanded={sidebarTab === "voice"}
              visible={showScreenSharePreview}
              screenSharing={screenSharing}
              remoteScreenShareCount={remoteScreenShareCount}
              liveTakeoverActive={liveTakeoverActive}
              onToggleTakeover={() => onToggleLiveTakeover?.(channelId)}
              containerRef={screenShareContainerRef}
            />

            <div className="m-voice__meta">
              <div className="m-voice__status">
                <div className={`m-voice__status-dot ${statusDotClass}`} />
                <span>{statusText}</span>
              </div>
              <span className={`m-voice__ping ${pingClass}`}>Ping {pingText}</span>
              {voiceUsers.length > 0 && (
                <span className="m-voice__meta-count">{voiceUsers.length}</span>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
