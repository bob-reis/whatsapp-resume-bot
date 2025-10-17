import path from 'node:path';
import { existsSync, statSync } from 'node:fs';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { env } from '../config/env';
import { createLogger } from './logger';

export interface BufferedMessage {
  chatId: string;
  messageId: string;
  sender: string;
  content: string;
  type: 'text' | 'media' | 'system';
  timestamp: number;
}

const logger = createLogger('message-buffer');

export class MessageBuffer {
  private readonly bufferDir: string;

  constructor() {
    this.bufferDir = path.resolve(env.bufferPath);
  }

  async append(message: BufferedMessage): Promise<void> {
    const bucket = this.toBucketDate(message.timestamp);
    const filePath = this.bucketFilePath(message.chatId, bucket);
    await this.ensureDir(path.dirname(filePath));

    const existing = await this.readBucket(filePath);
    existing.push(message);

    await writeFile(filePath, JSON.stringify(existing, null, 2), 'utf-8');
  }

  async loadWindow(chatId: string, since: Date): Promise<BufferedMessage[]> {
    const targetMs = since.getTime();
    const nowBucket = this.toBucketDate(Date.now());
    const previousBucket = this.toBucketDate(targetMs);
    const buckets = new Set([nowBucket, previousBucket]);

    const messages: BufferedMessage[] = [];
    for (const bucket of buckets) {
      const filePath = this.bucketFilePath(chatId, bucket);
      const bucketMessages = await this.readBucket(filePath);
      messages.push(...bucketMessages);
    }

    return messages
      .filter((message) => message.timestamp >= targetMs)
      .sort((a, b) => a.timestamp - b.timestamp);
  }

  async clearOlderThan(chatId: string, cutoff: Date): Promise<void> {
    const cutoffMs = cutoff.getTime();
    const chatDir = this.chatDir(chatId);
    if (!existsSync(chatDir)) {
      return;
    }

    const currentBucket = this.toBucketDate(Date.now());
    const files = [currentBucket, this.toBucketDate(cutoffMs)].map((bucket) => ({
      bucket,
      filePath: this.bucketFilePath(chatId, bucket),
    }));

    await Promise.all(
      files.map(async ({ bucket, filePath }) => {
        const bucketMessages = await this.readBucket(filePath);
        if (bucketMessages.length === 0) {
          return;
        }

        const filtered = bucketMessages.filter((message) => message.timestamp >= cutoffMs);
        if (filtered.length === 0) {
          await rm(filePath, { force: true });
          return;
        }

        await writeFile(filePath, JSON.stringify(filtered, null, 2), 'utf-8');
        logger.info('Trimmed buffer bucket', {
          chatId,
          bucket,
          remaining: filtered.length,
        });
      })
    );
  }

  async removeChat(chatId: string): Promise<void> {
    const dir = this.chatDir(chatId);
    if (!existsSync(dir)) {
      return;
    }

    await rm(dir, { recursive: true, force: true });
    logger.info('Removed chat buffer', { chatId });
  }

  async listChats(): Promise<string[]> {
    if (!existsSync(this.bufferDir)) {
      return [];
    }

    const entries = await readdir(this.bufferDir);
    return entries
      .map((entry) => path.join(this.bufferDir, entry))
      .filter((entryPath) => {
        try {
          return statSync(entryPath).isDirectory();
        } catch {
          return false;
        }
      })
      .map((entryPath) => path.basename(entryPath));
  }

  private chatDir(chatId: string): string {
    return path.join(this.bufferDir, chatId);
  }

  private bucketFilePath(chatId: string, bucket: string): string {
    return path.join(this.chatDir(chatId), `${bucket}.json`);
  }

  private async ensureDir(dirPath: string): Promise<void> {
    if (!existsSync(dirPath)) {
      await mkdir(dirPath, { recursive: true });
    }
  }

  private async readBucket(filePath: string): Promise<BufferedMessage[]> {
    if (!existsSync(filePath)) {
      return [];
    }

    const raw = await readFile(filePath, 'utf-8');
    try {
      const data = JSON.parse(raw) as BufferedMessage[];
      return Array.isArray(data) ? data : [];
    } catch (error) {
      logger.error('Failed to deserialize buffer bucket, recreating', { filePath, error });
      await rm(filePath, { force: true });
      return [];
    }
  }

  private toBucketDate(timestamp: number): string {
    const date = new Date(timestamp);
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(date.getUTCDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
}
