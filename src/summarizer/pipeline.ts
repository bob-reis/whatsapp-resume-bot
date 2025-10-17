import { encoding_for_model, get_encoding, type TiktokenModel } from '@dqbd/tiktoken';
import { formatInTimeZone, utcToZonedTime } from 'date-fns-tz';
import OpenAI from 'openai';
import { env } from '../config/env';
import { createLogger } from '../shared/logger';
import { BufferedMessage } from '../shared/message-buffer';
import { MAP_PROMPT, REDUCE_PROMPT } from './prompts';

export interface SummaryResult {
  summary: string;
  chunkSummaries: string[];
  stats: SummaryStats;
}

export interface SummaryStats {
  totalMessages: number;
  uniqueParticipants: number;
  windowStart: string;
  windowEnd: string;
  timeZone: string;
  topMembers: Array<{ name: string; count: number }>;
  busiestPeriod: { startHour: number; endHour: number; count: number } | null;
  segments: TimeSegmentStat[];
  sharedLinks: SharedLinkStat[];
}

interface TimeSegmentStat {
  label: string;
  emoji: string;
  startHour: number;
  endHour: number;
  count: number;
  messagePreviews: string[];
}

interface SharedLinkStat {
  url: string;
  sender: string;
  snippet: string;
}

const TIME_SEGMENTS = [
  { label: 'Madrugada', emoji: '🌙', startHour: 0, endHour: 6 },
  { label: 'Manhã', emoji: '🌅', startHour: 6, endHour: 12 },
  { label: 'Início da tarde', emoji: '☀', startHour: 12, endHour: 16 },
  { label: 'Final da tarde', emoji: '🌇', startHour: 16, endHour: 19 },
  { label: 'Noite', emoji: '🌙', startHour: 19, endHour: 24 },
] as const;

const MAX_SEGMENT_PREVIEW = 18;
const LINK_REGEX = /(https?:\/\/[^\s]+)/gi;

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

    const stats = this.buildStats(messages);

    const reduceInput = [
      'ESTATISTICAS_JSON:',
      JSON.stringify(stats, null, 2),
      '',
      'RESUMOS_POR_TRECHO:',
      chunkSummaries.map((summary, idx) => `Trecho ${idx + 1}:\n${summary}`).join('\n\n'),
    ].join('\n');

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
      stats,
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
      return encoding_for_model(env.openaiModel as unknown as TiktokenModel);
    } catch (error) {
      this.logger.warn('Falling back to cl100k_base encoder', { error });
      return get_encoding('cl100k_base');
    }
  }

  private formatMessage(message: BufferedMessage): string {
    const date = new Date(message.timestamp).toLocaleString('pt-BR');
    return `[${date}] ${message.sender}: ${message.content}`;
  }

  private buildStats(messages: BufferedMessage[]): SummaryStats {
    const timeZone = env.timezone;
    const windowStartDate = new Date(messages[0]!.timestamp);
    const windowEndDate = new Date(messages[messages.length - 1]!.timestamp);
    const stats: SummaryStats = {
      totalMessages: messages.length,
      uniqueParticipants: 0,
      windowStart: formatInTimeZone(windowStartDate, timeZone, "yyyy-MM-dd'T'HH:mmXXX"),
      windowEnd: formatInTimeZone(windowEndDate, timeZone, "yyyy-MM-dd'T'HH:mmXXX"),
      timeZone,
      topMembers: [],
      busiestPeriod: null,
      segments: [],
      sharedLinks: [],
    };

    const memberCount = new Map<string, number>();
    const hourCounts = Array.from({ length: 24 }, () => 0);
    const segmentBuckets = TIME_SEGMENTS.map(() => [] as string[]);
    const segmentCounts = Array.from({ length: TIME_SEGMENTS.length }, () => 0);
    const links: SharedLinkStat[] = [];
    const seenLinks = new Set<string>();

    for (const message of messages) {
      const sender = message.sender?.trim() || 'Participante';
      memberCount.set(sender, (memberCount.get(sender) ?? 0) + 1);

      const zoned = utcToZonedTime(new Date(message.timestamp), timeZone);
      const hour = zoned.getHours();
      hourCounts[hour] += 1;

      const segmentIndex = TIME_SEGMENTS.findIndex((segment) => hour >= segment.startHour && hour < segment.endHour);
      if (segmentIndex !== -1) {
        segmentCounts[segmentIndex] += 1;
        if (segmentBuckets[segmentIndex].length < MAX_SEGMENT_PREVIEW) {
          const timeLabel = formatInTimeZone(message.timestamp, timeZone, 'HH:mm');
          const snippet = message.content.length > 120 ? `${message.content.slice(0, 117)}...` : message.content;
          segmentBuckets[segmentIndex].push(`${timeLabel} — ${sender}: ${snippet}`);
        }
      }

      const urlMatches = message.content.match(LINK_REGEX);
      if (urlMatches) {
        for (const rawUrl of urlMatches) {
          const normalized = rawUrl.trim();
          if (!seenLinks.has(normalized)) {
            seenLinks.add(normalized);
            const snippet = message.content.length > 140 ? `${message.content.slice(0, 137)}...` : message.content;
            links.push({ url: normalized, sender, snippet });
          }
        }
      }
    }

    stats.uniqueParticipants = memberCount.size;
    stats.topMembers = Array.from(memberCount.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, count]) => ({ name, count }));

    const windowSize = 2; // hours
    let bestStart = 0;
    let bestCount = -1;
    for (let hour = 0; hour < 24; hour += 1) {
      let windowCount = 0;
      for (let offset = 0; offset < windowSize; offset += 1) {
        const index = (hour + offset) % 24;
        windowCount += hourCounts[index];
      }
      if (windowCount > bestCount) {
        bestCount = windowCount;
        bestStart = hour;
      }
    }
    if (bestCount > 0) {
      stats.busiestPeriod = {
        startHour: bestStart,
        endHour: (bestStart + windowSize) % 24,
        count: bestCount,
      };
    }

    stats.segments = TIME_SEGMENTS.map((segment, index) => ({
      label: segment.label,
      emoji: segment.emoji,
      startHour: segment.startHour,
      endHour: segment.endHour,
      count: segmentCounts[index] ?? 0,
      messagePreviews: segmentBuckets[index] ?? [],
    }));

    stats.sharedLinks = links.slice(0, 8);
    return stats;
  }
}
