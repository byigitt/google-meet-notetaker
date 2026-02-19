import { TranscriptionStrategy } from '../config';
import { BaseTranscriber } from './base-transcriber';
import { CaptionTranscriber } from './caption-transcriber';
import { WhisperTranscriber } from './whisper-transcriber';

interface TranscriberOptions {
  openaiApiKey?: string;
  whisperApiKey?: string;
  whisperBaseUrl?: string;
}

export function createTranscriber(strategy: TranscriptionStrategy, opts: TranscriberOptions = {}): BaseTranscriber {
  if (strategy === 'whisper') {
    const key = opts.whisperApiKey ?? opts.openaiApiKey;
    if (!key) throw new Error('WHISPER_API_KEY (or OPENAI_API_KEY) missing for whisper');
    return new WhisperTranscriber(key, opts.whisperBaseUrl);
  }

  return new CaptionTranscriber();
}
