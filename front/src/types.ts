export type ChannelType = "text" | "voice" | "both";

export type Channel = {
  id: string;
  name: string;
  type: ChannelType;
};

export type Message = {
  id: string;
  channel_id: string;
  author_id: string;
  author_username: string;
  content: string;
  created_at: string;
};

export type VoiceUser = { username: string };
