# 🎙️ Google Meet AI Notetaker

AI destekli Google Meet toplantı asistanı. Bir link ver, bot toplantıya katılsın, transkript alsın, AI ile özetlesin.

## ✨ Özellikler

- **🤖 Otomatik Katılım** — Google Meet linkiyle bot toplantıya katılır
- **📝 Canlı Transkript** — Google Meet altyazıları veya Deepgram ile real-time transkript
- **✨ AI Özet** — OpenAI GPT ile toplantı özeti, önemli noktalar, yapılacaklar
- **🖥️ Mission Control UI** — Real-time WebSocket dashboard
- **🔌 Strategy Pattern** — Caption scraping veya Deepgram, kolayca değiştirilebilir

## 🏗️ Mimari

```
src/
├── config.ts                    # Uygulama konfigürasyonu
├── types.ts                     # Tip tanımları
├── index.ts                     # Entry point
├── server.ts                    # Express + Socket.IO server
├── bot/
│   ├── browser.ts               # Chrome yaşam döngüsü (SRP)
│   ├── page-actions.ts          # Puppeteer yardımcıları (DRY)
│   ├── meet-navigator.ts        # Google Meet navigasyonu (SRP)
│   └── meet-bot.ts              # Orchestrator
├── transcription/
│   ├── base-transcriber.ts      # Abstract interface (Strategy Pattern)
│   ├── caption-transcriber.ts   # Google Meet altyazı scraping
│   ├── deepgram-transcriber.ts  # Deepgram real-time transcription
│   └── transcriber-factory.ts   # Factory
├── ai/
│   └── summarizer.ts            # OpenAI özet
└── session/
    └── meeting-session.ts       # Oturum state yönetimi
```

**Prensipler:**
- **SRP** — Her dosya tek sorumluluk
- **DRY** — Ortak pattern'lar `page-actions.ts`'de, ortak interface `base-transcriber.ts`'de
- **Strategy Pattern** — Transkripsiyon stratejisi `.env`'den seçilir
- **Factory Pattern** — `transcriber-factory.ts` doğru implementasyonu oluşturur

## 🚀 Kurulum

```bash
# 1. Bağımlılıkları kur
pnpm install
pnpm exec patchright install chromium

# 2. .env dosyasını oluştur
cp .env.example .env
# .env dosyasını düzenle: OPENAI_API_KEY ekle

# 3. Başlat
pnpm dev
```

## ⚙️ Konfigürasyon

| Değişken | Zorunlu | Açıklama |
|---|---|---|
| `OPENAI_API_KEY` | ✅ | OpenAI API anahtarı (özet için) |
| `TRANSCRIPTION_STRATEGY` | ❌ | `captions` (varsayılan) veya `deepgram` |
| `DEEPGRAM_API_KEY` | 🔶 | Sadece `deepgram` stratejisinde |
| `BOT_NAME` | ❌ | Bot ismi (varsayılan: "AI Notetaker") |
| `PORT` | ❌ | Sunucu portu (varsayılan: 3000) |

## 📋 Kullanım

1. `npm run dev` ile sunucuyu başlat
2. `http://localhost:3000` adresini aç
3. Google Meet linkini yapıştır
4. **BAŞLAT** butonuna bas
5. Bot toplantıya katılır → toplantı sahibi kabul eder
6. Canlı transkript akar
7. Toplantı bitince **AI ÖZET OLUŞTUR** ile özet al

## 🎯 Transkripsiyon Stratejileri

### Caption Scraping (Varsayılan)
- Ücretsiz, ekstra API key gerektirmez
- Google Meet'in kendi altyazı özelliğini kullanır
- Toplantıda altyazılar otomatik açılır

### Deepgram
- Daha yüksek kalite, gerçek zamanlı
- `DEEPGRAM_API_KEY` gerektirir
- Sayfadan ses yakalayıp Deepgram'a stream eder

## ⚠️ Önemli Notlar

- Bot **headless olmayan** Chrome kullanır (Google Meet gereksinimi)
- Toplantı sahibinin botu **kabul etmesi** gerekir
- Google Meet DOM yapısı değişebilir; selector'lar güncellenebilir
- Üretim kullanımı için Google Workspace API entegrasyonu önerilir
