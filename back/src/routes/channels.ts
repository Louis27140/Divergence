import { FastifyInstance } from "fastify";
import { z } from "zod";
import { auth } from "../auth";
import { pool } from "../db";

export default async function (app: FastifyInstance) {
 app.get("/channels", { preHandler: auth }, async () => {
    const res = await pool.query(`SELECT id, name, type, created_at FROM channels ORDER BY created_at ASC`);
    return { channels: res.rows };
  });

  app.post("/channels", { preHandler: auth }, async (req: any, reply) => {
  const body = z.object({
    name: z.string().min(1).max(64),
    type: z.enum(["text", "voice", "both"]).optional(),
  }).parse(req.body);

  const channelType = body.type ?? "both";

  const res = await pool.query(
    `INSERT INTO channels (name, type)
     VALUES ($1, $2)
     RETURNING id, name, type, created_at`,
    [body.name, channelType]
  );

  return reply.send({ channel: res.rows[0] });
});


  
}
