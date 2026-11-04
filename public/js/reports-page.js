
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

        const reportState = {
          reportType: 'Equipment Inventory',
          filters: {
            campus: '',
            laboratory: '',
            status: '',
            reportPeriod: 'all',
            dateFrom: '',
            dateTo: '',
            search: '',
            technician: '',
            issueType: ''
          },
          campusFilterExplicitlySet: false,
          data: [],
          filteredData: [],
          isLoading: false,
          generatedAt: '',
          previewShown: false,
          page: 1,
          rowsPerPage: 10,
          errorMessage: ''
        };

        let reportLoadSequence = 0;
        let reportSearchTimer = null;

        const reportTypeOptions = [
          'Equipment Inventory',
          'Borrow Equipment',
          'Maintenance',
          'Attendance',
          'User Activity'
        ];

        let campusOptions = [];
        const laboratoryOptions = ['Laboratory 1', 'Laboratory 2'];

        const statusOptionsByReport = {
          'Equipment Inventory': ['All Statuses', 'Serviceable', 'Unserviceable', 'Lost'],
          'Borrow Equipment': ['All Statuses', 'Pending', 'Borrowed', 'Returned', 'Overdue'],
          'Maintenance': ['All Statuses', 'Pending', 'In Progress', 'Resolved', 'Rejected'],
          'Attendance': ['All Statuses', 'Present', 'Late', 'Absent'],
          'User Activity': ['All Activities', 'Account Created', 'Account Updated']
        };

        const reportFilterConfig = {
          'Equipment Inventory': { campus: true, laboratory: true, status: true, search: true },
          'Borrow Equipment': { campus: true, laboratory: true, status: true, search: true },
          'Maintenance': { campus: true, laboratory: true, status: true, search: true, technician: true, issueType: true },
          'Attendance': { campus: true, laboratory: true, status: true, search: true },
          'User Activity': { campus: true, status: true, search: true }
        };

        const reportDefinitions = {
          'Equipment Inventory': {
            endpoint: '/api/reports',
            title: 'Equipment Inventory Report',
            columns: ['Equipment ID', 'Equipment Name', 'Laboratory', 'Campus', 'Status']
          },
          'Borrow Equipment': {
            endpoint: '/api/reports',
            title: 'Borrow Equipment Report',
            columns: ['Borrower', 'Borrower Type', 'Equipment', 'Quantity', 'Borrow Date', 'Return Date', 'Status']
          },
          'Maintenance': {
            endpoint: '/api/reports',
            title: 'Maintenance Report',
            columns: ['Equipment', 'Damage Description', 'Priority', 'Technician', 'Date Reported', 'Status']
          },
          'Attendance': {
            endpoint: '/api/reports',
            title: 'Attendance Report',
            columns: ['Student', 'Laboratory', 'Date', 'Time In', 'Time Out', 'Status']
          },
          'User Activity': {
            endpoint: '/api/reports',
            title: 'User Activity Report',
            columns: ['User', 'Role', 'Activity', 'Date', 'Time']
          }
        };

        const getReportPeriodLabel = (value) => {
          const labels = {
            all: 'All Records',
            today: 'Today',
            week: 'This Week',
            month: 'This Month',
            semester: 'This Semester',
            'school-year': 'This School Year',
            custom: 'Custom Date Range'
          };
          return labels[value] || 'All Records';
        };

        const formatGeneratedTimestamp = (value) => {
          const date = value ? new Date(value) : new Date();
          if (Number.isNaN(date.getTime())) return String(value || '');
          const dateLabel = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
          const timeLabel = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
          return dateLabel + ' • ' + timeLabel;
        };

        const formatReportDateTime = (value) => {
          if (value === null || value === undefined || value === '' || value === '—') return '—';
          const raw = String(value).trim();
          const dateOnly = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
          const date = dateOnly
            ? new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]))
            : new Date(value);
          if (Number.isNaN(date.getTime())) return raw;
          const dateLabel = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
          if (dateOnly) return dateLabel;
          const timeLabel = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
          return dateLabel + ' • ' + timeLabel;
        };

        const getRecordEquipmentId = (record) => {
          const equipment = record && record.equipment;
          return String(record && (record.equipment_id || record.equipmentId) || equipment && (equipment.equipmentId || equipment.equipment_id) || '').trim();
        };

        const getEquipmentDisplayName = (record) => {
          const equipment = record && record.equipment;
          const name = String(record && (record.equipmentName || record.name) || equipment && equipment.name || '').trim();
          const equipmentId = getRecordEquipmentId(record);
          if (!name || name === '—') return equipmentId || '—';
          if (!equipmentId || name.toLowerCase().includes(equipmentId.toLowerCase())) return name;
          return name + ' (' + equipmentId + ')';
        };

        const getMaintenanceDamageDescription = (record) => {
          const equipmentId = getRecordEquipmentId(record);
          const candidates = [record && record.description, record && record.damageDescription, record && record.issueDescription, record && record.issueTitle];
          for (let index = 0; index < candidates.length; index += 1) {
            let text = String(candidates[index] || '').replace(/\s+/g, ' ').trim();
            if (!text) continue;
            if (equipmentId) {
              const escapedId = equipmentId.replace(/[|\\{}()[\]^$+*?.]/g, '\\$&');
              text = text.replace(new RegExp(escapedId, 'ig'), ' ');
            }
            text = text.replace(/\s+/g, ' ').replace(/^[\s:#–—-]+|[\s:#–—-]+$/g, '').trim();
            if (index === 3) {
              text = text.replace(/^(?:(?:equipment\s+)?(?:damage|issue|connectivity|missing|defective|broken))(?:\s*[:–—-]\s*|\s+)?/i, '').trim();
            } else {
              text = text.replace(/^(?:equipment\s+damage|damage\s+reported|reported\s+issue)\s*[:–—-]\s*/i, '').trim();
            }
            text = text.replace(/^[\s:#–—-]+|[\s:#–—-]+$/g, '').trim();
            if (text) return text;
          }
          return 'General damage reported';
        };

        const getCellValue = (record, key) => {
          switch (key) {
            case 'Equipment ID': return record.equipmentId || record.id || '—';
            case 'Equipment Name': return record.name || record.equipmentName || record.equipment && record.equipment.name || '—';
            case 'Laboratory': return record.laboratoryRoom || record.lab || record.laboratory_room || record.laboratory || '—';
            case 'Campus': return record.campus || '—';
            case 'Condition': return record.condition || record.status || '—';
            case 'Status': return record.status || record.role || '—';
            case 'Borrower': return record.borrowerName || record.name || record.fullName || '—';
            case 'Borrower Type': return record.borrowerType || '—';
            case 'Quantity': return record.quantity != null ? record.quantity : '—';
            case 'Borrow Date': return formatReportDateTime(record.borrowDate || '—');
            case 'Return Date': return formatReportDateTime(record.returnDate || record.expectedReturnDate || '—');
            case 'Equipment': return getEquipmentDisplayName(record);
            case 'Damage Description': return reportState.reportType === 'Maintenance' ? getMaintenanceDamageDescription(record) : record.damageDescription || record.description || record.issueTitle || '—';
            case 'Priority': return record.priority || 'Normal';
            case 'Technician': return record.technicianName || record.technician && record.technician.name || 'Unassigned';
            case 'Date Reported': return formatReportDateTime(record.dateReported || record.date || record.createdAt || '—');
            case 'Student': return record.fullName || record.borrowerName || record.name || '—';
            case 'Time In': return record.timeIn || record.time || '—';
            case 'Time Out': return record.timeOut || '—';
            case 'Activity': return record.activity || '—';
            case 'User': return record.user || record.name || '—';
            case 'Role': return record.role || '—';
            case 'Date': return formatReportDateTime(record.date || record.createdAt || '—');
            case 'Time': return record.time || record.timeIn || '—';
            default: return '—';
          }
        };

        const formatCell = (value) => {
          if (typeof value !== 'string') return value ?? '—';
          return value || '—';
        };

        const getReportSummary = (rows) => {
          if (!rows.length) return [];

          if (reportState.reportType === 'Equipment Inventory') {
            const serviceable = rows.filter((row) => String(row.status || row.condition || '').toLowerCase() === 'serviceable').length;
            const unserviceable = rows.filter((row) => String(row.status || row.condition || '').toLowerCase() === 'unserviceable').length;
            const lost = rows.filter((row) => String(row.status || '').toLowerCase() === 'lost').length;
            return [
              { label: 'Total Records', value: rows.length },
              { label: 'Serviceable', value: serviceable },
              { label: 'Unserviceable', value: unserviceable },
              { label: 'Lost', value: lost }
            ];
          }

          if (reportState.reportType === 'Borrow Equipment') {
            const borrowed = rows.filter((row) => String(row.status || '').toLowerCase().includes('borrowed')).length;
            const returned = rows.filter((row) => String(row.status || '').toLowerCase().includes('returned')).length;
            return [
              { label: 'Total Records', value: rows.length },
              { label: 'Borrowed', value: borrowed },
              { label: 'Returned', value: returned }
            ];
          }

          if (reportState.reportType === 'Maintenance') {
            const pending = rows.filter((row) => String(row.status || '').toLowerCase().includes('pending')).length;
            const inProgress = rows.filter((row) => String(row.status || '').toLowerCase().includes('progress')).length;
            const resolved = rows.filter((row) => String(row.status || '').toLowerCase().includes('resolved')).length;
            return [
              { label: 'Total Records', value: rows.length },
              { label: 'Pending', value: pending },
              { label: 'Resolved', value: resolved },
              { label: 'In Progress', value: inProgress }
            ];
          }

          if (reportState.reportType === 'Attendance') {
            const present = rows.filter((row) => String(row.status || '').toLowerCase().includes('present')).length;
            const absent = rows.filter((row) => String(row.status || '').toLowerCase().includes('absent')).length;
            const late = rows.filter((row) => String(row.status || '').toLowerCase().includes('late')).length;
            return [
              { label: 'Total Records', value: rows.length },
              { label: 'Present', value: present },
              { label: 'Absent', value: absent },
              { label: 'Late', value: late }
            ];
          }

          const created = rows.filter((row) => String(row.activity || '').toLowerCase().includes('created')).length;
          const updated = rows.filter((row) => String(row.activity || '').toLowerCase().includes('updated')).length;
          return [
            { label: 'Total Records', value: rows.length },
            { label: 'Created', value: created },
            { label: 'Updated', value: updated }
          ];
        };

        const getRecordLaboratory = (record) => String(record.laboratoryRoom || record.lab || record.laboratory_room || record.laboratory || '').trim();
        const getMaintenanceIssueType = (record) => {
          const title = String(record.issueTitle || record.damageDescription || record.description || '').trim();
          return title.replace(/\s*[:–—-]\s*[A-Z]{2,}-\d+\s*$/i, '').trim() || title || 'Other';
        };

        const populateReportSelect = (select, placeholder, values, selectedValue) => {
          if (!select) return;
          const uniqueValues = [...new Set((values || []).map((value) => String(value || '').trim()).filter(Boolean))]
            .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
          if (selectedValue && !uniqueValues.some((value) => value.toLowerCase() === String(selectedValue).toLowerCase())) {
            uniqueValues.push(String(selectedValue));
          }
          select.replaceChildren(new Option(placeholder, ''));
          uniqueValues.forEach((value) => select.add(new Option(value, value)));
          select.value = selectedValue || '';
        };

        const updateContextFilterOptions = (records = reportState.data) => {
          const rows = Array.isArray(records) ? records : [];
          populateReportSelect(
            document.getElementById('laboratoryFilter'),
            'All Laboratories',
            rows.map(getRecordLaboratory),
            reportState.filters.laboratory
          );
          populateReportSelect(
            document.getElementById('technicianFilter'),
            'All Technicians',
            rows.map((record) => record.technicianName || record.technician?.name),
            reportState.filters.technician
          );
          populateReportSelect(
            document.getElementById('issueTypeFilter'),
            'All Issue Types',
            rows.map(getMaintenanceIssueType),
            reportState.filters.issueType
          );
        };

        const updateReportFilterVisibility = () => {
          const config = reportFilterConfig[reportState.reportType] || {};
          [
            ['campusFilterField', 'campus'],
            ['laboratoryFilterField', 'laboratory'],
            ['statusFilterField', 'status'],
            ['technicianFilterField', 'technician'],
            ['issueTypeFilterField', 'issueType'],
            ['reportSearchField', 'search']
          ].forEach(([id, filter]) => {
            const field = document.getElementById(id);
            if (field) field.hidden = !config[filter];
          });
          const customDateFields = document.getElementById('customDateRangeFields');
          if (customDateFields) customDateFields.hidden = reportState.filters.reportPeriod !== 'custom';
          const searchLabel = document.getElementById('reportSearchLabel');
          const searchInput = document.getElementById('reportSearchInput');
          const searchLabels = {
            'Equipment Inventory': ['Search equipment', 'Search by equipment ID, name, or room'],
            'Borrow Equipment': ['Search borrow records', 'Search by borrower or equipment'],
            'Maintenance': ['Search maintenance', 'Search by issue, equipment, or technician'],
            'Attendance': ['Search attendance', 'Search by student, ID, or laboratory'],
            'User Activity': ['Search user activity', 'Search by user, role, or activity']
          };
          const [label, placeholder] = searchLabels[reportState.reportType] || ['Search', 'Search matching records'];
          if (searchLabel) searchLabel.textContent = label;
          if (searchInput) searchInput.placeholder = placeholder;
        };

        const applyReportClientFilters = (records) => {
          const search = String(reportState.filters.search || '').trim().toLowerCase();
          const laboratory = String(reportState.filters.laboratory || '').trim().toLowerCase();
          const technician = String(reportState.filters.technician || '').trim().toLowerCase();
          const issueType = String(reportState.filters.issueType || '').trim().toLowerCase();
          return (Array.isArray(records) ? records : []).filter((record) => {
            if (laboratory && getRecordLaboratory(record).toLowerCase() !== laboratory) return false;
            if (technician && String(record.technicianName || record.technician?.name || '').trim().toLowerCase() !== technician) return false;
            if (issueType && getMaintenanceIssueType(record).toLowerCase() !== issueType) return false;
            if (!search) return true;
            const searchable = [
              record.equipmentId, record.assetNumber, record.name, record.equipmentName, record.equipment?.name,
              getRecordLaboratory(record), record.campus, record.status, record.condition, record.borrowerName,
              record.borrowerType, record.fullName, record.studentId, record.instructor, record.issueTitle,
              record.damageDescription, record.description, record.priority, record.technicianName,
              record.technician?.name, record.user, record.role, record.activity, record.date, record.time
            ].map((value) => String(value || '')).join(' ').toLowerCase();
            return searchable.includes(search);
          });
        };

        const setReportEmptyState = (iconClass, title, message) => {
          const icon = document.getElementById('reportEmptyIcon');
          const titleEl = document.getElementById('reportEmptyTitle');
          const messageEl = document.getElementById('reportEmptyMessage');
          if (icon) icon.className = 'fas ' + iconClass;
          if (titleEl) titleEl.textContent = title;
          if (messageEl) messageEl.textContent = message;
        };

        const renderReportStatus = () => {
          const statusText = document.getElementById('reportCountText');
          const generatedMeta = document.getElementById('previewGeneratedAt');
          if (!statusText) return;

          if (reportState.isLoading) {
            statusText.textContent = 'Updating live preview…';
            if (generatedMeta) generatedMeta.textContent = 'Applying the selected filters';
            return;
          }

          if (!reportState.previewShown) {
            statusText.textContent = '';
            if (generatedMeta) generatedMeta.textContent = '';
            return;
          }

          if (reportState.campusRestricted) {
            statusText.textContent = 'Campus access restricted for ' + (reportState.restrictedCampus || 'this campus') + '. Viewing total count only.';
            if (generatedMeta) generatedMeta.textContent = reportState.generatedAt ? 'Generated: ' + formatGeneratedTimestamp(reportState.generatedAt) : '';
            return;
          }

          if (reportState.errorMessage) {
            statusText.textContent = reportState.errorMessage;
            if (generatedMeta) generatedMeta.textContent = '';
            return;
          }

          const count = reportState.filteredData.length;
          const start = count ? (reportState.page - 1) * reportState.rowsPerPage + 1 : 0;
          const end = count ? Math.min(reportState.page * reportState.rowsPerPage, count) : 0;
          const matchingCountText = 'Showing ' + start + '–' + end + ' of ' + count + ' matching record' + (count === 1 ? '' : 's');
          statusText.textContent = count
            ? matchingCountText + (reportState.data.length !== count ? ' (' + reportState.data.length + ' loaded)' : '')
            : reportState.data.length
              ? 'Showing 0 matching records (' + reportState.data.length + ' loaded)'
              : 'Showing 0 records';
          if (generatedMeta) generatedMeta.textContent = reportState.generatedAt ? 'Generated: ' + formatGeneratedTimestamp(reportState.generatedAt) : '';
        };

        const updateFilterOptions = () => {
          const reportTypeSelect = document.getElementById('reportTypeSelect');
          const campusSelect = document.getElementById('campusFilter');
          const statusSelect = document.getElementById('statusFilter');

          reportTypeSelect.innerHTML = reportTypeOptions.map(function(value) {
            return '<option value="' + value + '">' + value + '</option>';
          }).join('');
          reportTypeSelect.value = reportState.reportType;

          const currentUserCampus = getCurrentUserCampus();
          const currentUserRole = String(window.__CURRENT_USER__?.role || '').trim().toLowerCase().replace(/[_-]+/g, '');
          const canViewAllCampuses = ['superadmin', 'centraladmin', 'systemadmin'].includes(currentUserRole);
          const visibleCampuses = canViewAllCampuses
            ? campusOptions
            : campusOptions.filter((campus) => normalizeCampusKey(campus) === currentUserCampus);
          const availableCampuses = ['All Campuses'].concat(visibleCampuses);
          campusSelect.innerHTML = availableCampuses.map(function(value) {
            return '<option value="' + value + '">' + value + '</option>';
          }).join('');
          campusSelect.disabled = false;

          const statusOptions = statusOptionsByReport[reportState.reportType] || ['All Statuses'];
          statusSelect.innerHTML = statusOptions.map(function(value, index) {
            return '<option value="' + (index === 0 ? '' : value) + '">' + value + '</option>';
          }).join('');

          campusSelect.value = reportState.filters.campus || (currentUserCampus && !canViewAllCampuses && visibleCampuses.length ? visibleCampuses[0] : 'All Campuses');
          statusSelect.value = reportState.filters.status;
          reportTypeSelect.value = reportState.reportType;
          const searchInput = document.getElementById('reportSearchInput');
          const dateFromInput = document.getElementById('reportDateFromFilter');
          const dateToInput = document.getElementById('reportDateToFilter');
          if (searchInput) searchInput.value = reportState.filters.search || '';
          if (dateFromInput) dateFromInput.value = reportState.filters.dateFrom || '';
          if (dateToInput) dateToInput.value = reportState.filters.dateTo || '';
          updateContextFilterOptions(reportState.data);
          updateReportFilterVisibility();
        };

        const renderReportHeader = () => {
          const titleEl = document.getElementById('previewReportTitle');
          const definition = reportDefinitions[reportState.reportType];
          const campus = document.getElementById('campusFilter')?.value || '';
          const laboratory = document.getElementById('laboratoryFilter')?.value || '';
          const locationParts = [campus, laboratory].filter((value) => value && !/^all\s+(campuses|laboratories)$/i.test(value));
          if (titleEl) titleEl.textContent = definition.title + (locationParts.length ? ' — ' + locationParts.join(' · ') : '');
        };

        const setExportButtonsRestricted = () => {
          const disabled = Boolean(reportState.campusRestricted || reportState.isLoading || !reportState.previewShown || !reportState.filteredData.length);
          const exportButtons = Array.from(document.querySelectorAll('[data-report-export]'));
          exportButtons.forEach((button) => {
            button.disabled = disabled;
            button.setAttribute('aria-disabled', String(disabled));
            button.classList.toggle('opacity-50', disabled);
            button.classList.toggle('cursor-not-allowed', disabled);
          });
        };

        const renderSummaryCards = () => {
          const container = document.getElementById('summaryCards');
          if (!container) return;

          const summarySource = reportState.campusRestricted ? reportState.data : reportState.filteredData;
          const summary = reportState.campusRestricted
            ? [{ label: 'Total Records', value: Number(reportState.campusTotal || 0) }]
            : getReportSummary(summarySource || []);
          if (!summary.length) {
            container.innerHTML = '';
            return;
          }
          container.innerHTML = summary.map(function(item) {
            const needsAttention = String(item.label || '').toLowerCase() === 'unserviceable' && Number(item.value) > 0;
            return '<div class="rounded-3xl border border-emerald-800/60 bg-[#0b1a13]/90 p-3 shadow-[0_8px_18px_rgba(6,64,43,.14)]' + (needsAttention ? ' report-summary-warning' : '') + '"><p class="report-summary-label text-xs uppercase tracking-[0.3em] text-emerald-100/70">' + item.label + '</p><p class="report-summary-value mt-1.5 text-2xl font-semibold text-white">' + item.value + '</p></div>';
          }).join('');
        };

        const renderReportTable = () => {
          const definition = reportDefinitions[reportState.reportType];
          const headerRow = document.getElementById('reportTableHeader');
          const body = document.getElementById('reportTableBody');
          const emptyState = document.getElementById('reportEmptyState');
          if (!headerRow || !body || !emptyState) return;
          headerRow.innerHTML = '';
          body.innerHTML = '';

          definition.columns.forEach((column) => {
            const th = document.createElement('th');
            th.className = 'px-4 py-4 text-left text-sm font-semibold uppercase tracking-[0.18em] text-emerald-100/90';
            th.textContent = column;
            headerRow.appendChild(th);
          });

          if (!reportState.previewShown) {
            emptyState.style.display = 'block';
            setReportEmptyState('fa-spinner fa-spin', 'Updating preview', 'The matching records will appear here automatically.');
            return;
          }

          if (reportState.campusRestricted) {
            emptyState.style.display = 'none';
            const campusName = reportState.restrictedCampus || 'Selected Campus';
            const campusLabel = String(campusName).toUpperCase() + ' CAMPUS TOTAL';
            const totalRecords = Number(reportState.campusTotal || reportState.data.length || 0);
            const row = document.createElement('tr');
            const cell = document.createElement('td');
            const notice = document.createElement('div');
            const title = document.createElement('div');
            const total = document.createElement('div');
            const message = document.createElement('p');
            cell.colSpan = definition.columns.length;
            cell.className = 'px-5 py-6 text-center';
            notice.className = 'report-access-notice';
            title.className = 'report-access-notice-title';
            title.textContent = campusLabel;
            total.className = 'report-access-notice-total';
            total.textContent = 'Total Records: ' + totalRecords;
            message.textContent = 'Access Restricted: Detailed report records and individual item information are unavailable for ' + campusName + '.';
            notice.append(title, total, message);
            cell.appendChild(notice);
            row.appendChild(cell);
            body.replaceChildren(row);
            return;
          }

          if (!reportState.filteredData.length) {
            emptyState.style.display = 'block';
            setReportEmptyState(
              reportState.errorMessage ? 'fa-triangle-exclamation' : 'fa-folder-open',
              reportState.errorMessage ? 'Report preview unavailable' : 'No matching records',
              reportState.errorMessage || 'Try adjusting your filters or search criteria.'
            );
            return;
          }

          emptyState.style.display = 'none';
          const totalPages = Math.max(1, Math.ceil(reportState.filteredData.length / reportState.rowsPerPage));
          reportState.page = Math.min(Math.max(1, reportState.page || 1), totalPages);
          const startIndex = (reportState.page - 1) * reportState.rowsPerPage;
          const pageRows = reportState.filteredData.slice(startIndex, startIndex + reportState.rowsPerPage);

          pageRows.forEach((record) => {
            const row = document.createElement('tr');
            row.className = 'hover:bg-emerald-500/10';
            definition.columns.forEach((column) => {
              const td = document.createElement('td');
              td.className = 'px-4 py-4 align-top text-base text-emerald-50/90';
              td.textContent = formatCell(getCellValue(record, column));
              row.appendChild(td);
            });
            body.appendChild(row);
          });
        };

        const renderReportPagination = () => {
          const paginationContainer = document.getElementById('reportPagination');
          if (!paginationContainer) return;

          const totalPages = Math.max(1, Math.ceil((reportState.filteredData?.length || 0) / reportState.rowsPerPage));
          reportState.page = Math.min(Math.max(1, reportState.page || 1), totalPages);

          paginationContainer.innerHTML = '';
          if (!reportState.previewShown || !reportState.filteredData.length || totalPages <= 1) {
            return;
          }

          const createButton = (label, page, isActive, isDisabled) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.textContent = label;
            button.className = isActive
              ? 'flex h-8 w-8 items-center justify-center rounded-lg border border-emerald-500 bg-emerald-600 font-bold text-white shadow-sm transition'
              : 'rounded-lg border border-emerald-800/40 bg-emerald-950/40 px-3 py-1.5 text-sm text-emerald-300 transition hover:bg-emerald-900/60';
            if (isDisabled) {
              button.disabled = true;
              button.classList.add('cursor-not-allowed', 'opacity-40');
            } else {
              button.addEventListener('click', () => {
                reportState.page = page;
                renderReportPreview();
              });
            }
            return button;
          };

          paginationContainer.appendChild(createButton('Previous', reportState.page - 1, false, reportState.page <= 1));

          const maxVisiblePages = 3;
          const startPage = Math.max(1, Math.min(reportState.page - 1, totalPages - maxVisiblePages + 1));
          const endPage = Math.min(totalPages, startPage + maxVisiblePages - 1);

          for (let page = startPage; page <= endPage; page += 1) {
            paginationContainer.appendChild(createButton(String(page), page, page === reportState.page, false));
          }

          paginationContainer.appendChild(createButton('Next', reportState.page + 1, false, reportState.page >= totalPages));
        };

        const renderReportPreview = () => {
          renderReportHeader();
          renderSummaryCards();
          renderReportTable();
          renderReportPagination();
          renderReportStatus();
          setExportButtonsRestricted();
        };

        const normalizeCampusKey = (value) => {
          const trimmed = String(value || '').trim();
          if (!trimmed || /^all\s+campuses?$/i.test(trimmed)) {
            return '';
          }
          return trimmed.replace(/\s*campus\s*$/i, '').trim().toLowerCase();
        };

        const getCurrentUserCampus = () => normalizeCampusKey(window.__CURRENT_USER__?.campus || '');

        const loadExistingCampusOptions = async () => {
          try {
            const response = await fetch('/api/equipment/campus-totals');
            if (!response.ok) throw new Error('Unable to load existing campuses.');
            const payload = await response.json();
            const campusesByKey = new Map();
            Object.keys(payload?.campusCounts || {}).forEach((value) => {
              const campusName = String(value || '').trim().replace(/\s+/g, ' ').replace(/\s*campus\s*$/i, '').trim();
              if (!campusName) return;
              campusesByKey.set(campusName.toLowerCase(), campusName + ' Campus');
            });
            const signedInCampus = String(payload?.userCampus || '').trim().replace(/\s+/g, ' ');
            if (signedInCampus) {
              const campusName = signedInCampus.replace(/\s*campus\s*$/i, '').trim();
              if (campusName) campusesByKey.set(campusName.toLowerCase(), campusName + ' Campus');
            }
            campusOptions = [...campusesByKey.values()].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
          } catch (error) {
            console.warn('[Report] Existing campus options could not be loaded:', error.message);
            campusOptions = [];
          }
        };

        const getRecordCampusValue = (record) => {
          if (!record) return '';
          const candidates = [
            record.campus,
            record.equipment?.campus,
            record?.laboratoryCampus,
            record?.labCampus,
            record?.campusName,
            record?.schoolCampus,
            record?.campus_name,
            record?.laboratory_room
          ];

          for (const value of candidates) {
            if (value !== null && value !== undefined && String(value).trim()) {
              return String(value).trim();
            }
          }

          return '';
        };

        const applyCampusAccessRules = (records, meta = {}) => {
          const data = Array.isArray(records) ? records : [];
          const selectedCampus = reportState.filters.campus || 'All Campuses';
          const userCampus = getCurrentUserCampus();

          if (meta && meta.restricted) {
            return {
              visibleRows: [],
              campusTotal: Number(meta.campusTotal || 0),
              isRestricted: true,
              restrictedCampus: meta.restrictedCampus || selectedCampus
            };
          }

          const normalizedSelectedCampus = normalizeCampusKey(selectedCampus);
          const hasExplicitCampusSelection = Boolean(reportState.campusFilterExplicitlySet && normalizedSelectedCampus);

          if (!userCampus) {
            return { visibleRows: data, campusTotal: Number(meta.campusTotal || data.length || 0), isRestricted: false, restrictedCampus: '' };
          }

          if (!normalizedSelectedCampus) {
            return {
              visibleRows: data,
              campusTotal: Number(meta.campusTotal || data.length || 0),
              isRestricted: false,
              restrictedCampus: ''
            };
          }

          if (normalizedSelectedCampus !== userCampus) {
            return {
              visibleRows: [],
              campusTotal: Number(meta.campusTotal || data.length || 0),
              isRestricted: true,
              restrictedCampus: selectedCampus
            };
          }

          const visibleRows = data.filter((row) => {
            const recordCampus = normalizeCampusKey(getRecordCampusValue(row));
            return !recordCampus || recordCampus === userCampus;
          });

          return {
            visibleRows: hasExplicitCampusSelection ? visibleRows : visibleRows,
            campusTotal: Number(meta.campusTotal || data.length || 0),
            isRestricted: false,
            restrictedCampus: ''
          };
        };

        const renderFilterStatus = () => {
          const statusLabel = document.getElementById('statusFilterLabel');
          if (statusLabel && reportState.reportType === 'User Activity') {
            statusLabel.textContent = 'Activity';
          } else if (statusLabel) {
            statusLabel.textContent = 'Status';
          }
          updateReportFilterVisibility();
        };

        const loadReportData = async () => {
          const requestSequence = ++reportLoadSequence;
          const definition = reportDefinitions[reportState.reportType];
          const params = new URLSearchParams();
          params.set('reportType', reportState.reportType);
          params.set('campus', reportState.filters.campus || 'All Campuses');
          if (reportState.filters.status) params.set('status', reportState.filters.status);
          params.set('reportPeriod', reportState.filters.reportPeriod === 'custom' ? 'all' : (reportState.filters.reportPeriod || 'all'));
          if (reportState.filters.search) params.set('search', reportState.filters.search);
          if (reportState.filters.reportPeriod === 'custom') {
            if (reportState.filters.dateFrom) params.set('dateFrom', reportState.filters.dateFrom);
            if (reportState.filters.dateTo) params.set('dateTo', reportState.filters.dateTo);
          }

          if (reportState.filters.reportPeriod === 'custom' && reportState.filters.dateFrom && reportState.filters.dateTo && reportState.filters.dateFrom > reportState.filters.dateTo) {
            reportState.isLoading = false;
            reportState.data = [];
            reportState.filteredData = [];
            reportState.previewShown = true;
            reportState.generatedAt = '';
            reportState.errorMessage = 'The end date must be on or after the start date.';
            reportState.campusRestricted = false;
            reportState.page = 1;
            renderReportPreview();
            return;
          }

          reportState.isLoading = true;
          reportState.data = [];
          reportState.filteredData = [];
          reportState.previewShown = false;
          reportState.generatedAt = '';
          reportState.errorMessage = '';
          reportState.campusRestricted = false;
          reportState.campusTotal = 0;
          reportState.restrictedCampus = '';
          reportState.page = 1;
          renderReportPreview();

          try {
            const url = definition.endpoint + '?' + params.toString();
            const response = await fetch(url);
            if (requestSequence !== reportLoadSequence) return;
            if (!response.ok) throw new Error('Failed to load report data: ' + response.status);

            const payload = await response.json();
            if (requestSequence !== reportLoadSequence) return;
            const rawRecords = Array.isArray(payload)
              ? payload
              : Array.isArray(payload?.records)
                ? payload.records
                : [];
            const payloadMeta = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload.meta || {} : {};
            const accessState = applyCampusAccessRules(rawRecords, payloadMeta);

            reportState.data = accessState.visibleRows;
            reportState.campusRestricted = accessState.isRestricted || Boolean(payloadMeta.restricted);
            reportState.campusTotal = Number(accessState.campusTotal || payloadMeta.campusTotal || rawRecords.length || 0);
            reportState.restrictedCampus = accessState.restrictedCampus || payloadMeta.restrictedCampus || '';
            updateContextFilterOptions(reportState.data);
            reportState.filteredData = reportState.campusRestricted ? [] : applyReportClientFilters(reportState.data);
            reportState.generatedAt = new Date().toISOString();
            reportState.errorMessage = '';
            reportState.previewShown = true;
            reportState.isLoading = false;
            renderReportPreview();
            renderFilterStatus();
          } catch (error) {
            if (requestSequence !== reportLoadSequence) return;
            console.error('[Report] Error loading report:', error);
            reportState.isLoading = false;
            reportState.data = [];
            reportState.filteredData = [];
            reportState.campusRestricted = false;
            reportState.campusTotal = 0;
            reportState.restrictedCampus = '';
            reportState.previewShown = true;
            reportState.generatedAt = '';
            reportState.errorMessage = 'Unable to load report data. Please try again.';
            renderReportPreview();
          } finally {
            if (requestSequence === reportLoadSequence && reportState.isLoading) {
              reportState.isLoading = false;
              renderReportPreview();
            }
          }
        };

        const handleReportTypeChange = () => {
          reportState.reportType = document.getElementById('reportTypeSelect').value;
          reportState.rowsPerPage = 10;
          reportState.filters.status = '';
          reportState.filters.campus = '';
          reportState.filters.laboratory = '';
          reportState.filters.reportPeriod = 'all';
          reportState.filters.dateFrom = '';
          reportState.filters.dateTo = '';
          reportState.filters.search = '';
          reportState.filters.technician = '';
          reportState.filters.issueType = '';
          reportState.data = [];
          reportState.filteredData = [];
          reportState.campusFilterExplicitlySet = false;
          reportState.page = 1;
          updateFilterOptions();
          renderFilterStatus();
          handleFilterChange('type');
        };

        const handleFilterChange = (changedFilter) => {
          const selectedCampus = document.getElementById('campusFilter').value;
          reportState.filters.campus = /^all\s+campuses$/i.test(selectedCampus) ? '' : selectedCampus;
          reportState.filters.laboratory = document.getElementById('laboratoryFilter').value;
          reportState.filters.status = document.getElementById('statusFilter').value;
          reportState.filters.reportPeriod = document.getElementById('reportPeriodFilter').value || 'all';
          reportState.filters.dateFrom = document.getElementById('reportDateFromFilter').value;
          reportState.filters.dateTo = document.getElementById('reportDateToFilter').value;
          reportState.filters.search = document.getElementById('reportSearchInput').value.trim();
          reportState.filters.technician = document.getElementById('technicianFilter').value;
          reportState.filters.issueType = document.getElementById('issueTypeFilter').value;
          reportState.page = 1;
          const searchClear = document.getElementById('reportSearchClear');
          if (searchClear) searchClear.hidden = !reportState.filters.search;
          if (changedFilter === 'campus') {
            reportState.campusFilterExplicitlySet = true;
          }
          updateReportFilterVisibility();
          loadReportData();
        };

        const resetReportFilters = () => {
          clearTimeout(reportSearchTimer);
          reportState.filters.campus = '';
          reportState.filters.laboratory = '';
          reportState.filters.status = '';
          reportState.filters.reportPeriod = 'all';
          reportState.filters.dateFrom = '';
          reportState.filters.dateTo = '';
          reportState.filters.search = '';
          reportState.filters.technician = '';
          reportState.filters.issueType = '';
          reportState.campusFilterExplicitlySet = false;
          reportState.page = 1;
          updateFilterOptions();
          handleFilterChange('reset');
        };

        const normalizePdfValue = (value, column) => {
          let text = value === null || value === undefined ? '' : String(value).replace(/\s+/g, ' ').trim();
          if ((column === 'Status' || column === 'Condition') && /un\s*serviceable/i.test(text)) {
            text = 'Unserviceable';
          }
          return text;
        };

        const escapeReportHtml = (value) => String(value === null || value === undefined ? '' : value)
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&#39;');

        const getSelectedReportFilters = () => {
          const filters = [];
          if (reportState.filters.campus) filters.push('Campus: ' + reportState.filters.campus);
          if (reportState.filters.laboratory) filters.push('Laboratory: ' + reportState.filters.laboratory);
          if (reportState.filters.status) filters.push((reportState.reportType === 'User Activity' ? 'Activity: ' : 'Status: ') + reportState.filters.status);
          if (reportState.filters.reportPeriod === 'custom') {
            const dateRange = [reportState.filters.dateFrom, reportState.filters.dateTo].filter(Boolean).join(' to ');
            filters.push('Report Period: Custom Date Range' + (dateRange ? ' (' + dateRange + ')' : ''));
          } else if (reportState.filters.reportPeriod && reportState.filters.reportPeriod !== 'all') {
            filters.push('Report Period: ' + getReportPeriodLabel(reportState.filters.reportPeriod));
          }
          if (reportState.filters.search) filters.push('Search: ' + reportState.filters.search);
          if (reportState.filters.technician) filters.push('Technician: ' + reportState.filters.technician);
          if (reportState.filters.issueType) filters.push('Issue Type: ' + reportState.filters.issueType);
          return filters;
        };

        hydrateAdminBadge();

        const buildPdfHtml = () => {
          const definition = reportDefinitions[reportState.reportType];
          const headers = definition.columns;
          const rows = reportState.filteredData.map((record) => headers.map((column) => normalizePdfValue(getCellValue(record, column), column)));
          const selectedFilters = getSelectedReportFilters();
          const headerCells = headers.map(function(col) { return '<th>' + escapeReportHtml(col) + '</th>'; }).join('');
          const rowCells = rows.map(function(row) {
            return '<tr>' + row.map(function(cell) {
              const statusClass = /^(pending|in progress)$/i.test(String(cell)) ? ' status-pending' : '';
              return '<td' + statusClass + '>' + escapeReportHtml(cell) + '</td>';
            }).join('') + '</tr>';
          }).join('');
          const preparedBy = window.__CURRENT_USER_NAME__ || 'Administrator';
          const technician = reportState.filteredData.map((record) => record.technicianName || record.technician && record.technician.name).find((name) => name && !/^unassigned$/i.test(String(name))) || 'Technician';
          const filterPills = selectedFilters.length
            ? selectedFilters.map(function(filter) { return '<span class="pill">' + escapeReportHtml(filter) + '</span>'; }).join('')
            : '<span class="pill">None</span>';
          return '<!DOCTYPE html><html><head><meta charset="utf-8" /><title>' + escapeReportHtml(definition.title) + '</title><style>@page{size:A4 landscape;margin:14mm 12mm 18mm;}body{font-family:Inter,Arial,sans-serif;color:#0f172a;margin:0;padding:0 0 28px}.header{position:relative;text-align:center;border-bottom:2px solid #16a34a;padding:4px 140px 12px;margin-bottom:16px;min-height:66px}.header img.university-logo{position:absolute;left:0;top:0;width:58px;height:58px;object-fit:contain}.header img.college-logo{position:absolute;right:0;top:0;width:58px;height:58px;object-fit:contain}.header h1{margin:0 0 6px;color:#064e3b;font-size:20px}.muted{color:#475569}.section{margin-bottom:12px}table{width:100%;border-collapse:collapse;margin-top:16px}th,td{border:1px solid #cbd5e1;padding:9px;text-align:left;font-size:11px;vertical-align:top}th{background:#0f381e;color:#fff;border-color:#496b55}tbody tr:nth-child(even){background:#f1f5f9}.status-pending{color:#713f12;font-weight:700;background:#fef3c7}.pill{display:inline-block;border:1px solid #bbf7d0;border-radius:999px;background:#f0fdf4;color:#166534;padding:4px 10px;font-size:11px;margin-right:8px;margin-top:8px}.signatures{display:flex;gap:48px;margin:48px 8px 20px;break-inside:avoid}.signature{flex:1;text-align:center;padding:0 18px}.signature .line{border-top:1px solid #334155;margin-bottom:7px}.signature strong{font-size:11px}.signature span{display:block;font-size:10px;color:#475569;margin-top:3px}.page-footer{position:fixed;bottom:-10mm;left:0;right:0;display:flex;justify-content:space-between;color:#64748b;font-size:9px}.page-count:after{content:counter(page) " of " counter(pages)}thead{display:table-header-group}tr{break-inside:avoid}</style></head><body><div class="header"><img class="university-logo" src="/images/minsu-logo.png.jpg" alt="MinSU seal"><img class="college-logo" src="/images/ccs-logo.png" alt="College of Computer Studies logo"><h1>MINDORO STATE UNIVERSITY</h1><div class="muted">College of Computer Studies</div><div class="muted">Computer Laboratory Facilities Management System</div></div><div class="section"><h2 style="margin:0 0 6px">' + escapeReportHtml(definition.title) + '</h2><div class="muted">Date Generated: ' + escapeReportHtml(formatGeneratedTimestamp(reportState.generatedAt)) + '</div></div><div class="section"><strong>Applied Filters</strong><div>' + filterPills + '</div></div><div class="section"><strong>Total Records:</strong> ' + rows.length + ' &nbsp; <strong>Prepared By:</strong> ' + escapeReportHtml(preparedBy) + '</div><table><thead><tr>' + headerCells + '</tr></thead><tbody>' + rowCells + '</tbody></table><div class="signatures"><div class="signature"><div class="line"></div><strong>Prepared By</strong><span>' + escapeReportHtml(preparedBy) + ' · Administrator</span></div><div class="signature"><div class="line"></div><strong>Verified By</strong><span>' + escapeReportHtml(technician) + ' · Technician</span></div></div><div class="page-footer"><span>Computer Laboratory Facilities Management System</span><span>Page <span class="page-count"></span></span></div></body></html>';
        };

        const buildPdfData = () => {
          const definition = reportDefinitions[reportState.reportType];
          const headers = definition.columns;
          const rows = reportState.filteredData.map((record) => headers.map((column) => normalizePdfValue(getCellValue(record, column), column)));
          const selectedFilters = getSelectedReportFilters();

          return { definition, headers, rows, selectedFilters };
        };

        const reportLogoDataUrlCache = new Map();
        const loadReportLogoDataUrl = async (logoPath) => {
          if (reportLogoDataUrlCache.has(logoPath)) return reportLogoDataUrlCache.get(logoPath);
          try {
            const response = await fetch(logoPath, { credentials: 'same-origin' });
            if (!response.ok) throw new Error('Logo asset unavailable');
            const logoBlob = await response.blob();
            const dataUrl = await new Promise((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => resolve(String(reader.result || ''));
              reader.onerror = reject;
              reader.readAsDataURL(logoBlob);
            });
            reportLogoDataUrlCache.set(logoPath, dataUrl);
          } catch (error) {
            reportLogoDataUrlCache.set(logoPath, '');
          }
          return reportLogoDataUrlCache.get(logoPath);
        };

        let reportPdfPreviewObjectUrl = '';
        let reportPdfPreviewFilename = '';

        const closeReportPdfPreview = () => {
          const modal = document.getElementById('reportPdfPreviewModal');
          const frame = document.getElementById('reportPdfPreviewFrame');
          if (frame) frame.removeAttribute('src');
          if (modal) {
            modal.classList.add('hidden');
            modal.classList.remove('flex');
          }
          document.body.classList.remove('overflow-hidden');
          if (reportPdfPreviewObjectUrl) URL.revokeObjectURL(reportPdfPreviewObjectUrl);
          reportPdfPreviewObjectUrl = '';
          reportPdfPreviewFilename = '';
        };

        const openReportPdfPreview = (pdfBlob, fileName) => {
          closeReportPdfPreview();
          reportPdfPreviewObjectUrl = URL.createObjectURL(pdfBlob);
          reportPdfPreviewFilename = fileName;
          const modal = document.getElementById('reportPdfPreviewModal');
          const frame = document.getElementById('reportPdfPreviewFrame');
          const filename = document.getElementById('reportPdfPreviewFilename');
          if (!modal || !frame) return;
          frame.src = reportPdfPreviewObjectUrl;
          if (filename) filename.textContent = fileName;
          modal.classList.remove('hidden');
          modal.classList.add('flex');
          document.body.classList.add('overflow-hidden');
        };

        const downloadReportPdfPreview = () => {
          if (!reportPdfPreviewObjectUrl || !reportPdfPreviewFilename) return;
          const anchor = document.createElement('a');
          anchor.href = reportPdfPreviewObjectUrl;
          anchor.download = reportPdfPreviewFilename;
          document.body.appendChild(anchor);
          anchor.click();
          anchor.remove();
        };

        window.closeReportPdfPreview = closeReportPdfPreview;
        window.downloadReportPdfPreview = downloadReportPdfPreview;
        document.addEventListener('keydown', (event) => {
          if (event.key === 'Escape' && reportPdfPreviewObjectUrl) closeReportPdfPreview();
        });

        const printReportWindowWhenReady = (printWindow) => {
          const logos = Array.from(printWindow.document.querySelectorAll('.header img'));
          Promise.all(logos.map((logo) => logo.complete
            ? Promise.resolve()
            : new Promise((resolve) => {
              logo.addEventListener('load', resolve, { once: true });
              logo.addEventListener('error', resolve, { once: true });
            })))
            .then(() => {
              printWindow.focus();
              printWindow.print();
            });
        };

        async function exportReport(format) {
          if (reportState.campusRestricted) {
            alert('You can view the total record count for this campus, but you are not allowed to view the detailed records.');
            return;
          }

          if (!reportState.previewShown || !reportState.filteredData.length) {
            alert('No records found for the selected filters.');
            return;
          }

          if (format === 'print') {
            const printWindow = window.open('', '_blank', 'width=900,height=700');
            if (!printWindow) {
              alert('Please allow popups to print the report.');
              return;
            }

            printWindow.document.write(buildPdfHtml());
            printWindow.document.close();
            printReportWindowWhenReady(printWindow);
            return;
          }

          if (format === 'csv') {
            const { definition, headers, rows } = buildPdfData();
            const escapeCsvCell = (value) => {
              const text = value === null || value === undefined ? '' : String(value);
              return '"' + text.replace(/"/g, '""') + '"';
            };
            const csvContent = '\uFEFF' + [headers, ...rows]
              .map((row) => row.map(escapeCsvCell).join(','))
              .join('\r\n');
            const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
            const downloadUrl = URL.createObjectURL(blob);
            const anchor = document.createElement('a');
            const safeTitle = String(definition.title || 'report').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase();
            anchor.href = downloadUrl;
            anchor.download = (safeTitle || 'report') + '.csv';
            document.body.appendChild(anchor);
            anchor.click();
            anchor.remove();
            URL.revokeObjectURL(downloadUrl);
            return;
          }

          if (format === 'pdf' || format === 'pdf-preview') {
            const pdfLib = window.jspdf && window.jspdf.jsPDF;
            if (!pdfLib) {
              if (format === 'pdf-preview') {
                alert('PDF preview is unavailable right now. Please try again once the PDF tools finish loading.');
                return;
              }
              const printWindow = window.open('', '_blank', 'width=900,height=700');
              if (!printWindow) {
                alert('Please allow popups so the report can be printed as PDF.');
                return;
              }

              printWindow.document.write(buildPdfHtml());
              printWindow.document.close();
              printReportWindowWhenReady(printWindow);
              return;
            }

            const { definition, headers, rows, selectedFilters } = buildPdfData();
            const preparedBy = window.__CURRENT_USER_NAME__ || 'Administrator';
            const normalizePdfValue = (value, column) => {
              let text = value === null || value === undefined ? '' : String(value).replace(/\s+/g, ' ').trim();
              if ((column === 'Status' || column === 'Condition') && /un\s*serviceable/i.test(text)) {
                text = 'Unserviceable';
              }
              return text;
            };
            const safeText = (value) => {
              if (value === null || value === undefined) return '';
              return String(value).replace(/\s+/g, ' ').trim();
            };

            const doc = new pdfLib({ orientation: 'landscape', unit: 'pt', format: 'a4' });
            const pageWidth = doc.internal.pageSize.getWidth();
            const pageHeight = doc.internal.pageSize.getHeight();
            const margin = 40;
            const cellPadding = 4;
            const footerHeight = 28;
            const tableFontSize = 8.7;

            const preparedByText = preparedBy;

            const safeTextMeasure = (v) => {
              if (v === null || v === undefined) return '';
              return String(v).replace(/\s+/g, ' ').trim();
            };

            // Colors (emerald accents)
            const emeraldDeep = [15,56,30]; // #0f381e
            const emeraldText = [6,78,59]; // #064e3b
            const emeraldDivider = [16,185,129]; // #10b981

            const [minsuLogoDataUrl, ccsLogoDataUrl] = await Promise.all([
              loadReportLogoDataUrl('/images/minsu-logo.png.jpg'),
              loadReportLogoDataUrl('/images/ccs-logo.png')
            ]);
            const logoSize = 56;
            const logosRight = pageWidth - margin;
            if (minsuLogoDataUrl) {
              try {
                doc.addImage(minsuLogoDataUrl, 'JPEG', margin, 34, logoSize, logoSize);
              } catch (error) {
                console.warn('[Reports] Could not add the MinSU logo to the PDF.', error);
              }
            }
            if (ccsLogoDataUrl) {
              try {
                doc.addImage(ccsLogoDataUrl, 'PNG', logosRight - logoSize, 34, logoSize, logoSize);
              } catch (error) {
                console.warn('[Reports] Could not add the CCS logo to the PDF.', error);
              }
            }

            // Institutional header (centered)
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(18);
            doc.setTextColor(...emeraldText);
            doc.text('MINDORO STATE UNIVERSITY', pageWidth / 2, 56, { align: 'center' });

            doc.setFont('helvetica', 'normal');
            doc.setFontSize(11);
            doc.setTextColor(100);
            doc.text('College of Computer Studies', pageWidth / 2, 76, { align: 'center' });
            doc.text('Computer Laboratory Facilities Management System', pageWidth / 2, 92, { align: 'center' });

            // divider (emerald)
            const dividerY = 106; // header -> divider spacing
            doc.setDrawColor(...emeraldDivider);
            doc.setLineWidth(2);
            doc.line(margin, dividerY, pageWidth - margin, dividerY);

            // Report title (positioned with spacing)
            const titleY = dividerY + 16; // margin-top:16
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(14);
            doc.setTextColor(...emeraldText);
            doc.text((definition.title || '').toUpperCase(), pageWidth / 2, titleY, { align: 'center' });

            // Metadata box (two-column) with light emerald tint
            const metaTop = titleY + 12; // title margin-bottom:12
            const metaBoxHeight = 66;
            doc.setFillColor(240,253,244); // #f0fdf4
            doc.setDrawColor(209,250,229); // #d1fae5
            doc.setLineWidth(1);
            doc.rect(margin, metaTop, pageWidth - margin * 2, metaBoxHeight, 'FD');
            doc.setFont('helvetica', 'normal');
            doc.setFontSize(9);
            doc.setTextColor(60);
            const midX = margin + (pageWidth - margin * 2) / 2;

            const isAttendance = ((reportState.reportType || '').toLowerCase().includes('attendance')) || ((definition.title || '').toLowerCase().includes('attendance'));
            if (isAttendance) {
              // Attempt to extract class/session info from data
              const sample = (reportState.filteredData && reportState.filteredData.length) ? reportState.filteredData[0] : {};
              const subject = sample.subject || sample.course || sample.title || sample.equipmentName || '';
              const instructor = sample.instructor || sample.instructorName || sample.teacher || sample.preparedBy || '';
              const dateLabel = sample.date || sample.sessionDate || formatGeneratedTimestamp(reportState.generatedAt);
              const timeLabel = (sample.time || (sample.startTime && sample.endTime ? (sample.startTime + ' - ' + sample.endTime) : '')) || '';

              // Left column: Subject / Instructor / Date & Time
              doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(...emeraldDeep);
              doc.text('Subject:', margin + 8, metaTop + 16);
              doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(40);
              doc.text(String(subject || '—'), margin + 70, metaTop + 16, { maxWidth: (pageWidth - margin * 2) / 2 - 90 });

              doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(...emeraldDeep);
              doc.text('Instructor:', margin + 8, metaTop + 34);
              doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(40);
              doc.text(String(instructor || '—'), margin + 70, metaTop + 34, { maxWidth: (pageWidth - margin * 2) / 2 - 90 });

              doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(...emeraldDeep);
              doc.text('Date & Time:', margin + 8, metaTop + 52);
              doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(40);
              doc.text(String((dateLabel || '') + (timeLabel ? ' • ' + timeLabel : '')), margin + 110, metaTop + 52, { maxWidth: (pageWidth - margin * 2) / 2 - 120 });

              // Right column: Present / Absent / Late counts
              const summary = getReportSummary(reportState.filteredData || []);
              const presentItem = summary.find(s=>/present/i.test(s.label));
              const absentItem = summary.find(s=>/absent/i.test(s.label));
              const lateItem = summary.find(s=>/late/i.test(s.label));
              const presentCount = presentItem ? presentItem.value : 0;
              const absentCount = absentItem ? absentItem.value : 0;
              const lateCount = lateItem ? lateItem.value : 0;

              const badgeX = midX + 12;
              const badgeY = metaTop + 18;
              const badgeW = 120;
              const badgeH = 18;

              // Present badge
              doc.setFillColor(220,252,231); // #dcfce7
              doc.setDrawColor(220,252,231);
              doc.rect(badgeX, badgeY - 12, badgeW, badgeH, 'F');
              doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(21,128,61); // #15803d
              doc.text('Present: ' + presentCount, badgeX + 8, badgeY + 2);

              // Absent badge
              doc.setFillColor(255,228,230); // #ffe4e6
              doc.setDrawColor(255,228,230);
              doc.rect(badgeX, badgeY + 8, badgeW, badgeH, 'F');
              doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(185,28,28); // #b91c1c
              doc.text('Absent: ' + absentCount, badgeX + 8, badgeY + 22);

              // Late badge
              doc.setFillColor(254,243,199); // #fef3c7
              doc.setDrawColor(254,243,199);
              doc.rect(badgeX + badgeW + 8, badgeY - 12, badgeW, badgeH, 'F');
              doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(180,83,9); // #b45309
              doc.text('Late: ' + lateCount, badgeX + badgeW + 8 + 8, badgeY + 2);

            } else {
              doc.text('Date Generated:', margin + 8, metaTop + 14);
              doc.text(formatGeneratedTimestamp(reportState.generatedAt), margin + 110, metaTop + 14);
              doc.text('Prepared By:', midX + 8, metaTop + 14);
              doc.text(preparedByText, midX + 110, metaTop + 14);
              const filtersText = (selectedFilters && selectedFilters.length) ? selectedFilters.join(' • ') : 'None';
              doc.text('Applied Filters:', margin + 8, metaTop + 34);
              doc.text(filtersText, margin + 110, metaTop + 34, { maxWidth: (pageWidth - margin * 2) / 2 - 120 });
              doc.text('Total Records:', midX + 8, metaTop + 34);
              doc.text(String(rows.length), midX + 110, metaTop + 34);
            }

            // Prepare table metrics
            const startYBase = metaTop + metaBoxHeight + 20; // metadata margin-bottom:20

            const availWidth = pageWidth - margin * 2;

            // Keep every report's columns inside the printable page width.
            const widthRatiosByReport = {
              'Equipment Inventory': [0.14, 0.22, 0.23, 0.25, 0.16],
              'Borrow Equipment': [0.18, 0.11, 0.20, 0.08, 0.15, 0.15, 0.13],
              'Maintenance': [0.18, 0.25, 0.13, 0.17, 0.16, 0.11],
              'Attendance': [0.28, 0.20, 0.16, 0.12, 0.12, 0.12],
              'User Activity': [0.20, 0.16, 0.25, 0.21, 0.20]
            };
            const reportRatios = widthRatiosByReport[reportState.reportType];
            let columnWidths;
            if (reportRatios && reportRatios.length === headers.length) {
              columnWidths = reportRatios.map((ratio) => Math.floor(availWidth * ratio));
              columnWidths[columnWidths.length - 1] += availWidth - columnWidths.reduce((sum, width) => sum + width, 0);
            } else {
              const colWeights = headers.map((header, index) => {
                const headerLength = String(header || '').length;
                const maxCellLength = rows.reduce((max, row) => Math.max(max, String(row[index] || '').length), 0);
                return Math.max(6, Math.min(32, Math.max(headerLength, maxCellLength)));
              });
              const totalWeight = colWeights.reduce((sum, weight) => sum + weight, 0) || 1;
              const minimumWidth = Math.min(44, availWidth / headers.length);
              const flexibleWidth = Math.max(0, availWidth - minimumWidth * headers.length);
              columnWidths = colWeights.map((weight) => Math.floor(minimumWidth + flexibleWidth * (weight / totalWeight)));
              columnWidths[columnWidths.length - 1] += availWidth - columnWidths.reduce((sum, width) => sum + width, 0);
            }

            const rowHeight = 24;
            let currentY = startYBase;

            const statusColIndex = headers.findIndex(h => /status/i.test(String(h || '')));

            const wrapCellText = (text, maxWidth) => {
              if (text === null || text === undefined || text === '') return [''];
              const normalized = String(text).replace(/\s+/g, ' ').trim();
              if (!normalized) return [''];
              return doc.splitTextToSize(normalized, Math.max(18, maxWidth));
            };

            const drawHeaderRow = () => {
              const headerY = currentY;
              doc.setFillColor(...emeraldDeep);
              doc.rect(margin, headerY - 8, availWidth, rowHeight + 6, 'F');
              doc.setFont('helvetica', 'bold');
              doc.setFontSize(10);
              doc.setTextColor(255);
              let x = margin + cellPadding;
              headers.forEach((h, i) => {
                const w = columnWidths[i] || Math.floor(availWidth / headers.length);
                doc.text(String(h || '').toUpperCase(), x, headerY + 8, { maxWidth: w - cellPadding * 2 });
                doc.setDrawColor(73, 107, 85);
                doc.setLineWidth(0.45);
                doc.rect(x - cellPadding, headerY - 8, w, rowHeight + 6, 'S');
                x += w;
              });
              doc.setTextColor(0);
              currentY += rowHeight + 8;
            };

            const drawRow = (cells, rowIndex) => {
              doc.setFont('helvetica', 'normal');
              doc.setFontSize(tableFontSize);
              const wrappedCells = cells.map((c, i) => {
                const w = columnWidths[i] || Math.floor(availWidth / headers.length);
                const text = safeTextMeasure(c);
                const maxWidth = Math.max(18, w - cellPadding * 2);
                const lines = wrapCellText(text, maxWidth);
                return { lines, width: w, textHeight: Math.max(14, lines.length * 8) };
              });
              const rowBlockHeight = Math.max(rowHeight, ...wrappedCells.map(item => item.textHeight)) + 6;

              if (currentY + rowBlockHeight > pageHeight - margin - footerHeight) {
                doc.addPage();
                currentY = margin;
                drawHeaderRow();
              }

              const y = currentY;
              if (rowIndex % 2 === 0) {
                doc.setFillColor(248, 250, 252);
                doc.rect(margin, y - 2, availWidth, rowBlockHeight, 'F');
              }
              doc.setDrawColor(203, 213, 225);
              doc.setLineWidth(0.55);
              let x = margin;
              wrappedCells.forEach((cell, i) => {
                const w = cell.width;
                const textY = y + 8;
                const lines = cell.lines;
                const maxTextWidth = Math.max(18, w - cellPadding * 2);
                const lineHeight = 8;

                if (i === statusColIndex && lines[0]) {
                  const lower = String(lines.join(' ')).toLowerCase();
                  let bg = null;
                  let fg = [6,78,59];
                  if (/(unserviceable|broken|unavailable)/i.test(lower)) bg = [255,235,238];
                  else if (/(serviceable|available|working)/i.test(lower)) bg = [220,255,235];
                  else if (/(pending|in progress)/i.test(lower)) {
                    bg = [254,243,199];
                    fg = [120,53,15];
                  }

                  if (bg) {
                    const pillX = x + cellPadding;
                    const pillY = y + 4;
                    const pillWidth = Math.min(Math.max(40, Math.max(...lines.map((line) => doc.getTextWidth(line))) + 8), maxTextWidth);
                    const pillHeight = Math.max(14, lines.length * lineHeight + 6);
                    doc.setFillColor(...bg);
                    doc.setDrawColor(...fg);
                    doc.setLineWidth(0.35);
                    doc.rect(pillX, pillY, pillWidth, pillHeight, 'FD');
                    doc.setFont('helvetica', 'normal');
                    doc.setFontSize(8.2);
                    doc.setTextColor(...fg);
                    lines.forEach((line, index) => {
                      doc.text(line, pillX + 4, pillY + 9 + index * lineHeight);
                    });
                  } else {
                    doc.setFont('helvetica', 'normal');
                    doc.setFontSize(8.2);
                    doc.setTextColor(20);
                    lines.forEach((line, index) => {
                      doc.text(line, x + cellPadding, textY + index * lineHeight);
                    });
                  }
                } else {
                  doc.setFont('helvetica', 'normal');
                  doc.setFontSize(tableFontSize - 0.4);
                  doc.setTextColor(20);
                  lines.forEach((line, index) => {
                    doc.text(line, x + cellPadding, textY + index * lineHeight);
                  });
                }

                doc.rect(x, y - 2, w, rowBlockHeight, 'S');
                x += w;
              });
              currentY += rowBlockHeight;
            };

            // Draw table
            drawHeaderRow();
            rows.forEach((r, idx) => drawRow(r, idx));

            // Leave a sign-off area after the table, moving it to its own page if needed.
            let signatureTop = currentY + 28;
            if (signatureTop + 48 > pageHeight - margin - footerHeight) {
              doc.addPage();
              signatureTop = margin + 34;
            }
            const technicianName = reportState.filteredData
              .map((record) => record.technicianName || record.technician && record.technician.name)
              .find((name) => name && !/^unassigned$/i.test(String(name))) || 'Technician';
            const signatureLeft = margin + 18;
            const signatureRight = pageWidth / 2 + 18;
            const signatureLineWidth = (pageWidth - margin * 2) / 2 - 36;
            doc.setDrawColor(100, 116, 139);
            doc.setLineWidth(0.7);
            doc.line(signatureLeft, signatureTop + 20, signatureLeft + signatureLineWidth, signatureTop + 20);
            doc.line(signatureRight, signatureTop + 20, signatureRight + signatureLineWidth, signatureTop + 20);
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(9);
            doc.setTextColor(51, 65, 85);
            doc.text('Prepared By', signatureLeft, signatureTop + 33);
            doc.text('Verified By', signatureRight, signatureTop + 33);
            doc.setFont('helvetica', 'normal');
            doc.setFontSize(8);
            doc.setTextColor(100, 116, 139);
            doc.text(preparedByText + ' · Administrator', signatureLeft, signatureTop + 45);
            doc.text(String(technicianName) + ' · Technician', signatureRight, signatureTop + 45);

            // Footer with verification text and page numbers
            const totalPages = doc.getNumberOfPages();
            for (let p = 1; p <= totalPages; p++) {
              doc.setPage(p);
              doc.setFont('helvetica', 'normal');
              doc.setFontSize(9);
              doc.setTextColor(100);
              doc.text('Generated by Computer Laboratory Facilities Management System', margin, pageHeight - 22);
              doc.text('Page ' + p + ' of ' + totalPages, pageWidth - margin, pageHeight - 22, { align: 'right' });
            }

            const fileName = (definition.title || 'report').toLowerCase().replace(/[^a-z0-9]+/g, '-') + '.pdf';
            if (format === 'pdf-preview') {
              openReportPdfPreview(doc.output('blob'), fileName);
              return;
            }
            doc.save(fileName);
          }
        };

        document.addEventListener('DOMContentLoaded', async () => {
          const reportPdfPreviewModal = document.getElementById('reportPdfPreviewModal');
          if (reportPdfPreviewModal && reportPdfPreviewModal.parentElement !== document.body) {
            document.body.appendChild(reportPdfPreviewModal);
          }
          await loadExistingCampusOptions();
          updateFilterOptions();
          renderFilterStatus();
          document.getElementById('reportTypeSelect')?.addEventListener('change', handleReportTypeChange);
          ['campusFilter', 'laboratoryFilter', 'statusFilter', 'reportPeriodFilter', 'technicianFilter', 'issueTypeFilter', 'reportDateFromFilter', 'reportDateToFilter'].forEach((id) => {
            document.getElementById(id)?.addEventListener('change', () => handleFilterChange(id));
          });
          const searchInput = document.getElementById('reportSearchInput');
          searchInput?.addEventListener('input', () => {
            const searchClear = document.getElementById('reportSearchClear');
            if (searchClear) searchClear.hidden = !searchInput.value;
            clearTimeout(reportSearchTimer);
            reportSearchTimer = setTimeout(() => handleFilterChange('search'), 250);
          });
          document.getElementById('reportSearchClear')?.addEventListener('click', () => {
            if (searchInput) searchInput.value = '';
            handleFilterChange('search');
            searchInput?.focus();
          });
          document.getElementById('resetReportFilters')?.addEventListener('click', resetReportFilters);
          const reportActionsToggle = document.getElementById('reportActionsToggle');
          const reportActionsMenu = document.getElementById('reportActionsMenu');
          const closeReportActionsMenu = () => {
            if (reportActionsMenu) reportActionsMenu.hidden = true;
            reportActionsToggle?.setAttribute('aria-expanded', 'false');
          };
          reportActionsToggle?.addEventListener('click', (event) => {
            event.stopPropagation();
            const willOpen = Boolean(reportActionsMenu?.hidden);
            if (reportActionsMenu) reportActionsMenu.hidden = !willOpen;
            reportActionsToggle.setAttribute('aria-expanded', String(willOpen));
            if (willOpen) reportActionsMenu?.querySelector('[role="menuitem"]:not(:disabled)')?.focus();
          });
          reportActionsMenu?.addEventListener('keydown', (event) => {
            const items = Array.from(reportActionsMenu.querySelectorAll('[role="menuitem"]:not(:disabled)'));
            const currentIndex = items.indexOf(document.activeElement);
            let nextIndex = currentIndex;
            if (event.key === 'ArrowDown') nextIndex = (currentIndex + 1) % items.length;
            else if (event.key === 'ArrowUp') nextIndex = (currentIndex - 1 + items.length) % items.length;
            else if (event.key === 'Home') nextIndex = 0;
            else if (event.key === 'End') nextIndex = items.length - 1;
            else if (event.key === 'Escape') {
              event.preventDefault();
              closeReportActionsMenu();
              reportActionsToggle?.focus();
              return;
            } else return;
            event.preventDefault();
            items[nextIndex]?.focus();
          });
          reportActionsMenu?.addEventListener('click', (event) => {
            if (event.target.closest('[data-report-export], #resetReportFilters')) closeReportActionsMenu();
          });
          document.addEventListener('click', (event) => {
            if (!event.target.closest('#reportActionsMenuWrap')) closeReportActionsMenu();
          });
          document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') closeReportActionsMenu();
          });
          handleFilterChange('initial');
        });
