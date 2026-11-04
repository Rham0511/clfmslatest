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
      <div id="qr-reader"></div>
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

  document.body.append(button, modal);

  const status = modal.querySelector('#qr-scan-status');
  const closeButton = modal.querySelector('.qr-scanner-close');
  const reader = modal.querySelector('#qr-reader');
  const adminResult = modal.querySelector('#qr-admin-equipment-result');
  const adminScanAgainButton = modal.querySelector('#qr-admin-scan-again');
  let scanner = null;
  let scannerLibraryPromise = null;
  let startPromise = null;
  let handlingResult = false;
  let previousBodyOverflow = '';

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
      return { type: 'navigate', path: `/pc-station/uid/${encodeURIComponent(stationMatch[1])}` };
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

  button.addEventListener('click', openScanner);
  closeButton.addEventListener('click', closeScanner);
  adminScanAgainButton.addEventListener('click', () => {
    handlingResult = false;
    adminResult.hidden = true;
    reader.hidden = false;
    setStatus('Point your camera at another equipment QR code.');
    startScanner();
  });
  modal.addEventListener('click', (event) => {
    if (event.target === modal) closeScanner();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && modal.classList.contains('is-open')) closeScanner();
  });
})();
