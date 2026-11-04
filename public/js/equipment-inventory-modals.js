
        // ===== REPORT MISSING =====
        function openReportMissingModal(equipmentId, name) {
            document.getElementById('reportMissingEquipmentId').value = equipmentId;
            document.getElementById('reportMissingName').textContent = name || equipmentId;
            document.getElementById('reportMissingId').textContent = equipmentId;
            const btn = document.querySelector(`button[data-action="report-missing"][data-id="${equipmentId}"]`);
            document.getElementById('reportMissingSN').textContent = btn?.dataset.sn || '—';
            const setId = btn?.dataset.setid || '';
            document.getElementById('reportMissingSet').textContent = setId || 'Not assigned';
            document.getElementById('reportMissingReason').value = '';
            // Reset to step 1
            resetReportScope();
            // Pre-select single if no set, or show both options if has set
            if (!setId) {
                selectReportScope('single');
            }
            openModal('reportMissingModal');
        }

        function resetReportScope() {
            document.getElementById('reportMissingStep1').style.display = '';
            document.getElementById('reportMissingSinglePanel').style.display = 'none';
            document.getElementById('reportMissingSetPanel').style.display = 'none';
            // Reset button styles
            ['scopeSingleBtn','scopeSetBtn'].forEach(id => {
                const el = document.getElementById(id);
                if (el) { el.style.borderColor = 'rgba(74,222,128,.2)'; el.style.background = 'rgba(74,222,128,.05)'; }
            });
        }

        async function selectReportScope(scope) {
            document.getElementById('reportMissingStep1').style.display = 'none';
            if (scope === 'single') {
                document.getElementById('reportMissingSinglePanel').style.display = '';
                document.getElementById('reportMissingSetPanel').style.display = 'none';
            } else {
                // Load set components
                document.getElementById('reportMissingSinglePanel').style.display = 'none';
                document.getElementById('reportMissingSetPanel').style.display = '';
                const equipmentId = document.getElementById('reportMissingEquipmentId').value;
                const btn = document.querySelector(`button[data-action="report-missing"][data-id="${equipmentId}"]`);
                const setId = btn?.dataset.setid || '';
                document.getElementById('reportMissingSetId').textContent = setId || '—';
                // Find set name from equipmentData
                const eq = (window.equipmentData || []).find(e => e.setId === setId);
                document.getElementById('reportMissingSetName').textContent = setId || '—';
                const compContainer = document.getElementById('reportMissingSetComponents');
                compContainer.innerHTML = '<p class="text-slate-500 text-xs italic">Loading...</p>';
                if (setId) {
                    try {
                        const res = await fetch(`/api/equipment-sets/${encodeURIComponent(setId)}`);
                        const data = await res.json();
                        const components = data.components || [];
                        document.getElementById('reportMissingSetName').textContent = data.set?.setName || setId;
                        const serviceable = components.filter(c => c.status === 'Serviceable');
                        if (!serviceable.length) {
                            compContainer.innerHTML = '<p class="text-yellow-400 text-xs">No serviceable components to mark missing.</p>';
                        } else {
                            compContainer.innerHTML = serviceable.map(c => `
                                <div class="flex items-center gap-2 text-xs py-1" style="border-bottom:1px solid rgba(74,222,128,.06);">
                                    <i class="fas fa-cube text-emerald-600 w-3"></i>
                                    <span class="text-white font-medium flex-1">${c.name}</span>
                                    <span class="font-mono text-slate-500">${c.serialNumber || '—'}</span>
                                </div>`).join('');
                            // Store IDs for submission
                            document.getElementById('reportMissingSetPanel').dataset.componentIds = serviceable.map(c => c.equipmentId).join(',');
                        }
                    } catch (e) {
                        compContainer.innerHTML = '<p class="text-red-400 text-xs">Failed to load components.</p>';
                    }
                } else {
                    compContainer.innerHTML = '<p class="text-slate-500 text-xs italic">No PC Station assigned.</p>';
                }
            }
        }

        async function submitReportMissingSet() {
            const reason = document.getElementById('reportMissingSetReason').value.trim();
            if (!reason) { alert('Please provide a reason.'); return; }
            const panel = document.getElementById('reportMissingSetPanel');
            const ids = (panel.dataset.componentIds || '').split(',').filter(Boolean);
            if (!ids.length) { alert('No serviceable components found to mark missing.'); return; }

            const submitBtn = document.querySelector('[onclick="submitReportMissingSet()"]');
            if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Saving...'; }

            try {
                // Report each component missing one by one
                let errors = [];
                for (const equipmentId of ids) {
                    const res = await fetch(`/api/equipment/${encodeURIComponent(equipmentId)}/report-missing`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ reason })
                    });
                    if (!res.ok) {
                        const d = await res.json().catch(() => ({}));
                        errors.push(`${equipmentId}: ${d.error || 'Failed'}`);
                    }
                }
                closeModal('reportMissingModal');
                await loadEquipment();
                if (errors.length) alert('Some items could not be marked:\n' + errors.join('\n'));
            } finally {
                if (submitBtn) { submitBtn.disabled = false; submitBtn.innerHTML = '<i class="fas fa-exclamation-triangle mr-1"></i>Mark All as Missing'; }
            }
        }

        async function submitReportMissing() {
            const id = document.getElementById('reportMissingEquipmentId').value;
            const reason = document.getElementById('reportMissingReason').value.trim();
            if (!reason) { alert('Please provide a reason.'); return; }

            const btn = document.querySelector('#reportMissingModal button[onclick="submitReportMissing()"]');
            if (btn) { btn.disabled = true; btn.textContent = 'Saving...'; }

            try {
                const res = await fetch(`/api/equipment/${encodeURIComponent(id)}/report-missing`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ reason })
                });
                const data = await res.json().catch(() => ({}));
                if (!res.ok) { alert(data.error || 'Failed to report missing.'); return; }
                closeModal('reportMissingModal');
                await loadEquipment();
            } finally {
                if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-exclamation-triangle mr-1"></i>Mark as Missing'; }
            }
        }

        // ===== MARK AS FOUND =====
        function openMarkFoundModal(equipmentId, name) {
            document.getElementById('markFoundEquipmentId').value = equipmentId;
            document.getElementById('markFoundName').textContent = name || equipmentId;
            document.getElementById('markFoundId').textContent = equipmentId;
            const btn = document.querySelector(`button[data-action="mark-found"][data-id="${equipmentId}"]`);
            document.getElementById('markFoundSN').textContent = btn?.dataset.sn || '—';
            document.getElementById('markFoundSet').textContent = btn?.dataset.setid || 'Not assigned';
            document.getElementById('markFoundNotes').value = '';
            openModal('markFoundModal');
        }

        async function submitMarkFound() {
            const id = document.getElementById('markFoundEquipmentId').value;
            const notes = document.getElementById('markFoundNotes').value.trim();

            const btn = document.querySelector('#markFoundModal button[onclick="submitMarkFound()"]');
            if (btn) { btn.disabled = true; btn.textContent = 'Saving...'; }

            try {
                const res = await fetch(`/api/equipment/${encodeURIComponent(id)}/mark-found`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ notes })
                });
                const data = await res.json().catch(() => ({}));
                if (!res.ok) { alert(data.error || 'Failed to mark as found.'); return; }
                closeModal('markFoundModal');
                await loadEquipment();
            } finally {
                if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-check-circle mr-1"></i>Mark as Found'; }
            }
        }

        // ===== TRANSFER SET =====
        function openTransferSetModal(equipmentId, name, currentSetId) {
            const title = document.querySelector('#transferSetModal h3');
            const submitButton = document.querySelector('#transferSetModal button[onclick="submitTransferSet()"]');
            if (title) title.textContent = 'Transfer to Another Set';
            if (submitButton) submitButton.innerHTML = '<i class="fas fa-exchange-alt mr-1"></i>Transfer';
            document.getElementById('transferEquipmentId').value = equipmentId;
            document.getElementById('transferSetSubtitle').textContent = `${name || equipmentId} — ${equipmentId}`;
            document.getElementById('transferCurrentSetId').value = currentSetId || '(No PC Station assigned)';
            document.getElementById('transferTargetSetId').value = '';
            document.getElementById('transferReason').value = '';
            openModal('transferSetModal');
        }

        async function submitTransferSet() {
            const id = document.getElementById('transferEquipmentId').value;
            const targetSetId = document.getElementById('transferTargetSetId').value.trim();
            const reason = document.getElementById('transferReason').value.trim();
            if (!reason) { alert('Please provide a reason for the transfer.'); return; }

            const btn = document.querySelector('#transferSetModal button[onclick="submitTransferSet()"]');
            if (btn) { btn.disabled = true; btn.textContent = 'Transferring...'; }

            try {
                const res = await fetch(`/api/equipment/${encodeURIComponent(id)}/transfer-set`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ targetSetId: targetSetId || null, reason })
                });
                const data = await res.json().catch(() => ({}));
                if (!res.ok) { alert(data.error || 'Failed to transfer equipment.'); return; }
                closeModal('transferSetModal');
                if (document.getElementById('viewModeFilter')?.value === 'pc-sets') {
                    await loadPCSetsTable();
                } else {
                    await loadEquipment();
                }
                await refreshInventorySummary();
            } finally {
                if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-exchange-alt mr-1"></i>Transfer'; }
            }
        }

        const usageHistoryState = { records: [], page: 1, pageSize: 5 };

        function filteredUsageHistoryRecords() {
            const query = String(document.getElementById('usageHistorySearch')?.value || '').trim().toLowerCase();
            const from = document.getElementById('usageHistoryFrom')?.value || '';
            const to = document.getElementById('usageHistoryTo')?.value || '';
            return usageHistoryState.records.filter(record => {
                const searchable = [record.userName, record.userEmail, record.studentNumber, record.subject, record.courseSection, record.instructor, record.pcSetId].filter(Boolean).join(' ').toLowerCase();
                const date = String(record.usageStartTime || '').slice(0, 10);
                return (!query || searchable.includes(query)) && (!from || date >= from) && (!to || date <= to);
            });
        }

        function renderUsageHistory() {
            const list = document.getElementById('usageHistoryList');
            const count = document.getElementById('usageHistoryCount');
            if (!list) return;
            const records = filteredUsageHistoryRecords();
            const pages = Math.max(1, Math.ceil(records.length / usageHistoryState.pageSize));
            usageHistoryState.page = Math.min(Math.max(1, usageHistoryState.page), pages);
            const visible = records.slice((usageHistoryState.page - 1) * usageHistoryState.pageSize, usageHistoryState.page * usageHistoryState.pageSize);
            if (count) count.textContent = `${records.length} record${records.length === 1 ? '' : 's'} · Page ${usageHistoryState.page} of ${pages}`;
            document.getElementById('usageHistoryPrevious')?.toggleAttribute('disabled', usageHistoryState.page <= 1);
            document.getElementById('usageHistoryNext')?.toggleAttribute('disabled', usageHistoryState.page >= pages);
            list.innerHTML = visible.length ? visible.map((record, index) => {
                const id = `usage-record-${usageHistoryState.page}-${index}`;
                const user = record.userName || record.userEmail || `User #${record.userId}`;
                const details = `${record.subject || 'Class not linked'}${record.instructor ? ` · Instructor: ${record.instructor}` : ''}`;
                return `<button type="button" class="w-full text-left rounded-lg p-3" style="background:rgba(56,189,248,.06);border:1px solid rgba(56,189,248,.16);" aria-expanded="false" data-usage-toggle="${id}">
                    <div class="flex flex-wrap items-center gap-2">
                        <span class="text-sm font-semibold text-sky-200">${escapeHtml(user)}</span>
                        ${record.studentNumber ? `<span class="text-xs text-slate-400">(${escapeHtml(record.studentNumber)})</span>` : ''}
                        <span class="rounded-full px-2 py-0.5 text-[0.7rem] text-sky-200" style="background:rgba(56,189,248,.12);">${escapeHtml(record.traceStatus || 'Usage record')}</span>
                        <span class="ml-auto text-xs text-slate-500">${record.usageStartTime ? new Date(record.usageStartTime).toLocaleString() : '—'}</span>
                    </div>
                    <div class="mt-1 text-xs text-slate-400">${escapeHtml(details)} · PC Set: ${escapeHtml(record.pcSetId || '—')}</div>
                    <div id="${id}" class="hidden mt-2 border-t border-sky-900/40 pt-2 text-xs text-slate-300">
                        <div>Started: ${record.usageStartTime ? new Date(record.usageStartTime).toLocaleString() : '—'}</div>
                        <div>Ended: ${record.usageEndTime ? new Date(record.usageEndTime).toLocaleString() : 'Active'}</div>
                        <div>Duration: ${record.durationMinutes ? `${record.durationMinutes} minutes` : '—'}</div>
                        <div>Notes: ${escapeHtml(record.sessionNotes || '—')}</div>
                    </div>
                </button>`;
            }).join('') : '<p class="text-slate-500 text-center py-5 text-sm"><i class="fas fa-inbox mr-2"></i>No matching usage records.</p>';
        }

        ['usageHistorySearch', 'usageHistoryFrom', 'usageHistoryTo'].forEach(id => document.getElementById(id)?.addEventListener('input', () => {
            usageHistoryState.page = 1;
            renderUsageHistory();
        }));
        document.getElementById('usageHistoryPrevious')?.addEventListener('click', () => { usageHistoryState.page--; renderUsageHistory(); });
        document.getElementById('usageHistoryNext')?.addEventListener('click', () => { usageHistoryState.page++; renderUsageHistory(); });
        document.getElementById('usageHistoryList')?.addEventListener('click', event => {
            const button = event.target.closest('[data-usage-toggle]');
            if (!button) return;
            const details = document.getElementById(button.dataset.usageToggle);
            details?.classList.toggle('hidden');
            button.setAttribute('aria-expanded', String(!details?.classList.contains('hidden')));
        });
        document.getElementById('usageHistoryExport')?.addEventListener('click', () => {
            const records = filteredUsageHistoryRecords();
            const csv = [['User', 'Student Number', 'Email', 'Subject', 'Instructor', 'PC Set', 'Started', 'Ended', 'Duration Minutes', 'Trace Status'],
                ...records.map(r => [r.userName, r.studentNumber, r.userEmail, r.subject, r.instructor, r.pcSetId, r.usageStartTime, r.usageEndTime || '', r.durationMinutes, r.traceStatus])]
                .map(row => row.map(value => `"${String(value || '').replace(/"/g, '""')}"`).join(',')).join('\r\n');
            const link = document.createElement('a');
            link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
            link.download = 'equipment-usage-history.csv';
            link.click();
            URL.revokeObjectURL(link.href);
        });

        // ===== EQUIPMENT HISTORY =====
        async function loadEquipmentMaintenanceHistory(equipmentId) {
            const list = document.getElementById('maintenanceHistoryList');

            try {
                const response = await fetch(`/api/maintenance/equipment/${encodeURIComponent(equipmentId)}/history`);
                const data = await response.json();
                if (!response.ok) {
                    throw new Error(data.error || 'Failed to load maintenance history.');
                }

                const records = Array.isArray(data.records) ? data.records : [];
                if (!records.length) {
                    list.innerHTML = '<p class="text-slate-500 text-center py-5 text-sm"><i class="fas fa-inbox mr-2"></i>No repair or maintenance records yet.</p>';
                    return;
                }

                list.innerHTML = records.map(record => {
                    const reportedAt = record.dateReported || record.created_at || record.createdAt;
                    const reportedDate = reportedAt && !Number.isNaN(new Date(reportedAt).getTime())
                        ? new Date(reportedAt).toLocaleString()
                        : reportedAt || '—';
                    const title = record.issueTitle || record.category || 'Maintenance request';

                    return `
                        <div class="rounded-lg p-3" style="background:rgba(34,197,94,.06);border:1px solid rgba(34,197,94,.16);">
                            <div class="flex flex-wrap items-center gap-2">
                                <span class="text-sm font-semibold text-emerald-100">${escapeHtml(title)}</span>
                                <span class="rounded-full px-2 py-0.5 text-[0.7rem] font-semibold text-emerald-200" style="background:rgba(34,197,94,.12);">${escapeHtml(record.status || 'Pending')}</span>
                                <span class="ml-auto text-xs text-slate-500">${escapeHtml(reportedDate)}</span>
                            </div>
                            <div class="mt-1 text-xs text-slate-400">
                                <span>SN: <span class="font-mono text-emerald-300">${escapeHtml(record.serialNumber || data.equipment?.serialNumber || '—')}</span></span>
                                ${record.technicianNotes ? `<span class="ml-3">Notes: ${escapeHtml(record.technicianNotes)}</span>` : ''}
                            </div>
                            <p class="mt-1 text-xs text-slate-300">${escapeHtml(record.description || 'No description')}</p>
                            ${record.dateResolved ? `<p class="mt-1 text-xs text-slate-500">Resolved: ${escapeHtml(new Date(record.dateResolved).toLocaleString())}</p>` : ''}
                        </div>`;
                }).join('');
            } catch (error) {
                console.error('[equipment] Failed to load maintenance history:', error);
                list.innerHTML = `<p class="text-red-400 text-center py-5 text-sm">${escapeHtml(error.message || 'Failed to load maintenance history.')}</p>`;
            }
        }

        function formatBorrowCycleDate(event) {
            const date = String(event.borrowDate || '').slice(0, 10);
            const time = String(event.borrowStartTime || '00:00').slice(0, 5);
            const timestamp = date
                ? new Date(`${date}T${time}:00+08:00`)
                : event.occurredAt ? new Date(event.occurredAt) : null;
            return timestamp && !Number.isNaN(timestamp.getTime())
                ? new Intl.DateTimeFormat(undefined, {
                    timeZone: 'Asia/Manila',
                    dateStyle: 'medium',
                    timeStyle: 'short'
                }).format(timestamp)
                : 'Date and time unavailable';
        }

        let historyEquipmentId = null;
        let borrowCycleRequestId = 0;

        async function toggleBorrowCycleInHistory() {
            const panel = document.getElementById('borrowCyclePanel');
            const button = document.getElementById('toggleBorrowCycleButton');
            const summary = document.getElementById('borrowCycleSummary');
            const list = document.getElementById('borrowCycleEvents');
            if (!panel.hidden) {
                panel.hidden = true;
                button.innerHTML = '<i class="fas fa-clock-rotate-left" aria-hidden="true"></i>View Cycle';
                return;
            }

            if (!historyEquipmentId) return;
            panel.hidden = false;
            button.innerHTML = '<i class="fas fa-clock-rotate-left" aria-hidden="true"></i>Hide Cycle';
            summary.textContent = '';
            list.innerHTML = '<p class="py-6 text-center text-sm text-slate-400"><i class="fas fa-spinner fa-spin mr-2"></i>Loading cycle...</p>';
            const requestId = ++borrowCycleRequestId;

            try {
                const response = await fetch(`/api/equipment/${encodeURIComponent(historyEquipmentId)}/borrow-cycle`, { cache: 'no-store' });
                const data = await response.json().catch(() => ({}));
                if (!response.ok) throw new Error(data.error || 'Failed to load the MR / borrower cycle.');
                if (requestId !== borrowCycleRequestId) return;

                const currentMIR = Array.isArray(data.currentMIR) && data.currentMIR.length
                    ? data.currentMIR.map(escapeHtml).join(', ')
                    : 'No current MR assigned';
                summary.innerHTML = `
                    <div class="flex flex-wrap items-baseline gap-x-2 text-xs">
                        <span class="font-semibold uppercase tracking-wide text-emerald-400">MR</span>
                        <span class="text-emerald-100">${currentMIR}</span>
                    </div>
                    <p class="mt-1 text-[0.68rem] text-slate-500">Flow: oldest to newest ↓</p>`;

                const events = Array.isArray(data.events) ? data.events : [];
                if (!events.length) {
                    list.innerHTML = '<p class="rounded-lg border border-emerald-900/40 bg-black/20 py-6 text-center text-sm text-slate-400">No MR assignments or borrowing records have been recorded yet.</p>';
                    return;
                }

                list.innerHTML = events.map((event, index) => {
                    const isBorrow = event.type === 'borrowed';
                    const title = isBorrow ? 'Borrowed by' : 'MR assigned to';
                    const person = isBorrow ? event.borrowerName : event.facultyName;
                    const date = formatBorrowCycleDate(event);
                    const isReturned = isBorrow && String(event.status || '').toLowerCase() === 'returned';
                    const transferMatch = isReturned ? String(event.remarks || '').match(/^Transferred to (.+?) via QR handoff(?: after (?:MIR|MR) approval by .+)?\.$/) : null;
                    const badge = transferMatch
                        ? '<span class="rounded-full border border-sky-500/30 bg-sky-500/10 px-2 py-0.5 text-[0.65rem] font-bold uppercase tracking-wide text-sky-300">Transferred</span>'
                        : isReturned
                        ? '<span class="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[0.65rem] font-bold uppercase tracking-wide text-emerald-300">Returned</span>'
                        : event.isLastBorrower
                        ? '<span class="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[0.65rem] font-bold uppercase tracking-wide text-emerald-300">Last borrower</span>'
                        : event.isCurrent
                            ? '<span class="rounded-full border border-sky-500/30 bg-sky-500/10 px-2 py-0.5 text-[0.65rem] font-bold uppercase tracking-wide text-sky-300">Current MR</span>'
                            : '';
                    const returnDetails = transferMatch
                        ? `<div class="mt-1 text-xs text-sky-300"><i class="fas fa-share mr-1"></i>Transferred to ${escapeHtml(transferMatch[1])} · ${escapeHtml(formatBorrowCycleDate({
                            borrowDate: event.returnDate,
                            borrowStartTime: event.returnTime
                        }))}</div>`
                        : isReturned
                        ? `<div class="mt-1 text-xs text-emerald-300"><i class="fas fa-check-circle mr-1"></i>Marked returned ${escapeHtml(formatBorrowCycleDate({
                            borrowDate: event.returnDate,
                            borrowStartTime: event.returnTime
                        }))}${event.condition ? ` · ${escapeHtml(event.condition)}` : ''}</div>`
                        : isBorrow && String(event.status || '').toLowerCase() === 'borrowed'
                            ? '<div class="mt-1 text-xs text-amber-300">Not marked returned</div>'
                            : '';
                    const assignedBy = !isBorrow && event.assignedByName
                        ? `<div class="mt-1 text-xs text-slate-500">Assigned by ${escapeHtml(event.assignedByName)}</div>`
                        : '';
                    return `<article class="borrow-cycle-event">
                        <div class="flex flex-wrap items-center justify-between gap-2">
                            <span class="text-[0.68rem] font-semibold uppercase tracking-wide ${isBorrow ? 'text-sky-300' : 'text-emerald-300'}">${index + 1}. ${title}</span>
                            ${badge}
                        </div>
                        <div class="mt-1 flex flex-wrap items-center gap-2 ${isBorrow ? 'font-semibold text-white' : 'text-xs font-medium text-emerald-100/80'}">${escapeHtml(person || 'Unknown')}
                            ${isBorrow && event.borrowerCollege ? `<span class="inline-flex rounded-full border border-violet-300/20 bg-violet-300/10 px-2 py-0.5 text-[0.65rem] font-semibold normal-case tracking-normal text-violet-200">${escapeHtml(event.borrowerCollege)}</span>` : ''}
                        </div>
                        <div class="mt-1 text-xs text-slate-400"><i class="fas fa-clock mr-1"></i>${escapeHtml(date)}</div>
                        ${returnDetails}
                        ${assignedBy}
                    </article>`;
                }).join('');
            } catch (error) {
                if (requestId !== borrowCycleRequestId) return;
                console.error('[equipment] Failed to load MR / borrower cycle:', error);
                summary.textContent = '';
                list.innerHTML = `<p class="py-6 text-center text-sm text-rose-300" role="alert">${escapeHtml(error.message || 'Failed to load the MR / borrower cycle.')}</p>`;
            }
        }

        async function openEquipmentHistoryModal(equipmentId, name) {
            historyEquipmentId = equipmentId;
            borrowCycleRequestId++;
            document.getElementById('borrowCyclePanel').hidden = true;
            document.getElementById('toggleBorrowCycleButton').innerHTML = '<i class="fas fa-clock-rotate-left" aria-hidden="true"></i>View Cycle';
            document.getElementById('borrowCycleSummary').textContent = '';
            document.getElementById('borrowCycleEvents').innerHTML = '<p class="py-5 text-center text-sm text-slate-400"><i class="fas fa-spinner fa-spin mr-2"></i>Loading cycle...</p>';
            document.getElementById('historyModalSubtitle').textContent = name || equipmentId;
            document.getElementById('historyEventList').innerHTML = '<p class="text-slate-500 text-center py-8"><i class="fas fa-spinner fa-spin mr-2"></i>Loading history...</p>';
            document.getElementById('maintenanceHistoryList').innerHTML = '<p class="text-slate-500 text-center py-5 text-sm"><i class="fas fa-spinner fa-spin mr-2"></i>Loading maintenance history...</p>';
            document.getElementById('usageHistoryList').innerHTML = '<p class="text-slate-500 text-center py-5 text-sm"><i class="fas fa-spinner fa-spin mr-2"></i>Loading usage history...</p>';
            document.getElementById('historyEquipmentInfo').innerHTML = '';
            openModal('equipmentHistoryModal');

            void loadEquipmentMaintenanceHistory(equipmentId);

            try {
                const res = await fetch(`/api/equipment/${encodeURIComponent(equipmentId)}/history`);
                const data = await res.json().catch(() => ({}));
                if (!res.ok) {
                    document.getElementById('historyEventList').innerHTML = `<p class="text-red-400 text-center py-8">${data.error || 'Failed to load history.'}</p>`;
                    return;
                }

                const eq = data.equipment || {};
                document.getElementById('historyEquipmentInfo').innerHTML = `
                    <div class="flex flex-wrap gap-4 text-xs">
                        <span><span class="text-slate-500 uppercase tracking-wide">ID</span><br><span class="text-white font-mono font-semibold">${escapeHtml(eq.equipmentId||'—')}</span></span>
                        <span><span class="text-slate-500 uppercase tracking-wide">Serial No</span><br><span class="text-emerald-300 font-mono">${escapeHtml(eq.serialNumber||'—')}</span></span>
                        <span><span class="text-slate-500 uppercase tracking-wide">Set</span><br><span class="text-emerald-300 font-mono">${escapeHtml(eq.setId||'—')}</span></span>
                        <span><span class="text-slate-500 uppercase tracking-wide">Status</span><br><span class="font-semibold" style="color:${eq.status==='Missing'?'#fcd34d':eq.status==='Serviceable'?'#86efac':'#d1d5db'}">${escapeHtml(eq.status||'—')}</span></span>
                        <span><span class="text-slate-500 uppercase tracking-wide">Campus</span><br><span class="text-slate-300">${escapeHtml(eq.campus||'—')}</span></span>
                    </div>`;

                usageHistoryState.records = Array.isArray(data.usageHistory) ? data.usageHistory : [];
                usageHistoryState.page = 1;
                renderUsageHistory();

                const events = Array.isArray(data.history) ? data.history : [];
                if (!events.length) {
                    document.getElementById('historyEventList').innerHTML = '<p class="text-slate-500 text-center py-8 text-sm"><i class="fas fa-inbox mr-2"></i>No history events yet.</p>';
                    return;
                }

                const eventConfig = {
                    'reported_missing': { icon: 'fa-exclamation-triangle', color: '#fcd34d', bg: 'rgba(251,191,36,.08)', border: 'rgba(251,191,36,.2)', label: 'Reported Missing' },
                    'found':            { icon: 'fa-check-circle',         color: '#86efac', bg: 'rgba(34,197,94,.08)',   border: 'rgba(34,197,94,.2)',   label: 'Marked Found' },
                    'transferred':      { icon: 'fa-exchange-alt',         color: '#c4b5fd', bg: 'rgba(139,92,246,.08)', border: 'rgba(139,92,246,.2)', label: 'Set Transfer' },
                    'assigned_to_set':  { icon: 'fa-link',                 color: '#c4b5fd', bg: 'rgba(139,92,246,.08)', border: 'rgba(139,92,246,.2)', label: 'Assigned to Set' },
                    'legacy_assignment': { icon: 'fa-link',                color: '#fbbf24', bg: 'rgba(245,158,11,.08)', border: 'rgba(245,158,11,.2)', label: 'Current Set Assignment (legacy)' },
                    'removed_from_set': { icon: 'fa-unlink',                color: '#fda4af', bg: 'rgba(244,63,94,.08)',  border: 'rgba(244,63,94,.2)',  label: 'Removed from Set' },
                    'borrowed':         { icon: 'fa-hand-holding',         color: '#93c5fd', bg: 'rgba(59,130,246,.08)', border: 'rgba(59,130,246,.2)', label: 'Borrowed' },
                    'returned':         { icon: 'fa-undo-alt',              color: '#86efac', bg: 'rgba(34,197,94,.08)', border: 'rgba(34,197,94,.2)', label: 'Returned' },
                    'status_changed':  { icon: 'fa-rotate',                 color: '#fbbf24', bg: 'rgba(245,158,11,.08)', border: 'rgba(245,158,11,.2)', label: 'Status Changed' },
                    'condition_changed': { icon: 'fa-clipboard-check',      color: '#f0abfc', bg: 'rgba(217,70,239,.08)', border: 'rgba(217,70,239,.2)', label: 'Condition Changed' },
                };

                document.getElementById('historyEventList').innerHTML = events.map(ev => {
                    const cfg = eventConfig[ev.eventType] || { icon:'fa-circle', color:'#94a3b8', bg:'rgba(100,116,139,.08)', border:'rgba(100,116,139,.2)', label: ev.eventType };
                    const date = ev.reportedAt ? new Date(ev.reportedAt).toLocaleString() : '—';
                    return `
                        <div class="rounded-xl p-4" style="background:${cfg.bg};border:1px solid ${cfg.border};">
                            <div class="flex items-center gap-2 mb-2">
                                <i class="fas ${cfg.icon} text-sm" style="color:${cfg.color};"></i>
                                <span class="text-sm font-semibold" style="color:${cfg.color};">${cfg.label}</span>
                                <span class="ml-auto text-xs text-slate-500">${date}</span>
                            </div>
                            <div class="text-xs text-slate-400 space-y-0.5">
                                <div><span class="text-slate-500">By:</span> ${escapeHtml(ev.reportedByDisplayName || ev.reportedByName || 'Legacy record (user unavailable)')}</div>
                                ${ev.resolvedByDisplayName ? `<div><span class="text-slate-500">Resolved by:</span> ${escapeHtml(ev.resolvedByDisplayName)}</div>` : ''}
                                ${ev.setId ? `<div><span class="text-slate-500">Set:</span> <span class="font-mono text-emerald-400">${escapeHtml(ev.setId)}</span></div>` : ''}
                                ${ev.serialNumber ? `<div><span class="text-slate-500">SN:</span> <span class="font-mono">${escapeHtml(ev.serialNumber)}</span></div>` : ''}
                                ${ev.reason ? `<div class="mt-1 text-slate-300 italic">"${escapeHtml(ev.reason)}"</div>` : ''}
                            </div>
                        </div>`;
                }).join('');

            } catch (err) {
                document.getElementById('historyEventList').innerHTML = '<p class="text-red-400 text-center py-8">Failed to load history.</p>';
            }
        }
