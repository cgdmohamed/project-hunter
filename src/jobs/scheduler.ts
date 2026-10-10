import { schedule, validate, type ScheduledTask } from 'node-cron';
import type { Logger } from 'pino';
import type { AppConfig } from '../config/env.js';
import type { ScanService } from '../services/scan.service.js';

export class ScanScheduler {
  private task: ScheduledTask | null = null;

  constructor(
    private readonly config: AppConfig,
    private readonly scan: ScanService,
    private readonly logger: Logger,
  ) {}

  start(): void {
    if (!this.config.AUTO_SCAN_ENABLED) {
      this.logger.info('automatic scans disabled; manual scans remain available');
      return;
    }
    const minutes = this.config.SCAN_INTERVAL_MINUTES;
    const expression = `*/${minutes} * * * *`;
    if (!validate(expression)) {
      throw new Error(`Invalid cron expression derived from SCAN_INTERVAL_MINUTES=${minutes}`);
    }

    this.logger.info({ intervalMinutes: minutes, expression }, 'starting scan scheduler');
    this.task = schedule(
      expression,
      () => {
        void this.scan
          .trigger('schedule')
          .then((report) => this.logger.info({ status: report.status }, 'scheduled scan finished'))
          .catch((error) =>
            this.logger.error(
              { error: error instanceof Error ? error.message : String(error) },
              'scheduled scan failed to run',
            ),
          );
      },
      { timezone: 'UTC', name: 'project-scan', noOverlap: true },
    );

    if (this.config.SCAN_ON_STARTUP) {
      this.logger.info('scan on startup enabled');
      setTimeout(() => {
        void this.scan
          .trigger('startup')
          .then((report) => this.logger.info({ status: report.status }, 'startup scan finished'))
          .catch((error) =>
            this.logger.error(
              { error: error instanceof Error ? error.message : String(error) },
              'startup scan failed to run',
            ),
          );
      }, 2_000);
    }
  }

  stop(): void {
    this.task?.stop();
    this.task = null;
  }
}