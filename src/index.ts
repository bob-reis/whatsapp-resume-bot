import { env } from './config/env';
import { DailySummaryJob } from './jobs/daily-summary';
import { scheduleDailySummary } from './jobs/scheduler';
import { createLogger } from './shared/logger';
import { MessageBuffer } from './shared/message-buffer';
import { SummarizerPipeline } from './summarizer/pipeline';
import { WhatsAppIngestionClient } from './whatsapp/client';

const logger = createLogger('bootstrap');

async function main(): Promise<void> {
  logger.info('Starting WhatsApp summarizer bot', {
    targetChatIds: env.targetChatIds,
    summarySchedule: env.summarySchedule,
  });

  const messageBuffer = new MessageBuffer();
  const whatsappClient = new WhatsAppIngestionClient(messageBuffer);
  await whatsappClient.start();

  const summarizer = new SummarizerPipeline();
  const summaryJob = new DailySummaryJob(messageBuffer, summarizer, whatsappClient);

  scheduleDailySummary(summaryJob);

  if (process.argv.includes('--run-summary-now')) {
    logger.info('Manual summary execution requested');
    await summaryJob.run();
  }
}

main().catch((error) => {
  logger.error('Fatal error during bootstrap', { error });
  process.exit(1);
});

process.on('SIGINT', () => {
  logger.warn('Received SIGINT, exiting');
  process.exit(0);
});

process.on('SIGTERM', () => {
  logger.warn('Received SIGTERM, exiting');
  process.exit(0);
});
