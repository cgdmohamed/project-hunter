/**
 * Standalone migration entrypoint. Runs the Drizzle migrations against the
 * configured database path. Usage: `npm run db:migrate`.
 */
import { loadConfig } from '../config/env.js';
import { openDatabase, runMigrations } from './client.js';

const config = loadConfig();
const sqlite = openDatabase(config.DATABASE_PATH);
const started = Date.now();
try {
  runMigrations(sqlite);
  console.log(
    `[migrate] Applied migrations to ${config.DATABASE_PATH} in ${Date.now() - started}ms`,
  );
} finally {
  sqlite.close();
}