import { formatInTimeZone } from 'date-fns-tz';
import { env } from '../config/env';
import { createLogger } from '../shared/logger';
import { MessageBuffer } from '../shared/message-buffer';
import { SummarizerPipeline, type SummaryStats } from '../summarizer/pipeline';
import { WhatsAppIngestionClient } from '../whatsapp/client';

const logger = createLogger('daily-summary-job');

export class DailySummaryJob {
  constructor(
    private readonly buffer: MessageBuffer,
    private readonly summarizer: SummarizerPipeline,
    private readonly whatsapp: WhatsAppIngestionClient
  ) {}

  async run(): Promise<void> {
    const chatIds = await this.buffer.listChats();
    if (chatIds.length === 0) {
      logger.info('No chats present in buffer, skipping summary');
      return;
    }

    const windowStart = new Date(Date.now() - env.summaryWindowMinutes * 60 * 1000);
    logger.info('Generating summaries', {
      chatIds,
      windowStart: windowStart.toISOString(),
    });

    for (const chatId of chatIds) {
      await this.processChat(chatId, windowStart);
    }
  }

  private async processChat(chatId: string, windowStart: Date): Promise<void> {
    const messages = await this.buffer.loadWindow(chatId, windowStart);
    if (messages.length === 0) {
      logger.info('No messages for chat in window', { chatId });
      return;
    }

    const summary = await this.summarizer.generateDailySummary(messages);
    if (!summary) {
      logger.warn('Summary pipeline returned empty result', { chatId });
      return;
    }

    const heading = this.buildHeading(summary.stats);
    const message = `${heading}\n---\n\n${summary.summary}`;

    await this.whatsapp.sendSummary(chatId, message);
    const cutoff = new Date(Date.parse(summary.stats.windowEnd) + 1);
    await this.buffer.clearOlderThan(chatId, cutoff);

    logger.info('Summary dispatched', {
      chatId,
      chunkCount: summary.chunkSummaries.length,
      totalMessages: summary.stats.totalMessages,
    });
  }

  private buildHeading(stats: SummaryStats): string {
    const windowStart = new Date(stats.windowStart);
    const windowEnd = new Date(stats.windowEnd);
    const hours = env.summaryWindowMinutes / 60;
    const hoursLabel = Number.isInteger(hours) ? hours.toString() : hours.toFixed(1);
    const dateLabel = formatInTimeZone(windowEnd, stats.timeZone, 'dd/MM/yyyy');
    const startLabel = formatInTimeZone(windowStart, stats.timeZone, 'HH:mm');
    const endLabel = formatInTimeZone(windowEnd, stats.timeZone, 'HH:mm');
    return `🕒 Resumo das últimas ${hoursLabel}h – ${dateLabel}\nPeríodo coberto: ${startLabel} - ${endLabel} (${stats.timeZone})`;
  }
}
