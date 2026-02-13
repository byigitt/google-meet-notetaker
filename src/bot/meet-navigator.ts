// ─── Meet Navigator ──────────────────────────────────────
// SRP: Tek sorumluluk → Google Meet sayfasında navigasyon
// ─────────────────────────────────────────────────────────

import type { Page } from 'patchright';
import { clickFirstMatch, clickButtonByText, waitForCondition, sleep } from './page-actions';

// ── Selector grupları (DRY: tek yerde tanımlı) ──

const SEL = {
  nameInput: [
    'input[placeholder="Your name"]', 'input[placeholder="Adınız"]',
    'input[aria-label="Your name"]', 'input[aria-label="Adınız"]',
  ],
  micOff: [
    '[data-is-muted="false"][aria-label*="microphone" i]',
    '[data-is-muted="false"][aria-label*="mikrofon" i]',
    '[aria-label*="Turn off microphone" i]',
    '[aria-label*="Mikrofonu kapat" i]',
  ],
  cameraOff: [
    '[data-is-muted="false"][aria-label*="camera" i]',
    '[data-is-muted="false"][aria-label*="kamera" i]',
    '[aria-label*="Turn off camera" i]',
    '[aria-label*="Kamerayı kapat" i]',
  ],
  joinButton: [
    'button[jsname="Qx7uuf"]',
    '[aria-label="Ask to join"]', '[aria-label="Katılma isteği gönder"]',
    '[aria-label="Join now"]', '[aria-label="Şimdi katıl"]',
  ],
  leave: [
    '[aria-label*="Leave" i]', '[aria-label*="Ayrıl" i]',
  ],
} as const;

const JOIN_KEYWORDS = ['join now', 'ask to join', 'şimdi katıl', 'katılma isteği'];
const REJECT_PATTERNS = ['denied', 'reddedildi', "can't join", 'katılamıyorsunuz'];
const WAITING_PATTERNS = [
  'please wait until',
  'waiting to be let in',
  'ask someone to let you in',
  'toplantı sahibi sizi',
  'bekleme odasındasınız',
  'katılmanıza izin ver',
];

export class MeetNavigator {
  constructor(private page: Page) {}

  async goToMeeting(link: string): Promise<void> {
    console.log(`🔗 Sayfaya gidiliyor: ${link}`);
    await this.page.goto(link, { waitUntil: 'domcontentloaded', timeout: 30000 });
    console.log('✅ Sayfa yüklendi, 3sn bekleniyor…');
    await sleep(3000);
    console.log(`📍 Mevcut URL: ${this.page.url()}`);
  }

  async dismissCookieDialog(): Promise<void> {
    try {
      const btn = this.page.getByRole('button', { name: /accept|kabul/i }).first();
      if (await btn.isVisible({ timeout: 2000 })) {
        await btn.click();
        console.log('🍪 Çerez dialogu kapatıldı');
        await sleep(1000);
      }
    } catch { /* dialog yoksa sorun değil */ }
  }

  async enterName(name: string): Promise<void> {
    for (const sel of SEL.nameInput) {
      try {
        const input = this.page.locator(sel).first();
        if (await input.isVisible({ timeout: 1000 })) {
          await input.click({ clickCount: 3 });
          await input.fill(name);
          console.log(`📝 İsim girildi: ${name}`);
          return;
        }
      } catch { continue; }
    }
    console.log('ℹ️  İsim girişi bulunamadı (hesapla giriş yapılmış olabilir)');
  }

  async turnOffMediaDevices(): Promise<void> {
    const micOff = await clickFirstMatch(this.page, [...SEL.micOff], '🔇 Mikrofon');
    if (micOff) await sleep(300);
    const camOff = await clickFirstMatch(this.page, [...SEL.cameraOff], '📷 Kamera');
    if (camOff) await sleep(300);
  }

  async clickJoin(): Promise<void> {
    console.log('🔍 Katıl butonu aranıyor…');
    const clicked =
      await clickFirstMatch(this.page, [...SEL.joinButton], '🚪 Katıl butonu') ||
      await clickButtonByText(this.page, JOIN_KEYWORDS, '🚪 Katıl butonu');

    if (!clicked) {
      console.log('⚠️  Katıl butonu bulunamadı — sayfadaki butonları listeliyorum:');
      await this.debugListButtons();
    }
  }

