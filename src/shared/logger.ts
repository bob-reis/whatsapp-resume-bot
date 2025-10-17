/*
 * Minimal structured logger to keep console output readable.
 */
export class Logger {
  constructor(private readonly context: string) {}

  info(message: string, meta?: Record<string, unknown>): void {
    // eslint-disable-next-line no-console
    console.log(this.format('info', message, meta));
  }

  warn(message: string, meta?: Record<string, unknown>): void {
    // eslint-disable-next-line no-console
    console.warn(this.format('warn', message, meta));
  }

  error(message: string, meta?: Record<string, unknown>): void {
    // eslint-disable-next-line no-console
    console.error(this.format('error', message, meta));
  }

  private format(level: string, message: string, meta?: Record<string, unknown>): string {
    const base = {
      level,
      ctx: this.context,
      message,
      ts: new Date().toISOString(),
    };

    return JSON.stringify(meta ? { ...base, ...meta } : base);
  }
}

export const createLogger = (context: string): Logger => new Logger(context);
