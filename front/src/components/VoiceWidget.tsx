import { ConnectionState, Room, RoomEvent, Track } from "livekit-client";
import { useEffect, useRef, useState } from "react";
import { socket } from "../socket";
import type { VoiceUser } from "../types";
import { usernameColor } from "../utils/userColor";
import { StreamPanel } from "./StreamPanel";

const API = import.meta.env.VITE_API_URL;
const LIVEKIT_URL = import.meta.env.VITE_LIVEKIT_URL;

type LogLine = { t: string; msg: string };

type VoiceWidgetProps = {
  channelId: string;
  username: string;
  token: string;
  voiceUsers: VoiceUser[];
  connectTrigger?: number;
  connectChannelId?: string | null;
  onLiveStateChange?: (channelId: string, isLive: boolean) => void;
  onToggleLiveTakeover?: (channelId: string) => void;
  liveTakeoverActive?: boolean;
  /** Container in the main area where tiles are moved when live takeover is active */
  expandedContainerRef?: { current: HTMLDivElement | null };
};

export function VoiceWidget({
  channelId,
  username,
  token,
  voiceUsers,
  connectTrigger = 0,
  connectChannelId = null,
  onLiveStateChange,
  onToggleLiveTakeover,
  liveTakeoverActive = false,
  expandedContainerRef,
}: VoiceWidgetProps) {
  const roomRef = useRef<Room | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioElsRef = useRef<HTMLAudioElement[]>([]);
  const [joined, setJoined] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [pingMs, setPingMs] = useState<number | null>(null);
  const [expanded, setExpanded] = useState(true);
  const [showDebug, setShowDebug] = useState(false);
  const [logs, setLogs] = useState<LogLine[]>([]);

  const [muted, setMuted] = useState(false);
  const [screenSharing, setScreenSharing] = useState(false);
  const [remoteScreenShareCount, setRemoteScreenShareCount] = useState(0);
  const screenShareContainerRef = useRef<HTMLDivElement>(null);
  const previousJoinedRef = useRef(false);
  // Ref so non-reactive DOM functions (addScreenShareTile) always see the current value
  const liveTakeoverActiveRef = useRef(liveTakeoverActive);

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
    fullscreenBtn.textContent = "Plein ecran";
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
      audioElsRef.current = [];
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

  // Join voice on trigger (double-click)
  const lastTriggerRef = useRef(0);
  useEffect(() => {
    if (connectTrigger <= 0) return;
    if (connectChannelId !== channelId) return;
    if (lastTriggerRef.current === connectTrigger) return;
    lastTriggerRef.current = connectTrigger;
    void join();
  }, [channelId, connectChannelId, connectTrigger]);

  async function join() {
    if (roomRef.current || connecting) return;
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
      await navigator.mediaDevices.getUserMedia({ audio: true });
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
          audioElsRef.current.push(el);
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

      room.on(RoomEvent.TrackUnsubscribed, (track, publication) => {
        log(`[LK] track unsubscribed kind=${track.kind}`);
        track.detach().forEach((el) => {
          const tile = (el as HTMLElement).closest(".m-screen-share__tile");
          if (tile) {
            tile.remove();
            return;
          }
          el.remove();
        });

        if (track.kind === Track.Kind.Video && publication.source === Track.Source.ScreenShare) {
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
      await room.localParticipant.setMicrophoneEnabled(true);
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
    audioElsRef.current = [];
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

  return (
    <>
      <div className="m-voice">
        <div className="m-voice__card">
          <div className="m-voice__header" onClick={() => setExpanded((p) => !p)}>
            <div className="m-voice__title">Voice</div>
            <div className="m-voice__toggle">{expanded ? "▾" : "▸"}</div>
          </div>

          {expanded && (
            <div className="m-voice__body">
              {voiceUsers.length > 0 && (
                <div className="m-voice__users">
                  {voiceUsers.map((user, i) => (
                    <div className="m-voice__user" key={`${user.username}-${i}`}>
                      <div
                        className="m-voice__user-dot"
                        style={{ background: usernameColor(user.username) }}
                      />
                      {user.username}
                    </div>
                  ))}
                </div>
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
            </div>
          )}

          <div className="m-voice__bottom">
            <StreamPanel
              expanded={expanded}
              visible={showScreenSharePreview}
              screenSharing={screenSharing}
              remoteScreenShareCount={remoteScreenShareCount}
              liveTakeoverActive={liveTakeoverActive}
              onToggleTakeover={() => onToggleLiveTakeover?.(channelId)}
              containerRef={screenShareContainerRef}
            />

            {expanded && (
              <div className="m-voice__bottom-controls">
                <div className="m-voice__controls">
                  {joined ? (
                    <>
                      <button
                        className="m-voice__btn m-voice__btn--leave"
                        onClick={() => leave().catch(console.error)}
                      >
                        Leave
                      </button>
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
                    </>
                  ) : (
                    <button
                      className="m-voice__btn m-voice__btn--join"
                      onClick={() => join().catch(console.error)}
                      disabled={connecting}
                    >
                      {connecting ? "Connecting..." : "Join Voice"}
                    </button>
                  )}
                </div>
              </div>
            )}

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
