// ─── Base Transcriber ────────────────────────────────────
// SRP: Tek sorumluluk → transkripsiyon arayüzü tanımı
// DRY: Tüm transcriber'lar bu abstract sınıfı extend eder
// ─────────────────────────────────────────────────────────

import { EventEmitter } from 'events';
import type { Page } from 'patchright';
import { TranscriptEntry } from '../types';

/**
 * Tüm transkripsiyon stratejileri bu abstract sınıfı extend eder.
 * Strategy Pattern: farklı stratejiler aynı interface ile çalışır.
 */
export abstract class BaseTranscriber extends EventEmitter {
  protected active = false;
  protected entries: TranscriptEntry[] = [];

  abstract start(page: Page): Promise<void>;
  abstract stop(): Promise<void>;

  get isActive(): boolean {
    return this.active;
  }

  get allEntries(): TranscriptEntry[] {
    return [...this.entries];
  }

  /** Yeni giriş ekle ve event yay */
  protected addEntry(entry: TranscriptEntry): number {
    const index = this.entries.length;
    this.entries.push(entry);
    this.emit('entry', entry);
    return index;
  }

  /** Mevcut girişi güncelle */
  protected updateEntry(index: number, text: string): void {
    if (index < 0 || index >= this.entries.length) return;
    this.entries[index].text = text;
    this.entries[index].endTime = new Date();
    this.emit('update', index, this.entries[index]);
  }
}
