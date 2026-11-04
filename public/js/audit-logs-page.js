
        const hydrateAdminBadge = () => {
          const sourceName = window.__CURRENT_USER_NAME__ || window.__CURRENT_USER__?.name || 'Administrator';
          const displayName = String(sourceName || 'Administrator').trim() || 'Administrator';
          const initials = displayName.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part.charAt(0).toUpperCase()).join('') || 'AD';

          const avatarEl = document.getElementById('adminBadgeAvatar');
          const nameEl = document.getElementById('adminBadgeName');
          const roleEl = document.getElementById('adminBadgeRole');

          if (avatarEl) avatarEl.textContent = initials;
          if (nameEl) nameEl.textContent = displayName;
          if (roleEl) roleEl.textContent = 'Admin';
        };

        const hydrateAuditCampus = () => {
          const campusDisplay = document.getElementById('auditCampusDisplay');
          if (campusDisplay) campusDisplay.textContent = 'All Campuses';
          auditState.campus = '';
        };

        const auditState = { page: 1, pageSize: 7, totalPages: 1, query: '', userId: '', campus: '', dateRange: 'all', dateFrom: '', dateTo: '', entries: [], users: [], isLoading: false, loadError: false };
        const loginLogoutState = { page: 1, pageSize: 25, totalPages: 1, station: '', role: '', action: '', loading: false, loaded: false, stationsLoaded: false, reloadPending: false };

        const equipmentTrailState = { loaded: false, loading: false, reloadPending: false, query: '', actionType: '', dateRange: 'all', dateFrom: '', dateTo: '', entries: [], page: 1, pageSize: 7 };
        const pcLogsDetailsModal = document.getElementById('pcLogsDetailsModal');
        let lastPCLogsDetailsTrigger = null;
        const closePCLogsDetailsModal = () => {
          if (!pcLogsDetailsModal || pcLogsDetailsModal.hidden) return;
          pcLogsDetailsModal.hidden = true;
          if (lastPCLogsDetailsTrigger?.isConnected) lastPCLogsDetailsTrigger.focus();
          lastPCLogsDetailsTrigger = null;
        };
        const openPCLogsDetailsModal = (trigger) => {
          if (!pcLogsDetailsModal || !trigger) return;
          lastPCLogsDetailsTrigger = trigger;
          const roleTone = trigger.dataset.roleTone || '';
          const details = trigger.dataset.details || 'No additional details were recorded.';
          document.getElementById('pcLogsDetailsAvatar').textContent = trigger.dataset.initials || 'U';
          document.getElementById('pcLogsDetailsAvatar').className = 'pc-logs-modal-avatar ' + roleTone;
          document.getElementById('pcLogsDetailsUser').textContent = trigger.dataset.user || 'Unknown user';
          const role = document.getElementById('pcLogsDetailsRole');
          role.textContent = trigger.dataset.role || 'N/A';
          role.className = 'pc-logs-role-pill ' + roleTone;
          document.getElementById('pcLogsDetailsStation').textContent = trigger.dataset.station || 'Unknown station';
          const event = document.getElementById('pcLogsDetailsEvent');
          const eventLabel = trigger.dataset.event || 'Authentication event';
          event.textContent = eventLabel;
          event.className = 'pc-logs-modal-event ' + (eventLabel.toLowerCase() === 'login' ? 'is-login' : 'is-logout');
          document.getElementById('pcLogsDetailsTime').textContent = trigger.dataset.time || 'Time not recorded';
          document.getElementById('pcLogsDetailsDescription').textContent = details;
          const methodRow = document.getElementById('pcLogsDetailsMethodRow');
          const method = /\bqr\b/i.test(details) ? 'QR scan' : '';
          document.getElementById('pcLogsDetailsMethod').textContent = method;
          methodRow.hidden = !method;
          pcLogsDetailsModal.hidden = false;
          pcLogsDetailsModal.querySelector('.pc-logs-modal-icon-close')?.focus();
        };
        document.addEventListener('click', (event) => {
          const trigger = event.target instanceof Element ? event.target.closest('.pc-logs-detail-trigger') : null;
          if (trigger) {
            openPCLogsDetailsModal(trigger);
            return;
          }
          if (event.target instanceof Element && event.target.closest('[data-pc-logs-modal-close]')) {
            closePCLogsDetailsModal();
          }
        });
        document.addEventListener('keydown', (event) => {
          if (!pcLogsDetailsModal || pcLogsDetailsModal.hidden) return;
          if (event.key === 'Escape') {
            event.preventDefault();
            closePCLogsDetailsModal();
            return;
          }
          if (event.key === 'Tab') {
            const focusable = [...pcLogsDetailsModal.querySelectorAll('button:not([disabled])')];
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            if (event.shiftKey && document.activeElement === first) {
              event.preventDefault();
              last?.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
              event.preventDefault();
              first?.focus();
            }
          }
        });
        const escapeTrailHtml = (value) => String(value ?? '—')
          .replaceAll('&', '&amp;')
          .replaceAll('<', '&lt;')
          .replaceAll('>', '&gt;')
          .replaceAll('"', '&quot;')
          .replaceAll("'", '&#039;');
        const equipmentActionLabel = (action) => ({
          created: 'Registration',
          borrow_requested: 'Borrow request submitted',
          return_requested: 'Return marked by borrower',
          borrowed: 'Borrowed',
          returned: 'Returned',
          accountability_assigned: 'Assigned',
          accountability_removed: 'Unassigned',
          maintenance_started: 'Repair started',
          maintenance_completed: 'Repair completed',
          status_changed: 'Status changed',
          condition_changed: 'Condition changed',
          location_changed: 'Location changed',
          assigned_to_set: 'Set changed',
          removed_from_set: 'Removed from set',
          deleted: 'Disposed',
          equipment_scanned: 'QR scan',
          equipment_issue_reported: 'Issue reported',
          updated: 'Updated'
        })[action] || String(action || 'Equipment activity').replaceAll('_', ' ');
        const equipmentActionTone = (action) => ({
          created: 'info',
          borrow_requested: 'info',
          borrowed: 'info',
          accountability_assigned: 'info',
          return_requested: 'warning',
          maintenance_started: 'warning',
          condition_changed: 'warning',
          status_changed: 'warning',
          accountability_removed: 'danger',
          removed_from_set: 'danger',
          deleted: 'danger',
          returned: 'success',
          maintenance_completed: 'success',
          equipment_scanned: 'neutral',
          equipment_issue_reported: 'danger',
          assigned_to_set: 'neutral',
          location_changed: 'neutral',
          updated: 'neutral'
        })[action] || 'neutral';
        const getEquipmentTrailDateBounds = () => {
          if (equipmentTrailState.dateRange === 'all') return null;
          if (equipmentTrailState.dateRange === 'custom') {
            const start = equipmentTrailState.dateFrom ? new Date(equipmentTrailState.dateFrom + 'T00:00:00') : null;
            const end = equipmentTrailState.dateTo ? new Date(equipmentTrailState.dateTo + 'T23:59:59.999') : null;
            return { start, end };
          }
          const end = new Date();
          end.setHours(23, 59, 59, 999);
          const start = new Date();
          start.setHours(0, 0, 0, 0);
          if (equipmentTrailState.dateRange === '7days') start.setDate(start.getDate() - 6);
          return { start, end };
        };
        const isWithinEquipmentTrailDateRange = (entry) => {
          const bounds = getEquipmentTrailDateBounds();
          if (!bounds) return true;
          const timestamp = new Date(entry.actionTimestamp);
          if (Number.isNaN(timestamp.getTime())) return false;
          return (!bounds.start || timestamp >= bounds.start) && (!bounds.end || timestamp <= bounds.end);
        };
        const renderEquipmentTrailPagination = () => {
          const container = document.getElementById('equipmentTrailPageButtons');
          const previous = document.getElementById('equipmentTrailPrevPage');
          const next = document.getElementById('equipmentTrailNextPage');
          const pageLabel = document.getElementById('equipmentTrailPageLabel');
          const totalPages = Math.max(1, Math.ceil(equipmentTrailState.entries.length / equipmentTrailState.pageSize));
          equipmentTrailState.page = Math.min(Math.max(1, equipmentTrailState.page), totalPages);
          if (pageLabel) pageLabel.textContent = 'Page ' + equipmentTrailState.page + ' of ' + totalPages;
          if (container) {
            container.innerHTML = '';
            const startPage = Math.max(1, Math.min(equipmentTrailState.page - 1, totalPages - 2));
            const endPage = Math.min(totalPages, startPage + 2);
            for (let page = startPage; page <= endPage; page += 1) {
              const button = document.createElement('button');
              const isActive = page === equipmentTrailState.page;
              button.type = 'button';
              button.className = isActive ? 'pagination-btn active' : 'pagination-btn';
              button.textContent = String(page);
              button.setAttribute('aria-label', 'Go to page ' + page);
              button.setAttribute('aria-current', isActive ? 'page' : 'false');
              button.addEventListener('click', () => {
                equipmentTrailState.page = page;
                renderEquipmentAuditTrailPage();
              });
              container.appendChild(button);
            }
          }
          if (previous) previous.disabled = equipmentTrailState.page <= 1;
          if (next) next.disabled = !totalPages || equipmentTrailState.page >= totalPages;
        };
        const renderEquipmentAuditTrailPage = () => {
          const body = document.getElementById('equipmentAuditTrailBody');
          const summary = document.getElementById('equipmentAuditTrailSummary');
          if (!body || !summary) return;
          const entries = equipmentTrailState.entries;
          const totalPages = Math.max(1, Math.ceil(entries.length / equipmentTrailState.pageSize));
          equipmentTrailState.page = Math.min(Math.max(1, equipmentTrailState.page), totalPages);
          const startIndex = (equipmentTrailState.page - 1) * equipmentTrailState.pageSize;
          const pageEntries = entries.slice(startIndex, startIndex + equipmentTrailState.pageSize);
          if (!entries.length) {
            body.innerHTML = '<tr><td colspan="6" class="px-3 py-5 text-center text-slate-400">No equipment audit trail entries found.</td></tr>';
            summary.textContent = 'No equipment trail records found.';
          } else {
            body.innerHTML = pageEntries.map((entry, index) => {
              const equipment = entry.equipmentName || entry.equipmentCode || (entry.equipmentId ? 'Equipment #' + entry.equipmentId : 'Equipment record');
              const equipmentIdentifier = entry.equipmentCode || (entry.equipmentId ? 'Record #' + entry.equipmentId : 'ID unavailable');
              const equipmentTooltip = 'Equipment ID: ' + equipmentIdentifier + (entry.serialNumber && entry.serialNumber !== entry.equipmentCode ? ' · Serial number: ' + entry.serialNumber : '');
              const actor = entry.performedByName || (entry.performedBy ? 'User #' + entry.performedBy : 'Unknown user');
              const accountabilitySummary = entry.actionType === 'accountability_assigned'
                ? 'Assignee: ' + (entry.accountabilityFacultyName || 'Faculty')
                : entry.actionType === 'accountability_removed'
                  ? 'Previous assignee: ' + (entry.accountabilityFacultyName || 'Faculty')
                  : '';
              const borrowedState = entry.actionType === 'borrowed' && entry.afterState && typeof entry.afterState === 'object'
                ? entry.afterState
                : null;
              const transfer = borrowedState?.accountabilityTransfer;
              const transferFrom = Array.isArray(transfer?.from)
                ? transfer.from.map((faculty) => faculty.name).filter(Boolean).join(', ')
                : '';
              const borrowedSummary = borrowedState
                ? (borrowedState.currentHolder || borrowedState.lastBorrower
                    ? 'Borrowed by ' + (borrowedState.currentHolder || borrowedState.lastBorrower)
                    : '')
                  + (transfer?.to?.name
                    ? (transferFrom ? ' · MR: ' + transferFrom + ' → ' : ' · MR assigned to ') + transfer.to.name
                    : '')
                : '';
              const description = String(entry.actionDescription || '').trim();
              const explicitReason = description.match(/\b(?:Reason|Remarks|Purpose):\s*([\s\S]*)$/i)?.[1]?.trim();
              const reason = accountabilitySummary || borrowedSummary || explicitReason || description || '—';
              const reasonPreview = reason.length > 120 ? reason.slice(0, 117) + '…' : reason;
              const performerDetails = entry.userRole === 'student'
                ? [entry.userRole, [entry.performedByProgram, entry.performedByYear, entry.performedBySection ? 'Section ' + entry.performedBySection : null].filter(Boolean).join(' - ')].filter(Boolean).join(' · ')
                : [entry.userRole, entry.performedByCollege ? 'College: ' + entry.performedByCollege : ''].filter(Boolean).join(' · ');
              const actionTone = equipmentActionTone(entry.actionType);
              const equipmentContext = equipment + ' (' + equipmentIdentifier + ')';
              return '<tr class="hover:bg-emerald-950/30">'
                + '<td class="px-3 py-2.5"><span class="equipment-trail-equipment" tabindex="0" data-trail-tooltip-details="' + escapeTrailHtml(equipmentTooltip) + '" aria-describedby="equipmentTrailEquipmentTooltip"><span class="equipment-trail-name">' + escapeTrailHtml(equipment) + '</span><span class="equipment-trail-id">(' + escapeTrailHtml(equipmentIdentifier) + ')</span></span></td>'
                + '<td class="px-3 py-2.5"><span class="action-pill pill-action equipment-trail-action equipment-trail-action--' + actionTone + '">' + escapeTrailHtml(equipmentActionLabel(entry.actionType)) + '</span></td>'
                + '<td class="px-3 py-2.5"><span class="equipment-trail-reason" title="' + escapeTrailHtml(reason) + '">' + escapeTrailHtml(reasonPreview) + '</span></td>'
                + '<td class="px-3 py-2.5"><span class="equipment-trail-performer" tabindex="0" data-trail-tooltip-details="' + escapeTrailHtml(performerDetails || 'Role details unavailable') + '" aria-describedby="equipmentTrailPerformerTooltip">' + escapeTrailHtml(actor) + '</span></td>'
                + '<td class="px-3 py-2.5 whitespace-nowrap text-slate-300">' + escapeTrailHtml(formatDateTime(entry.actionTimestamp)) + '</td>'
                + '<td class="px-3 py-2.5 text-center"><button type="button" class="equipment-trail-view" data-trail-entry="' + (startIndex + index) + '" aria-label="View details for ' + escapeTrailHtml(equipmentContext) + '"><i class="fas fa-eye" aria-hidden="true"></i><span>View</span></button></td>'
                + '</tr>';
            }).join('');
            const firstEntry = startIndex + 1;
            const lastEntry = startIndex + pageEntries.length;
            summary.textContent = 'Showing ' + firstEntry + '–' + lastEntry + ' of ' + entries.length + ' records.';
          }
          renderEquipmentTrailPagination();
        };
        const equipmentTrailTooltips = {
          '.equipment-trail-performer': document.createElement('div'),
          '.equipment-trail-equipment': document.createElement('div')
        };
        Object.entries(equipmentTrailTooltips).forEach(([selector, tooltip]) => {
          tooltip.id = selector === '.equipment-trail-performer'
            ? 'equipmentTrailPerformerTooltip'
            : 'equipmentTrailEquipmentTooltip';
          tooltip.className = 'equipment-trail-performer-tooltip';
          tooltip.setAttribute('role', 'tooltip');
          tooltip.hidden = true;
          document.body.appendChild(tooltip);
        });
        let activeEquipmentTrailTooltip = null;

        const positionEquipmentTrailTooltip = (tooltip, x, y) => {
          const padding = 8;
          const gap = 14;
          const rect = tooltip.getBoundingClientRect();
          const left = Math.min(
            Math.max(padding, x + gap),
            window.innerWidth - rect.width - padding
          );
          const top = y + gap + rect.height <= window.innerHeight - padding
            ? y + gap
            : Math.max(padding, y - rect.height - gap);
          tooltip.style.left = left + 'px';
          tooltip.style.top = top + 'px';
        };

        const getEquipmentTrailTooltip = (trigger) => {
          const selector = Object.keys(equipmentTrailTooltips)
            .find((candidate) => trigger.matches(candidate));
          return selector ? equipmentTrailTooltips[selector] : null;
        };

        const equipmentTrailBody = document.getElementById('equipmentAuditTrailBody');
        equipmentTrailBody?.addEventListener('mouseover', (event) => {
          const trigger = event.target.closest('.equipment-trail-performer, .equipment-trail-equipment');
          const tooltip = trigger && getEquipmentTrailTooltip(trigger);
          if (!trigger || !tooltip) return;
          activeEquipmentTrailTooltip = tooltip;
          tooltip.textContent = trigger.dataset.trailTooltipDetails || '';
          tooltip.hidden = false;
          positionEquipmentTrailTooltip(tooltip, event.clientX, event.clientY);
        });
        equipmentTrailBody?.addEventListener('mousemove', (event) => {
          if (activeEquipmentTrailTooltip && !activeEquipmentTrailTooltip.hidden) {
            positionEquipmentTrailTooltip(activeEquipmentTrailTooltip, event.clientX, event.clientY);
          }
        });
        equipmentTrailBody?.addEventListener('mouseout', (event) => {
          const trigger = event.target.closest('.equipment-trail-performer, .equipment-trail-equipment');
          if (!trigger || event.relatedTarget?.closest?.('.equipment-trail-performer, .equipment-trail-equipment')) return;
          const tooltip = getEquipmentTrailTooltip(trigger);
          if (tooltip) tooltip.hidden = true;
          activeEquipmentTrailTooltip = null;
        });
        equipmentTrailBody?.addEventListener('focusin', (event) => {
          const trigger = event.target.closest('.equipment-trail-performer, .equipment-trail-equipment');
          const tooltip = trigger && getEquipmentTrailTooltip(trigger);
          if (!trigger || !tooltip) return;
          const rect = trigger.getBoundingClientRect();
          activeEquipmentTrailTooltip = tooltip;
          tooltip.textContent = trigger.dataset.trailTooltipDetails || '';
          tooltip.hidden = false;
          positionEquipmentTrailTooltip(tooltip, rect.left, rect.bottom);
        });
        equipmentTrailBody?.addEventListener('focusout', (event) => {
          const trigger = event.target.closest('.equipment-trail-performer, .equipment-trail-equipment');
          const tooltip = trigger && getEquipmentTrailTooltip(trigger);
          if (tooltip) tooltip.hidden = true;
          if (activeEquipmentTrailTooltip === tooltip) activeEquipmentTrailTooltip = null;
        });
        window.addEventListener('scroll', () => {
          Object.values(equipmentTrailTooltips).forEach((tooltip) => { tooltip.hidden = true; });
          activeEquipmentTrailTooltip = null;
        }, true);

        const loadEquipmentAuditTrail = async () => {
          const body = document.getElementById('equipmentAuditTrailBody');
          const summary = document.getElementById('equipmentAuditTrailSummary');
          if (!body) return;
          if (equipmentTrailState.loading) {
            equipmentTrailState.reloadPending = true;
            return;
          }
          equipmentTrailState.loading = true;
          body.innerHTML = '<tr><td colspan="6" class="px-3 py-5 text-center text-slate-400">Loading equipment audit trail...</td></tr>';
          try {
            const params = new URLSearchParams({ limit: '5000' });
            if (equipmentTrailState.actionType) params.set('actionType', equipmentTrailState.actionType);
            const dateBounds = getEquipmentTrailDateBounds();
            if (dateBounds?.start) params.set('startDate', dateBounds.start.toISOString());
            if (dateBounds?.end) params.set('endDate', dateBounds.end.toISOString());
            const response = await fetch('/api/equipment-audit-trail?' + params.toString(), {
              cache: 'no-store',
              headers: { Accept: 'application/json' }
            });
            const payload = await response.json();
            if (!response.ok || payload?.success !== true) throw new Error(payload?.message || 'Failed to load equipment audit trail.');
            const query = equipmentTrailState.query.toLowerCase();
            const entries = (Array.isArray(payload.auditTrail) ? payload.auditTrail : []).filter((entry) => {
              if (!isWithinEquipmentTrailDateRange(entry)) return false;
              if (!query) return true;
              return [entry.equipmentName, entry.equipmentCode, entry.serialNumber, entry.equipmentId, entry.actionType, entry.actionDescription, entry.performedByName, entry.performedByCollege, entry.performedByProgram, entry.performedByYear, entry.performedBySection, entry.userRole]
                .some((value) => String(value ?? '').toLowerCase().includes(query));
            });
            equipmentTrailState.entries = entries;
            equipmentTrailState.page = 1;
            renderEquipmentAuditTrailPage();
            equipmentTrailState.loaded = true;
          } catch (error) {
            console.error('[Equipment Audit Trail] Load failed:', error);
            equipmentTrailState.entries = [];
            body.innerHTML = '<tr><td colspan="6" class="px-3 py-5 text-center text-rose-300">Unable to load equipment audit trail.</td></tr>';
            if (summary) summary.textContent = 'Equipment audit trail could not be loaded.';
            renderEquipmentTrailPagination();
          } finally {
            equipmentTrailState.loading = false;
            if (equipmentTrailState.reloadPending) {
              equipmentTrailState.reloadPending = false;
              loadEquipmentAuditTrail();
            }
          }
        };
        const loadLoginLogoutHistory = async () => {
          const body = document.getElementById('loginLogoutTableBody');
          const summary = document.getElementById('loginLogoutSummary');
          const pageLabel = document.getElementById('loginLogoutPageLabel');
          const previous = document.getElementById('loginLogoutPrevPage');
          const next = document.getElementById('loginLogoutNextPage');
          if (!body) return;
          if (loginLogoutState.loading) {
            loginLogoutState.reloadPending = true;
            return;
          }

          loginLogoutState.loading = true;
          body.innerHTML = '<tr><td colspan="6" class="pc-logs-empty"><span class="pc-logs-empty-icon"><i class="fas fa-circle-notch fa-spin" aria-hidden="true"></i></span>Loading PC station activity…</td></tr>';
          if (summary) summary.textContent = 'Loading PC station login/logout entries…';
          try {
            const params = new URLSearchParams({
              scope: 'pc-station',
              page: String(loginLogoutState.page),
              pageSize: String(loginLogoutState.pageSize)
            });
            if (loginLogoutState.station) params.set('station', loginLogoutState.station);
            if (loginLogoutState.role) params.set('role', loginLogoutState.role);
            if (loginLogoutState.action) params.set('action', loginLogoutState.action);
            const response = await fetch('/api/audit-logs?' + params.toString(), {
              cache: 'no-store',
              headers: { Accept: 'application/json' }
            });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(payload.error || 'Failed to load PC station logs.');

            const entries = Array.isArray(payload.data) ? payload.data : [];
            const escape = escapeTrailHtml;
            if (!entries.length) {
              body.innerHTML = '<tr><td colspan="6" class="pc-logs-empty"><span class="pc-logs-empty-icon"><i class="fas fa-filter-circle-xmark" aria-hidden="true"></i></span><div class="font-semibold text-slate-300">No matching PC activity</div><div class="mt-1 text-xs">Try another station, role, or action.</div></td></tr>';
            } else {
              body.innerHTML = entries.map((entry) => {
                const actionLabel = String(entry.action || 'Authentication event');
                const isLogin = actionLabel.toLowerCase() === 'login';
                const userName = String(entry.actorName || 'Unknown user');
                const userInitials = userName.trim().split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part.charAt(0).toUpperCase()).join('') || 'U';
                const role = String(entry.actorRole || 'N/A').trim().toLowerCase();
                const roleTone = ['faculty', 'instructor'].includes(role) ? 'is-faculty' : role === 'student' ? 'is-student' : ['admin', 'administrator'].includes(role) ? 'is-admin' : '';
                const stationId = String(entry.resourceId || 'Unknown station');
                const stationLocation = String(entry.stationLocation || '').trim();
                const stationLabel = stationLocation && !stationId.toLowerCase().includes(stationLocation.toLowerCase())
                  ? stationId + ' (' + stationLocation + ')'
                  : stationId;
                return '<tr class="hover:bg-slate-900/70">'
                  + '<td><div class="pc-logs-user"><span class="pc-logs-user-avatar ' + roleTone + '">' + escape(userInitials) + '</span><span class="pc-logs-user-name">' + escape(userName) + '</span></div></td>'
                  + '<td><span class="pc-logs-role-pill ' + roleTone + '">' + escape(entry.actorRole || 'N/A') + '</span></td>'
                  + '<td><span class="pc-logs-action-pill ' + (isLogin ? 'is-login' : 'is-logout') + '"><i class="fas ' + (isLogin ? 'fa-arrow-right-to-bracket' : 'fa-arrow-right-from-bracket') + '" aria-hidden="true"></i>' + escape(actionLabel) + '</span></td>'
                  + '<td><span class="pc-logs-station-pill"><i class="fas fa-desktop" aria-hidden="true"></i>' + escape(stationLabel) + '</span></td>'
                  + '<td><button type="button" class="pc-logs-detail-trigger" data-user="' + escape(userName) + '" data-initials="' + escape(userInitials) + '" data-role="' + escape(entry.actorRole || 'N/A') + '" data-role-tone="' + roleTone + '" data-event="' + escape(actionLabel) + '" data-station="' + escape(stationLabel) + '" data-time="' + escape(formatDateTime(entry.createdAt)) + '" data-details="' + escape(entry.description || 'No additional details were recorded.') + '" aria-haspopup="dialog" aria-label="View complete log details"><i class="fas fa-eye" aria-hidden="true"></i><span>View</span></button></td>'
                  + '<td><span class="pc-logs-time">' + escape(formatDateTime(entry.createdAt)) + '</span></td>'
                  + '</tr>';
              }).join('');
            }

            loginLogoutState.totalPages = Math.max(1, Number(payload.meta?.totalPages) || 1);
            loginLogoutState.page = Math.min(loginLogoutState.page, loginLogoutState.totalPages);
            const total = Number(payload.meta?.total) || 0;
            if (summary) {
              summary.textContent = total
                ? 'Showing ' + ((loginLogoutState.page - 1) * loginLogoutState.pageSize + 1)
                  + '–' + ((loginLogoutState.page - 1) * loginLogoutState.pageSize + entries.length)
                  + ' of ' + total + ' PC station log entries'
                  + (loginLogoutState.station ? ' for ' + loginLogoutState.station : '') + '.'
                : 'No PC station logs found.';
            }
            if (pageLabel) pageLabel.textContent = 'Page ' + loginLogoutState.page + ' of ' + loginLogoutState.totalPages;
            if (previous) previous.disabled = loginLogoutState.page <= 1;
            if (next) next.disabled = loginLogoutState.page >= loginLogoutState.totalPages;
            loginLogoutState.loaded = true;
          } catch (error) {
            console.error('[PC Logs] Load failed:', error);
            body.innerHTML = '<tr><td colspan="6" class="pc-logs-empty text-rose-300">' + escapeTrailHtml(error.message || 'Unable to load PC station logs.') + '</td></tr>';
            if (summary) summary.textContent = 'PC station logs could not be loaded.';
            if (previous) previous.disabled = true;
            if (next) next.disabled = true;
          } finally {
            loginLogoutState.loading = false;
            if (loginLogoutState.reloadPending) {
              loginLogoutState.reloadPending = false;
              loadLoginLogoutHistory();
            }
          }
        };
        const loadPCStationFilterOptions = async () => {
          const stationFilter = document.getElementById('loginLogoutStationFilter');
          if (!stationFilter || loginLogoutState.stationsLoaded) return;
          loginLogoutState.stationsLoaded = true;
          try {
            const response = await fetch('/api/equipment-sets', {
              cache: 'no-store',
              headers: { Accept: 'application/json' }
            });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok || !Array.isArray(payload.sets)) throw new Error(payload.message || 'Failed to load PC stations.');
            const stations = [...new Set(payload.sets.map((set) => String(set.setId || '').trim()).filter(Boolean))]
              .sort((left, right) => left.localeCompare(right));
            stationFilter.innerHTML = '<option value="">All PC stations</option>'
              + stations.map((stationId) => '<option value="' + escapeTrailHtml(stationId) + '">' + escapeTrailHtml(stationId) + '</option>').join('');
          } catch (error) {
            loginLogoutState.stationsLoaded = false;
            console.error('[PC Logs] Station filter load failed:', error);
          }
        };
        const setAuditView = (view) => {
          const isTrail = view === 'trail';
          const isLoginLogout = view === 'login';
          document.getElementById('systemAuditPanel')?.classList.toggle('hidden', isTrail || isLoginLogout);
          document.getElementById('loginLogoutAuditPanel')?.classList.toggle('hidden', !isLoginLogout);
          document.getElementById('equipmentAuditTrailPanel')?.classList.toggle('hidden', !isTrail);
          const selectedTabId = isTrail ? 'equipmentTrailTab' : isLoginLogout ? 'loginLogoutTab' : 'systemAuditTab';
          ['systemAuditTab', 'loginLogoutTab', 'equipmentTrailTab'].forEach((id) => {
            const tab = document.getElementById(id);
            const selected = id === selectedTabId;
            tab?.classList.toggle('bg-emerald-500', selected);
            tab?.classList.toggle('text-black', selected);
            tab?.classList.toggle('text-emerald-200', !selected);
            tab?.setAttribute('aria-selected', String(selected));
          });
          if (isTrail && !equipmentTrailState.loaded) loadEquipmentAuditTrail();
          if (isLoginLogout && !loginLogoutState.stationsLoaded) loadPCStationFilterOptions();
          if (isLoginLogout && !loginLogoutState.loaded) loadLoginLogoutHistory();
        };

        // Helper function to get elements with null checking
        const getAuditElements = () => ({
          auditSearchInput: document.getElementById('auditSearchInput'),
          auditUserSelect: document.getElementById('auditUserSelect'),
          auditCampusDisplay: document.getElementById('auditCampusDisplay'),
          auditDateRangeSelect: document.getElementById('auditDateRangeSelect'),
          auditLogsTableBody: document.getElementById('auditLogsTableBody'),
          auditLogsSummary: document.getElementById('auditLogsSummary'),
          auditPageButtons: document.getElementById('auditPageButtons'),
          auditPrevPage: document.getElementById('auditPrevPage'),
          auditNextPage: document.getElementById('auditNextPage')
        });

        let auditElements = getAuditElements();
        
        // Destructure for convenience, but will re-check if needed
        let auditSearchInput = auditElements.auditSearchInput;
        let auditUserSelect = auditElements.auditUserSelect;
        let auditCampusDisplay = auditElements.auditCampusDisplay;
        let auditDateRangeSelect = auditElements.auditDateRangeSelect;
        let auditLogsTableBody = auditElements.auditLogsTableBody;
        let auditLogsSummary = auditElements.auditLogsSummary;
        let auditPageButtons = auditElements.auditPageButtons;
        let auditPrevPage = auditElements.auditPrevPage;
        let auditNextPage = auditElements.auditNextPage;
        
        const ensureAuditElements = () => {
          auditElements = getAuditElements();
          auditSearchInput = auditElements.auditSearchInput;
          auditUserSelect = auditElements.auditUserSelect;
          auditCampusDisplay = auditElements.auditCampusDisplay;
          auditDateRangeSelect = auditElements.auditDateRangeSelect;
          auditLogsTableBody = auditElements.auditLogsTableBody;
          auditLogsSummary = auditElements.auditLogsSummary;
          auditPageButtons = auditElements.auditPageButtons;
          auditPrevPage = auditElements.auditPrevPage;
          auditNextPage = auditElements.auditNextPage;
          return auditElements;
        };

        const formatDateTime = (value) => {
          if (!value) return '—';
          try { return new Date(value).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' }); } catch { return value; }
        };

        const formatCompactAuditDateTime = (value) => {
          if (!value) return '<span>—</span>';
          const date = new Date(value);
          if (Number.isNaN(date.getTime())) return '<span>' + escapeTrailHtml(formatDateTime(value)) + '</span>';
          return '<span>' + escapeTrailHtml(date.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })) + '</span>'
            + '<span>' + escapeTrailHtml(date.toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' })) + '</span>';
        };

        const formatAuditDescription = (entry) => {
          const description = String(entry.description || '').trim();
          if (!description) return '—';

          const attendanceCreated = /^Created attendance session .* for schedule \d+/i;
          const attendanceUpdated = /^Updated attendance for .* in session .*$/i;
          const attendanceRecorded = /^Recorded attendance for .* in session .*$/i;
          const maintenanceCreated = /^Maintenance request created for equipment .*$/i;
          const maintenanceStatus = /^Maintenance request .* status changed to (.+)\.?$/i;
          const maintenanceAssigned = /^Technician .* assigned to maintenance request .*$/i;
          const maintenanceDeleted = /^Maintenance request .* was deleted\.?$/i;
          const equipmentAdded = /^Equipment .* \((.+)\) was added\.$/i;
          const equipmentUpdated = /^Equipment .* \((.+)\) was updated\.$/i;
          const equipmentDeleted = /^Equipment .* \((.+)\) was deleted\.$/i;
          const borrowRecorded = /^.+ borrowed \d+x .+ \(.+\)\.$/i;
          const userProfileUpdated = /^User profile updated for .*\.?$/i;
          const userLoggedOut = /^User .* logged out\.?$/i;
          const scheduleCreated = /^Created laboratory schedule (.+?)(?: \(.+\))?\.?$/i;
          const scheduleUpdated = /^Updated laboratory schedule (.+?)(?: \(.+\))?\.?$/i;
          const scheduleDeleted = /^Deleted laboratory schedule (.+?)(?: \(.+\))?\.?$/i;

          if (attendanceCreated.test(description)) {
            return 'Created an attendance session for the selected laboratory schedule.';
          }
          if (attendanceUpdated.test(description)) {
            return 'Updated attendance details for the selected student.';
          }
          if (attendanceRecorded.test(description)) {
            return 'Recorded attendance for the selected student.';
          }
          if (maintenanceCreated.test(description)) {
            return 'Created a maintenance request for the selected equipment.';
          }
          if (maintenanceStatus.test(description)) {
            const match = description.match(maintenanceStatus);
            return match ? 'Updated maintenance request status to ' + match[1] + '.' : 'Updated maintenance request status.';
          }
          if (maintenanceAssigned.test(description)) {
            return 'Assigned a technician to a maintenance request.';
          }
          if (maintenanceDeleted.test(description)) {
            return 'Deleted a maintenance request.';
          }
          if (equipmentAdded.test(description)) {
            const match = description.match(equipmentAdded);
            return match ? 'Added equipment item ' + match[1] + '.' : 'Added a new equipment item.';
          }
          if (equipmentUpdated.test(description)) {
            const match = description.match(equipmentUpdated);
            return match ? 'Updated equipment item ' + match[1] + '.' : 'Updated an equipment item.';
          }
          if (equipmentDeleted.test(description)) {
            const match = description.match(equipmentDeleted);
            return match ? 'Deleted equipment item ' + match[1] + '.' : 'Deleted an equipment item.';
          }
          if (borrowRecorded.test(description)) {
            return description.replace(/ \([^)]*\)\.?$/, '.');
          }
          if (userProfileUpdated.test(description)) {
            return 'Updated the user profile.';
          }
          if (userLoggedOut.test(description)) {
            return 'User logged out.';
          }
          if (scheduleCreated.test(description)) {
            const match = description.match(scheduleCreated);
            return match ? 'Created laboratory schedule ' + match[1].trim() + '.' : 'Created a laboratory schedule.';
          }
          if (scheduleUpdated.test(description)) {
            const match = description.match(scheduleUpdated);
            return match ? 'Updated laboratory schedule ' + match[1].trim() + '.' : 'Updated a laboratory schedule.';
          }
          if (scheduleDeleted.test(description)) {
            const match = description.match(scheduleDeleted);
            return match ? 'Deleted laboratory schedule ' + match[1].trim() + '.' : 'Deleted a laboratory schedule.';
          }

          return description;
        };

        const getSlidingPageWindow = (totalPages, currentPage) => {
          if (totalPages <= 1) return [];
          if (totalPages <= 3) return Array.from({ length: totalPages }, (_, index) => index + 1);
          if (currentPage <= 1) return [1, 2, 3];
          if (currentPage >= totalPages) return [totalPages - 2, totalPages - 1, totalPages];
          return [currentPage - 1, currentPage, currentPage + 1];
        };

        const renderAuditPagination = () => {
          ensureAuditElements();
          
          if (!auditPageButtons) {
            console.warn('[Audit Logs] auditPageButtons not found');
            return;
          }
          
          const totalPages = Math.max(1, Number(auditState.totalPages) || 1);
          const currentPage = Math.min(Math.max(1, Number(auditState.page) || 1), totalPages);
          auditState.page = currentPage;

          auditPageButtons.innerHTML = '';
          if (totalPages <= 1) return;

          const visiblePages = getSlidingPageWindow(totalPages, currentPage);

          visiblePages.forEach((pageNum) => {
            const button = document.createElement('button');
            button.type = 'button';
            const isActive = pageNum === currentPage;
            button.className = isActive
              ? 'flex h-8 w-8 items-center justify-center rounded-lg border border-emerald-500 bg-emerald-600 font-bold text-white shadow-sm transition'
              : 'flex h-8 w-8 items-center justify-center rounded-lg border border-emerald-800/40 bg-emerald-950/40 text-emerald-300 transition hover:bg-emerald-900/60';
            button.textContent = String(pageNum);
            button.setAttribute('aria-label', 'Go to page ' + pageNum);
            button.setAttribute('aria-current', isActive ? 'page' : 'false');
            button.disabled = false;
            button.addEventListener('click', () => {
              console.log('[Audit Logs] Page', pageNum, 'clicked');
              if (auditState.page === pageNum) return;
              auditState.page = pageNum;
              loadAuditLogs();
            });
            auditPageButtons.appendChild(button);
          });
        };

        const renderAuditTable = () => {
          ensureAuditElements();
          
          if (!auditLogsTableBody) {
            console.warn('[Audit Logs] auditLogsTableBody not found');
            return;
          }
          
          const hasEntries = Array.isArray(auditState.entries) && auditState.entries.length > 0;

          if (auditState.isLoading) {
            console.log('[Audit Logs] Rendering loading state...');
            auditLogsTableBody.innerHTML = '<tr><td colspan="6" class="px-3 py-3 text-center text-slate-400">Loading audit logs...</td></tr>';
            if (auditLogsSummary) auditLogsSummary.textContent = 'Loading audit entries...';
            if (auditPrevPage) auditPrevPage.disabled = true;
            if (auditNextPage) auditNextPage.disabled = true;
            if (auditPageButtons) auditPageButtons.innerHTML = '';
            return;
          }

          if (!hasEntries) {
            console.log('[Audit Logs] Rendering empty state, error:', auditState.loadError);
            const emptyMessage = auditState.loadError ? 'Unable to load audit logs.' : 'No audit entries found.';
            auditLogsTableBody.innerHTML = '<tr><td colspan="6" class="px-3 py-3 text-center text-slate-400">' + emptyMessage + '</td></tr>';
            if (auditLogsSummary) auditLogsSummary.textContent = emptyMessage;
            if (auditPrevPage) auditPrevPage.disabled = true;
            if (auditNextPage) auditNextPage.disabled = true;
            if (auditPageButtons) auditPageButtons.innerHTML = '';
            return;
          }

          console.log('[Audit Logs] Rendering', auditState.entries.length, 'entries');
          
          const rows = auditState.entries.map((entry) => {
            const description = String(formatAuditDescription(entry) || '—');
            const shortDescription = description.length > 40
              ? description.slice(0, 37).trimEnd() + '…'
              : description;
            return ''
              + '<tr>'
              + '<td><div class="font-semibold">' + escapeTrailHtml(entry.actorName || 'System') + '</div>' + (entry.actorCollege ? '<div class="audit-log-actor-meta mt-0.5">' + escapeTrailHtml(entry.actorCollege) + '</div>' : '') + '</td>'
              + '<td>' + escapeTrailHtml(entry.actorRole || 'N/A') + '</td>'
              + '<td><span class="action-pill pill-action" title="' + escapeTrailHtml(entry.action || '') + '">' + escapeTrailHtml(entry.action || 'Unknown action') + '</span></td>'
              + '<td><span class="action-pill pill-module">' + escapeTrailHtml(entry.module || 'System') + '</span></td>'
              + '<td><span class="audit-log-description" tabindex="0" aria-describedby="auditDescriptionTooltip" data-description="' + escapeTrailHtml(description) + '" aria-label="' + escapeTrailHtml(description) + '">' + escapeTrailHtml(shortDescription) + '</span></td>'
              + '<td><div class="audit-log-timestamp">' + formatCompactAuditDateTime(entry.createdAt) + '</div></td>'
              + '</tr>';
          }).join('');
          
          auditLogsTableBody.innerHTML = rows;
          
          const summary = 'Showing ' + auditState.entries.length + ' entries on page ' + auditState.page + ' of ' + auditState.totalPages + '.';
          if (auditLogsSummary) auditLogsSummary.textContent = summary;
          console.log('[Audit Logs]', summary);
          
          if (auditPrevPage) auditPrevPage.disabled = auditState.page <= 1;
          if (auditNextPage) auditNextPage.disabled = auditState.page >= auditState.totalPages;
          renderAuditPagination();
        };

        const auditDescriptionTooltip = document.createElement('div');
        auditDescriptionTooltip.id = 'auditDescriptionTooltip';
        auditDescriptionTooltip.className = 'audit-description-tooltip';
        auditDescriptionTooltip.setAttribute('role', 'tooltip');
        auditDescriptionTooltip.hidden = true;
        document.body.appendChild(auditDescriptionTooltip);

        const positionAuditDescriptionTooltip = (x, y) => {
          const padding = 8;
          const gap = 14;
          const rect = auditDescriptionTooltip.getBoundingClientRect();
          const left = Math.min(
            Math.max(padding, x + gap),
            window.innerWidth - rect.width - padding
          );
          const top = y + gap + rect.height <= window.innerHeight - padding
            ? y + gap
            : Math.max(padding, y - rect.height - gap);
          auditDescriptionTooltip.style.left = left + 'px';
          auditDescriptionTooltip.style.top = top + 'px';
        };

        const showAuditDescriptionTooltip = (description, x, y) => {
          auditDescriptionTooltip.textContent = description;
          auditDescriptionTooltip.hidden = false;
          positionAuditDescriptionTooltip(x, y);
        };

        auditLogsTableBody?.addEventListener('mouseover', (event) => {
          const description = event.target.closest('.audit-log-description');
          if (!description) return;
          showAuditDescriptionTooltip(
            description.dataset.description || '',
            event.clientX,
            event.clientY
          );
        });
        auditLogsTableBody?.addEventListener('mousemove', (event) => {
          if (auditDescriptionTooltip.hidden) return;
          positionAuditDescriptionTooltip(event.clientX, event.clientY);
        });
        auditLogsTableBody?.addEventListener('mouseout', (event) => {
          if (!event.target.closest('.audit-log-description')) return;
          if (event.relatedTarget?.closest?.('.audit-log-description')) return;
          auditDescriptionTooltip.hidden = true;
        });
        auditLogsTableBody?.addEventListener('focusin', (event) => {
          const description = event.target.closest('.audit-log-description');
          if (!description) return;
          const rect = description.getBoundingClientRect();
          showAuditDescriptionTooltip(
            description.dataset.description || '',
            rect.left,
            rect.bottom
          );
        });
        auditLogsTableBody?.addEventListener('focusout', (event) => {
          if (event.target.closest('.audit-log-description')) {
            auditDescriptionTooltip.hidden = true;
          }
        });
        window.addEventListener('scroll', () => {
          auditDescriptionTooltip.hidden = true;
        }, true);

        const getAuditDateRangeBounds = (range = 'all') => {
          if (!range || range === 'all') return { dateFrom: '', dateTo: '' };

          const now = new Date();
          const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
          const formatDateValue = (value) => {
            const year = value.getFullYear();
            const month = String(value.getMonth() + 1).padStart(2, '0');
            const day = String(value.getDate()).padStart(2, '0');
            return year + '-' + month + '-' + day;
          };

          if (range === 'today') {
            return { dateFrom: formatDateValue(today), dateTo: formatDateValue(today) };
          }

          if (range === 'week') {
            const firstDay = new Date(today);
            const day = today.getDay();
            const diff = day === 0 ? -6 : 1 - day;
            firstDay.setDate(today.getDate() + diff);
            const lastDay = new Date(firstDay);
            lastDay.setDate(firstDay.getDate() + 6);
            return { dateFrom: formatDateValue(firstDay), dateTo: formatDateValue(lastDay) };
          }

          if (range === 'month') {
            const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
            const lastDay = new Date(today.getFullYear(), today.getMonth() + 1, 0);
            return { dateFrom: formatDateValue(firstDay), dateTo: formatDateValue(lastDay) };
          }

          if (range === 'year') {
            const firstDay = new Date(today.getFullYear(), 0, 1);
            const lastDay = new Date(today.getFullYear(), 11, 31);
            return { dateFrom: formatDateValue(firstDay), dateTo: formatDateValue(lastDay) };
          }

          return { dateFrom: '', dateTo: '' };
        };

        const getAuditDateRangeLabel = (range = auditState.dateRange) => {
          switch (range) {
            case 'today': return 'Today';
            case 'week': return 'This Week';
            case 'month': return 'This Month';
            case 'year': return 'This Year';
            default: return 'All Time';
          }
        };

        const buildAuditQuery = () => {
          const params = new URLSearchParams();
          const devBypass = new URLSearchParams(window.location.search).get('devBypass');
          params.set('scope', 'system');
          if (auditState.query) params.set('q', auditState.query);
          if (auditState.userId) params.set('userId', auditState.userId);
          if (auditState.campus) params.set('campus', auditState.campus);
          if (auditState.dateFrom) params.set('dateFrom', auditState.dateFrom);
          if (auditState.dateTo) params.set('dateTo', auditState.dateTo);
          if (devBypass === '1' || devBypass === 'true') params.set('devBypass', '1');
          params.set('page', Number(auditState.page) || 1);
          params.set('pageSize', Number(auditState.pageSize) || 7);
          return params.toString();
        };

        const loadAuditLogs = async () => {
          ensureAuditElements();
          
          auditState.isLoading = true;
          auditState.loadError = false;
          renderAuditTable();
          console.log('[Audit Logs] Started loading, isLoading=true, renderAuditTable called');

          try {
            const url = '/api/audit-logs?' + buildAuditQuery();
            console.log('[Audit Logs] Fetching from URL:', url);
            
            const response = await fetch(url, {
              cache: 'no-store',
              headers: { 'Accept': 'application/json' }
            });
            
            console.log('[Audit Logs] Response received, status:', response.status);
            
            const contentType = response.headers.get('content-type') || '';
            const text = await response.text();
            let payload = null;

            if (text) {
              try {
                payload = contentType.includes('application/json') ? JSON.parse(text) : null;
              } catch (parseErr) {
                console.warn('[Audit Logs] JSON parse error:', parseErr);
                payload = null;
              }
            }

            if (!response.ok) {
              const message = payload && payload.error ? payload.error : 'Failed to load audit logs';
              console.error('[Audit Logs] API error response:', message);
              throw new Error(message);
            }

            if (!payload || typeof payload !== 'object') {
              console.error('[Audit Logs] Invalid response payload:', payload);
              throw new Error('Invalid audit logs response');
            }

            auditState.entries = Array.isArray(payload.data) ? payload.data : [];
            auditState.totalPages = payload.meta ? payload.meta.totalPages : 1;
            auditState.total = payload.meta ? payload.meta.total : auditState.entries.length;
            auditState.loadError = false;
            
            console.log('[Audit Logs] Data loaded successfully:', {
              entriesCount: auditState.entries.length,
              totalPages: auditState.totalPages,
              total: auditState.total
            });
          } catch (error) {
            console.error('[Audit Logs] Load failed:', error);
            auditState.entries = [];
            auditState.totalPages = 1;
            auditState.total = 0;
            auditState.loadError = true;
          } finally {
            auditState.isLoading = false;
            renderAuditTable();
            console.log('[Audit Logs] Finished loading, isLoading=false, renderAuditTable called');
          }
        };

        const loadAuditUsers = async () => {
          console.log('[Audit Logs] Loading audit users...');
          try {
            const response = await fetch('/api/users?auditScope=1', { cache: 'no-store' });
            if (!response.ok) throw new Error('Failed to load users');
            const users = await response.json();
            auditState.users = Array.isArray(users) ? users.sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'en', { sensitivity: 'base' })) : [];
            console.log('[Audit Logs] Users loaded:', auditState.users.length);
            
            ensureAuditElements();
            
            if (!auditUserSelect) {
              console.warn('[Audit Logs] auditUserSelect not found');
              return;
            }
            
            auditUserSelect.innerHTML = '<option value="">All Users</option>' + auditState.users.map((user) => {
              const name = String(user.name || user.email || 'User ' + user.id).trim();
              const campus = user.campus ? ' (' + user.campus + ')' : '';
              const label = name + campus;
              return '<option value="' + String(user.id) + '">' + label + '</option>';
            }).join('');
            console.log('[Audit Logs] User dropdown populated with', auditState.users.length, 'users');

            if (auditState.userId) {
              auditUserSelect.value = auditState.userId;
            }
          } catch (error) {
            console.error('[Audit Logs] Failed to load audit users:', error);
          }
        };

        const resetAuditFilters = () => {
          console.log('[Audit Logs] resetAuditFilters called');
          ensureAuditElements();
          
          if (auditSearchInput) auditSearchInput.value = '';
          if (auditUserSelect) auditUserSelect.value = '';
          if (auditDateRangeSelect) auditDateRangeSelect.value = 'all';
          auditState.page = 1;
          auditState.dateRange = 'all';
          auditState.dateFrom = '';
          auditState.dateTo = '';
          console.log('[Audit Logs] Filters cleared, calling updateAuditFilters');
          updateAuditFilters();
        };

        window.resetAuditFilters = resetAuditFilters;

        const updateAuditFilters = () => {
          console.log('[Audit Logs] updateAuditFilters called');
          ensureAuditElements();
          
          auditState.query = auditSearchInput?.value?.trim() || '';
          auditState.userId = auditUserSelect?.value || '';
          auditState.campus = '';
          auditState.dateRange = auditDateRangeSelect?.value || 'all';
          
          console.log('[Audit Logs] Current filter state:', {
            query: auditState.query,
            userId: auditState.userId,
            campus: auditState.campus,
            dateRange: auditState.dateRange
          });
          
          const bounds = getAuditDateRangeBounds(auditState.dateRange);
          auditState.dateFrom = bounds.dateFrom;
          auditState.dateTo = bounds.dateTo;
          auditState.page = 1;
          loadAuditLogs();
        };

        // Define event handlers outside so they can be removed/re-attached
        const auditEventHandlers = {};

        const createAuditEventHandlers = () => {
          auditEventHandlers.updateFilters = () => updateAuditFilters();
          auditEventHandlers.userChanged = () => {
            console.log('[Audit Logs] User select changed');
            ensureAuditElements();
            auditState.userId = auditUserSelect?.value || '';
            auditState.page = 1;
            loadAuditLogs();
          };
        };

        createAuditEventHandlers();
        hydrateAuditCampus();

        const attachAuditEventListeners = () => {
          console.log('[Audit Logs] Attaching event listeners...');
          ensureAuditElements();
          
          // Search input - live search
          if (auditSearchInput) {
            auditSearchInput.addEventListener('input', auditEventHandlers.updateFilters);
            console.log('[Audit Logs] Search input listener attached');
          } else {
            console.warn('[Audit Logs] auditSearchInput not found');
          }
          
          // User select
          if (auditUserSelect) {
            auditUserSelect.addEventListener('change', auditEventHandlers.userChanged);
            console.log('[Audit Logs] User select listener attached');
          } else {
            console.warn('[Audit Logs] auditUserSelect not found');
          }
          
          // Date range select
          if (auditDateRangeSelect) {
            auditDateRangeSelect.addEventListener('change', auditEventHandlers.updateFilters);
            console.log('[Audit Logs] Date range select listener attached');
          } else {
            console.warn('[Audit Logs] auditDateRangeSelect not found');
          }
          
          const systemAuditTab = document.getElementById('systemAuditTab');
          const loginLogoutTab = document.getElementById('loginLogoutTab');
          const equipmentTrailTab = document.getElementById('equipmentTrailTab');
          const trailSearch = document.getElementById('equipmentTrailSearch');
          const trailAction = document.getElementById('equipmentTrailAction');
          const trailDateRange = document.getElementById('equipmentTrailDateRange');
          const trailCustomDates = document.getElementById('equipmentTrailCustomDates');
          const trailDateFrom = document.getElementById('equipmentTrailDateFrom');
          const trailDateTo = document.getElementById('equipmentTrailDateTo');
          const trailDetailsModal = document.getElementById('equipmentTrailDetailsModal');
          let lastTrailViewButton = null;
          const closeTrailDetails = () => {
            if (!trailDetailsModal) return;
            trailDetailsModal.hidden = true;
            lastTrailViewButton?.focus();
          };
          systemAuditTab?.addEventListener('click', () => setAuditView('logs'));
          loginLogoutTab?.addEventListener('click', () => setAuditView('login'));
          equipmentTrailTab?.addEventListener('click', () => setAuditView('trail'));
          const reloadPcLogsWithFilters = () => {
            loginLogoutState.page = 1;
            loginLogoutState.loaded = false;
            loadLoginLogoutHistory();
          };
          document.getElementById('loginLogoutStationFilter')?.addEventListener('change', (event) => {
            loginLogoutState.station = event.target.value;
            reloadPcLogsWithFilters();
          });
          document.getElementById('loginLogoutClearFilters')?.addEventListener('click', () => {
            loginLogoutState.station = '';
            loginLogoutState.role = '';
            loginLogoutState.action = '';
            document.getElementById('loginLogoutStationFilter').value = '';
            document.getElementById('loginLogoutRoleFilter').value = '';
            document.getElementById('loginLogoutActionFilter').value = '';
            reloadPcLogsWithFilters();
          });
          document.getElementById('loginLogoutRoleFilter')?.addEventListener('change', (event) => {
            loginLogoutState.role = event.target.value;
            reloadPcLogsWithFilters();
          });
          document.getElementById('loginLogoutActionFilter')?.addEventListener('change', (event) => {
            loginLogoutState.action = event.target.value;
            reloadPcLogsWithFilters();
          });
          document.getElementById('loginLogoutPrevPage')?.addEventListener('click', () => {
            if (loginLogoutState.page <= 1) return;
            loginLogoutState.page -= 1;
            loadLoginLogoutHistory();
          });
          document.getElementById('loginLogoutNextPage')?.addEventListener('click', () => {
            if (loginLogoutState.page >= loginLogoutState.totalPages) return;
            loginLogoutState.page += 1;
            loadLoginLogoutHistory();
          });
          document.getElementById('equipmentAuditTrailBody')?.addEventListener('click', (event) => {
            const button = event.target.closest('[data-trail-entry]');
            if (!button || !trailDetailsModal) return;
            const entry = equipmentTrailState.entries[Number(button.dataset.trailEntry)];
            if (!entry) return;
            lastTrailViewButton = button;
            const details = String(entry.actionDescription || 'No reason or additional details were recorded.');
            const reasonMatch = details.match(/\b(?:Reason|Remarks|Purpose):\s*([\s\S]*)$/i);
            const equipment = entry.equipmentName || entry.equipmentCode || (entry.equipmentId ? 'Equipment #' + entry.equipmentId : 'Equipment record');
            const equipmentIdentifier = entry.equipmentCode || (entry.equipmentId ? 'Record #' + entry.equipmentId : 'ID unavailable');
            document.getElementById('equipmentTrailDetailsContext').textContent = equipment + ' (' + equipmentIdentifier + ') · ' + equipmentActionLabel(entry.actionType);
            const afterState = entry.afterState && typeof entry.afterState === 'object' ? entry.afterState : {};
            const transfer = afterState.accountabilityTransfer;
            const transferFrom = Array.isArray(transfer?.from)
              ? transfer.from.map((faculty) => faculty.name).filter(Boolean).join(', ')
              : '';
            const borrowerOrLastBorrower = afterState.currentHolder ||
              (typeof afterState.lastBorrower === 'string' ? afterState.lastBorrower : '');
            const borrowedDetails = entry.actionType === 'borrowed'
              ? [
                  details,
                  borrowerOrLastBorrower ? 'Borrower / last borrower: ' + borrowerOrLastBorrower : '',
                  afterState.borrowerName && afterState.borrowerName !== borrowerOrLastBorrower
                    ? 'Borrower: ' + afterState.borrowerName + (afterState.borrowerType || afterState.borrowerRole ? ' (' + (afterState.borrowerType || afterState.borrowerRole) + ')' : '')
                    : '',
                  afterState.takenOverFrom || afterState.transferredFrom
                    ? 'Take over from: ' + (afterState.takenOverFrom || afterState.transferredFrom) + (afterState.takenOverFromRole ? ' (' + afterState.takenOverFromRole + ')' : '')
                    : '',
                  afterState.purpose ? 'Reason sent with borrow request: ' + afterState.purpose : '',
                  transfer?.to?.name ? 'Accountability transferred from ' + (transferFrom || 'previous assignee') + ' to ' + transfer.to.name + '.' : '',
                  afterState.borrowRecordId ? 'Borrow record: ' + afterState.borrowRecordId : '',
                  afterState.releasedBy ? 'Released by: ' + afterState.releasedBy : ''
                ].filter(Boolean).join('\n')
              : reasonMatch ? reasonMatch[1].trim() : details;
            document.getElementById('equipmentTrailDetailsReason').textContent = borrowedDetails;
            trailDetailsModal.hidden = false;
            document.getElementById('closeEquipmentTrailDetails')?.focus();
          });
          document.getElementById('closeEquipmentTrailDetails')?.addEventListener('click', closeTrailDetails);
          trailDetailsModal?.addEventListener('click', (event) => {
            if (event.target === trailDetailsModal) closeTrailDetails();
          });
          document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape' && trailDetailsModal && !trailDetailsModal.hidden) closeTrailDetails();
          });
          trailSearch?.addEventListener('input', () => {
            equipmentTrailState.query = trailSearch.value.trim();
            equipmentTrailState.page = 1;
            if (equipmentTrailState.loaded) loadEquipmentAuditTrail();
          });
          trailAction?.addEventListener('change', () => {
            equipmentTrailState.actionType = trailAction.value;
            equipmentTrailState.page = 1;
            loadEquipmentAuditTrail();
          });
          const syncEquipmentTrailDateControls = () => {
            equipmentTrailState.dateRange = trailDateRange?.value || 'all';
            if (trailCustomDates) trailCustomDates.hidden = equipmentTrailState.dateRange !== 'custom';
            equipmentTrailState.dateFrom = trailDateFrom?.value || '';
            equipmentTrailState.dateTo = trailDateTo?.value || '';
            if (trailDateFrom) trailDateFrom.max = equipmentTrailState.dateTo;
            if (trailDateTo) trailDateTo.min = equipmentTrailState.dateFrom;
            equipmentTrailState.page = 1;
            if (equipmentTrailState.loaded) loadEquipmentAuditTrail();
          };
          trailDateRange?.addEventListener('change', syncEquipmentTrailDateControls);
          trailDateFrom?.addEventListener('change', syncEquipmentTrailDateControls);
          trailDateTo?.addEventListener('change', syncEquipmentTrailDateControls);
          document.getElementById('refreshEquipmentTrailBtn')?.addEventListener('click', () => loadEquipmentAuditTrail());
          document.getElementById('equipmentTrailPrevPage')?.addEventListener('click', () => {
            if (equipmentTrailState.page > 1) {
              equipmentTrailState.page -= 1;
              renderEquipmentAuditTrailPage();
            }
          });
          document.getElementById('equipmentTrailNextPage')?.addEventListener('click', () => {
            const totalPages = Math.max(1, Math.ceil(equipmentTrailState.entries.length / equipmentTrailState.pageSize));
            if (equipmentTrailState.page < totalPages) {
              equipmentTrailState.page += 1;
              renderEquipmentAuditTrailPage();
            }
          });
        };
        // refreshAuditLogs button removed from UI; keep function available
        // If you need a programmatic refresh, call loadAuditLogs()
        const buildAuditHtml = (exportRows = auditState.entries) => {
          const headers = ['Actor','Role','College','Action','Module','Description','Date / Time'];
          const escapeHtml = (value) => {
            const text = String(value || '');
            return text
              .replaceAll('<', '&lt;')
              .replaceAll('>', '&gt;')
              .replaceAll('\n', '<br>');
          };
          const rows = (Array.isArray(exportRows) ? exportRows : []).map(e => headers.map(h => {
            switch(h) {
              case 'Actor': return e.actorName || 'System';
              case 'Role': return e.actorRole || 'N/A';
              case 'College': return e.actorCollege || '';
              case 'Action': return e.action || '';
              case 'Module': return e.module || '';
              case 'Description': return e.description || '';
              case 'Date / Time': return formatDateTime(e.createdAt);
              default: return '';
            }
          }));
          const preparedBy = window.__CURRENT_USER_NAME__ || 'Administrator';
          const filters = [];
          if (auditState.userId) {
            const selectedUser = auditState.users.find((user) => String(user.id) === String(auditState.userId));
            filters.push('User: ' + (selectedUser ? (selectedUser.name || selectedUser.email || auditState.userId) : auditState.userId));
          }
          if (auditState.campus) filters.push('Campus: ' + auditState.campus);
          if (auditState.dateRange && auditState.dateRange !== 'all') filters.push('Date: ' + getAuditDateRangeLabel(auditState.dateRange));
          if (auditState.query) filters.push('Search: ' + auditState.query);
          const appliedFilters = filters.length ? filters.join(' • ') : 'All Time';
          const html = '<!doctype html><html><head><meta charset="utf-8"><title>Audit Logs</title><style>body{font-family:Inter,Arial,sans-serif;padding:24px;color:#0f172a;background:#f8fafc}h2{margin-bottom:8px;color:#0f381e}table{width:100%;border-collapse:collapse;margin-top:12px;font-size:11px}th,td{border:1px solid #cbd5e1;padding:8px;vertical-align:top;text-align:left}th{background:#0f381e;color:#fff;font-weight:700}tr:nth-child(even){background:#f8fafc}td:nth-child(5){min-width:260px;white-space:normal}@media print{body{padding:12px}}</style></head><body><h2>System Audit Logs Report</h2><div>Prepared By: ' + preparedBy + ' • Generated: ' + (auditState.generatedAt || new Date().toLocaleString()) + '</div><div>Filters: ' + appliedFilters + '</div><table><thead><tr>' + headers.map(h => '<th>' + h + '</th>').join('') + '</tr></thead><tbody>' + rows.map(r => '<tr>' + r.map(c => '<td>' + escapeHtml(c) + '</td>').join('') + '</tr>').join('') + '</tbody></table></body></html>';
          return html;
        };

        const loadScript = (url) => new Promise((resolve, reject) => {
          const s = document.createElement('script');
          s.src = url;
          s.onload = () => resolve();
          s.onerror = (e) => reject(e);
          document.head.appendChild(s);
        });

        const fetchAuditExportRows = async () => {
          const params = new URLSearchParams();
          const devBypass = new URLSearchParams(window.location.search).get('devBypass');
          params.set('scope', 'system');
          if (auditState.query) params.set('q', auditState.query);
          if (auditState.userId) params.set('userId', auditState.userId);
          if (auditState.campus) params.set('campus', auditState.campus);
          if (auditState.dateFrom) params.set('dateFrom', auditState.dateFrom);
          if (auditState.dateTo) params.set('dateTo', auditState.dateTo);
          if (devBypass === '1' || devBypass === 'true') params.set('devBypass', '1');
          params.set('page', '1');
          params.set('pageSize', '5000');
          params.set('exportAll', '1');

          const response = await fetch('/api/audit-logs?' + params.toString(), {
            cache: 'no-store',
            headers: { 'Accept': 'application/json' }
          });

          const contentType = response.headers.get('content-type') || '';
          const text = await response.text();
          let payload = null;

          if (text) {
            try {
              payload = contentType.includes('application/json') ? JSON.parse(text) : null;
            } catch {
              payload = null;
            }
          }

          if (!response.ok) {
            const message = payload && payload.error ? payload.error : 'Failed to fetch full audit export dataset';
            throw new Error(message);
          }

          const rows = Array.isArray(payload?.data) ? payload.data : [];
          return rows;
        };

        const exportAuditLogs = async (format) => {
          try {
            const exportRows = await fetchAuditExportRows();
            if (!exportRows || !exportRows.length) {
              alert('No audit entries to export.');
              return;
            }

            if (format === 'print') {
              const w = window.open('', '_blank');
              if (!w) {
                return alert('Unable to open print preview. Please allow popups for this site.');
              }
              w.document.write(buildAuditHtml(exportRows));
              w.document.close();
              w.focus();
              const tryPrint = () => {
                try {
                  w.print();
                } catch (err) {
                  console.warn('Print failed', err);
                }
              };
              if (w.document.readyState === 'complete') {
                tryPrint();
              } else {
                w.addEventListener('load', tryPrint);
              }
              return;
            }

            let pdfLib = window.jspdf && window.jspdf.jsPDF;
            if (!pdfLib) {
              try {
                await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js');
              } catch (err) {
                console.warn('Failed to dynamically load jsPDF', err);
              }
              pdfLib = window.jspdf && window.jspdf.jsPDF;
              if (!pdfLib) {
                return alert('Failed to load PDF library (jsPDF). Please allow external scripts and try again.');
              }
            }

            const headers = ['Actor','Role','Action','Module','Description','Date / Time'];
            const rows = exportRows.map(e => ({
              Actor: e.actorName || 'System',
              Role: e.actorRole || 'N/A',
              Action: e.action || '',
              Module: e.module || '',
              Description: e.description || '',
              'Date / Time': formatDateTime(e.createdAt)
            }));

            const { jsPDF } = window.jspdf;
            const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
            const pageWidth = doc.internal.pageSize.getWidth();
            const pageHeight = doc.internal.pageSize.getHeight();
            const margin = 36;
            const contentWidth = pageWidth - margin * 2;
            const headerHeight = 18;
            const lineHeight = 12;
            const bodyPadding = 8;
            const colPercents = [0.12, 0.10, 0.12, 0.10, 0.36, 0.20];
            const colWidths = colPercents.map(percent => Math.max(70, Math.floor(contentWidth * percent)));
            const colX = [];
            let cursorX = margin;
            colWidths.forEach((width) => {
              colX.push(cursorX);
              cursorX += width;
            });
            const drawHeader = (startY) => {
              doc.setFillColor(15, 56, 30);
              doc.setDrawColor(226, 232, 240);
              doc.setLineWidth(0.5);
              doc.rect(margin, startY, contentWidth, headerHeight, 'F');
              doc.setFont('helvetica', 'bold');
              doc.setFontSize(8.5);
              doc.setTextColor(255, 255, 255);
              headers.forEach((header, index) => {
                const text = String(header).toUpperCase();
                const textWidth = doc.getTextWidth(text);
                const x = colX[index] + 8;
                const y = startY + 12;
                doc.text(text, x, y, { maxWidth: colWidths[index] - 12 });
                if (textWidth > colWidths[index] - 12) {
                  doc.text(text.slice(0, 18), x, y);
                }
              });
              return startY + headerHeight;
            };

            const drawWrappedCell = (text, x, y, width, height, options = {}) => {
              const cleanText = String(text || '').replace(/\s+/g, ' ').trim();
              const wrapped = doc.splitTextToSize(cleanText, width - bodyPadding * 2);
              doc.setFont('helvetica', options.bold ? 'bold' : 'normal');
              doc.setFontSize(options.fontSize || 8.5);
              doc.setTextColor(options.textColor || 20);
              const textHeight = wrapped.length * lineHeight;
              const safeHeight = Math.max(height, textHeight + bodyPadding * 2);
              const lines = wrapped.slice(0, 16);
              lines.forEach((line, lineIndex) => {
                doc.text(line, x + bodyPadding, y + bodyPadding + (lineIndex * lineHeight));
              });
              return safeHeight;
            };

            const preparedBy = window.__CURRENT_USER_NAME__ || 'Administrator';
            const generated = auditState.generatedAt || new Date().toLocaleString();
            const totalRecords = auditState.total || auditState.entries.length || 0;
            const filters = [];
            if (auditState.userId) {
              const selectedUser = auditState.users.find((user) => String(user.id) === String(auditState.userId));
              filters.push('User: ' + (selectedUser ? (selectedUser.name || selectedUser.email || auditState.userId) : auditState.userId));
            }
            filters.push('Date: ' + getAuditDateRangeLabel(auditState.dateRange));
            const filtersText = filters.length ? filters.join(' • ') : 'All Time';

            let y = margin;
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(15);
            doc.setTextColor(6, 78, 59);
            doc.text('MINDORO STATE UNIVERSITY', pageWidth / 2, y, { align: 'center' });
            y += 16;
            doc.setFont('helvetica', 'normal');
            doc.setFontSize(10);
            doc.setTextColor(20, 20, 20);
            doc.text('College of Computer Studies', pageWidth / 2, y, { align: 'center' });
            y += 14;
            doc.text('Computer Laboratory Facilities Management System', pageWidth / 2, y, { align: 'center' });
            y += 20;
            doc.setDrawColor(16, 185, 129);
            doc.setLineWidth(1.2);
            doc.line(margin, y, pageWidth - margin, y);
            y += 12;

            doc.setFont('helvetica', 'bold');
            doc.setFontSize(12);
            doc.setTextColor(6, 78, 59);
            doc.text('SYSTEM AUDIT LOGS REPORT', pageWidth / 2, y, { align: 'center' });
            y += 18;

            doc.setFillColor(240, 253, 244);
            doc.setDrawColor(209, 250, 229);
            doc.setLineWidth(0.8);
            doc.rect(margin, y, contentWidth, 54, 'FD');
            doc.setFont('helvetica', 'normal');
            doc.setFontSize(9);
            doc.setTextColor(20, 20, 20);
            doc.text('Date Generated: ' + generated, margin + 10, y + 16);
            doc.text('Generated By: ' + preparedBy, margin + 10, y + 32);
            doc.text('Total Log Records: ' + String(totalRecords), margin + 10, y + 48);
            doc.text('Applied Filters: ' + filtersText, pageWidth / 2 + 10, y + 16, { maxWidth: contentWidth / 2 - 20 });
            y += 70;

            const startY = y;
            let currentY = drawHeader(startY);
            doc.setDrawColor(226, 232, 240);
            doc.setLineWidth(0.5);

            rows.forEach((row, rowIndex) => {
              const renderHeight = 22;
              const rowCells = headers.map((header) => {
                const value = row[header] || '';
                const text = String(value);
                return text;
              });

              const cellHeights = rowCells.map((value, index) => {
                const width = colWidths[index] - bodyPadding * 2;
                const wrapped = doc.splitTextToSize(String(value || ''), width);
                return Math.max(renderHeight, wrapped.length * lineHeight + bodyPadding * 2);
              });
              const currentRowHeight = Math.max(...cellHeights);

              if (currentY + currentRowHeight > pageHeight - 46) {
                doc.setFont('helvetica', 'normal');
                doc.setFontSize(9);
                doc.setTextColor(120, 120, 120);
                doc.text('Continued...', pageWidth - margin, pageHeight - 24, { align: 'right' });
                doc.addPage();
                currentY = margin + 20;
                currentY = drawHeader(currentY);
              }

              doc.setFillColor(rowIndex % 2 === 0 ? 248 : 255);
              doc.rect(margin, currentY, contentWidth, currentRowHeight, 'F');
              doc.setFont('helvetica', 'normal');
              doc.setFontSize(8.2);
              doc.setTextColor(20, 20, 20);
              rowCells.forEach((value, index) => {
                const width = colWidths[index] - bodyPadding * 2;
                const wrapped = doc.splitTextToSize(String(value || ''), width);
                const textY = currentY + bodyPadding + 2;
                const x = colX[index] + bodyPadding;
                if (headers[index] === 'Action' || headers[index] === 'Module') {
                  doc.setFillColor(220, 252, 231);
                  doc.setDrawColor(167, 243, 208);
                  doc.roundedRect(x - 2, textY - 4, Math.min(width + 4, doc.getTextWidth(String(value || '')) + 12), 14, 2, 2, 'FD');
                  doc.setFont('helvetica', 'bold');
                  doc.setFontSize(8);
                  doc.setTextColor(21, 128, 61);
                  doc.text(String(value || ''), x, textY + 1, { maxWidth: width });
                } else {
                  doc.text(wrapped, x, textY);
                }
              });
              currentY += currentRowHeight;
            });

            const pageCount = doc.internal.getNumberOfPages();
            for (let i = 1; i <= pageCount; i++) {
              doc.setPage(i);
              const footerY = pageHeight - 24;
              doc.setFont('helvetica', 'normal');
              doc.setFontSize(9);
              doc.setTextColor(120, 120, 120);
              doc.text('Generated by Computer Laboratory Facilities Management System', margin, footerY);
              doc.text('Page ' + i + ' of ' + pageCount, pageWidth - margin, footerY, { align: 'right' });
            }

            doc.save('system-audit-logs.pdf');
          } catch (error) {
            console.error('[Audit Logs] Export failed:', error);
            alert('Failed to export audit logs. Please try again.');
          }
        };

        const printBtn = document.getElementById('printAuditLogs');
        const exportBtn = document.getElementById('exportAuditLogsBtn');
        if (printBtn) printBtn.addEventListener('click', () => exportAuditLogs('print'));
        if (exportBtn) exportBtn.addEventListener('click', async () => { await exportAuditLogs('pdf'); });
        window.exportAuditLogs = exportAuditLogs;
        
        // Pagination listeners
        if (auditPrevPage) {
          auditPrevPage.addEventListener('click', () => {
            console.log('[Audit Logs] Previous page clicked, current page:', auditState.page);
            if (auditState.page > 1) {
              auditState.page -= 1;
              console.log('[Audit Logs] Moving to page:', auditState.page);
              loadAuditLogs();
            }
          });
        }
        
        if (auditNextPage) {
          auditNextPage.addEventListener('click', () => {
            console.log('[Audit Logs] Next page clicked, current page:', auditState.page, 'total pages:', auditState.totalPages);
            if (auditState.page < auditState.totalPages) {
              auditState.page += 1;
              console.log('[Audit Logs] Moving to page:', auditState.page);
              loadAuditLogs();
            }
          });
        }

        const initializeAuditPage = () => {
          console.log('[Audit Logs] Initializing audit page...');
          ensureAuditElements();
          
          hydrateAdminBadge();
          console.log('[Audit Logs] Admin badge hydrated');
          
          attachAuditEventListeners();
          console.log('[Audit Logs] Event listeners attached');
          
          loadAuditUsers();
          console.log('[Audit Logs] Loading audit users...');
          
          loadAuditLogs();
          console.log('[Audit Logs] Loading audit logs...');

          const initialView = new URLSearchParams(window.location.search).get('view');
          setAuditView(initialView === 'trail' ? 'trail' : initialView === 'login' ? 'login' : 'logs');
        };

        if (document.readyState === 'loading') {
          document.addEventListener('DOMContentLoaded', initializeAuditPage, { once: true });
        } else {
          initializeAuditPage();
        }
