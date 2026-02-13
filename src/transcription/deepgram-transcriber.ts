// ─── Deepgram Transcriber ────────────────────────────────
// SRP: Tek sorumluluk → Deepgram ile real-time ses transkripsiyonu
// Strategy: BaseTranscriber'ın "deepgram" implementasyonu
// ─────────────────────────────────────────────────────────

import type { Page } from 'patchright';
import { createClient, LiveTranscriptionEvents } from '@deepgram/sdk';
import { BaseTranscriber } from './base-transcriber';
import { TranscriptEntry } from '../types';

export class DeepgramTranscriber extends BaseTranscriber {
  private connection: any = null;
  private keepAliveTimer: ReturnType<typeof setInterval> | null = null;

  constructor(private apiKey: string, private language = 'tr') {
    super();
  }

  async start(page: Page): Promise<void> {
    this.active = true;

    // 1) Deepgram WebSocket bağlantısı kur
    const deepgram = createClient(this.apiKey);

    this.connection = deepgram.listen.live({
      model: 'nova-3',
      language: this.language,
      smart_format: true,
      interim_results: true,
      utterance_end_ms: 1500,
      vad_events: true,
      endpointing: 300,
    });

    this.connection.on(LiveTranscriptionEvents.Open, () => {
      console.log('🎙️  Deepgram bağlantısı açıldı');
    });

    this.connection.on(LiveTranscriptionEvents.Transcript, (data: any) => {
      const alt = data.channel?.alternatives?.[0];
      if (!alt?.transcript) return;

      const speaker = alt.words?.[0]?.speaker
        ? `Konuşmacı ${alt.words[0].speaker}`
        : 'Konuşmacı';

      if (data.is_final) {
        const now = new Date();
        this.addEntry({ speaker, text: alt.transcript, startTime: now, endTime: now });
        console.log(`💬 [Deepgram] ${speaker}: ${alt.transcript}`);
      }
    });

    this.connection.on(LiveTranscriptionEvents.Error, (err: any) => {
      console.error('❌ Deepgram hatası:', err);
      this.emit('error', `Deepgram hatası: ${err.message || err}`);
    });

    this.connection.on(LiveTranscriptionEvents.Close, () => {
      console.log('🎙️  Deepgram bağlantısı kapandı');
    });

    // 2) Sayfadan ses yakala ve Deepgram'a gönder
    await this.captureAudioFromPage(page);

    // 3) Keep-alive
    this.keepAliveTimer = setInterval(() => {
      if (!this.active || !this.connection) {
        if (this.keepAliveTimer) clearInterval(this.keepAliveTimer);
        return;
      }
      try { this.connection.keepAlive(); } catch { /* pass */ }
    }, 8000);

    console.log('🎙️  Deepgram transcriber başlatıldı');
  }

  async stop(): Promise<void> {
    this.active = false;
    if (this.keepAliveTimer) clearInterval(this.keepAliveTimer);
    try { this.connection?.requestClose(); } catch { /* pass */ }
    this.connection = null;
    console.log('🎙️  Deepgram transcriber durduruldu');
  }

  // ── Sayfadan ses yakala ──

  private async captureAudioFromPage(page: Page): Promise<void> {
    try {
      await page.exposeFunction('__sendAudioChunk', (base64: string) => {
        if (!this.connection || !this.active) return;
        const buffer = Buffer.from(base64, 'base64');
        this.connection.send(buffer);
      });
    } catch { /* zaten expose edilmiş */ }

    await page.evaluate(() => {
      const audioCtx = new AudioContext({ sampleRate: 16000 });
      const mediaElements = document.querySelectorAll('audio, video');
      const sources: MediaElementAudioSourceNode[] = [];

      mediaElements.forEach(el => {
        try {
          sources.push(audioCtx.createMediaElementSource(el as HTMLMediaElement));
        } catch { /* zaten bağlı */ }
      });

      const merger = audioCtx.createChannelMerger(Math.max(sources.length, 1));
      sources.forEach((s, i) => s.connect(merger, 0, Math.min(i, merger.numberOfInputs - 1)));

      const processor = audioCtx.createScriptProcessor(4096, 1, 1);
      merger.connect(processor);
      processor.connect(audioCtx.destination);

      processor.onaudioprocess = (e: AudioProcessingEvent) => {
        const float32 = e.inputBuffer.getChannelData(0);
        const int16 = new Int16Array(float32.length);
        for (let i = 0; i < float32.length; i++) {
          const s = Math.max(-1, Math.min(1, float32[i]));
          int16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
        }
        const bytes = new Uint8Array(int16.buffer);
        let binary = '';
        for (let i = 0; i < bytes.length; i++) {
          binary += String.fromCharCode(bytes[i]);
        }
        (window as any).__sendAudioChunk(btoa(binary));
      };
    });
  }
}
