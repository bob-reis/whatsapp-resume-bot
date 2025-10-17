import cron from 'node-cron';
import { env } from '../config/env';
import { createLogger } from '../shared/logger';
import { DailySummaryJob } from './daily-summary';

const logger = createLogger('scheduler');

export const scheduleDailySummary = (job: DailySummaryJob): void => {
  cron.schedule(
    env.summarySchedule,
    () => {
      logger.info('Triggering scheduled daily summary');
      void job.run().catch((error) => {
        logger.error('Scheduled job failed', { error });
      });
    },
    {
      timezone: env.timezone,
    }
  );

  logger.info('Daily summary cron configured', {
    cron: env.summarySchedule,
    timezone: env.timezone,
  });
};
