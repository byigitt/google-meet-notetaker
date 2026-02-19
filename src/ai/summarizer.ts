import OpenAI from 'openai';
import { MeetingSummary, TranscriptEntry } from '../types';
import { log, warn } from '../logger';

const M = 'summarizer';

const SYSTEM_PROMPT = `Sen bir toplantı asistanısın. Sana bir toplantının transkriptini vereceğim.
Aşağıdaki formatta bir JSON döndür (başka hiçbir şey yazma):
{
  "title": "Toplantı başlığı (içerikten çıkar)",
  "summary": "Toplantının genel özeti (2-3 paragraf, Türkçe)",
  "keyPoints": ["Önemli nokta 1", "Önemli nokta 2", ...],
  "actionItems": ["Yapılacak iş 1 (varsa sorumlısıyla)", ...],
  "decisions": ["Alınan karar 1", ...]
}
Kurallar:
- Türkçe yaz
- Sadece JSON döndür, markdown veya açıklama ekleme
- Transkriptte geçen gerçek bilgileri kullan, uydurma`;

function formatEntries(entries: TranscriptEntry[]): string {
  return entries
    .map(e => `[${e.startTime.toLocaleTimeString('tr-TR')}] ${e.speaker}: ${e.text}`)
    .join('\n');
}

function makeSummary(
  parsed: Partial<MeetingSummary>,
  participants: string[],
  duration?: string,
): MeetingSummary {
  return {
    title:       parsed.title ?? 'Toplantı',
    date:        new Date().toLocaleDateString('tr-TR'),
    duration:    duration ?? 'Bilinmiyor',
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
        { summary: 'Transkript bulunamadı. Toplantıda altyazılar açık olmayabilir.' },
        participants,
        duration,
      );
    }

    const userPrompt = [
      `Katılımcılar: ${participants.join(', ')}`,
      duration ? `Süre: ${duration}` : '',
      '',
      '--- TRANSKRİPT ---',
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
