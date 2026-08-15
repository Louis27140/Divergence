import type { MouseEvent } from "react";
import type { Message, UserColorConfig } from "../types";
import { usernameColor, resolveMainColor, resolveNameStyle, type ThemeMode } from "../utils/userColor";
import { UserAvatar } from "./UserAvatar";

const API_BASE = import.meta.env.VITE_API_URL ?? "";

type MessageLineProps = {
  message: Message;
  theme: ThemeMode;
  zebra?: boolean;
  /** Role name — shown as a badge next to the username */
  authorRole?: string;
  /** Role color (hex from DB) — used only for the role badge, NOT the username */
  authorColor?: string;
  authorAvatarUrl?: string | null;
  /** Personal color config of the author — used for the username text and left bar */
  authorColorConfig?: UserColorConfig | null;
  onContextMenu?: (event: React.MouseEvent<HTMLDivElement>, message: Message) => void;
  onUsernameContextMenu?: (
    event: MouseEvent<HTMLElement>,
    user: { id: string; username: string; avatarUrl?: string | null }
  ) => void;
};

function formatMessageDateTime(rawDate: string): string {
  const date = new Date(rawDate);
  if (Number.isNaN(date.getTime())) {
    return rawDate;
  }

  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfMessageDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const dayDiff = Math.round((startOfToday.getTime() - startOfMessageDay.getTime()) / 86400000);

  const time = new Intl.DateTimeFormat("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);

  if (dayDiff === 0) {
    return `Aujourd'hui ${time}`;
  }

  if (dayDiff === 1) {
    return `Hier ${time}`;
  }

  const fullDate = new Intl.DateTimeFormat("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);

  return `${fullDate} ${time}`;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function toAlpha(color: string, alpha: number): string {
  const hslMatch = color.match(/^hsl\(([^)]+)\)$/i);
  if (hslMatch) return `hsla(${hslMatch[1]}, ${alpha})`;

  const hexMatch = color.match(/^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i);
  if (hexMatch) {
    let hex = hexMatch[1];
    if (hex.length === 3 || hex.length === 4) {
      hex = hex.split("").map((c) => c + c).join("");
    }
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  return color;
}

function FileAttachment({ message }: { message: Message }) {
  if (!message.file_url) return null;

  const url = `${API_BASE}${message.file_url}`;
  const type = message.file_type ?? "";
  const name = message.file_name ?? "fichier";
  const size = message.file_size ?? 0;

  if (type.startsWith("image/")) {
    return (
      <div className="m-attach">
        <a href={url} target="_blank" rel="noreferrer">
          <img src={url} alt={name} className="m-attach__image" />
        </a>
        <div className="m-attach__meta">
          {name} · {formatFileSize(size)}
        </div>
      </div>
    );
  }

  if (type.startsWith("video/")) {
    return (
      <div className="m-attach">
        <video src={url} controls className="m-attach__video" />
        <div className="m-attach__meta">
          {name} · {formatFileSize(size)}
        </div>
      </div>
    );
  }

  if (type.startsWith("audio/")) {
    return (
      <div className="m-attach">
        <audio src={url} controls className="m-attach__audio" />
        <div className="m-attach__meta">
          {name} · {formatFileSize(size)}
        </div>
      </div>
    );
  }

  // PDF or other file — generic download link
  return (
    <div className="m-attach m-attach--file">
      <a href={url} target="_blank" rel="noreferrer" className="m-attach__link" download={name}>
        <span className="m-attach__file-icon">⊡</span>
        <span className="m-attach__file-name">{name}</span>
        <span className="m-attach__file-size">{formatFileSize(size)}</span>
      </a>
    </div>
  );
}

export function MessageLine({
  message,
  theme,
  zebra = false,
  authorRole,
  authorColor,
  authorAvatarUrl,
  authorColorConfig,
  onContextMenu,
  onUsernameContextMenu,
}: MessageLineProps) {
  const hashColor = usernameColor(message.author_username, theme);
  // Personal color: drives the username text and left bar
  const accentColor = resolveMainColor(authorColorConfig, hashColor);
  const nameStyle = resolveNameStyle(authorColorConfig, hashColor);
  // Role badge color: completely separate from personal color
  const badgeColor = authorColor ?? accentColor;
  const dateTime = formatMessageDateTime(message.created_at);

  return (
    <div
      className={`m-msg${zebra ? " m-msg--zebra" : ""}`}
      onContextMenu={(event) => {
        onContextMenu?.(event, message);
      }}
    >
      <div className="m-msg__bar" style={{ background: accentColor }} />
      <UserAvatar
        className="m-msg__avatar"
        username={message.author_username}
        avatarUrl={authorAvatarUrl}
        accentColor={accentColor}
      />
      <div className="m-msg__main">
        <div className="m-msg__head">
          <div
            className="m-msg__author"
            onContextMenu={(e: MouseEvent<HTMLDivElement>) => {
              e.preventDefault();
              e.stopPropagation();
              onUsernameContextMenu?.(e, {
                id: message.author_id,
                username: message.author_username,
                avatarUrl: authorAvatarUrl,
              });
            }}
          >
            <span style={nameStyle as any}>{message.author_username}</span>
          </div>
          {authorRole && (
            <span
              className="m-msg__role"
              style={{
                color: badgeColor,
                borderColor: toAlpha(badgeColor, 0.5),
                background: toAlpha(badgeColor, 0.12),
              }}
            >
              {authorRole}
            </span>
          )}
          <div className="m-msg__time" title={message.created_at}>
            {dateTime}
          </div>
        </div>
        <div className="m-msg__body">
          {message.content && (
            <div className="m-msg__text">{message.content}</div>
          )}
          <FileAttachment message={message} />
        </div>
      </div>
    </div>
  );
}
