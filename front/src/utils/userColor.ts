export function usernameHue(name: string): number {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return Math.abs(hash) % 360;
}

export function usernameColor(name: string): string {
  return `hsl(${usernameHue(name)}, 70%, 65%)`;
}
