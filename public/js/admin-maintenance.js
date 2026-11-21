// public/js/admin-maintenance.js
// Admin Maintenance Requests management: list requests, load workflows, and assign technicians

(async () => {
  const tableBody = document.getElementById('maintenanceTableBody');
  const assignMessage = document.getElementById('assignMessage');
  const totalRequestsCount = document.getElementById('totalRequestsCount');
  const pendingRequestsCount = document.getElementById('pendingRequestsCount');
  const inProgressRequestsCount = document.getElementById('inProgressRequestsCount');
  const resolvedRequestsCount = document.getElementById('resolvedRequestsCount');
  const maintenanceSearchInput = document.getElementById('maintenanceSearchInput');
  const maintenanceSearchClear = document.getElementById('maintenanceSearchClear');
  const dateFilter = document.getElementById('dateFilter');
  const adminAvatar = document.getElementById('adminAvatar');
  const adminUserName = document.getElementById('adminUserName');
  const adminUserRole = document.getElementById('adminUserRole');
  const statusDropdown = document.getElementById('maintenanceStatusDropdown');
  const statusTrigger = document.getElementById('maintenanceStatusTrigger');
  const statusMenu = document.getElementById('maintenanceStatusMenu');
  const statusSelection = document.getElementById('maintenanceStatusSelection');
  const statusTriggerCount = document.getElementById('maintenanceStatusTriggerCount');
  const statusOptionSelector = '[data-maintenance-section] .maintenance-status-option';
  let currentRequests = [];
  let activeStatusFilter = 'All';
  let activeDateFilter = 'All';
  let activeSearchText = '';
  let activeReporterRole = 'student';
  let isMaintenanceRefreshing = false;
  const paginationState = {
    currentPage: 1,
    rowsPerPage: 5
  };

  if (!tableBody) return; // not on this page

  const setMessage = (el, text, isError = false) => {
    if (!el) return;
    el.textContent = text;
    el.style.color = isError ? '#FCA5A5' : '#BBF7D0';
  };

  const setText = (el, value) => {
    if (!el) return;
    el.textContent = value != null ? String(value) : '0';
  };

  const fetchSummary = async () => {
    try {
      const res = await fetch('/api/maintenance-summary', { cache: 'no-store' });
      if (!res.ok) throw new Error('Failed to load summary');
      const data = await res.json();
      setText(totalRequestsCount, data.totalRequests);
      setText(pendingRequestsCount, data.pendingRequests);
      setText(inProgressRequestsCount, data.inProgressRequests);
      setText(resolvedRequestsCount, data.resolvedRequests);
      return true;
    } catch (err) {
      console.error(err);
      return false;
    }
  };

  const getReporterRole = (request) => {
    const role = String(request.reporterRole || request.reporter?.role || 'student').trim().toLowerCase();
    return ['faculty', 'instructor'].includes(role) ? 'faculty' : 'student';
  };

  const getIssueTitle = (request) => {
    const rawTitle = String(request.issueTitle || 'Equipment issue').trim();
    const equipmentId = String(request.equipmentId || '').trim();
    if (!equipmentId) return rawTitle;
    const titleEnd = rawTitle.toLowerCase().lastIndexOf(equipmentId.toLowerCase());
    if (titleEnd < 0 || titleEnd + equipmentId.length !== rawTitle.length) return rawTitle;
    return rawTitle.slice(0, titleEnd).replace(/[\s:–—-]+$/, '').trim() || 'Equipment issue';
  };

  // Status dropdown presentation stays connected to the existing filter state.
  const syncStatusDropdown = () => {
    const activeOption = Array.from(document.querySelectorAll(statusOptionSelector))
      .find((option) => option.dataset.filter === activeStatusFilter);
    const activeCount = activeOption?.querySelector('.maintenance-status-option-count')?.textContent || '0';
    if (statusSelection) statusSelection.textContent = activeStatusFilter;
    if (statusTriggerCount) statusTriggerCount.textContent = activeCount;
    if (statusTrigger) statusTrigger.classList.toggle('has-active-filter', activeStatusFilter !== 'All');
  };

  const updateMaintenanceCounts = () => {
    const studentCount = currentRequests.filter((request) => getReporterRole(request) === 'student').length;
    const facultyCount = currentRequests.filter((request) => getReporterRole(request) === 'faculty').length;
    const scopedRequests = currentRequests.filter((request) => getReporterRole(request) === activeReporterRole);
    const counts = {
      All: scopedRequests.length,
      Pending: scopedRequests.filter((request) => (request.status || 'Pending') === 'Pending').length,
      'In Progress': scopedRequests.filter((request) => request.status === 'In Progress').length,
      Resolved: scopedRequests.filter((request) => request.status === 'Resolved').length,
      Rejected: scopedRequests.filter((request) => request.status === 'Rejected').length
    };

    document.querySelectorAll('[data-maintenance-role-count]').forEach((counter) => {
      counter.textContent = String(counter.dataset.maintenanceRoleCount === 'faculty' ? facultyCount : studentCount);
    });
    document.querySelectorAll('[data-maintenance-count]').forEach((counter) => {
      counter.textContent = String(counts[counter.dataset.maintenanceCount] ?? 0);
    });
    syncStatusDropdown();
  };

  const fetchRequests = async () => {
    try {
      const res = await fetch('/api/maintenance', { cache: 'no-store' });
      if (!res.ok) throw new Error('Failed to load requests');
      const data = await res.json();
      currentRequests = Array.isArray(data) ? data : [];
      updateMaintenanceCounts();
      renderTable(filterRequests(currentRequests));
      return true;
    } catch (err) {
      console.error(err);
      currentRequests = [];
      updateMaintenanceCounts();
      setMessage(assignMessage, 'Failed to load maintenance requests', true);
      tableBody.innerHTML = '<tr><td colspan="6" class="maintenance-empty-row">Unable to load reports. Please refresh and try again.</td></tr>';
      renderPaginationControls([]);
      return false;
    }
  };

  const isWithinDateRange = (value, range) => {
    if (!value) return false;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return false;

    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfLastSevenDays = new Date(now);
    startOfLastSevenDays.setDate(now.getDate() - 6);
    startOfLastSevenDays.setHours(0, 0, 0, 0);
    const startOfWeek = new Date(startOfToday);
    const day = startOfWeek.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    startOfWeek.setDate(startOfToday.getDate() + diff);
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfTomorrow = new Date(startOfToday);
    startOfTomorrow.setDate(startOfTomorrow.getDate() + 1);
    const startOfNextWeek = new Date(startOfWeek);
    startOfNextWeek.setDate(startOfNextWeek.getDate() + 7);
    const startOfNextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);

    switch (range) {
      case 'Today':
        return date >= startOfToday && date < startOfTomorrow;
      case 'Last 7 Days':
        return date >= startOfLastSevenDays && date <= now;
      case 'This Week':
        return date >= startOfWeek && date < startOfNextWeek;
      case 'This Month':
        return date >= startOfMonth && date < startOfNextMonth;
      default:
        return true;
    }
  };

  const filterRequests = (rows) => {
    const searchTerm = activeSearchText.trim().toLowerCase();

    return rows.filter((r) => {
      const matchesReporterRole = getReporterRole(r) === activeReporterRole;
      const matchesSearch = !searchTerm || [
        r.equipmentId,
        r.equipmentName,
        r.reporterName,
        r.reporterEmail,
        r.technicianName,
        r.issueTitle,
        r.description,
        r.laboratoryRoom,
        r.equipmentLocation
      ].some((value) => String(value || '').toLowerCase().includes(searchTerm));

      const matchesStatus = activeStatusFilter === 'All' || (r.status || 'Pending') === activeStatusFilter;
      const matchesDate = activeDateFilter === 'All' || isWithinDateRange(r.dateReported, activeDateFilter);

      return matchesReporterRole && matchesSearch && matchesStatus && matchesDate;
    });
  };

  const setReporterRole = (role) => {
    activeReporterRole = role;
    paginationState.currentPage = 1;
    document.querySelectorAll('[data-reporter-role]').forEach((tab) => {
      const isActive = tab.dataset.reporterRole === role;
      tab.classList.toggle('active', isActive);
      tab.setAttribute('aria-selected', String(isActive));
      tab.setAttribute('tabindex', isActive ? '0' : '-1');
    });
    updateMaintenanceCounts();
    renderTable(filterRequests(currentRequests));
  };

  const setStatusFilter = (status) => {
    activeStatusFilter = status;
    paginationState.currentPage = 1;
    document.querySelectorAll(statusOptionSelector).forEach((option) => {
      const isActive = option.dataset.filter === status;
      option.classList.toggle('active', isActive);
      option.setAttribute('aria-selected', String(isActive));
      option.tabIndex = isActive ? 0 : -1;
    });
    syncStatusDropdown();
    renderTable(filterRequests(currentRequests));
  };

  const setDateFilter = (range) => {
    activeDateFilter = range;
    paginationState.currentPage = 1;
    renderTable(filterRequests(currentRequests));
  };

  const setSearchText = (value) => {
    activeSearchText = value;
    if (maintenanceSearchClear) maintenanceSearchClear.hidden = !String(value || '').length;
    paginationState.currentPage = 1;
    renderTable(filterRequests(currentRequests));
  };

  const getVisiblePaginationItems = (totalPages, currentPage) => {
    if (totalPages <= 1) return [];
    if (totalPages <= 7) {
      return Array.from({ length: totalPages }, (_, index) => index + 1);
    }

    const items = [1];
    if (currentPage <= 2) {
      items.push(2);
      items.push('...');
      items.push(totalPages);
    } else if (currentPage >= totalPages - 1) {
      items.push('...');
      items.push(totalPages - 1);
      items.push(totalPages);
    } else {
      items.push('...');
      items.push(currentPage);
      items.push(currentPage + 1);
      items.push('...');
      items.push(totalPages);
    }
    return items;
  };

  const renderPaginationControls = (rows) => {
    const paginationContainer = document.getElementById('maintenancePagination');
    const paginationInfo = document.getElementById('maintenancePaginationInfo');
    if (!paginationContainer) return;

    const totalPages = Math.max(1, Math.ceil((rows?.length || 0) / paginationState.rowsPerPage));
    paginationState.currentPage = Math.min(Math.max(1, paginationState.currentPage), totalPages);

    const startIndex = rows && rows.length ? (paginationState.currentPage - 1) * paginationState.rowsPerPage + 1 : 0;
    const endIndex = rows && rows.length ? Math.min(paginationState.currentPage * paginationState.rowsPerPage, rows.length) : 0;
    if (paginationInfo) {
      paginationInfo.textContent = rows && rows.length ? `Showing ${startIndex}-${endIndex} of ${rows.length}` : 'Showing 0 of 0';
    }

    paginationContainer.innerHTML = '';

    const createButton = (label, page, isActive, isDisabled, isPageNumber = false) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = label;
      button.disabled = isDisabled;
      if (isPageNumber && isActive) button.setAttribute('aria-current', 'page');
      if (isPageNumber) button.setAttribute('aria-label', `Page ${label}`);
      else button.setAttribute('aria-label', `${label} page`);

      if (isPageNumber) {
        button.className = isActive
          ? 'flex h-8 w-8 items-center justify-center rounded-lg border border-emerald-500 bg-emerald-600 font-bold text-white shadow-sm transition'
          : 'flex h-8 w-8 items-center justify-center rounded-lg border border-emerald-800/40 bg-emerald-950/40 text-emerald-300 transition hover:bg-emerald-900/60';
      } else {
        button.className = 'rounded-lg border border-emerald-800/50 bg-emerald-950/40 px-3 py-1.5 text-sm text-emerald-300 transition hover:bg-emerald-900/50';
      }

      if (isDisabled) {
        button.classList.add('cursor-not-allowed', 'opacity-40');
      }

      if (!isDisabled) {
        button.addEventListener('click', () => {
          paginationState.currentPage = page;
          renderTable(rows);
          document.querySelector('#maintenance-monitoring .overflow-x-auto')?.scrollTo({ top: 0, behavior: 'smooth' });
        });
      }
      return button;
    };

    paginationContainer.appendChild(createButton('Previous', paginationState.currentPage - 1, false, paginationState.currentPage <= 1));

    const visiblePages = getVisiblePaginationItems(totalPages, paginationState.currentPage);
    visiblePages.forEach((pageItem) => {
      if (pageItem === '...') {
        const ellipsis = document.createElement('span');
        ellipsis.className = 'px-1 font-bold text-emerald-500/60';
        ellipsis.textContent = '...';
        paginationContainer.appendChild(ellipsis);
        return;
      }

      paginationContainer.appendChild(createButton(String(pageItem), pageItem, pageItem === paginationState.currentPage, false, true));
    });

    paginationContainer.appendChild(createButton('Next', paginationState.currentPage + 1, false, paginationState.currentPage >= totalPages));
  };

  const renderTable = (rows) => {
    if (!rows.length) {
      tableBody.innerHTML = '<tr><td colspan="6" class="maintenance-empty-row">No maintenance reports match your filters. Try changing the search or filters.</td></tr>';
      renderPaginationControls(rows);
      return;
    }

    const totalPages = Math.max(1, Math.ceil(rows.length / paginationState.rowsPerPage));
    paginationState.currentPage = Math.min(Math.max(1, paginationState.currentPage), totalPages);
    const startIndex = (paginationState.currentPage - 1) * paginationState.rowsPerPage;
    const pageRows = rows.slice(startIndex, startIndex + paginationState.rowsPerPage);

    tableBody.innerHTML = pageRows.map(r => {
      const reportedDate = r.dateReported ? new Date(r.dateReported) : null;
      const hasValidDate = reportedDate && !Number.isNaN(reportedDate.getTime());
      const dateLabel = hasValidDate
        ? new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(reportedDate)
        : 'Date unavailable';
      const timeLabel = hasValidDate
        ? new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(reportedDate)
        : '';
      const dateTimeLabel = hasValidDate ? `${dateLabel} • ${timeLabel}` : dateLabel;
      const statusClass = getStatusBadgeClass(r.status);
      const currentStatus = r.status || 'Pending';
      const equipmentName = r.equipmentName || 'Unknown Equipment';
      const equipmentId = String(r.equipmentId || '').trim();
      const equipmentLocation = String(r.laboratoryRoom || r.equipmentLocation || '').trim();
      const equipmentDetails = [equipmentId, equipmentLocation].filter(Boolean).join(' · ');
      const equipmentTooltip = equipmentDetails ? `${equipmentName} · ${equipmentDetails}` : equipmentName;
      const issueTitle = getIssueTitle(r);
      const issueDescription = String(r.description || '').trim();
      const reporterName = String(r.reporterName || 'Unknown Reporter');
      const reporterInitials = reporterName
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map(part => part.charAt(0).toUpperCase())
        .join('') || 'U';
      const reporterPhoto = String(r.reporterPhoto || r.reporter?.photo || r.reporterPhotoUrl || '').trim();
      const reporterAvatar = reporterPhoto
        ? `<span class="maintenance-reporter-avatar has-profile-photo" aria-hidden="true" data-reporter-initials="${escapeHtml(reporterInitials)}"><img class="maintenance-reporter-photo" src="${escapeHtml(reporterPhoto)}" alt=""></span>`
        : `<span class="maintenance-reporter-avatar" aria-hidden="true">${escapeHtml(reporterInitials)}</span>`;
      const reportedDateTime = hasValidDate ? reportedDate.toISOString() : '';
      return `
        <tr class="maintenance-report-row" data-maintenance-details="${escapeHtml(String(r.id ?? ''))}" title="Open report details">
          <td class="px-4 py-3" data-label="Equipment"><div class="maintenance-equipment-cell" title="${escapeHtml(equipmentTooltip)}"><span class="maintenance-equipment-name">${escapeHtml(equipmentName)}</span>${equipmentId ? `<span class="maintenance-equipment-id">${escapeHtml(equipmentId)}</span>` : ''}</div>${equipmentLocation ? `<span class="maintenance-equipment-location">${escapeHtml(equipmentLocation)}</span>` : ''}</td>
          <td class="px-4 py-3" data-label="Issue"><span class="maintenance-issue-title" title="${escapeHtml(issueTitle)}">${escapeHtml(issueTitle)}</span>${issueDescription ? `<span class="maintenance-issue-description" title="${escapeHtml(issueDescription)}">${escapeHtml(issueDescription)}</span>` : '<span class="maintenance-issue-description">No additional details provided.</span>'}</td>
          <td class="px-4 py-3" data-label="Reported by"><div class="maintenance-reporter">${reporterAvatar}<span class="maintenance-reporter-copy"><span class="maintenance-reporter-name">${escapeHtml(reporterName)}</span>${r.reporterEmail ? `<span class="maintenance-reporter-email" title="${escapeHtml(String(r.reporterEmail))}">${escapeHtml(String(r.reporterEmail))}</span>` : ''}</span></div></td>
          <td class="px-4 py-3" data-label="Status"><span class="status-badge ${statusClass}">${escapeHtml(currentStatus)}</span></td>
          <td class="px-4 py-3" data-label="Date reported"><span class="maintenance-reported-date">${reportedDateTime ? `<time datetime="${escapeHtml(reportedDateTime)}"><span class="maintenance-date-label">${escapeHtml(dateLabel)}</span><span class="maintenance-time-label">${escapeHtml(timeLabel)}</span></time>` : `<time><span class="maintenance-date-label">${escapeHtml(dateTimeLabel)}</span></time>`}</span></td>
          <td class="px-4 py-3" data-label="Action"><button type="button" class="maintenance-details-button" aria-label="View details for ${escapeHtml(equipmentName)} report" title="View details"><i class="fas fa-eye" aria-hidden="true"></i></button></td>
        </tr>
      `;
    }).join('\n');

    tableBody.querySelectorAll('.maintenance-reporter-avatar.has-profile-photo').forEach((avatar) => {
      const image = avatar.querySelector('img');
      if (!image) return;
      image.addEventListener('error', () => {
        avatar.classList.remove('has-profile-photo');
        avatar.textContent = avatar.dataset.reporterInitials || 'U';
      }, { once: true });
    });

    renderPaginationControls(rows);
  };

  const getStatusBadgeClass = (status) => {
    switch (status) {
      case 'Pending': return 'status-pending';
      case 'In Progress': return 'status-in-progress';
      case 'Resolved': return 'status-resolved';
      case 'Rejected': return 'status-rejected';
      case 'Cancelled': return 'status-cancelled';
      default: return 'status-secondary';
    }
  };

  const updateMaintenanceStatus = async (requestId, status) => {
    try {
      const res = await fetch(`/api/maintenance/${requestId}/status`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status })
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        const err = body?.error || body?.message || 'Failed to update status';
        setMessage(assignMessage, err, true);
        return false;
      }
      setMessage(assignMessage, 'Status updated successfully', false);
      await refreshMaintenanceData();
      return true;
    } catch (err) {
      console.error(err);
      setMessage(assignMessage, 'Network error — try again', true);
      return false;
    }
  };

  const setCurrentUserHeader = () => {
    if (adminAvatar) adminAvatar.textContent = 'SO';
    if (adminUserName) adminUserName.textContent = 'Supply Office';
    if (adminUserRole) adminUserRole.textContent = 'Super Admin';
  };

  const getInitials = (name) => {
    if (!name) return 'AD';
    return name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map(part => part.charAt(0).toUpperCase())
      .join('');
  };

  const capitalize = (value) => {
    if (!value) return '';
    return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
  };

  function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/[&<>"']/g, function (s) {
      return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":"&#39;"})[s];
    });
  }

  const refreshMaintenanceData = async () => {
    if (isMaintenanceRefreshing) return false;
    isMaintenanceRefreshing = true;
    const refreshButton = document.getElementById('refreshMaintenanceData');
    const refreshIcon = refreshButton?.querySelector('i');
    refreshButton?.setAttribute('aria-busy', 'true');
    refreshButton?.classList.add('is-refreshing');
    refreshButton && (refreshButton.disabled = true);
    refreshIcon?.classList.add('fa-spin');

    try {
      const [, requestsLoaded] = await Promise.all([
        fetchSummary(),
        fetchRequests()
      ]);
      const updatedLabel = document.getElementById('maintenanceLastUpdated');
      if (updatedLabel) {
        updatedLabel.textContent = requestsLoaded
          ? `Last updated: ${new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(new Date())}`
          : 'Unable to refresh reports';
      }
      return requestsLoaded;
    } finally {
      isMaintenanceRefreshing = false;
      refreshButton?.removeAttribute('aria-busy');
      refreshButton?.classList.remove('is-refreshing');
      refreshButton && (refreshButton.disabled = false);
      refreshIcon?.classList.remove('fa-spin');
    }
  };

  // Accessible custom status dropdown behavior; selection still calls setStatusFilter().
  const getStatusOptions = () => Array.from(document.querySelectorAll(statusOptionSelector));
  const closeStatusDropdown = (restoreFocus = false) => {
    if (!statusDropdown || !statusTrigger) return;
    statusDropdown.classList.remove('is-open');
    statusTrigger.setAttribute('aria-expanded', 'false');
    if (restoreFocus) statusTrigger.focus();
  };

  const openStatusDropdown = (focusActive = true) => {
    if (!statusDropdown || !statusTrigger) return;
    statusDropdown.classList.add('is-open');
    statusTrigger.setAttribute('aria-expanded', 'true');
    if (focusActive) {
      getStatusOptions().find((option) => option.getAttribute('aria-selected') === 'true')?.focus();
    }
  };

  const moveStatusOptionFocus = (direction) => {
    const options = getStatusOptions();
    if (!options.length) return;
    const currentIndex = options.indexOf(document.activeElement);
    const nextIndex = currentIndex < 0
      ? 0
      : (currentIndex + direction + options.length) % options.length;
    options[nextIndex].focus();
  };

  statusTrigger?.addEventListener('click', () => {
    if (statusDropdown?.classList.contains('is-open')) closeStatusDropdown();
    else openStatusDropdown();
  });

  statusTrigger?.addEventListener('keydown', (event) => {
    if (['Enter', ' ', 'ArrowDown'].includes(event.key)) {
      event.preventDefault();
      openStatusDropdown();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      openStatusDropdown();
      moveStatusOptionFocus(-1);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      closeStatusDropdown();
    }
  });

  statusMenu?.addEventListener('click', (event) => {
    const option = event.target.closest('.maintenance-status-option');
    if (!option) return;
    setStatusFilter(option.dataset.filter);
    closeStatusDropdown(true);
  });

  statusMenu?.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
      event.preventDefault();
      moveStatusOptionFocus(1);
    } else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
      event.preventDefault();
      moveStatusOptionFocus(-1);
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      const option = event.target.closest('.maintenance-status-option');
      if (option) {
        setStatusFilter(option.dataset.filter);
        closeStatusDropdown(true);
      }
    } else if (event.key === 'Escape') {
      event.preventDefault();
      closeStatusDropdown(true);
    } else if (event.key === 'Tab') {
      closeStatusDropdown();
    }
  });

  document.addEventListener('click', (event) => {
    if (statusDropdown?.classList.contains('is-open') && !statusDropdown.contains(event.target)) {
      closeStatusDropdown();
    }
  });

  document.querySelectorAll('[data-reporter-role]').forEach((tab) => {
    tab.addEventListener('click', () => setReporterRole(tab.dataset.reporterRole));
    tab.addEventListener('keydown', (event) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const tabs = Array.from(document.querySelectorAll('[data-reporter-role]'));
      if (!tabs.length) return;
      let nextIndex = tabs.indexOf(tab);
      if (event.key === 'Home') nextIndex = 0;
      else if (event.key === 'End') nextIndex = tabs.length - 1;
      else nextIndex = (nextIndex + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
      tabs[nextIndex].focus();
      setReporterRole(tabs[nextIndex].dataset.reporterRole);
    });
  });

  maintenanceSearchInput?.addEventListener('input', (e) => {
    setSearchText(e.target.value);
  });

  maintenanceSearchClear?.addEventListener('click', () => {
    if (maintenanceSearchInput) maintenanceSearchInput.value = '';
    setSearchText('');
    maintenanceSearchInput?.focus();
  });

  dateFilter?.addEventListener('change', (e) => {
    setDateFilter(e.target.value);
  });

  document.getElementById('refreshMaintenanceData')?.addEventListener('click', async (e) => {
    e.preventDefault();
    await refreshMaintenanceData();
  });

  const detailsModal = document.getElementById('maintenanceDetailsModal');
  const detailsModalBody = document.getElementById('maintenanceDetailsBody');
  let lastDetailsTrigger = null;

  const closeMaintenanceDetails = () => {
    if (!detailsModal) return;
    detailsModal.classList.remove('show');
    detailsModal.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('maintenance-details-open');
    if (lastDetailsTrigger?.isConnected) lastDetailsTrigger.focus();
    lastDetailsTrigger = null;
  };

  const openMaintenanceDetails = (request, trigger) => {
    if (!detailsModal || !detailsModalBody || !request) return;
    lastDetailsTrigger = trigger;
    const date = request.dateReported ? new Date(request.dateReported) : null;
    const dateLabel = date && !Number.isNaN(date.getTime())
      ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date)
      : 'Date unavailable';
    const reporterName = request.reporterName || 'Unknown Reporter';
    const reporterInitials = reporterName
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map(part => part.charAt(0).toUpperCase())
      .join('') || 'U';
    const reporterPhoto = String(request.reporterPhoto || request.reporter?.photo || request.reporterPhotoUrl || '').trim();
    const fields = [
      ['Report ID', request.id ? `#${request.id}` : 'Not available'],
      ['Equipment', request.equipmentName || 'Unknown Equipment'],
      ['Equipment ID', request.equipmentId || 'Not linked'],
      ['Location', request.laboratoryRoom || request.equipmentLocation || request.campus || 'Not specified'],
      ['Reported issue', getIssueTitle(request)],
      ['Additional details', request.description || 'No additional details provided.'],
      ['Reported by', reporterName],
      ['Reporter email', request.reporterEmail || 'Not available'],
      ['Reporter type', getReporterRole(request) === 'faculty' ? 'Faculty' : 'Student'],
      ['Current status', request.status || 'Pending'],
      ['Priority', request.priority || 'Not set'],
      ['Date reported', dateLabel],
      ['Assigned technician', request.technicianName || 'Unassigned'],
      ['Equipment condition', request.equipmentStatus || 'Not available']
    ];
    detailsModalBody.innerHTML = fields.map(([label, value]) => {
      if (label === 'Reported by') {
        const photoMarkup = reporterPhoto
          ? `<span class="maintenance-detail-reporter-avatar has-profile-photo" data-reporter-initials="${escapeHtml(reporterInitials)}"><img src="${escapeHtml(reporterPhoto)}" alt="${escapeHtml(reporterName)}"></span>`
          : `<span class="maintenance-detail-reporter-avatar">${escapeHtml(reporterInitials)}</span>`;
        return `
          <div class="maintenance-detail-item maintenance-detail-reporter">
            <span>${escapeHtml(label)}</span>
            <strong>${photoMarkup}<span class="maintenance-detail-reporter-name">${escapeHtml(String(value))}</span></strong>
          </div>
        `;
      }
      return `
        <div class="maintenance-detail-item${label === 'Additional details' ? ' maintenance-detail-item-wide' : ''}">
          <span>${escapeHtml(label)}</span>
          <strong>${escapeHtml(String(value))}</strong>
        </div>
      `;
    }).join('');
    detailsModalBody.querySelectorAll('.maintenance-detail-reporter-avatar.has-profile-photo').forEach((avatar) => {
      const image = avatar.querySelector('img');
      if (!image) return;
      image.addEventListener('error', () => {
        avatar.classList.remove('has-profile-photo');
        avatar.textContent = avatar.dataset.reporterInitials || 'U';
      }, { once: true });
    });
    const status = detailsModal.querySelector('[data-maintenance-modal-status]');
    if (status) {
      status.textContent = request.status || 'Pending';
      status.className = `status-badge ${getStatusBadgeClass(request.status || 'Pending')}`;
    }
    detailsModal.classList.add('show');
    detailsModal.setAttribute('aria-hidden', 'false');
    document.body.classList.add('maintenance-details-open');
    detailsModal.querySelector('[data-close-maintenance-details]')?.focus();
  };

  tableBody.addEventListener('click', event => {
    const trigger = event.target.closest('[data-maintenance-details]');
    if (!trigger) return;
    const request = currentRequests.find(item => String(item.id) === String(trigger.dataset.maintenanceDetails));
    if (request) openMaintenanceDetails(request, trigger);
  });

  detailsModal?.addEventListener('click', event => {
    if (event.target === detailsModal || event.target.closest('[data-close-maintenance-details]')) closeMaintenanceDetails();
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && detailsModal?.classList.contains('show')) closeMaintenanceDetails();
  });

  setCurrentUserHeader();
  await refreshMaintenanceData();
})();
