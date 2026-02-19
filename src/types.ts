export type TranscriptSource = 'captions' | 'whisper';

export type MeetingStatus = 'joining' | 'waiting' | 'in-meeting' | 'ended' | 'error';

export interface TranscriptEntry {
  speaker: string;
  text: string;
  startTime: Date;
  endTime: Date;
  source?: TranscriptSource;
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
