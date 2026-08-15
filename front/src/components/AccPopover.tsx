import { useEffect, useState } from "react";
import type { Channel, User } from "../types";
import { permLabel } from "../utils/permissions";
import { UserAvatar } from "./UserAvatar";

const API_BASE = import.meta.env.VITE_API_URL ?? "";

type UserPerm = User & { permissions: number };

type Props = {
  channel: Channel;
  token: string;
  onClose: () => void;
};

export function AccPopover({ channel, token, onClose }: Props) {
  const [defaultPerm, setDefaultPerm] = useState<number | null>(null);
  const [userPerms, setUserPerms] = useState<UserPerm[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${API_BASE}/channels/${channel.id}/members`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.json())
      .then((data) => {
        setDefaultPerm(data.default_permissions ?? 7);
        setUserPerms(data.users ?? []);
        setLoading(false);
      })
      .catch(console.error);
  }, [channel.id, token]);

  return (
    <>
      <div className="m-popover-backdrop" onClick={onClose} />
      <div className="m-popover m-popover--right m-popover--acc">
        <div className="m-popover__title">Access - #{channel.name}</div>

        {loading ? (
          <div className="m-voc-empty">Loading...</div>
        ) : (
          <div className="m-acc-list">
            <div className="m-acc-row">
              <span className="m-acc-row__name">
                <span className="m-acc-row__dot">O</span>
                Everyone
              </span>
              <code className="m-acc-row__perm">{permLabel(defaultPerm!)}</code>
            </div>

            {userPerms.length > 0 && <div className="m-acc-divider" />}

            {userPerms.map((user) => (
              <div key={user.id} className="m-acc-row">
                <span className="m-acc-row__name">
                  <UserAvatar
                    className="m-acc-row__avatar"
                    username={user.username}
                    avatarUrl={user.avatar_url}
                    size={16}
                  />
                  {user.username}
                </span>
                <code className="m-acc-row__perm">{permLabel(user.permissions)}</code>
              </div>
            ))}

            {userPerms.length === 0 && (
              <div className="m-acc-note">No individual overrides - default applies</div>
            )}
          </div>
        )}
      </div>
    </>
  );
}
