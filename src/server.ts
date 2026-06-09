// ─────────────────────────────────────────────────────────

import express, { type Express } from 'express';
import { createServer, type Server as HttpServer } from 'http';
import { Server as SocketIO } from 'socket.io';
import path from 'path';
import { AppConfig } from './config';
import { MeetBot } from './bot/meet-bot';
import { createTranscriber } from './transcription/transcriber-factory';
import { Summarizer } from './ai/summarizer';
import { MeetingResult } from './types';

export function createApp(config: AppConfig): { app: Express; http: HttpServer; io: SocketIO } {
  const app = express();
  const http = createServer(app);
  const io = new SocketIO(http);

  app.use(express.json());
  app.use(express.static(path.resolve(__dirname, '../public')));

  const summarizer = new Summarizer(config.openaiApiKey);

  // Active bot sessions
  const activeBots = new Map<string, MeetBot>();
  // Completed meeting results
  const completedMeetings: MeetingResult[] = [];

  // ── API: Join meeting ──

  app.post('/api/join', async (req, res) => {
    const { meetLink } = req.body;

    if (!meetLink?.includes('meet.google.com/')) {
      return res.status(400).json({ error: 'Enter a valid Google Meet link (example: https://meet.google.com/xxx-xxxx-xxx)' });
    }
    console.log(`📥 New join request: ${meetLink}`);

    try {
      const transcriber = createTranscriber(config.transcriptionStrategy, {
        openaiApiKey:  config.openaiApiKey,
        whisperApiKey: config.whisperApiKey,
        whisperBaseUrl: config.whisperBaseUrl,
      });

      const bot = new MeetBot(meetLink, config.botName, config.captionLanguage, transcriber);
      activeBots.set(bot.session.id, bot);

      // Publish events to WebSocket
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

      // Join asynchronously (return the response immediately)
      bot.join().catch(err => {
        console.error(`❌ [${bot.session.id}] Bot error:`, err.message);
        io.emit('error', { sessionId: bot.session.id, message: err.message });
      });

      res.json({
        sessionId: bot.session.id,
        status: 'joining',
        message: 'Bot is joining the meeting...',
      });

    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── API: Leave meeting ──

  app.post('/api/leave/:sessionId', async (req, res) => {
    const bot = activeBots.get(req.params.sessionId);
    if (!bot) return res.status(404).json({ error: 'Session not found' });

    await bot.leave();
    res.json({ message: 'Left the meeting' });
  });

  // ── API: Meeting status ──

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

    res.status(404).json({ error: 'Session not found' });
  });

  // ── API: Get transcript ──

  app.get('/api/transcript/:sessionId', (req, res) => {
    const result = findSession(req.params.sessionId);
    if (!result) return res.status(404).json({ error: 'Session not found' });
    res.json({ transcript: result.transcript });
  });

  // ── API: Generate summary ──

  app.post('/api/summarize/:sessionId', async (req, res) => {
    const result = findSession(req.params.sessionId);
    if (!result) return res.status(404).json({ error: 'Session not found' });

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
      res.status(500).json({ error: `Could not generate summary: ${err.message}` });
    }
  });

  // ── API: List available languages ──

  app.get('/api/languages/:sessionId', async (req, res) => {
    const bot = activeBots.get(req.params.sessionId);
    if (!bot) return res.status(404).json({ error: 'Session not found' });

    try {
      const languages = await bot.getAvailableLanguages();
      res.json({ languages });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── API: Change language ──

  app.post('/api/language/:sessionId', async (req, res) => {
    const bot = activeBots.get(req.params.sessionId);
    if (!bot) return res.status(404).json({ error: 'Session not found' });

    const { language } = req.body;
    if (!language) return res.status(400).json({ error: 'Language was not provided' });

    try {
      const success = await bot.changeCaptionLanguage(language);
      if (success) {
        io.emit('language-changed', { sessionId: req.params.sessionId, language });
        res.json({ success: true, language });
      } else {
        res.status(400).json({ error: `"${language}" language could not be selected` });
      }
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── API: All meetings ──

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
    console.log('🔌 Client connected');
    socket.on('disconnect', () => console.log('🔌 Client disconnected'));
  });

  return { app, http, io };
}
