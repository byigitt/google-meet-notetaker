#!/usr/bin/env node

// ─── CLI Entry Point ─────────────────────────────────────
// Web UI olmadan terminalden toplantı yönetimi
// ─────────────────────────────────────────────────────────

import readline from 'readline';
import fs from 'fs/promises';
import path from 'path';
import { loadConfig, AppConfig, TranscriptionStrategy } from './config';
import { createTranscriber } from './transcription/transcriber-factory';
import { MeetBot } from './bot/meet-bot';
import { Summarizer } from './ai/summarizer';
import { MeetingResult, MeetingSummary } from './types';
import { log, warn, error } from './logger';

const M = 'cli';

// ─── CLI Options ──────────────────────────────────────────

interface CliOptions {
  meetLink?: string;
  botName?: string;
  captionLanguage?: string;
  strategy?: TranscriptionStrategy;
  autoSummary: boolean;
  saveDir?: string;
  debug: boolean;
  help: boolean;
}

function printHelp(): void {
  console.log(`
Google Meet AI Notetaker - CLI

Usage:
  pnpm cli <meet-link> [options]
  pnpm cli --meet <meet-link> [options]

Options:
  --name <name>        Bot name (default from .env)
  --lang <language>    Caption language (e.g. Turkish, English)
  --strategy <type>    captions | deepgram | whisper
  --no-summary         Skip auto AI summary at the end
  --save-dir <dir>     Save transcript + summary to directory
  --debug              Enable verbose debug logs
  -h, --help           Show this help

Live commands (while meeting is running):
  help                 Show commands
  status               Current session info
  summary              Generate AI summary of transcript so far
  languages            List available caption languages
  language <name>      Switch caption language
  leave / exit / quit  Leave meeting
`);
}

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = { autoSummary: true, debug: false, help: false };
  const positional: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    const next = (flag: string): string => {
      const v = argv[i + 1];
      if (!v || v.startsWith('-')) throw new Error(`missing value for ${flag}`);
      i++;
      return v;
    };

    switch (arg) {
      case '-h': case '--help':   opts.help = true; break;
      case '--no-summary':        opts.autoSummary = false; break;
      case '--debug':             opts.debug = true; break;
      case '--meet':              opts.meetLink = next('--meet'); break;
      case '--name':              opts.botName = next('--name'); break;
      case '--lang':              opts.captionLanguage = next('--lang'); break;
      case '--save-dir':          opts.saveDir = next('--save-dir'); break;
      case '--strategy': {
        const s = next('--strategy') as TranscriptionStrategy;
        if (!['captions', 'deepgram', 'whisper'].includes(s)) {
          throw new Error(`invalid strategy "${s}" — use captions, deepgram, or whisper`);
        }
        opts.strategy = s;
        break;
      }
      default:
        if (arg.startsWith('-')) throw new Error(`unknown argument: ${arg}`);
        positional.push(arg);
    }
  }

  if (!opts.meetLink) {
    if (positional[0] === 'join' && positional[1]) opts.meetLink = positional[1];
    else if (positional[0]) opts.meetLink = positional[0];
  }

  return opts;
}

async function askMeetLink(): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise<string>(resolve => {
    rl.question('Meet link: ', a => resolve(a.trim()));
  });
  rl.close();
  return answer;
}

function validateMeetLink(link: string): void {
  if (!link.includes('meet.google.com/')) {
    throw new Error('invalid meet link — expected: https://meet.google.com/xxx-xxxx-xxx');
  }
}

function mergeConfig(base: AppConfig, opts: CliOptions): AppConfig {
  return {
    ...base,
    botName: opts.botName ?? base.botName,
    captionLanguage: opts.captionLanguage ?? base.captionLanguage,
    transcriptionStrategy: opts.strategy ?? base.transcriptionStrategy,
  };
}

// ─── Output ───────────────────────────────────────────────

function formatTranscript(result: MeetingResult): string {
  return result.transcript
    .map(e => `[${new Date(e.startTime).toLocaleTimeString('tr-TR')}] ${e.speaker}: ${e.text}`)
    .join('\n');
}