  async waitUntilJoined(timeoutMs = 120_000): Promise<void> {
    console.log('⏳ Toplantıya kabul bekleniyor…');

    const joined = await waitForCondition(
      this.page,
      async () => {
        const bodyText = await this.page.locator('body').innerText().catch(() => '');
        const lower = bodyText.toLowerCase();

        // Reddedilme kontrolü
        if (REJECT_PATTERNS.some(p => lower.includes(p))) {
          throw new Error('Toplantıya katılma isteği reddedildi');
        }

        // Hâlâ bekleme odasındaysa → henüz katılmamış
        if (WAITING_PATTERNS.some(p => lower.includes(p))) {
          return false;
        }

        // Leave butonu var VE bekleme metni yok → gerçekten toplantıdayız
        for (const sel of [...SEL.leave]) {
          try {
            if (await this.page.locator(sel).first().isVisible({ timeout: 300 })) {
              return true;
            }
          } catch { continue; }
        }
        return false;
      },
      timeoutMs,
    );

    if (!joined) throw new Error('Toplantıya katılma zaman aşımı');
  }

  // ── Popup dialog'ları kapat ──

  async dismissPopups(): Promise<void> {
    try {
      // Google Meet'in çeşitli bilgi popup'ları:
      // "Others may see your video differently" → "Got it"
      // "Use a phone for audio" → "Dismiss" / "Not now"
      // vs.
      const dismissed = await this.page.evaluate(() => {
        var closed: string[] = [];
        var dialogs = document.querySelectorAll('[role="dialog"], [role="alertdialog"]');
        for (var i = 0; i < dialogs.length; i++) {
          var dialog = dialogs[i];
          var buttons = dialog.querySelectorAll('button');
          for (var j = 0; j < buttons.length; j++) {
            var btn = buttons[j];
            var text = (btn.textContent || '').trim().toLowerCase();
            if (text === 'got it' || text === 'ok' || text === 'dismiss' ||
                text === 'anladım' || text === 'tamam' || text === 'kapat' ||
                text === 'not now' || text === 'şimdi değil') {
              (btn as HTMLButtonElement).click();
              closed.push(text);
            }
          }
        }
        return closed;
      });

      if (dismissed.length > 0) {
        console.log(`🔲 Popup kapatıldı: ${dismissed.join(', ')}`);
        await sleep(500);
      }
    } catch { /* sorun değil */ }
  }

  // ── Altyazıları aç + dil seç ──

  async enableCaptions(language?: string): Promise<void> {
    console.log('📝 Altyazılar açılıyor…');
    await sleep(2000);

    // Önce popup dialog'ları kapat
    await this.dismissPopups();

    // Debug: alt toolbar'daki butonları göster
    await this.debugBottomToolbar();

    let opened = false;

    // Yöntem 1: evaluate ile icon text'ten caption butonunu bul ve tıkla
    if (!opened) {
      try {
        const clicked = await this.page.evaluate(() => {
          const buttons = document.querySelectorAll('button');
          for (const btn of buttons) {
            const icons = btn.querySelectorAll('i, span.google-symbols, span.material-icons-extended');
            for (const icon of icons) {
              const iconText = icon.textContent?.trim() || '';
              if (iconText === 'closed_caption' || iconText === 'closed_caption_off') {
                (btn as HTMLButtonElement).click();
                return iconText;
              }
            }
            // Bazı Meet versiyonlarında aria-label ile
            const label = (btn.getAttribute('aria-label') || '').toLowerCase();
            if (
              (label.includes('caption') || label.includes('altyazı')) &&
              !label.includes('turn off') && !label.includes('kapat')
            ) {
              (btn as HTMLButtonElement).click();
              return label;
            }
          }
          return null;
        });

        if (clicked) {
          opened = true;
          console.log(`✅ Altyazı butonu tıklandı (evaluate: ${clicked})`);
        }
      } catch { /* sonraki yöntemi dene */ }
    }

    // Yöntem 2: aria-label tabanlı selector'lar
    if (!opened) {
      const ariaSelectors = [
        'button[aria-label*="Turn on captions" i]',
        'button[aria-label*="Altyazıları aç" i]',
        'button[aria-label*="captions" i]',
        'button[aria-label*="altyazı" i]',
        'button[aria-label*="subtitle" i]',
        'button[data-tooltip*="caption" i]',
        'button[data-tooltip*="altyazı" i]',
      ];
      opened = await clickFirstMatch(this.page, ariaSelectors, '📝 Altyazı butonu');
    }

    // Yöntem 3: "More options" menüsü üzerinden caption aç
    if (!opened) {
      opened = await this.enableCaptionsThroughMoreOptions();
    }

    // Yöntem 4: Klavye kısayolu 'c'
    if (!opened) {
      console.log('⌨️  Altyazı butonu bulunamadı, c kısayolunu deniyorum…');
      // Önce focus'u video alanına taşı (chat input'taysa 'c' çalışmaz)
      await this.page.evaluate(() => {
        const videoArea = document.querySelector('[data-self-name], [data-participant-id], [data-requested-participant-id]');
        if (videoArea) (videoArea as HTMLElement).click();
      }).catch(() => {});
      await sleep(300);
      await this.page.keyboard.press('c');
      console.log('📝 c kısayolu gönderildi');
    }

    await sleep(2000);

    // Doğrulama: Altyazılar gerçekten açık mı?
    const verified = await this.verifyCaptionsEnabled();
    if (verified) {
      console.log('✅ Altyazılar aktif olduğu doğrulandı');
    } else {
      console.log('⚠️  Altyazılar doğrulanamadı, tekrar c deneniyor…');
      await this.page.keyboard.press('c');
      await sleep(2000);
      const retry = await this.verifyCaptionsEnabled();
      if (retry) {
        console.log('✅ Altyazılar aktif (2. deneme)');
      } else {
        console.log('⚠️  Altyazılar açılamıyor olabilir — caption observer yine de başlatılacak');
      }
    }

    // Dil seçimi
    if (language) {
      await this.selectCaptionLanguage(language);
    }
  }

