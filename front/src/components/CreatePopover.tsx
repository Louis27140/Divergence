import { useEffect, useState } from "react";
import { api } from "../api";
import type { Channel, ChannelType } from "../types";

type CreatePopoverProps = {
  token: string;
  onCreated: (channel: Channel) => void;
  onClose: () => void;
};

const TYPES: { value: ChannelType; label: string }[] = [
  { value: "text", label: "Text" },
  { value: "voice", label: "Voice" },
  { value: "both", label: "Both" },
];

export function CreatePopover({ token, onCreated, onClose }: CreatePopoverProps) {
  const [name, setName] = useState("");
  const [type, setType] = useState<ChannelType>("both");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function handleCreate() {
    const trimmed = name.trim();
    if (!trimmed || loading) return;

    setLoading(true);
    try {
      const res = await api<{ channel: Channel }>(
        "/channels",
        { method: "POST", body: JSON.stringify({ name: trimmed, type }) },
        token,
      );
      onCreated(res.channel);
      onClose();
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <div className="m-popover-backdrop" onClick={onClose} />
      <div className="m-popover">
        <div className="m-popover__title">New Channel</div>
        <input
          className="m-popover__input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="channel-name"
          autoFocus
          onKeyDown={(e) => {
            if (e.key === "Enter") handleCreate().catch(() => {});
          }}
        />
        <div className="m-popover__types">
          {TYPES.map((t) => (
            <button
              key={t.value}
              className={`m-popover__type ${type === t.value ? "m-popover__type--active" : ""}`}
              onClick={() => setType(t.value)}
              type="button"
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="m-popover__actions">
          <button className="m-popover__btn m-popover__btn--cancel" onClick={onClose} type="button">
            Cancel
          </button>
          <button
            className="m-popover__btn m-popover__btn--create"
            onClick={() => handleCreate().catch(() => {})}
            disabled={loading || !name.trim()}
          >
            {loading ? "..." : "Create"}
          </button>
        </div>
      </div>
    </>
  );
}
