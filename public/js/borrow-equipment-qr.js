window.resolveEquipmentQrValue = async (value) => {
  const scannedValue = String(value || '').trim();
  let equipmentId = scannedValue;

  try {
    const scannedUrl = new URL(scannedValue, window.location.origin);
    const opaqueMatch = scannedUrl.pathname.match(/\/equipment\/(?:uid|s)\/([A-Za-z0-9_-]+)\/?$/i);
    if (opaqueMatch) {
      const response = await fetch(`/api/equipment/qr/${encodeURIComponent(opaqueMatch[1])}/resolve`, {
        cache: 'no-store',
        credentials: 'same-origin'
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Unable to read this equipment QR code.');
      return String(payload.equipmentId || '');
    }
  } catch (error) {
    if (error instanceof TypeError) return scannedValue;
    throw error;
  }

  return equipmentId;
};

(() => {
  const scanButton = document.getElementById('scanEquipmentQr');
  if (!scanButton) return;

  const modal = document.createElement('div');
  modal.id = 'borrow-equipment-qr-modal';
  modal.style.cssText = [
    'position:fixed',
    'inset:0',
    'z-index:10000',
    'display:none',
    'align-items:center',
    'justify-content:center',
    'padding:1rem',
    'background:rgba(0,0,0,.88)'
  ].join(';');
  modal.innerHTML = `
    <section role="dialog" aria-modal="true" aria-labelledby="borrow-equipment-qr-title" style="width:min(100%,32rem);padding:1.25rem;border:1px solid rgba(74,222,128,.25);border-radius:1rem;background:#07150f;color:#f0fdf4">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:1rem">
        <h2 id="borrow-equipment-qr-title" style="margin:0;font-size:1.1rem;font-weight:700">Scan equipment QR</h2>
        <button type="button" data-close-qr-scan aria-label="Close QR scanner" style="width:2.5rem;height:2.5rem;border:1px solid rgba(255,255,255,.2);border-radius:50%;background:transparent;color:white;font-size:1.25rem;cursor:pointer">&times;</button>
      </div>
      <div style="position:relative;width:100%;margin-top:1rem;overflow:hidden;border:1px solid rgba(74,222,128,.2);border-radius:.75rem;background:#041b12">
        <div id="borrow-equipment-qr-reader" style="width:100%;overflow:hidden;border-radius:.75rem"></div>
        <div data-camera-retry-overlay style="position:absolute;inset:0;display:none;flex-direction:column;align-items:center;justify-content:center;gap:.75rem;padding:1rem;background:rgba(3,25,16,.94);text-align:center">
          <p data-camera-error role="alert" style="margin:0;color:#fecaca;font-size:.9rem"></p>
          <button type="button" data-retry-camera style="padding:.65rem 1rem;border:1px solid rgba(74,222,128,.45);border-radius:.7rem;background:#14532d;color:#dcfce7;font-weight:700;cursor:pointer">Retry Camera</button>
        </div>
      </div>
      <p data-qr-scan-status role="status" style="margin:.8rem 0 0;color:#bbf7d0;font-size:.9rem">Point your camera at the QR code on the equipment.</p>
    </section>
  `;
  document.body.append(modal);

  const status = modal.querySelector('[data-qr-scan-status]');
  const retryOverlay = modal.querySelector('[data-camera-retry-overlay]');
  const cameraError = modal.querySelector('[data-camera-error]');
  const retryButton = modal.querySelector('[data-retry-camera]');
  let scanner = null;
  let scriptPromise = null;
  let pendingStart = null;
  let isHandlingResult = false;
  let cameraAttempt = 0;

  function loadScannerLibrary() {
    if (window.Html5Qrcode) return Promise.resolve();
    if (!scriptPromise) {
      scriptPromise = new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = 'https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js';
        script.onload = () => {
          if (window.Html5Qrcode) {
            resolve();
            return;
          }
          scriptPromise = null;
          reject(new Error('QR scanner library did not initialize.'));
        };
        script.onerror = () => {
          script.remove();
          scriptPromise = null;
          reject(new Error('Unable to load the QR scanner. Check your internet connection and try again.'));
        };
        document.head.append(script);
      });
    }
    return scriptPromise;
  }

  loadScannerLibrary().catch((error) => {
    console.warn('QR scanner library preload failed; it will be retried when scanning starts.', error);
  });

  async function stopScanner() {
    if (!scanner) return;
    const activeScanner = scanner;
    scanner = null;
    try {
      if (activeScanner.isScanning) await activeScanner.stop();
      activeScanner.clear();
    } catch (error) {
      console.error('Unable to stop equipment QR scanner cleanly.', error);
    }
  }

  async function closeScanner() {
    cameraAttempt += 1;
    modal.style.display = 'none';
    if (pendingStart) await pendingStart;
    await stopScanner();
    scanButton.disabled = false;
    scanButton.focus();
  }

  async function startScanner() {
    const attempt = ++cameraAttempt;
    scanButton.disabled = true;
    retryButton.disabled = true;
    retryOverlay.style.display = 'none';
    modal.style.display = 'flex';
    status.textContent = 'Starting camera...';
    status.style.color = '#bbf7d0';
    isHandlingResult = false;
    let permissionStream = null;
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('Camera access requires a secure connection (HTTPS) and a supported browser.');
      }

      permissionStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false
      });
      permissionStream.getTracks().forEach((track) => track.stop());
      permissionStream = null;
      if (attempt !== cameraAttempt) return;

      await loadScannerLibrary();
      if (attempt !== cameraAttempt) return;
      scanner = new window.Html5Qrcode('borrow-equipment-qr-reader');
      await scanner.start(
        { facingMode: 'environment' },
        { fps: 15, qrbox: { width: 250, height: 250 } },
        async (value) => {
          if (isHandlingResult) return;
          isHandlingResult = true;
          cameraAttempt += 1;
          await stopScanner();
          modal.style.display = 'none';
          window.dispatchEvent(new CustomEvent('borrow-equipment-qr-scanned', {
            detail: { value: String(value || '').trim() }
          }));
        },
        () => {}
      );
      if (attempt === cameraAttempt) {
        status.textContent = 'Point your camera at the QR code on the equipment.';
      } else {
        await stopScanner();
      }
    } catch (error) {
      if (attempt !== cameraAttempt) return;
      console.error('Unable to start equipment QR scanner.', error);
      status.textContent = error.message || 'Unable to access the camera. Check your browser permissions.';
      status.style.color = '#fca5a5';
      await stopScanner();
      cameraError.textContent = error.message || 'Unable to access the camera. Check your browser permissions.';
      retryOverlay.style.display = 'flex';
    } finally {
      permissionStream?.getTracks().forEach((track) => track.stop());
      if (attempt === cameraAttempt) {
        scanButton.disabled = false;
        retryButton.disabled = false;
      }
    }
  }

  function requestScannerStart() {
    if (pendingStart) return;
    pendingStart = startScanner().finally(() => {
      pendingStart = null;
    });
  }

  scanButton.addEventListener('click', requestScannerStart);
  retryButton.addEventListener('click', requestScannerStart);
  modal.querySelector('[data-close-qr-scan]').addEventListener('click', closeScanner);
  modal.addEventListener('click', (event) => {
    if (event.target === modal) closeScanner();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && modal.style.display === 'flex') closeScanner();
  });
})();
