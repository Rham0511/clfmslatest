(() => {
  let dialog;
  let activeEquipmentId = '';
  let submitting = false;

  function getDialog() {
    if (dialog) return dialog;

    dialog = document.createElement('dialog');
    dialog.setAttribute('aria-labelledby', 'qr-equipment-report-title');
    dialog.style.cssText = [
      'width:min(34rem,calc(100% - 2rem))',
      'max-width:34rem',
      'max-height:90vh',
      'max-height:90dvh',
      'overflow-y:auto',
      'padding:0',
      'border:1px solid rgba(74,222,128,.24)',
      'border-radius:1.25rem',
      'background:#07150f',
      'color:#f8fafc',
      'color-scheme:dark',
      'box-shadow:0 24px 70px rgba(0,0,0,.55)'
    ].join(';');
    dialog.innerHTML = `
      <form data-qr-equipment-report-form style="display:grid;gap:1rem;padding:1.25rem">
        <header style="display:flex;align-items:flex-start;justify-content:space-between;gap:1rem">
          <div>
            <p style="margin:0;color:#6ee7b7;font-size:.72rem;font-weight:700;letter-spacing:.14em;text-transform:uppercase">Equipment issue</p>
            <h2 id="qr-equipment-report-title" style="margin:.4rem 0 0;font-size:1.25rem;font-weight:750">Report equipment</h2>
            <p data-qr-equipment-report-item style="margin:.35rem 0 0;color:#a7d9bb;font-size:.9rem"></p>
          </div>
          <button type="button" data-qr-report-close aria-label="Close report form" style="width:2.5rem;height:2.5rem;border:1px solid rgba(255,255,255,.15);border-radius:.75rem;background:#0a1d15;color:white;font-size:1.25rem;cursor:pointer">&times;</button>
        </header>
        <label style="display:grid;gap:.4rem;color:#d1fae5;font-size:.88rem;font-weight:650">Issue type
          <select name="category" required style="width:100%;min-height:2.9rem;border:1px solid rgba(74,222,128,.2);border-radius:.75rem;background:#020b07;color:#f8fafc;padding:.65rem">
            <option>Equipment Damage</option>
            <option>Equipment Missing</option>
            <option>Connectivity</option>
            <option>Other</option>
          </select>
        </label>
        <label style="display:grid;gap:.4rem;color:#d1fae5;font-size:.88rem;font-weight:650">Priority
          <select name="priority" required style="width:100%;min-height:2.9rem;border:1px solid rgba(74,222,128,.2);border-radius:.75rem;background:#020b07;color:#f8fafc;padding:.65rem">
            <option>Medium</option>
            <option>Low</option>
            <option>High</option>
            <option>Critical</option>
          </select>
        </label>
        <label style="display:grid;gap:.4rem;color:#d1fae5;font-size:.88rem;font-weight:650">Describe the issue
          <textarea name="description" required maxlength="3000" rows="5" placeholder="What is wrong with this item?" style="width:100%;resize:vertical;border:1px solid rgba(74,222,128,.2);border-radius:.75rem;background:#020b07;color:#f8fafc;padding:.75rem"></textarea>
        </label>
        <p data-qr-report-message role="status" aria-live="polite" hidden style="margin:0;font-size:.9rem"></p>
        <footer style="display:flex;justify-content:flex-end;gap:.75rem">
          <button type="button" data-qr-report-cancel style="min-height:2.8rem;border:1px solid rgba(74,222,128,.2);border-radius:.75rem;background:transparent;color:#d1fae5;padding:.6rem 1rem;font-weight:650;cursor:pointer">Cancel</button>
          <button type="submit" data-qr-report-submit style="min-height:2.8rem;border:0;border-radius:.75rem;background:linear-gradient(135deg,#16a34a,#22c55e);color:white;padding:.6rem 1rem;font-weight:700;cursor:pointer">Submit report</button>
        </footer>
      </form>
    `;
    const backdropStyle = document.createElement('style');
    backdropStyle.textContent = 'dialog[data-qr-equipment-report]::backdrop{background:rgba(0,0,0,.72);backdrop-filter:blur(4px)}';
    dialog.dataset.qrEquipmentReport = 'true';
    document.head.append(backdropStyle);
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog || event.target.closest('[data-qr-report-close], [data-qr-report-cancel]')) {
        dialog.close();
      }
    });
    dialog.querySelector('form').addEventListener('submit', submitReport);
    dialog.addEventListener('close', () => {
      if (submitting) return;
      dialog.querySelector('form').reset();
      setMessage('', false);
    });
    document.body.append(dialog);
    return dialog;
  }

  function setMessage(text, isError) {
    const message = dialog.querySelector('[data-qr-report-message]');
    message.textContent = text;
    message.hidden = !text;
    message.style.color = isError ? '#fda4af' : '#86efac';
  }

  async function submitReport(event) {
    event.preventDefault();
    if (submitting || !activeEquipmentId) return;

    const form = event.currentTarget;
    const submitButton = form.querySelector('[data-qr-report-submit]');
    const formData = new FormData(form);
    const description = String(formData.get('description') || '').trim();
    if (!description) {
      setMessage('Please describe the issue before submitting.', true);
      return;
    }

    submitting = true;
    submitButton.disabled = true;
    submitButton.textContent = 'Submitting...';
    try {
      const response = await fetch('/api/maintenance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          equipmentId: activeEquipmentId,
          category: formData.get('category'),
          priority: formData.get('priority'),
          description,
          source: 'qr_scan'
        })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Unable to submit the equipment report.');

      setMessage(payload.message || 'Report submitted. The technician can now review it.', false);
      form.querySelector('textarea[name="description"]').value = '';
      window.setTimeout(() => {
        if (dialog.open) dialog.close();
      }, 1200);
    } catch (error) {
      console.error('Failed to submit QR equipment report.', error);
      setMessage(error.message || 'Unable to submit the equipment report.', true);
    } finally {
      submitting = false;
      submitButton.disabled = false;
      submitButton.textContent = 'Submit report';
    }
  }

  document.addEventListener('click', (event) => {
    const trigger = event.target.closest('[data-open-qr-report]');
    if (!trigger) return;
    const equipmentId = String(trigger.dataset.reportEquipmentId || '').trim();
    if (!equipmentId) return;

    activeEquipmentId = equipmentId;
    const reportDialog = getDialog();
    reportDialog.querySelector('[data-qr-equipment-report-item]').textContent =
      `${trigger.dataset.reportEquipmentName || 'Equipment'} · ${equipmentId}`;
    reportDialog.querySelector('form').reset();
    setMessage('', false);
    reportDialog.showModal();
    reportDialog.querySelector('textarea[name="description"]').focus();
  });
})();
