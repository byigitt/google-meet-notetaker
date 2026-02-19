import { EventEmitter } from 'events';
import { BrowserManager } from './browser';
import { MeetNavigator } from './meet-navigator';
import { BaseTranscriber } from '../transcription/base-transcriber';
import { MeetingSession } from '../session/meeting-session';
import { MeetingResult, MeetingStatus } from '../types';
import { log, error } from '../logger';

const M = 'meet-bot';
const END_CHECK_INTERVAL_MS = 5000;

export class MeetBot extends EventEmitter {
  private browser = new BrowserManager();
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
    this.session = new MeetingSession(meetLink);
    this.wireTranscriberEvents();
  }

  async join(): Promise<void> {
    try {
      this.setStatus('joining');
      log(M, '=== bot starting ===');

      log(M, '[1/7] launching browser...');
      const page = await this.browser.launch();
      this.navigator = new MeetNavigator(page);

      log(M, '[2/7] transcriber prepare (pre-navigation)...');
      await this.transcriber.prepare(page);

      log(M, '[3/7] navigating to meeting...');
      await this.navigator.goToMeeting(this.session.meetLink);

      log(M, '[4/7] checking cookie dialog...');
      await this.navigator.dismissCookieDialog();

      log(M, '[5/7] entering name & disabling media...');
      await this.navigator.enterName(this.botName);
      await this.navigator.turnOffMediaDevices();

      log(M, '[6/7] clicking join button...');
      await this.navigator.clickJoin();

      log(M, '[7/7] waiting to be admitted...');
      this.setStatus('waiting');
      await this.navigator.waitUntilJoined();

      this.setStatus('in-meeting');
      log(M, '=== admitted to meeting ===');

      if (this.transcriber.needsCaptions) {
        await this.navigator.enableCaptions(this.captionLanguage);
      }
      await this.transcriber.start(page);

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
    if (this.navigator) await this.navigator.clickLeave();
    await this.end();
  }

  async end(): Promise<void> {
    if (this.session.status === 'ended') return;
    this.setStatus('ended');

    this.stopEndMonitor();
    await this.transcriber.stop();
    await this.browser.close();

    log(M, 'meeting ended');
    this.emit('ended', this.session.toResult());
  }

  getResult(): MeetingResult {
    return this.session.toResult();
  }

  async getAvailableLanguages(): Promise<string[]> {
    return this.navigator?.getAvailableLanguages() ?? [];
  }

  async changeCaptionLanguage(language: string): Promise<boolean> {
    return this.navigator?.changeCaptionLanguage(language) ?? false;
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

    this.transcriber.on('error', (msg) => this.emit('error', msg));
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
        if (await this.navigator.isMeetingOver()) await this.end();
      } catch {
        await this.end();
      }
    }, END_CHECK_INTERVAL_MS);
  }

  private stopEndMonitor(): void {
    if (this.endCheckTimer) {
      clearInterval(this.endCheckTimer);
      this.endCheckTimer = null;
    }
  }
}
