import { useEffect, useMemo, useState, type CSSProperties } from "react";

const API_BASE = import.meta.env.VITE_API_URL ?? "";

function initials(username: string): string {
  const parts = username.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  }
  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }
  return "??";
}

function toAlpha(color: string, alpha: number): string | null {
  const match = color.match(/^hsl\(([^)]+)\)$/i);
  if (!match) return null;
  return `hsla(${match[1]}, ${alpha})`;
}

function avatarSrc(avatarUrl: string | null | undefined): string | null {
  if (!avatarUrl) return null;
  if (/^https?:\/\//i.test(avatarUrl)) return avatarUrl;
  return `${API_BASE}${avatarUrl}`;
}

type UserAvatarProps = {
  username: string;
  avatarUrl?: string | null;
  className?: string;
  size?: number;
  accentColor?: string;
};

export function UserAvatar({
  username,
  avatarUrl,
  className,
  size,
  accentColor,
}: UserAvatarProps) {
  const [failed, setFailed] = useState(false);
  const src = avatarSrc(avatarUrl);

  useEffect(() => {
    setFailed(false);
  }, [avatarUrl]);

  const style = useMemo(() => {
    const next: CSSProperties = {};
    if (typeof size === "number") {
      next.width = size;
      next.height = size;
    }
    if (accentColor) {
      next.color = accentColor;
      next.borderColor = accentColor;
      const tinted = toAlpha(accentColor, 0.14);
      if (tinted) {
        next.background = tinted;
      }
    }
    return next;
  }, [accentColor, size]);

  return (
    <span className={`m-user-avatar${className ? ` ${className}` : ""}`} style={style} title={username}>
      {src && !failed ? (
        <img
          className="m-user-avatar__img"
          src={src}
          alt={username}
          loading="lazy"
          onError={() => setFailed(true)}
        />
      ) : (
        <span className="m-user-avatar__fallback">{initials(username)}</span>
      )}
    </span>
  );
}
