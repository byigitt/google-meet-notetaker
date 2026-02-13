// ─── Type Definitions ────────────────────────────────────
// SRP: Tek sorumluluk → tüm uygulama tip tanımları
// ─────────────────────────────────────────────────────────

export interface TranscriptEntry {
  speaker: string;
  text: string;
  startTime: Date;
  endTime: Date;
}

export interface MeetingSummary {
  title: string;
  date: string;
  duration: string;
  participants: string[];
  summary: string;
  keyPoints: string[];
  actionItems: string[];
  decisions: string[];
}

export interface MeetingResult {
  id: string;
  meetLink: string;
  status: MeetingStatus;
  startTime?: Date;
  endTime?: Date;
  participants: string[];
  transcript: TranscriptEntry[];
  summary?: MeetingSummary;
  error?: string;
}

export type MeetingStatus =
  | 'joining'
  | 'waiting'
  | 'in-meeting'
  | 'ended'
  | 'error';

/** Bot → Server arası event'ler */
export interface BotEvents {
  'status': (status: MeetingStatus) => void;
  'caption': (entry: TranscriptEntry) => void;
  'caption-update': (index: number, entry: TranscriptEntry) => void;
  'participant': (name: string) => void;
  'ended': (result: MeetingResult) => void;
  'error': (message: string) => void;
}
