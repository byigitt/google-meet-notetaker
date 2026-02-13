// ─── Configuration ───────────────────────────────────────
// SRP: Tek sorumluluk → uygulama konfigürasyonunu yönetmek
// ─────────────────────────────────────────────────────────

import dotenv from 'dotenv';
dotenv.config();

export type TranscriptionStrategy = 'captions' | 'deepgram';

export interface AppConfig {
  port: number;
  botName: string;
  captionLanguage: string;
  transcriptionStrategy: TranscriptionStrategy;
  openaiApiKey: string;
  deepgramApiKey?: string;
  googleEmail?: string;
  googlePassword?: string;
}

function requiredEnv(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`❌ Ortam değişkeni eksik: ${key}`);
  return value;
}

function optionalEnv(key: string, fallback?: string): string | undefined {
  return process.env[key] || fallback;
}

export function loadConfig(): AppConfig {
  const strategy = (optionalEnv('TRANSCRIPTION_STRATEGY', 'captions') as TranscriptionStrategy);

  if (strategy === 'deepgram' && !process.env.DEEPGRAM_API_KEY) {
    throw new Error('❌ Deepgram stratejisi seçildi ama DEEPGRAM_API_KEY tanımlı değil');
  }

  return {
    port: parseInt(optionalEnv('PORT', '3000')!, 10),
    botName: optionalEnv('BOT_NAME', 'AI Notetaker')!,
    captionLanguage: optionalEnv('CAPTION_LANGUAGE', 'Turkish')!,
    transcriptionStrategy: strategy,
    openaiApiKey: requiredEnv('OPENAI_API_KEY'),
    deepgramApiKey: optionalEnv('DEEPGRAM_API_KEY'),
    googleEmail: optionalEnv('GOOGLE_EMAIL'),
    googlePassword: optionalEnv('GOOGLE_PASSWORD'),
  };
}
