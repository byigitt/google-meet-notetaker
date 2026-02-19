// ─── Whisper Transcriber ─────────────────────────────────
// Toplantı sesini kaydeder, sonunda Whisper API ile transkript alır.
// Strategy: BaseTranscriber'ın "whisper" implementasyonu
// ─────────────────────────────────────────────────────────

import fs from 'fs';
import os from 'os';
import path from 'path';
import OpenAI from 'openai';
import type { Page } from 'patchright';
import { BaseTranscriber } from './base-transcriber';
import { TranscriptEntry } from '../types';
import { log, warn, error, debug } from '../logger';

const M = 'whisper';

// RTCPeerConnection'ı intercept ederek remote audio track'leri yakala.
// Bu kod page.addInitScript() ile enjekte edilir — Meet JS'den önce çalışır.
const INIT_SCRIPT = `(function () {
  if (window.__whisperSetup) return;
  window.__whisperSetup = true;

  var AudioCtx = window.AudioContext || window.webkitAudioContext;
  var audioCtx = new AudioCtx();
  var dest = audioCtx.createMediaStreamDestination();
  var connectedIds = new Set();

  window.__whisperAudioDest = dest;
  window.__whisperAudioCtx  = audioCtx;

  function connectTrack(track) {
    if (connectedIds.has(track.id)) return;
    connectedIds.add(track.id);
    try {
      var stream = new MediaStream([track]);
      var src    = audioCtx.createMediaStreamSource(stream);
      src.connect(dest); // yönlendiriyoruz ama play etmiyoruz (Meet zaten çalıyor)
    } catch (e) {
      console.warn('[whisper-init] track connect error:', e);
    }
  }

  // RTCPeerConnection'ı wrap et
  var OrigPC = window.RTCPeerConnection;
  window.RTCPeerConnection = function () {
    var pc = new OrigPC(...arguments);
    pc.addEventListener('track', function (e) {
      if (e.track.kind === 'audio') connectTrack(e.track);
    });
    return pc;
  };
  window.RTCPeerConnection.prototype = OrigPC.prototype;
  Object.setPrototypeOf(window.RTCPeerConnection, OrigPC);

  // Var olan <audio>/<video> elementlerini de yakala (fallback)
  function captureElement(el) {
    if (el.__whisperCaptured) return;
    el.__whisperCaptured = true;
    try {
      var src = audioCtx.createMediaElementSource(el);
      src.connect(dest);
      src.connect(audioCtx.destination); // sesi kesmemek için
    } catch (e) {}
  }
  document.querySelectorAll('audio, video').forEach(captureElement);
  new MutationObserver(function () {
    document.querySelectorAll('audio, video').forEach(captureElement);
  }).observe(document.body, { childList: true, subtree: true });
})();`;

// MediaRecorder'ı başlatan ve chunk'ları Node'a ileten kod.
const START_RECORDER = `(function () {
  var dest = window.__whisperAudioDest;
  if (!dest) { console.error('[whisper] no audio dest — init script did not run'); return; }

  var mimeTypes = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
    'audio/ogg',
  ];
  var mimeType = '';
  for (var i = 0; i < mimeTypes.length; i++) {
    if (MediaRecorder.isTypeSupported(mimeTypes[i])) { mimeType = mimeTypes[i]; break; }
  }

  var opts = mimeType ? { mimeType: mimeType } : {};
  var recorder = new MediaRecorder(dest.stream, opts);

  recorder.ondataavailable = async function (e) {
    if (!e.data || e.data.size === 0) return;
    try {
      var buf   = await e.data.arrayBuffer();
      var bytes = new Uint8Array(buf);
      var b64   = '';
      var CHUNK = 8192;
      for (var i = 0; i < bytes.length; i += CHUNK) {
        b64 += String.fromCharCode.apply(null, bytes.slice(i, i + CHUNK));
      }
      window.__onAudioChunk(btoa(b64));
    } catch (err) {
      console.error('[whisper] chunk encode error:', err);
    }
  };

  recorder.onerror = function (e) {
    console.error('[whisper] recorder error:', e.error);
  };

  recorder.start(3000); // 3 saniyelik parçalar
  window.__whisperRecorder = recorder;
  console.log('[whisper] recording started, mimeType=' + recorder.mimeType);
})();`;

