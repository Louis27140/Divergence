import type { Channel, ChannelType } from "../types";

export function isVoiceType(type: ChannelType): boolean {
  return type === "voice" || type === "both";
}

export function isTextType(type: ChannelType): boolean {
  return type === "text" || type === "both";
}

export function isVoiceCapableChannel(
  channel: Pick<Channel, "type"> | null | undefined,
): boolean {
  if (!channel) return false;
  return isVoiceType(channel.type);
}

export function hasTextChannel(channel: Pick<Channel, "type"> | null | undefined): boolean {
  if (!channel) return false;
  return isTextType(channel.type);
}

export function channelTypeLabel(type: ChannelType): string {
  if (type === "text") return "text";
  if (type === "voice") return "voice";
  return "text + voice";
}
