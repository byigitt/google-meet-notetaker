// ─── HTTP + WebSocket Server ─────────────────────────────
// SRP: Tek sorumluluk → API endpoint'leri ve WS yayını
// ─────────────────────────────────────────────────────────

import express from 'express';
import { createServer } from 'http';
import { Server as SocketIO } from 'socket.io';
import path from 'path';
import { AppConfig } from './config';
import { MeetBot } from './bot/meet-bot';
import { createTranscriber } from './transcription/transcriber-factory';
import { Summarizer } from './ai/summarizer';
import { MeetingResult } from './types';

export function createApp(config: AppConfig) {
  const app = express();
  const http = createServer(app);
  const io = new SocketIO(http);

  app.use(express.json());
  app.use(express.static(path.resolve(__dirname, '../public')));

  const summarizer = new Summarizer(config.openaiApiKey);

  // Aktif bot oturumları
  const activeBots = new Map<string, MeetBot>();
  // Tamamlanan toplantı sonuçları
  const completedMeetings: MeetingResult[] = [];

  // ── API: Toplantıya katıl ──

  app.post('/api/join', async (req, res) => {
    const { meetLink } = req.body;

    if (!meetLink?.includes('meet.google.com/')) {
      return res.status(400).json({ error: 'Geçerli bir Google Meet linki girin (ör: https://meet.google.com/xxx-xxxx-xxx)' });
    }
    console.log(`📥 Yeni katılma isteği: ${meetLink}`);

    try {
      const transcriber = createTranscriber(
        config.transcriptionStrategy,
        config.deepgramApiKey,
      );

      const bot = new MeetBot(meetLink, config.botName, config.captionLanguage, transcriber);
      activeBots.set(bot.session.id, bot);

      // Event'leri WebSocket'e yay
      bot.on('status', (status) => {
        io.emit('status', { sessionId: bot.session.id, status });
      });

      bot.on('caption', (entry) => {
        io.emit('caption', { sessionId: bot.session.id, entry });
      });

      bot.on('caption-update', (index, entry) => {
        io.emit('caption-update', { sessionId: bot.session.id, index, entry });
      });

      bot.on('error', (message) => {
        io.emit('error', { sessionId: bot.session.id, message });
      });

      bot.on('ended', (result) => {
        completedMeetings.push(result);
        activeBots.delete(bot.session.id);
        io.emit('ended', { sessionId: bot.session.id });
      });

      // Async olarak katıl (hemen response dön)
      bot.join().catch(err => {
        console.error(`❌ [${bot.session.id}] Bot hatası:`, err.message);
        io.emit('error', { sessionId: bot.session.id, message: err.message });
      });

      res.json({
        sessionId: bot.session.id,
        status: 'joining',
        message: 'Bot toplantıya katılıyor...',
      });

    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── API: Toplantıdan ayrıl ──

  app.post('/api/leave/:sessionId', async (req, res) => {
    const bot = activeBots.get(req.params.sessionId);
    if (!bot) return res.status(404).json({ error: 'Oturum bulunamadı' });

    await bot.leave();
    res.json({ message: 'Toplantıdan ayrılındı' });
  });

  // ── API: Toplantı durumu ──

  app.get('/api/status/:sessionId', (req, res) => {
    const bot = activeBots.get(req.params.sessionId);
    if (bot) {
      const s = bot.session;
      return res.json({
        sessionId: s.id,
        status: s.status,
        participants: s.participants,
        transcriptCount: s.transcriptCount,
        duration: s.duration,
      });
    }

    const completed = completedMeetings.find(m => m.id === req.params.sessionId);
    if (completed) return res.json(completed);

    res.status(404).json({ error: 'Oturum bulunamadı' });
  });

  // ── API: Transkript al ──

  app.get('/api/transcript/:sessionId', (req, res) => {
    const result = findSession(req.params.sessionId);
    if (!result) return res.status(404).json({ error: 'Oturum bulunamadı' });
    res.json({ transcript: result.transcript });
  });

  // ── API: Özet oluştur ──

  app.post('/api/summarize/:sessionId', async (req, res) => {
    const result = findSession(req.params.sessionId);
    if (!result) return res.status(404).json({ error: 'Oturum bulunamadı' });

    try {
      const bot = activeBots.get(req.params.sessionId);
      const duration = bot?.session.duration;

      const summary = await summarizer.summarize(
        result.transcript,
        result.participants,
        duration,
      );

      res.json(summary);
    } catch (err: any) {
      res.status(500).json({ error: `Özet oluşturulamadı: ${err.message}` });
    }
  });

  // ── API: Mevcut dilleri listele ──

  app.get('/api/languages/:sessionId', async (req, res) => {
    const bot = activeBots.get(req.params.sessionId);
    if (!bot) return res.status(404).json({ error: 'Oturum bulunamadı' });

    try {
      const languages = await bot.getAvailableLanguages();
      res.json({ languages });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── API: Dil değiştir ──

  app.post('/api/language/:sessionId', async (req, res) => {
    const bot = activeBots.get(req.params.sessionId);
    if (!bot) return res.status(404).json({ error: 'Oturum bulunamadı' });

    const { language } = req.body;
    if (!language) return res.status(400).json({ error: 'Dil belirtilmedi' });

    try {
      const success = await bot.changeCaptionLanguage(language);
      if (success) {
        io.emit('language-changed', { sessionId: req.params.sessionId, language });
        res.json({ success: true, language });
      } else {
        res.status(400).json({ error: `"${language}" dili seçilemedi` });
      }
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── API: Tüm toplantılar ──

  app.get('/api/meetings', (_req, res) => {
    const active = [...activeBots.values()].map(b => ({
      id: b.session.id,
      meetLink: b.session.meetLink,
      status: b.session.status,
      participants: b.session.participants,
      transcriptCount: b.session.transcriptCount,
      duration: b.session.duration,
    }));

    res.json({ active, completed: completedMeetings });
  });

  // ── Helpers ──

  function findSession(id: string): MeetingResult | undefined {
    const bot = activeBots.get(id);
    if (bot) return bot.getResult();
    return completedMeetings.find(m => m.id === id);
  }

  // ── Socket.IO ──

  io.on('connection', (socket) => {
    console.log('🔌 Client bağlandı');
    socket.on('disconnect', () => console.log('🔌 Client ayrıldı'));
  });

  return { app, http, io };
}
