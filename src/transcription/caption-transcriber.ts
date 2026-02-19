// ─── Caption Transcriber ─────────────────────────────────
// SRP: Tek sorumluluk → Google Meet altyazılarını scrape et
// Strategy: BaseTranscriber'ın "captions" implementasyonu
// ─────────────────────────────────────────────────────────

import type { Page } from 'patchright';
import { BaseTranscriber } from './base-transcriber';
import { TranscriptEntry } from '../types';
import { log, debug } from '../logger';

const M = 'caption';

export class CaptionTranscriber extends BaseTranscriber {
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private lastSpeakerText = new Map<string, { text: string; index: number }>();
  private debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
  /** Son görülen text — debounce'dan bağımsız, polling duplicate'lerini engeller */
  private lastSeenText = new Map<string, string>();

  async start(page: Page): Promise<void> {
    this.active = true;

    // Sayfa içine callback expose et
    try {
      await page.exposeFunction('__onCaption', (speaker: string, text: string) => {
        this.handleCaption(speaker, text);
      });
    } catch { /* zaten expose edilmiş olabilir */ }

    // MutationObserver enjekte et
    await this.injectCaptionObserver(page);

    // Yedek: Polling ile de kontrol et
    this.startPolling(page);

    log(M, 'transcriber started');
  }

  async stop(): Promise<void> {
    this.active = false;
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.debounceTimers.forEach(t => clearTimeout(t));
    this.debounceTimers.clear();
    this.lastSeenText.clear();
    this.lastSpeakerText.clear();
    log(M, 'transcriber stopped');
  }

  // ── Altyazı observer'ı enjekte et ──
  //
  // Google Meet caption DOM yapısı:
  //   <div role="region" aria-label="Captions" jscontroller="KPn5nb">
  //     <div class="nMcdL ...">                     ← caption entry
  //       <div class="adE6rb">                      ← speaker satırı
  //         <span class="NWpY1d">Speaker Name</span>
  //       </div>
  //       <div class="ygicle VbkSUe">caption text</div>  ← metin
  //     </div>
  //   </div>

  private async injectCaptionObserver(page: Page): Promise<void> {
    await page.evaluate(`(function() {
      var seen = new Set();

      var findCaptionContainer = function() {
        var region = document.querySelector('[role="region"][aria-label="Captions"]');
        if (region) return region;
        var jsnamed = document.querySelector('div[jsname="dsyhDe"]');
        if (jsnamed) return jsnamed;
        return null;
      };

      var scrapeCaptions = function() {
        var container = findCaptionContainer();
        if (!container) return [];

        var results = [];

        var speakerEls = container.querySelectorAll('.NWpY1d');
        var textEls = container.querySelectorAll('.ygicle');

        if (speakerEls.length > 0 && textEls.length > 0) {
          var count = Math.min(speakerEls.length, textEls.length);
          for (var i = 0; i < count; i++) {
            var speaker = (speakerEls[i].textContent || '').trim();
            var text = (textEls[i].textContent || '').trim();
            if (speaker && text && text.length >= 1) {
              results.push({ speaker: speaker, text: text });
            }
          }
          return results;
        }

        var entries = container.querySelectorAll('div');
        for (var ei = 0; ei < entries.length; ei++) {
          var entry = entries[ei];
          var children = entry.children;
          if (children.length < 2) continue;

          var speakerSpan = entry.querySelector('span');
          var lastChild = children[children.length - 1];

          if (!speakerSpan || !lastChild) continue;

          var spk = (speakerSpan.textContent || '').trim();
          var txt = (lastChild.textContent || '').trim();

          if (spk && txt && txt.length >= 1 && spk !== txt && txt.indexOf(spk) === -1) {
            var dup = false;
            for (var ri = 0; ri < results.length; ri++) {
              if (results[ri].speaker === spk && results[ri].text === txt) { dup = true; break; }
            }
            if (!dup) results.push({ speaker: spk, text: txt });
          }
        }

        return results;
      };

      var observer = new MutationObserver(function() {
        var captions = scrapeCaptions();

        for (var i = 0; i < captions.length; i++) {
          var speaker = captions[i].speaker;
          var text = captions[i].text;
          var key = speaker + '::' + text;
          if (seen.has(key)) continue;
          seen.add(key);

          if (seen.size > 500) {
            var arr = Array.from(seen);
            arr.splice(0, 250);
            seen.clear();
            for (var j = 0; j < arr.length; j++) seen.add(arr[j]);
          }

          window.__onCaption(speaker, text);
        }
      });

      observer.observe(document.body, {
        childList: true,
        subtree: true,
        characterData: true
      });
    })()`);
  }

  // ── Polling (yedek mekanizma) ──

  private startPolling(page: Page): void {
    let pollCount = 0;

    this.pollTimer = setInterval(async () => {
      if (!this.active) {
        if (this.pollTimer) clearInterval(this.pollTimer);
        return;
      }

      try {
        const captions = await page.evaluate(`(function() {
          var results = [];
          var container = document.querySelector('[role="region"][aria-label="Captions"]')
                       || document.querySelector('div[jsname="dsyhDe"]');
          if (!container) return results;

          var speakerEls = container.querySelectorAll('.NWpY1d');
          var textEls = container.querySelectorAll('.ygicle');

          var count = Math.min(speakerEls.length, textEls.length);
          for (var i = 0; i < count; i++) {
            var speaker = (speakerEls[i].textContent || '').trim();
            var text = (textEls[i].textContent || '').trim();
            if (speaker && text && text.length >= 1) {
              results.push({ speaker: speaker, text: text });
            }
          }
          return results;
        })()`);

        pollCount++;
        if (pollCount <= 20 && pollCount % 5 === 0) {
          debug(M, `poll #${pollCount}: ${(captions as any[]).length} captions`);
        }

        for (const c of captions as { speaker: string; text: string }[]) {
          this.handleCaption(c.speaker, c.text);
        }
      } catch { /* sayfa kapanmış olabilir */ }
    }, 1500);
  }

  // ── Caption işleme ──

  private handleCaption(speaker: string, text: string): void {
    // Tam aynı text → atla (polling duplicate koruması)
    const seen = this.lastSeenText.get(speaker);
    if (seen === text) return;
    this.lastSeenText.set(speaker, text);

    const last = this.lastSpeakerText.get(speaker);

    if (last) {
      // Speaker hâlâ aktif → mevcut entry'yi güncelle
      this.updateEntry(last.index, text);
      this.lastSpeakerText.set(speaker, { text, index: last.index });
    } else {
      // Yeni cümle (speaker ilk kez veya debounce sonrası)
      const now = new Date();
      const entry: TranscriptEntry = { speaker, text, startTime: now, endTime: now };
      const index = this.addEntry(entry);
      this.lastSpeakerText.set(speaker, { text, index });
    }

    // Debounce: speaker sustu → sonraki konuşması yeni entry olsun
    const existing = this.debounceTimers.get(speaker);
    if (existing) clearTimeout(existing);

    this.debounceTimers.set(speaker, setTimeout(() => {
      this.lastSpeakerText.delete(speaker);
      this.debounceTimers.delete(speaker);
    }, 5000));
  }
}
