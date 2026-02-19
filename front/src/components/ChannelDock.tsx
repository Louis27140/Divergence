import { useState } from "react";
import type { Channel, VoiceUser } from "../types";
import { ChannelTab } from "./ChannelTab";
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
