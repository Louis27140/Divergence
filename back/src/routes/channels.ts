import { FastifyInstance } from "fastify";
import { z } from "zod";
import { auth } from "../auth";
import { pool } from "../db";

export default async function (app: FastifyInstance) {
 app.get("/channels", { preHandler: auth }, async () => {
    const res = await pool.query(`SELECT id, name, created_at FROM channels ORDER BY created_at ASC`);
    return { channels: res.rows };
  });

  app.post("/channels", { preHandler: auth }, async (req: any, reply) => {
    const body = z.object({ name: z.string().min(1).max(64) }).parse(req.body);
    const res = await pool.query(
      `INSERT INTO channels (name) VALUES ($1) RETURNING id, name, created_at`,
      [body.name]
    );
    return reply.send({ channel: res.rows[0] });
  });

  
}
