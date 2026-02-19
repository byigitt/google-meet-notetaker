import { chromium, type Browser, type BrowserContext, type Page } from 'patchright';
import { log } from '../logger';

const M = 'browser';

const CHROME_ARGS = [
  '--disable-blink-features=AutomationControlled',
  '--use-fake-ui-for-media-stream',
  '--autoplay-policy=no-user-gesture-required',
  '--disable-notifications',
  '--no-first-run',
  '--no-default-browser-check',
];

export class BrowserManager {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;

  async launch(): Promise<Page> {
    log(M, 'launching chrome...');

    this.browser = await chromium.launch({
      channel: 'chrome',
      headless: false,
      args: CHROME_ARGS,
    });

    this.context = await this.browser.newContext({
      permissions: ['camera', 'microphone'],
      viewport: null,
      ignoreHTTPSErrors: true,
    });

    const page = await this.context.newPage();
    log(M, 'browser ready');
    return page;
  }

  async close(): Promise<void> {
    try { await this.context?.close(); } catch {}
    try { await this.browser?.close(); } catch {}
    this.context = null;
    this.browser = null;
  }

  get isOpen(): boolean {
    return this.browser?.isConnected() ?? false;
  }
}
