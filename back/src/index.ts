import cors from "@fastify/cors";
import Fastify from "fastify";
import { Server as IOServer } from "socket.io";

import authRoutes from "./routes/auth";
import channelRoutes from "./routes/channels";
import messageRoutes from "./routes/messages";
import voiceRoutes from "./routes/voice";

import "dotenv/config";

async function main() {
  const app = Fastify({ logger: true });

  const origins = process.env.ORIGINS?.split(",") || [];

  const voicePresence = new Map<string, Map<string, { username: string }>>();
  const typingPresence = new Map<string, Map<string, { username: string }>>();

  await app.register(cors, {
    origin: origins,
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  });

  await app.register(authRoutes);
  await app.register(channelRoutes);
  await app.register(messageRoutes);
  await app.register(voiceRoutes);

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

    socket.on("join", ({ channelId }) => {
      socket.join(`channel:${channelId}`);

      const channelPresence = voicePresence.get(channelId);
      socket.emit("voice:state", {
        channelId,
        users: channelPresence ? Array.from(channelPresence.values()) : [],
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
      let channelPresence = voicePresence.get(channelId);
      if (!channelPresence) {
        channelPresence = new Map();
        voicePresence.set(channelId, channelPresence);
      }

      channelPresence.set(socket.id, { username });

      io.to(`channel:${channelId}`).emit("voice:state", {
        channelId,
        users: Array.from(channelPresence.values()),
      });
    });

    socket.on("voice:leave", ({ channelId }) => {
      const channelPresence = voicePresence.get(channelId);
      if (!channelPresence) return;

      channelPresence.delete(socket.id);

      io.to(`channel:${channelId}`).emit("voice:state", {
        channelId,
        users: Array.from(channelPresence.values()),
      });

      if (channelPresence.size === 0) {
        voicePresence.delete(channelId);
      }
    });

    socket.on("disconnect", () => {
      for (const [channelId, channelPresence] of voicePresence.entries()) {
        if (!channelPresence.delete(socket.id)) {
          continue;
        }

        io.to(`channel:${channelId}`).emit("voice:state", {
          channelId,
          users: Array.from(channelPresence.values()),
        });

        if (channelPresence.size === 0) {
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
