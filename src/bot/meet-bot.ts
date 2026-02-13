// ─── Meet Bot (Orchestrator) ─────────────────────────────
// SRP: Tek sorumluluk → alt bileşenleri koordine et
// ─────────────────────────────────────────────────────────

import { EventEmitter } from 'events';
import { BrowserManager } from './browser';
import { MeetNavigator } from './meet-navigator';
import { BaseTranscriber } from '../transcription/base-transcriber';
import { MeetingSession } from '../session/meeting-session';
import { MeetingResult, MeetingStatus } from '../types';

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
      console.log('');
      console.log('═══════════════════════════════════════');
      console.log('  BOT BAŞLATILIYOR');
      console.log('═══════════════════════════════════════');

      // 1) Tarayıcı aç
      console.log('\n[1/7] 🌐 Tarayıcı başlatılıyor…');
      const page = await this.browser.launch();
      this.navigator = new MeetNavigator(page);

      // 2) Meet sayfasına git
      console.log('\n[2/7] 🔗 Toplantı sayfasına gidiliyor…');
      await this.navigator.goToMeeting(this.session.meetLink);

      // 3) Çerez dialogu
      console.log('\n[3/7] 🍪 Çerez dialogu kontrol ediliyor…');
      await this.navigator.dismissCookieDialog();

      // 4) İsim gir, medya kapat
      console.log('\n[4/7] 📝 İsim & medya ayarları…');
      await this.navigator.enterName(this.botName);
      await this.navigator.turnOffMediaDevices();

      // 5) Katıl
      console.log('\n[5/7] 🚪 Katılma butonu tıklanıyor…');
      await this.navigator.clickJoin();

      // 6) Kabul edilmeyi bekle
      console.log('\n[6/7] ⏳ Toplantıya kabul bekleniyor…');
      this.setStatus('waiting');
      await this.navigator.waitUntilJoined();

      // 7) Toplantıdayız!
      this.setStatus('in-meeting');
      console.log('\n[7/7] ✅ Toplantıya katıldım!');
      console.log('═══════════════════════════════════════\n');

      // Altyazı aç + dil seç + transkripsiyon başlat
      await this.navigator.enableCaptions(this.captionLanguage);
      await this.transcriber.start(page);

      // Toplantı bitişini izle
      this.startEndMonitor();

    } catch (err: any) {
      console.error('\n❌ BOT HATASI:', err.message);
      console.error('Stack:', err.stack);
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
    console.log('👋 Toplantı sona erdi');

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
        // Popup dialog'ları otomatik kapat
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
