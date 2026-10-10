import { createApp } from './app.js';
import { loadConfig, ConfigError } from './config/env.js';
import { buildContainer } from './container.js';
import { runMigrations } from './database/client.js';
import { ScanScheduler } from './jobs/scheduler.js';
import { TelegramCommandPoller } from './integrations/telegram-commands.js';

async function main(): Promise<void> {
  let config;
  try {
    config = loadConfig();
  } catch (error) {
    if (error instanceof ConfigError) {
      console.error(error.message);
      process.exit(1);
    }
    throw error;
  }

  const container = buildContainer(config);
  const { logger } = container;

  let dbMigrated = false;
  try {
    runMigrations(container.sqlite);
    dbMigrated = true;
    logger.info({ databasePath: config.DATABASE_PATH }, 'database ready');
  } catch (error) {
    logger.error(
      { error: error instanceof Error ? error.message : String(error) },
      'database migration failed',
    );
    process.exit(1);
  }

  const app = createApp({ container, ready: { dbMigrated } });

  const scheduler = new ScanScheduler(config, container.scan, logger);
  try {
    scheduler.start();
  } catch (error) {
    logger.error(
      { error: error instanceof Error ? error.message : String(error) },
      'failed to start scheduler',
    );
  }

  const commands = new TelegramCommandPoller(config, container.settings, container.scan, container.telegram, logger);
  commands.start();

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'shutting down gracefully');
    scheduler.stop();
    await commands.stop();
    try {
      await app.close();
    } catch (error) {
      logger.error({ error: error instanceof Error ? error.message : String(error) }, 'error closing server');
    }
    try {
      container.sqlite.close();
    } catch {
      // ignore
    }
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('unhandledRejection', (reason) => {
    logger.error({ reason: reason instanceof Error ? reason.message : String(reason) }, 'unhandled rejection');
  });
  process.on('uncaughtException', (error) => {
    logger.error({ error: error.message }, 'uncaught exception');
  });

  try {
    await app.listen({ host: config.HOST, port: config.PORT });
    logger.info({ host: config.HOST, port: config.PORT }, 'HTTP server listening');
  } catch (error) {
    logger.error(
      { error: error instanceof Error ? error.message : String(error) },
      'failed to start HTTP server',
    );
    process.exit(1);
  }
}

void main();
