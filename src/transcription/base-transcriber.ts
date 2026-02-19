import { EventEmitter } from 'events';
import type { Page } from 'patchright';
import { TranscriptEntry } from '../types';

export abstract class BaseTranscriber extends EventEmitter {
  protected active = false;
  protected entries: TranscriptEntry[] = [];

  get needsCaptions(): boolean { return true; }
  get isActive(): boolean { return this.active; }
  get allEntries(): TranscriptEntry[] { return [...this.entries]; }

  /** Pre-navigation setup (optional) */
  async prepare(page: Page): Promise<void> {
    void page;
  }

  abstract start(page: Page): Promise<void>;
  abstract stop(): Promise<void>;

  protected addEntry(entry: TranscriptEntry): number {
    const index = this.entries.length;
    this.entries.push(entry);
    this.emit('entry', entry);
    return index;
  }

  protected updateEntry(index: number, text: string): void {
    if (index < 0 || index >= this.entries.length) return;
    this.entries[index].text = text;
    this.entries[index].endTime = new Date();
    this.emit('update', index, this.entries[index]);
  }
}
