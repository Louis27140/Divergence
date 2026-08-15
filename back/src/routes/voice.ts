import { FastifyInstance } from "fastify";
import { z } from "zod";
import { AccessToken } from "livekit-server-sdk";
import { pool } from "../db";
import { auth } from "../auth";
import {
  getEffectivePermission,
  hasPermission,
  PERM_VOICE,
} from "../permissions";

export default async function voiceRoutes(app: FastifyInstance) {
  app.post("/voice/token", { preHandler: auth }, async (req: any, reply) => {
    const body = z.object({ channelId: z.string().uuid() }).parse(req.body);
    const userId = req.user.sub;
    const username = req.user.username;

    const effective = await getEffectivePermission(body.channelId, userId);
    if (effective === null) {
      return reply.code(404).send({ error: "channel_not_found" });
    }
    if (!hasPermission(effective, PERM_VOICE)) {
      return reply.code(403).send({ error: "requires_voice_permission" });
    }

    // 1) channel existe + type OK
    const chRes = await pool.query(
      `SELECT id, type FROM channels WHERE id=$1`,
      [body.channelId]
    );

    if (chRes.rowCount === 0) {
      return reply.code(404).send({ error: "channel_not_found" });
    }

    if (chRes.rows[0].type === "text") {
      return reply.code(403).send({ error: "channel_is_text_only" });
    }

    // room dérivée
    const roomName = `voice:${body.channelId}`;

    const at = new AccessToken("devkey", "devsecret", {
      identity: username,
    });

    at.addGrant({
      room: roomName,
      roomJoin: true,
      canSubscribe: true,
      canPublish: true,
    });

    const token = await at.toJwt();
    return reply.send({ token, room: roomName });
  });
}
