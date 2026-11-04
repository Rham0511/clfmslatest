(() => {
  const target = document.getElementById('borrowRequestsState');
  const tabs = document.getElementById('facultyBorrowRequestTabs');
  if (!target || !tabs) return;

  const userRole = String(window.__CURRENT_USER__?.role || '').trim().toLowerCase();
  const isFaculty = ['faculty', 'instructor'].includes(userRole);
  const state = { records: [], page: 1, pageSize: 10, tab: 'mine' };
  const statusClasses = {
    pending: 'border-amber-400/20 bg-amber-400/10 text-amber-200',
    approved: 'border-emerald-400/20 bg-emerald-400/10 text-emerald-200',
    borrowed: 'border-emerald-400/20 bg-emerald-400/10 text-emerald-200',
    rejected: 'border-rose-400/20 bg-rose-400/10 text-rose-200',
    returned: 'border-emerald-400/20 bg-emerald-400/10 text-emerald-200',
    overdue: 'border-rose-400/20 bg-rose-400/10 text-rose-200',
    lost: 'border-rose-400/20 bg-rose-400/10 text-rose-200'
  };

  const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[character]);

  const formatDate = (value) => {
    if (!value) return '—';
    const date = new Date(value);
    return Number.isNaN(date.getTime())
      ? escapeHtml(value)
      : escapeHtml(date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }));
  };

  const visibleRecords = () => {
    const mine = state.records.filter((record) => record.isMyRequest);
    const studentRequests = state.records.filter((record) =>
      !record.isMyRequest &&
      String(record.requesterRole || record.borrowerType || '').toLowerCase() === 'student' &&
      (record.canApprove || record.canReturnStudentBorrow) &&
      ['pending', 'borrowed'].includes(String(record.status || '').toLowerCase())
    );
    tabs.querySelector('[data-borrow-tab-count="mine"]').textContent = String(mine.length);
    tabs.querySelector('[data-borrow-tab-count="students"]').textContent = String(studentRequests.length);
    return state.tab === 'students' ? studentRequests : mine;
  };

  const pagination = (totalPages) => {
    if (totalPages <= 1) return '';
    return `<div class="flex items-center justify-end gap-2 border-t border-emerald-400/10 p-2">
      <button type="button" class="borrow-request-tab" data-page="previous" ${state.page <= 1 ? 'disabled' : ''}>Previous</button>
      <span class="px-1 text-sm font-medium text-emerald-200/80">Page ${state.page} of ${totalPages}</span>
      <button type="button" class="borrow-request-tab" data-page="next" ${state.page >= totalPages ? 'disabled' : ''}>Next</button>
    </div>`;
  };

  const render = () => {
    const records = visibleRecords();
    const totalPages = Math.max(1, Math.ceil(records.length / state.pageSize));
    state.page = Math.min(state.page, totalPages);
    tabs.querySelectorAll('[data-borrow-tab]').forEach((tab) => {
      tab.setAttribute('aria-selected', String(tab.dataset.borrowTab === state.tab));
    });

    if (!records.length) {
      target.innerHTML = `<div class="borrow-request-empty">${
        state.tab === 'students'
          ? 'No Student requests awaiting your approval.'
          : 'You have no borrow requests yet.'
      }</div>`;
      return;
    }

    const pageRecords = records.slice((state.page - 1) * state.pageSize, state.page * state.pageSize);
    const isStudentTab = isFaculty && state.tab === 'students';
    const headings = isStudentTab
      ? ['Student', 'Equipment', 'Take over from', 'Requested', 'Reason', 'Status', 'Action']
      : ['Equipment', 'Laboratory', 'Borrow date', 'Return date', 'Status', 'Reason', 'Action'];

    const rows = pageRecords.map((record) => {
      const status = String(record.status || 'Pending');
      const statusClass = statusClasses[status.toLowerCase()] || 'border-emerald-400/20 bg-emerald-400/10 text-emerald-200';
      const equipment = `<div class="borrow-request-name">${escapeHtml(record.equipmentName || '—')}</div><div class="borrow-request-meta">${escapeHtml(record.equipmentId || '')}</div>`;
      const statusBadge = `<span class="borrow-request-status ${statusClass}">${escapeHtml(status)}</span>`;
      if (isStudentTab) {
        const studentDetails = [record.borrowerProgram, record.borrowerYear, record.borrowerSection].filter(Boolean).join(' · ');
        const actions = [];
        if (record.canApprove) {
          actions.push(`<button type="button" data-borrow-decision="approve" data-record-id="${escapeHtml(record.id)}">Approve</button>`);
          actions.push(`<button type="button" data-borrow-decision="reject" data-record-id="${escapeHtml(record.id)}">Reject</button>`);
        }
        if (record.canReturnStudentBorrow) {
          actions.push(`<button type="button" data-return-student="${escapeHtml(record.id)}">Mark returned</button>`);
        }
        return `<tr>
          <td data-label="Student"><div class="borrow-request-name">${escapeHtml(record.borrowerName || 'Student')}</div><div class="borrow-request-meta">${escapeHtml(studentDetails || 'Program details unavailable')}</div></td>
          <td data-label="Equipment">${equipment}</td>
          <td data-label="Take over from">${escapeHtml(record.takenOverFrom || (status.toLowerCase() === 'pending' ? record.currentBorrowerName : '') || '—')}</td>
          <td data-label="Requested">${formatDate(record.borrowDate)} ${escapeHtml(record.borrowStartTime || '')}</td>
          <td data-label="Reason">${escapeHtml(record.purpose || '—')}</td>
          <td data-label="Status">${statusBadge}</td>
          <td data-label="Action"><div class="borrow-request-actions">${actions.join('') || '—'}</div></td>
        </tr>`;
      }

      const reason = status.toLowerCase() === 'rejected' ? record.remarks || 'No reason provided' : '—';
      const returnAction = record.isMyRequest && record.requesterUserId && record.canRequestReturn &&
        ['student', 'faculty', 'instructor'].includes(userRole)
        ? `<button type="button" data-request-return="${escapeHtml(record.id)}">Request return</button>`
        : '';
      const accountability = [
        record.currentAccountableFacultyName ? `Accountable: ${record.currentAccountableFacultyName}` : '',
        record.isLastBorrower ? 'You are the last borrower; accountability is assigned to you.' : '',
        record.takenOverFrom ? `${record.borrowerName || 'Borrower'} took over this item from ${record.takenOverFrom}.` : '',
        record.takenOverBy ? `This item was transferred to ${record.takenOverBy}.` : '',
        record.returnRequestedAt ? `Return requested${record.returnRequestedBy ? ` by ${record.returnRequestedBy}` : ''}.` : ''
      ].filter(Boolean).map((note) => `<div class="borrow-request-meta">${escapeHtml(note)}</div>`).join('');
      return `<tr>
        <td data-label="Equipment">${equipment}</td>
        <td data-label="Laboratory">${escapeHtml(record.laboratoryRoom || record.campus || '—')}</td>
        <td data-label="Borrow date">${formatDate(record.borrowDate)} ${escapeHtml(record.borrowStartTime || '')}</td>
        <td data-label="Return date">${formatDate(record.returnDate || record.expectedReturnDate)} ${escapeHtml(record.returnTime || record.expectedReturnTime || '')}</td>
        <td data-label="Status">${statusBadge}${record.approvedByName ? `<div class="borrow-request-meta">${status.toLowerCase() === 'rejected' ? 'Rejected' : 'Approved'} by ${escapeHtml(record.approvedByName)}</div>` : ''}${accountability}</td>
        <td data-label="Reason">${escapeHtml(reason)}</td>
        <td data-label="Action"><div class="borrow-request-actions">${returnAction || '—'}</div></td>
      </tr>`;
    }).join('');

    target.innerHTML = `<table class="borrow-request-table ${isStudentTab ? 'student-request-table' : 'my-request-table'}">
      <thead><tr>${headings.map((heading) => `<th scope="col">${heading}</th>`).join('')}</tr></thead>
      <tbody>${rows}</tbody>
    </table>${pagination(totalPages)}`;
  };

  const load = async () => {
    try {
      const response = await fetch('/api/borrow-records', { cache: 'no-store' });
      const records = await response.json().catch(() => null);
      if (!response.ok) throw new Error(records?.error || `Unable to load borrow requests (HTTP ${response.status}).`);
      if (!Array.isArray(records)) throw new Error('The server returned an unexpected borrow request response.');
      state.records = records.filter((record) =>
        ['pending', 'approved', 'borrowed', 'rejected', 'returned', 'overdue', 'lost', 'pending replacement']
          .includes(String(record.status || '').toLowerCase())
      );
      render();
    } catch (error) {
      console.error('Failed to load Faculty borrow requests:', error);
      target.innerHTML = '<div class="borrow-request-empty text-rose-300" role="alert">Could not load borrow requests. Please try again later.</div>';
    }
  };

  const requestAction = async (url, options, button) => {
    button.disabled = true;
    try {
      const response = await fetch(url, options);
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Unable to update this borrow request.');
      await load();
    } catch (error) {
      window.alert(error.message || 'Unable to update this borrow request.');
      button.disabled = false;
    }
  };

  tabs.hidden = !isFaculty;
  tabs.addEventListener('click', (event) => {
    const tab = event.target.closest('[data-borrow-tab]');
    if (!tab) return;
    state.tab = tab.dataset.borrowTab;
    state.page = 1;
    render();
  });

  target.addEventListener('click', async (event) => {
    const pageButton = event.target.closest('[data-page]');
    if (pageButton) {
      state.page += pageButton.dataset.page === 'next' ? 1 : -1;
      render();
      return;
    }

    const decisionButton = event.target.closest('[data-borrow-decision]');
    if (decisionButton) {
      const dialog = document.getElementById('rejectBorrowRequestDialog');
      if (decisionButton.dataset.borrowDecision === 'reject') {
        dialog.dataset.recordId = decisionButton.dataset.recordId;
        document.getElementById('rejectBorrowReason').value = '';
        dialog.showModal();
        return;
      }
      await requestAction(`/api/borrow-records/${encodeURIComponent(decisionButton.dataset.recordId)}/approve`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' }
      }, decisionButton);
      return;
    }

    const returnedButton = event.target.closest('[data-return-student]');
    if (returnedButton) {
      if (!await window.appDialogs.confirm('Confirm that the Student returned this equipment to you?')) return;
      await requestAction(`/api/borrow-records/${encodeURIComponent(returnedButton.dataset.returnStudent)}/return`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ condition: 'Good' })
      }, returnedButton);
      return;
    }

    const returnRequestButton = event.target.closest('[data-request-return]');
    if (!returnRequestButton) return;
    const remarks = await window.appDialogs.prompt('Optional note for the Admin/Technician receiving the equipment:', '') || '';
    if (!await window.appDialogs.confirm('Submit a request to return this equipment? Please hand the item to an Admin or Technician to complete the return.')) return;
    await requestAction(`/api/borrow-records/${encodeURIComponent(returnRequestButton.dataset.requestReturn)}/request-return`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ remarks })
    }, returnRequestButton);
  });

  document.getElementById('rejectBorrowRequestForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const dialog = document.getElementById('rejectBorrowRequestDialog');
    const reasonField = document.getElementById('rejectBorrowReason');
    const reason = reasonField.value.trim();
    if (!reason) {
      reasonField.setCustomValidity('Please provide a reason for rejecting this request.');
      reasonField.reportValidity();
      return;
    }
    reasonField.setCustomValidity('');
    const submitButton = event.currentTarget.querySelector('[type="submit"]');
    submitButton.disabled = true;
    try {
      const response = await fetch(`/api/borrow-records/${encodeURIComponent(dialog.dataset.recordId)}/reject`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Unable to reject this request.');
      dialog.close();
      await load();
    } catch (error) {
      window.alert(error.message || 'Unable to reject this request.');
    } finally {
      submitButton.disabled = false;
    }
  });
  document.getElementById('rejectBorrowReason').addEventListener('input', (event) => {
    event.currentTarget.setCustomValidity('');
  });
  document.getElementById('cancelRejectBorrowRequest').addEventListener('click', () => {
    document.getElementById('rejectBorrowRequestDialog').close();
  });

  load();
})();