  // ── Altyazıların açık olup olmadığını doğrula ──

  private async verifyCaptionsEnabled(): Promise<boolean> {
    try {
      // 1) "Turn off captions" veya "Altyazıları kapat" butonu var mı?
      const offSelectors = [
        'button[aria-label*="Turn off captions" i]',
        'button[aria-label*="Altyazıları kapat" i]',
      ];
      for (const sel of offSelectors) {
        try {
          if (await this.page.locator(sel).first().isVisible({ timeout: 800 })) return true;
        } catch { continue; }
      }

      // 2) evaluate: icon text'i "closed_caption" (açık) mı yoksa "closed_caption_off" (kapalı) mı?
      const iconState = await this.page.evaluate(() => {
        const buttons = document.querySelectorAll('button');
        for (const btn of buttons) {
          const icons = btn.querySelectorAll('i, span.google-symbols, span.material-icons-extended');
          for (const icon of icons) {
            const t = icon.textContent?.trim() || '';
            if (t === 'closed_caption') return 'on'; // icon "closed_caption" = captions açık
            if (t === 'closed_caption_off') return 'off';
          }
        }
        return 'unknown';
      });

      if (iconState === 'on') return true;
      if (iconState === 'off') return false;

      // 3) Ekranın alt kısmında caption container var mı?
      return await this.page.evaluate(() => {
        const allDivs = document.querySelectorAll('div[jscontroller]');
        for (const div of allDivs) {
          const rect = div.getBoundingClientRect();
          if (rect.bottom > window.innerHeight * 0.7 && rect.height > 20 && rect.height < 200) {
            const spans = div.querySelectorAll('span');
            if (spans.length >= 1) return true;
          }
        }
        return false;
      });
    } catch {
      return false;
    }
  }

  // ── "More options" menüsünden caption aç ──

  private async enableCaptionsThroughMoreOptions(): Promise<boolean> {
    try {
      console.log('📋 More options menüsünden altyazı açılmaya çalışılıyor…');

      const moreClicked = await this.clickMoreOptions();
      if (!moreClicked) return false;
      await sleep(1000);

      // Menüde "captions" / "altyazı" öğesini bul ve tıkla
      const captionKeywords = ['captions', 'caption', 'altyazı', 'subtitle', 'closed caption'];
      for (const kw of captionKeywords) {
        try {
          const item = this.page.locator('[role="menuitem"], [role="menuitemcheckbox"], li').filter({
            hasText: new RegExp(kw, 'i'),
          }).first();
          if (await item.isVisible({ timeout: 800 })) {
            await item.click();
            console.log(`✅ Altyazılar menüden açıldı ("${kw}")`);
            return true;
          }
        } catch { continue; }
      }

      // Menüyü kapat
      await this.page.keyboard.press('Escape');
      return false;
    } catch {
      return false;
    }
  }

  // ── Caption dil seçimi ──