export class WhisperTranscriber extends BaseTranscriber {
  private openai: OpenAI;
  private audioChunks: Buffer[] = [];
  private tmpFile: string;
  private recordingStarted = false;

  constructor(openaiApiKey: string, baseURL?: string) {
    super();
    this.openai = new OpenAI({ apiKey: openaiApiKey, ...(baseURL ? { baseURL } : {}) });
    this.tmpFile = path.join(os.tmpdir(), `meet-audio-${Date.now()}.webm`);
  }

  // ── Erken setup: navigate edilmeden önce çağrılmalı ──

  async prepare(page: Page): Promise<void> {
    // Chunk'ları Node.js'e iletecek fonksiyonu expose et
    try {
      await page.exposeFunction('__onAudioChunk', (base64: string) => {
        const buf = Buffer.from(base64, 'base64');
        this.audioChunks.push(buf);
        debug(M, `chunk received: ${buf.length} bytes (total ${this.totalBytes()} bytes)`);
      });
    } catch { /* zaten expose edilmiş */ }

    // RTCPeerConnection interceptor'ı her sayfa yükünde çalışacak şekilde ekle
    await page.addInitScript(INIT_SCRIPT);

    log(M, 'rtcpeerconnection interceptor registered');
  }

  // ── Kayıt başlat: toplantıya katıldıktan sonra çağrılmalı ──

  async start(page: Page): Promise<void> {
    this.active = true;
    await page.evaluate(START_RECORDER);
    this.recordingStarted = true;
    log(M, 'audio recording started');
  }

  // ── Kayıt durdur → Whisper'a gönder ──

  async stop(): Promise<void> {
    this.active = false;

    if (this.recordingStarted) {
      try {
        // Recorder'ı durdur ve son chunk'ı bekle
        await (this as any)._page?.evaluate?.(`
          if (window.__whisperRecorder && window.__whisperRecorder.state !== 'inactive') {
            window.__whisperRecorder.stop();
          }
        `).catch(() => {});
        await new Promise(r => setTimeout(r, 1500));
      } catch { /* page kapanmış olabilir */ }
    }

    log(M, `recording stopped — ${this.audioChunks.length} chunks, ${Math.round(this.totalBytes() / 1024)} KB`);

    if (this.audioChunks.length === 0) {
      warn(M, 'no audio data collected — skipping transcription');
      return;
    }

    await this.transcribeWithWhisper();
  }

  // ── Helpers ──

  private totalBytes(): number {
    return this.audioChunks.reduce((acc, b) => acc + b.length, 0);
  }

  private async transcribeWithWhisper(): Promise<void> {
    const audioBuffer = Buffer.concat(this.audioChunks);
    log(M, `writing audio file: ${this.tmpFile} (${Math.round(audioBuffer.length / 1024)} KB)`);

    await fs.promises.writeFile(this.tmpFile, audioBuffer);

    try {
      log(M, 'sending to whisper api...');

      const response = await this.openai.audio.transcriptions.create({
        file: fs.createReadStream(this.tmpFile) as any,
        model: process.env.WHISPER_MODEL ?? 'whisper-1',
        response_format: 'verbose_json',
        timestamp_granularities: ['segment'],
      });

      const segments = (response as any).segments ?? [];
      log(M, `transcription done — ${segments.length} segments`);

      if (segments.length > 0) {
        const meetingStart = Date.now() - (segments.at(-1)?.end ?? 0) * 1000;

        for (const seg of segments) {
          const startTime = new Date(meetingStart + seg.start * 1000);
          const endTime   = new Date(meetingStart + seg.end   * 1000);
          const text      = (seg.text ?? '').trim();
          if (text) {
            const entry: TranscriptEntry = { speaker: 'Whisper', text, startTime, endTime };
            this.addEntry(entry);
          }
        }
      } else if (response.text?.trim()) {
        const now = new Date();
        const entry: TranscriptEntry = {
          speaker: 'Whisper',
          text: response.text.trim(),
          startTime: now,
          endTime: now,
        };
        this.addEntry(entry);
      }

    } catch (err: any) {
      error(M, `whisper api error: ${err.message}`);
    } finally {
      await fs.promises.unlink(this.tmpFile).catch(() => {});
    }
  }
}
