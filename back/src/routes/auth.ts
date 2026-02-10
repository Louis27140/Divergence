import { FastifyInstance } from "fastify";
import bcrypt from "bcrypt";
import { z } from "zod";
import { pool } from "../db";
import { signToken } from "../auth";

export default async function (app: FastifyInstance) {
  app.post("/auth/register", async (req, reply) => {
    const body = z.object({
      username: z.string().min(3).max(32),
      password: z.string().min(6)
    }).parse(req.body);

    const password_hash = await bcrypt.hash(body.password, 10);
    const res = await pool.query(
      `INSERT INTO users (username, password_hash)
       VALUES ($1, $2)
       RETURNING id, username`,
      [body.username, password_hash]
    );

    const user = res.rows[0];
    const token = signToken(user.id, user.username);
    return reply.send({ token, user });
  });

  app.post("/auth/login", async (req, reply) => {
    const body = z.object({
      username: z.string(),
      password: z.string()
    }).parse(req.body);

    const res = await pool.query(
      `SELECT id, username, password_hash FROM users WHERE username = $1`,
      [body.username]
    );
    const user = res.rows[0];
    if (!user || !(await bcrypt.compare(body.password, user.password_hash))) {
      return reply.code(401).send({ error: "Bad credentials" });
    }

    const token = signToken(user.id, user.username);
    return reply.send({ token, user: { id: user.id, username: user.username } });
  });
}
