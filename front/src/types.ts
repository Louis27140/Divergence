export type ChannelType = "text" | "voice" | "both";

export type Channel = {
  id: string;
  name: string;
  type: ChannelType;
  /** Effective permission bitmask for the current user (READ=1 WRITE=2 VOICE=4 MANAGE=8 ADMIN=-1) */
  my_permissions?: number;
};

export type Message = {
  id: string;
  channel_id: string;
  author_id: string;
  author_username: string;
  author_avatar_url?: string | null;
  author_color_config?: UserColorConfig | null;
  content: string;
  created_at: string;
  // Optional file attachment
  file_url?: string | null;
  file_type?: string | null;
  file_name?: string | null;
  file_size?: number | null;
};

export type VoiceUser = {
  username: string;
  avatar_url?: string | null;
};

export type User = {
  id: string;
  username: string;
  avatar_url?: string | null;
  is_admin?: boolean;
  must_change_password?: boolean;
};

export type AuthUser = {
  id: string;
  username: string;
  is_admin: boolean;
  avatar_url?: string | null;
  must_change_password?: boolean;
  color_config?: UserColorConfig | null;
};

export type Role = {
  id: number;
  name: string;
  color: string;
  permissions: number;
  member_count?: number;
  is_default?: boolean;
};

export type ChannelAccess = {
  restricted: boolean;
  entries: {
    role_id: number;
    role_name: string;
    role_color: string;
    permissions: number | null;
  }[];
};

export type UserColorConfig =
  | { mode: "hash" }
  | { mode: "static"; color: string }
  | { mode: "gradient"; stops: string[]; angle: number; animated: boolean };

export type AudioDeviceConfig = {
  inputDeviceId?: string;
  outputDeviceId?: string;
};
