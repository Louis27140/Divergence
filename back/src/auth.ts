import jwt from "jsonwebtoken";
import "dotenv/config";

export type JwtPayload = {
  sub: string;
  username: string;
};

const JWT_SECRET = process.env.JWT_SECRET!;
if (!JWT_SECRET) throw new Error("Missing JWT_SECRET");

export function signToken(userId: string, username: string) {
  return jwt.sign(
    { sub: userId, username } satisfies JwtPayload,
    JWT_SECRET,
    { expiresIn: "7d" }
  );
}

export async function auth(req: any, reply: any) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return reply.code(401).send({ error: "Missing token" });
  }

  const token = header.slice("Bearer ".length);
  try {
    req.user = jwt.verify(token, JWT_SECRET) as JwtPayload;
  } catch {
    return reply.code(401).send({ error: "Invalid token" });
  }
}
