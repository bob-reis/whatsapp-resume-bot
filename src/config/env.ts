import { config as loadEnv } from 'dotenv';
import { z } from 'zod';

loadEnv();

const envSchema = z.object({
  OPENAI_API_KEY: z.string().min(1, 'OPENAI_API_KEY is required'),
  WHATSAPP_TARGET_CHAT_IDS: z
    .string()
    .optional()
    .default(''),
  SUMMARY_SCHEDULE: z.string().default('0 20 * * *'),
  BUFFER_PATH: z.string().default('tmp'),
  SUMMARY_WINDOW_MINUTES: z
    .string()
    .optional()
    .transform((value) => (value ? Number.parseInt(value, 10) : 1440))
    .pipe(z.number().min(60).max(2880)),
  OPENAI_MODEL: z.string().default('gpt-4o-mini'),
  TIMEZONE: z.string().default('America/Sao_Paulo'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const formatted = parsed.error.format();
  throw new Error(`Invalid environment configuration: ${JSON.stringify(formatted, null, 2)}`);
}

const TARGET_IDS = parsed.data.WHATSAPP_TARGET_CHAT_IDS
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);

export const env = {
  openaiApiKey: parsed.data.OPENAI_API_KEY,
  targetChatIds: TARGET_IDS,
  summarySchedule: parsed.data.SUMMARY_SCHEDULE,
  bufferPath: parsed.data.BUFFER_PATH,
  summaryWindowMinutes: parsed.data.SUMMARY_WINDOW_MINUTES,
  openaiModel: parsed.data.OPENAI_MODEL,
  timezone: parsed.data.TIMEZONE,
};
