import type { Channel, VoiceUser } from "../types";
import { usernameColor, type ThemeMode } from "../utils/userColor";
import { UserAvatar } from "./UserAvatar";

type Props = {
  channel: Channel | null;
  voiceUsers: VoiceUser[];
  isLive: boolean;
  theme: ThemeMode;
  onClose: () => void;
};

export function VocPopover({ channel, voiceUsers, isLive, theme, onClose }: Props) {
  return (
    <>
      <div className="m-popover-backdrop" onClick={onClose} />
      <div className="m-popover m-popover--right">
        <div className="m-popover__title">
          {channel ? `# ${channel.name} - voice` : "Voice"}
        </div>

        {isLive && (
          <div className="m-voc-live">
            <span className="m-voc-live__dot" />
            Live stream active
          </div>
        )}

        {voiceUsers.length === 0 ? (
          <div className="m-voc-empty">No users in voice</div>
        ) : (
          <div className="m-voice__users" style={{ marginBottom: 0 }}>
            {voiceUsers.map((user, i) => (
              <div className="m-voice__user" key={`${user.username}-${i}`}>
                <UserAvatar
                  className="m-voice__user-avatar"
                  username={user.username}
                  avatarUrl={user.avatar_url}
                  size={16}
                  accentColor={usernameColor(user.username, theme)}
                />
                {user.username}
              </div>
            ))}
          </div>
        )}

        <div className="m-voc-footer">
          {voiceUsers.length} user{voiceUsers.length !== 1 ? "s" : ""} connected
        </div>
      </div>
    </>
  );
}
