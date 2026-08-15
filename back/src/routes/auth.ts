import { FastifyInstance } from "fastify";
import bcrypt from "bcrypt";
import { z } from "zod";
import { createWriteStream } from "fs";
import { stat, unlink } from "fs/promises";
import { pipeline } from "stream/promises";
import { randomBytes, randomUUID } from "crypto";
import path from "path";
import { fileURLToPath } from "url";
import { pool } from "../db";
import { auth, signToken } from "../auth";

const MAX_AVATAR_SIZE = 5 * 1024 * 1024; // 5 MB
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uploadsDir = path.resolve(__dirname, "../../uploads");

function extensionFromMime(mimetype: string): string {
  if (mimetype === "image/png") return ".png";
  if (mimetype === "image/jpeg") return ".jpg";
  if (mimetype === "image/webp") return ".webp";
  if (mimetype === "image/gif") return ".gif";
  if (mimetype === "image/avif") return ".avif";
  return ".png";
}

function resolveInviteBaseUrl(req: any): string | null {
  const configured = process.env.INVITE_BASE_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");

  const originHeader = typeof req?.headers?.origin === "string" ? req.headers.origin.trim() : "";
  if (originHeader) return originHeader.replace(/\/+$/, "");

  const firstAllowedOrigin = process.env.ORIGINS?.split(",").map((v) => v.trim()).find(Boolean);
  return firstAllowedOrigin ? firstAllowedOrigin.replace(/\/+$/, "") : null;
}

async function requesterIsAdmin(userId: string): Promise<boolean> {
  const adminCheck = await pool.query(
    `SELECT is_admin FROM users WHERE id = $1`,
    [userId],
  );
  return Boolean(adminCheck.rows[0]?.is_admin);
}

