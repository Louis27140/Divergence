import Fastify from "fastify";
import { Server as IOServer } from "socket.io";

import authRoutes from "./routes/auth";
import channelRoutes from "./routes/channels";
import messageRoutes from "./routes/messages";

import cors from "@fastify/cors";
async function main() {
  const app = Fastify({ logger: true });

  app.register(authRoutes);
  app.register(channelRoutes);
  app.register(messageRoutes);
  app.register(cors, {
  origin: "http://localhost:5173",
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"]
});

app.ready().then(() => app.log.info(app.printRoutes()));


  // Socket.IO accroché au serveur Fastify
  const io = new IOServer(app.server, {
    cors: { origin: true, credentials: true }
  });

  io.on("connection", (socket) => {
    socket.on("join", ({ channelId }) => socket.join(`channel:${channelId}`));
    socket.on("leave", ({ channelId }) => socket.leave(`channel:${channelId}`));
  });

  app.decorate("io", io);

  await app.listen({ host: "0.0.0.0", port: 3000 });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

declare module "fastify" {
  interface FastifyInstance {
    io: IOServer;
  }
}
