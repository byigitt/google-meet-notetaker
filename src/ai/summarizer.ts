// ─── AI Summarizer ───────────────────────────────────────
// SRP: Tek sorumluluk → transkripti AI ile özetle
// ─────────────────────────────────────────────────────────

import OpenAI from 'openai';
import { MeetingSummary, TranscriptEntry } from '../types';

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
- Transkriptte geçen gerçek bilgileri kullan, uydurmaMake`;

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
      return this.emptySummary(participants, duration);
    }

    const formattedTranscript = transcript
      .map(e => `[${e.startTime.toLocaleTimeString('tr-TR')}] ${e.speaker}: ${e.text}`)
      .join('\n');

    const userPrompt = [
      `Katılımcılar: ${participants.join(', ')}`,
      duration ? `Süre: ${duration}` : '',
      '',
      '--- TRANSKRİPT ---',
      formattedTranscript,
    ].filter(Boolean).join('\n');

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
      // JSON bloğu varsa çıkar
      const jsonStr = content.replace(/^```json?\n?/, '').replace(/\n?```$/, '');
      const parsed = JSON.parse(jsonStr);

      return {
        title: parsed.title ?? 'Toplantı',
        date: new Date().toLocaleDateString('tr-TR'),
        duration: duration ?? 'Bilinmiyor',
        participants,
        summary: parsed.summary ?? '',
        keyPoints: parsed.keyPoints ?? [],
        actionItems: parsed.actionItems ?? [],
        decisions: parsed.decisions ?? [],
      };
    } catch {
      // JSON parse başarısız olursa ham metni kullan
      return {
        title: 'Toplantı',
        date: new Date().toLocaleDateString('tr-TR'),
        duration: duration ?? 'Bilinmiyor',
        participants,
        summary: content,
        keyPoints: [],
        actionItems: [],
        decisions: [],
      };
    }
  }

  private emptySummary(participants: string[], duration?: string): MeetingSummary {
    return {
      title: 'Toplantı',
      date: new Date().toLocaleDateString('tr-TR'),
      duration: duration ?? 'Bilinmiyor',
      participants,
      summary: 'Transkript bulunamadı. Toplantıda altyazılar açık olmayabilir.',
      keyPoints: [],
      actionItems: [],
      decisions: [],
    };
  }
}
