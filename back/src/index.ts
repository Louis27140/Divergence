import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import staticPlugin from "@fastify/static";
import Fastify from "fastify";
import { mkdir } from "fs/promises";
import { Server as IOServer } from "socket.io";
import { fileURLToPath } from "url";
import path from "path";

import authRoutes from "./routes/auth";
import channelRoutes from "./routes/channels";
import messageRoutes from "./routes/messages";
import voiceRoutes from "./routes/voice";
import adminRoutes from "./routes/admin";
import { pool } from "./db";

import "dotenv/config";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const uploadsDir = path.resolve(__dirname, "../uploads");

async function main() {
  const app = Fastify({ logger: true });

  const origins = process.env.ORIGINS?.split(",") || [];

  const voicePresence = new Map<string, Map<string, { username: string }>>();
  const textChannelPresence = new Map<string, Map<string, { username: string }>>();
  const typingPresence = new Map<string, Map<string, { username: string }>>();

  // Ensure uploads directory exists
  await mkdir(uploadsDir, { recursive: true });

  // Auto-migrate: add file attachment columns if they don't exist yet
  await pool.query(`
    ALTER TABLE messages ADD COLUMN IF NOT EXISTS file_url  TEXT;
    ALTER TABLE messages ADD COLUMN IF NOT EXISTS file_type TEXT;
    ALTER TABLE messages ADD COLUMN IF NOT EXISTS file_name TEXT;
    ALTER TABLE messages ADD COLUMN IF NOT EXISTS file_size INT;
  `);

  // Auto-migrate: global admin flag on users
  // First registered user is promoted automatically if no admin exists yet.
  await pool.query(`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS invite_token TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS invited_by UUID REFERENCES users(id) ON DELETE SET NULL;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS invited_at TIMESTAMPTZ;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS color_config JSONB DEFAULT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_invite_token_unique
      ON users(invite_token)
      WHERE invite_token IS NOT NULL;
    UPDATE users SET is_admin = TRUE
    WHERE id = (SELECT id FROM users ORDER BY created_at ASC LIMIT 1)
      AND NOT EXISTS (SELECT 1 FROM users WHERE is_admin = TRUE);
  `);

  // Auto-migrate: channel permissions and role model (bitmask)
  // Bits: READ=1, WRITE=2, VOICE=4, MANAGE=8  admin=-1
  await pool.query(`
    CREATE TABLE IF NOT EXISTS channel_permissions (
      channel_id   UUID REFERENCES channels(id) ON DELETE CASCADE,
      user_id      UUID REFERENCES users(id)    ON DELETE CASCADE,
      permissions  INT NOT NULL DEFAULT 7,
      PRIMARY KEY (channel_id, user_id)
    );
    ALTER TABLE channels            ADD COLUMN IF NOT EXISTS default_permissions INT NOT NULL DEFAULT 7;
    ALTER TABLE channel_permissions ADD COLUMN IF NOT EXISTS permissions         INT;
    UPDATE channel_permissions SET permissions = 7 WHERE permissions IS NULL;

    CREATE TABLE IF NOT EXISTS channel_roles (
      id          BIGSERIAL PRIMARY KEY,
      channel_id  UUID REFERENCES channels(id) ON DELETE CASCADE,
      name        TEXT NOT NULL,
      permissions INT NOT NULL DEFAULT 0,
      UNIQUE (channel_id, name)
    );

    CREATE TABLE IF NOT EXISTS channel_role_members (
      role_id BIGINT REFERENCES channel_roles(id) ON DELETE CASCADE,
      user_id UUID REFERENCES users(id)          ON DELETE CASCADE,
      PRIMARY KEY (role_id, user_id)
    );

    CREATE INDEX IF NOT EXISTS idx_channel_roles_channel_id
      ON channel_roles(channel_id);
    CREATE INDEX IF NOT EXISTS idx_channel_role_members_user_id
      ON channel_role_members(user_id);

    -- One-time migration of legacy per-user overrides into dedicated roles.
    INSERT INTO channel_roles (channel_id, name, permissions)
    SELECT cp.channel_id,
           CONCAT('legacy_', cp.user_id::text),
           cp.permissions
    FROM channel_permissions cp
    ON CONFLICT (channel_id, name) DO UPDATE
      SET permissions = EXCLUDED.permissions;

    INSERT INTO channel_role_members (role_id, user_id)
    SELECT cr.id, cp.user_id
    FROM channel_permissions cp
    JOIN channel_roles cr
      ON cr.channel_id = cp.channel_id
     AND cr.name = CONCAT('legacy_', cp.user_id::text)
    ON CONFLICT (role_id, user_id) DO NOTHING;

    -- Role model is now authoritative.
    DELETE FROM channel_permissions;
  `);

  // Auto-migrate: global server roles (replaces per-channel role system)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS roles (
      id          BIGSERIAL PRIMARY KEY,
      name        TEXT NOT NULL UNIQUE,
      color       TEXT NOT NULL DEFAULT '#7aa2ff',
      permissions INT  NOT NULL DEFAULT 7,
      is_default  BOOLEAN NOT NULL DEFAULT FALSE
    );

    CREATE TABLE IF NOT EXISTS role_members (
      role_id BIGINT REFERENCES roles(id) ON DELETE CASCADE,
      user_id UUID   REFERENCES users(id) ON DELETE CASCADE,
      PRIMARY KEY (role_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS channel_role_access (
      channel_id  UUID   REFERENCES channels(id) ON DELETE CASCADE,
      role_id     BIGINT REFERENCES roles(id)    ON DELETE CASCADE,
      permissions INT,
      PRIMARY KEY (channel_id, role_id)
    );

    CREATE INDEX IF NOT EXISTS idx_role_members_user  ON role_members(user_id);
    CREATE INDEX IF NOT EXISTS idx_cra_channel        ON channel_role_access(channel_id);

    -- One-time migration: promote named channel_roles to global roles (skip legacy_ ones)
    INSERT INTO roles (name, permissions, color)
      SELECT DISTINCT ON (name) name, permissions, '#7aa2ff'
      FROM channel_roles WHERE name NOT LIKE 'legacy_%'
    ON CONFLICT (name) DO NOTHING;

    INSERT INTO role_members (role_id, user_id)
      SELECT r.id, crm.user_id
      FROM channel_role_members crm
      JOIN channel_roles cr  ON cr.id  = crm.role_id
      JOIN roles r            ON r.name = cr.name
      WHERE cr.name NOT LIKE 'legacy_%'
    ON CONFLICT DO NOTHING;
  `);

  // Auto-migrate: add is_default column + create default "Membre" role
  await pool.query(`
    ALTER TABLE roles ADD COLUMN IF NOT EXISTS is_default BOOLEAN NOT NULL DEFAULT FALSE;
    INSERT INTO roles (name, color, permissions, is_default)
      VALUES ('Membre', '#7aa2ff', 7, TRUE)
    ON CONFLICT (name) DO NOTHING;
  `);

  await app.register(cors, {
    origin: origins,
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  });

  // Multipart plugin — must be registered before routes
  await app.register(multipart, {
    limits: {
      fileSize: 25 * 1024 * 1024, // 25 MB
      files: 1,
      fields: 5,
    },
  });

  // Serve uploaded files at /files/*
  await app.register(staticPlugin, {
    root: uploadsDir,
    prefix: "/files/",
  });

  await app.register(authRoutes);
  await app.register(channelRoutes);
  await app.register(messageRoutes);
  await app.register(voiceRoutes);
  await app.register(adminRoutes);

  const io = new IOServer(app.server, {
    cors: { origin: origins, credentials: true },
  });

  app.decorate("io", io);

  function emitTypingState(channelId: string) {
    const channelTyping = typingPresence.get(channelId);
    const users = channelTyping ? Array.from(new Set(Array.from(channelTyping.values()).map((u) => u.username))) : [];
    io.to(`channel:${channelId}`).emit("typing:state", {
      channelId,
      users,
    });
  }

  function emitChannelPresence(channelId: string) {
    const channelMembers = textChannelPresence.get(channelId);
    const users = channelMembers
      ? Array.from(new Set(Array.from(channelMembers.values()).map((u) => u.username)))
      : [];

    io.to(`channel:${channelId}`).emit("channel:presence", {
      channelId,
      users,
    });
  }

  io.on("connection", (socket) => {
    socket.on("voice:ping", (_payload, ack) => {
      if (typeof ack === "function") {
        ack({ ts: Date.now() });
      }
    });

    socket.on("wizz", ({ channelId, username }) => {
      if (!channelId || typeof channelId !== "string") return;
      if (!username || typeof username !== "string") return;
      if (!socket.rooms.has(`channel:${channelId}`)) return;

      io.to(`channel:${channelId}`).emit("wizz", {
        channelId,
        username: username.slice(0, 32),
      });
    });

    socket.on("join", ({ channelId, username }) => {
      socket.join(`channel:${channelId}`);

      if (typeof username === "string" && username.trim().length > 0) {
        let channelMembers = textChannelPresence.get(channelId);
        if (!channelMembers) {
          channelMembers = new Map();
          textChannelPresence.set(channelId, channelMembers);
        }
        channelMembers.set(socket.id, { username: username.trim().slice(0, 32) });
      }
      emitChannelPresence(channelId);

      const voiceChannelPresence = voicePresence.get(channelId);
      socket.emit("voice:state", {
        channelId,
        users: voiceChannelPresence ? Array.from(voiceChannelPresence.values()) : [],
      });

      const channelTyping = typingPresence.get(channelId);
      const users = channelTyping ? Array.from(new Set(Array.from(channelTyping.values()).map((u) => u.username))) : [];
      socket.emit("typing:state", {
        channelId,
        users,
      });
    });

    socket.on("leave", ({ channelId }) => {
      socket.leave(`channel:${channelId}`);

      const channelMembers = textChannelPresence.get(channelId);
      if (channelMembers?.delete(socket.id)) {
        emitChannelPresence(channelId);
        if (channelMembers.size === 0) {
          textChannelPresence.delete(channelId);
        }
      }

      const channelTyping = typingPresence.get(channelId);
      if (!channelTyping) return;

      if (!channelTyping.delete(socket.id)) return;
      emitTypingState(channelId);
      if (channelTyping.size === 0) {
        typingPresence.delete(channelId);
      }
    });

    socket.on("typing:start", ({ channelId, username }) => {
      let channelTyping = typingPresence.get(channelId);
      if (!channelTyping) {
        channelTyping = new Map();
        typingPresence.set(channelId, channelTyping);
      }

      channelTyping.set(socket.id, { username });
      emitTypingState(channelId);
    });

    socket.on("typing:stop", ({ channelId }) => {
      const channelTyping = typingPresence.get(channelId);
      if (!channelTyping) return;

      if (!channelTyping.delete(socket.id)) return;
      emitTypingState(channelId);
      if (channelTyping.size === 0) {
        typingPresence.delete(channelId);
      }
    });

    socket.on("voice:join", ({ channelId, username }) => {
      let voiceChannelPresence = voicePresence.get(channelId);
      if (!voiceChannelPresence) {
        voiceChannelPresence = new Map();
        voicePresence.set(channelId, voiceChannelPresence);
      }

      voiceChannelPresence.set(socket.id, { username });

      io.to(`channel:${channelId}`).emit("voice:state", {
        channelId,
        users: Array.from(voiceChannelPresence.values()),
      });
    });

    socket.on("voice:leave", ({ channelId }) => {
      const voiceChannelPresence = voicePresence.get(channelId);
      if (!voiceChannelPresence) return;

      voiceChannelPresence.delete(socket.id);

      io.to(`channel:${channelId}`).emit("voice:state", {
        channelId,
        users: Array.from(voiceChannelPresence.values()),
      });

      if (voiceChannelPresence.size === 0) {
        voicePresence.delete(channelId);
      }
    });

    socket.on("disconnect", () => {
      for (const [channelId, channelMembers] of textChannelPresence.entries()) {
        if (!channelMembers.delete(socket.id)) {
          continue;
        }

        emitChannelPresence(channelId);
        if (channelMembers.size === 0) {
          textChannelPresence.delete(channelId);
        }
      }

      for (const [channelId, voiceChannelPresence] of voicePresence.entries()) {
        if (!voiceChannelPresence.delete(socket.id)) {
          continue;
        }

        io.to(`channel:${channelId}`).emit("voice:state", {
          channelId,
          users: Array.from(voiceChannelPresence.values()),
        });

        if (voiceChannelPresence.size === 0) {
          voicePresence.delete(channelId);
        }
      }

      for (const [channelId, channelTyping] of typingPresence.entries()) {
        if (!channelTyping.delete(socket.id)) {
          continue;
        }

        emitTypingState(channelId);
        if (channelTyping.size === 0) {
          typingPresence.delete(channelId);
        }
      }
    });
  });

  await app.listen({ host: "0.0.0.0", port: 3000 });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
