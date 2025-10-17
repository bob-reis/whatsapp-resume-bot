import path from 'node:path';
import { Client, LocalAuth, Message } from 'whatsapp-web.js';
import qrcode from 'qrcode-terminal';
import { env } from '../config/env';
import { createLogger } from '../shared/logger';
import { MessageBuffer } from '../shared/message-buffer';

const logger = createLogger('whatsapp-client');

export class WhatsAppIngestionClient {
  private readonly messageBuffer: MessageBuffer;
  private client?: Client;

  constructor(messageBuffer: MessageBuffer) {
    this.messageBuffer = messageBuffer;
  }

  async start(): Promise<void> {
    this.client = new Client({
      puppeteer: {
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
      },
      authStrategy: new LocalAuth({
        dataPath: path.resolve(process.cwd(), 'storage', 'session'),
      }),
    });

    this.client.on('qr', (qr) => {
      logger.info('QR code received, scan with WhatsApp mobile');
      qrcode.generate(qr, { small: true });
    });

    this.client.on('ready', () => {
      logger.info('WhatsApp client is ready');
    });

    this.client.on('auth_failure', (msg) => {
      logger.error('WhatsApp auth failure', { message: msg });
    });

    this.client.on('message', (message) => {
      void this.handleMessage(message);
    });

    await this.client.initialize();
  }

  async sendSummary(chatId: string, summary: string): Promise<void> {
    if (!this.client) {
      throw new Error('WhatsApp client is not initialized');
    }

    await this.client.sendMessage(chatId, summary);
    logger.info('Summary message sent', { chatId });
  }

  private async handleMessage(message: Message): Promise<void> {
    if (!message.from || !message.timestamp) {
      return;
    }

    const chatId = message.from;
    if (!this.isTargetChat(chatId)) {
      return;
    }

    const type = message.hasMedia ? 'media' : 'text';
    const content = message.body ?? '[mensagem vazia]';
    const contact = await message.getContact();
    const sender = contact.pushname ?? contact.name ?? contact.number ?? message.from;

    await this.messageBuffer.append({
      chatId,
      messageId: message.id._serialized,
      sender,
      content,
      type,
      timestamp: message.timestamp * 1000,
    });
  }

  private isTargetChat(chatId: string): boolean {
    if (env.targetChatIds.length === 0) {
      return chatId.endsWith('@g.us');
    }

    return env.targetChatIds.includes(chatId);
  }
}
