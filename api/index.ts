import app from "../artifacts/api-server/src/app";
  import pg from "pg";

  const { Pool } = pg;

  // Init DB tables on cold start (Vercel entry — standalone src/index.ts is never run here)
  if (process.env.DATABASE_URL) {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    pool.query(`
      CREATE TABLE IF NOT EXISTS workers (
        id               SERIAL PRIMARY KEY,
        discord_id       TEXT NOT NULL UNIQUE,
        discord_username TEXT NOT NULL,
        worker_key       TEXT NOT NULL UNIQUE,
        status           TEXT NOT NULL DEFAULT 'VALID',
        expires_at       TIMESTAMP,
        created_at       TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at       TIMESTAMP NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS tokens (
        id           SERIAL PRIMARY KEY,
        token        TEXT NOT NULL UNIQUE,
        email        TEXT,
        account_pass TEXT,
        status       TEXT NOT NULL DEFAULT 'VALID',
        worker_id    INTEGER REFERENCES workers(id),
        worker_key   TEXT,
        created_at   TIMESTAMP NOT NULL DEFAULT NOW(),
        checked_at   TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS daily_stats (
        id               SERIAL PRIMARY KEY,
        worker_id        INTEGER NOT NULL REFERENCES workers(id),
        date             TEXT NOT NULL,
        tokens_generated INTEGER NOT NULL DEFAULT 0,
        tokens_valid     INTEGER NOT NULL DEFAULT 0,
        tokens_locked    INTEGER NOT NULL DEFAULT 0,
        tokens_invalid   INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS tool_config (
        id         SERIAL PRIMARY KEY,
        config     JSON NOT NULL DEFAULT '{}',
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS env_settings (
        key         TEXT PRIMARY KEY,
        value       TEXT NOT NULL DEFAULT '',
        description TEXT NOT NULL DEFAULT '',
        updated_at  TIMESTAMP NOT NULL DEFAULT NOW()
      );
      ALTER TABLE tokens ADD COLUMN IF NOT EXISTS account_pass TEXT;
    `).catch(e => console.error('[DB init]', e?.message));
  }

  export default app;
  