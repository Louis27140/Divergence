import { FastifyInstance } from "fastify";
import { z } from "zod";
import { pool } from "../db";
import { auth } from "../auth";

export default async function messagesRoutes(app: FastifyInstance) {
  // Post message
  app.post("/channels/:id/messages", { preHandler: auth }, async (req: any, reply) => {
    const params = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z.object({ content: z.string().min(1).max(2000) }).parse(req.body);

    const authorId = req.user.sub;

    const res = await pool.query(
  `WITH ch AS (
     SELECT id, type FROM channels WHERE id = $1
   ),
   inserted AS (
     INSERT INTO messages (channel_id, author_id, content)
     SELECT ch.id, $2, $3
     FROM ch
     WHERE ch.type IN ('text','both')
     RETURNING id, channel_id, author_id, content, created_at
   )
   SELECT i.id, i.channel_id, i.author_id, u.username AS author_username, i.content, i.created_at
   FROM inserted i
   JOIN users u ON u.id = i.author_id`,
  [params.id, authorId, body.content]
);

if (res.rowCount === 0) {
  // soit channel inexistant, soit channel voice-only
  const exists = await pool.query(`SELECT 1 FROM channels WHERE id=$1`, [params.id]);
  return reply.code(exists.rowCount ? 403 : 404).send({
    error: exists.rowCount ? "channel_is_voice_only" : "channel_not_found",
  });
}

    const msg = res.rows[0];

    // broadcast à tous ceux dans la room du channel
    app.io.to(`channel:${params.id}`).emit("new_message", msg);

    return reply.send({ message: msg });
  });

  // Get messages
  app.get("/channels/:id/messages", { preHandler: auth }, async (req: any, reply) => {
    const params = z.object({ id: z.string().uuid() }).parse(req.params);

   const res = await pool.query(
  `SELECT m.id, m.channel_id, m.author_id, u.username AS author_username, m.content, m.created_at
   FROM messages m
   JOIN users u ON u.id = m.author_id
   WHERE m.channel_id = $1
   ORDER BY m.created_at DESC
   LIMIT 50`,
  [params.id]
);

    return reply.send({ messages: res.rows });
  });
}
