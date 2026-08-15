import { FastifyInstance } from "fastify";
import { createWriteStream } from "fs";
import { mkdir, stat, unlink } from "fs/promises";
import { pipeline } from "stream/promises";
import { randomUUID } from "crypto";
import path from "path";
import { fileURLToPath } from "url";
import { z } from "zod";
import { pool } from "../db";
import { auth } from "../auth";
import {
  getEffectivePermission,
  hasPermission,
  PERM_READ,
  PERM_WRITE,
} from "../permissions";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uploadsDir = path.resolve(__dirname, "../../uploads");

const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25 MB
const ALLOWED_MIME_PREFIXES = ["image/", "audio/", "video/", "application/pdf"];

export default async function messagesRoutes(app: FastifyInstance) {
  // POST /channels/:id/messages — multipart/form-data
  // Fields: content (optional text ≤ 2000 chars), file (optional attachment)
  app.post("/channels/:id/messages", { preHandler: auth }, async (req: any, reply: any) => {
    const params = z.object({ id: z.string().uuid() }).parse(req.params);
    const authorId = req.user.sub;
    const effective = await getEffectivePermission(params.id, authorId);

    if (effective === null) {
      return reply.code(404).send({ error: "channel_not_found" });
    }

    if (!hasPermission(effective, PERM_WRITE)) {
      return reply.code(403).send({ error: "requires_write_permission" });
    }

    await mkdir(uploadsDir, { recursive: true });

    let content = "";
    let fileInfo: { url: string; type: string; name: string; size: number } | null = null;

    // Iterate multipart parts
    const parts = req.parts();
    for await (const part of parts) {
      if (part.type === "field" && part.fieldname === "content") {
        content = String(part.value).slice(0, 2000);
        continue;
      }

      if (part.type === "file" && part.fieldname === "file") {
        // Validate MIME type
        if (!ALLOWED_MIME_PREFIXES.some((prefix) => part.mimetype.startsWith(prefix))) {
          // Drain the stream to avoid memory leak
          for await (const _ of part.file) { /* drain */ }
          return reply.code(400).send({ error: "file_type_not_allowed" });
        }

        // Sanitise extension (keep only safe chars)
        const rawExt = path.extname(part.filename || "").toLowerCase();
        const ext = rawExt.replace(/[^.a-z0-9]/g, "");
        const savedName = `${randomUUID()}${ext}`;
        const savedPath = path.join(uploadsDir, savedName);

        // Stream file to disk; catch truncation / errors
        try {
          await pipeline(part.file, createWriteStream(savedPath));
        } catch {
          await unlink(savedPath).catch(() => {});
          return reply.code(413).send({ error: "file_too_large" });
        }

        // @fastify/multipart sets truncated=true when fileSize limit is hit
        if ((part.file as any).truncated) {
          await unlink(savedPath).catch(() => {});
          return reply.code(413).send({ error: "file_too_large" });
        }

        const { size: fileSize } = await stat(savedPath);
        if (fileSize > MAX_FILE_SIZE) {
          await unlink(savedPath).catch(() => {});
          return reply.code(413).send({ error: "file_too_large" });
        }

        fileInfo = {
          url: `/files/${savedName}`,
          type: part.mimetype,
          name: part.filename || savedName,
          size: fileSize,
        };
        continue;
      }

      // Consume any unknown file parts to avoid memory leaks
      if (part.type === "file") {
        for await (const _ of part.file) { /* drain */ }
      }
    }

    if (!content.trim() && !fileInfo) {
      return reply.code(400).send({ error: "content_or_file_required" });
    }

    const res = await pool.query(
      `WITH ch AS (
         SELECT id, type FROM channels WHERE id = $1
       ),
       inserted AS (
         INSERT INTO messages (channel_id, author_id, content, file_url, file_type, file_name, file_size)
         SELECT ch.id, $2, $3, $4, $5, $6, $7
         FROM ch
         WHERE ch.type IN ('text', 'both')
         RETURNING id, channel_id, author_id, content, file_url, file_type, file_name, file_size, created_at
       )
       SELECT i.id, i.channel_id, i.author_id, u.username AS author_username, u.avatar_url AS author_avatar_url,
              u.color_config AS author_color_config,
              i.content, i.file_url, i.file_type, i.file_name, i.file_size, i.created_at
       FROM inserted i
       JOIN users u ON u.id = i.author_id`,
      [
        params.id,
        authorId,
        content,
        fileInfo?.url ?? null,
        fileInfo?.type ?? null,
        fileInfo?.name ?? null,
        fileInfo?.size ?? null,
      ],
    );

    if (res.rowCount === 0) {
      const exists = await pool.query(`SELECT 1 FROM channels WHERE id = $1`, [params.id]);
      return reply.code(exists.rowCount ? 403 : 404).send({
        error: exists.rowCount ? "channel_is_voice_only" : "channel_not_found",
      });
    }

    const msg = res.rows[0];
    app.io.to(`channel:${params.id}`).emit("new_message", msg);
    return reply.send({ message: msg });
  });

  // DELETE /channels/:channelId/messages/:messageId
  // Only the author can delete their own message.
  app.delete(
    "/channels/:channelId/messages/:messageId",
    { preHandler: auth },
    async (req: any, reply: any) => {
      const params = z.object({
        channelId: z.string().uuid(),
        messageId: z.string().uuid(),
      }).parse(req.params);

      const userId = req.user.sub;
      const effective = await getEffectivePermission(params.channelId, userId);
      if (effective === null) {
        return reply.code(404).send({ error: "channel_not_found" });
      }
      if (!hasPermission(effective, PERM_READ)) {
        return reply.code(403).send({ error: "requires_read_permission" });
      }

      const deleted = await pool.query(
        `DELETE FROM messages
         WHERE id = $1
           AND channel_id = $2
           AND author_id = $3
         RETURNING id, channel_id, file_url`,
        [params.messageId, params.channelId, userId],
      );

      if (deleted.rowCount === 0) {
        const existing = await pool.query(
          `SELECT author_id
           FROM messages
           WHERE id = $1
             AND channel_id = $2
           LIMIT 1`,
          [params.messageId, params.channelId],
        );

        if (existing.rowCount === 0) {
          return reply.code(404).send({ error: "message_not_found" });
        }

        return reply.code(403).send({ error: "forbidden" });
      }

      const row = deleted.rows[0] as { file_url: string | null };

      // Remove associated uploaded file if any.
      if (row.file_url && row.file_url.startsWith("/files/")) {
        const fileName = path.basename(row.file_url);
        const filePath = path.join(uploadsDir, fileName);
        await unlink(filePath).catch(() => {});
      }

      app.io.to(`channel:${params.channelId}`).emit("message:deleted", {
        channelId: params.channelId,
        messageId: params.messageId,
      });

      return reply.send({ ok: true });
    },
  );

  // GET /channels/:id/messages
  app.get("/channels/:id/messages", { preHandler: auth }, async (req: any, reply: any) => {
    const params = z.object({ id: z.string().uuid() }).parse(req.params);
    const effective = await getEffectivePermission(params.id, req.user.sub);

    if (effective === null) {
      return reply.code(404).send({ error: "channel_not_found" });
    }
    if (!hasPermission(effective, PERM_READ)) {
      return reply.code(403).send({ error: "requires_read_permission" });
    }

    const res = await pool.query(
      `SELECT m.id, m.channel_id, m.author_id, u.username AS author_username, u.avatar_url AS author_avatar_url,
              u.color_config AS author_color_config,
              m.content, m.file_url, m.file_type, m.file_name, m.file_size, m.created_at
       FROM messages m
       JOIN users u ON u.id = m.author_id
       WHERE m.channel_id = $1
       ORDER BY m.created_at DESC
       LIMIT 50`,
      [params.id],
    );

    return reply.send({ messages: res.rows });
  });
}
