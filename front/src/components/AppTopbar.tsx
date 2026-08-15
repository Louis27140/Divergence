import { useRef, useState } from "react";
import type { AudioDeviceConfig, Channel, UserColorConfig } from "../types";
import { UserAvatar } from "./UserAvatar";
import { channelTypeLabel } from "../utils/channel";
import { UserSettingsPopover } from "./UserSettingsPopover";

type AppTopbarProps = {
  selected: Channel | null;
  username: string;
  userAvatarUrl?: string | null;
  avatarUploading?: boolean;
  isAdmin?: boolean;
  onPickAvatar: (file: File) => void;
  onOpenAdmin?: () => void;
  onLogout: () => void;
  userColorConfig: UserColorConfig;
  audioConfig: AudioDeviceConfig;
  onColorChange: (c: UserColorConfig) => void;
  onAudioChange: (c: AudioDeviceConfig) => void;
};

export function AppTopbar({
  selected,
  username,
  userAvatarUrl,
  avatarUploading = false,
  isAdmin = false,
  onPickAvatar,
  onOpenAdmin,
  onLogout,
  userColorConfig,
  audioConfig,
  onColorChange,
  onAudioChange,
}: AppTopbarProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [showSettings, setShowSettings] = useState(false);
  const typeLabel = selected ? channelTypeLabel(selected.type) : "";

  return (
    <div className="m-topbar">
      <div className="m-brand">Divergence</div>

      <div className="m-topbar__channel">
        {selected ? (
          <>
            <span className="m-topbar__channel-name">{selected.name}</span>
            <span className="m-topbar__channel-type">{typeLabel}</span>
          </>
        ) : (
          <span style={{ color: "var(--m-text-3)" }}>No channel selected</span>
        )}
      </div>

      <div className="m-topbar__user">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="m-topbar__avatar-input"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) onPickAvatar(file);
            event.currentTarget.value = "";
          }}
        />
        <button
          type="button"
          className="m-topbar__avatar-btn"
          title={avatarUploading ? "Uploading avatar..." : "Change avatar"}
          onClick={() => fileInputRef.current?.click()}
          disabled={avatarUploading}
        >
          <UserAvatar
            username={username}
            avatarUrl={userAvatarUrl}
            className="m-topbar__avatar"
            size={24}
          />
        </button>
        <button
          type="button"
          className="m-topbar__username-btn"
          onClick={() => setShowSettings((p: boolean) => !p)}
        >
          {username}
        </button>
        {showSettings && (
          <UserSettingsPopover
            username={username}
            colorConfig={userColorConfig}
            audioConfig={audioConfig}
            onColorChange={(c) => { onColorChange(c); setShowSettings(false); }}
            onAudioChange={onAudioChange}
            onClose={() => setShowSettings(false)}
          />
        )}
        {isAdmin && (
          <button
            className="m-topbar__admin-btn"
            onClick={onOpenAdmin}
            type="button"
            title="Administration"
          >
            admin
          </button>
        )}
        <button className="m-topbar__logout" onClick={onLogout}>
          logout
        </button>
      </div>
    </div>
  );
}
