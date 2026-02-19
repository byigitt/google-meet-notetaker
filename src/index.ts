import { loadConfig } from './config';
import { createApp } from './server';
import { log } from './logger';

async function main(): Promise<void> {
  const config = loadConfig();

  log('app', `strategy : ${config.transcriptionStrategy}`);
  log('app', `bot name : ${config.botName}`);
  log('app', `language : ${config.captionLanguage}`);
  log('app', `port     : ${config.port}`);

  const { http } = createApp(config);

  http.listen(config.port, () => {
    log('app', `server running at http://localhost:${config.port}`);
  });
}

main().catch(err => {
  console.error(`FATAL: ${err.message}`);
  process.exit(1);
});
