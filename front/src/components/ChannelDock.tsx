import { useState } from "react";
import type { Channel, VoiceUser } from "../types";
import { CreatePopover } from "./CreatePopover";

type ChannelDockProps = {
  channels: Channel[];
  selected: Channel | null;
  voiceUsersByChannel: Record<string, VoiceUser[]>;
  token: string;
  onSelect: (channel: Channel) => void;
  onOpen: (channel: Channel) => void;
  onCreated: (channel: Channel) => void;
};

const DOT_CLASS: Record<string, string> = {
  text: "m-dock__tab-dot--text",
  voice: "m-dock__tab-dot--voice",
  both: "m-dock__tab-dot--both",
};

export function ChannelDock({
  channels,
  selected,
  voiceUsersByChannel,
  token,
  onSelect,
  onOpen,
  onCreated,
}: ChannelDockProps) {
  const [showCreate, setShowCreate] = useState(false);

  return (
    <div className="m-dock">
      <div className="m-dock__tabs">
        {channels.map((ch) => {
          const voiceUsers = voiceUsersByChannel[ch.id] ?? [];
          const hasVoice = ch.type === "voice" || ch.type === "both";
          const isActive = selected?.id === ch.id;

          return (
            <button
              key={ch.id}
              className={`m-dock__tab ${isActive ? "m-dock__tab--active" : ""}`}
              onClick={() => onSelect(ch)}
              onDoubleClick={() => onOpen(ch)}
            >
              <span className={`m-dock__tab-dot ${DOT_CLASS[ch.type] ?? ""}`} />
              <span className="m-dock__tab-name">{ch.name}</span>
              {hasVoice && voiceUsers.length > 0 && (
                <span className="m-dock__voice-count">{voiceUsers.length}</span>
              )}
            </button>
          );
        })}
      </div>

      <div className="m-popover-anchor">
        <button
          className="m-dock__create"
          onClick={() => setShowCreate((p) => !p)}
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
    </div>
  );
}
