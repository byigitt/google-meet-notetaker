import dotenv from 'dotenv';
dotenv.config();

export type TranscriptionStrategy = 'captions' | 'whisper';

export interface AppConfig {
  port: number;
  botName: string;
  captionLanguage: string;
  transcriptionStrategy: TranscriptionStrategy;
  openaiApiKey: string;
  whisperApiKey: string;
  whisperBaseUrl?: string;
  whisperModel: string;
  googleEmail?: string;
  googlePassword?: string;
}

function env(key: string, fallback?: string): string {
  const value = process.env[key] || fallback;
  if (!value) throw new Error(`Missing env: ${key}`);
  return value;
}

export function loadConfig(): AppConfig {
  const openaiApiKey = env('OPENAI_API_KEY');

  return {
    port:                   parseInt(env('PORT', '3000'), 10),
    botName:                env('BOT_NAME', 'AI Notetaker'),
    captionLanguage:        env('CAPTION_LANGUAGE', 'English'),
    transcriptionStrategy:  env('TRANSCRIPTION_STRATEGY', 'captions') as TranscriptionStrategy,
    openaiApiKey,
    whisperApiKey:          process.env.WHISPER_API_KEY ?? openaiApiKey,
    whisperBaseUrl:         process.env.WHISPER_BASE_URL,
    whisperModel:           env('WHISPER_MODEL', 'whisper-large-v3'),
    googleEmail:            process.env.GOOGLE_EMAIL,
    googlePassword:         process.env.GOOGLE_PASSWORD,
  };
}
