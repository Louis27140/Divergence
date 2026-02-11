import { useEffect, useMemo, useRef, useState } from "react";
import { Room, RoomEvent, Track, ConnectionState } from "livekit-client";
import { socket } from "../socket";

const API = import.meta.env.VITE_API_URL;
const LIVEKIT_URL = import.meta.env.VITE_LIVEKIT_URL;

type LogLine = { t: string; msg: string };

export function VoiceButton({
  channelId,
  username,
  token,
}: {
  channelId: string;
  username: string;
  token: string;
}) {
  const roomRef = useRef<Room | null>(null);
  const audioElsRef = useRef<HTMLAudioElement[]>([]);
  const [joined, setJoined] = useState(false);
  const [logs, setLogs] = useState<LogLine[]>([]);

  // Mute
  const [muted, setMuted] = useState(false);

  // Screen sharing
  const [screenSharing, setScreenSharing] = useState(false);
  const [remoteScreenShareCount, setRemoteScreenShareCount] = useState(0);
  const screenShareContainerRef = useRef<HTMLDivElement>(null);

  const canShare = useMemo(() => {
    try {
      return typeof navigator !== "undefined" && "share" in navigator;
    } catch {
      return false;
    }
  }, []);

  function log(msg: string) {
    const t = new Date().toLocaleTimeString();
    setLogs((prev) => [...prev.slice(-200), { t, msg }]);
  }

  function clearLogs() {
    setLogs([]);
  }

  async function shareLogs() {
    const text = logs.map((l) => `${l.t} ${l.msg}`).join("\n");
    try {
      // @ts-ignore
      await navigator.share?.({ title: "Voice debug logs", text });
    } catch {
      // ignore (share canceled)
    }
  }

  useEffect(() => {
    return () => {
      if (roomRef.current) {
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
      }
    };
  }, [channelId]);

  async function join() {
    log("[1] join clicked");

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
        const t = await res.text();
        throw new Error(t);
      }

      const data = await res.json();
      const lkToken = data?.token;
      if (!lkToken || typeof lkToken !== "string") throw new Error("LiveKit token missing/invalid");

      log("[4] getUserMedia(audio)");
      await navigator.mediaDevices.getUserMedia({ audio: true });
      log("[4 OK] microphone access granted");

      const room = new Room();

      room.on(RoomEvent.ConnectionStateChanged, (state: ConnectionState) => {
        log(`[LK] state=${state}`);
      });

      room.on(RoomEvent.Disconnected, (reason) => {
        log(`[LK] disconnected reason=${String(reason)}`);
      });

      room.on(RoomEvent.TrackSubscribed, async (track) => {
        if (track.kind === Track.Kind.Audio) {
          const el = track.attach() as HTMLAudioElement;
          el.autoplay = true;
          el.setAttribute("playsinline", "true");
          document.body.appendChild(el);
          audioElsRef.current.push(el);

          try {
            await el.play();
          } catch (e: any) {
            log(`[LK] audio play blocked: ${e?.message ?? e}`);
          }
        } else if (track.kind === Track.Kind.Video) {
          const el = track.attach() as HTMLVideoElement;
          el.autoplay = true;
          el.setAttribute("playsinline", "true");
          el.style.width = "100%";
          el.style.maxHeight = "70vh";
          el.style.borderRadius = "8px";
          el.style.background = "#000";
          screenShareContainerRef.current?.appendChild(el);
          setRemoteScreenShareCount((prev) => prev + 1);
        }
      });

      room.on(RoomEvent.TrackUnsubscribed, (track) => {
        log(`[LK] track unsubscribed kind=${track.kind}`);
        track.detach().forEach((el) => el.remove());
        if (track.kind === Track.Kind.Video) {
          setRemoteScreenShareCount((prev) => Math.max(0, prev - 1));
        }
      });

      room.on(RoomEvent.LocalTrackUnpublished, (publication) => {
        if (publication.source === Track.Source.ScreenShare) {
          setScreenSharing(false);
          const container = screenShareContainerRef.current;
          if (container) {
            container.querySelectorAll<HTMLVideoElement>("[data-local-screen-share]").forEach((el) => {
              el.srcObject = null;
              el.remove();
            });
          }
          log("[SCREEN] local screen share stopped (browser)");
        }
      });

      await room.connect(LIVEKIT_URL, lkToken);
      await room.localParticipant.setMicrophoneEnabled(true);
      socket.emit("voice:join", { channelId, username });

      roomRef.current = room;
      setJoined(true);
    } catch (e: any) {
      log(`[FAIL] ${e?.message ?? String(e)}`);
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
  }

  async function toggleMute() {
    if (!roomRef.current) return;
    const newMuted = !muted;
    try {
      await roomRef.current.localParticipant.setMicrophoneEnabled(!newMuted);
      setMuted(newMuted);
    } catch (e: any) {
      log(`[MIC] error: ${e?.message ?? e}`);
    }
  }

  async function toggleScreenShare() {
    if (!roomRef.current) return;
    const newState = !screenSharing;
    try {
      await roomRef.current.localParticipant.setScreenShareEnabled(newState);
      setScreenSharing(newState);

      if (newState) {
        // Attach local preview
        const pub = roomRef.current.localParticipant.getTrackPublication(Track.Source.ScreenShare);
        if (pub?.track) {
          const el = pub.track.attach() as HTMLVideoElement;
          el.autoplay = true;
          el.muted = true;
          el.setAttribute("playsinline", "true");
          el.style.width = "100%";
          el.style.maxHeight = "70vh";
          el.style.borderRadius = "8px";
          el.style.background = "#000";
          el.dataset.localScreenShare = "true";
          screenShareContainerRef.current?.appendChild(el);
        }
      } else {
        // Remove local preview
        const container = screenShareContainerRef.current;
        if (container) {
          container.querySelectorAll<HTMLVideoElement>("[data-local-screen-share]").forEach((el) => {
            el.srcObject = null;
            el.remove();
          });
        }
      }

    } catch (e: any) {
      log(`[SCREEN] error: ${e?.message ?? e}`);
    }
  }

  return (
    <div style={{ display: "grid", gap: 8 }}>
      <button onClick={joined ? leave : join}>
        {joined ? "Leave voice" : "Join voice"}
      </button>

      {joined && (
        <div style={{ display: "flex", gap: 6 }}>
          <button
            onClick={toggleMute}
            style={{
              flex: 1,
              background: muted ? "#f59e0b" : "#22c55e",
              color: "white",
              border: "none",
              padding: "8px 12px",
              borderRadius: 6,
              cursor: "pointer",
              fontWeight: 600,
            }}
          >
            {muted ? "🔇 Unmute" : "🎙 Mute"}
          </button>
          <button
            onClick={toggleScreenShare}
            style={{
              flex: 1,
              background: screenSharing ? "#ef4444" : "#6366f1",
              color: "white",
              border: "none",
              padding: "8px 12px",
              borderRadius: 6,
              cursor: "pointer",
              fontWeight: 600,
            }}
          >
            {screenSharing ? "⏹ Stop sharing" : "🖥 Share screen"}
          </button>
        </div>
      )}

      {/* Screen share video panel */}
      <div
        style={{
          position: "fixed",
          top: 60,
          left: "50%",
          transform: "translateX(-50%)",
          width: "70vw",
          maxHeight: "80vh",
          background: "#111",
          borderRadius: 12,
          padding: 16,
          zIndex: 10000,
          boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
          display: remoteScreenShareCount > 0 || screenSharing ? "block" : "none",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 8,
          }}
        >
          <span style={{ color: "#fff", fontSize: 14, fontWeight: 600 }}>
            {screenSharing && remoteScreenShareCount === 0
              ? "📡 You are sharing your screen"
              : `🖥 Screen Share (${remoteScreenShareCount})`}
          </span>
        </div>
        <div
          ref={screenShareContainerRef}
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 8,
            alignItems: "center",
            overflow: "auto",
            maxHeight: "70vh",
          }}
        />
      </div>

      {/* Debug panel */}
      <div
        style={{
          position: "fixed",
          left: 8,
          right: 8,
          bottom: 8,
          maxHeight: "40vh",
          overflow: "auto",
          background: "rgba(0,0,0,0.85)",
          color: "white",
          padding: 10,
          borderRadius: 10,
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          fontSize: 12,
          zIndex: 9999,
        }}
      >
        <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
          <button onClick={clearLogs}>Clear</button>
          {canShare && <button onClick={shareLogs}>Share</button>}
        </div>

        {logs.length === 0 ? (
          <div style={{ opacity: 0.8 }}>No logs yet.</div>
        ) : (
          logs.map((l, i) => (
            <div key={i}>
              <span style={{ opacity: 0.7 }}>{l.t}</span>{" "}
              <span>{l.msg}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