  async selectCaptionLanguage(language: string): Promise<void> {
    console.log(`🌐 Altyazı dili seçiliyor: "${language}"…`);

    // Yöntem 1 (Ana): More Options → direkt dil listesinden seç
    // Google Meet'in güncel versiyonunda More Options açıldığında
    // caption dil listesi (role="option") doğrudan gösteriliyor
    const directPick = await this.selectLanguageViaMoreOptions(language);
    if (directPick) return;

    // Yöntem 2: Caption alanında "Change language" linki
    const quickPick = await this.tryQuickLanguageChange(language);
    if (quickPick) return;

    // Yöntem 3: Settings dialog üzerinden (eski Meet versiyonları)
    const settingsPick = await this.changeLanguageThroughSettings(language);
    if (settingsPick) return;

    console.log(`⚠️  "${language}" dili ayarlanamadı — varsayılan dil kullanılacak`);
  }

  // ── More Options → Direkt dil listesinden seçim (güncel Meet UI) ──

  private async selectLanguageViaMoreOptions(language: string): Promise<boolean> {
    try {
      console.log('🔍 More Options üzerinden dil seçimi deneniyor…');

      // "More options" butonunu tıkla
      const moreClicked = await this.clickMoreOptions();
      if (!moreClicked) return false;

      await sleep(1000);

      // Direkt olarak dil listesinden (role="option") seç
      // Google Meet'te "Turkish (Turkey)" şeklinde gösteriliyor
      const picked = await this.pickLanguageFromVisibleList(language);
      if (picked) return true;

      // Bulamadıysa menüyü kapat
      await this.page.keyboard.press('Escape');
      return false;
    } catch {
      await this.page.keyboard.press('Escape').catch(() => {});
      return false;
    }
  }

  // ── Caption alanındaki hızlı dil değiştirme linki ──

  private async tryQuickLanguageChange(language: string): Promise<boolean> {
    try {
      const langLinks = [
        'button:has-text("Change language")', 'button:has-text("Dili değiştir")',
        'a:has-text("Change language")', 'a:has-text("Dili değiştir")',
        '[data-language-selector]',
      ];

      for (const sel of langLinks) {
        try {
          const el = this.page.locator(sel).first();
          if (await el.isVisible({ timeout: 1000 })) {
            await el.click();
            console.log('✅ Dil değiştirme linki tıklandı');
            await sleep(1000);
            return await this.pickLanguageFromVisibleList(language);
          }
        } catch { continue; }
      }
      return false;
    } catch {
      return false;
    }
  }

  // ── Settings dialog üzerinden dil değiştirme (eski Meet versiyonları) ──

  private async changeLanguageThroughSettings(language: string): Promise<boolean> {
    try {
      console.log('⚙️  Settings üzerinden dil değiştiriliyor…');

      const moreClicked = await this.clickMoreOptions();
      if (!moreClicked) return false;
      await sleep(1000);

      // Menüde "Settings" / "Ayarlar" tıkla
      let settingsFound = false;
      for (const kw of ['Settings', 'Ayarlar', 'settings', 'ayarlar']) {
        try {
          const item = this.page.locator('[role="menuitem"], li').filter({
            hasText: new RegExp(kw, 'i'),
          }).first();
          if (await item.isVisible({ timeout: 800 })) {
            await item.click();
            settingsFound = true;
            console.log(`✅ "${kw}" tıklandı`);
            break;
          }
        } catch { continue; }
      }

      if (!settingsFound) {
        await this.page.keyboard.press('Escape');
        return false;
      }

      await sleep(1500);

      // Settings dialog'unda "Captions" sekmesi
      for (const kw of ['Captions', 'Altyazı', 'Altyazılar', 'Subtitles']) {
        try {
          const tab = this.page.locator('[role="tab"], [role="listitem"], nav a, nav button, div[role="button"]').filter({
            hasText: new RegExp(kw, 'i'),
          }).first();
          if (await tab.isVisible({ timeout: 800 })) {
            await tab.click();
            console.log(`✅ "${kw}" sekmesi tıklandı`);
            await sleep(800);
            break;
          }
        } catch { continue; }
      }

      // Dialog'da dil seç (select, listbox, dropdown)
      const langSelected = await this.selectLanguageInDialog(language);

      // Dialog'u kapat
      await sleep(300);
      const closeBtn = this.page.locator('button[aria-label="Close"], button[aria-label="Kapat"]').first();
      if (await closeBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
        await closeBtn.click();
      } else {
        await this.page.keyboard.press('Escape');
      }

      return langSelected;
    } catch (e: any) {
      console.log(`⚠️  Settings dil seçimi başarısız: ${e.message}`);
      await this.page.keyboard.press('Escape').catch(() => {});
      return false;
    }
  }