function formatSummaryMarkdown(s: MeetingSummary): string {
  return [
    `# ${s.title}`,
    ``,
    `- Date: ${s.date}`,
    `- Duration: ${s.duration}`,
    `- Participants: ${s.participants.join(', ') || '-'}`,
    ``,
    `## Summary`,
    s.summary || '-',
    ``,
    `## Key Points`,
    ...(s.keyPoints.length ? s.keyPoints.map(x => `- ${x}`) : ['- none']),
    ``,
    `## Action Items`,
    ...(s.actionItems.length ? s.actionItems.map(x => `- ${x}`) : ['- none']),
    ``,
    `## Decisions`,
    ...(s.decisions.length ? s.decisions.map(x => `- ${x}`) : ['- none']),
    ``,
  ].join('\n');
}

async function saveArtifacts(dir: string, result: MeetingResult, summary?: MeetingSummary): Promise<void> {
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const base = `${ts}-${result.id.slice(0, 8)}`;

  await fs.mkdir(dir, { recursive: true });

  const tPath = path.join(dir, `${base}-transcript.txt`);
  await fs.writeFile(tPath, formatTranscript(result), 'utf-8');
  log(M, `transcript saved: ${tPath}`);

  if (summary) {
    const sPath = path.join(dir, `${base}-summary.md`);
    await fs.writeFile(sPath, formatSummaryMarkdown(summary), 'utf-8');
    log(M, `summary saved: ${sPath}`);
  }
}

function printSummary(s: MeetingSummary): void {
  console.log('\n' + '='.repeat(50));
  console.log('AI SUMMARY');
  console.log('='.repeat(50));
  console.log(`Title      : ${s.title}`);
  console.log(`Date       : ${s.date}`);
  console.log(`Duration   : ${s.duration}`);
  console.log(`Participants: ${s.participants.join(', ') || '-'}`);
  console.log('');
  console.log(s.summary || '(no summary)');

  if (s.keyPoints.length) {
    console.log('\nKey Points:');
    s.keyPoints.forEach(x => console.log(`  * ${x}`));
  }
  if (s.actionItems.length) {
    console.log('\nAction Items:');
    s.actionItems.forEach(x => console.log(`  * ${x}`));
  }
  if (s.decisions.length) {
    console.log('\nDecisions:');
    s.decisions.forEach(x => console.log(`  * ${x}`));
  }
  console.log('='.repeat(50) + '\n');
}

