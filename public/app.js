// ════════════════════════════════════════════════════════
// MEET NOTETAKER — CLIENT APPLICATION
// SRP per function: each handles one concern
// ════════════════════════════════════════════════════════

(function () {
  'use strict';

  // ── DOM References ──

  const $ = (sel) => document.querySelector(sel);

  const dom = {
    clock:            $('#clock'),
    connBadge:        $('#connectionBadge'),
    announcer:        $('#a11yAnnouncer'),
    toastContainer:   $('#toastContainer'),
    // Join
    joinSection:      $('#joinSection'),
    joinForm:         $('#joinForm'),
    meetLink:         $('#meetLink'),
    joinBtn:          $('#joinBtn'),
    joinError:        $('#joinError'),
    // Status
    statusSection:    $('#statusSection'),
    statusText:       $('#statusText'),
    participantCount: $('#participantCount'),
    captionCount:     $('#captionCount'),
    duration:         $('#duration'),
    leaveBtn:         $('#leaveBtn'),
    summarizeBtn:     $('#summarizeBtn'),
    // Language
    langSelector:     $('#langSelector'),
    fetchLangsBtn:    $('#fetchLangsBtn'),
    currentLangValue: $('#currentLangValue'),
    langSearchWrap:   $('#langSearchWrap'),
    langSearch:       $('#langSearch'),
    langList:         $('#langList'),
    // Transcript
    transcriptSection: $('#transcriptSection'),
    transcript:        $('#transcript'),
    liveIndicator:     $('#liveIndicator'),
    // Summary
    summarySection:   $('#summarySection'),
    summaryContent:   $('#summaryContent'),
  };

  // ── State ──

  let sessionId = null;
  let durationTimer = null;
  let startTime = null;
  let availableLanguages = [];
  let currentLanguage = null;

  // ═══════════════════════════════════════════════
  // TOAST NOTIFICATION SYSTEM
  // ═══════════════════════════════════════════════

  function showToast(message, type = 'info', durationMs = 5000) {
    const el = document.createElement('div');
    el.className = 'toast toast--' + type;
    el.textContent = message;
    dom.toastContainer.appendChild(el);

    // Auto-dismiss
    setTimeout(() => {
      el.classList.add('toast--leaving');
      setTimeout(() => el.remove(), 350);
    }, durationMs);

    // Also announce for screen readers
    announce(message);
  }

  function showError(message) { showToast('❌ ' + message, 'error', 7000); }
  function showInfo(message)  { showToast('ℹ️ ' + message, 'info', 4000); }
  function showSuccess(message) { showToast('✅ ' + message, 'success', 4000); }

  // ── Inline form error ──

  function showJoinError(message) {
    dom.joinError.textContent = '⚠ ' + message;
    dom.joinError.classList.remove('hidden');
  }

  function clearJoinError() {
    dom.joinError.textContent = '';
    dom.joinError.classList.add('hidden');
  }

  // ═══════════════════════════════════════════════
  // SOCKET.IO
  // ═══════════════════════════════════════════════

  const socket = typeof io !== 'undefined' ? io() : null;

  if (socket) {
    socket.on('connect', () => {
      setConnection(true);
      console.log('[WS] Bağlandı');
    });

    socket.on('disconnect', () => {
      setConnection(false);
      showError('Sunucu bağlantısı kesildi');
    });

    socket.on('status', (data) => {
      if (data.sessionId !== sessionId) return;
      updateStatus(data.status);
      console.log('[WS] Status:', data.status);
    });

    socket.on('caption', (data) => {
      if (data.sessionId !== sessionId) return;
      addCaptionEntry(data.entry);
    });

    socket.on('caption-update', (data) => {
      if (data.sessionId !== sessionId) return;
      updateCaptionEntry(data.index, data.entry);
    });

    socket.on('ended', (data) => {
      if (data.sessionId !== sessionId) return;
      updateStatus('ended');
      showInfo('Toplantı sona erdi');
    });

    socket.on('error', (data) => {
      if (data.sessionId !== sessionId) return;
      updateStatus('error');
      showError(data.message || 'Bilinmeyen hata');
    });

    socket.on('language-changed', (data) => {
      if (data.sessionId !== sessionId) return;
      currentLanguage = data.language;
      dom.currentLangValue.textContent = data.language;
      renderLanguageList();
      showSuccess('Altyazı dili değiştirildi: ' + data.language);
    });
  } else {
    showError('Socket.IO yüklenemedi — sunucu çalışıyor mu?');
  }

  // ═══════════════════════════════════════════════
  // CLOCK
  // ═══════════════════════════════════════════════

  function tickClock() {
    dom.clock.textContent = new Date().toLocaleTimeString('tr-TR', {
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
  }
  setInterval(tickClock, 1000);
  tickClock();

  // ═══════════════════════════════════════════════
  // CONNECTION BADGE
  // ═══════════════════════════════════════════════

  function setConnection(online) {
    dom.connBadge.classList.toggle('online', online);
    dom.connBadge.querySelector('.conn-text').textContent = online ? 'ONLINE' : 'OFFLINE';
  }

  // ═══════════════════════════════════════════════
  // ANNOUNCER (screen-reader only)
  // ═══════════════════════════════════════════════

  function announce(message) {
    if (!dom.announcer) return;
    dom.announcer.textContent = '';
    requestAnimationFrame(() => { dom.announcer.textContent = message; });
  }

  // ═══════════════════════════════════════════════
  // JOIN FORM
  // ═══════════════════════════════════════════════

  /** Normalize meet link — auto-prepend https:// */
  function normalizeMeetLink(raw) {
    let link = raw.trim();
    if (!link) return '';

    // "meet.google.com/xxx" → "https://meet.google.com/xxx"
    if (link.startsWith('meet.google.com')) {
      link = 'https://' + link;
    }

    // Validate
    if (!link.includes('meet.google.com/')) {
      return '';
    }

    return link;
  }

  dom.joinForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearJoinError();

    const rawLink = dom.meetLink.value;
    const link = normalizeMeetLink(rawLink);

    if (!link) {
      showJoinError('Geçerli bir Google Meet linki girin (ör: meet.google.com/abc-defg-hij)');
      return;
    }

    setJoinLoading(true);
    console.log('[JOIN] Link:', link);

    try {
      const res = await fetch('/api/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ meetLink: link }),
      });

      const data = await res.json();
      console.log('[JOIN] Response:', data);

      if (!res.ok) {
        showJoinError(data.error || 'Sunucu hatası');
        setJoinLoading(false);
        return;
      }

      sessionId = data.sessionId;
      startTime = new Date();
      showMeetingUI();
      updateStatus('joining');
      showInfo('Bot toplantıya katılıyor… Chrome açılacak.');

    } catch (err) {
      console.error('[JOIN] Error:', err);
      showJoinError('Sunucuya bağlanılamadı: ' + err.message);
      setJoinLoading(false);
    }
  });

  function setJoinLoading(loading) {
    dom.joinBtn.disabled = loading;
    const textEl = dom.joinBtn.querySelector('span');
    textEl.textContent = loading ? 'BAĞLANIYOR…' : 'BAŞLAT';
  }

  // ═══════════════════════════════════════════════
  // LEAVE BUTTON
  // ═══════════════════════════════════════════════

  dom.leaveBtn.addEventListener('click', async () => {
    if (!sessionId) return;
    if (!confirm('Toplantıdan ayrılmak istediğinize emin misiniz?')) return;

    dom.leaveBtn.disabled = true;
    try {
      await fetch('/api/leave/' + sessionId, { method: 'POST' });
      updateStatus('ended');
      showInfo('Toplantıdan ayrılındı');
    } catch (err) {
      showError('Ayrılma hatası: ' + err.message);
    } finally {
      dom.leaveBtn.disabled = false;
    }
  });

  // ═══════════════════════════════════════════════
  // SUMMARIZE BUTTON
  // ═══════════════════════════════════════════════

  dom.summarizeBtn.addEventListener('click', async () => {
    if (!sessionId) return;

    dom.summarizeBtn.disabled = true;
    dom.summarizeBtn.innerHTML =
      '<span class="loading-ring" aria-hidden="true"></span> OLUŞTURULUYOR…';
    showInfo('AI özet oluşturuluyor… Bu birkaç saniye sürebilir.');

    try {
      const res = await fetch('/api/summarize/' + sessionId, { method: 'POST' });
      const summary = await res.json();

      if (!res.ok) {
        showError('Özet hatası: ' + (summary.error || 'Bilinmeyen hata'));
        return;
      }

      renderSummary(summary);
      dom.summarySection.classList.remove('hidden');
      dom.summarySection.scrollIntoView({ behavior: 'smooth', block: 'start' });
      showSuccess('Toplantı özeti hazır!');

    } catch (err) {
      showError('Özet hatası: ' + err.message);
    } finally {
      dom.summarizeBtn.disabled = false;
      dom.summarizeBtn.innerHTML =
        '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">' +
        '<path d="M7 1V13M1 7H13" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>' +
        '</svg> AI ÖZET OLUŞTUR';
    }
  });

  // ═══════════════════════════════════════════════
  // UI STATE TRANSITIONS
  // ═══════════════════════════════════════════════

  function showMeetingUI() {
    dom.joinSection.classList.add('hidden');
    dom.statusSection.classList.remove('hidden');
    dom.transcriptSection.classList.remove('hidden');
    startDurationTimer();
  }

  // ═══════════════════════════════════════════════
  // STATUS UPDATES
  // ═══════════════════════════════════════════════

  const STATUS_LABELS = {
    'joining':    'Katılınıyor…',
    'waiting':    'Kabul Bekleniyor…',
    'in-meeting': 'Toplantıda',
    'ended':      'Sona Erdi',
    'error':      'Hata',
  };

  function updateStatus(status) {
    const dot = dom.statusText.querySelector('.status-dot');
    const text = dom.statusText.querySelector('span:last-child');

    dot.className = 'status-dot ' + status;
    text.textContent = STATUS_LABELS[status] || status;

    if (status === 'ended' || status === 'error') {
      stopDurationTimer();
      dom.liveIndicator.classList.add('inactive');
      dom.liveIndicator.querySelector('.live-indicator__text').textContent = 'BİTTİ';
    }

    if (status === 'in-meeting') {
      startTime = new Date();
      showSuccess('Toplantıya başarıyla katıldı!');
      autoFetchLanguages();
    }

    if (status !== 'ended' && status !== 'error') {
      pollStatus();
    }
  }

  // ═══════════════════════════════════════════════
  // DURATION TIMER
  // ═══════════════════════════════════════════════

  function startDurationTimer() {
    stopDurationTimer();
    durationTimer = setInterval(() => {
      if (!startTime) return;
      const diff = Date.now() - startTime.getTime();
      const mins = Math.floor(diff / 60000);
      const secs = Math.floor((diff % 60000) / 1000);
      dom.duration.textContent =
        String(mins).padStart(2, '0') + ':' + String(secs).padStart(2, '0');
    }, 1000);
  }

  function stopDurationTimer() {
    if (durationTimer) {
      clearInterval(durationTimer);
      durationTimer = null;
    }
  }

  // ═══════════════════════════════════════════════
  // STATUS POLLING
  // ═══════════════════════════════════════════════

  let pollTimer = null;

  function pollStatus() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(async () => {
      if (!sessionId) return;
      try {
        const res = await fetch('/api/status/' + sessionId);
        if (!res.ok) return;
        const data = await res.json();
        dom.participantCount.textContent = String(data.participants?.length ?? 0);
        dom.captionCount.textContent = String(data.transcriptCount ?? 0);
        if (data.status === 'ended' || data.status === 'error') {
          clearInterval(pollTimer);
        }
      } catch { /* silent */ }
    }, 3000);
  }

  // ═══════════════════════════════════════════════
  // TRANSCRIPT ENTRIES
  // ═══════════════════════════════════════════════

  let captionIndex = 0;

  function addCaptionEntry(entry) {
    const empty = dom.transcript.querySelector('.feed__empty');
    if (empty) empty.remove();

    const el = document.createElement('div');
    el.className = 'feed-entry feed-entry--new';
    el.dataset.index = String(captionIndex++);

    const time = new Date(entry.startTime || Date.now());
    const timeStr = time.toLocaleTimeString('tr-TR', {
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });

    el.innerHTML =
      '<div class="feed-entry__time">' + timeStr + '</div>' +
      '<div class="feed-entry__body">' +
        '<div class="feed-entry__speaker">' + esc(entry.speaker) + '</div>' +
        '<div class="feed-entry__text">' + esc(entry.text) + '</div>' +
      '</div>';

    dom.transcript.appendChild(el);
    dom.transcript.scrollTop = dom.transcript.scrollHeight;

    setTimeout(() => el.classList.remove('feed-entry--new'), 2000);

    const count = dom.transcript.querySelectorAll('.feed-entry').length;
    dom.captionCount.textContent = String(count);
  }

  function updateCaptionEntry(index, entry) {
    const el = dom.transcript.querySelector('[data-index="' + index + '"]');
    if (!el) return;
    const textEl = el.querySelector('.feed-entry__text');
    if (textEl) textEl.textContent = entry.text;
  }

  // ═══════════════════════════════════════════════
  // SUMMARY RENDERER
  // ═══════════════════════════════════════════════

  function renderSummary(s) {
    let html = '';
    html += '<h3 class="summary-title">' + esc(s.title) + '</h3>';
    html += '<div class="summary-meta">';
    html += '<span class="summary-meta__item"><strong>Tarih:</strong>&nbsp;' + esc(s.date) + '</span>';
    html += '<span class="summary-meta__item"><strong>Süre:</strong>&nbsp;' + esc(s.duration) + '</span>';
    html += '<span class="summary-meta__item"><strong>Katılımcı:</strong>&nbsp;' + esc(s.participants?.join(', ') || '—') + '</span>';
    html += '</div>';

    if (s.summary) {
      html += '<div class="summary-text">' + esc(s.summary).replace(/\n/g, '<br>') + '</div>';
    }
    if (s.keyPoints?.length) {
      html += summaryBlock('ÖNEMLI NOKTALAR', s.keyPoints, '');
    }
    if (s.actionItems?.length) {
      html += summaryBlock('YAPILACAKLAR', s.actionItems, 'summary-block--actions');
    }
    if (s.decisions?.length) {
      html += summaryBlock('ALINAN KARARLAR', s.decisions, 'summary-block--decisions');
    }
    dom.summaryContent.innerHTML = html;
  }

  function summaryBlock(title, items, cls) {
    return '<div class="summary-block ' + cls + '">' +
      '<h4 class="summary-block__heading">' + title + '</h4><ul>' +
      items.map((item) => '<li>' + esc(item) + '</li>').join('') +
      '</ul></div>';
  }

  // ═══════════════════════════════════════════════
  // LANGUAGE SELECTOR
  // ═══════════════════════════════════════════════

  dom.fetchLangsBtn.addEventListener('click', fetchLanguages);

  async function fetchLanguages() {
    if (!sessionId) return;

    dom.fetchLangsBtn.disabled = true;
    dom.fetchLangsBtn.innerHTML =
      '<span class="loading-ring" aria-hidden="true" style="width:12px;height:12px;border-width:1.5px"></span> YÜKLENİYOR';

    try {
      const res = await fetch('/api/languages/' + sessionId);
      const data = await res.json();

      if (!res.ok) {
        showError('Dil listesi alınamadı: ' + (data.error || 'Bilinmeyen hata'));
        return;
      }

      availableLanguages = data.languages || [];
      console.log('[LANG] Diller yüklendi:', availableLanguages.length);

      // UI'ı göster
      dom.langSearchWrap.classList.remove('hidden');
      dom.langList.classList.remove('hidden');

      renderLanguageList();
      showSuccess(availableLanguages.length + ' dil seçeneği yüklendi');

    } catch (err) {
      showError('Dil listesi alınamadı: ' + err.message);
    } finally {
      dom.fetchLangsBtn.disabled = false;
      dom.fetchLangsBtn.innerHTML =
        '<svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">' +
        '<path d="M6 1V3M6 9V11M1 6H3M9 6H11M2.05 2.05L3.46 3.46M8.54 8.54L9.95 9.95M2.05 9.95L3.46 8.54M8.54 3.46L9.95 2.05" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>' +
        '</svg> YENİLE';
    }
  }

  function renderLanguageList(filter) {
    if (!availableLanguages.length) {
      dom.langList.innerHTML = '<div class="lang-selector__empty">Diller yüklenmedi — YENİLE butonuna basın</div>';
      return;
    }

    const query = (filter || '').toLowerCase();
    const filtered = query
      ? availableLanguages.filter(l => l.toLowerCase().includes(query))
      : availableLanguages;

    if (!filtered.length) {
      dom.langList.innerHTML = '<div class="lang-selector__empty">Sonuç bulunamadı</div>';
      return;
    }

    dom.langList.innerHTML = filtered.map(lang => {
      const isActive = currentLanguage && lang.toLowerCase().includes(currentLanguage.toLowerCase());
      const isBeta = lang.includes('BETA');
      const displayName = lang.replace('BETA', '').trim();

      return '<div class="lang-item' + (isActive ? ' lang-item--active' : '') + '" ' +
        'role="option" data-lang="' + esc(lang) + '" ' +
        'aria-selected="' + (isActive ? 'true' : 'false') + '">' +
        '<span>' + esc(displayName) + '</span>' +
        '<span style="display:flex;align-items:center;gap:6px">' +
          (isBeta ? '<span class="lang-item__badge">BETA</span>' : '') +
          (isActive ? '<span class="lang-item__check">✓</span>' : '') +
        '</span>' +
      '</div>';
    }).join('');

    // Click event'leri
    dom.langList.querySelectorAll('.lang-item').forEach(el => {
      el.addEventListener('click', () => changeLanguage(el.dataset.lang));
    });
  }

  // Arama filtresi
  dom.langSearch.addEventListener('input', (e) => {
    renderLanguageList(e.target.value);
  });

  async function changeLanguage(language) {
    if (!sessionId || !language) return;

    // Loading state
    const items = dom.langList.querySelectorAll('.lang-item');
    items.forEach(el => {
      if (el.dataset.lang === language) {
        el.style.opacity = '0.5';
        el.style.pointerEvents = 'none';
      }
    });

    showInfo('Dil değiştiriliyor: ' + language.replace('BETA', '').trim() + '…');

    try {
      const res = await fetch('/api/language/' + sessionId, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ language }),
      });

      const data = await res.json();

      if (!res.ok) {
        showError('Dil değiştirilemedi: ' + (data.error || 'Bilinmeyen hata'));
        return;
      }

      currentLanguage = language;
      dom.currentLangValue.textContent = language.replace('BETA', '').trim();
      renderLanguageList(dom.langSearch.value);
      showSuccess('Altyazı dili değiştirildi: ' + language.replace('BETA', '').trim());

    } catch (err) {
      showError('Dil değiştirilemedi: ' + err.message);
    } finally {
      items.forEach(el => {
        el.style.opacity = '';
        el.style.pointerEvents = '';
      });
    }
  }

  // Toplantıya katılınca otomatik dilleri yükle
  function autoFetchLanguages() {
    // in-meeting olduktan 3sn sonra dilleri yükle
    setTimeout(() => {
      if (sessionId && availableLanguages.length === 0) {
        fetchLanguages();
      }
    }, 3000);
  }

  // ═══════════════════════════════════════════════
  // UTILITIES
  // ═══════════════════════════════════════════════

  function esc(str) {
    if (!str) return '';
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }

})();
