// Whisper Transcriber — patches RTCPeerConnection & HTMLMediaElement to
// capture incoming audio tracks, records via MediaRecorder, then sends
// the resulting file to Whisper API for transcription.

import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn, execSync } from 'child_process';
import OpenAI from 'openai';
import type { Page } from 'patchright';
import { BaseTranscriber } from './base-transcriber';
import { log, warn, error, debug } from '../logger';

const M = 'whisper';

const INIT_SCRIPT = `(function() {
  if (window.__whisperInitDone) return;
  window.__whisperInitDone = true;
  window.__whisperCapture = { tracks: [] };

  /* RTCPeerConnection — capture incoming audio tracks */
  var _OrigPC = window.RTCPeerConnection;
  if (_OrigPC) {
    function PatchedPC() {
      var pc = new (Function.prototype.bind.apply(_OrigPC, [null].concat(Array.prototype.slice.call(arguments))))();
      pc.addEventListener('track', function(e) {
        if (e.track.kind !== 'audio') return;
        window.__whisperCapture.tracks.push(e.track);
        console.log('[whisper-init] RTC audio track captured, total=' + window.__whisperCapture.tracks.length);
      });
      return pc;
    }
    try {
      PatchedPC.prototype = _OrigPC.prototype;
      Object.setPrototypeOf(PatchedPC, _OrigPC);
    } catch(e) {}
    window.RTCPeerConnection = PatchedPC;
  }

  /* HTMLMediaElement.srcObject — capture media element streams */
  var _desc = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'srcObject');
  if (_desc && _desc.set) {
    Object.defineProperty(HTMLMediaElement.prototype, 'srcObject', {
      set: function(val) {
        if (val instanceof MediaStream) {
          val.getAudioTracks().forEach(function(t) {
            if (window.__whisperCapture.tracks.indexOf(t) === -1) {
              window.__whisperCapture.tracks.push(t);
              console.log('[whisper-init] MediaElement audio track captured, total=' + window.__whisperCapture.tracks.length);
            }
          });
        }
        _desc.set.call(this, val);
      },
      get: _desc.get,
      configurable: true,
    });
  }

  console.log('[whisper-init] interceptors installed');
})();`;

const START_RECORDER = `(async function() {
  try {
    var capture = window.__whisperCapture;
    if (!capture) return 'no-capture';

    var ctx = new AudioContext({ sampleRate: 48000 });
    await ctx.resume();
    var dest = ctx.createMediaStreamDestination();
    var connected = 0;

    // 1) Intercepted tracks
    for (var i = 0; i < capture.tracks.length; i++) {
      var track = capture.tracks[i];
      try {
        if (track.readyState === 'ended') continue;
        var src = ctx.createMediaStreamSource(new MediaStream([track]));
        src.connect(dest);
        connected++;
      } catch(e) {
        console.warn('[whisper] track connect failed:', e.message);
      }
    }

    // 2) Audio/video element fallback
    document.querySelectorAll('audio, video').forEach(function(el) {
      try {
        if (!el.srcObject) return;
        el.srcObject.getAudioTracks().forEach(function(t) {
          if (t.readyState === 'ended') return;
          if (capture.tracks.indexOf(t) !== -1) return; // skip duplicates
          var s = ctx.createMediaStreamSource(new MediaStream([t]));
          s.connect(dest);
          connected++;
        });
      } catch(e) {}
    });

    console.log('[whisper-info] sources connected=' + connected);
    if (connected === 0) return 'no-sources';

    var mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus' : 'audio/webm';

    var recorder = new MediaRecorder(dest.stream, mimeType ? { mimeType: mimeType } : {});

    recorder.ondataavailable = async function(e) {
      if (!e.data || e.data.size === 0) return;
      try {
        var buf = await e.data.arrayBuffer();
        var bytes = new Uint8Array(buf);
        var b64 = '';
        var CHUNK = 8192;
        for (var n = 0; n < bytes.length; n += CHUNK) {
          b64 += String.fromCharCode.apply(null, bytes.slice(n, n + CHUNK));
        }
        window.__onAudioChunk(btoa(b64));
      } catch(err) {}
    };

    recorder.start(3000);
    window.__whisperRecorder = recorder;
    return 'ok:' + connected;
  } catch(e) {
    return 'error:' + e.message;
  }
})()`;

function findFfmpeg(): string | null {
  try {
    const cmd = process.platform === 'win32' ? 'where ffmpeg' : 'which ffmpeg';
    return execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
      .trim().split('\n')[0].trim() || null;
  } catch { return null; }
}

async function convertToWav(input: string, output: string, ffmpegBin: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegBin,
      ['-y', '-i', input, '-map', '0:a:0', '-c:a', 'pcm_s16le', '-ar', '16000', '-ac', '1', output],
      { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    proc.stderr?.on('data', (d: Buffer) => { stderr += d.toString(); });
    proc.on('close', code => code === 0 ? resolve() : reject(new Error(`ffmpeg exit ${code}: ${stderr.slice(-200)}`)));
    proc.on('error', reject);
  });
}

export class WhisperTranscriber extends BaseTranscriber {
  private openai: OpenAI;
  private audioChunks: Buffer[] = [];
  private webmFile: string;
  private page: Page | null = null;
  private stopped = false;

