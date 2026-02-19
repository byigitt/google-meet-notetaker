// ─── Meet Bot (Orchestrator) ─────────────────────────────
// SRP: Tek sorumluluk → alt bileşenleri koordine et
// ─────────────────────────────────────────────────────────

import { EventEmitter } from 'events';
import { BrowserManager } from './browser';
import { MeetNavigator } from './meet-navigator';
import { BaseTranscriber } from '../transcription/base-transcriber';
import { MeetingSession } from '../session/meeting-session';
import { MeetingResult, MeetingStatus } from '../types';
import { log, warn, error } from '../logger';

const M = 'meet-bot';
const MEETING_END_CHECK_MS = 5000;

export class MeetBot extends EventEmitter {
  private browser: BrowserManager;
  private navigator: MeetNavigator | null = null;
  private endCheckTimer: ReturnType<typeof setInterval> | null = null;

  readonly session: MeetingSession;

  constructor(
    meetLink: string,
    private botName: string,
    private captionLanguage: string,
    private transcriber: BaseTranscriber,
  ) {
    super();
    this.browser = new BrowserManager();
    this.session = new MeetingSession(meetLink);
    this.wireTranscriberEvents();
  }

  // ── Public API ──

  async join(): Promise<void> {
    try {
      this.setStatus('joining');
      log(M, '=== bot starting ===');

      // 1) Tarayıcı aç
      log(M, '[1/7] launching browser...');
      const page = await this.browser.launch();
      this.navigator = new MeetNavigator(page);

      // 2) Erken setup (WhisperTranscriber RTCPeerConnection'ı intercept etmeli)
      log(M, '[2/7] transcriber prepare (pre-navigation)...');
      await this.transcriber.prepare(page);

      // 3) Meet sayfasına git
      log(M, '[3/7] navigating to meeting...');
      await this.navigator.goToMeeting(this.session.meetLink);

      // 4) Çerez dialogu
      log(M, '[4/7] checking cookie dialog...');
      await this.navigator.dismissCookieDialog();

      // 5) İsim gir, medya kapat
      log(M, '[5/7] entering name & disabling media...');
      await this.navigator.enterName(this.botName);
      await this.navigator.turnOffMediaDevices();

      // 6) Katıl
      log(M, '[6/7] clicking join button...');
      await this.navigator.clickJoin();

      // 7) Kabul edilmeyi bekle
      log(M, '[7/7] waiting to be admitted...');
      this.setStatus('waiting');
      await this.navigator.waitUntilJoined();

      // Toplantıdayız!
      this.setStatus('in-meeting');
      log(M, '=== admitted to meeting ===');

      // Altyazı aç + dil seç + transkripsiyon başlat
      await this.navigator.enableCaptions(this.captionLanguage);
      await this.transcriber.start(page);

      // Toplantı bitişini izle
      this.startEndMonitor();

    } catch (err: any) {
      error(M, `join failed: ${err.message}`);
      this.session.setError(err.message);
      this.setStatus('error');
      this.emit('error', err.message);
      throw err;
    }
  }

  async leave(): Promise<void> {
    if (this.navigator) {
      await this.navigator.clickLeave();
    }
    await this.end();
  }

  async getAvailableLanguages(): Promise<string[]> {
    if (!this.navigator) return [];
    return this.navigator.getAvailableLanguages();
  }

  async changeCaptionLanguage(language: string): Promise<boolean> {
    if (!this.navigator) return false;
    return this.navigator.changeCaptionLanguage(language);
  }

  async end(): Promise<void> {
    if (this.session.status === 'ended') return;

    await this.transcriber.stop();
    this.stopEndMonitor();
    await this.browser.close();

    this.setStatus('ended');
    log(M, 'meeting ended');

    this.emit('ended', this.session.toResult());
  }

  getResult(): MeetingResult {
    return this.session.toResult();
  }

  // ── Private ──

  private wireTranscriberEvents(): void {
    this.transcriber.on('entry', (entry) => {
      this.session.addTranscriptEntry(entry);
      this.emit('caption', entry);
    });

    this.transcriber.on('update', (index, entry) => {
      this.session.updateTranscriptEntry(index, entry.text);
      this.emit('caption-update', index, entry);
    });

    this.transcriber.on('error', (msg) => {
      this.emit('error', msg);
    });
  }

  private setStatus(status: MeetingStatus): void {
    this.session.setStatus(status);
    this.emit('status', status);
  }

  private startEndMonitor(): void {
    this.endCheckTimer = setInterval(async () => {
      if (!this.navigator) return;
      try {
        await this.navigator.dismissPopups();
        if (await this.navigator.isMeetingOver()) {
          await this.end();
        }
      } catch {
        await this.end();
      }
    }, MEETING_END_CHECK_MS);
  }

  private stopEndMonitor(): void {
    if (this.endCheckTimer) {
      clearInterval(this.endCheckTimer);
      this.endCheckTimer = null;
    }
  }
}
