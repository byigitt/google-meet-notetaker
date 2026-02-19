// ════════════════════════════════════════════════════════
// MEET NOTETAKER — MULTI-MEETING DASHBOARD CLIENT
// Buffer-inspired clean UI with multiple meeting support
// ════════════════════════════════════════════════════════

(function () {
  'use strict';

  // ── DOM ──
  const $ = (sel) => document.querySelector(sel);
  const dom = {
    // Announcer & Toast
    announcer:         $('#a11yAnnouncer'),
    toastContainer:    $('#toastContainer'),
    clock:             $('#clock'),
    connectionStatus:  $('#connectionStatus'),
    // Sidebar
    activeBadge:       $('#activeBadge'),
    completedBadge:    $('#completedBadge'),
    activeMeetingList: $('#activeMeetingList'),
    completedMeetingList: $('#completedMeetingList'),
    newMeetingBtn:     $('#newMeetingBtn'),
    // Main
    welcomeState:      $('#welcomeState'),
    welcomeNewBtn:     $('#welcomeNewBtn'),
    meetingDetail:     $('#meetingDetail'),
    backToWelcome:     $('#backToWelcome'),
    // Detail Header
    detailTitle:       $('#detailTitle'),
    detailLink:        $('#detailLink'),
    detailStatus:      $('#detailStatus'),
    // Stats
    detailParticipants: $('#detailParticipants'),
    detailCaptions:     $('#detailCaptions'),
    detailDuration:     $('#detailDuration'),
    detailLeaveBtn:     $('#detailLeaveBtn'),
    detailSummarizeBtn: $('#detailSummarizeBtn'),
    // Tabs
    tabTranscript:     $('#tabTranscript'),
    tabSummary:        $('#tabSummary'),
    tabLanguage:       $('#tabLanguage'),
    tabContentTranscript: $('#tabContentTranscript'),
    tabContentSummary:    $('#tabContentSummary'),
    tabContentLanguage:   $('#tabContentLanguage'),
    // Transcript
    transcriptFeed:    $('#transcriptFeed'),
    feedEmpty:         $('#feedEmpty'),
    // Summary
    summaryPlaceholder: $('#summaryPlaceholder'),
    summaryContent:     $('#summaryContent'),
    // Language
    currentLanguage:   $('#currentLanguage'),
    fetchLanguagesBtn: $('#fetchLanguagesBtn'),
    langSearchWrap:    $('#langSearchWrap'),
    langSearch:        $('#langSearch'),
    langList:          $('#langList'),
    // Modal
    modalOverlay:      $('#modalOverlay'),
    newMeetingModal:   $('#newMeetingModal'),
    modalClose:        $('#modalClose'),
    modalCancelBtn:    $('#modalCancelBtn'),
    joinForm:          $('#joinForm'),
    meetLink:          $('#meetLink'),
    joinBtn:           $('#joinBtn'),
    joinError:         $('#joinError'),
  };

  // ══════════════════════════════════════════════
  // STATE: Multi-meeting support
  // ══════════════════════════════════════════════

  /**
   * meetings = Map<sessionId, {
   *   id, meetLink, status, participants, transcriptCount,
   *   duration, startTime, transcript[], summary, languages[], currentLanguage
   * }>
   */
  const meetings = new Map();
  let selectedMeetingId = null;
  let durationTimers = new Map();

  // ══════════════════════════════════════════════
  // TOAST SYSTEM
  // ══════════════════════════════════════════════

  function showToast(message, type = 'info', durationMs = 5000) {
    const el = document.createElement('div');
    el.className = 'toast toast--' + type;
    el.textContent = message;
    dom.toastContainer.appendChild(el);
    setTimeout(() => {
      el.classList.add('toast--leaving');
      setTimeout(() => el.remove(), 350);
    }, durationMs);
    announce(message);
  }

  function showError(msg) { showToast(msg, 'error', 6000); }
  function showInfo(msg)  { showToast(msg, 'info', 4000); }
  function showSuccess(msg) { showToast(msg, 'success', 4000); }

  function announce(msg) {
    if (!dom.announcer) return;
    dom.announcer.textContent = '';
    requestAnimationFrame(() => { dom.announcer.textContent = msg; });
  }

  // ══════════════════════════════════════════════
  // CLOCK
  // ══════════════════════════════════════════════

  function tickClock() {
    dom.clock.textContent = new Date().toLocaleTimeString('tr-TR', {
      hour: '2-digit', minute: '2-digit',
    });
  }
  setInterval(tickClock, 1000);
  tickClock();

  // ══════════════════════════════════════════════
  // SOCKET.IO
  // ══════════════════════════════════════════════

  const socket = typeof io !== 'undefined' ? io() : null;

  if (socket) {
    socket.on('connect', () => {
      setConnection(true);
      console.log('[WS] Connected');
    });

    socket.on('disconnect', () => {
      setConnection(false);
      showError('Sunucu bağlantısı kesildi');
    });

    socket.on('status', (data) => {
      const m = meetings.get(data.sessionId);
      if (!m) return;
      m.status = data.status;
      if (data.status === 'in-meeting' && !m.startTime) {
        m.startTime = new Date();
        startDurationTimer(data.sessionId);
        autoFetchLanguages(data.sessionId);
        showSuccess(`Toplantıya katıldı: ${extractCode(m.meetLink)}`);
      }
      if (data.status === 'ended' || data.status === 'error') {
        stopDurationTimer(data.sessionId);
      }
      renderSidebar();
      if (selectedMeetingId === data.sessionId) {
        renderDetailHeader();
      }
    });

    socket.on('caption', (data) => {
      const m = meetings.get(data.sessionId);
      if (!m) return;
      m.transcript.push(data.entry);
      m.transcriptCount = m.transcript.length;
      // Track participant
      if (data.entry.speaker && !m.participants.includes(data.entry.speaker)) {
        m.participants.push(data.entry.speaker);
      }
      renderSidebar();
      if (selectedMeetingId === data.sessionId) {
        addTranscriptEntry(data.entry, m.transcript.length - 1);
        updateStats();
      }
    });

    socket.on('caption-update', (data) => {
      const m = meetings.get(data.sessionId);
      if (!m) return;
      if (data.index >= 0 && data.index < m.transcript.length) {
        m.transcript[data.index] = data.entry;
      }
      if (selectedMeetingId === data.sessionId) {
        updateTranscriptEntry(data.index, data.entry);
      }
    });

    socket.on('ended', (data) => {
      const m = meetings.get(data.sessionId);
      if (!m) return;
      m.status = 'ended';
      stopDurationTimer(data.sessionId);
      renderSidebar();
      if (selectedMeetingId === data.sessionId) {
        renderDetailHeader();
      }
      showInfo(`Toplantı sona erdi: ${extractCode(m.meetLink)}`);
    });

    socket.on('error', (data) => {
      const m = meetings.get(data.sessionId);
      if (m) {
        m.status = 'error';
        stopDurationTimer(data.sessionId);
        renderSidebar();
        if (selectedMeetingId === data.sessionId) {
          renderDetailHeader();
        }
      }
      showError(data.message || 'Bilinmeyen hata');
    });

    socket.on('language-changed', (data) => {
      const m = meetings.get(data.sessionId);
      if (!m) return;
      m.currentLanguage = data.language;
      if (selectedMeetingId === data.sessionId) {
        dom.currentLanguage.textContent = data.language;
        renderLanguageList(data.sessionId);
      }
      showSuccess('Dil değiştirildi: ' + data.language);
    });
  } else {
    showError('Socket.IO yüklenemedi — sunucu çalışıyor mu?');
  }

  function setConnection(online) {
    dom.connectionStatus.classList.toggle('online', online);
    dom.connectionStatus.querySelector('.connection-text').textContent =
      online ? 'Bağlı' : 'Bağlantı yok';
  }

  // ══════════════════════════════════════════════
  // MODAL: New Meeting
  // ══════════════════════════════════════════════

  function openModal() {
    dom.modalOverlay.classList.remove('hidden');
    dom.meetLink.value = '';
    dom.joinError.classList.add('hidden');
    dom.joinBtn.disabled = false;
    dom.joinBtn.innerHTML = svgIcon('launch') + ' Katıl';
    dom.meetLink.focus();
  }

  function closeModal() {
    dom.modalOverlay.classList.add('hidden');
  }

  dom.newMeetingBtn.addEventListener('click', openModal);
  dom.welcomeNewBtn.addEventListener('click', openModal);
  dom.modalClose.addEventListener('click', closeModal);
  dom.modalCancelBtn.addEventListener('click', closeModal);

  dom.modalOverlay.addEventListener('click', (e) => {
    if (e.target === dom.modalOverlay) closeModal();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !dom.modalOverlay.classList.contains('hidden')) {
      closeModal();
    }
  });

  // ══════════════════════════════════════════════
  // JOIN FORM
  // ══════════════════════════════════════════════

  function normalizeMeetLink(raw) {
    let link = raw.trim();
    if (!link) return '';
    if (link.startsWith('meet.google.com')) link = 'https://' + link;
    if (!link.includes('meet.google.com/')) return '';
    return link;
  }

  function extractCode(link) {
    if (!link) return '—';
    const match = link.match(/meet\.google\.com\/([a-z0-9-]+)/i);
    return match ? match[1] : link.replace(/https?:\/\//, '').substring(0, 30);
  }

  dom.joinForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    dom.joinError.classList.add('hidden');

    const rawLink = dom.meetLink.value;
    const link = normalizeMeetLink(rawLink);

    if (!link) {
      dom.joinError.textContent = 'Geçerli bir Google Meet linki girin';
      dom.joinError.classList.remove('hidden');
      return;
    }

    // Set loading
    dom.joinBtn.disabled = true;
    dom.joinBtn.innerHTML = '<span class="loading-ring loading-ring--white"></span> Katılınıyor…';

    try {
      const res = await fetch('/api/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ meetLink: link }),
      });

      const data = await res.json();

      if (!res.ok) {
        dom.joinError.textContent = data.error || 'Sunucu hatası';
        dom.joinError.classList.remove('hidden');
        dom.joinBtn.disabled = false;
        dom.joinBtn.innerHTML = svgIcon('launch') + ' Katıl';
        return;
      }

      // Create meeting entry
      const meeting = {
        id: data.sessionId,
        meetLink: link,
        status: 'joining',
        participants: [],
        transcriptCount: 0,
        duration: '00:00',
        startTime: null,
        transcript: [],
        summary: null,
        languages: [],
        currentLanguage: null,
      };

      meetings.set(data.sessionId, meeting);
      startDurationTimer(data.sessionId);

      closeModal();
      selectMeeting(data.sessionId);
      renderSidebar();
      showInfo('Bot toplantıya katılıyor…');

    } catch (err) {
      dom.joinError.textContent = 'Sunucuya bağlanılamadı: ' + err.message;
      dom.joinError.classList.remove('hidden');
      dom.joinBtn.disabled = false;
      dom.joinBtn.innerHTML = svgIcon('launch') + ' Katıl';
    }
  });

  // ══════════════════════════════════════════════
  // SIDEBAR RENDERING
  // ══════════════════════════════════════════════

  function renderSidebar() {
    const active = [];
    const completed = [];

    meetings.forEach((m) => {
      if (m.status === 'ended' || m.status === 'error') {
        completed.push(m);
      } else {
        active.push(m);
      }
    });

    dom.activeBadge.textContent = active.length;
    dom.completedBadge.textContent = completed.length;

    // Active meetings
    if (active.length === 0) {
      dom.activeMeetingList.innerHTML =
        '<div class="meeting-list__empty">' +
          '<svg width="20" height="20" viewBox="0 0 20 20" fill="none">' +
            '<circle cx="10" cy="10" r="8" stroke="var(--gray-300)" stroke-width="1.5" stroke-dasharray="3 3"/>' +
            '<path d="M10 7V13M7 10H13" stroke="var(--gray-300)" stroke-width="1.5" stroke-linecap="round"/>' +
          '</svg>' +
          '<span>Henüz aktif toplantı yok</span>' +
        '</div>';
    } else {
      dom.activeMeetingList.innerHTML = active.map(m => meetingItemHTML(m)).join('');
      bindMeetingItemClicks(dom.activeMeetingList);
    }

    // Completed meetings
    if (completed.length === 0) {
      dom.completedMeetingList.innerHTML =
        '<div class="meeting-list__empty"><span>Tamamlanan toplantı yok</span></div>';
    } else {
      dom.completedMeetingList.innerHTML = completed.map(m => meetingItemHTML(m)).join('');
      bindMeetingItemClicks(dom.completedMeetingList);
    }
  }

  function meetingItemHTML(m) {
    const isSelected = selectedMeetingId === m.id;
    const code = extractCode(m.meetLink);
    const statusLabels = {
      'joining': 'Katılınıyor…',
      'waiting': 'Kabul bekleniyor…',
      'in-meeting': 'Toplantıda',
      'ended': 'Sona erdi',
      'error': 'Hata',
    };

    return `<div class="meeting-item${isSelected ? ' meeting-item--active' : ''}" data-id="${esc(m.id)}">
      <span class="meeting-item__dot meeting-item__dot--${esc(m.status)}"></span>
      <div class="meeting-item__info">
        <div class="meeting-item__code">${esc(code)}</div>
        <div class="meeting-item__meta">${esc(statusLabels[m.status] || m.status)}</div>
      </div>
      <span class="meeting-item__count">${m.transcriptCount}</span>
    </div>`;
  }

  function bindMeetingItemClicks(container) {
    container.querySelectorAll('.meeting-item').forEach(el => {
      el.addEventListener('click', () => {
        selectMeeting(el.dataset.id);
      });
    });
  }

  // ══════════════════════════════════════════════
  // MEETING SELECTION & DETAIL VIEW
  // ══════════════════════════════════════════════

  function selectMeeting(id) {
    selectedMeetingId = id;

    dom.welcomeState.classList.add('hidden');
    dom.meetingDetail.classList.remove('hidden');

    renderDetailHeader();
    renderTranscript();
    renderSummaryTab();
    renderLanguageTab();
    updateStats();
    renderSidebar();

    // Switch to transcript tab
    switchTab('transcript');

    // Start polling
    startPolling(id);
  }

  function deselectMeeting() {
    selectedMeetingId = null;
    dom.welcomeState.classList.remove('hidden');
    dom.meetingDetail.classList.add('hidden');
    renderSidebar();
    stopPolling();
  }

  dom.backToWelcome.addEventListener('click', deselectMeeting);

  function renderDetailHeader() {
    const m = meetings.get(selectedMeetingId);
    if (!m) return;

    const code = extractCode(m.meetLink);
    dom.detailTitle.textContent = code;
    dom.detailLink.textContent = m.meetLink;

    // Status pill
    const statusLabels = {
      'joining': 'Katılınıyor',
      'waiting': 'Kabul Bekleniyor',
      'in-meeting': 'Toplantıda',
      'ended': 'Sona Erdi',
      'error': 'Hata',
    };

    dom.detailStatus.className = 'status-pill status-pill--' + m.status;
    dom.detailStatus.innerHTML =
      '<span class="status-pill__dot"></span>' +
      '<span class="status-pill__text">' + esc(statusLabels[m.status] || m.status) + '</span>';

    // Leave button visibility
    const canLeave = m.status === 'joining' || m.status === 'waiting' || m.status === 'in-meeting';
    dom.detailLeaveBtn.style.display = canLeave ? '' : 'none';
  }

  function updateStats() {
    const m = meetings.get(selectedMeetingId);
    if (!m) return;

    dom.detailParticipants.textContent = m.participants.length;
    dom.detailCaptions.textContent = m.transcriptCount;
    dom.detailDuration.textContent = m.duration || '00:00';
  }

  // ══════════════════════════════════════════════
  // DURATION TIMERS (per meeting)
  // ══════════════════════════════════════════════

  function startDurationTimer(sessionId) {
    stopDurationTimer(sessionId);
    const m = meetings.get(sessionId);
    if (!m) return;

    if (!m.startTime) m.startTime = new Date();

    const timer = setInterval(() => {
      const m2 = meetings.get(sessionId);
      if (!m2 || !m2.startTime) return;
      const diff = Date.now() - m2.startTime.getTime();
      const mins = Math.floor(diff / 60000);
      const secs = Math.floor((diff % 60000) / 1000);
      m2.duration = String(mins).padStart(2, '0') + ':' + String(secs).padStart(2, '0');
      if (selectedMeetingId === sessionId) {
        dom.detailDuration.textContent = m2.duration;
      }
    }, 1000);

    durationTimers.set(sessionId, timer);
  }

  function stopDurationTimer(sessionId) {
    const timer = durationTimers.get(sessionId);
    if (timer) {
      clearInterval(timer);
      durationTimers.delete(sessionId);
    }
  }

  // ══════════════════════════════════════════════
  // TABS
  // ══════════════════════════════════════════════

  function switchTab(tabName) {
    [dom.tabTranscript, dom.tabSummary, dom.tabLanguage].forEach(t => t.classList.remove('tab--active'));
    [dom.tabContentTranscript, dom.tabContentSummary, dom.tabContentLanguage].forEach(c => c.classList.add('hidden'));

    switch (tabName) {
      case 'transcript':
        dom.tabTranscript.classList.add('tab--active');
        dom.tabContentTranscript.classList.remove('hidden');
        break;
      case 'summary':
        dom.tabSummary.classList.add('tab--active');
        dom.tabContentSummary.classList.remove('hidden');
        break;
      case 'language':
        dom.tabLanguage.classList.add('tab--active');
        dom.tabContentLanguage.classList.remove('hidden');
        break;
    }
  }

  dom.tabTranscript.addEventListener('click', () => switchTab('transcript'));
  dom.tabSummary.addEventListener('click', () => switchTab('summary'));
  dom.tabLanguage.addEventListener('click', () => switchTab('language'));

  // ══════════════════════════════════════════════
  // TRANSCRIPT
  // ══════════════════════════════════════════════

  function renderTranscript() {
    const m = meetings.get(selectedMeetingId);
    if (!m) return;

    dom.transcriptFeed.innerHTML = '';

    if (m.transcript.length === 0) {
      dom.transcriptFeed.innerHTML =
        '<div class="feed-empty" id="feedEmpty">' +
          '<div class="feed-empty__icon">' +
            '<svg width="32" height="32" viewBox="0 0 32 32" fill="none">' +
              '<rect x="4" y="8" width="24" height="16" rx="4" stroke="var(--gray-300)" stroke-width="1.5"/>' +
              '<path d="M10 15H16M10 19H22" stroke="var(--gray-300)" stroke-width="1.5" stroke-linecap="round"/>' +
            '</svg>' +
          '</div>' +
          '<span>Konuşma bekleniyor…</span>' +
        '</div>';
      return;
    }

    m.transcript.forEach((entry, idx) => {
      addTranscriptEntry(entry, idx, false);
    });

    // Scroll to bottom
    dom.transcriptFeed.scrollTop = dom.transcriptFeed.scrollHeight;
  }

  function addTranscriptEntry(entry, index, animate = true) {
    // Remove empty state
    const empty = dom.transcriptFeed.querySelector('.feed-empty');
    if (empty) empty.remove();

    const el = document.createElement('div');
    el.className = 'transcript-entry' + (animate ? ' transcript-entry--highlight' : '');
    el.dataset.index = String(index);

    const time = new Date(entry.startTime || Date.now());
    const timeStr = time.toLocaleTimeString('tr-TR', {
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });

    el.innerHTML =
      '<div class="transcript-entry__time">' + esc(timeStr) + '</div>' +
      '<div class="transcript-entry__body">' +
        '<div class="transcript-entry__speaker">' + esc(entry.speaker) + '</div>' +
        '<div class="transcript-entry__text">' + esc(entry.text) + '</div>' +
      '</div>';

    dom.transcriptFeed.appendChild(el);
    dom.transcriptFeed.scrollTop = dom.transcriptFeed.scrollHeight;

    if (animate) {
      setTimeout(() => el.classList.remove('transcript-entry--highlight'), 2500);
    }
  }

  function updateTranscriptEntry(index, entry) {
    const el = dom.transcriptFeed.querySelector('[data-index="' + index + '"]');
    if (!el) return;
    const textEl = el.querySelector('.transcript-entry__text');
    if (textEl) textEl.textContent = entry.text;
  }

  // ══════════════════════════════════════════════
  // LEAVE
  // ══════════════════════════════════════════════

  dom.detailLeaveBtn.addEventListener('click', async () => {
    if (!selectedMeetingId) return;
    if (!confirm('Bu toplantıdan ayrılmak istediğinize emin misiniz?')) return;

    dom.detailLeaveBtn.disabled = true;
    try {
      await fetch('/api/leave/' + selectedMeetingId, { method: 'POST' });
      const m = meetings.get(selectedMeetingId);
      if (m) m.status = 'ended';
      renderDetailHeader();
      renderSidebar();
      showInfo('Toplantıdan ayrılındı');
    } catch (err) {
      showError('Ayrılma hatası: ' + err.message);
    } finally {
      dom.detailLeaveBtn.disabled = false;
    }
  });

  // ══════════════════════════════════════════════
  // SUMMARIZE
  // ══════════════════════════════════════════════

  dom.detailSummarizeBtn.addEventListener('click', async () => {
    if (!selectedMeetingId) return;

    dom.detailSummarizeBtn.disabled = true;
    dom.detailSummarizeBtn.innerHTML = '<span class="loading-ring loading-ring--white"></span> Oluşturuluyor…';
    showInfo('AI özet oluşturuluyor…');

    try {
      const res = await fetch('/api/summarize/' + selectedMeetingId, { method: 'POST' });
      const summary = await res.json();

      if (!res.ok) {
        showError('Özet hatası: ' + (summary.error || 'Bilinmeyen hata'));
        return;
      }

      const m = meetings.get(selectedMeetingId);
      if (m) m.summary = summary;

      renderSummaryContent(summary);
      switchTab('summary');
      showSuccess('Toplantı özeti hazır!');

    } catch (err) {
      showError('Özet hatası: ' + err.message);
    } finally {
      dom.detailSummarizeBtn.disabled = false;
      dom.detailSummarizeBtn.innerHTML =
        '<svg width="14" height="14" viewBox="0 0 14 14" fill="none">' +
          '<path d="M3 2H11C11.5523 2 12 2.44772 12 3V11C12 11.5523 11.5523 12 11 12H3C2.44772 12 2 11.5523 2 11V3C2 2.44772 2.44772 2 3 2Z" stroke="currentColor" stroke-width="1.5"/>' +
          '<path d="M5 5.5H9M5 8.5H7.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>' +
        '</svg> AI Özet';
    }
  });

  function renderSummaryTab() {
    const m = meetings.get(selectedMeetingId);
    if (!m || !m.summary) {
      dom.summaryPlaceholder.classList.remove('hidden');
      dom.summaryContent.classList.add('hidden');
      return;
    }
    renderSummaryContent(m.summary);
  }

  function renderSummaryContent(s) {
    dom.summaryPlaceholder.classList.add('hidden');
    dom.summaryContent.classList.remove('hidden');

    let html = '';
    html += '<h3 class="summary__title">' + esc(s.title) + '</h3>';
    html += '<div class="summary__meta">';
    html += '<span class="summary__meta-item"><strong>Tarih:</strong> ' + esc(s.date) + '</span>';
    html += '<span class="summary__meta-item"><strong>Süre:</strong> ' + esc(s.duration) + '</span>';
    html += '<span class="summary__meta-item"><strong>Katılımcı:</strong> ' + esc(s.participants?.join(', ') || '—') + '</span>';
    html += '</div>';

    if (s.summary) {
      html += '<div class="summary__text">' + esc(s.summary).replace(/\n/g, '<br>') + '</div>';
    }
    if (s.keyPoints?.length) {
      html += summarySection('Önemli Noktalar', s.keyPoints, '');
    }
    if (s.actionItems?.length) {
      html += summarySection('Yapılacaklar', s.actionItems, 'summary__section--actions');
    }
    if (s.decisions?.length) {
      html += summarySection('Alınan Kararlar', s.decisions, 'summary__section--decisions');
    }

    dom.summaryContent.innerHTML = html;
  }

  function summarySection(title, items, cls) {
    return '<div class="summary__section ' + cls + '">' +
      '<h4 class="summary__section-heading">' + esc(title) + '</h4>' +
      '<ul class="summary__list">' +
      items.map(item => '<li>' + esc(item) + '</li>').join('') +
      '</ul></div>';
  }

  // ══════════════════════════════════════════════
  // LANGUAGE
  // ══════════════════════════════════════════════

  dom.fetchLanguagesBtn.addEventListener('click', () => {
    if (selectedMeetingId) fetchLanguages(selectedMeetingId);
  });

  async function fetchLanguages(sessionId) {
    dom.fetchLanguagesBtn.disabled = true;
    dom.fetchLanguagesBtn.innerHTML = '<span class="loading-ring"></span> Yükleniyor…';

    try {
      const res = await fetch('/api/languages/' + sessionId);
      const data = await res.json();

      if (!res.ok) {
        showError('Dil listesi alınamadı: ' + (data.error || 'Bilinmeyen hata'));
        return;
      }

      const m = meetings.get(sessionId);
      if (m) m.languages = data.languages || [];

      dom.langSearchWrap.classList.remove('hidden');
      dom.langList.classList.remove('hidden');

      renderLanguageList(sessionId);
      showSuccess((data.languages?.length || 0) + ' dil seçeneği yüklendi');

    } catch (err) {
      showError('Dil listesi alınamadı: ' + err.message);
    } finally {
      dom.fetchLanguagesBtn.disabled = false;
      dom.fetchLanguagesBtn.innerHTML =
        '<svg width="14" height="14" viewBox="0 0 14 14" fill="none">' +
          '<path d="M1.5 7C1.5 3.96 3.96 1.5 7 1.5C9.1 1.5 10.9 2.7 11.7 4.5M12.5 7C12.5 10.04 10.04 12.5 7 12.5C4.9 12.5 3.1 11.3 2.3 9.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>' +
          '<path d="M11 2V5H8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>' +
          '<path d="M3 12V9H6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>' +
        '</svg> Dilleri Yükle';
    }
  }

  function renderLanguageTab() {
    const m = meetings.get(selectedMeetingId);
    if (!m) return;

    dom.currentLanguage.textContent = m.currentLanguage || '—';

    if (m.languages.length > 0) {
      dom.langSearchWrap.classList.remove('hidden');
      dom.langList.classList.remove('hidden');
      renderLanguageList(selectedMeetingId);
    } else {
      dom.langSearchWrap.classList.add('hidden');
      dom.langList.classList.add('hidden');
    }
  }

  function renderLanguageList(sessionId, filter) {
    const m = meetings.get(sessionId);
    if (!m || !m.languages.length) {
      dom.langList.innerHTML = '<div class="language-panel__empty">Diller yüklenmedi</div>';
      return;
    }

    const query = (filter || '').toLowerCase();
    const filtered = query
      ? m.languages.filter(l => l.toLowerCase().includes(query))
      : m.languages;

    if (!filtered.length) {
      dom.langList.innerHTML = '<div class="language-panel__empty">Sonuç bulunamadı</div>';
      return;
    }

    dom.langList.innerHTML = filtered.map(lang => {
      const isActive = m.currentLanguage && lang.toLowerCase().includes(m.currentLanguage.toLowerCase());
      const isBeta = lang.includes('BETA');
      const displayName = lang.replace('BETA', '').trim();

      return `<div class="lang-option${isActive ? ' lang-option--active' : ''}" 
        role="option" data-lang="${esc(lang)}" aria-selected="${isActive}">
        <span>${esc(displayName)}</span>
        <span style="display:flex;align-items:center;gap:6px">
          ${isBeta ? '<span class="lang-option__badge">BETA</span>' : ''}
          ${isActive ? '<span class="lang-option__check">✓</span>' : ''}
        </span>
      </div>`;
    }).join('');

    dom.langList.querySelectorAll('.lang-option').forEach(el => {
      el.addEventListener('click', () => changeLanguage(sessionId, el.dataset.lang));
    });
  }

  dom.langSearch.addEventListener('input', (e) => {
    if (selectedMeetingId) renderLanguageList(selectedMeetingId, e.target.value);
  });

  async function changeLanguage(sessionId, language) {
    if (!sessionId || !language) return;

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

      const m = meetings.get(sessionId);
      if (m) m.currentLanguage = language;
      dom.currentLanguage.textContent = language.replace('BETA', '').trim();
      renderLanguageList(sessionId, dom.langSearch.value);
      showSuccess('Dil değiştirildi: ' + language.replace('BETA', '').trim());

    } catch (err) {
      showError('Dil değiştirilemedi: ' + err.message);
    }
  }

  function autoFetchLanguages(sessionId) {
    setTimeout(() => {
      const m = meetings.get(sessionId);
      if (m && m.languages.length === 0 && selectedMeetingId === sessionId) {
        fetchLanguages(sessionId);
      }
    }, 3000);
  }

  // ══════════════════════════════════════════════
  // STATUS POLLING
  // ══════════════════════════════════════════════

  let pollTimer = null;

  function startPolling(sessionId) {
    stopPolling();
    pollTimer = setInterval(async () => {
      const m = meetings.get(sessionId);
      if (!m) return;
      if (m.status === 'ended' || m.status === 'error') {
        stopPolling();
        return;
      }
      try {
        const res = await fetch('/api/status/' + sessionId);
        if (!res.ok) return;
        const data = await res.json();
        m.participants = data.participants || [];
        m.transcriptCount = data.transcriptCount || 0;
        if (selectedMeetingId === sessionId) updateStats();
        renderSidebar();
      } catch { /* silent */ }
    }, 3000);
  }

  function stopPolling() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  // ══════════════════════════════════════════════
  // LOAD EXISTING MEETINGS FROM SERVER
  // ══════════════════════════════════════════════

  async function loadExistingMeetings() {
    try {
      const res = await fetch('/api/meetings');
      if (!res.ok) return;
      const data = await res.json();

      // Active meetings
      (data.active || []).forEach(m => {
        if (!meetings.has(m.id)) {
          meetings.set(m.id, {
            id: m.id,
            meetLink: m.meetLink,
            status: m.status,
            participants: m.participants || [],
            transcriptCount: m.transcriptCount || 0,
            duration: m.duration || '00:00',
            startTime: m.status === 'in-meeting' ? new Date() : null,
            transcript: [],
            summary: null,
            languages: [],
            currentLanguage: null,
          });
          if (m.status !== 'ended' && m.status !== 'error') {
            startDurationTimer(m.id);
          }
        }
      });

      // Completed meetings
      (data.completed || []).forEach(m => {
        if (!meetings.has(m.id)) {
          meetings.set(m.id, {
            id: m.id,
            meetLink: m.meetLink,
            status: m.status || 'ended',
            participants: m.participants || [],
            transcriptCount: m.transcript?.length || 0,
            duration: '—',
            startTime: m.startTime ? new Date(m.startTime) : null,
            transcript: m.transcript || [],
            summary: m.summary || null,
            languages: [],
            currentLanguage: null,
          });
        }
      });

      renderSidebar();
    } catch { /* silent */ }
  }

  // Load on startup
  loadExistingMeetings();

  // ══════════════════════════════════════════════
  // HELPERS
  // ══════════════════════════════════════════════

  function esc(str) {
    if (!str) return '';
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }

  function svgIcon(type) {
    if (type === 'launch') {
      return '<svg width="16" height="16" viewBox="0 0 16 16" fill="none">' +
        '<path d="M3 13L13 3M13 3H5M13 3V11" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>' +
        '</svg>';
    }
    return '';
  }

})();
