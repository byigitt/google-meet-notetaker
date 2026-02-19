import { v4 as uuidv4 } from 'uuid';
import { MeetingResult, MeetingStatus, TranscriptEntry, TranscriptSource } from '../types';

export class MeetingSession {
  readonly id = uuidv4();

  private _status: MeetingStatus = 'joining';
  private _startTime?: Date;
  private _endTime?: Date;
  private _transcript: TranscriptEntry[] = [];
  private _participants = new Set<string>();
  private _error?: string;

  constructor(readonly meetLink: string) {}

  get status(): MeetingStatus { return this._status; }
  get startTime(): Date | undefined { return this._startTime; }
  get transcript(): TranscriptEntry[] { return [...this._transcript]; }
  get participants(): string[] { return [...this._participants]; }
  get participantCount(): number { return this._participants.size; }
  get transcriptCount(): number { return this._transcript.filter(e => e.source !== 'whisper').length; }

  get duration(): string | undefined {
    if (!this._startTime) return undefined;
    const diffMs = (this._endTime ?? new Date()).getTime() - this._startTime.getTime();
    const mins = Math.floor(diffMs / 60000);
    const secs = Math.floor((diffMs % 60000) / 1000);
    return `${mins}dk ${secs}sn`;
  }

  transcriptBySource(source: TranscriptSource): TranscriptEntry[] {
    return this._transcript.filter(e => e.source === source);
  }

  setStatus(status: MeetingStatus): void {
    this._status = status;
    if (status === 'in-meeting') this._startTime = new Date();
    if (status === 'ended') this._endTime = new Date();
  }

  setError(message: string): void {
    this._error = message;
    this._status = 'error';
  }

  addParticipant(name: string): boolean {
    if (this._participants.has(name)) return false;
    this._participants.add(name);
    return true;
  }

  addTranscriptEntry(entry: TranscriptEntry): number {
    this._transcript.push(entry);
    this.addParticipant(entry.speaker);
    return this._transcript.length - 1;
  }

  updateTranscriptEntry(index: number, text: string): void {
    if (index < 0 || index >= this._transcript.length) return;
    this._transcript[index].text = text;
    this._transcript[index].endTime = new Date();
  }

  toResult(): MeetingResult {
    return {
      id: this.id,
      meetLink: this.meetLink,
      status: this._status,
      startTime: this._startTime,
      endTime: this._endTime,
      participants: this.participants,
      transcript: this.transcript,
      error: this._error,
    };
  }
}
