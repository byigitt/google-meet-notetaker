// ─── Entry Point ─────────────────────────────────────────
// SRP: Tek sorumluluk → uygulamayı başlat
// ─────────────────────────────────────────────────────────

import { loadConfig } from './config';
import { createApp } from './server';

async function main() {
  console.log('');
  console.log('🎙️  Google Meet AI Notetaker');
  console.log('════════════════════════════════════');

  const config = loadConfig();

  console.log(`📋 Strateji : ${config.transcriptionStrategy}`);
  console.log(`🤖 Bot adı  : ${config.botName}`);
  console.log(`🌐 Dil      : ${config.captionLanguage}`);
  console.log(`🌐 Port     : ${config.port}`);
  console.log('');

  const { http } = createApp(config);

  http.listen(config.port, () => {
    console.log(`✅ Sunucu çalışıyor → http://localhost:${config.port}`);
    console.log('');
    console.log('Kullanım:');
    console.log('  1. Tarayıcıda http://localhost:' + config.port + ' adresini açın');
    console.log('  2. Google Meet linkini yapıştırın');
    console.log('  3. "Toplantıya Katıl" butonuna basın');
    console.log('  4. Toplantı bitince "Özet Oluştur" ile AI özeti alın');
    console.log('');
  });
}

main().catch(err => {
  console.error('💥 Başlatma hatası:', err.message);
  process.exit(1);
});
