
          let activeQrScheduleIndex = null;
          let qrClassStatusRefreshTimer = null;
          let scheduleData = [];
          let scheduleLoadState = 'loading';
          let scheduleLoadError = '';
          let editingScheduleId = null;
          let instructorAccounts = [];
          let scheduleLayoutResizeTimer = null;
          function getStatusBadge(status) {
            const map = {
              Confirmed: 'bg-emerald-950/40 text-emerald-300 border border-emerald-800/40',
              'In Progress': 'bg-emerald-950/40 text-emerald-300 border border-emerald-800/40',
              Pending: 'bg-emerald-950/40 text-amber-200 border border-amber-700/30'
            };
            return map[status] || 'bg-emerald-950/40 text-emerald-300 border border-emerald-800/40';
          }

          function getQrStatus(item) {
            if (!item || !item.qr || !item.qr.url) return 'Not generated';
            return item.qr.expiresAt && item.qr.expiresAt > Date.now() ? 'Active' : 'Expired';
          }

          function getQrStatusClass(item) {
            const status = getQrStatus(item);
            if (status === 'Active') return 'bg-emerald-500/10 text-emerald-200';
            if (status === 'Not generated') return 'bg-slate-600/70 text-slate-200';
            return 'bg-amber-500/10 text-amber-200';
          }

          function getClassStatus(item, now = new Date()) {
            const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
            const scheduledDay = days.find((day) => day.toLowerCase() === String(item?.dayOfWeek || item?.day || '').trim().toLowerCase());
            const toMinutes = (value) => {
              const match = String(value || '').trim().match(/^(d{1,2})(?::(d{1,2}))?s*(AM|PM)?$/i);
              if (!match) return null;
              let hours = Number(match[1]);
              const minutes = Number(match[2] || 0);
              if (minutes > 59 || hours > 24 || (hours === 24 && minutes !== 0)) return null;
              if (match[3]) {
                if (hours < 1 || hours > 12) return null;
                const meridiem = match[3].toUpperCase();
                if (meridiem === 'AM' && hours === 12) hours = 0;
                if (meridiem === 'PM' && hours !== 12) hours += 12;
              } else if (hours === 24) {
                hours = 0;
              }
              return hours * 60 + minutes;
            };
            const start = toMinutes(item?.startTime);
            const end = toMinutes(item?.endTime);
            if (!scheduledDay || start === null || end === null) return 'Upcoming';
            const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
              timeZone: 'Asia/Manila',
              weekday: 'long',
              hour: '2-digit',
              minute: '2-digit',
              hourCycle: 'h23'
            }).formatToParts(now).map(({ type, value }) => [type, value]));
            const today = parts.weekday;
            const current = Number(parts.hour) * 60 + Number(parts.minute);
            if (today === scheduledDay) {
              if (end > start) {
                if (current >= end) return 'Ended';
                if (current >= start) return 'In Progress';
                return 'Upcoming';
              }
              return current >= start ? 'In Progress' : 'Upcoming';
            }
            const previousDay = days[(days.indexOf(today) + 6) % 7];
            if (end <= start && scheduledDay === previousDay) return current < end ? 'In Progress' : 'Ended';
            return 'Upcoming';
          }

          function updateQrClassStatus(item) {
            const status = getClassStatus(item);
            const badge = document.getElementById('classStatusBadge');
            const generateButton = document.getElementById('generateQrButton');
            const regenerateButton = document.getElementById('regenerateQrButton');
            const downloadButton = document.getElementById('downloadQrButton');
            const printButton = document.getElementById('printQrButton');
            if (badge) {
              badge.textContent = status;
              const classes = status === 'Ended'
                ? 'rounded-full bg-rose-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-rose-200'
                : status === 'In Progress'
                  ? 'rounded-full bg-emerald-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-emerald-200'
                  : 'rounded-full bg-sky-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-sky-200';
              badge.className = classes;
            }
            [generateButton, regenerateButton, downloadButton, printButton].forEach((button) => {
              if (button) {
                button.disabled = status === 'Ended';
                button.title = status === 'Ended' ? 'This class has ended; attendance QR generation is disabled.' : '';
                button.classList.toggle('opacity-50', status === 'Ended');
                button.classList.toggle('cursor-not-allowed', status === 'Ended');
              }
            });
            return status;
          }

          const attendanceMonitorEndpoint = '/api/instructor/attendance-dashboard';
          const attendanceMonitorStatsEndpoint = '/api/attendance/stats';
          const attendanceSessionEndpoint = '/api/attendance/session';
          let attendanceSessions = [];
          let attendanceRefreshId = null;
          async function fetchAttendanceStats() {
            const totalSessionsEl = document.getElementById('totalSessionsValue');
            const presentTodayEl = document.getElementById('presentTodayValue');
            const absentTodayEl = document.getElementById('absentTodayValue');
            const lateTodayEl = document.getElementById('lateTodayValue');
            if (!totalSessionsEl) {
              return;
            }

            try {
              const response = await fetch(attendanceMonitorStatsEndpoint, { cache: 'no-store' });
              if (!response.ok) throw new Error('Failed to load attendance stats');
              const stats = await response.json();
              totalSessionsEl.textContent = stats.total ?? 0;
              if (presentTodayEl) presentTodayEl.textContent = stats.present ?? 0;
              if (absentTodayEl) absentTodayEl.textContent = stats.absent ?? 0;
              if (lateTodayEl) lateTodayEl.textContent = stats.late ?? 0;
            } catch (err) {
              console.error(err);
            }
          }

          async function fetchAttendanceRecords() {
            const tbody = document.getElementById('attendanceMonitorTableBody');
            if (!tbody) {
              return;
            }

            try {
              const response = await fetch(attendanceMonitorEndpoint, { cache: 'no-store' });
              if (!response.ok) throw new Error('Failed to load attendance sessions');
              const payload = await response.json();
              attendanceSessions = Array.isArray(payload.sessions) ? payload.sessions : [];
              syncAttendanceCampusOptions(attendanceSessions);
              renderAttendanceSessionTable(attendanceSessions);
            } catch (err) {
              console.error(err);
            }
          }

          function syncAttendanceCampusOptions(sessions) {
            const filter = document.getElementById('attendanceCampusFilter');
            if (!filter) return;
            const selectedCampus = filter.value;
            const campuses = [...new Set(sessions
              .map((session) => String(session.campus || '').trim())
              .filter(Boolean))].sort((a, b) => a.localeCompare(b));
            filter.replaceChildren(new Option('All Campuses', ''));
            campuses.forEach((campus) => filter.add(new Option(campus, campus)));
            filter.value = campuses.includes(selectedCampus) ? selectedCampus : '';
          }

          function stopAttendanceRefresh() {
            if (attendanceRefreshId !== null) {
              window.clearInterval(attendanceRefreshId);
              attendanceRefreshId = null;
            }
          }

          function startAttendanceRefresh() {
            if (attendanceRefreshId !== null) return;
            attendanceRefreshId = window.setInterval(() => {
              fetchAttendanceRecords();
              fetchAttendanceStats();
            }, 30000);
          }

          window.addEventListener('pagehide', stopAttendanceRefresh, { once: true });

          function getAttendanceStatusClass(status) {
            const value = (status || '').toLowerCase();
            if (value === 'late') return 'bg-amber-500/10 text-amber-200';
            if (value === 'absent') return 'bg-red-500/10 text-red-200';
            return 'bg-emerald-500/10 text-emerald-200';
          }

          function formatSessionDate(value) {
            const date = new Date(value);
            if (Number.isNaN(date.getTime())) return '—';
            return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
          }

          function renderAttendanceTablePagination(filteredSessions) {
            const paginationContainer = document.getElementById('attendancePagination');
            const paginationInfo = document.getElementById('attendancePaginationInfo');
            if (!paginationContainer) return;

            if (paginationInfo) {
              paginationInfo.textContent = filteredSessions.length
                ? 'Showing all ' + filteredSessions.length + ' sessions • up to 10 visible at a time'
                : 'Showing 0 sessions';
            }
            paginationContainer.replaceChildren();
          }

          function renderAttendanceSessionTable(sessions) {
            const tbody = document.getElementById('attendanceMonitorTableBody');
            if (!tbody) return;
            if (!sessions.length) {
              tbody.innerHTML = '<tr><td colspan="7" class="px-4 py-6 text-center text-slate-400">No completed attendance sessions available yet.</td></tr>';
              const paginationContainer = document.getElementById('attendancePagination');
              if (paginationContainer) paginationContainer.innerHTML = '';
              const paginationInfo = document.getElementById('attendancePaginationInfo');
              if (paginationInfo) paginationInfo.textContent = 'Showing 0 sessions';
              return;
            }

            const filterValue = document.getElementById('attendanceSearch')?.value.toLowerCase() || '';
            const campusFilter = normalizeAttendanceCampus(document.getElementById('attendanceCampusFilter')?.value || '');
            const laboratoryFilter = document.getElementById('attendanceLabFilter')?.value || '';
            const dateFilter = document.getElementById('attendanceDateFilter')?.value || '';
            const filtered = sessions.filter((session) => {
              const content = ((session.subject || '') + ' ' + (session.laboratory || '') + ' ' + (session.instructor || '')).toLowerCase();
              const campus = normalizeAttendanceCampus(session.campus || '');
              const sessionDate = new Date(session.date || session.createdAt || '');
              const sessionDateKey = Number.isNaN(sessionDate.getTime())
                ? ''
                : sessionDate.getFullYear() + '-' + String(sessionDate.getMonth() + 1).padStart(2, '0') + '-' + String(sessionDate.getDate()).padStart(2, '0');
              const matchesSearch = !filterValue || content.includes(filterValue);
              const matchesCampus = !campusFilter || campus === campusFilter;
              const matchesLaboratory = !laboratoryFilter || String(session.laboratory || '').toLowerCase().includes(laboratoryFilter.toLowerCase());
              const matchesDate = !dateFilter || sessionDateKey === dateFilter;
              return matchesSearch && matchesCampus && matchesLaboratory && matchesDate;
            }).sort((a, b) => new Date(b.date || b.createdAt || 0) - new Date(a.date || a.createdAt || 0));

            if (!filtered.length) {
              tbody.innerHTML = '<tr><td colspan="7" class="px-4 py-6 text-center text-slate-400">No attendance sessions match the selected filters.</td></tr>';
              renderAttendanceTablePagination(filtered);
              return;
            }

            tbody.innerHTML = '';
            filtered.forEach((session) => {
              const row = document.createElement('tr');
              row.className = 'hover:bg-slate-900/70';
              const timeLabel = [session.startTime, session.endTime].filter(Boolean).join(' - ') || session.time || '—';
              const totalAttendance = (session.studentsPresent ?? 0) + (session.studentsLate ?? 0) + (session.studentsAbsent ?? 0);
              const countsLabel = '<div class="flex flex-col gap-1">' +
                '<div class="text-sm font-semibold text-white">' + totalAttendance + ' student' + (totalAttendance === 1 ? '' : 's') + '</div>' +
                '<div class="text-xs text-slate-400">' +
                'P:<span class="text-emerald-400 font-medium">' + (session.studentsPresent ?? 0) + '</span> • ' +
                'L:<span class="text-amber-400 font-medium">' + (session.studentsLate ?? 0) + '</span> • ' +
                'A:<span class="text-red-400 font-medium">' + (session.studentsAbsent ?? 0) + '</span>' +
                '</div>' +
                '</div>';
              row.innerHTML =
                '<td class="px-4 py-4 text-white">' + (session.subject || '—') + '</td>' +
                '<td class="px-4 py-4">' + (session.laboratory || '—') + '</td>' +
                '<td class="px-4 py-4">' + (session.instructor || '—') + '</td>' +
                '<td class="px-4 py-4">' + formatSessionDate(session.date || session.createdAt) + '</td>' +
                '<td class="px-4 py-4">' + (timeLabel || '—') + '</td>' +
                '<td class="px-4 py-4">' + countsLabel + '</td>' +
                '<td class="px-4 py-4"><button type="button" class="view-details inline-flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-900/70 px-3 py-2 text-sm font-semibold text-slate-200 hover:bg-slate-800"><i class="fas fa-eye"></i> View Details</button></td>';
              tbody.appendChild(row);
              const viewBtn = row.querySelector('button.view-details');
              if (viewBtn) {
                viewBtn.addEventListener('click', function () {
                  try { openAttendanceSessionModal(session.id || session.token || ''); } catch (e) { console.error(e); }
                });
              }
            });

            renderAttendanceTablePagination(filtered);
          }

          function normalizeAttendanceCampus(value) {
            return String(value || '').trim().replace(/s*campuss*$/i, '').toLowerCase();
          }

          function attachAttendanceFilters() {
            const searchInput = document.getElementById('attendanceSearch');
            if (searchInput) {
              searchInput.addEventListener('input', () => {
                renderAttendanceSessionTable(attendanceSessions);
              });
            }
            ['attendanceCampusFilter', 'attendanceLabFilter', 'attendanceDateFilter'].forEach((id) => {
              const filter = document.getElementById(id);
              if (filter) {
                filter.addEventListener('change', () => renderAttendanceSessionTable(attendanceSessions));
              }
            });
          }

          function attachScheduleFilters() {
            const instructor = document.getElementById('scheduleFilterInstructor');
            if (instructor && !instructor._attached) {
              instructor.addEventListener('change', () => {
                renderSchedules();
              });
              instructor._attached = true;
            }
            document.querySelectorAll('[data-lab-filter]').forEach((button) => {
              if (button._attached) return;
              button.addEventListener('click', () => {
                document.querySelectorAll('[data-lab-filter]').forEach((candidate) => {
                  const active = candidate === button;
                  candidate.classList.toggle('is-active', active);
                  candidate.setAttribute('aria-pressed', active ? 'true' : 'false');
                });
                renderSchedules();
              });
              button._attached = true;
            });
          }

          function normalizeScheduleFilterValue(value) {
            if (value === null || value === undefined) return '';
            return String(value).trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ');
          }

          function roomMatchesFilter(actualRoom, expectedRoom) {
            const actual = normalizeScheduleFilterValue(actualRoom);
            const expected = normalizeScheduleFilterValue(expectedRoom);
            if (!actual || !expected) return !actual && !expected;
            if (actual === expected) return true;

            const aliases = {
              'room 201': 'laboratory 1 room 202',
              'room 202': 'laboratory 1 room 202',
              'room 203': 'laboratory 2 room 204',
              'room 204': 'laboratory 2 room 204',
              'lab 1': 'laboratory 1 room 202',
              'lab 2': 'laboratory 2 room 204',
              'laboratory 1': 'laboratory 1 room 202',
              'laboratory 2': 'laboratory 2 room 204',
              'bongabong campus': 'bongabong',
              'calapan campus': 'calapan',
              'victoria campus': 'victoria'
            };

            return actual === aliases[expected] || expected === aliases[actual] || actual.includes(expected) || expected.includes(actual);
          }

          function campusMatchesFilter(actualCampus, expectedCampus) {
            const actual = normalizeScheduleFilterValue(actualCampus);
            const expected = normalizeScheduleFilterValue(expectedCampus);
            if (!actual || !expected) return !actual && !expected;
            if (actual === expected) return true;
            if (actual === 'bongabong campus') return expected === 'bongabong';
            if (expected === 'bongabong campus') return actual === 'bongabong';
            return actual.includes(expected) || expected.includes(actual);
          }

          function getScheduleListFromPayload(payload) {
            if (Array.isArray(payload)) return payload;
            if (!payload || typeof payload !== 'object') return [];
            const candidates = [
              payload.schedules,
              payload.data,
              payload.items,
              payload.results,
              payload.rows,
              payload.schedule
            ];
            for (const entry of candidates) {
              if (Array.isArray(entry)) return entry;
            }
            return [];
          }

          function normalizeScheduleRecord(item) {
            if (!item || typeof item !== 'object') return null;
            return {
              ...item,
              id: item.id ?? null,
              instructorUserId: item.instructorUserId ?? null,
              subject: item.subject || item.title || '',
              instructor: item.instructor || '',
              laboratoryRoom: item.laboratoryRoom || item.room || '',
              campus: item.campus || '',
              dayOfWeek: item.dayOfWeek || item.day || '',
              startTime: item.startTime || '',
              endTime: item.endTime || '',
              status: item.status || 'Confirmed',
              scheduleColor: /^#[0-9a-f]{6}$/i.test(String(item.scheduleColor || '')) ? item.scheduleColor : '#16a34a',
              qrEnabled: Boolean(item.qrEnabled)
            };
          }

          function updateScheduleColorPreview() {
            const colorInput = document.getElementById('scheduleColor');
            const valueOutput = document.getElementById('scheduleColorValue');
            if (!colorInput || !valueOutput) return;
            valueOutput.value = colorInput.value.toUpperCase();
            valueOutput.textContent = colorInput.value.toUpperCase();
            valueOutput.style.backgroundColor = colorInput.value;
            valueOutput.style.color = getScheduleTextColor(colorInput.value);
          }

          function getScheduleTextColor(hexColor) {
            const color = /^#[0-9a-f]{6}$/i.test(String(hexColor || '')) ? hexColor : '#16a34a';
            const channels = [1, 3, 5].map((offset) => parseInt(color.slice(offset, offset + 2), 16) / 255);
            const luminance = channels.map((channel) =>
              channel <= 0.04045 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4)
            ).reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0);
            const darkContrast = (luminance + 0.05) / (0.006 + 0.05);
            const lightContrast = 1.05 / (luminance + 0.05);
            return darkContrast >= lightContrast ? '#07140e' : '#ffffff';
          }

          function getScheduleLabNumber(room) {
            const normalized = normalizeScheduleFilterValue(room);
            const labMatch = normalized.match(/\b(?:com\s*lab|computer\s*lab|laboratory|lab)\s*([12])\b/);
            if (labMatch) return labMatch[1];
            if (normalized.includes('room 204')) return '2';
            if (normalized.includes('room 202')) return '1';
            return '';
          }

          function getScheduleMinutes(value) {
            const normalizedValue = String(value || '').replaceAll(String.fromCharCode(160), ' ').trim();
            const match = normalizedValue.match(/^([0-9]{1,2}):([0-9]{2}) *(AM|PM)?$/i);
            if (!match) return null;
            let hours = Number(match[1]);
            const minutes = Number(match[2]);
            if (!Number.isInteger(hours) || !Number.isInteger(minutes) || minutes > 59) return null;
            if (match[3]) {
              if (hours < 1 || hours > 12) return null;
              if (match[3].toUpperCase() === 'AM' && hours === 12) hours = 0;
              if (match[3].toUpperCase() === 'PM' && hours !== 12) hours += 12;
            } else if (hours > 23) {
              return null;
            }
            return hours * 60 + minutes;
          }

          function formatScheduleTime(value) {
            const minutes = getScheduleMinutes(value);
            if (minutes === null) return String(value || '—');
            const hours = Math.floor(minutes / 60);
            const minuteValue = minutes % 60;
            const hourLabel = hours % 12 || 12;
            return hourLabel + (minuteValue ? ':' + String(minuteValue).padStart(2, '0') : '') + (hours >= 12 ? ' PM' : ' AM');
          }

          function formatScheduleMinutes(minutes) {
            const hour = Math.floor(minutes / 60);
            return (hour % 12 || 12) + ':' + String(minutes % 60).padStart(2, '0') + ' ' + (hour >= 12 ? 'PM' : 'AM');
          }

          function getAllowedScheduleTimes() {
            const times = [];
            for (let minutes = 7 * 60 + 30; minutes <= 17 * 60 + 30; minutes += 30) {
              times.push(formatScheduleMinutes(minutes));
            }
            return times;
          }

          function isAllowedScheduleTime(value) {
            const minutes = getScheduleMinutes(value);
            return minutes !== null && getAllowedScheduleTimes().some((time) => getScheduleMinutes(time) === minutes);
          }

          function initializeScheduleTimeOptions() {
            const startSelect = document.getElementById('scheduleStartTime');
            const endSelect = document.getElementById('scheduleEndTime');
            if (!startSelect || !endSelect) return;
            startSelect.replaceChildren(new Option('Select Start Time', ''));
            endSelect.replaceChildren(new Option('Select End Time', ''));
            getAllowedScheduleTimes().forEach((time) => startSelect.add(new Option(time, time)));
            getAllowedScheduleTimes().forEach((time) => endSelect.add(new Option(time, time)));
          }

          async function fetchInstructors() {
            const response = await fetch('/api/laboratory-schedule-instructors', {
              cache: 'no-store',
              credentials: 'same-origin'
            });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(payload?.error || 'Failed to load instructor list');
            instructorAccounts = (Array.isArray(payload) ? payload : [])
              .map((entry) => ({
                id: String(entry?.id || ''),
                accountId: String(entry?.accountId || ''),
                name: String(entry?.name || '').trim(),
                campus: String(entry?.campus || '').trim()
              }))
              .filter((account) => account.id.startsWith('user:') && account.accountId && account.name)
              .sort((a, b) => a.name.localeCompare(b.name));

            const filter = document.getElementById('scheduleFilterInstructor');
            const scheduleInstructor = document.getElementById('scheduleInstructorId');
            const currentFilter = filter?.value || '';
            const currentScheduleInstructor = scheduleInstructor?.value || '';
            filter?.replaceChildren(new Option('All Instructors', ''));
            scheduleInstructor?.replaceChildren(new Option('Select Faculty', ''));
            instructorAccounts.forEach((account) => {
              filter?.add(new Option(account.name, account.id));
              scheduleInstructor?.add(new Option(account.name, account.id));
            });
            if (filter && instructorAccounts.some((account) => account.id === currentFilter)) {
              filter.value = currentFilter;
            }
            if (scheduleInstructor && instructorAccounts.some((account) => account.id === currentScheduleInstructor)) {
              scheduleInstructor.value = currentScheduleInstructor;
            }
            updateScheduleInstructorDisplay(getSelectedInstructorAccount());
          }

          function getSelectedInstructorAccount() {
            const selectedId = String(document.getElementById('scheduleFilterInstructor')?.value || '');
            return instructorAccounts.find((account) => account.id === selectedId) || null;
          }

          function getSelectedScheduleInstructorAccount() {
            const selectedId = String(document.getElementById('scheduleInstructorId')?.value || '');
            return instructorAccounts.find((account) => account.id === selectedId) || null;
          }

          function getInstructorAccountForSchedule(schedule) {
            const linkedAccount = instructorAccounts.find((account) =>
              account.accountId && String(account.accountId) === String(schedule?.instructorUserId || '')
            );
            if (linkedAccount) return linkedAccount;
            const matchingAccounts = instructorAccounts.filter((account) =>
              account.name.trim().toLowerCase() === String(schedule?.instructor || '').trim().toLowerCase()
            );
            return matchingAccounts.find((account) => campusMatchesFilter(account.campus, schedule?.campus)) ||
              matchingAccounts.find((account) => !account.campus) ||
              null;
          }

          function updateScheduleInstructorDisplay(account) {
            const instructorId = document.getElementById('scheduleInstructorId');
            const campus = document.getElementById('scheduleCampus');
            if (instructorId) instructorId.value = account?.id || '';
            const campusValue = account?.campus || window.__CURRENT_USER_CAMPUS__ || '';
            if (campus) campus.value = String(campusValue).trim();
          }

          function getScheduleById(id) {
            if (id === null || id === undefined || id === '') return null;
            const targetId = String(id);
            return scheduleData.find((schedule) => String(schedule.id) === targetId) || null;
          }

          function normalizeScheduleForQr(item) {
            const schedule = normalizeScheduleRecord(item);
            if (!schedule) return null;
            const timeLabel = [schedule.startTime, schedule.endTime].filter(Boolean).join(' - ');
            return {
              ...schedule,
              title: schedule.subject || 'Untitled Session',
              subject: schedule.subject || 'Untitled Session',
              laboratoryRoom: schedule.laboratoryRoom || 'No room',
              dayOfWeek: schedule.dayOfWeek || 'Monday',
              startTime: schedule.startTime || '',
              endTime: schedule.endTime || '',
              campus: schedule.campus || 'Main Campus',
              instructor: schedule.instructor || 'No instructor',
              status: schedule.status || 'Confirmed',
              day: schedule.dayOfWeek || 'Monday',
              time: timeLabel || '',
              room: schedule.laboratoryRoom || 'No room'
            };
          }

          async function createAttendanceSession(item, minutes) {
            const normalizedItem = normalizeScheduleForQr(item);
            try {
              const response = await fetch(attendanceSessionEndpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  scheduleId: normalizedItem.id,
                  expirationMinutes: minutes
                })
              });

              if (!response.ok) {
                const payload = await response.json().catch(() => null);
                const message = payload?.error || payload?.message || 'Unable to create attendance session';
                throw new Error(message);
              }

              return await response.json();
            } catch (err) {
              console.error('Failed to generate attendance QR.');
              console.error(err?.stack || err);
              alert(err?.message || 'Unable to generate attendance QR.');
              return null;
            }
          }

          function buildQrPayload(item, minutes) {
            const token = 'lab-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
            return {
              token,
              url: window.location.origin + '/api/attendance/scan?token=' + token,
              payload: '',
              title: item.title,
              room: item.room,
              day: item.day,
              time: item.time,
              minutes: minutes,
              generatedAt: new Date().toISOString()
            };
          }

          async function fetchSchedules() {
            try {
              scheduleLoadState = 'loading';
              scheduleLoadError = '';
              scheduleData = [];
              renderSchedules();

              const response = await fetch('/api/laboratory-schedules', { cache: 'no-store', credentials: 'same-origin' });
              if (!response.ok) {
                const errorPayload = await response.json().catch(() => ({}));
                throw new Error(errorPayload?.error || 'Failed to load schedules');
              }

              const payload = await response.json();
              const rawSchedules = getScheduleListFromPayload(payload);
              scheduleData = rawSchedules
                .map((item) => normalizeScheduleRecord(item))
                .filter(Boolean)
                .filter((item) => {
                  const activeCampus = normalizeScheduleFilterValue(window.__CURRENT_USER_CAMPUS__);
                  return !activeCampus || campusMatchesFilter(item.campus, activeCampus);
                });

              scheduleLoadState = 'loaded';
              try { attachScheduleFilters(); } catch (e) {}
              renderSchedules();

              // The timetable should not wait on the separate instructor directory request.
              fetchInstructors()
                .then(() => {
                  try { attachScheduleFilters(); } catch (e) {}
                  renderSchedules();
                })
                .catch((instructorError) => {
                  console.warn('Instructor filter list is unavailable; schedules remain visible.', instructorError);
                });
            } catch (err) {
              console.error(err);
              scheduleLoadState = 'error';
              scheduleLoadError = err.message || 'Failed to load schedules.';
              scheduleData = [];
              renderSchedules();
            }
          }

          async function confirmScheduleArchive(id) {
            if (!await window.appDialogs.confirm('Archive this laboratory schedule? It can be restored from Archived Records.')) return;
            try {
              const response = await fetch('/api/archive/laboratory-schedule/' + encodeURIComponent(id), { method: 'POST' });
              const payload = await response.json().catch(() => ({}));
              if (!response.ok) throw new Error(payload.error || 'Unable to archive schedule');
              scheduleData = scheduleData.filter((item) => String(item.id) !== String(id));
              renderSchedules();
              window.alert('Schedule archived successfully.');
            } catch (err) {
              console.error(err);
              window.alert(err.message || 'Unable to archive schedule.');
            }
          }

          window.closeScheduleDetails = function closeScheduleDetails() {
            const modal = document.getElementById('scheduleDetailsModal');
            if (!modal) return;
            modal.classList.add('hidden');
            modal.classList.remove('flex');
          };

          window.openScheduleDetails = function openScheduleDetails(id) {
            const schedule = getScheduleById(id);
            const modal = document.getElementById('scheduleDetailsModal');
            const title = document.getElementById('scheduleDetailsTitle');
            const lab = document.getElementById('scheduleDetailsLab');
            const list = document.getElementById('scheduleDetailsList');
            if (!schedule || !modal || !title || !lab || !list) return;

            const labNumber = getScheduleLabNumber(schedule.laboratoryRoom);
            lab.textContent = labNumber ? 'COMLAB ' + labNumber : schedule.laboratoryRoom;
            title.textContent = schedule.subject || 'Laboratory session';
            list.replaceChildren();
            [
              ['Instructor', schedule.instructor || 'Not assigned'],
              ['Weekly day', schedule.dayOfWeek || '—'],
              ['Time', formatScheduleTime(schedule.startTime) + ' – ' + formatScheduleTime(schedule.endTime)],
              ['Year level', schedule.yearLevel || '—'],
              ['Section', schedule.section || '—'],
              ['Laboratory', schedule.laboratoryRoom || '—'],
              ['Campus', schedule.campus || '—'],
              ['Course / section', Array.isArray(schedule.classSections) && schedule.classSections.length ? schedule.classSections.join(', ') : '—'],
              ['Status', schedule.status || 'Confirmed'],
              ['Attendance recorded', String(Number(schedule.classListCount || 0))]
            ].forEach(([label, value]) => {
              const row = document.createElement('div');
              row.className = 'grid grid-cols-[9rem_1fr] gap-3 border-b border-white/5 pb-2';
              const term = document.createElement('dt');
              term.className = 'text-slate-400';
              term.textContent = label;
              const detail = document.createElement('dd');
              detail.className = 'font-semibold text-slate-100';
              detail.textContent = value;
              row.append(term, detail);
              list.append(row);
            });

            document.getElementById('scheduleDetailsSeatingButton').onclick = () => {
              window.closeScheduleDetails();
              window.openSeatingChartModal(schedule.id);
            };
            document.getElementById('scheduleDetailsQrButton').onclick = () => {
              window.closeScheduleDetails();
              window.openQrModal(schedule.id);
            };
            modal.classList.remove('hidden');
            modal.classList.add('flex');
          };

          function renderSchedules() {
            const calendar = document.getElementById('scheduleCalendar');
            const count = document.getElementById('scheduleCount');
            if (!calendar) return;

            const selectedInstructorId = String(document.getElementById('scheduleFilterInstructor')?.value || '');
            const selectedInstructor = instructorAccounts.find((account) => account.id === selectedInstructorId) || null;
            const selectedLab = document.querySelector('.schedule-lab-filter.is-active')?.dataset.labFilter || '1';
            const filteredSchedules = scheduleData.filter((item) => {
              const instructor = String(item.instructor || '').trim().toLowerCase();
              const matchesInstructor = !selectedInstructor ||
                (item.instructorUserId
                  ? String(item.instructorUserId) === selectedInstructor.accountId
                  : instructor === selectedInstructor.name.trim().toLowerCase());
              const matchesLab = getScheduleLabNumber(item.laboratoryRoom) === selectedLab;
              return matchesInstructor && matchesLab;
            });

            if (count) {
              if (scheduleLoadState === 'loading') count.textContent = 'Loading schedules…';
              else if (scheduleLoadState === 'error') count.textContent = 'Schedules unavailable';
              else count.textContent = filteredSchedules.length + ' COMLAB ' + selectedLab + ' schedules';
            }

            const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
            const todayName = new Date().toLocaleDateString('en-US', { weekday: 'long' });
            const calendarStart = 7 * 60 + 30;
            const calendarEnd = 17 * 60 + 30;
            const slotMinutes = 30;
            const slotCount = (calendarEnd - calendarStart) / slotMinutes;
            const formatSlotTime = (minutes) => {
              const hour = Math.floor(minutes / 60);
              return (hour % 12 || 12) + ':' + String(minutes % 60).padStart(2, '0') + ' ' + (hour >= 12 ? 'PM' : 'AM');
            };

            calendar.replaceChildren();
            const header = document.createElement('div');
            header.className = 'schedule-calendar-header';
            const timeHeader = document.createElement('div');
            timeHeader.className = 'schedule-calendar-day-heading';
            timeHeader.textContent = 'TIME';
            header.append(timeHeader);
            days.forEach((day) => {
              const heading = document.createElement('div');
              heading.className = 'schedule-calendar-day-heading';
              if (day === todayName) heading.classList.add('is-today');
              heading.textContent = day.toUpperCase();
              header.append(heading);
            });
            calendar.append(header);

            const calendarViewport = calendar.parentElement;
            const viewportHeight = Number(calendarViewport?.clientHeight) || 0;
            const headerHeight = Number(header.getBoundingClientRect().height) || 34;
            const availableGridHeight = viewportHeight > 0
              ? viewportHeight - headerHeight - 4
              : window.innerHeight - 420;
            const rowHeight = Math.max(18, Math.min(40, Math.floor(availableGridHeight / slotCount)));

            const body = document.createElement('div');
            body.className = 'schedule-calendar-body';
            body.style.gridTemplateRows = 'repeat(' + slotCount + ', ' + rowHeight + 'px)';
            body.style.minHeight = (slotCount * rowHeight) + 'px';
            for (let offset = 0; offset < slotCount; offset += 1) {
              const slotStart = calendarStart + offset * slotMinutes;
              const slotEnd = slotStart + slotMinutes;
              const label = document.createElement('div');
              label.className = 'schedule-calendar-time';
              label.style.gridColumn = '1';
              label.style.gridRow = String(offset + 1);
              label.textContent = formatSlotTime(slotStart) +
                ' – ' +
                formatSlotTime(slotEnd);
              body.append(label);
            }

            days.forEach((day, dayIndex) => {
              const column = document.createElement('div');
              column.className = 'schedule-day-column';
              if (day === todayName) column.classList.add('is-today');
              column.dataset.day = day;
              column.style.height = (slotCount * rowHeight) + 'px';
              column.style.setProperty('--schedule-row-height', rowHeight + 'px');
              column.style.display = 'grid';
              column.style.gridTemplateRows = 'repeat(' + slotCount + ', ' + rowHeight + 'px)';
              column.style.gridTemplateColumns = 'minmax(0, 1fr)';
              column.style.gridColumn = String(dayIndex + 2);
              body.append(column);
            });

            if (!filteredSchedules.length) {
              const empty = document.createElement('div');
              empty.className = 'schedule-calendar-empty';
              empty.style.gridColumn = '2 / -1';
              empty.style.gridRow = '1 / span 5';
              empty.setAttribute('role', 'status');
              empty.setAttribute('aria-live', 'polite');
              if (scheduleLoadState === 'loading') empty.classList.add('is-loading');
              if (scheduleLoadState === 'error') empty.classList.add('is-error');
              empty.textContent = scheduleLoadState === 'error'
                ? (scheduleLoadError || 'Unable to load schedules.')
                : scheduleLoadState === 'loading'
                  ? 'Loading schedules…'
                  : scheduleData.length
                    ? 'No schedules match these filters.'
                    : 'No laboratory schedules found.';
              body.append(empty);
            }

            filteredSchedules.forEach((item) => {
              const dayIndex = days.findIndex((day) => day.toLowerCase() === String(item.dayOfWeek || '').trim().toLowerCase());
              const start = getScheduleMinutes(item.startTime);
              const end = getScheduleMinutes(item.endTime);
              if (dayIndex < 0 || start === null || end === null || end <= start) return;
              const visibleStart = Math.max(start, calendarStart);
              const visibleEnd = Math.min(end, calendarEnd);
              if (visibleEnd <= visibleStart) return;
              const column = body.querySelector('[data-day="' + days[dayIndex] + '"]');
              if (!column) return;

              const event = document.createElement(item.isHardcoded ? 'div' : 'button');
              if (item.isHardcoded) event.setAttribute('role', 'group');
              else event.type = 'button';
              event.className = 'schedule-event' + (item.isHardcoded ? ' schedule-event--hardcoded' : '');
              event.dataset.lab = getScheduleLabNumber(item.laboratoryRoom);
              event.dataset.scheduleId = String(item.id);
              event.dataset.scheduleStart = String(visibleStart);
              event.dataset.scheduleEnd = String(visibleEnd);
              event.style.backgroundColor = item.scheduleColor;
              event.style.color = getScheduleTextColor(item.scheduleColor);
              event.style.borderColor = event.style.color === '#ffffff'
                ? 'rgba(255,255,255,.55)'
                : 'rgba(7,20,14,.42)';
              const eventHeight = Math.max(1, ((visibleEnd - visibleStart) / slotMinutes) * rowHeight - 2);
              if (item.isHardcoded) {
                const firstGridRow = Math.floor((visibleStart - calendarStart) / slotMinutes) + 1;
                const lastGridRow = Math.ceil((visibleEnd - calendarStart) / slotMinutes) + 1;
                event.style.gridRow = firstGridRow + ' / ' + lastGridRow;
                event.style.gridColumn = '1 / -1';
              } else {
                event.style.top = (((visibleStart - calendarStart) / slotMinutes) * rowHeight + 1) + 'px';
                event.style.height = eventHeight + 'px';
              }
              event.title = [
                item.subject || 'Laboratory session',
                [item.yearLevel, item.section ? 'Section ' + item.section : ''].filter(Boolean).join(' · '),
                item.instructor || 'No instructor',
                formatScheduleTime(item.startTime) + ' to ' + formatScheduleTime(item.endTime),
                item.roomNote || '',
                item.laboratoryRoom || ''
              ].filter(Boolean).join(' · ');
              event.setAttribute('aria-label', [
                item.subject || 'Laboratory session',
                [item.yearLevel, item.section ? 'Section ' + item.section : ''].filter(Boolean).join(', '),
                item.instructor || 'No instructor',
                formatScheduleTime(item.startTime) + ' to ' + formatScheduleTime(item.endTime),
                item.roomNote || ''
              ].filter(Boolean).join(', '));

              const time = document.createElement('span');
              time.className = 'schedule-event-time';
              time.textContent = formatScheduleTime(item.startTime) + '–' + formatScheduleTime(item.endTime);
              const cohort = document.createElement('span');
              cohort.className = 'schedule-event-cohort';
              cohort.textContent = [item.yearLevel, item.section].filter(Boolean).join(' · ');
              const instructor = document.createElement('span');
              instructor.className = 'schedule-event-instructor';
              instructor.textContent = item.instructor || 'Instructor not assigned';
              const roomNote = document.createElement('span');
              roomNote.className = 'schedule-event-location';
              roomNote.textContent = item.roomNote || '';
              const subject = document.createElement('span');
              subject.className = 'schedule-event-subject';
              subject.textContent = item.subject || '';
              if (eventHeight < 72) event.classList.add('schedule-event--compact');
              if (subject.textContent) event.append(subject);
              if (cohort.textContent) event.append(cohort);
              if (eventHeight >= 72) {
                const meta = document.createElement('span');
                meta.className = 'schedule-event-meta';
                meta.append(time);
                if (roomNote.textContent) meta.append(roomNote);
                else meta.append(instructor);
                event.append(meta);
              }
              if (!item.isHardcoded) {
                event.addEventListener('click', () => window.openScheduleDetails(item.id));
                event.addEventListener('contextmenu', (contextEvent) => {
                  contextEvent.preventDefault();
                  openScheduleContextMenu(item.id, contextEvent.clientX, contextEvent.clientY);
                });
                event.addEventListener('keydown', (keyboardEvent) => {
                  if (keyboardEvent.shiftKey && keyboardEvent.key === 'F10') {
                    keyboardEvent.preventDefault();
                    const bounds = event.getBoundingClientRect();
                    openScheduleContextMenu(item.id, bounds.left, bounds.bottom);
                  }
                });
              }
              column.append(event);
            });

            days.forEach((day) => {
              const column = body.querySelector('[data-day="' + day + '"]');
              if (!column) return;
              const dayEvents = Array.from(column.querySelectorAll('.schedule-event'))
                .map((element) => ({
                  element,
                  start: Number(element.dataset.scheduleStart),
                  end: Number(element.dataset.scheduleEnd)
                }))
                .filter((entry) => Number.isFinite(entry.start) && Number.isFinite(entry.end))
                .sort((a, b) => a.start - b.start || a.end - b.end);
              let cluster = [];
              let clusterEnd = -1;
              let maxLaneCount = 1;
              const positionCluster = () => {
                if (!cluster.length) return;
                const laneEnds = [];
                cluster.forEach((entry) => {
                  let lane = laneEnds.findIndex((laneEnd) => laneEnd <= entry.start);
                  if (lane < 0) lane = laneEnds.length;
                  laneEnds[lane] = entry.end;
                  entry.lane = lane;
                });
                const laneCount = laneEnds.length;
                maxLaneCount = Math.max(maxLaneCount, laneCount);
                cluster.forEach((entry) => {
                  entry.laneCount = laneCount;
                });
                cluster = [];
                clusterEnd = -1;
              };
              dayEvents.forEach((entry) => {
                if (cluster.length && entry.start >= clusterEnd) positionCluster();
                cluster.push(entry);
                clusterEnd = Math.max(clusterEnd, entry.end);
              });
              positionCluster();
              column.style.gridTemplateColumns = 'repeat(' + maxLaneCount + ', minmax(0, 1fr))';
              dayEvents.forEach((entry) => {
                if (entry.element.classList.contains('schedule-event--hardcoded')) return;
                const laneWidth = (100 - 6) / entry.laneCount;
                entry.element.style.left = 'calc(' + (3 + entry.lane * laneWidth) + '% + 1px)';
                entry.element.style.width = 'calc(' + laneWidth + '% - 2px)';
              });
            });

            calendar.append(body);
          }

          let contextScheduleId = null;

          function closeScheduleContextMenu() {
            const menu = document.getElementById('scheduleContextMenu');
            if (!menu) return;
            menu.classList.remove('is-open');
            menu.setAttribute('aria-hidden', 'true');
            contextScheduleId = null;
          }

          function openScheduleContextMenu(scheduleId, clientX, clientY) {
            const menu = document.getElementById('scheduleContextMenu');
            if (!menu || !getScheduleById(scheduleId)) return;
            contextScheduleId = scheduleId;
            menu.classList.add('is-open');
            menu.setAttribute('aria-hidden', 'false');
            menu.style.left = '0px';
            menu.style.top = '0px';
            const bounds = menu.getBoundingClientRect();
            menu.style.left = Math.max(8, Math.min(clientX, window.innerWidth - bounds.width - 8)) + 'px';
            menu.style.top = Math.max(8, Math.min(clientY, window.innerHeight - bounds.height - 8)) + 'px';
            menu.querySelector('[data-schedule-action="view"]')?.focus();
          }

          function runScheduleContextAction(action) {
            const scheduleId = contextScheduleId;
            const schedule = getScheduleById(scheduleId);
            closeScheduleContextMenu();
            if (!schedule) return;
            if (action === 'view') window.openScheduleDetails(schedule.id);
          }

          document.addEventListener('click', (event) => {
            if (!event.target.closest('#scheduleContextMenu')) closeScheduleContextMenu();
          });
          document.addEventListener('contextmenu', (event) => {
            if (!event.target.closest('.schedule-event')) closeScheduleContextMenu();
          });
          document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') closeScheduleContextMenu();
          });
          document.addEventListener('scroll', closeScheduleContextMenu, true);
          window.addEventListener('resize', closeScheduleContextMenu);
          document.getElementById('scheduleContextMenu')?.addEventListener('click', (event) => {
            const actionButton = event.target.closest('[data-schedule-action]');
            if (actionButton) runScheduleContextAction(actionButton.dataset.scheduleAction);
          });

          window.openScheduleModal = function openScheduleModal() {
            if (!['faculty', 'instructor'].includes(String(window.__CURRENT_USER_ROLE__ || '').trim().toLowerCase())) {
              return;
            }
            console.log('[Add Schedule] openScheduleModal() called');
            const selectedAccount = getSelectedInstructorAccount();
            editingScheduleId = null;
            const form = document.getElementById('scheduleForm');
            if (form) form.reset();
            initializeScheduleTimeOptions();
            updateScheduleInstructorDisplay(selectedAccount);
            document.getElementById('scheduleColor').value = '#16a34a';
            updateScheduleColorPreview();
            document.getElementById('scheduleModalTitle').textContent = 'Add Lab Schedule';
            document.getElementById('scheduleModalSubtitle').textContent = 'Create a weekly schedule and assign it to a weekday.';
            document.getElementById('scheduleSubmitButton').textContent = 'Create Schedule';
            resetClassListUploadState();
            const modal = document.getElementById('scheduleModal');
            console.log('[Add Schedule] Modal element inside openScheduleModal:', modal);
            if (!modal) {
              console.warn('[Add Schedule] scheduleModal element not found - aborting open');
              return;
            }
            console.log('[Add Schedule] Removing hidden and adding display classes');
            modal.classList.remove('hidden');
            modal.classList.add('flex', 'show');
            modal.style.display = 'flex';
            modal.style.opacity = '1';
            // prevent body scrolling when modal is open
            try { document.body.classList.add('overflow-hidden'); } catch (e) {}
            console.log('[Add Schedule] Modal should now be visible.');
          };

          function openEditScheduleModal(scheduleOrId) {
            const schedule = normalizeScheduleRecord(typeof scheduleOrId === 'object' ? scheduleOrId : getScheduleById(scheduleOrId));
            if (!schedule) return;
            editingScheduleId = schedule.id;
            document.getElementById('scheduleModalTitle').textContent = 'Edit Lab Schedule';
            document.getElementById('scheduleModalSubtitle').textContent = 'Update the existing session details.';
            document.getElementById('scheduleSubmitButton').textContent = 'Update Schedule';
            document.getElementById('scheduleDay').value = schedule.dayOfWeek || 'Monday';
            document.getElementById('scheduleTitle').value = schedule.subject || '';
            document.getElementById('scheduleYearLevel').value = schedule.yearLevel || '';
            document.getElementById('scheduleSection').value = schedule.section || '';
            updateScheduleInstructorDisplay(getInstructorAccountForSchedule(schedule));
            document.getElementById('scheduleColor').value = schedule.scheduleColor;
            updateScheduleColorPreview();
            // Preselect canonical room and campus in edit modal. If legacy values exist, attempt normalization.
            const roomSelect = document.getElementById('scheduleRoom');
            const normalizedRoom = (function(v) {
              if (!v) return '';
              const map = { 'room 202': 'Laboratory 1 — Room 202', 'room202': 'Laboratory 1 — Room 202', 'rm 202': 'Laboratory 1 — Room 202', 'laboratory 1': 'Laboratory 1 — Room 202', 'lab 1': 'Laboratory 1 — Room 202', 'room 204': 'Laboratory 2 — Room 204', 'room204': 'Laboratory 2 — Room 204', 'rm 204': 'Laboratory 2 — Room 204', 'laboratory 2': 'Laboratory 2 — Room 204', 'lab 2': 'Laboratory 2 — Room 204' };
              const key = String(v).trim().toLowerCase();
              return map[key] || v || '';
            })(schedule.laboratoryRoom || '');
            if (roomSelect) roomSelect.value = normalizedRoom || '';
            initializeScheduleTimeOptions();
            const startTimeSelect = document.getElementById('scheduleStartTime');
            const startTime = schedule.startTime || '';
            if (startTimeSelect && Array.from(startTimeSelect.options).some((option) => option.value === startTime)) {
              startTimeSelect.value = startTime;
            }
            const endTimeSelect = document.getElementById('scheduleEndTime');
            const endTime = schedule.endTime || '';
            if (endTimeSelect && Array.from(endTimeSelect.options).some((option) => option.value === endTime)) {
              endTimeSelect.value = endTime;
            }
            document.getElementById('scheduleQrEnabled').checked = Boolean(schedule.qrEnabled);
            resetClassListUploadState();
            const modal = document.getElementById('scheduleModal');
            if (!modal) return;
            modal.classList.remove('hidden');
            modal.classList.add('flex', 'show');
            modal.style.display = 'flex';
            modal.style.opacity = '1';
          }

          let parsedClassListPayload = null;

          function resetClassListUploadState() {
            parsedClassListPayload = null;
            const message = document.getElementById('scheduleClassListMessage');
            const meta = document.getElementById('scheduleClassListMeta');
            const validation = document.getElementById('scheduleClassListValidation');
            const fileInput = document.getElementById('scheduleClassListFile');
            if (message) message.innerHTML = 'No class list selected.';
            if (meta) meta.innerHTML = '';
            if (validation) validation.classList.add('hidden');
            if (fileInput) fileInput.value = '';
          }

          function updateClassListUploadState({ message, meta, isSuccess, isError }) {
            const messageNode = document.getElementById('scheduleClassListMessage');
            const metaNode = document.getElementById('scheduleClassListMeta');
            const validation = document.getElementById('scheduleClassListValidation');
            if (messageNode) {
              messageNode.className = isSuccess ? 'text-emerald-300 font-semibold' : isError ? 'text-red-200 font-semibold' : 'text-slate-400';
              messageNode.textContent = message;
            }
            if (metaNode) {
              metaNode.innerHTML = meta || '';
            }
            if (validation) {
              validation.classList.toggle('hidden', !isError);
              if (!isError) {
                validation.textContent = 'Please upload the official class list before creating the laboratory schedule.';
              }
            }
          }

          window.closeScheduleModal = function closeScheduleModal() {
            const modal = document.getElementById('scheduleModal');
            if (!modal) return;
            modal.classList.remove('show');
            modal.classList.remove('flex');
            modal.classList.add('hidden');
            modal.style.display = 'none';
            modal.style.opacity = '0';
            const form = document.getElementById('scheduleForm');
            if (form) form.reset();
            editingScheduleId = null;
            resetClassListUploadState();
            try { document.body.classList.remove('overflow-hidden'); } catch (e) {}
          };
          window.handleClassListFileChange = handleClassListFileChange;
          window.handleScheduleSubmit = handleScheduleSubmit;

          function normalizeClassListRow(row) {
            if (!row || typeof row !== 'object') return null;
            const normalized = {};
            Object.entries(row).forEach(([key, value]) => {
              const normalizedKey = String(key).trim().toLowerCase();
              normalized[normalizedKey] = String(value ?? '').trim();
            });
            const lastName = normalized.lastname || normalized['last name'] || '';
            const firstName = normalized.firstname || normalized['first name'] || '';
            const middleInitial = normalized.middleinitial || normalized['middle initial'] || '';
            const fullName = normalized.fullname || normalized.name || normalized['full name'] || '';
            const courseSection = normalized.coursesection || normalized.course_section || normalized['course section'] || '';
            const program = normalized.program || '';
            const year = normalized.year || '';
            const section = normalized.section || '';
            const email = normalized.email || '';
            if (!fullName && !(lastName && firstName)) return null;
            return {
              lastName,
              firstName,
              middleInitial,
              fullName,
              courseSection,
              program,
              year,
              section,
              email
            };
          }

          function parseCsvToClassList(csv) {
            const lines = csv.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
            if (!lines.length) return [];
            const headerRow = lines[0].split(/,|\t/).map((field) => field.trim().toLowerCase());
            const hasHeaders = ['lastname', 'firstname', 'middleinitial'].every((key) => headerRow.includes(key));
            return lines.slice(hasHeaders ? 1 : 0).map((line) => {
              const values = line.split(/,|\t/).map((cell) => cell.trim());
              return {
                lastName: values[headerRow.indexOf('lastname')] || values[0] || '',
                firstName: values[headerRow.indexOf('firstname')] || values[1] || '',
                middleInitial: values[headerRow.indexOf('middleinitial')] || values[2] || '',
                fullName: values[headerRow.indexOf('fullname')] || '',
                courseSection: values[headerRow.indexOf('coursesection')] || '',
                program: values[headerRow.indexOf('program')] || '',
                year: values[headerRow.indexOf('year')] || '',
                section: values[headerRow.indexOf('section')] || '',
                email: values[headerRow.indexOf('email')] || ''
              };
            }).filter((row) => row.fullName || (row.lastName && row.firstName));
          }

          function parseExcelToClassList(workbook) {
            const sheetNames = workbook?.SheetNames || [];
            if (!sheetNames.length) return [];
            const sheet = workbook.Sheets[sheetNames[0]];
            const rows = window.XLSX.utils.sheet_to_json(sheet, { defval: '' });
            return rows.map(normalizeClassListRow).filter(Boolean);
          }

          function handleClassListFileChange(files) {
            const file = files?.[0];
            if (!file) {
              resetClassListUploadState();
              return;
            }
            const fileName = file.name || 'Selected file';
            const extension = (file.name.split('.').pop() || '').toLowerCase();
            const isExcel = ['xlsx', 'xls'].includes(extension);
            const isCsv = extension === 'csv';
            if (!isExcel && !isCsv) {
              parsedClassListPayload = null;
              updateClassListUploadState({
                message: 'Please upload a supported class list file (.xlsx, .xls, .csv).',
                meta: '',
                isError: true
              });
              return;
            }

            parsedClassListPayload = [];
            updateClassListUploadState({
              message: '✓ Class list file selected',
              meta: '<span class="font-semibold text-emerald-200">Ready to upload</span><span class="text-slate-400">• ' + fileName + '</span>',
              isSuccess: true
            });
          }

          async function handleScheduleSubmit(event) {
            event.preventDefault();
            const isEditing = Boolean(editingScheduleId);
            const day = document.getElementById('scheduleDay').value;
            const title = document.getElementById('scheduleTitle').value.trim();
            const yearLevel = document.getElementById('scheduleYearLevel').value.trim();
            const section = document.getElementById('scheduleSection').value.trim();
            const instructorAccount = getSelectedScheduleInstructorAccount();
            const instructor = instructorAccount?.name || '';
            const scheduleColor = String(document.getElementById('scheduleColor')?.value || '#16a34a').toLowerCase();
            const room = document.getElementById('scheduleRoom').value.trim();
            const scheduleCampus = instructorAccount?.campus || window.__CURRENT_USER_CAMPUS__ || '';
            const statusElem = document.getElementById('scheduleStatus');
            const status = statusElem ? statusElem.value : 'Confirmed';
            const startTime = document.getElementById('scheduleStartTime').value.trim();
            const endTime = document.getElementById('scheduleEndTime').value.trim();
            const qrEnabled = document.getElementById('scheduleQrEnabled').checked;
            const classListValidation = document.getElementById('scheduleClassListValidation');
            const classListFileInput = document.getElementById('scheduleClassListFile');
            const hasClassListSelection = Boolean(classListFileInput?.files?.length || classListFileInput?.value);
            const classList = Array.isArray(parsedClassListPayload) ? parsedClassListPayload : [];

            if (!instructorAccount || !day || !title || !yearLevel || !section || !instructor || !room || !scheduleCampus || !startTime || !endTime) {
              alert('Select an instructor and complete the required schedule fields.');
              return;
            }

            const requestedStart = getScheduleMinutes(startTime);
            const requestedEnd = getScheduleMinutes(endTime);
            if (!isAllowedScheduleTime(startTime) || !isAllowedScheduleTime(endTime)) {
              alert('Choose a time between 7:30 AM and 5:30 PM. Times must be in 30-minute intervals.');
              return;
            }
            if (requestedStart === null || requestedEnd === null || requestedEnd <= requestedStart) {
              alert('End Time must be later than Start Time.');
              return;
            }
            const normalizedInstructor = instructorAccount.name.trim().toLowerCase();
            const localConflict = scheduleData.find((item) => {
              if (isEditing && String(item.id) === String(editingScheduleId)) return false;
              if (String(item.dayOfWeek || '').trim().toLowerCase() !== day.trim().toLowerCase()) return false;
              const existingStart = getScheduleMinutes(item.startTime);
              const existingEnd = getScheduleMinutes(item.endTime);
              if (existingStart === null || existingEnd === null) return false;
              if (!(requestedStart < existingEnd && existingStart < requestedEnd)) return false;
              const sameInstructor = item.instructorUserId
                ? String(item.instructorUserId) === instructorAccount.accountId
                : String(item.instructor || '').trim().toLowerCase() === normalizedInstructor;
              const sameRoom = getScheduleLabNumber(item.laboratoryRoom) === getScheduleLabNumber(room) &&
                campusMatchesFilter(item.campus, scheduleCampus);
              return sameRoom || sameInstructor;
            });
            if (localConflict) {
              const sameRoom = getScheduleLabNumber(localConflict.laboratoryRoom) === getScheduleLabNumber(room) &&
                campusMatchesFilter(localConflict.campus, scheduleCampus);
              alert(sameRoom
                ? 'Schedule conflict: COMLAB ' + getScheduleLabNumber(room) + ' is already occupied during this time.'
                : 'Schedule conflict: This instructor already has a schedule during this time.');
              return;
            }

            // Class list is now optional - no validation required
            classListValidation?.classList.add('hidden');

            try {
              const formData = new FormData();
              formData.append('subject', title);
              formData.append('yearLevel', yearLevel);
              formData.append('section', section);
              formData.append('instructorId', instructorAccount.id);
              formData.append('scheduleColor', scheduleColor);
              formData.append('laboratoryRoom', room);
              formData.append('dayOfWeek', day);
              formData.append('startTime', startTime);
              formData.append('endTime', endTime);
              // Keep sending status if present to maintain backward compatibility; server uses default if omitted.
              if (status) formData.append('status', status);
              formData.append('qrEnabled', qrEnabled ? 'true' : 'false');
              if (classList.length) {
                formData.append('classList', JSON.stringify(classList));
              }
              if (classListFileInput?.files?.[0]) {
                formData.append('classListFile', classListFileInput.files[0]);
              }

              const response = await fetch(isEditing ? '/api/laboratory-schedules/' + encodeURIComponent(editingScheduleId) : '/api/laboratory-schedules', {
                method: isEditing ? 'PUT' : 'POST',
                credentials: 'same-origin',
                body: formData
              });

              if (!response.ok) {
                const result = await response.json().catch(() => ({}));
                throw new Error(result.message || result.error || 'Unable to save schedule');
              }

              const result = await response.json().catch(() => ({}));
              closeScheduleModal();
              await fetchSchedules();
              if (isEditing) {
                window.alert('Schedule updated successfully.');
              } else {
                window.alert('Schedule created successfully.');
              }

              if (qrEnabled && !isEditing) {
                const item = result.schedule || result;
                if (item?.id) {
                  const qrResponse = await createAttendanceSession({
                    id: item.id,
                    title: item.subject,
                    day: item.dayOfWeek,
                    time: item.startTime + ' - ' + item.endTime,
                    room: item.laboratoryRoom,
                    status: item.status
                  }, 15);
                  if (qrResponse?.session) {
                    await fetchSchedules();
                  }
                }
              }
            } catch (err) {
              console.error(err);
              alert((isEditing ? 'Failed to update schedule: ' : 'Failed to create schedule: ') + (err.message || 'Please try again.'));
            }
          }

          function openQrModal(scheduleOrId) {
            const modal = document.getElementById('qrModal');
            const schedule = normalizeScheduleRecord(typeof scheduleOrId === 'object' ? scheduleOrId : getScheduleById(scheduleOrId));
            const normalizedItem = normalizeScheduleForQr(schedule);
            if (!normalizedItem) return;
            activeQrScheduleIndex = scheduleData.findIndex((item) => String(item.id) === String(normalizedItem.id));
            if (activeQrScheduleIndex < 0) {
              activeQrScheduleIndex = typeof scheduleOrId === 'number' ? scheduleData.findIndex((item) => String(item.id) === String(scheduleOrId)) : null;
            }
            const subtitle = document.getElementById('qrModalSubtitle');
            subtitle.textContent = normalizedItem.subject + ' • ' + normalizedItem.dayOfWeek + ' • ' + normalizedItem.startTime + ' - ' + normalizedItem.endTime + ' • ' + normalizedItem.laboratoryRoom;
            modal.classList.add('show');
            modal.classList.remove('hidden');
            if (qrClassStatusRefreshTimer !== null) window.clearInterval(qrClassStatusRefreshTimer);
            qrClassStatusRefreshTimer = window.setInterval(() => renderQrPreview(normalizedItem), 30000);
            window.setTimeout(() => renderQrPreview(normalizedItem), 0);
          }

          function closeQrModal() {
            const modal = document.getElementById('qrModal');
            if (qrClassStatusRefreshTimer !== null) {
              window.clearInterval(qrClassStatusRefreshTimer);
              qrClassStatusRefreshTimer = null;
            }
            modal.classList.remove('show');
            modal.classList.add('hidden');
          }

          function renderQrPreview(item) {
            const preview = document.getElementById('qrPreview');
            const statusBadge = document.getElementById('qrStatusBadge');
            if (!item) return;
            const classStatus = updateQrClassStatus(item);
            preview.innerHTML = '';
            if (classStatus === 'Ended') {
              preview.innerHTML = '<div class="text-center text-rose-200">This class has ended. Its attendance QR can no longer be used.</div>';
              statusBadge.textContent = 'Class Ended';
              statusBadge.className = 'rounded-full bg-rose-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-rose-200';
              return;
            }
            if (!item.qr || !item.qr.url) {
              preview.innerHTML = '<div class="text-center text-gray-400">No QR generated yet. Choose an expiration window and generate one.</div>';
              statusBadge.textContent = 'Not generated';
              statusBadge.className = 'rounded-full bg-slate-600/70 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-slate-200';
              return;
            }
            const wrapper = document.createElement('div');
            wrapper.className = 'flex flex-col items-center gap-3';
            const qrContainer = document.createElement('div');
            qrContainer.className = 'rounded-2xl bg-white p-5';
            qrContainer.style.width = '380px';
            qrContainer.style.maxWidth = '100%';
            qrContainer.style.display = 'flex';
            qrContainer.style.alignItems = 'center';
            qrContainer.style.justifyContent = 'center';
            qrContainer.style.padding = '24px';
            const qrInfo = document.createElement('div');
            qrInfo.className = 'text-center';
            qrInfo.innerHTML = '<p class="text-sm font-semibold text-white">' + (item.subject || item.title || 'Untitled Session') + '</p><p class="text-xs text-gray-400">' + (item.dayOfWeek || item.day || 'Monday') + ' • ' + (item.time || (item.startTime + ' - ' + item.endTime)) + '</p><p class="text-xs text-gray-500">' + (item.laboratoryRoom || item.room || 'No room') + '</p>';
            wrapper.appendChild(qrContainer);
            wrapper.appendChild(qrInfo);
            preview.appendChild(wrapper);

            const qrImage = document.createElement('img');
            qrImage.alt = 'Attendance QR';
            qrImage.src = item.qr.qrCode || item.qr.imageDataUrl || item.qr.url || '';
            qrImage.width = 320;
            qrImage.height = 320;
            qrImage.style.width = '320px';
            qrImage.style.height = '320px';
            qrImage.style.maxWidth = '100%';
            qrImage.style.objectFit = 'contain';
            qrImage.style.display = 'block';
            qrContainer.appendChild(qrImage);

            item.qr.imageDataUrl = item.qr.qrCode || item.qr.imageDataUrl || '';
            statusBadge.textContent = getQrStatus(item);
            statusBadge.className = 'rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] ' + getQrStatusClass(item);
          }

          async function generateCurrentQr() {
            const item = activeQrScheduleIndex !== null && activeQrScheduleIndex >= 0 ? normalizeScheduleRecord(scheduleData[activeQrScheduleIndex]) : null;
            if (!item) return;
            if (updateQrClassStatus(item) === 'Ended') return;
            const minutes = parseInt(document.getElementById('qrExpirySelect').value, 10) || 15;
            const response = await createAttendanceSession(item, minutes);
            if (!response?.session) return;

            const qrData = response.session.qrCode || response.session.qrImage || '';
            const nextQr = {
              token: response.session.token,
              url: response.session.scanUrl,
              qrCode: qrData,
              expiresAt: new Date(response.session.expiresAt).getTime(),
              title: item.subject || item.title || 'Untitled Session',
              room: item.laboratoryRoom || item.room || 'No room',
              day: item.dayOfWeek || item.day || 'Monday',
              time: [item.startTime, item.endTime].filter(Boolean).join(' - '),
              imageDataUrl: qrData
            };

            item.qr = nextQr;
            if (activeQrScheduleIndex !== null && activeQrScheduleIndex >= 0) {
              scheduleData[activeQrScheduleIndex] = { ...scheduleData[activeQrScheduleIndex], qr: nextQr };
            }
            renderQrPreview(item);
            renderSchedules();
          }

          function regenerateCurrentQr() {
            generateCurrentQr();
          }

          function getCurrentQrDataUrl(item) {
            const preview = document.getElementById('qrPreview');
            const img = preview && preview.querySelector('img');
            if (img && img.currentSrc) return img.currentSrc;
            if (img && img.src) return img.src;
            if (!item || !item.qr) return null;
            const candidates = [item.qr.imageDataUrl, item.qr.qrCode, item.qr.url];
            for (const candidate of candidates) {
              if (typeof candidate === 'string' && candidate.trim()) {
                return candidate;
              }
            }
            return null;
          }

          function downloadCurrentQr() {
            const item = activeQrScheduleIndex !== null && activeQrScheduleIndex >= 0 ? normalizeScheduleRecord(scheduleData[activeQrScheduleIndex]) : null;
            const dataUrl = getCurrentQrDataUrl(item);
            if (!item || !dataUrl) {
              alert('No QR image is available yet. Generate a QR first.');
              return;
            }

            const link = document.createElement('a');
            link.download = 'attendance-qr-' + (item.subject || item.title || 'schedule').replace(/[^a-z0-9]+/gi, '-').toLowerCase() + '.png';
            link.href = dataUrl;
            document.body.appendChild(link);
            link.click();
            link.remove();
          }

          function printCurrentQr() {
            const item = activeQrScheduleIndex !== null && activeQrScheduleIndex >= 0 ? normalizeScheduleRecord(scheduleData[activeQrScheduleIndex]) : null;
            const dataUrl = getCurrentQrDataUrl(item);
            if (!item || !dataUrl) {
              alert('No QR image is available yet. Generate a QR first.');
              return;
            }

            const printWindow = window.open('', '_blank', 'width=800,height=900');
            if (!printWindow) {
              alert('Please allow pop-ups so the QR sticker can be printed.');
              return;
            }

            const title = String(item.subject || item.title || 'Untitled Session');
            const scheduleText = [item.dayOfWeek || item.day || 'Monday', [item.startTime, item.endTime].filter(Boolean).join(' - ') || item.time || ''].filter(Boolean).join(' • ');
            const roomText = item.laboratoryRoom || item.room || 'No room';
            const html = '<!DOCTYPE html><html><head><meta charset="utf-8" /><title>Attendance QR</title><style>body{font-family:Arial,sans-serif;text-align:center;padding:24px;background:#fff;color:#111}h2{margin-bottom:8px}p{margin:4px 0}img{max-width:320px;margin-top:16px}</style></head><body><h2>' + title + '</h2><p>' + scheduleText + '</p><p>' + roomText + '</p><img src="' + dataUrl + '" /></body></html>';
            printWindow.document.open();
            printWindow.document.write(html);
            printWindow.document.close();
            printWindow.focus();
            setTimeout(() => {
              printWindow.print();
            }, 350);
          }

          async function openAttendanceSessionModal(sessionId) {
            const modal = document.getElementById('attendanceSessionModal');
            const content = document.getElementById('attendanceSessionModalContent');
            const title = document.getElementById('attendanceSessionModalTitle');
            const subtitle = document.getElementById('attendanceSessionModalSubtitle');
            if (!modal || !content) return;
            modal.classList.remove('hidden');
            modal.classList.add('flex');
            title.textContent = 'Loading attendance details...';
            subtitle.textContent = 'Fetching the final attendance breakdown.';
            content.innerHTML = '<div class="rounded-2xl border border-slate-800 bg-slate-900/70 p-6 text-center text-slate-400">Loading session details...</div>';

            try {
              const response = await fetch('/api/instructor/attendance-dashboard/' + encodeURIComponent(sessionId), { cache: 'no-store' });
              if (!response.ok) throw new Error('Unable to load attendance details');
              const payload = await response.json();
              const session = payload.session || {};
              const records = Array.isArray(payload.records) ? payload.records : [];
              const present = records.filter((row) => row.attendanceStatus === 'Present');
              const late = records.filter((row) => row.attendanceStatus === 'Late');
              const absent = records.filter((row) => row.attendanceStatus === 'Absent');
              const attendanceSessionState = {
                currentPage: 1,
                rowsPerPage: 3,
                filter: 'All',
                records: records,
                sessionKey: session.id || session.token || ''
              };
              const tabs = ['All', 'Present', 'Late', 'Absent'];
              const filter = 'All';

              title.textContent = session.subject || 'Attendance Details';
              subtitle.textContent = [session.laboratory || session.room, session.instructor].filter(Boolean).join(' • ');
              
              // Enhanced UI with better visual hierarchy and modern card design
              const metaRows = [
                // Session Info Section - Compact 2-column layout
                '<div class="space-y-4">',
                '<div class="rounded-xl border border-emerald-500/30 bg-gradient-to-br from-emerald-950/40 to-slate-900/70 p-5">',
                '<h4 class="text-xs font-semibold uppercase tracking-wider text-emerald-400 mb-4 flex items-center gap-2">',
                '<i class="fas fa-info-circle"></i> Session Information',
                '</h4>',
                '<div class="grid gap-4 md:grid-cols-2">',
                '<div class="flex items-start gap-3">',
                '<div class="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-500/20 text-emerald-400">',
                '<i class="fas fa-book-open"></i>',
                '</div>',
                '<div class="flex-1 min-w-0">',
                '<p class="text-xs text-slate-400 mb-1">Subject</p>',
                '<p class="text-sm font-semibold text-white truncate">' + (session.subject || '—') + '</p>',
                '</div>',
                '</div>',
                '<div class="flex items-start gap-3">',
                '<div class="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-500/20 text-blue-400">',
                '<i class="fas fa-chalkboard-teacher"></i>',
                '</div>',
                '<div class="flex-1 min-w-0">',
                '<p class="text-xs text-slate-400 mb-1">Instructor</p>',
                '<p class="text-sm font-semibold text-white truncate">' + (session.instructor || '—') + '</p>',
                '</div>',
                '</div>',
                '<div class="flex items-start gap-3">',
                '<div class="flex h-10 w-10 items-center justify-center rounded-lg bg-purple-500/20 text-purple-400">',
                '<i class="fas fa-flask"></i>',
                '</div>',
                '<div class="flex-1 min-w-0">',
                '<p class="text-xs text-slate-400 mb-1">Laboratory</p>',
                '<p class="text-sm font-semibold text-white truncate">' + (session.laboratory || '—') + '</p>',
                '</div>',
                '</div>',
                '<div class="flex items-start gap-3">',
                '<div class="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-500/20 text-amber-400">',
                '<i class="fas fa-calendar-alt"></i>',
                '</div>',
                '<div class="flex-1 min-w-0">',
                '<p class="text-xs text-slate-400 mb-1">Date</p>',
                '<p class="text-sm font-semibold text-white">' + formatSessionDate(session.date || session.createdAt) + '</p>',
                '</div>',
                '</div>',
                '</div>',
                '</div>',
                
                // Stats Cards - Large prominent display
                '<div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">',
                '<div class="relative overflow-hidden rounded-xl border-2 border-emerald-500/40 bg-gradient-to-br from-emerald-500/20 to-emerald-900/30 p-5 shadow-lg shadow-emerald-500/10">',
                '<div class="absolute right-0 top-0 h-24 w-24 translate-x-8 -translate-y-8 rounded-full bg-emerald-500/20 blur-2xl"></div>',
                '<div class="relative">',
                '<div class="mb-2 flex items-center gap-2">',
                '<i class="fas fa-check-circle text-lg text-emerald-400"></i>',
                '<p class="text-xs font-medium uppercase tracking-wide text-emerald-300">Present</p>',
                '</div>',
                '<p class="text-4xl font-bold text-white">' + present.length + '</p>',
                '<p class="mt-1 text-xs text-emerald-200/70">' + (records.length ? Math.round((present.length / records.length) * 100) : 0) + '% attendance</p>',
                '</div>',
                '</div>',
                
                '<div class="relative overflow-hidden rounded-xl border-2 border-amber-500/40 bg-gradient-to-br from-amber-500/20 to-amber-900/30 p-5 shadow-lg shadow-amber-500/10">',
                '<div class="absolute right-0 top-0 h-24 w-24 translate-x-8 -translate-y-8 rounded-full bg-amber-500/20 blur-2xl"></div>',
                '<div class="relative">',
                '<div class="mb-2 flex items-center gap-2">',
                '<i class="fas fa-clock text-lg text-amber-400"></i>',
                '<p class="text-xs font-medium uppercase tracking-wide text-amber-300">Late</p>',
                '</div>',
                '<p class="text-4xl font-bold text-white">' + late.length + '</p>',
                '<p class="mt-1 text-xs text-amber-200/70">' + (records.length ? Math.round((late.length / records.length) * 100) : 0) + '% tardy</p>',
                '</div>',
                '</div>',
                
                '<div class="relative overflow-hidden rounded-xl border-2 border-red-500/40 bg-gradient-to-br from-red-500/20 to-red-900/30 p-5 shadow-lg shadow-red-500/10">',
                '<div class="absolute right-0 top-0 h-24 w-24 translate-x-8 -translate-y-8 rounded-full bg-red-500/20 blur-2xl"></div>',
                '<div class="relative">',
                '<div class="mb-2 flex items-center gap-2">',
                '<i class="fas fa-times-circle text-lg text-red-400"></i>',
                '<p class="text-xs font-medium uppercase tracking-wide text-red-300">Absent</p>',
                '</div>',
                '<p class="text-4xl font-bold text-white">' + absent.length + '</p>',
                '<p class="mt-1 text-xs text-red-200/70">' + (records.length ? Math.round((absent.length / records.length) * 100) : 0) + '% missed</p>',
                '</div>',
                '</div>',
                
                '<div class="relative overflow-hidden rounded-xl border-2 border-slate-700/40 bg-gradient-to-br from-slate-800/60 to-slate-900/80 p-5 shadow-lg">',
                '<div class="absolute right-0 top-0 h-24 w-24 translate-x-8 -translate-y-8 rounded-full bg-slate-500/10 blur-2xl"></div>',
                '<div class="relative">',
                '<div class="mb-2 flex items-center gap-2">',
                '<i class="fas fa-users text-lg text-slate-400"></i>',
                '<p class="text-xs font-medium uppercase tracking-wide text-slate-300">Total</p>',
                '</div>',
                '<p class="text-4xl font-bold text-white">' + records.length + '</p>',
                '<p class="mt-1 text-xs text-slate-400">students enrolled</p>',
                '</div>',
                '</div>',
                '</div>',
                
                // Filter tabs
                '<div class="flex flex-wrap gap-2">' + tabs.map(function(tab) {
                  const activeClass = tab === filter ? 'bg-emerald-600 text-white border-emerald-500 shadow-md shadow-emerald-500/20' : 'bg-slate-800/60 text-slate-300 border-slate-700 hover:bg-slate-700/60';
                  const iconMap = { 'All': 'fa-list', 'Present': 'fa-check-circle', 'Late': 'fa-clock', 'Absent': 'fa-times-circle' };
                  return '<button type="button" data-tab="' + tab + '" class="attendance-filter-btn inline-flex items-center gap-2 rounded-lg border px-4 py-2.5 text-sm font-semibold transition-all ' + activeClass + '"><i class="fas ' + iconMap[tab] + '"></i>' + tab + '</button>';
                }).join('') + '</div>',
                
                // Student table
                '<div class="overflow-hidden rounded-xl border border-slate-700/50 shadow-xl">',
                '<div class="overflow-x-auto">',
                '<table class="min-w-full divide-y divide-slate-700/50">',
                '<thead class="bg-gradient-to-r from-slate-900 to-slate-800">',
                '<tr>',
                '<th class="px-5 py-4 text-left text-xs font-semibold uppercase tracking-wider text-slate-300">Student ID</th>',
                '<th class="px-5 py-4 text-left text-xs font-semibold uppercase tracking-wider text-slate-300">Full Name</th>',
                '<th class="px-5 py-4 text-left text-xs font-semibold uppercase tracking-wider text-slate-300">Status</th>',
                '<th class="px-5 py-4 text-left text-xs font-semibold uppercase tracking-wider text-slate-300">Time In</th>',
                '<th class="px-5 py-4 text-left text-xs font-semibold uppercase tracking-wider text-slate-300">PC Set</th>',
                '</tr>',
                '</thead>',
                '<tbody id="attendanceSessionRows" class="divide-y divide-slate-700/30 bg-slate-900/40"></tbody>',
                '</table>',
                '</div>',
                '<div id="attendanceSessionPagination" class="flex flex-wrap items-center justify-center gap-2 border-t border-slate-700/50 bg-slate-900/60 px-4 py-4"></div>',
                '</div>',
                '</div>'
              ];
              content.innerHTML = metaRows.join('');
              // Attach click handlers to attendance filter buttons to avoid inline onclick generation
              try {
                const filterContainer = content.querySelector('.attendance-filter-container');
                if (filterContainer) {
                  const buttons = Array.from(filterContainer.querySelectorAll('button.attendance-filter-btn'));
                  buttons.forEach((btn) => {
                    btn.addEventListener('click', function () {
                      const tab = this.dataset.tab;
                      buttons.forEach((b) => {
                        b.classList.remove('bg-emerald-600', 'text-white');
                        b.classList.add('bg-slate-900/70', 'text-slate-200');
                      });
                      this.classList.remove('bg-slate-900/70', 'text-slate-200');
                      this.classList.add('bg-emerald-600', 'text-white');
                      try { window.renderAttendanceSessionRows(session.id || session.token || '', tab); } catch (e) { console.error(e); }
                    });
                  });
                }
              } catch (e) { console.error(e); }

              function renderAttendanceSessionPagination(filteredRows) {
                const paginationContainer = document.getElementById('attendanceSessionPagination');
                if (!paginationContainer) return;
                const totalPages = Math.max(1, Math.ceil(filteredRows.length / attendanceSessionState.rowsPerPage));
                attendanceSessionState.totalPages = totalPages;
                if (totalPages <= 1) {
                  paginationContainer.innerHTML = '';
                  return;
                }

                const activePage = Math.min(attendanceSessionState.currentPage, totalPages);
                attendanceSessionState.currentPage = activePage;

                const createPageButton = (page, label, isActive, isNavButton = false) => {
                  const button = document.createElement('button');
                  button.type = 'button';
                  button.textContent = label;
                  button.disabled = page === activePage && !isNavButton;
                  button.className = isNavButton
                    ? 'rounded-lg border border-emerald-800/50 bg-emerald-950/40 px-3 py-1.5 text-sm text-emerald-300 transition hover:bg-emerald-900/50'
                    : (isActive
                      ? 'flex h-8 w-8 items-center justify-center rounded-lg border border-emerald-500 bg-emerald-600 font-bold text-white shadow-sm transition'
                      : 'flex h-8 w-8 items-center justify-center rounded-lg border border-emerald-800/40 bg-emerald-950/40 text-emerald-300 transition hover:bg-emerald-900/60');
                  if (button.disabled && !isNavButton) {
                    button.classList.add('cursor-not-allowed', 'opacity-40');
                  }
                  button.addEventListener('click', function () {
                    attendanceSessionState.currentPage = page;
                    window.renderAttendanceSessionRows(attendanceSessionState.sessionKey, attendanceSessionState.filter);
                  });
                  return button;
                };

                paginationContainer.innerHTML = '';
                const prevButton = createPageButton(Math.max(1, activePage - 1), 'Previous', false, true);
                prevButton.disabled = activePage <= 1;
                if (prevButton.disabled) prevButton.classList.add('cursor-not-allowed', 'opacity-40');
                paginationContainer.appendChild(prevButton);

                const visiblePages = getTruncatedPaginationItems(totalPages, activePage);
                visiblePages.forEach((pageItem) => {
                  if (pageItem === '...') {
                    const ellipsis = document.createElement('span');
                    ellipsis.className = 'px-1 font-bold text-emerald-500/60';
                    ellipsis.textContent = '...';
                    paginationContainer.appendChild(ellipsis);
                    return;
                  }

                  paginationContainer.appendChild(createPageButton(pageItem, String(pageItem), pageItem === activePage));
                });

                const nextButton = createPageButton(Math.min(totalPages, activePage + 1), 'Next', false, true);
                nextButton.disabled = activePage >= totalPages;
                if (nextButton.disabled) nextButton.classList.add('cursor-not-allowed', 'opacity-40');
                paginationContainer.appendChild(nextButton);
              }

              window.renderAttendanceSessionRows = function(sessionKey, filterValue) {
                const rows = document.getElementById('attendanceSessionRows');
                if (!rows) return;
                const previousFilter = attendanceSessionState.filter;
                attendanceSessionState.filter = filterValue || 'All';
                if (attendanceSessionState.filter !== previousFilter) {
                  attendanceSessionState.currentPage = 1;
                }
                const filteredRows = attendanceSessionState.records.filter(function(row) {
                  return attendanceSessionState.filter === 'All' || row.attendanceStatus === attendanceSessionState.filter;
                });
                const startIndex = (attendanceSessionState.currentPage - 1) * attendanceSessionState.rowsPerPage;
                const pageItems = filteredRows.slice(startIndex, startIndex + attendanceSessionState.rowsPerPage);

                rows.innerHTML = pageItems.length ? pageItems.map(function(row) {
                  const status = row.attendanceStatus || row.status || 'Absent';
                  const statusConfig = {
                    'Present': { class: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30', icon: 'fa-check-circle' },
                    'Late': { class: 'bg-amber-500/20 text-amber-300 border-amber-500/30', icon: 'fa-clock' },
                    'Absent': { class: 'bg-red-500/20 text-red-300 border-red-500/30', icon: 'fa-times-circle' }
                  };
                  const config = statusConfig[status] || statusConfig['Absent'];
                  const studentId = row.studentId || row.id || '—';
                  const name = row.studentName || row.fullName || '—';
                  const timeIn = row.timeIn || row.time || 'Not recorded';
                  const pcStationSetId = row.pcStationSetId || '—';
                  return '<tr class="hover:bg-slate-800/40 transition-colors">' +
                    '<td class="px-5 py-4 text-sm font-medium text-slate-300">' + studentId + '</td>' +
                    '<td class="px-5 py-4 text-sm font-medium text-white">' + name + '</td>' +
                    '<td class="px-5 py-4"><span class="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold ' + config.class + '"><i class="fas ' + config.icon + '"></i>' + status + '</span></td>' +
                    '<td class="px-5 py-4 text-sm text-slate-400">' + timeIn + '</td>' +
                    '<td class="px-5 py-4 text-sm font-semibold text-emerald-200">' + pcStationSetId + '</td>' +
                    '</tr>';
                }).join('') : '<tr><td colspan="5" class="px-5 py-8 text-center"><div class="flex flex-col items-center gap-2"><i class="fas fa-user-slash text-3xl text-slate-600"></i><p class="text-slate-400">No students in this group.</p></div></td></tr>';

                renderAttendanceSessionPagination(filteredRows);
              };
              window.renderAttendanceSessionRows(sessionId, 'All');
            } catch (err) {
              console.error(err);
              content.innerHTML = '<div class="rounded-2xl border border-red-500/20 bg-red-500/10 p-6 text-red-200">Unable to load the session details.</div>';
            }
          }

          function closeAttendanceSessionModal() {
            const modal = document.getElementById('attendanceSessionModal');
            if (modal) {
              modal.classList.add('hidden');
              modal.classList.remove('flex');
            }
          }

          document.addEventListener('DOMContentLoaded', async function() {
            initializeScheduleTimeOptions();
            document.getElementById('scheduleColor')?.addEventListener('input', updateScheduleColorPreview);
            document.getElementById('scheduleInstructorId')?.addEventListener('change', () => {
              updateScheduleInstructorDisplay(getSelectedScheduleInstructorAccount());
            });
            window.addEventListener('resize', () => {
              window.clearTimeout(scheduleLayoutResizeTimer);
              scheduleLayoutResizeTimer = window.setTimeout(renderSchedules, 120);
            }, { passive: true });
            renderSchedules();
            attachAttendanceFilters();
            const schedulesPromise = fetchSchedules();
            await fetchAttendanceRecords();
            await fetchAttendanceStats();
            await schedulesPromise;
            startAttendanceRefresh();
          });

          // ========================
          // Seating Chart Modal
          // ========================
          window.openSeatingChartModal = async function(scheduleId) {
            const modal = document.getElementById('seatingChartModal');
            if (!modal) return;

            document.querySelector('body.app-shell .main-container')?.classList.add('seating-chart-open');
            modal.classList.remove('hidden');
            modal.classList.add('flex');

            const loadingDiv = document.getElementById('seatingChartLoading');
            const contentDiv = document.getElementById('seatingChartContent');
            const errorDiv = document.getElementById('seatingChartError');

            loadingDiv.classList.remove('hidden');
            contentDiv.classList.add('hidden');
            errorDiv.classList.add('hidden');

            try {
              const response = await fetch(`/api/laboratory-schedules/${scheduleId}/seating-chart`);
              if (!response.ok) throw new Error('Failed to fetch seating chart');

              const data = await response.json();
              
              // Update modal header with schedule info
              document.getElementById('seatingScheduleSubject').textContent = data.schedule.subject || 'Lab Session';
              document.getElementById('seatingScheduleTime').textContent = `${data.schedule.day} • ${data.schedule.time}`;
              document.getElementById('seatingScheduleRoom').textContent = data.schedule.room || 'N/A';
              
              // Update statistics
              document.getElementById('statOccupiedPCs').textContent = data.statistics.occupiedPCs;
              document.getElementById('statAvailablePCs').textContent = data.statistics.availablePCs;
              document.getElementById('statAssignedStudents').textContent = data.statistics.assignedStudents;
              document.getElementById('statUnassignedStudents').textContent = data.statistics.unassignedStudents;

              const escapeSeatingText = (value) => String(value ?? '')
                .replaceAll('&', '&amp;')
                .replaceAll('<', '&lt;')
                .replaceAll('>', '&gt;')
                .replaceAll('"', '&quot;')
                .replaceAll("'", '&#039;');

              // Render PC grid
              const pcGrid = document.getElementById('pcSeatingGrid');
              const orderedStations = [...data.seatingChart].sort((a, b) =>
                String(a.setName || a.setId || '').localeCompare(
                  String(b.setName || b.setId || ''),
                  undefined,
                  { numeric: true, sensitivity: 'base' }
                ) || String(a.setId || '').localeCompare(String(b.setId || ''), undefined, { numeric: true })
              );
              pcGrid.innerHTML = orderedStations.map(pc => {
                const isOccupied = pc.status === 'occupied';
                const bgClass = isOccupied ? 'bg-emerald-500/20 border-emerald-500/40' : 'bg-slate-700/30 border-slate-600/40';
                const iconClass = isOccupied ? 'text-emerald-400' : 'text-slate-400';
                const studentName = escapeSeatingText(pc.student?.fullName || 'Student name unavailable');
                const stationName = escapeSeatingText(pc.setName || pc.setId || 'PC station');
                const startTime = pc.student?.startTime && !Number.isNaN(new Date(pc.student.startTime).getTime())
                  ? new Date(pc.student.startTime).toLocaleTimeString()
                  : 'Time unavailable';
                
                return `
                  <div class="pc-seat-item ${bgClass} rounded-xl border p-4 transition-shadow hover:shadow-lg">
                    <div class="flex items-center justify-between mb-2">
                      <div class="min-w-0">
                        <p class="text-xs font-bold text-white break-words">${stationName}</p>
                        <p class="text-[10px] text-slate-400">${escapeSeatingText(pc.setId)}</p>
                      </div>
                      <i class="fas fa-desktop ${iconClass}"></i>
                    </div>
                    ${isOccupied ? `
                      <div class="mt-2">
                        <p class="text-sm font-semibold text-white break-words">${studentName}</p>
                        <p class="text-xs text-slate-300 mt-1">Since ${startTime}</p>
                        <span class="inline-block mt-2 px-2 py-0.5 text-xs font-medium rounded-full ${pc.student.isActive ? 'bg-green-500/20 text-green-300 border border-green-500/30' : 'bg-slate-500/20 text-slate-300 border border-slate-500/30'}">
                          ${pc.student.isActive ? 'Active' : 'Ended'}
                        </span>
                        ${pc.student.attendanceStatus ? '<p class="mt-1 text-xs font-semibold ' + (pc.student.attendanceStatus === 'Late' ? 'text-amber-300' : 'text-emerald-300') + '">Attendance: ' + escapeSeatingText(pc.student.attendanceStatus) + '</p>' : ''}
                      </div>
                    ` : `
                      <p class="text-xs text-slate-400 mt-2">No student assigned</p>
                    `}
                  </div>
                `;
              }).join('');

              // Render unassigned students list
              const unassignedList = document.getElementById('unassignedStudentsList');
              if (data.unassignedStudents.length === 0) {
                unassignedList.innerHTML = '<p class="text-sm text-slate-400 italic">All students are assigned to a PC station.</p>';
              } else {
                unassignedList.innerHTML = data.unassignedStudents.map(student => `
                  <div class="flex items-center gap-3 p-3 rounded-lg bg-slate-800/40 border border-slate-700/40">
                    <div class="w-8 h-8 rounded-full bg-red-500/20 border border-red-500/40 flex items-center justify-center">
                      <i class="fas fa-user text-red-400 text-xs"></i>
                    </div>
                    <div class="flex-1">
                        <p class="text-sm font-medium text-white">${escapeSeatingText(student.fullName)}</p>
                        <p class="text-xs text-slate-400">${escapeSeatingText(student.email)}</p>
                    </div>
                  </div>
                `).join('');
              }

              loadingDiv.classList.add('hidden');
              contentDiv.classList.remove('hidden');

            } catch (error) {
              console.error('Error loading seating chart:', error);
              loadingDiv.classList.add('hidden');
              errorDiv.classList.remove('hidden');
              document.getElementById('seatingChartErrorMessage').textContent = error.message || 'Failed to load seating chart';
            }
          };

          window.closeSeatingChartModal = function() {
            const modal = document.getElementById('seatingChartModal');
            if (modal) {
              modal.classList.add('hidden');
              modal.classList.remove('flex');
            }
            document.querySelector('body.app-shell .main-container')?.classList.remove('seating-chart-open');
          };
