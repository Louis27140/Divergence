import { PERM, toggleAdmin, togglePermBit } from "../utils/permissions";

const BIT_DEFS: { label: string; flag: number; title: string }[] = [
  { label: "R", flag: PERM.READ, title: "Read - see channel and messages" },
  { label: "W", flag: PERM.WRITE, title: "Write - send messages" },
  { label: "V", flag: PERM.VOICE, title: "Voice - join voice channel" },
  { label: "M", flag: PERM.MANAGE, title: "Manage - edit channel roles" },
];

type Props = {
  value: number;
  onChange: (next: number) => void;
  disabled?: boolean;
};

export function PermGrid({ value, onChange, disabled }: Props) {
  const isAdmin = value === PERM.ADMIN;

  return (
    <div className="m-perm-grid">
      <button
        type="button"
        className={`m-perm-bit${isAdmin ? " m-perm-bit--on" : " m-perm-bit--off"}`}
        onClick={() => !disabled && onChange(toggleAdmin(value))}
        title="Admin - all permissions"
      >
        A
      </button>

      {BIT_DEFS.map(({ label, flag, title }) => {
        const active = isAdmin || (value & flag) !== 0;
        return (
          <button
            key={flag}
            type="button"
            className={`m-perm-bit${active ? " m-perm-bit--on" : " m-perm-bit--off"}${isAdmin ? " m-perm-bit--inherited" : ""}`}
            onClick={() => !disabled && !isAdmin && onChange(togglePermBit(value, flag))}
            title={title}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}