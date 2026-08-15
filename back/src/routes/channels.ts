import { FastifyInstance } from "fastify";
import { z } from "zod";
import { auth } from "../auth";
import { pool } from "../db";
import {
  getEffectivePermission,
  globalRolePermissionsSql,
  hasPermission,
  PERM_ADMIN,
  PERM_MANAGE,
  PERM_READ,
} from "../permissions";

export default async function (app: FastifyInstance) {
  // GET /channels - list channels where current user has READ.
  app.get("/channels", { preHandler: auth }, async (req: any) => {
    const userId = req.user.sub;

    const res = await pool.query(
      `SELECT id, name, type, created_at, my_permissions
       FROM (
         SELECT c.id, c.name, c.type, c.created_at,
           CASE
             WHEN u.is_admin THEN $2
             ELSE COALESCE(role_perm.role_permissions, c.default_permissions)
           END AS my_permissions
         FROM channels c
         JOIN users u ON u.id = $1
         LEFT JOIN LATERAL (
           ${globalRolePermissionsSql("$1", "c.id")}
         ) role_perm ON TRUE
       ) t
       WHERE my_permissions = $2
          OR (my_permissions & $3) != 0
       ORDER BY created_at ASC`,
      [userId, PERM_ADMIN, PERM_READ],
    );

    return { channels: res.rows };
  });

  // POST /channels - create a new channel (global admin only)
  app.post("/channels", { preHandler: auth }, async (req: any, reply: any) => {
    const adminCheck = await pool.query(
      `SELECT is_admin FROM users WHERE id = $1`,
      [req.user.sub],
    );
    if (!adminCheck.rows[0]?.is_admin) {
      return reply.code(403).send({ error: "requires_global_admin" });
    }

    const body = z.object({
      name: z.string().min(1).max(64),
      type: z.enum(["text", "voice", "both"]).optional(),
    }).parse(req.body);

    const channelType = body.type ?? "both";

    const res = await pool.query(
      `INSERT INTO channels (name, type)
       VALUES ($1, $2)
       RETURNING id, name, type, created_at, default_permissions`,
      [body.name, channelType],
    );

    const channel = res.rows[0];
    // Broadcast to all connected clients — they will re-fetch /channels to get their permissions
    app.io.emit("channel:created", { channel });
    return reply.send({ channel: { ...channel, my_permissions: PERM_ADMIN } });
  });

  // GET /users - list all registered users
  app.get("/users", { preHandler: auth }, async (req: any) => {
    const requester = await pool.query(
      `SELECT is_admin FROM users WHERE id = $1`,
      [req.user.sub],
    );
    const requesterIsAdmin = Boolean(requester.rows[0]?.is_admin);

    const res = await pool.query(
      requesterIsAdmin
        ? `SELECT id, username, avatar_url, is_admin, must_change_password
           FROM users
           ORDER BY username ASC`
        : `SELECT id, username, avatar_url
           FROM users
           ORDER BY username ASC`,
    );
    return { users: res.rows };
  });

  // GET /channels/:id/members - roles and members for a channel (used by MessageFeed for role colors)
  // Returns: { default_permissions, roles: [{ id, name, color, permissions, members: [...] }], users: [...] }
  app.get("/channels/:id/members", { preHandler: auth }, async (req: any, reply: any) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);

    const channelCheck = await pool.query(
      `SELECT default_permissions FROM channels WHERE id = $1`,
      [id],
    );
    if (channelCheck.rowCount === 0) {
      return reply.code(404).send({ error: "channel_not_found" });
    }

    const defaultPerm = channelCheck.rows[0].default_permissions as number;
    const effective = await getEffectivePermission(id, req.user.sub);
    if (!hasPermission(effective, PERM_READ)) {
      return reply.code(403).send({ error: "requires_read_permission" });
    }

    // Roles: global roles relevant to this channel
    // If channel is restricted, return only roles in channel_role_access.
    // If open, return all global roles.
    const rolesRes = await pool.query(
      `SELECT r.id::int, r.name, r.color, r.permissions,
              COALESCE(
                JSON_AGG(
                  JSON_BUILD_OBJECT('id', u.id, 'username', u.username, 'avatar_url', u.avatar_url)
                  ORDER BY u.username
                ) FILTER (WHERE u.id IS NOT NULL),
                '[]'::json
              ) AS members
       FROM roles r
       LEFT JOIN role_members rm ON rm.role_id = r.id
       LEFT JOIN users u ON u.id = rm.user_id
       GROUP BY r.id, r.name, r.color, r.permissions
       ORDER BY LOWER(r.name) ASC`,
    );

    // Effective permissions per user (for role-color display in MessageFeed)
    const usersRes = await pool.query(
      `SELECT u.id, u.username, u.avatar_url,
              CASE
                WHEN u.is_admin THEN $2
                ELSE COALESCE(role_perm.role_permissions, $3)
              END AS permissions
       FROM users u
       LEFT JOIN LATERAL (
         ${globalRolePermissionsSql("u.id", "$1")}
       ) role_perm ON TRUE
       ORDER BY u.username ASC`,
      [id, PERM_ADMIN, defaultPerm],
    );

    return reply.send({
      default_permissions: defaultPerm,
      roles: rolesRes.rows,
      users: usersRes.rows,
    });
  });

  // GET /channels/:id/access — role access config for a channel
  app.get("/channels/:id/access", { preHandler: auth }, async (req: any, reply: any) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);

    const channelCheck = await pool.query(`SELECT id FROM channels WHERE id = $1`, [id]);
    if (channelCheck.rowCount === 0) return reply.code(404).send({ error: "channel_not_found" });

    const effective = await getEffectivePermission(id, req.user.sub);
    if (!hasPermission(effective, PERM_READ)) {
      return reply.code(403).send({ error: "requires_read_permission" });
    }

    const res = await pool.query(
      `SELECT cra.role_id::int, r.name AS role_name, r.color AS role_color, cra.permissions
       FROM channel_role_access cra
       JOIN roles r ON r.id = cra.role_id
       WHERE cra.channel_id = $1
       ORDER BY LOWER(r.name) ASC`,
      [id],
    );

    return {
      restricted: res.rows.length > 0,
      entries: res.rows,
    };
  });

  // PUT /channels/:id/access — replace role access config (admin only)
  app.put("/channels/:id/access", { preHandler: auth }, async (req: any, reply: any) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z.object({
      restricted: z.boolean(),
      entries: z.array(z.object({
        role_id: z.coerce.number().int().positive(),
        permissions: z.coerce.number().int().min(-1).max(15).nullable().optional(),
      })),
    }).parse(req.body);

    const effective = await getEffectivePermission(id, req.user.sub);
    if (effective === null) return reply.code(404).send({ error: "channel_not_found" });
    if (!hasPermission(effective, PERM_MANAGE)) {
      return reply.code(403).send({ error: "requires_manage_permission" });
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`DELETE FROM channel_role_access WHERE channel_id = $1`, [id]);

      if (body.restricted) {
        for (const entry of body.entries) {
          await client.query(
            `INSERT INTO channel_role_access (channel_id, role_id, permissions)
             VALUES ($1, $2, $3)
             ON CONFLICT (channel_id, role_id) DO UPDATE SET permissions = EXCLUDED.permissions`,
            [id, entry.role_id, entry.permissions ?? null],
          );
        }
      }

      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }

    // Notify all clients — they must re-fetch /channels to get updated permissions
    app.io.emit("channel:access:updated", { channelId: id });
    return { ok: true };
  });

  // PUT /channels/:id/members — kept for backward compatibility (no-op redirect)
  app.put("/channels/:id/members", { preHandler: auth }, async (_req: any, reply: any) => {
    return reply.code(410).send({ error: "deprecated_use_access_endpoint" });
  });
}
