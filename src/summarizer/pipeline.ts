import { encodingForModel, get_encoding } from '@dqbd/tiktoken';
import OpenAI from 'openai';
import { env } from '../config/env';
import { createLogger } from '../shared/logger';
import { BufferedMessage } from '../shared/message-buffer';
import { MAP_PROMPT, REDUCE_PROMPT } from './prompts';

export interface SummaryResult {
  summary: string;
  chunkSummaries: string[];
}

export class SummarizerPipeline {
  private readonly client: OpenAI;
  private readonly logger = createLogger('summarizer');

  constructor(client?: OpenAI) {
    this.client = client ?? new OpenAI({ apiKey: env.openaiApiKey });
  }

  async generateDailySummary(messages: BufferedMessage[]): Promise<SummaryResult | null> {
    if (messages.length === 0) {
      this.logger.warn('No messages in buffer for window');
      return null;
    }

    const chunks = this.chunkMessages(messages);
    this.logger.info('Chunked messages for summarization', {
      chunkCount: chunks.length,
      totalMessages: messages.length,
    });

    const chunkSummaries: string[] = [];
    for (const [index, chunk] of chunks.entries()) {
      const content = chunk
        .map((message) => this.formatMessage(message))
        .join('\n');

      const response = await this.client.responses.create({
        model: env.openaiModel,
        input: [
          { role: 'system', content: MAP_PROMPT },
          { role: 'user', content },
        ],
      });

      const text = response.output_text?.trim();
      if (!text) {
        this.logger.warn('Chunk summary returned empty text', { chunkIndex: index });
        continue;
      }

      chunkSummaries.push(text);
    }

    if (chunkSummaries.length === 0) {
      this.logger.warn('All chunk summaries were empty, skipping reduce');
      return null;
    }

    const reduceInput = chunkSummaries
      .map((summary, idx) => `Trecho ${idx + 1}:\n${summary}`)
      .join('\n\n');

    const reduceResponse = await this.client.responses.create({
      model: env.openaiModel,
      input: [
        { role: 'system', content: REDUCE_PROMPT },
        { role: 'user', content: reduceInput },
      ],
    });

    const finalText = reduceResponse.output_text?.trim();
    if (!finalText) {
      this.logger.warn('Reduce step produced empty output');
      return null;
    }

    return {
      summary: finalText,
      chunkSummaries,
    };
  }

  private chunkMessages(messages: BufferedMessage[]): BufferedMessage[][] {
    const encoder = this.buildEncoder();
    const limit = 1500; // conservative chunk size to stay well within context window
    const result: BufferedMessage[][] = [];
    let current: BufferedMessage[] = [];
    let currentTokens = 0;

    for (const message of messages) {
      const rendered = this.formatMessage(message);
      const tokens = encoder.encode(rendered).length;

      if (currentTokens + tokens > limit && current.length > 0) {
        result.push(current);
        current = [];
        currentTokens = 0;
      }

      current.push(message);
      currentTokens += tokens;
    }

    if (current.length > 0) {
      result.push(current);
    }

    encoder.free();
    return result;
  }

  private buildEncoder() {
    try {
      return encodingForModel(env.openaiModel);
    } catch (error) {
      this.logger.warn('Falling back to cl100k_base encoder', { error });
      return get_encoding('cl100k_base');
    }
  }

  private formatMessage(message: BufferedMessage): string {
    const date = new Date(message.timestamp).toLocaleString('pt-BR');
    return `[${date}] ${message.sender}: ${message.content}`;
  }
}