export default async function (app: FastifyInstance) {
  app.post("/auth/register", async (req, reply) => {
    const body = z.object({
      username: z.string().min(3).max(32),
      password: z.string().min(8),
    }).parse(req.body);
    const username = body.username.trim();
    if (username.length < 3) {
      return reply.code(400).send({ error: "invalid_username" });
    }

    const usersCountRes = await pool.query(`SELECT COUNT(*)::INT AS count FROM users`);
    const usersCount = Number(usersCountRes.rows[0]?.count ?? 0);
    if (usersCount > 0) {
      return reply.code(403).send({ error: "registration_disabled" });
    }

    const password_hash = await bcrypt.hash(body.password, 10);

    const res = await pool.query(
      `INSERT INTO users (username, password_hash, is_admin, must_change_password)
       VALUES ($1, $2, TRUE, FALSE)
       RETURNING id, username, is_admin, avatar_url, must_change_password`,
      [username, password_hash],
    );

    const user = res.rows[0];
    const token = signToken(user.id, user.username);
    return reply.send({
      token,
      user: {
        id: user.id,
        username: user.username,
        is_admin: user.is_admin,
        avatar_url: user.avatar_url,
        must_change_password: user.must_change_password,
      },
    });
  });

  app.post("/auth/login", async (req, reply) => {
    const body = z.object({
      username: z.string(),
      password: z.string(),
    }).parse(req.body);
    const username = body.username.trim();

    const res = await pool.query(
      `SELECT id, username, password_hash, is_admin, avatar_url, must_change_password, color_config
       FROM users
       WHERE username = $1`,
      [username],
    );
    const user = res.rows[0];
    if (!user || !(await bcrypt.compare(body.password, user.password_hash))) {
      return reply.code(401).send({ error: "Bad credentials" });
    }

    if (user.must_change_password) {
      return reply.send({
        requires_password_change: true,
        user: {
          id: user.id,
          username: user.username,
          is_admin: user.is_admin,
          avatar_url: user.avatar_url,
          must_change_password: true,
          color_config: user.color_config ?? null,
        },
      });
    }

    const token = signToken(user.id, user.username);
    return reply.send({
      token,
      user: {
        id: user.id,
        username: user.username,
        is_admin: user.is_admin,
        avatar_url: user.avatar_url,
        must_change_password: false,
        color_config: user.color_config ?? null,
      },
    });
  });

  app.post("/auth/change-initial-password", async (req, reply) => {
    const body = z.object({
      username: z.string().min(3).max(32),
      current_password: z.string().min(1),
      new_password: z.string().min(8).max(128),
    }).parse(req.body);
    const username = body.username.trim();

    const res = await pool.query(
      `SELECT id, username, password_hash, is_admin, avatar_url, must_change_password
       FROM users
       WHERE username = $1`,
      [username],
    );
    const user = res.rows[0];

    if (!user || !(await bcrypt.compare(body.current_password, user.password_hash))) {
      return reply.code(401).send({ error: "Bad credentials" });
    }

    if (!user.must_change_password) {
      return reply.code(400).send({ error: "initial_password_change_not_required" });
    }

    if (body.current_password === body.new_password) {
      return reply.code(400).send({ error: "new_password_must_differ" });
    }

    const nextHash = await bcrypt.hash(body.new_password, 10);
    await pool.query(
      `UPDATE users
       SET password_hash = $1,
           must_change_password = FALSE,
           invite_token = NULL
       WHERE id = $2`,
      [nextHash, user.id],
    );

    const token = signToken(user.id, user.username);
    return reply.send({
      token,
      user: {
        id: user.id,
        username: user.username,
        is_admin: user.is_admin,
        avatar_url: user.avatar_url,
        must_change_password: false,
      },
    });
  });

  app.get("/auth/invite/:token", async (req, reply) => {
    const { token } = z.object({
      token: z.string().min(12).max(256),
    }).parse(req.params);

    const res = await pool.query(
      `SELECT username
       FROM users
       WHERE invite_token = $1
         AND must_change_password = TRUE
       LIMIT 1`,
      [token],
    );

    if (res.rowCount === 0) {
      return reply.code(404).send({ error: "invite_not_found" });
    }

    return reply.send({
      username: res.rows[0].username,
    });
  });

  app.post("/admin/users", { preHandler: auth }, async (req: any, reply) => {
    if (!(await requesterIsAdmin(req.user.sub))) {
      return reply.code(403).send({ error: "requires_global_admin" });
    }

    const body = z.object({
      username: z.string().min(3).max(32),
    }).parse(req.body);

    const username = body.username.trim();
    if (username.length < 3) {
      return reply.code(400).send({ error: "invalid_username" });
    }

    const exists = await pool.query(
      `SELECT 1 FROM users WHERE username = $1 LIMIT 1`,
      [username],
    );

    if (exists.rowCount > 0) {
      return reply.code(409).send({ error: "username_already_exists" });
    }

    // Store a random placeholder hash — the account has no usable password
    // until the user activates via their invite link.
    const placeholderHash = await bcrypt.hash(randomUUID(), 10);
    const inviteToken = randomBytes(24).toString("hex");

    const created = await pool.query(
      `INSERT INTO users (
        username,
        password_hash,
        is_admin,
        must_change_password,
        invite_token,
        invited_by,
        invited_at
      )
      VALUES ($1, $2, FALSE, TRUE, $3, $4, NOW())
      RETURNING id, username, is_admin, avatar_url, must_change_password`,
      [username, placeholderHash, inviteToken, req.user.sub],
    );

    const user = created.rows[0];

    // Auto-assign all default roles to the new user
    const defaultRoles = await pool.query(`SELECT id FROM roles WHERE is_default = TRUE`);
    for (const role of defaultRoles.rows) {
      await pool.query(
        `INSERT INTO role_members (role_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [role.id, user.id],
      );
    }

    const inviteBaseUrl = resolveInviteBaseUrl(req);
    const inviteUrl = inviteBaseUrl
      ? `${inviteBaseUrl}/?invite=${encodeURIComponent(inviteToken)}`
      : null;

    return reply.send({
      user: {
        id: user.id,
        username: user.username,
        is_admin: user.is_admin,
        avatar_url: user.avatar_url,
        must_change_password: user.must_change_password,
      },
      invite_token: inviteToken,
      invite_url: inviteUrl,
    });
  });

  // Activate an invite: set password using the invite token (no temp password needed)
  app.post("/auth/invite/:token/activate", async (req: any, reply) => {
    const { token } = z.object({
      token: z.string().min(12).max(256),
    }).parse(req.params);

    const body = z.object({
      new_password: z.string().min(8).max(128),
    }).parse(req.body);

    const res = await pool.query(
      `SELECT id, username, is_admin, avatar_url
       FROM users
       WHERE invite_token = $1
         AND must_change_password = TRUE
       LIMIT 1`,
      [token],
    );

    if (res.rowCount === 0) {
      return reply.code(404).send({ error: "invite_not_found" });
    }

    const user = res.rows[0];
    const nextHash = await bcrypt.hash(body.new_password, 10);

    await pool.query(
      `UPDATE users
       SET password_hash = $1,
           must_change_password = FALSE,
           invite_token = NULL
       WHERE id = $2`,
      [nextHash, user.id],
    );

    const jwtToken = signToken(user.id, user.username);
    return reply.send({
      token: jwtToken,
      user: {
        id: user.id,
        username: user.username,
        is_admin: user.is_admin,
        avatar_url: user.avatar_url,
        must_change_password: false,
      },
    });
  });

  app.put("/users/me/color", { preHandler: auth }, async (req: any, reply: any) => {
    const body = z.object({
      color_config: z.any().nullable(),
    }).parse(req.body);

    const res = await pool.query(
      `UPDATE users SET color_config = $1 WHERE id = $2 RETURNING id`,
      [body.color_config ?? null, req.user.sub],
    );

    if (res.rowCount === 0) {
      return reply.code(404).send({ error: "user_not_found" });
    }

    app.io.emit("user:color:updated", { userId: req.user.sub, color_config: body.color_config ?? null });
    return reply.send({ ok: true });
  });

  app.put("/users/me/avatar", { preHandler: auth }, async (req: any, reply: any) => {
    const filePart = await req.file();
    if (!filePart) {
      return reply.code(400).send({ error: "avatar_required" });
    }

    if (!filePart.mimetype?.startsWith("image/")) {
      for await (const _ of filePart.file) { /* drain */ }
      return reply.code(400).send({ error: "avatar_type_not_allowed" });
    }

    const rawExt = path.extname(filePart.filename || "").toLowerCase();
    const safeExt = rawExt.replace(/[^.a-z0-9]/g, "");
    const ext = safeExt || extensionFromMime(filePart.mimetype);
    const savedName = `avatar_${req.user.sub}_${randomUUID()}${ext}`;
    const savedPath = path.join(uploadsDir, savedName);
    const avatarUrl = `/files/${savedName}`;

    try {
      await pipeline(filePart.file, createWriteStream(savedPath));
    } catch {
      await unlink(savedPath).catch(() => {});
      return reply.code(413).send({ error: "avatar_too_large" });
    }

    if ((filePart.file as any).truncated) {
      await unlink(savedPath).catch(() => {});
      return reply.code(413).send({ error: "avatar_too_large" });
    }

    const fileStats = await stat(savedPath);
    if (fileStats.size > MAX_AVATAR_SIZE) {
      await unlink(savedPath).catch(() => {});
      return reply.code(413).send({ error: "avatar_too_large" });
    }

    const existing = await pool.query(
      `SELECT avatar_url FROM users WHERE id = $1`,
      [req.user.sub],
    );

    if (existing.rowCount === 0) {
      await unlink(savedPath).catch(() => {});
      return reply.code(404).send({ error: "user_not_found" });
    }

    const previousAvatarUrl = existing.rows[0].avatar_url as string | null;

    try {
      const updated = await pool.query(
        `UPDATE users
         SET avatar_url = $1
         WHERE id = $2
         RETURNING id, username, is_admin, avatar_url`,
        [avatarUrl, req.user.sub],
      );

      if (previousAvatarUrl && previousAvatarUrl.startsWith("/files/") && previousAvatarUrl !== avatarUrl) {
        const oldFilePath = path.join(uploadsDir, path.basename(previousAvatarUrl));
        await unlink(oldFilePath).catch(() => {});
      }

      app.io.emit("user:updated", {
        userId: req.user.sub,
        avatar_url: updated.rows[0].avatar_url,
      });
      return reply.send({ user: updated.rows[0] });
    } catch (error) {
      await unlink(savedPath).catch(() => {});
      throw error;
    }
  });
}
