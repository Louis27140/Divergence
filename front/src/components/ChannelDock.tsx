import { useState } from "react";
import type { Channel, VoiceUser } from "../types";
import type { ThemeMode } from "../utils/userColor";
import { ChannelTab } from "./ChannelTab";
import { CreatePopover } from "./CreatePopover";

type ChannelDockProps = {
  channels: Channel[];
  selected: Channel | null;
  voiceUsersByChannel: Record<string, VoiceUser[]>;
  token: string;
  theme: ThemeMode;
  canCreate: boolean;
  onSelect: (channel: Channel) => void;
  onOpen: (channel: Channel) => void;
  onCreated: (channel: Channel) => void;
  onToggleTheme: () => void;
};

export function ChannelDock({
  channels,
  selected,
  voiceUsersByChannel,
  token,
  theme,
  canCreate,
  onSelect,
  onOpen,
  onCreated,
  onToggleTheme,
}: ChannelDockProps) {
  const [showCreate, setShowCreate] = useState(false);

  return (
    <div className="m-dock">
      {/* Left: create channel button (admin only) */}
      {canCreate && (
        <div className="m-popover-anchor">
          <button
            className="m-dock__create"
            onClick={() => setShowCreate((p) => !p)}
            title="Create channel"
          >
            +
          </button>

          {showCreate && (
            <CreatePopover
              token={token}
              onCreated={onCreated}
              onClose={() => setShowCreate(false)}
            />
          )}
        </div>
      )}

      {/* Center: channel tabs */}
      <div className="m-dock__tabs">
        {channels.map((ch) => {
          const voiceUsers = voiceUsersByChannel[ch.id] ?? [];
          const isActive = selected?.id === ch.id;

          return (
            <ChannelTab
              key={ch.id}
              channel={ch}
              isActive={isActive}
              voiceCount={voiceUsers.length}
              onSelect={onSelect}
              onOpen={onOpen}
            />
          );
        })}
      </div>

      {/* Right: system buttons */}
      <div className="m-dock__system">
        <button
          className="m-dock__system-btn m-dock__system-btn--theme"
          onClick={onToggleTheme}
          title={theme === "dark" ? "Light theme" : "Dark theme"}
        >
          {theme === "dark" ? "\u2600" : "\u25D1"}
        </button>
      </div>
    </div>
  );
}
