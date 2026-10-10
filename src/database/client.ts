import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from './schema.js';

export type AppDb = BetterSQLite3Database<typeof schema>;

/**
 * Opens the SQLite database file, configures pragmas and returns a drizzle
 * handle. WAL mode is enabled except for in-memory databases (used in tests).
 */
export function openDatabase(dbPath: string): Database.Database {
  if (dbPath !== ':memory:') {
    mkdirSync(dirname(dbPath), { recursive: true });
  }
  const sqlite = new Database(dbPath);
  sqlite.pragma('busy_timeout = 10000');
  sqlite.pragma('foreign_keys = ON');
  if (dbPath !== ':memory:') {
    sqlite.pragma('journal_mode = WAL');
    sqlite.pragma('synchronous = NORMAL');
  }
  return sqlite;
}

export function createDrizzle(sqlite: Database.Database): AppDb {
  return drizzle(sqlite, { schema });
}

export const MIGRATIONS_DIR = fileURLToPath(new URL('./migrations', import.meta.url));

/**
 * Applies pending Drizzle migrations. Called at startup and idempotent.
 */
export function runMigrations(sqlite: Database.Database): void {
  const db = createDrizzle(sqlite);
  migrate(db, { migrationsFolder: MIGRATIONS_DIR });
}