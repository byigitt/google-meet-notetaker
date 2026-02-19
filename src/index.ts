// ─── Entry Point ─────────────────────────────────────────
// SRP: Tek sorumluluk → uygulamayı başlat
// ─────────────────────────────────────────────────────────

import { loadConfig } from './config';
import { createApp } from './server';
import { log } from './logger';

const M = 'app';

async function main() {
  const config = loadConfig();

  log(M, `strategy : ${config.transcriptionStrategy}`);
  log(M, `bot name : ${config.botName}`);
  log(M, `language : ${config.captionLanguage}`);
  log(M, `port     : ${config.port}`);

  const { http } = createApp(config);

  http.listen(config.port, () => {
    log(M, `server running at http://localhost:${config.port}`);
    log(M, 'open the URL in your browser to start');
  });
}

main().catch(err => {
  console.error(`FATAL: ${err.message}`);
  process.exit(1);
});
