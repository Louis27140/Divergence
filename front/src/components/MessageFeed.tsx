import { useEffect, useMemo, useRef, useState } from "react";
import { socket } from "../socket";
import type { Channel, Message, UserColorConfig } from "../types";
import { hasTextChannel } from "../utils/channel";
import { PERM, hasPerm } from "../utils/permissions";
import { type ThemeMode } from "../utils/userColor";
import { MessageLine } from "./MessageLine";

const API_BASE = import.meta.env.VITE_API_URL ?? "";

const ALLOWED_TYPES = ["image/", "audio/", "video/", "application/pdf"];
const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25 MB

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

type MessageFeedProps = {
  channel: Channel | null;
  username: string;
  currentUserAvatarUrl?: string | null;
  token: string;
  theme: ThemeMode;
  isAdmin?: boolean;
  currentUserId?: string;
  userColorConfig?: UserColorConfig;
  onUserContextMenu?: (menu: { x: number; y: number; userId: string; username: string; avatarUrl?: string | null }) => void;
};

type ChannelRoleMember = {
  id: string;
  username: string;
};

type ChannelRole = {
  name: string;
  color?: string;
  permissions: number;
  members: ChannelRoleMember[];
};

type AuthorRoleMeta = {
  roleName: string;
  color?: string;
};

function rolePriority(permissions: number): number {
  if (permissions === PERM.ADMIN) return 100;

  let score = 0;
  if ((permissions & PERM.MANAGE) !== 0) score += 8;
  if ((permissions & PERM.WRITE) !== 0) score += 4;
  if ((permissions & PERM.VOICE) !== 0) score += 2;
  if ((permissions & PERM.READ) !== 0) score += 1;
  return score;
}

