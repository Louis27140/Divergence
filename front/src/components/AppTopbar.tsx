import type { Channel } from "../types";
import { channelTypeLabel } from "../utils/channel";

type AppTopbarProps = {
  selected: Channel | null;
  username: string;
  onLogout: () => void;
};

export function AppTopbar({ selected, username, onLogout }: AppTopbarProps) {
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
        <div
          className="m-avatar"
          style={{ background: "var(--m-cyan)" }}
        />
        <span className="m-topbar__username">{username}</span>
        <button className="m-topbar__logout" onClick={onLogout}>
          logout
        </button>
      </div>
    </div>
  );
}
