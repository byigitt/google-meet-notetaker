// ─── Transcriber Factory ─────────────────────────────────
// SRP: Tek sorumluluk → doğru transcriber stratejisini oluştur
// DRY: Strategy seçimi tek yerde
// ─────────────────────────────────────────────────────────

import { TranscriptionStrategy } from '../config';
import { BaseTranscriber } from './base-transcriber';
import { CaptionTranscriber } from './caption-transcriber';
import { DeepgramTranscriber } from './deepgram-transcriber';

export function createTranscriber(
  strategy: TranscriptionStrategy,
  deepgramApiKey?: string,
): BaseTranscriber {
  switch (strategy) {
    case 'deepgram':
      if (!deepgramApiKey) throw new Error('Deepgram API key gerekli');
      return new DeepgramTranscriber(deepgramApiKey);

    case 'captions':
    default:
      return new CaptionTranscriber();
  }
}