  constructor(openaiApiKey: string, baseURL?: string) {
    super();
    this.openai = new OpenAI({ apiKey: openaiApiKey, ...(baseURL ? { baseURL } : {}) });

    const keep = process.env.WHISPER_KEEP_AUDIO === 'true';
    const dir  = keep ? path.resolve(process.cwd(), 'recordings') : os.tmpdir();
    if (keep) fs.mkdirSync(dir, { recursive: true });
    this.webmFile = path.join(dir, `meet-audio-${Date.now()}.webm`);
  }

  override get needsCaptions(): boolean { return false; }

  async prepare(page: Page): Promise<void> {
    this.page = page;

    page.on('console', msg => {
      const text = msg.text();
      if (!text.includes('[whisper')) return;
      if (text.startsWith('[whisper-info]')) {
        log(M, text.replace(/^\[whisper-info\]\s*/, ''));
      } else if (msg.type() === 'error' || msg.type() === 'warning') {
        warn(M, `[browser] ${text}`);
      } else {
        debug(M, `[browser] ${text}`);
      }
    });

    try {
      await page.exposeFunction('__onAudioChunk', (base64: string) => {
        const buf = Buffer.from(base64, 'base64');
        this.audioChunks.push(buf);
        debug(M, `chunk #${this.audioChunks.length}: ${buf.length} bytes (total ${Math.round(this.totalBytes() / 1024)} KB)`);
      });
    } catch { /* already exposed */ }

    await page.addInitScript(INIT_SCRIPT);
    log(M, 'interceptors installed (RTC + MediaElement)');
  }

  async start(page: Page): Promise<void> {
    this.page = page;
    this.active = true;
    this.stopped = false;

    log(M, 'starting audio recorder...');
    const result = await page.evaluate(START_RECORDER).catch(e => `error:${e.message}`);
    const resultStr = String(result);

    if (resultStr.startsWith('ok:')) {
      log(M, `audio recording started (${resultStr.split(':')[1]} sources)`);
    } else {
      warn(M, `recorder issue: ${resultStr}`);
    }
  }

  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    this.active = false;

    if (this.page) {
      try {
        await this.page.evaluate(`(function() {
          var r = window.__whisperRecorder;
          if (!r) return;
          if (r.state === 'recording') r.requestData();
          setTimeout(function() { if (r.state !== 'inactive') r.stop(); }, 500);
        })()`).catch(() => {});
        await new Promise(r => setTimeout(r, 2000));
      } catch { /* page closed */ }
    }

    const sizeKB = Math.round(this.totalBytes() / 1024);
    log(M, `recording stopped — ${this.audioChunks.length} chunks, ${sizeKB} KB`);

    if (this.audioChunks.length === 0 || this.totalBytes() < 1000) {
      warn(M, 'no audio data — skipping transcription');
      return;
    }

    await this.processAndTranscribe();
  }

  private totalBytes(): number {
    return this.audioChunks.reduce((acc, b) => acc + b.length, 0);
  }

  private async processAndTranscribe(): Promise<void> {
    const raw = Buffer.concat(this.audioChunks);
    log(M, `writing raw webm: ${Math.round(raw.length / 1024)} KB → ${this.webmFile}`);
    await fs.promises.writeFile(this.webmFile, raw);

    const ffmpegBin = findFfmpeg();
    let audioFile = this.webmFile;

    if (ffmpegBin) {
      const wavFile = this.webmFile.replace('.webm', '.wav');
      try {
        await convertToWav(this.webmFile, wavFile, ffmpegBin);
        const kb = Math.round((await fs.promises.stat(wavFile)).size / 1024);
        log(M, `converted to clean WAV: ${kb} KB`);
        audioFile = wavFile;
        if (process.env.WHISPER_KEEP_AUDIO !== 'true') {
          await fs.promises.unlink(this.webmFile).catch(() => {});
        }
      } catch (err: any) {
        warn(M, `ffmpeg conversion failed: ${err.message} — using raw webm`);
      }
    } else {
      warn(M, 'ffmpeg not found — sending raw webm');
    }

    await this.transcribeFile(audioFile);
  }

  private async transcribeFile(audioFile: string): Promise<void> {
    const model = process.env.WHISPER_MODEL ?? 'whisper-large-v3';
    try {
      log(M, `sending to ${model} (${path.basename(audioFile)})...`);
      const response = await this.openai.audio.transcriptions.create({
        file:                    fs.createReadStream(audioFile) as any,
        model,
        response_format:         'verbose_json',
        timestamp_granularities: ['segment'],
      });

      const segments = (response as any).segments ?? [];
      log(M, `transcription done — ${segments.length} segments`);

      if (segments.length > 0) {
        const meetingStart = Date.now() - (segments.at(-1)?.end ?? 0) * 1000;
        for (const seg of segments) {
          const text = (seg.text ?? '').trim();
          if (!text) continue;
          this.addEntry({
            speaker:   'Whisper',
            text,
            startTime: new Date(meetingStart + seg.start * 1000),
            endTime:   new Date(meetingStart + seg.end * 1000),
          });
        }
      } else if (response.text?.trim()) {
        const now = new Date();
        this.addEntry({ speaker: 'Whisper', text: response.text.trim(), startTime: now, endTime: now });
      }
    } catch (err: any) {
      error(M, `api error: ${err.message}`);
    } finally {
      if (process.env.WHISPER_KEEP_AUDIO === 'true') {
        log(M, `files kept in: ${path.dirname(audioFile)}`);
      } else {
        await fs.promises.unlink(audioFile).catch(() => {});
      }
    }
  }
}
