import Fastify from "fastify";
import cors from "@fastify/cors";
import { Server as IOServer } from "socket.io";

import authRoutes from "./routes/auth";
import channelRoutes from "./routes/channels";
import messageRoutes from "./routes/messages";
import voiceRoutes from "./routes/voice";

import "dotenv/config";

async function main() {
  const app = Fastify({ logger: true });

  const ORIGINS = process.env.ORIGINS?.split(",") || [];

  const voicePresence = new Map<
  string,
  Map<string, { username: string }>
>();

  // 1) CORS d'abord
  await app.register(cors, {
    origin: ORIGINS,
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  });

  // 2) Routes ensuite
  await app.register(authRoutes);
  await app.register(channelRoutes);
  await app.register(messageRoutes);
  await app.register(voiceRoutes);

  // 3) Socket.IO: même politique que REST (pas origin:true)
  const io = new IOServer(app.server, {
    cors: { origin: ORIGINS, credentials: true },
  });

  app.decorate("io", io);

  io.on("connection", (socket) => {
    socket.on("join", ({ channelId }) => socket.join(`channel:${channelId}`));
    socket.on("leave", ({ channelId }) => socket.leave(`channel:${channelId}`));
    
    socket.on("voice:join", ({ channelId, username }) => {
  let chan = voicePresence.get(channelId);
  if (!chan) {
    chan = new Map();
    voicePresence.set(channelId, chan);
  }

  chan.set(socket.id, { username });

  io.to(`channel:${channelId}`).emit("voice:state", {
    channelId,
    users: Array.from(chan.values()),
  });
});

socket.on("voice:leave", ({ channelId }) => {
  const chan = voicePresence.get(channelId);
  if (!chan) return;

  chan.delete(socket.id);

  io.to(`channel:${channelId}`).emit("voice:state", {
    channelId,
    users: Array.from(chan.values()),
  });
});

socket.on("disconnect", () => {
  for (const [channelId, chan] of voicePresence.entries()) {
    if (chan.delete(socket.id)) {
      io.to(`channel:${channelId}`).emit("voice:state", {
        channelId,
        users: Array.from(chan.values()),
      });
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
