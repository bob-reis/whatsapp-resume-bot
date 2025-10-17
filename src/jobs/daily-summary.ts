import { env } from '../config/env';
import { createLogger } from '../shared/logger';
import { MessageBuffer } from '../shared/message-buffer';
import { SummarizerPipeline } from '../summarizer/pipeline';
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

    const heading = this.buildHeading(windowStart);
    const message = `${heading}\n\n${summary.summary}`;

    await this.whatsapp.sendSummary(chatId, message);
    await this.buffer.clearOlderThan(chatId, new Date(Date.now() - env.summaryWindowMinutes * 60 * 1000));

    logger.info('Summary dispatched', {
      chatId,
      chunkCount: summary.chunkSummaries.length,
    });
  }

  private buildHeading(windowStart: Date): string {
    const end = new Date();
    const date = end.toLocaleDateString('pt-BR');
    const start = windowStart.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    const finish = end.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    const hours = Math.round((Date.now() - windowStart.getTime()) / 1000 / 60 / 60);
    return `Resumo das últimas ${hours}h — ${date} (${start} - ${finish})`;
  }
}