// ─── Main ─────────────────────────────────────────────────

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));

  if (opts.help) { printHelp(); return; }

  // Debug modu env'e yaz (logger + transcribers bu değişkeni okur)
  process.env.CLI_DEBUG = opts.debug ? '1' : '0';

  const baseConfig = loadConfig();
  const config = mergeConfig(baseConfig, opts);

  const meetLink = ((opts.meetLink ?? await askMeetLink())).trim();
  validateMeetLink(meetLink);

  console.log('');
  console.log('='.repeat(50));
  console.log('Google Meet AI Notetaker');
  console.log('='.repeat(50));
  log(M, `bot name : ${config.botName}`);
  log(M, `language : ${config.captionLanguage}`);
  log(M, `strategy : ${config.transcriptionStrategy}`);
  log(M, `meeting  : ${meetLink}`);
  if (config.transcriptionStrategy === 'whisper') {
    log(M, `whisper  : ${config.whisperModel} (recording until meeting ends)`);
  }
  console.log('');

  const transcriber = createTranscriber(config.transcriptionStrategy, {
    openaiApiKey: config.openaiApiKey,
    openaiBaseUrl: config.openaiBaseUrl,
    deepgramApiKey: config.deepgramApiKey,
  });

  const bot = new MeetBot(meetLink, config.botName, config.captionLanguage, transcriber);
  const summarizer = new Summarizer(config.openaiApiKey);

  let ended = false;
  let lastSummary: MeetingSummary | undefined;
  let summaryBusy = false;

  const buildSummary = async (): Promise<MeetingSummary> => {
    if (summaryBusy) throw new Error('summary already in progress');
    summaryBusy = true;
    try {
      const result = bot.getResult();
      const summary = await summarizer.summarize(result.transcript, result.participants, bot.session.duration);
      lastSummary = summary;
      return summary;
    } finally {
      summaryBusy = false;
    }
  };

  // ─── Command interface ────────────────────────────────

  const endedPromise = new Promise<MeetingResult>(resolve => bot.once('ended', resolve));

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: '> ' });

  // printLive: caption/status geldiğinde mevcut prompt satırını temizleyip yeniden çiz
  const printLive = (msg: string, level: 'log' | 'err' = 'log') => {
    if (ended) { level === 'err' ? console.error(msg) : console.log(msg); return; }

    readline.clearLine(process.stdout, 0);
    readline.cursorTo(process.stdout, 0);
    level === 'err' ? console.error(msg) : console.log(msg);
    rl.prompt(true);
  };

  // ─── Bot events ───────────────────────────────────────

  bot.on('status', status => {
    printLive(`${new Date().toTimeString().slice(0, 8)} [INFO ] [bot] status=${status}`);
  });

  bot.on('caption', entry => {
    const time = new Date(entry.startTime).toLocaleTimeString('tr-TR');
    printLive(`[${time}] ${entry.speaker}: ${entry.text}`);
  });

  bot.on('error', msg => {
    printLive(`${new Date().toTimeString().slice(0, 8)} [ERROR] [bot] ${msg}`, 'err');
  });

  // ─── Command handler ──────────────────────────────────

  const handleCommand = async (line: string): Promise<void> => {
    const [cmd, ...rest] = line.trim().toLowerCase().split(' ');
    if (!cmd) return;

    switch (cmd) {
      case 'help':
        console.log('Commands: help, status, summary, languages, language <name>, leave/exit/quit');
        break;

      case 'status':
        console.log(`status       : ${bot.session.status}`);
        console.log(`participants : ${bot.session.participantCount}`);
        console.log(`transcript   : ${bot.session.transcriptCount} lines`);
        console.log(`duration     : ${bot.session.duration ?? 'not started'}`);
        break;

      case 'summary':
        log(M, 'generating summary...');
        printSummary(await buildSummary());
        break;

      case 'languages': {
        log(M, 'fetching available languages...');
        const langs = await bot.getAvailableLanguages();
        if (!langs.length) warn(M, 'no languages returned');
        else langs.forEach(l => console.log(`  ${l}`));
        break;
      }

      case 'language': {
        const target = rest.join(' ').trim();
        if (!target) { console.log('usage: language <name>'); break; }
        const ok = await bot.changeCaptionLanguage(target);
        if (ok) log(M, `language changed to: ${target}`);
        else warn(M, `language not changed: ${target}`);
        break;
      }

      case 'leave': case 'exit': case 'quit':
        log(M, 'leaving meeting...');
        await bot.leave();
        break;

      default:
        console.log(`unknown command: ${cmd}  (type "help")`);
    }
  };

  rl.on('line', line => {
    void (async () => {
      try { await handleCommand(line); }
      catch (err: any) { error(M, `command error: ${err.message}`); }
      finally { if (!ended) rl.prompt(); }
    })();
  });

  process.on('SIGINT', () => {
    if (ended) return;
    console.log('');
    log(M, 'SIGINT received, leaving meeting...');
    void bot.leave().catch(() => undefined);
  });

  // ─── Start ────────────────────────────────────────────

  await bot.join();

  if (config.transcriptionStrategy === 'whisper') {
    log(M, '>>> audio recording active — transcript will be generated when meeting ends <<<');
  }

  log(M, 'ready — type "help" for commands');
  rl.prompt();

  const result = await endedPromise;
  ended = true;
  rl.close();

  log(M, 'meeting ended');

  if (opts.autoSummary && result.transcript.length > 0) {
    try {
      log(M, 'generating auto-summary...');
      const summary = await buildSummary();
      printSummary(summary);
    } catch (err: any) {
      warn(M, `auto-summary failed: ${err.message}`);
    }
  } else if (opts.autoSummary && result.transcript.length === 0) {
    warn(M, 'no transcript — skipping summary');
  }

  if (opts.saveDir) {
    await saveArtifacts(opts.saveDir, result, lastSummary);
  }
}

main().catch((err: any) => {
  error(M, `fatal: ${err.message}`);
  process.exit(1);
});
