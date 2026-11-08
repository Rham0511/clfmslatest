(() => {
  if (window.__COMLAB_QR_SCANNER_BUTTON_INITIALIZED__) return;

  const rawUserRole = String(window.__CURRENT_USER__?.role || window.__CURRENT_USER_ROLE__ || '')
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, '');
  const userRole = rawUserRole.includes('superadmin') ? 'superadmin'
    : rawUserRole.includes('admin') ? 'admin'
      : rawUserRole.includes('technician') ? 'technician'
        : ['faculty', 'instructor'].includes(rawUserRole) ? rawUserRole
          : rawUserRole === 'student' ? 'student' : '';
  const roleFromPage = document.body.matches('.admin-shell') ? 'admin'
    : document.body.matches('.technician-portal') ? 'technician'
      : document.body.matches('.faculty-portal, .faculty-page') ? 'faculty'
        : document.body.matches('.student-portal') ? 'student' : '';
  const role = userRole || roleFromPage;
  if (!role || !['admin', 'superadmin', 'technician', 'faculty', 'instructor', 'student'].includes(role)) return;
  const isAdminRole = role === 'admin' || role === 'superadmin';

  window.__COMLAB_QR_SCANNER_BUTTON_INITIALIZED__ = true;
  document.getElementById('qr-scan-float-btn')?.remove();
  document.getElementById('qr-scanner-modal')?.remove();

  const button = document.createElement('button');
  button.id = 'qr-scan-float-btn';
  button.type = 'button';
  button.setAttribute('aria-label', 'Scan a ComLab QR code');
  button.setAttribute('aria-haspopup', 'dialog');
  button.setAttribute('aria-expanded', 'false');
  button.title = 'Scan a ComLab QR code';
  button.innerHTML = '<i class="fas fa-qrcode" aria-hidden="true"></i>';

  const helpButton = document.createElement('button');
  helpButton.id = 'comlab-help-float-btn';
  helpButton.type = 'button';
  helpButton.setAttribute('aria-label', 'Open ComLab Help');
  helpButton.setAttribute('aria-haspopup', 'dialog');
  helpButton.setAttribute('aria-expanded', 'false');
  helpButton.setAttribute('aria-controls', 'comlab-help-panel');
  helpButton.title = 'ComLab Help';
  helpButton.innerHTML = '<i class="fas fa-comment-dots" aria-hidden="true"></i>';

  const helpPanel = document.createElement('section');
  helpPanel.id = 'comlab-help-panel';
  helpPanel.setAttribute('role', 'dialog');
  helpPanel.setAttribute('aria-labelledby', 'comlab-help-title');
  helpPanel.hidden = true;
  helpPanel.innerHTML = `
    <header class="comlab-help-header">
      <div>
        <h2 id="comlab-help-title">ComLab Help</h2>
        <p>Role-specific help</p>
      </div>
      <div class="comlab-help-header-actions">
        <button type="button" class="comlab-help-new" aria-label="Start a new chat" title="New chat"><i class="fas fa-plus" aria-hidden="true"></i><span>New</span></button>
        <button type="button" class="comlab-help-history-toggle" aria-label="View chat history" title="History"><i class="fas fa-clock-rotate-left" aria-hidden="true"></i><span>History</span></button>
        <button type="button" class="comlab-help-close" aria-label="Close ComLab Help"><i class="fas fa-xmark" aria-hidden="true"></i></button>
      </div>
    </header>
    <div class="comlab-help-history" hidden>
      <div class="comlab-help-history-heading">
        <button type="button" class="comlab-help-back"><i class="fas fa-arrow-left" aria-hidden="true"></i> Chat</button>
        <strong>Chat history</strong>
      </div>
      <div class="comlab-help-history-list" role="list"></div>
    </div>
    <div class="comlab-help-messages" role="log" aria-live="polite" aria-relevant="additions">
      <p class="comlab-help-message comlab-help-answer">Ask about ComLab tasks available to your account.</p>
    </div>
    <form class="comlab-help-form">
      <input id="comlab-help-question" name="question" type="text" maxlength="500" autocomplete="off" aria-label="Ask ComLab Help" placeholder="Ask a question…" required>
      <button type="submit" aria-label="Send question"><i class="fas fa-paper-plane" aria-hidden="true"></i></button>
    </form>
  `;

  const scannerDescription = isAdminRole
    ? 'Scan an equipment QR code to view its borrow cycle and current borrower.'
    : 'Scan equipment, attendance, or PC station QR codes.';

  const modal = document.createElement('div');
  modal.id = 'qr-scanner-modal';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-labelledby', 'qr-scanner-title');
  modal.innerHTML = `
    <section class="qr-scanner-dialog">
      <div class="qr-scanner-title-row">
        <div>
          <h2 id="qr-scanner-title"><i class="fas fa-qrcode" aria-hidden="true"></i> Scan QR code</h2>
          <p class="qr-scanner-description">${scannerDescription}</p>
        </div>
        <button type="button" class="qr-scanner-close" aria-label="Close QR scanner"><i class="fas fa-xmark" aria-hidden="true"></i></button>
      </div>
      <div class="qr-reader-frame">
        <div id="qr-reader"></div>
        <section id="qr-pc-station-result" hidden aria-live="assertive">
          <div id="qr-pc-station-result-card" class="qr-pc-station-result-card" data-state="occupied">
            <span id="qr-pc-station-result-label">STATION IN USE</span>
            <h3 id="qr-pc-station-result-name"></h3>
            <p id="qr-pc-station-result-message"></p>
          </div>
          <button id="qr-pc-station-scan-again" type="button"><i class="fas fa-qrcode" aria-hidden="true"></i> Scan another PC station</button>
        </section>
      </div>
      <p id="qr-scan-status" role="status" aria-live="polite">Starting camera…</p>
      <section id="qr-admin-equipment-result" hidden aria-live="polite">
        <header class="qr-admin-equipment-heading">
          <h3 id="qr-admin-equipment-name"></h3>
          <p id="qr-admin-equipment-id"></p>
        </header>
        <div class="qr-admin-current-holder">
          <span class="qr-admin-result-label">CURRENTLY BORROWED BY</span>
          <div id="qr-admin-current-holder-name"></div>
        </div>
        <div class="qr-admin-cycle-section">
          <h4>Borrow cycle</h4>
          <ol id="qr-admin-cycle-list"></ol>
        </div>
        <button id="qr-admin-scan-again" type="button"><i class="fas fa-qrcode" aria-hidden="true"></i> Scan another item</button>
      </section>
    </section>
  `;

  document.body.append(button, helpButton, helpPanel, modal);

  const status = modal.querySelector('#qr-scan-status');
  const closeButton = modal.querySelector('.qr-scanner-close');
  const reader = modal.querySelector('#qr-reader');
  const adminResult = modal.querySelector('#qr-admin-equipment-result');
  const adminScanAgainButton = modal.querySelector('#qr-admin-scan-again');
  const stationResult = modal.querySelector('#qr-pc-station-result');
  const stationScanAgainButton = modal.querySelector('#qr-pc-station-scan-again');
  const helpCloseButton = helpPanel.querySelector('.comlab-help-close');
  const newChatButton = helpPanel.querySelector('.comlab-help-new');
  const historyButton = helpPanel.querySelector('.comlab-help-history-toggle');
  const backToChatButton = helpPanel.querySelector('.comlab-help-back');
  const historyPanel = helpPanel.querySelector('.comlab-help-history');
  const historyList = helpPanel.querySelector('.comlab-help-history-list');
  const helpForm = helpPanel.querySelector('.comlab-help-form');
  const helpInput = helpPanel.querySelector('#comlab-help-question');
  const helpMessages = helpPanel.querySelector('.comlab-help-messages');
  const visualViewport = window.visualViewport;
  let scanner = null;
  let scannerLibraryPromise = null;
  let startPromise = null;
  let handlingResult = false;
  let previousBodyOverflow = '';
  let activeHelpChatId = null;
  let helpChats = [];

  function loadScannerLibrary() {
    if (window.Html5Qrcode) return Promise.resolve();
    if (scannerLibraryPromise) return scannerLibraryPromise;

    scannerLibraryPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js';
      script.onload = () => window.Html5Qrcode
        ? resolve()
        : reject(new Error('The QR scanner could not start. Please try again.'));
      script.onerror = () => reject(new Error('Unable to load the QR scanner. Check your internet connection and try again.'));
      document.head.append(script);
    }).catch((error) => {
      scannerLibraryPromise = null;
      throw error;
    });

    return scannerLibraryPromise;
  }

  async function stopScanner() {
    if (!scanner) return;
    const activeScanner = scanner;
    try {
      if (activeScanner.isScanning) await activeScanner.stop();
    } catch (error) {
      console.warn('Unable to stop the QR camera cleanly.', error);
    }
  }

  async function closeScanner() {
    button.setAttribute('aria-expanded', 'false');
    modal.classList.remove('is-open');
    document.body.style.overflow = previousBodyOverflow;
    await stopScanner();
    button.focus({ preventScroll: true });
  }

  function setStatus(message, isError = false) {
    status.textContent = message;
    status.dataset.state = isError ? 'error' : 'info';
    status.hidden = false;
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (character) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[character]);
  }

  function formatBorrowCycleDate(dateValue, timeValue, fallbackValue) {
    const dateText = String(dateValue || '').slice(0, 10);
    const timeText = String(timeValue || '').slice(0, 5);
    const timestamp = dateText
      ? new Date(`${dateText}T${timeText || '00:00'}:00+08:00`)
      : fallbackValue ? new Date(fallbackValue) : null;
    if (!timestamp || Number.isNaN(timestamp.getTime())) return 'Date unavailable';
    return new Intl.DateTimeFormat('en-PH', {
      timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short'
    }).format(timestamp);
  }

  async function showAdminEquipmentCycle(destination) {
    setStatus('Loading equipment borrow cycle…');
    let equipmentId = destination.equipmentId;

    if (destination.token) {
      const resolveResponse = await fetch(`/api/equipment/qr/${encodeURIComponent(destination.token)}/resolve`, {
        cache: 'no-store',
        credentials: 'same-origin'
      });
      const resolved = await resolveResponse.json().catch(() => ({}));
      if (!resolveResponse.ok) throw new Error(resolved.error || 'Unable to find this equipment.');
      equipmentId = resolved.equipmentId;
    }

    if (!equipmentId) throw new Error('The equipment QR code did not contain a valid item ID.');

    const cycleResponse = await fetch(`/api/equipment/${encodeURIComponent(equipmentId)}/borrow-cycle`, {
      cache: 'no-store',
      credentials: 'same-origin'
    });
    const data = await cycleResponse.json().catch(() => ({}));
    if (!cycleResponse.ok) throw new Error(data.error || 'Unable to load this item’s borrow cycle.');

    fetch(`/api/equipment/${encodeURIComponent(equipmentId)}/scan`, {
      method: 'POST',
      credentials: 'same-origin'
    }).catch((error) => console.warn('Unable to record equipment QR scan.', error));

    const equipment = data.equipment || {};
    const events = Array.isArray(data.events)
      ? data.events.filter((event) => event.type === 'borrowed')
      : [];
    const currentBorrowers = events.filter((event) => String(event.status || '').toLowerCase() === 'borrowed');

    modal.querySelector('#qr-admin-equipment-name').textContent = equipment.name || 'Equipment';
    modal.querySelector('#qr-admin-equipment-id').textContent = equipment.equipmentId || equipmentId;
    modal.querySelector('#qr-admin-current-holder-name').innerHTML = currentBorrowers.length
      ? currentBorrowers.map((event) => `<div class="qr-admin-holder-entry">${escapeHtml(event.borrowerName || 'Unknown borrower')}${event.borrowerCollege ? `<span>${escapeHtml(event.borrowerCollege)}</span>` : ''}</div>`).join('')
      : '<span class="qr-admin-not-borrowed">Not currently borrowed</span>';

    const cycleList = modal.querySelector('#qr-admin-cycle-list');
    cycleList.innerHTML = events.length
      ? events.slice().reverse().map((event) => {
        const isCurrent = String(event.status || '').toLowerCase() === 'borrowed';
        const statusLabel = isCurrent ? 'Currently borrowed' : String(event.status || 'Recorded');
        const borrowedDate = formatBorrowCycleDate(event.borrowDate, event.borrowStartTime, event.occurredAt);
        const returnDate = event.returnDate
          ? formatBorrowCycleDate(event.returnDate, event.returnTime)
          : '';
        return `<li class="qr-admin-cycle-event">
          <div class="qr-admin-cycle-event-heading">
            <strong>${escapeHtml(event.borrowerName || 'Unknown borrower')}</strong>
            <span class="${isCurrent ? 'is-current' : ''}">${escapeHtml(statusLabel)}</span>
          </div>
          <p>Borrowed ${escapeHtml(borrowedDate)}</p>
          ${returnDate ? `<p>Returned ${escapeHtml(returnDate)}</p>` : ''}
        </li>`;
      }).join('')
      : '<li class="qr-admin-cycle-empty">No borrow records for this item yet.</li>';

    await stopScanner();
    reader.hidden = true;
    adminResult.hidden = false;
    status.hidden = true;
  }

  function buildQrDestination(value) {
    const decoded = String(value || '').trim();
    if (!decoded) return null;

    let scannedUrl;
    try {
      scannedUrl = new URL(decoded, window.location.origin);
    } catch {
      return null;
    }

    const equipmentMatch = scannedUrl.pathname.match(/^\/equipment\/(?:uid|s)\/([A-Za-z0-9_-]+)\/?$/i);
    if (isAdminRole) {
      if (equipmentMatch) return { type: 'admin-equipment', token: equipmentMatch[1] };

      const legacyEquipmentMatch = scannedUrl.pathname.match(/^\/equipment\/view\/([A-Za-z0-9._-]{2,80})\/?$/i);
      if (legacyEquipmentMatch) return { type: 'admin-equipment', equipmentId: legacyEquipmentMatch[1] };

      if (/^[A-Za-z0-9][A-Za-z0-9._-]{1,79}$/.test(decoded)) {
        return { type: 'admin-equipment', equipmentId: decoded };
      }

      return { type: 'unsupported', message: 'This scanner only reads equipment QR codes for admin accounts.' };
    }

    if (equipmentMatch) {
      return { type: 'equipment-url', value: decoded, path: `/equipment/uid/${encodeURIComponent(equipmentMatch[1])}` };
    }

    const stationMatch = scannedUrl.pathname.match(/^\/pc-station\/uid\/([A-Za-z0-9_-]+)\/?$/i);
    if (stationMatch) {
      return {
        type: 'pc-station',
        token: stationMatch[1],
        path: `/pc-station/uid/${encodeURIComponent(stationMatch[1])}`
      };
    }

    const attendancePathMatch = scannedUrl.pathname.match(/^\/attendance\/scan\/([^/]+)\/?$/i);
    const attendanceToken = attendancePathMatch?.[1] ||
      (/^\/api\/attendance\/scan\/?$/i.test(scannedUrl.pathname) ? scannedUrl.searchParams.get('token') : '');
    if (attendanceToken) {
      if (role !== 'student') {
        return { type: 'unsupported', message: 'Attendance QR check-in is available through a student account.' };
      }
      return { type: 'navigate', path: `/attendance/scan/${encodeURIComponent(attendanceToken)}` };
    }

    if (/^[A-Za-z0-9][A-Za-z0-9._-]{1,79}$/.test(decoded)) {
      if (typeof window.resolveEquipmentQrValue === 'function' &&
          document.body.matches('.student-borrow-equipment-page, .faculty-borrow-equipment-page')) {
        return { type: 'equipment-value', value: decoded };
      }
      return { type: 'navigate', path: `/equipment/view/${encodeURIComponent(decoded)}` };
    }

    return null;
  }

  async function handleDecodedValue(decodedText) {
    if (handlingResult) return;
    handlingResult = true;

    try {
      const destination = buildQrDestination(decodedText);
      if (!destination) {
        setStatus(isAdminRole
          ? 'That QR code is not recognized. Scan an equipment QR code.'
          : 'That QR code is not recognized. Scan a ComLab equipment, attendance, or PC station code.', true);
        window.setTimeout(() => { handlingResult = false; }, 1400);
        return;
      }

      if (destination.type === 'unsupported') {
        setStatus(destination.message, true);
        window.setTimeout(() => { handlingResult = false; }, 1600);
        return;
      }

      if (isAdminRole) {
        await showAdminEquipmentCycle(destination);
        return;
      }

      if (destination.type === 'equipment-url' &&
          typeof window.resolveEquipmentQrValue === 'function' &&
          document.body.matches('.student-borrow-equipment-page, .faculty-borrow-equipment-page')) {
        setStatus('Equipment found. Loading its borrow details…');
        const equipmentId = await window.resolveEquipmentQrValue(destination.value);
        await closeScanner();
        window.dispatchEvent(new CustomEvent('borrow-equipment-qr-scanned', {
          detail: { value: equipmentId }
        }));
        return;
      }

      if (destination.type === 'equipment-value') {
        setStatus('Equipment found. Loading its borrow details…');
        await closeScanner();
        window.dispatchEvent(new CustomEvent('borrow-equipment-qr-scanned', {
          detail: { value: destination.value }
        }));
        return;
      }

      if (destination.type === 'pc-station') {
        setStatus('Checking whether this PC station is available…');
        const response = await fetch(`/api/pc-stations/qr/${encodeURIComponent(destination.token)}/status`, {
          cache: 'no-store',
          credentials: 'same-origin'
        });
        const availability = await response.json().catch(() => ({}));
        if (!response.ok || !availability.success) {
          throw new Error(availability.error || 'Unable to check this PC station. Please scan again.');
        }

        if (availability.state === 'occupied' || availability.state === 'unavailable') {
          await stopScanner();
          modal.querySelector('#qr-pc-station-result-card').dataset.state = availability.state;
          modal.querySelector('#qr-pc-station-result-label').textContent = availability.state === 'occupied'
            ? 'STATION IN USE'
            : 'STATION UNAVAILABLE';
          modal.querySelector('#qr-pc-station-result-name').textContent = availability.station?.setName || 'PC station';
          modal.querySelector('#qr-pc-station-result-message').textContent = availability.state === 'occupied'
            ? 'Someone is already signed in at this station. Please choose another PC station.'
            : 'This PC station is not active. Please choose another station.';
          status.hidden = true;
          stationResult.hidden = false;
          return;
        }

        setStatus(availability.state === 'mine'
          ? 'You are signed in here. Opening your station sign-out…'
          : 'Station is available. Opening sign-in…');
      }

      setStatus('QR code recognized. Opening…');
      await stopScanner();
      modal.classList.remove('is-open');
      document.body.style.overflow = previousBodyOverflow;
      window.location.assign(destination.path);
    } catch (error) {
      setStatus(error.message || 'Unable to read that QR code. Please scan again.', true);
      window.setTimeout(() => { handlingResult = false; }, 1400);
    }
  }

  async function startScanner() {
    if (startPromise) return startPromise;
    startPromise = (async () => {
      try {
        setStatus(isAdminRole
          ? 'Allow camera access, then point your camera at an equipment QR code.'
          : 'Allow camera access, then point your camera at a QR code.');
        await loadScannerLibrary();
        if (!modal.classList.contains('is-open')) return;
        scanner = scanner || new window.Html5Qrcode('qr-reader');
        await scanner.start(
          { facingMode: 'environment' },
          { fps: 10, qrbox: { width: 250, height: 250 }, aspectRatio: 1 },
          handleDecodedValue,
          () => {}
        );
      } catch (error) {
        setStatus(error.message || 'Camera access failed. Check browser permissions and try again.', true);
      } finally {
        startPromise = null;
      }
    })();
    return startPromise;
  }

  function openScanner() {
    handlingResult = false;
    previousBodyOverflow = document.body.style.overflow;
    reader.hidden = false;
    adminResult.hidden = true;
    stationResult.hidden = true;
    status.hidden = false;
    setStatus(isAdminRole
      ? 'Allow camera access, then point your camera at an equipment QR code.'
      : 'Allow camera access, then point your camera at a QR code.');
    document.body.style.overflow = 'hidden';
    button.setAttribute('aria-expanded', 'true');
    modal.classList.add('is-open');
    closeButton.focus({ preventScroll: true });
    startScanner();
  }

  function setHelpOpen(isOpen) {
    helpPanel.hidden = !isOpen;
    helpButton.setAttribute('aria-expanded', String(isOpen));
    if (isOpen) {
      openHelpConversation().catch((error) => addHelpMessage(error.message || 'Unable to load chat history.', true, true));
      if (!window.matchMedia('(pointer: coarse)').matches) {
        helpInput.focus({ preventScroll: true });
      }
      updateHelpViewport();
    } else {
      helpInput.blur();
      document.body.classList.remove('comlab-help-keyboard-open');
      helpPanel.style.removeProperty('top');
      helpPanel.style.removeProperty('bottom');
      helpPanel.style.removeProperty('left');
      helpPanel.style.removeProperty('right');
      helpPanel.style.removeProperty('width');
      helpPanel.style.removeProperty('height');
      helpPanel.style.removeProperty('max-height');
      helpButton.focus({ preventScroll: true });
    }
  }

  async function helpApi(path, options = {}) {
    const response = await fetch(path, {
      credentials: 'same-origin',
      ...options,
      headers: {
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...options.headers
      }
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Unable to load ComLab Help.');
    return data;
  }

  function showWelcomeMessage() {
    helpMessages.replaceChildren();
    addHelpMessage('Ask about ComLab tasks available to your account.', true);
  }

  function showConversationView() {
    historyPanel.hidden = true;
    helpMessages.hidden = false;
    helpForm.hidden = false;
    historyButton.setAttribute('aria-expanded', 'false');
  }

  function renderHelpHistory() {
    historyList.replaceChildren();
    if (!helpChats.length) {
      const emptyState = document.createElement('p');
      emptyState.className = 'comlab-help-history-empty';
      emptyState.textContent = 'No previous chats yet.';
      historyList.append(emptyState);
      return;
    }

    helpChats.forEach((chat) => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'comlab-help-history-item';
      item.setAttribute('role', 'listitem');
      item.classList.toggle('is-active', String(chat.id) === String(activeHelpChatId));

      const title = document.createElement('strong');
      title.textContent = chat.title || 'New chat';
      const preview = document.createElement('span');
      preview.textContent = chat.lastMessage ? formatHelpPlainText(chat.lastMessage) : 'No messages';
      const date = document.createElement('time');
      const updatedAt = new Date(chat.updatedAt);
      date.textContent = Number.isNaN(updatedAt.getTime())
        ? ''
        : updatedAt.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

      item.append(title, preview, date);
      item.addEventListener('click', () => selectHelpChat(chat.id));
      historyList.append(item);
    });
  }

  async function refreshHelpHistory() {
    const data = await helpApi('/api/help/chats');
    helpChats = Array.isArray(data.chats) ? data.chats : [];
    renderHelpHistory();
  }

  async function createHelpChat() {
    const data = await helpApi('/api/help/chats', { method: 'POST' });
    if (!data.chat?.id) throw new Error('Unable to start a new chat.');
    activeHelpChatId = data.chat.id;
    showWelcomeMessage();
    showConversationView();
    await refreshHelpHistory();
    return activeHelpChatId;
  }

  async function openHelpConversation() {
    if (activeHelpChatId) return;
    await refreshHelpHistory();
    if (helpChats.length) {
      await selectHelpChat(helpChats[0].id);
      return;
    }
    await createHelpChat();
  }

  async function selectHelpChat(chatId) {
    const data = await helpApi(`/api/help/chats/${encodeURIComponent(chatId)}/messages`);
    activeHelpChatId = data.chat.id;
    helpMessages.replaceChildren();
    if (!Array.isArray(data.messages) || !data.messages.length) {
      showWelcomeMessage();
    } else {
      data.messages.forEach((message) => addHelpMessage(message.content, message.sender === 'assistant'));
    }
    showConversationView();
    renderHelpHistory();
    if (!window.matchMedia('(pointer: coarse)').matches) {
      helpInput.focus({ preventScroll: true });
    }
    updateHelpViewport();
  }

  async function openHelpHistory() {
    helpInput.blur();
    historyPanel.hidden = false;
    helpMessages.hidden = true;
    helpForm.hidden = true;
    historyButton.setAttribute('aria-expanded', 'true');
    updateHelpViewport();
    await refreshHelpHistory();
  }

  function updateHelpViewport() {
    if (helpPanel.hidden || (!window.matchMedia('(pointer: coarse)').matches && window.innerWidth > 768)) return;

    const viewportHeight = visualViewport?.height || window.innerHeight;
    const viewportWidth = visualViewport?.width || window.innerWidth;
    const viewportTop = visualViewport?.offsetTop || 0;
    const keyboardOpen = helpInput === document.activeElement
      && Math.max(window.innerHeight - viewportHeight, (window.screen?.height || 0) - viewportHeight) > 120;
    const panelHeight = Math.max(144, Math.min(512, viewportHeight - 16));
    const panelWidth = Math.max(0, Math.min(352, viewportWidth - 16));

    helpPanel.style.top = `${Math.max(viewportTop + 8, viewportTop + viewportHeight - panelHeight - 8)}px`;
    helpPanel.style.bottom = 'auto';
    helpPanel.style.left = `${(visualViewport?.offsetLeft || 0) + 8}px`;
    helpPanel.style.right = 'auto';
    helpPanel.style.width = `${panelWidth}px`;
    helpPanel.style.height = `${panelHeight}px`;
    helpPanel.style.maxHeight = `${panelHeight}px`;
    document.body.classList.toggle('comlab-help-keyboard-open', keyboardOpen);
  }

  function formatHelpPlainText(message) {
    return String(message || '')
      .replace(/^\s{0,3}#{1,6}\s+/gm, '')
      .replace(/^\s*\*\s+/gm, '• ')
      .replace(/\*\*?([^*\n]+)\*\*?/g, '$1')
      .replace(/\*/g, '')
      .replace(/`([^`\n]+)`/g, '$1');
  }

  function addHelpMessage(message, isAnswer = false, isError = false) {
    const bubble = document.createElement('p');
    bubble.className = `comlab-help-message ${isAnswer ? 'comlab-help-answer' : 'comlab-help-question'}${isError ? ' comlab-help-error' : ''}`;
    bubble.textContent = formatHelpPlainText(message);
    helpMessages.append(bubble);
    helpMessages.scrollTop = helpMessages.scrollHeight;
  }

  button.addEventListener('click', openScanner);
  helpButton.addEventListener('click', () => setHelpOpen(helpPanel.hidden));
  helpCloseButton.addEventListener('click', () => setHelpOpen(false));
  newChatButton.addEventListener('click', async () => {
    newChatButton.disabled = true;
    try {
      await createHelpChat();
      if (!window.matchMedia('(pointer: coarse)').matches) {
        helpInput.focus({ preventScroll: true });
      }
      updateHelpViewport();
    } catch (error) {
      addHelpMessage(error.message || 'Unable to start a new chat.', true, true);
    } finally {
      newChatButton.disabled = false;
    }
  });
  historyButton.addEventListener('click', () => {
    if (historyPanel.hidden) {
      openHelpHistory().catch((error) => {
        historyPanel.hidden = true;
        helpMessages.hidden = false;
        helpForm.hidden = false;
        historyButton.setAttribute('aria-expanded', 'false');
        addHelpMessage(error.message || 'Unable to load chat history.', true, true);
      });
    } else {
      showConversationView();
    }
  });
  backToChatButton.addEventListener('click', showConversationView);
  helpForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const question = helpInput.value.trim();
    if (question.length < 2) return;

    const submitButton = helpForm.querySelector('button[type="submit"]');
    submitButton.disabled = true;
    newChatButton.disabled = true;
    historyButton.disabled = true;
    addHelpMessage(question);
    helpInput.value = '';
    try {
      if (!activeHelpChatId) await createHelpChat();
      const data = await helpApi('/api/help/chat', {
        method: 'POST',
        body: JSON.stringify({ question, chatId: activeHelpChatId })
      });
      if (typeof data.answer !== 'string' || !data.answer.trim()) {
        throw new Error('Unable to get help right now. Please try again.');
      }
      addHelpMessage(data.answer, true);
      await refreshHelpHistory();
    } catch (error) {
      addHelpMessage(error.message || 'Unable to get help right now. Please try again.', true, true);
    } finally {
      submitButton.disabled = false;
      newChatButton.disabled = false;
      historyButton.disabled = false;
      helpInput.focus({ preventScroll: true });
      updateHelpViewport();
    }
  });
  closeButton.addEventListener('click', closeScanner);
  adminScanAgainButton.addEventListener('click', () => {
    handlingResult = false;
    adminResult.hidden = true;
    reader.hidden = false;
    setStatus('Point your camera at another equipment QR code.');
    startScanner();
  });
  stationScanAgainButton.addEventListener('click', () => {
    handlingResult = false;
    stationResult.hidden = true;
    reader.hidden = false;
    status.hidden = false;
    setStatus('Point your camera at another PC station QR code.');
    startScanner();
  });
  modal.addEventListener('click', (event) => {
    if (event.target === modal) closeScanner();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && modal.classList.contains('is-open')) closeScanner();
    if (event.key === 'Escape' && !helpPanel.hidden) setHelpOpen(false);
  });
  if (visualViewport) {
    visualViewport.addEventListener('resize', updateHelpViewport);
    visualViewport.addEventListener('scroll', updateHelpViewport);
  }
  window.addEventListener('resize', updateHelpViewport);
})();
