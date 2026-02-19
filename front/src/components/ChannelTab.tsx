import type { Channel } from "../types";
import { isVoiceCapableChannel } from "../utils/channel";

type ChannelTabProps = {
  channel: Channel;
  isActive: boolean;
  voiceCount: number;
  onSelect: (channel: Channel) => void;
  onOpen: (channel: Channel) => void;
};

const DOT_CLASS_BY_TYPE: Record<Channel["type"], string> = {
  text: "m-dock__tab-dot--text",
  voice: "m-dock__tab-dot--voice",
  both: "m-dock__tab-dot--both",
};

export function ChannelTab({
  channel,
  isActive,
  voiceCount,
  onSelect,
  onOpen,
}: ChannelTabProps) {
  return (
    <button
      className={`m-dock__tab ${isActive ? "m-dock__tab--active" : ""}`}
      onClick={() => onSelect(channel)}
      onDoubleClick={() => onOpen(channel)}
    >
      <span className={`m-dock__tab-dot ${DOT_CLASS_BY_TYPE[channel.type]}`} />
      <span className="m-dock__tab-name">{channel.name}</span>
      {isVoiceCapableChannel(channel) && voiceCount > 0 && (
        <span className="m-dock__voice-count">{voiceCount}</span>
      )}
    </button>
  );
}
