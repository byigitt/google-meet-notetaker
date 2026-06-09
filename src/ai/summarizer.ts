import OpenAI from 'openai';
import { MeetingSummary, TranscriptEntry } from '../types';
import { log, warn } from '../logger';

const M = 'summarizer';

const SYSTEM_PROMPT = `You are a meeting assistant. I will give you a meeting transcript.
Return a JSON object in exactly this format and do not write anything else:
{
  "title": "Meeting title inferred from the content",
  "summary": "Overall meeting summary (2-3 paragraphs, English)",
  "keyPoints": ["Important point 1", "Important point 2", ...],
  "actionItems": ["Action item 1, with owner if available", ...],
  "decisions": ["Decision 1", ...]
}
Rules:
- Write in English
- Return JSON only; do not include markdown or explanations
- Use only real information from the transcript; do not invent details`;

function formatEntries(entries: TranscriptEntry[]): string {
  return entries
    .map(e => `[${e.startTime.toLocaleTimeString('en-US')}] ${e.speaker}: ${e.text}`)
    .join('\n');
}

function makeSummary(
  parsed: Partial<MeetingSummary>,
  participants: string[],
  duration?: string,
): MeetingSummary {
  return {
    title:       parsed.title ?? 'Meeting',
    date:        new Date().toLocaleDateString('en-US'),
    duration:    duration ?? 'Unknown',
    participants,
    summary:     parsed.summary ?? '',
    keyPoints:   parsed.keyPoints ?? [],
    actionItems: parsed.actionItems ?? [],
    decisions:   parsed.decisions ?? [],
  };
}

export class Summarizer {
  private client: OpenAI;

  constructor(apiKey: string) {
    this.client = new OpenAI({ apiKey });
  }

  async summarize(
    transcript: TranscriptEntry[],
    participants: string[],
    duration?: string,
  ): Promise<MeetingSummary> {
    if (transcript.length === 0) {
      return makeSummary(
        { summary: 'No transcript was found. Captions may not have been enabled in the meeting.' },
        participants,
        duration,
      );
    }

    const userPrompt = [
      `Participants: ${participants.join(', ')}`,
      duration ? `Duration: ${duration}` : '',
      '',
      '--- TRANSCRIPT ---',
      formatEntries(transcript),
    ].filter(Boolean).join('\n');

    log(M, `sending ${transcript.length} entries to gpt-4o-mini...`);

    const response = await this.client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.3,
      max_tokens: 2000,
    });

    const content = response.choices[0]?.message?.content?.trim() ?? '{}';

    try {
      const jsonStr = content.replace(/^```json?\n?/, '').replace(/\n?```$/, '');
      return makeSummary(JSON.parse(jsonStr), participants, duration);
    } catch {
      warn(M, 'json parse failed, using raw text');
      return makeSummary({ summary: content }, participants, duration);
    }
  }
}
