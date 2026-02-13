// ─── Browser Manager ─────────────────────────────────────
// SRP: Tek sorumluluk → Chrome tarayıcı yaşam döngüsü
// ─────────────────────────────────────────────────────────

import { chromium, type Browser, type BrowserContext, type Page } from 'patchright';

export class BrowserManager {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;

  async launch(): Promise<Page> {
    console.log('🌐 Chrome başlatılıyor…');

    this.browser = await chromium.launch({
      channel: 'chrome',
      headless: false,
      args: [
        '--disable-blink-features=AutomationControlled',
        '--use-fake-ui-for-media-stream',
        '--use-fake-device-for-media-stream',
        '--autoplay-policy=no-user-gesture-required',
        '--disable-notifications',
        '--no-first-run',
        '--no-default-browser-check',
      ],
    });
    console.log('✅ Browser açıldı');

    this.context = await this.browser.newContext({
      permissions: ['camera', 'microphone'],
      viewport: null,
      ignoreHTTPSErrors: true,
    });
    console.log('✅ Context oluşturuldu');

    const page = await this.context.newPage();
    console.log('✅ Sayfa hazır');

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