  // ── Dialog'dan dil seçimi (select/dropdown) ──

  private async selectLanguageInDialog(language: string): Promise<boolean> {
    // 1) <select> elementi
    try {
      const selects = this.page.locator('select');
      const selectCount = await selects.count();
      for (let i = 0; i < selectCount; i++) {
        const sel = selects.nth(i);
        const options = await sel.locator('option').allInnerTexts();
        const match = options.find(o => o.toLowerCase().includes(language.toLowerCase()));
        if (match) {
          await sel.selectOption({ label: match });
          console.log(`✅ Dil seçildi (select): ${match}`);
          return true;
        }
      }
    } catch { /* next */ }

    // 2) Custom dropdown
    try {
      const triggers = this.page.locator('[aria-haspopup="listbox"], [aria-haspopup="true"], [aria-expanded]');
      const trigCount = await triggers.count();
      for (let i = 0; i < trigCount; i++) {
        await triggers.nth(i).click();
        await sleep(500);
        if (await this.pickLanguageFromVisibleList(language)) return true;
        await this.page.keyboard.press('Escape').catch(() => {});
        await sleep(300);
      }
    } catch { /* next */ }

    // 3) Doğrudan visible list
    return await this.pickLanguageFromVisibleList(language);
  }

  // ── More Options butonunu tıkla (ortak helper) ──

  private async clickMoreOptions(): Promise<boolean> {
    // Tek yöntem: evaluate ile doğrudan tıkla (en güvenilir)
    const clicked = await this.page.evaluate(() => {
      const buttons = document.querySelectorAll('button');
      for (const btn of buttons) {
        const label = (btn.getAttribute('aria-label') || '').toLowerCase();
        if (label.includes('more option') || label.includes('diğer seçenek') || label.includes('daha fazla')) {
          (btn as HTMLButtonElement).click();
          return 'aria';
        }
      }
      // fallback: icon text
      for (const btn of buttons) {
        const icons = btn.querySelectorAll('i, span.google-symbols');
        for (const icon of icons) {
          if (icon.textContent?.trim() === 'more_vert') {
            (btn as HTMLButtonElement).click();
            return 'icon';
          }
        }
      }
      return null;
    });

    if (clicked) {
      console.log(`✅ ⚙️ More options tıklandı (${clicked})`);
      return true;
    }
    return false;
  }

  // ── Görünür listeden dil seçimi (ortak helper) ──

  private async pickLanguageFromVisibleList(language: string): Promise<boolean> {
    // En güvenilir yöntem: evaluate ile DOM'da bul ve tıkla
    const clicked = await this.page.evaluate((lang: string) => {
      const lower = lang.toLowerCase();
      const selectors = ['[role="option"]', '[role="menuitemradio"]', '[role="menuitem"]'];

      for (const sel of selectors) {
        const items = document.querySelectorAll(sel);
        for (const item of items) {
          const text = item.textContent?.trim() || '';
          if (text.toLowerCase().includes(lower)) {
            // Scroll into view ve tıkla
            item.scrollIntoView({ block: 'center' });
            (item as HTMLElement).click();
            return text;
          }
        }
      }
      return null;
    }, language);

    if (clicked) {
      console.log(`✅ Dil seçildi: "${clicked}"`);
      await sleep(500);
      return true;
    }
    return false;
  }

  // ── Mevcut dilleri çek (More Options panelinden) ──

  async getAvailableLanguages(): Promise<string[]> {
    try {
      const moreClicked = await this.clickMoreOptions();
      if (!moreClicked) return [];

      await sleep(1000);

      // role="option" öğelerini çek, "Default" (boyut ayarı) görene kadar
      const languages = await this.page.evaluate(() => {
        const items = document.querySelectorAll('[role="option"]');
        const langs: string[] = [];
        for (const item of items) {
          const text = item.textContent?.trim() || '';
          // "Default" = boyut/renk ayarlarının başlangıcı → dur
          if (text === 'Default') break;
          if (text.length > 0) langs.push(text);
        }
        return langs;
      });

      // Menüyü kapat
      await this.page.keyboard.press('Escape');
      await sleep(300);

      console.log(`📋 ${languages.length} dil seçeneği bulundu`);
      return languages;
    } catch (e: any) {
      console.log(`⚠️  Dil listesi alınamadı: ${e.message}`);
      await this.page.keyboard.press('Escape').catch(() => {});
      return [];
    }
  }

