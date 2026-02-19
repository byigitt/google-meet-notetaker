// ─── Transcriber Factory ─────────────────────────────────
// SRP: Tek sorumluluk → doğru transcriber stratejisini oluştur
// DRY: Strategy seçimi tek yerde
// ─────────────────────────────────────────────────────────

import { TranscriptionStrategy } from '../config';
import { BaseTranscriber } from './base-transcriber';
import { CaptionTranscriber } from './caption-transcriber';
import { DeepgramTranscriber } from './deepgram-transcriber';
import { WhisperTranscriber } from './whisper-transcriber';

export function createTranscriber(
  strategy: TranscriptionStrategy,
  opts: { openaiApiKey?: string; openaiBaseUrl?: string; deepgramApiKey?: string } = {},
): BaseTranscriber {
  switch (strategy) {
    case 'deepgram':
      if (!opts.deepgramApiKey) throw new Error('DEEPGRAM_API_KEY missing');
      return new DeepgramTranscriber(opts.deepgramApiKey);

    case 'whisper':
      if (!opts.openaiApiKey) throw new Error('OPENAI_API_KEY missing (required for whisper)');
      return new WhisperTranscriber(opts.openaiApiKey, opts.openaiBaseUrl);

    case 'captions':
    default:
      return new CaptionTranscriber();
  }
}
