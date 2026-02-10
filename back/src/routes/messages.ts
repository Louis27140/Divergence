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
      `INSERT INTO messages (channel_id, author_id, content)
       VALUES ($1, $2, $3)
       RETURNING id, channel_id, author_id, content, created_at`,
      [params.id, authorId, body.content]
    );
    const msg = res.rows[0];

    // broadcast à tous ceux dans la room du channel
    app.io.to(`channel:${params.id}`).emit("new_message", msg);

    return reply.send({ message: msg });
  });

  // Get messages
  app.get("/channels/:id/messages", { preHandler: auth }, async (req: any, reply) => {
    const params = z.object({ id: z.string().uuid() }).parse(req.params);

    const res = await pool.query(
      `SELECT id, channel_id, author_id, content, created_at
       FROM messages
       WHERE channel_id = $1
       ORDER BY created_at DESC
       LIMIT 50`,
      [params.id]
    );

    return reply.send({ messages: res.rows });
  });
}
