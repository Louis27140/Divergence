import { FastifyInstance } from "fastify";
import { z } from "zod";
import { auth } from "../auth";
import { pool } from "../db";

async function requireAdmin(req: any, reply: any) {
  const res = await pool.query(`SELECT is_admin FROM users WHERE id = $1`, [req.user.sub]);
  if (!res.rows[0]?.is_admin) {
    return reply.code(403).send({ error: "requires_global_admin" });
  }
}

export default async function adminRoutes(app: FastifyInstance) {
  // ─── Roles ────────────────────────────────────────────────────────────────

  // GET /admin/roles — list all global roles with member count
  app.get("/admin/roles", { preHandler: auth }, async (_req: any) => {
    const res = await pool.query(
      `SELECT r.id::int, r.name, r.color, r.permissions, r.is_default,
              COUNT(rm.user_id)::int AS member_count
       FROM roles r
       LEFT JOIN role_members rm ON rm.role_id = r.id
       GROUP BY r.id
       ORDER BY r.is_default DESC, LOWER(r.name) ASC`,
    );
    return { roles: res.rows };
  });

  // POST /admin/roles — create a global role
  app.post("/admin/roles", { preHandler: [auth, requireAdmin] }, async (req: any, reply: any) => {
    const body = z.object({
      name: z.string().min(1).max(64),
      color: z.string().optional(),
      permissions: z.number().int().min(-1).max(15).optional(),
    }).parse(req.body);

    const res = await pool.query(
      `INSERT INTO roles (name, color, permissions, is_default)
       VALUES ($1, $2, $3, $4)
       RETURNING id::int, name, color, permissions, is_default`,
      [body.name.trim(), body.color ?? "#7aa2ff", body.permissions ?? 7, false],
    );
    const role = { ...res.rows[0], member_count: 0 };
    app.io.emit("role:created", { role });
    return reply.code(201).send({ role });
  });

  // PATCH /admin/roles/:id — update a global role
  app.patch("/admin/roles/:id", { preHandler: [auth, requireAdmin] }, async (req: any, reply: any) => {
    const { id } = z.object({ id: z.coerce.number().int().positive() }).parse(req.params);
    const body = z.object({
      name: z.string().min(1).max(64).optional(),
      color: z.string().optional(),
      permissions: z.number().int().min(-1).max(15).optional(),
      is_default: z.boolean().optional(),
    }).parse(req.body);

    const sets: string[] = [];
    const values: any[] = [];
    let paramIdx = 2;

    if (body.name !== undefined) { sets.push(`name = $${paramIdx++}`); values.push(body.name.trim()); }
    if (body.color !== undefined) { sets.push(`color = $${paramIdx++}`); values.push(body.color); }
    if (body.permissions !== undefined) { sets.push(`permissions = $${paramIdx++}`); values.push(body.permissions); }
    if (body.is_default !== undefined) { sets.push(`is_default = $${paramIdx++}`); values.push(body.is_default); }

    if (sets.length === 0) {
      return reply.code(400).send({ error: "nothing_to_update" });
    }

    const res = await pool.query(
      `UPDATE roles SET ${sets.join(", ")} WHERE id = $1 RETURNING id::int, name, color, permissions, is_default`,
      [id, ...values],
    );
    if (res.rowCount === 0) return reply.code(404).send({ error: "role_not_found" });
    app.io.emit("role:updated", { role: res.rows[0] });
    return { role: res.rows[0] };
  });

  // DELETE /admin/roles/:id — delete a global role (cascades to role_members + channel_role_access)
  app.delete("/admin/roles/:id", { preHandler: [auth, requireAdmin] }, async (req: any, reply: any) => {
    const { id } = z.object({ id: z.coerce.number().int().positive() }).parse(req.params);
    const res = await pool.query(`DELETE FROM roles WHERE id = $1`, [id]);
    if (res.rowCount === 0) return reply.code(404).send({ error: "role_not_found" });
    app.io.emit("role:deleted", { roleId: id });
    return { ok: true };
  });

  // GET /admin/roles/:id/members — list members of a role
  app.get("/admin/roles/:id/members", { preHandler: [auth, requireAdmin] }, async (req: any, reply: any) => {
    const { id } = z.object({ id: z.coerce.number().int().positive() }).parse(req.params);
    const res = await pool.query(
      `SELECT u.id, u.username, u.avatar_url, u.is_admin
       FROM role_members rm
       JOIN users u ON u.id = rm.user_id
       WHERE rm.role_id = $1
       ORDER BY u.username ASC`,
      [id],
    );
    return { members: res.rows };
  });

  // PUT /admin/roles/:id/members — full replace of role members
  app.put("/admin/roles/:id/members", { preHandler: [auth, requireAdmin] }, async (req: any, reply: any) => {
    const { id } = z.object({ id: z.coerce.number().int().positive() }).parse(req.params);
    const body = z.object({
      user_ids: z.array(z.string().uuid()),
    }).parse(req.body);

    const unique = Array.from(new Set(body.user_ids));
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`DELETE FROM role_members WHERE role_id = $1`, [id]);
      for (const userId of unique) {
        await client.query(
          `INSERT INTO role_members (role_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
          [id, userId],
        );
      }
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
    // Notify all clients: permissions may have changed for affected users
    app.io.emit("role:members:updated", { roleId: id, memberCount: unique.length });
    return { ok: true };
  });

  // ─── User → Role assignment ────────────────────────────────────────────────

  // GET /admin/users/:userId/roles — get roles for a user
  app.get("/admin/users/:userId/roles", { preHandler: [auth, requireAdmin] }, async (req: any, reply: any) => {
    const { userId } = z.object({ userId: z.string().uuid() }).parse(req.params);
    const res = await pool.query(
      `SELECT r.id::int, r.name, r.color, r.permissions
       FROM role_members rm
       JOIN roles r ON r.id = rm.role_id
       WHERE rm.user_id = $1
       ORDER BY LOWER(r.name) ASC`,
      [userId],
    );
    return { roles: res.rows };
  });

  // POST /admin/users/:userId/roles — full replace of roles for a user
  app.post("/admin/users/:userId/roles", { preHandler: [auth, requireAdmin] }, async (req: any, reply: any) => {
    const { userId } = z.object({ userId: z.string().uuid() }).parse(req.params);
    const body = z.object({
      role_ids: z.array(z.coerce.number().int().positive()),
    }).parse(req.body);

    const unique = Array.from(new Set(body.role_ids));
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`DELETE FROM role_members WHERE user_id = $1`, [userId]);
      for (const roleId of unique) {
        await client.query(
          `INSERT INTO role_members (role_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
          [roleId, userId],
        );
      }
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
    // Notify all clients: permissions may have changed for this user
    app.io.emit("user:roles:updated", { userId });
    return { ok: true };
  });

  // ─── User management ──────────────────────────────────────────────────────

  // PATCH /admin/users/:id — toggle is_admin
  app.patch("/admin/users/:id", { preHandler: [auth, requireAdmin] }, async (req: any, reply: any) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z.object({
      is_admin: z.boolean(),
    }).parse(req.body);

    if (id === req.user.sub && !body.is_admin) {
      return reply.code(400).send({ error: "cannot_demote_self" });
    }

    const res = await pool.query(
      `UPDATE users SET is_admin = $1 WHERE id = $2
       RETURNING id, username, avatar_url, is_admin, must_change_password`,
      [body.is_admin, id],
    );
    if (res.rowCount === 0) return reply.code(404).send({ error: "user_not_found" });
    app.io.emit("user:updated", { userId: id, is_admin: body.is_admin });
    return { user: res.rows[0] };
  });

  // DELETE /admin/users/:id — delete a user
  app.delete("/admin/users/:id", { preHandler: [auth, requireAdmin] }, async (req: any, reply: any) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);

    if (id === req.user.sub) {
      return reply.code(400).send({ error: "cannot_delete_self" });
    }

    const res = await pool.query(`DELETE FROM users WHERE id = $1`, [id]);
    if (res.rowCount === 0) return reply.code(404).send({ error: "user_not_found" });
    app.io.emit("user:deleted", { userId: id });
    return { ok: true };
  });
}
