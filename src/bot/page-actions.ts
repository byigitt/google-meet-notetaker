// ─── Page Actions ────────────────────────────────────────
// SRP: Tek sorumluluk → Patchright sayfa etkileşimleri
// DRY: Tekrar eden selector/click/wait pattern'ları
// ─────────────────────────────────────────────────────────

import type { Page } from 'patchright';
import { log } from '../logger';

const M = 'page-actions';

/** Birden fazla selector dener, ilk bulunanı tıklar */
export async function clickFirstMatch(page: Page, selectors: string[], label: string): Promise<boolean> {
  for (const selector of selectors) {
    try {
      const el = page.locator(selector).first();
      if (await el.isVisible({ timeout: 500 })) {
        await el.click();
        log(M, `clicked: ${label}`);
        return true;
      }
    } catch { /* sonraki selector'ı dene */ }
  }
  return false;
}

/** Sayfada görünür metin içeren butonu tıkla */
export async function clickButtonByText(page: Page, keywords: string[], label: string): Promise<boolean> {
  for (const kw of keywords) {
    try {
      const btn = page.getByRole('button', { name: new RegExp(kw, 'i') }).first();
      if (await btn.isVisible({ timeout: 500 })) {
        await btn.click();
        log(M, `clicked: ${label} (text="${kw}")`);
        return true;
      }
    } catch { /* sonraki keyword'ü dene */ }
  }
  return false;
}

/** Belirli bir koşul gerçekleşene kadar bekle */
export async function waitForCondition(
  page: Page,
  check: () => Promise<boolean>,
  timeoutMs: number,
  intervalMs = 2000,
): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await check()) return true;
    await sleep(intervalMs);
  }
  return false;
}

export function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}