export function MessageFeed({
  channel,
  username,
  currentUserAvatarUrl,
  token,
  theme,
  isAdmin = false,
  currentUserId = "",
  userColorConfig,
  onUserContextMenu,
}: MessageFeedProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [authorRoleByUserId, setAuthorRoleByUserId] = useState<Record<string, AuthorRoleMeta>>({});
  const [content, setContent] = useState("");
  const [typingUsers, setTypingUsers] = useState<string[]>([]);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    message: Message;
  } | null>(null);
  const [deletingMessageId, setDeletingMessageId] = useState<string | null>(null);

  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const typingChannelRef = useRef<string | null>(null);
  const isTypingRef = useRef(false);
  const previousChannelIdRef = useRef<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const hasText = hasTextChannel(channel);
  const canWrite = hasPerm(channel?.my_permissions, PERM.WRITE);

  function openUserContextMenu(
    event: { clientX: number; clientY: number },
    user: { id: string; username: string; avatarUrl?: string | null },
  ) {
    if (!onUserContextMenu) return;
    const menuW = 220;
    const menuH = 180;
    const x = Math.max(8, Math.min(event.clientX, window.innerWidth - menuW - 8));
    const y = Math.max(8, Math.min(event.clientY, window.innerHeight - menuH - 8));
    onUserContextMenu({ x, y, userId: user.id, username: user.username, avatarUrl: user.avatarUrl });
  }

  function clearTypingTimer() {
    if (!typingTimeoutRef.current) return;
    clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = null;
  }

  function stopTyping(channelId?: string) {
    const targetChannelId = channelId ?? typingChannelRef.current;
    if (!targetChannelId) return;

    clearTypingTimer();

    if (isTypingRef.current) {
      socket.emit("typing:stop", { channelId: targetChannelId });
      isTypingRef.current = false;
    }

    if (!channelId || channelId === typingChannelRef.current) {
      typingChannelRef.current = null;
    }
  }

  function startTyping() {
    if (!channel || !hasText) return;

    if (!isTypingRef.current || typingChannelRef.current !== channel.id) {
      if (isTypingRef.current && typingChannelRef.current && typingChannelRef.current !== channel.id) {
        socket.emit("typing:stop", { channelId: typingChannelRef.current });
      }

      socket.emit("typing:start", {
        channelId: channel.id,
        username,
      });

      isTypingRef.current = true;
      typingChannelRef.current = channel.id;
    }

    clearTypingTimer();
    typingTimeoutRef.current = setTimeout(() => {
      stopTyping(channel.id);
    }, 1200);
  }

  function clearPendingFile() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPendingFile(null);
    setPreviewUrl(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function closeContextMenu() {
    setContextMenu(null);
  }

  function openMessageContextMenu(event: React.MouseEvent<HTMLDivElement>, message: Message) {
    if (message.author_username !== username) return;

    event.preventDefault();

    const menuWidth = 190;
    const menuHeight = 44;
    const x = Math.max(8, Math.min(event.clientX, window.innerWidth - menuWidth - 8));
    const y = Math.max(8, Math.min(event.clientY, window.innerHeight - menuHeight - 8));

    setContextMenu({
      x,
      y,
      message,
    });
  }

  async function deleteMessage(message: Message) {
    if (deletingMessageId) return;

    setDeletingMessageId(message.id);
    try {
      const res = await fetch(`${API_BASE}/channels/${message.channel_id}/messages/${message.id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || "delete_failed");
      }

      setMessages((prev) => prev.filter((m) => m.id !== message.id));
      closeContextMenu();
    } catch (error: any) {
      alert(`Delete failed: ${error?.message ?? String(error)}`);
    } finally {
      setDeletingMessageId(null);
    }
  }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!ALLOWED_TYPES.some((prefix) => file.type.startsWith(prefix))) {
      alert("Unsupported file type. Allowed formats: images, audio, video, PDF.");
      e.target.value = "";
      return;
    }

    if (file.size > MAX_FILE_SIZE) {
      alert("File too large (max 25 MB).");
      e.target.value = "";
      return;
    }

    if (previewUrl) URL.revokeObjectURL(previewUrl);

    const url =
      file.type.startsWith("image/") || file.type.startsWith("video/")
        ? URL.createObjectURL(file)
        : null;

    setPendingFile(file);
    setPreviewUrl(url);
  }

  // Load messages when channel changes
  useEffect(() => {
    if (!channel || !hasText) {
      setMessages([]);
      return;
    }

    fetch(`${API_BASE}/channels/${channel.id}/messages`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.json())
      .then((res) => setMessages(res.messages))
      .catch(console.error);
  }, [channel?.id, hasText, token]);

  // Load role assignments for username colors by role.
  useEffect(() => {
    if (!channel || !hasText) {
      setAuthorRoleByUserId({});
      return;
    }

    let cancelled = false;

    fetch(`${API_BASE}/channels/${channel.id}/members`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.json())
      .then((res) => {
        if (cancelled) return;

        const roleRows: ChannelRole[] = Array.isArray(res?.roles) ? res.roles : [];
        const bestRoleByUserId = new Map<string, { name: string; color?: string; permissions: number }>();

        for (const role of roleRows) {
          if (!role || typeof role.name !== "string") continue;
          const members = Array.isArray(role.members) ? role.members : [];
          const permissions = typeof role.permissions === "number" ? role.permissions : 0;

          for (const member of members) {
            if (!member || typeof member.id !== "string") continue;
            const current = bestRoleByUserId.get(member.id);

            if (!current) {
              bestRoleByUserId.set(member.id, { name: role.name, color: role.color, permissions });
              continue;
            }

            const currentPriority = rolePriority(current.permissions);
            const nextPriority = rolePriority(permissions);
            if (
              nextPriority > currentPriority
              || (nextPriority === currentPriority && role.name.localeCompare(current.name) < 0)
            ) {
              bestRoleByUserId.set(member.id, { name: role.name, color: role.color, permissions });
            }
          }
        }

        const roleMetaByUserId: Record<string, AuthorRoleMeta> = {};
        for (const [userId, roleMeta] of bestRoleByUserId.entries()) {
          roleMetaByUserId[userId] = {
            roleName: roleMeta.name,
            color: roleMeta.color,
          };
        }

        setAuthorRoleByUserId(roleMetaByUserId);
      })
      .catch(() => {
        if (!cancelled) {
          setAuthorRoleByUserId({});
        }
      });

    return () => {
      cancelled = true;
    };
  }, [channel?.id, hasText, token]);

  // Listen for new messages
  useEffect(() => {
    if (!channel) return;

    function onNewMessage(msg: Message) {
      if (msg.channel_id === channel.id) {
        setMessages((prev) => [msg, ...prev]);
      }
    }

    socket.on("new_message", onNewMessage);
    return () => {
      socket.off("new_message", onNewMessage);
    };
  }, [channel?.id]);

  // Listen for message deletion events
  useEffect(() => {
    if (!channel) return;

    function onMessageDeleted(payload: { channelId: string; messageId: string }) {
      if (payload.channelId !== channel.id) return;
      setMessages((prev) => prev.filter((m) => m.id !== payload.messageId));
      setContextMenu((prev) => {
        if (!prev) return prev;
        return prev.message.id === payload.messageId ? null : prev;
      });
    }

    socket.on("message:deleted", onMessageDeleted);
    return () => {
      socket.off("message:deleted", onMessageDeleted);
    };
  }, [channel?.id]);

  // Reset input and typing when switching channels
  useEffect(() => {
    const previousChannelId = previousChannelIdRef.current;
    if (previousChannelId && previousChannelId !== channel?.id) {
      stopTyping(previousChannelId);
    }

    previousChannelIdRef.current = channel?.id ?? null;
    setContent("");
    setTypingUsers([]);
    clearPendingFile();
    setContextMenu(null);
    setDeletingMessageId(null);
  }, [channel?.id]);

  // Keyboard close for context menu
  useEffect(() => {
    if (!contextMenu) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setContextMenu(null);
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [contextMenu]);

  // Listen typing state for selected channel
  useEffect(() => {
    if (!channel || !hasText) {
      setTypingUsers([]);
      return;
    }

    function onTypingState(payload: { channelId: string; users: string[] }) {
      if (payload.channelId !== channel.id) return;
      setTypingUsers(payload.users.filter((name) => name !== username));
    }

    socket.on("typing:state", onTypingState);
    return () => {
      socket.off("typing:state", onTypingState);
    };
  }, [channel?.id, hasText, username]);

  // Ensure typing state is cleared when unmounting
  useEffect(() => {
    return () => {
      stopTyping();
    };
  }, []);

  const typingText = useMemo(() => {
    if (typingUsers.length === 0) return "";
    if (typingUsers.length === 1) return `${typingUsers[0]} is typing...`;
    if (typingUsers.length === 2) return `${typingUsers[0]} and ${typingUsers[1]} are typing...`;
    return `${typingUsers[0]}, ${typingUsers[1]} and ${typingUsers.length - 2} others are typing...`;
  }, [typingUsers]);

  async function sendMessage() {
    if (!channel || !hasText) return;
    const text = content.trim();
    if (!text && !pendingFile) return;

    // /wizz is text-only, no file
    if (text.toLowerCase() === "/wizz" && !pendingFile) {
      stopTyping(channel.id);
      socket.emit("wizz", { channelId: channel.id, username });
      setContent("");
      return;
    }

    stopTyping(channel.id);

    const formData = new FormData();
    if (text) formData.append("content", text);
    if (pendingFile) formData.append("file", pendingFile);

    await fetch(`${API_BASE}/channels/${channel.id}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: formData,
    });

    setContent("");
    clearPendingFile();
  }

  // No channel selected
  if (!channel) {
    return (
      <div className="m-feed">
        <div className="m-no-channel">
          <div className="m-no-channel__icon">*</div>
          <div>Select a channel to begin</div>
        </div>
      </div>
    );
  }

  // Voice-only channel
  if (!hasText) {
    return (
      <div className="m-feed">
        <div className="m-voice-only">
          <div className="m-voice-only__icon">*</div>
          <div>Voice-only channel</div>
        </div>
      </div>
    );
  }

  return (
    <div className="m-feed">
      <div className="m-messages">
        {messages.length === 0 ? (
          <div className="m-messages-empty">
            <div className="m-messages-empty__icon">-</div>
            <div>No messages yet</div>
          </div>
        ) : (
          messages.map((msg, index) => (
            <MessageLine
              key={msg.id}
              message={msg}
              theme={theme}
              zebra={index % 2 === 1}
              authorRole={authorRoleByUserId[msg.author_id]?.roleName}
              authorColor={
                authorRoleByUserId[msg.author_id]?.color ?? undefined
              }
              authorAvatarUrl={
                msg.author_username === username
                  ? (currentUserAvatarUrl ?? msg.author_avatar_url)
                  : msg.author_avatar_url
              }
              authorColorConfig={
                msg.author_id === currentUserId
                  ? (userColorConfig ?? msg.author_color_config)
                  : msg.author_color_config
              }
              onContextMenu={openMessageContextMenu}
              onUsernameContextMenu={openUserContextMenu}
            />
          ))
        )}
      </div>

      {contextMenu && (
        <>
          <button
            type="button"
            className="m-context-menu-backdrop"
            onClick={closeContextMenu}
            aria-label="Close message menu"
          />
          <div
            className="m-context-menu"
            style={{ left: contextMenu.x, top: contextMenu.y }}
          >
            <button
              type="button"
              className="m-context-menu__item m-context-menu__item--danger"
              onClick={() => {
                void deleteMessage(contextMenu.message);
              }}
              disabled={deletingMessageId === contextMenu.message.id}
            >
              {deletingMessageId === contextMenu.message.id ? "Deleting..." : "Delete"}
            </button>
          </div>
        </>
      )}

      <div className="m-typing-indicator" aria-live="polite">
        {typingText}
      </div>

      {/* File preview — shown above input bar when a file is pending */}
      {pendingFile && canWrite && (
        <div className="m-attach-preview">
          {previewUrl && pendingFile.type.startsWith("image/") && (
            <img src={previewUrl} className="m-attach-preview__thumb" alt="" />
          )}
          {previewUrl && pendingFile.type.startsWith("video/") && (
            <video src={previewUrl} className="m-attach-preview__thumb" muted />
          )}
          <div className="m-attach-preview__info">
            <span className="m-attach-preview__name">{pendingFile.name}</span>
            <span className="m-attach-preview__size">{formatFileSize(pendingFile.size)}</span>
          </div>
          <button className="m-attach-preview__remove" onClick={clearPendingFile} type="button">
            ×
          </button>
        </div>
      )}

      {canWrite ? (
        <div className="m-input-bar">
          {/* Hidden file input */}
          <input
            ref={fileInputRef}
            type="file"
            className="m-input-bar__file-input"
            accept="image/*,audio/*,video/*,application/pdf"
            onChange={handleFileSelect}
          />
          {/* Attach button */}
          <button
            type="button"
            className="m-input-bar__attach"
            onClick={() => fileInputRef.current?.click()}
            title="Attach a file"
          >
            ⊕
          </button>

          <span className="m-input-bar__prompt">&gt;</span>
          <input
            className="m-input-bar__input"
            value={content}
            onChange={(e) => {
              const nextValue = e.target.value;
              setContent(nextValue);

              if (!channel || !hasText) return;

              if (nextValue.trim().length === 0) {
                stopTyping(channel.id);
                return;
              }

              startTyping();
            }}
            placeholder={`Message #${channel.name}...`}
            onKeyDown={(e) => {
              if (e.key === "Enter") sendMessage().catch(console.error);
            }}
          />
          <button
            className="m-input-bar__send"
            onClick={() => sendMessage().catch(console.error)}
            disabled={!content.trim() && !pendingFile}
          >
            GO
          </button>
        </div>
      ) : (
        <div className="m-input-bar m-input-bar--readonly">
          <span className="m-input-bar__readonly-notice">
            ⊘ Read-only - you do not have permission to write in this channel
          </span>
        </div>
      )}
    </div>
  );
}
