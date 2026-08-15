import type { UserColorConfig } from "../types";

export type ThemeMode = "dark" | "light";

function stringHash(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = value.charCodeAt(i) + ((hash << 5) - hash);
  }
  return hash;
}

export function usernameHue(name: string, theme: ThemeMode): number {
  const hash = stringHash(name);

  // Dark theme: use broad hues so usernames are readable and less monochrome.
  if (theme === "dark") {
    return Math.abs(hash) % 360;
  }

  // Light theme: preserve the previous cool/violet family.
  return 262 + (Math.abs(hash) % 28);
}

export function usernameColor(name: string, theme: ThemeMode): string {
  return theme === "dark"
    ? `hsl(${usernameHue(name, theme)}, 62%, 62%)`
    : `hsl(${usernameHue(name, theme)}, 62%, 64%)`;
}

export function roleHue(roleName: string): number {
  const normalized = roleName.trim().toLowerCase();
  const namedHues: Record<string, number> = {
    owner: 36,
    admin: 6,
    moderator: 198,
    mod: 198,
    helper: 154,
  };

  if (namedHues[normalized] !== undefined) {
    return namedHues[normalized];
  }

  return Math.abs(stringHash(normalized)) % 360;
}

export function roleColor(roleName: string, theme: ThemeMode): string {
  const hue = roleHue(roleName);
  return theme === "dark"
    ? `hsl(${hue}, 68%, 64%)`
    : `hsl(${hue}, 68%, 40%)`;
}

export function resolveMainColor(
  config: UserColorConfig | null | undefined,
  fallback: string,
): string {
  if (!config || config.mode === "hash") return fallback;
  if (config.mode === "static") return config.color;
  if (config.mode === "gradient" && config.stops.length > 0) return config.stops[0];
  return fallback;
}

export function resolveNameStyle(
  config: UserColorConfig | null | undefined,
  fallback: string,
): Record<string, string> {
  if (!config || config.mode === "hash") return { color: fallback };
  if (config.mode === "static") return { color: config.color };
  if (config.mode === "gradient") {
    const { stops, angle, animated } = config;
    const base: Record<string, string> = {
      background: animated
        ? `linear-gradient(${angle}deg, ${[...stops, stops[0]].join(", ")})`
        : `linear-gradient(${angle}deg, ${stops.join(", ")})`,
      backgroundSize: animated ? "300% 100%" : "100% 100%",
      WebkitBackgroundClip: "text",
      WebkitTextFillColor: "transparent",
      backgroundClip: "text",
      color: stops[0] ?? fallback,
    };
    if (animated) base.animation = "m-gradient-shift 4s linear infinite";
    return base;
  }
  return { color: fallback };
}