  // ── Anlık dil değiştirme (web UI'dan çağrılır) ──

  async changeCaptionLanguage(language: string): Promise<boolean> {
    console.log(`🌐 Dil değiştiriliyor: "${language}"…`);
    return await this.selectLanguageViaMoreOptions(language);
  }

  async clickLeave(): Promise<void> {
    await clickFirstMatch(this.page, [...SEL.leave], '👋 Ayrıl');
  }

  async isMeetingOver(): Promise<boolean> {
    try {
      const bodyText = await this.page.locator('body').innerText().catch(() => '');
      const lower = bodyText.toLowerCase();
      const url = this.page.url();

      return (
        lower.includes('you left the meeting') ||
        lower.includes('toplantıdan ayrıldınız') ||
        lower.includes('the meeting has ended') ||
        lower.includes('toplantı sona erdi') ||
        !url.includes('meet.google.com')
      );
    } catch {
      return true;
    }
  }

  // ── Debug ──

  private async debugListButtons(): Promise<void> {
    try {
      const buttons = await this.page.evaluate(() => {
        return Array.from(document.querySelectorAll('button')).map(b => ({
          text: b.textContent?.trim().substring(0, 60),
          ariaLabel: b.getAttribute('aria-label'),
          jsname: b.getAttribute('jsname'),
        }));
      });
      console.log('📋 Sayfadaki butonlar:', JSON.stringify(buttons, null, 2));
    } catch (e: any) {
      console.log('⚠️  Buton listesi alınamadı:', e.message);
    }
  }

  private async debugBottomToolbar(): Promise<void> {
    try {
      const info = await this.page.evaluate(() => {
        const buttons = document.querySelectorAll('button');
        const relevant: any[] = [];
        for (const btn of buttons) {
          const rect = btn.getBoundingClientRect();
          // Alt toolbar genellikle ekranın alt %30'unda
          if (rect.top < window.innerHeight * 0.6) continue;

          const iconEl = btn.querySelector('i, span.google-symbols, span.material-icons-extended');
          const iconText = iconEl?.textContent?.trim() || '';
          relevant.push({
            ariaLabel: btn.getAttribute('aria-label')?.substring(0, 60),
            dataTooltip: btn.getAttribute('data-tooltip')?.substring(0, 60),
            iconText,
            jsname: btn.getAttribute('jsname'),
            visible: btn.offsetParent !== null,
          });
        }
        return relevant;
      });
      console.log('🔍 Alt toolbar butonları:', JSON.stringify(info, null, 2));
    } catch (e: any) {
      console.log('⚠️  Toolbar debug başarısız:', e.message);
    }
  }

  private async debugMenuItems(): Promise<void> {
    try {
      const items = await this.page.evaluate(() => {
        const els = document.querySelectorAll('[role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"], li[role]');
        return Array.from(els).map(el => ({
          text: el.textContent?.trim().substring(0, 60),
          role: el.getAttribute('role'),
        }));
      });
      console.log('📋 Menü öğeleri:', JSON.stringify(items, null, 2));
    } catch (e: any) {
      console.log('⚠️  Menü debug başarısız:', e.message);
    }
  }

  private async debugDialogContent(): Promise<void> {
    try {
      const info = await this.page.evaluate(() => {
        const dialog = document.querySelector('[role="dialog"], [role="alertdialog"], div[data-view-id]');
        if (!dialog) return { found: false, tabs: [] as string[], selects: 0, dropdowns: 0, text: '' };

        const tabs = Array.from(dialog.querySelectorAll('[role="tab"], nav a, nav button'))
          .map(t => t.textContent?.trim() || '');
        const selects = dialog.querySelectorAll('select').length;
        const dropdowns = dialog.querySelectorAll('[aria-haspopup], [aria-expanded]').length;
        const text = dialog.textContent?.substring(0, 300) || '';

        return { found: true, tabs, selects, dropdowns, text };
      });
      console.log('🔍 Dialog:', JSON.stringify(info, null, 2));
    } catch (e: any) {
      console.log('⚠️  Dialog debug başarısız:', e.message);
    }
  }
}
