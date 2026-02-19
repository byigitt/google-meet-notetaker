import type { Page } from 'patchright';
import { log } from '../logger';

const M = 'page-actions';

/** Try multiple selectors, click the first visible one */
export async function clickFirstMatch(page: Page, selectors: string[], label: string): Promise<boolean> {
  for (const selector of selectors) {
    try {
      const el = page.locator(selector).first();
      if (await el.isVisible({ timeout: 500 })) {
        await el.click();
        log(M, `clicked: ${label}`);
        return true;
      }
    } catch { continue; }
  }
  return false;
}

/** Click a button matching any of the given text keywords */
export async function clickButtonByText(page: Page, keywords: string[], label: string): Promise<boolean> {
  for (const kw of keywords) {
    try {
      const btn = page.getByRole('button', { name: new RegExp(kw, 'i') }).first();
      if (await btn.isVisible({ timeout: 500 })) {
        await btn.click();
        log(M, `clicked: ${label} (text="${kw}")`);
        return true;
      }
    } catch { continue; }
  }
  return false;
}

/** Poll until check() returns true or timeout */
export async function waitForCondition(
  page: Page,
  check: () => Promise<boolean>,
  timeoutMs: number,
  intervalMs = 2000,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return true;
    await sleep(intervalMs);
  }
  return false;
}

export function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}
