import bcrypt from 'bcrypt';
import 'dotenv/config';
import { pool } from '../src/db';

const DEFAULT_COUNT = 50;
const DEFAULT_AUTHORS = 6;
const MAX_COUNT = 500;
const MAX_AUTHORS = 20;

const SAMPLE_MESSAGES = [
  'Ping, est-ce que vous voyez ce message ?',
  'Je teste la mise en page mobile ici.',
  'Le rendu desktop est beaucoup plus clean maintenant.',
  'On pourrait reduire un peu le padding des messages.',
  'Le mode vocal marche bien chez moi.',
  'Petit test avec une phrase un peu plus longue pour verifier le retour a la ligne et le spacing entre les elements du message.',
  'On garde ce channel pour les tests UI.',
  'Je pense qu il faut ajuster la couleur du timestamp.',
  'Est-ce que la barre de saisie est fluide ?',
  'Le dark theme est vraiment propre.',
  'Nouveau test de scroll vers le bas.',
  'Je valide, on peut continuer.',
];

type SeedUser = {
  id: string;
  username: string;
};

type ChannelRow = {
  id: string;
  name: string;
  type: 'text' | 'voice' | 'both';
};

function readArg(name: string): string | undefined {
  const key = `--${name}`;
  const index = process.argv.findIndex((arg) => arg === key);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}

function parsePositiveInt(value: string | undefined, fallback: number, max: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, max);
}

async function pickTargetChannel(channelIdArg?: string): Promise<ChannelRow> {
  if (channelIdArg) {
    const channelRes = await pool.query<ChannelRow>(
      `SELECT id, name, type
       FROM channels
       WHERE id = $1
         AND type IN ('text', 'both')
       LIMIT 1`,
      [channelIdArg],
    );

    if (channelRes.rowCount === 0) {
      throw new Error(
        `Channel "${channelIdArg}" introuvable ou non textuel (utilise un channel text/both).`,
      );
    }

    return channelRes.rows[0];
  }

  const firstTextualRes = await pool.query<ChannelRow>(
    `SELECT id, name, type
     FROM channels
     WHERE type IN ('text', 'both')
     ORDER BY created_at ASC
     LIMIT 1`,
  );

  if (firstTextualRes.rowCount > 0) {
    return firstTextualRes.rows[0];
  }

  const createdRes = await pool.query<ChannelRow>(
    `INSERT INTO channels (name, type)
     VALUES ('seed-general', 'text')
     RETURNING id, name, type`,
  );

  return createdRes.rows[0];
}

async function ensureSeedUsers(count: number): Promise<SeedUser[]> {
  const passwordHash = await bcrypt.hash('seed-password', 10);
  const users: SeedUser[] = [];

  for (let i = 1; i <= count; i += 1) {
    const username = `seed_user_${i}`;

    await pool.query(
      `INSERT INTO users (username, password_hash)
       VALUES ($1, $2)
       ON CONFLICT (username) DO NOTHING`,
      [username, passwordHash],
    );

    const userRes = await pool.query<SeedUser>(
      `SELECT id, username
       FROM users
       WHERE username = $1
       LIMIT 1`,
      [username],
    );

    if (userRes.rowCount > 0) {
      users.push(userRes.rows[0]);
    }
  }

  if (users.length === 0) {
    throw new Error('Impossible de recuperer les comptes seed.');
  }

  return users;
}

function buildMessage(index: number): string {
  const base = SAMPLE_MESSAGES[index % SAMPLE_MESSAGES.length];
  return `${base} (#${index + 1})`;
}

async function main() {
  const count = parsePositiveInt(readArg('count'), DEFAULT_COUNT, MAX_COUNT);
  const authors = parsePositiveInt(readArg('authors'), DEFAULT_AUTHORS, MAX_AUTHORS);
  const channelId = readArg('channelId');

  const channel = await pickTargetChannel(channelId);
  const seedUsers = await ensureSeedUsers(authors);

  await pool.query('BEGIN');
  try {
    const now = Date.now();

    for (let i = 0; i < count; i += 1) {
      const author = seedUsers[i % seedUsers.length];
      const createdAt = new Date(now - (count - i) * 45_000);
      const content = buildMessage(i);

      await pool.query(
        `INSERT INTO messages (channel_id, author_id, content, created_at)
         VALUES ($1, $2, $3, $4)`,
        [channel.id, author.id, content, createdAt.toISOString()],
      );
    }

    await pool.query('COMMIT');
    console.log(
      `[seed:messages] ${count} messages inseres dans #${channel.name} (${channel.id}) avec ${seedUsers.length} auteurs.`,
    );
  } catch (error) {
    await pool.query('ROLLBACK');
    throw error;
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[seed:messages] erreur: ${message}`);
  process.exit(1);
});
