(function(){
  const fmtDate = (d)=>{ if(!d) return '-'; const dt=new Date(d); return dt.toLocaleString(); };
  let allSessions = [];
  let activeSearchText = '';
  let activeCampusFilter = '';
  let activeLabFilter = '';
  let activeDateFilter = '';

  // Get today's date in local timezone as YYYY-MM-DD
  function getTodayLocal(){
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth()+1).padStart(2,'0');
    const d = String(now.getDate()).padStart(2,'0');
    return `${y}-${m}-${d}`;
  }

  async function fetchSessions(){
    const tbody = document.getElementById('attendanceMonitorTableBody');
    try {
      const res = await fetch('/api/instructor/attendance-dashboard', { cache: 'no-store' });
      if(!res.ok) throw new Error(`Attendance request failed (${res.status})`);
      const data = await res.json();
      const sessions = Array.isArray(data.sessions) ? data.sessions : [];
      syncCampusFilter(sessions);
      renderSessions(sessions.map((item) => ({
        ...item,
        laboratoryRoom: item.laboratory || item.laboratoryRoom || '',
        createdAt: item.date || item.createdAt,
        present: item.studentsPresent ?? item.present ?? 0,
        late: item.studentsLate ?? item.late ?? 0,
        absent: item.studentsAbsent ?? item.absent ?? 0
      })));
    } catch(error) {
      console.error('Failed to load attendance sessions', error);
      if(tbody) tbody.innerHTML = '<tr><td colspan="7" class="text-center text-rose-300" style="padding:2rem;">Unable to load attendance sessions. Please refresh the page and try again.</td></tr>';
    }
  }

  function syncCampusFilter(items){
    const campusFilter = document.getElementById('attendanceCampusFilter');
    if(!campusFilter) return;
    const selectedCampus = campusFilter.value;
    const campuses = [...new Set((Array.isArray(items) ? items : [])
      .map((item) => String(item.campus || '').trim())
      .filter(Boolean))];
    campusFilter.replaceChildren(new Option('All Campuses', ''));
    campuses.sort((a, b) => a.localeCompare(b)).forEach((campus) => campusFilter.add(new Option(campus, campus)));
    campusFilter.value = campuses.includes(selectedCampus) ? selectedCampus : '';
  }

  function getFilteredSessions(items){
    const query = activeSearchText.trim().toLowerCase();
    let filtered = Array.isArray(items) ? items : [];
    if(query){
      filtered = filtered.filter((it) => {
        const haystack = [it.subject, it.laboratoryRoom, it.instructor, it.time].filter(Boolean).join(' ').toLowerCase();
        return haystack.includes(query);
      });
    }
    if(activeCampusFilter){
      filtered = filtered.filter((it) => (it.campus || '') === activeCampusFilter);
    }
    if(activeLabFilter){
      filtered = filtered.filter((it) => (it.laboratoryRoom || '') === activeLabFilter);
    }
    if(activeDateFilter){
      filtered = filtered.filter((it) => {
        if(!it.createdAt) return false;
        const sessionDate = new Date(it.createdAt).toISOString().split('T')[0];
        return sessionDate === activeDateFilter;
      });
    }
    return filtered;
  }

  function renderPaginationControls(rows){
    const paginationContainer = document.getElementById('attendancePagination');
    const paginationInfo = document.getElementById('attendancePaginationInfo');
    if(!paginationContainer) return;
    if(paginationInfo){
      paginationInfo.textContent = rows?.length
        ? `Showing all ${rows.length} sessions • up to 10 visible at a time`
        : 'Showing 0 sessions';
    }
    paginationContainer.innerHTML = '';
  }

  function renderSessions(items){
    const tbody = document.getElementById('attendanceMonitorTableBody');
    const totalEl = document.getElementById('totalSessionsValue');
    const presentEl = document.getElementById('presentTodayValue');
    const absentEl = document.getElementById('absentTodayValue');
    const lateEl = document.getElementById('lateTodayValue');
    if(!tbody) return;

    allSessions = Array.isArray(items) ? items : [];
    const filtered = getFilteredSessions(allSessions);

    tbody.innerHTML = '';

    // Stats: only count TODAY's sessions to avoid inflated all-time numbers
    const today = getTodayLocal();
    let total = 0, present = 0, absent = 0, late = 0;
    allSessions.forEach((it) => {
      const sessionDate = it.createdAt ? new Date(it.createdAt).toISOString().split('T')[0] : null;
      if(sessionDate === today){
        total++;
        present += it.present || 0;
        absent  += it.absent  || 0;
        late    += it.late    || 0;
      }
    });

    if(!filtered.length){
      tbody.innerHTML = '<tr><td colspan="7" class="text-center text-slate-400" style="padding:2rem;">No attendance sessions match your filters.</td></tr>';
    } else {
      filtered.forEach((it) => {
        const tr = document.createElement('tr');
        const totalCount = (it.present||0) + (it.late||0) + (it.absent||0);
        tr.innerHTML = `
          <td class="px-4 py-3 font-medium text-white">${escapeHtml(it.subject||'—')}</td>
          <td class="px-4 py-3 text-slate-300">${escapeHtml(it.laboratoryRoom||'—')}</td>
          <td class="px-4 py-3 text-slate-300">${escapeHtml(it.instructor||'—')}</td>
          <td class="px-4 py-3 text-slate-400 text-sm">${fmtDate(it.createdAt)}</td>
          <td class="px-4 py-3 text-slate-300">${escapeHtml(it.time||'—')}</td>
          <td class="px-4 py-3">
            <div style="display:flex;flex-direction:column;gap:0.2rem;">
              <div style="font-size:0.875rem;font-weight:600;color:#fff;">${totalCount} student${totalCount===1?'':'s'}</div>
              <div style="font-size:0.75rem;display:flex;gap:0.5rem;">
                <span style="color:rgb(52 211 153);">P:${it.present||0}</span>
                <span style="color:rgb(251 191 36);">L:${it.late||0}</span>
                <span style="color:rgb(248 113 113);">A:${it.absent||0}</span>
              </div>
            </div>
          </td>
          <td class="px-4 py-3">
            <button class="attendance-action-btn view-attendance" data-id="${it.scheduleId || it.id}" data-session-id="${it.id}" style="white-space:nowrap;">
              <i class="fas fa-eye" style="margin-right:0.35rem;"></i>View Attendance
            </button>
          </td>
        `;
        tbody.appendChild(tr);
      });
    }

    if(totalEl) totalEl.textContent = total;
    if(presentEl) presentEl.textContent = present;
    if(absentEl) absentEl.textContent = absent;
    if(lateEl) lateEl.textContent = late;

    renderPaginationControls(filtered);

    document.querySelectorAll('.view-attendance').forEach((btn) => {
      btn.addEventListener('click', () => openAttendanceSessionModal(btn.dataset.id, btn.dataset.sessionId));
    });
  }

  function escapeHtml(s){ return String(s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":"&#39;"})[c]); }

  async function openAttendanceSessionModal(id, sessionId){
    const modal   = document.getElementById('attendanceSessionModal');
    const content = document.getElementById('attendanceSessionModalContent');
    const title   = document.getElementById('attendanceSessionModalTitle');
    const subtitle= document.getElementById('attendanceSessionModalSubtitle');
    if(!modal || !content) return;

    // Show modal with loading state
    modal.classList.remove('hidden');
    try{ document.body.classList.add('modal-open'); }catch(e){}
    if(title)   title.textContent   = 'Loading...';
    if(subtitle) subtitle.textContent = '';
    content.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:center;padding:3rem;gap:1rem;">
        <i class="fas fa-spinner fa-spin" style="font-size:2rem;color:rgb(74 222 128);"></i>
        <span style="color:rgb(148 163 184);">Loading attendance details...</span>
      </div>`;

    try{
      const sessionQuery = sessionId ? '?sessionId=' + encodeURIComponent(sessionId) : '';
      const res = await fetch('/api/attendance-sessions/' + encodeURIComponent(id) + sessionQuery);
      if(!res.ok) throw new Error('Failed to load');
      const data = await res.json();
      const sched = data.schedule || {};
      const s = data.summary || { total:0, present:0, absent:0, late:0 };
      const rows = data.rows || [];

      // Counts from actual scanned rows
      const scannedRows   = rows.filter(r => ['Present','Late','Absent'].includes(r.status));
      const presentCount  = rows.filter(r => r.status === 'Present').length;
      const lateCount     = rows.filter(r => r.status === 'Late').length;
      const absentCount   = rows.filter(r => r.status === 'Absent').length;
      const totalScanned  = scannedRows.length;
      const pct = totalScanned ? Math.round((presentCount / totalScanned) * 100) : 0;

      if(title)    title.textContent    = sched.subject || 'Attendance Details';
      if(subtitle) subtitle.textContent = [sched.laboratoryRoom, sched.instructor].filter(Boolean).join(' • ');

      // --- Header stat cards (go into sticky header area) ---
      const headerExtrasEl = document.getElementById('attendanceSessionModalHeaderExtras');
      if(headerExtrasEl){
        headerExtrasEl.innerHTML = `
          <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:0.75rem;margin-top:0.75rem;">
            ${statCard('Total Scanned', totalScanned,  'rgba(99,102,241,.25)',  'rgba(99,102,241,.5)',  'fa-users')}
            ${statCard('Present',       presentCount,  'rgba(34,197,94,.2)',    'rgba(34,197,94,.5)',   'fa-check-circle')}
            ${statCard('Absent',        absentCount,   'rgba(239,68,68,.2)',    'rgba(239,68,68,.5)',   'fa-times-circle')}
            ${statCard('Late',          lateCount,     'rgba(234,179,8,.2)',    'rgba(234,179,8,.5)',   'fa-clock')}
          </div>`;
      }

      // --- Session info bar ---
      const sessionInfo = `
        <div style="display:flex;flex-wrap:wrap;gap:0.75rem;padding:0.875rem 1rem;border-radius:0.75rem;background:rgba(7,17,31,.6);border:1px solid rgba(74,222,128,.15);margin-bottom:0.25rem;">
          ${infoChip('fa-book-open',        sched.subject    || '—')}
          ${infoChip('fa-chalkboard-teacher', sched.instructor || '—')}
          ${infoChip('fa-flask',             sched.laboratoryRoom || '—')}
          ${infoChip('fa-clock',             [sched.startTime, sched.endTime].filter(Boolean).join(' – ') || '—')}
          ${infoChip('fa-calendar-alt',      sched.createdAt ? new Date(sched.createdAt).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}) : '—')}
          <span style="margin-left:auto;display:flex;align-items:center;gap:0.4rem;font-size:0.75rem;color:rgb(74,222,128);font-weight:600;">
            <i class="fas fa-chart-bar"></i>${pct}% attendance rate
          </span>
        </div>`;

      // --- Search + export controls ---
      const controls = `
        <div style="display:flex;flex-wrap:wrap;gap:0.75rem;align-items:center;">
          <input id="attendanceDetailSearch"
            placeholder="Search student ID or name…"
            style="flex:1;min-width:12rem;padding:0.5rem 0.875rem;border-radius:0.625rem;background:rgba(7,17,31,.7);border:1px solid rgba(74,222,128,.2);color:#f0fdf4;font-size:0.875rem;outline:none;" />
          <button id="exportExcelBtn"
            style="display:inline-flex;align-items:center;gap:0.4rem;padding:0.5rem 1rem;border-radius:0.625rem;background:rgba(34,197,94,.15);border:1px solid rgba(34,197,94,.3);color:rgb(74,222,128);font-size:0.875rem;font-weight:600;cursor:pointer;transition:background .2s;">
            <i class="fas fa-file-excel"></i>Excel
          </button>
          <button id="exportPdfBtn"
            style="display:inline-flex;align-items:center;gap:0.4rem;padding:0.5rem 1rem;border-radius:0.625rem;background:rgba(239,68,68,.12);border:1px solid rgba(239,68,68,.3);color:rgb(248,113,113);font-size:0.875rem;font-weight:600;cursor:pointer;transition:background .2s;">
            <i class="fas fa-file-pdf"></i>PDF
          </button>
        </div>`;

      // --- Student table ---
      const tableRows = rows.map(r => {
        const st = r.status || 'Not Yet Recorded';
        const stConfig = {
          'Present':          { bg:'rgba(34,197,94,.15)',   color:'rgb(74,222,128)',   icon:'fa-check-circle' },
          'Late':             { bg:'rgba(234,179,8,.15)',   color:'rgb(251,191,36)',   icon:'fa-clock' },
          'Absent':           { bg:'rgba(239,68,68,.15)',   color:'rgb(248,113,113)',  icon:'fa-times-circle' },
          'Not Yet Recorded': { bg:'rgba(100,116,139,.15)', color:'rgb(148,163,184)',  icon:'fa-minus-circle' },
          'Requires Review':  { bg:'rgba(168,85,247,.15)',  color:'rgb(216,180,254)',  icon:'fa-exclamation-circle' },
        };
        const cfg = stConfig[st] || stConfig['Not Yet Recorded'];
        const timeIn = r.timeIn || '—';
        return `
          <tr style="border-bottom:1px solid rgba(74,222,128,.07);transition:background .15s;" onmouseover="this.style.background='rgba(34,197,94,.05)'" onmouseout="this.style.background=''">
            <td class="px-4 py-3" style="color:rgb(148,163,184);font-size:0.8125rem;">${escapeHtml(r.studentId||'—')}</td>
            <td class="px-4 py-3 attendance-student-name" style="color:#f0fdf4;font-weight:500;">${escapeHtml(r.fullName||'—')}</td>
            <td class="px-4 py-3">
              <span style="display:inline-flex;align-items:center;gap:0.35rem;padding:0.25rem 0.75rem;border-radius:9999px;font-size:0.75rem;font-weight:600;background:${cfg.bg};color:${cfg.color};">
                <i class="fas ${cfg.icon}" style="font-size:0.6875rem;"></i>${escapeHtml(st)}
              </span>
            </td>
            <td class="px-4 py-3" style="color:rgb(148,163,184);font-size:0.8125rem;">${escapeHtml(timeIn)}</td>
          </tr>`;
      }).join('');

      const tableHtml = `
        <div style="border-radius:0.875rem;overflow:hidden;border:1px solid rgba(74,222,128,.15);">
          <div style="overflow-x:auto;">
            <table style="width:100%;border-collapse:collapse;">
              <thead>
                <tr style="background:linear-gradient(180deg,rgba(7,17,31,.98),rgba(2,6,23,.98));border-bottom:1px solid rgba(74,222,128,.2);">
                  <th class="px-4 py-3" style="text-align:left;font-size:0.75rem;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:rgba(167,243,208,.7);">Student ID</th>
                  <th class="px-4 py-3" style="text-align:left;font-size:0.75rem;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:rgba(167,243,208,.7);">Full Name</th>
                  <th class="px-4 py-3" style="text-align:left;font-size:0.75rem;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:rgba(167,243,208,.7);">Status</th>
                  <th class="px-4 py-3" style="text-align:left;font-size:0.75rem;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:rgba(167,243,208,.7);">Time In</th>
                </tr>
              </thead>
              <tbody id="attendanceDetailTableBody">
                ${tableRows || `<tr><td colspan="4" style="padding:2.5rem;text-align:center;color:rgb(100,116,139);">
                  <i class="fas fa-user-slash" style="font-size:2rem;margin-bottom:0.5rem;display:block;"></i>No attendance records yet.
                </td></tr>`}
              </tbody>
            </table>
          </div>
        </div>`;

      content.innerHTML = `<div style="display:flex;flex-direction:column;gap:1rem;">${sessionInfo}${controls}${tableHtml}</div>`;

      // Search handler
      document.getElementById('attendanceDetailSearch').addEventListener('input', (e) => {
        const q = e.target.value.toLowerCase();
        document.querySelectorAll('#attendanceDetailTableBody tr').forEach(tr => {
          tr.style.display = tr.textContent.toLowerCase().includes(q) ? '' : 'none';
        });
      });

      // Export Excel
      document.getElementById('exportExcelBtn').addEventListener('click', async () => {
        if(!rows.length) return alert('No records to export.');
        try{
          const params = new URLSearchParams({ format: 'excel' });
          if(sessionId) params.set('sessionId', sessionId);
          const resp = await fetch('/api/attendance-sessions/' + encodeURIComponent(id) + '?' + params.toString(), { credentials:'same-origin' });
          if(!resp.ok) throw new Error('Failed');
          const blob = await resp.blob();
          const url  = window.URL.createObjectURL(blob);
          const a    = document.createElement('a');
          a.href = url; a.download = 'Attendance_Report.xlsx';
          document.body.appendChild(a); a.click(); a.remove();
          window.URL.revokeObjectURL(url);
        }catch(err){ console.error(err); alert('Failed to export Excel.'); }
      });

      // Export PDF
      document.getElementById('exportPdfBtn').addEventListener('click', async () => {
        if(!rows.length) return alert('No records to export.');
        try{
          const loadScript = (src) => new Promise((resolve, reject) => {
            if(document.querySelector(`script[src="${src}"]`)) return resolve();
            const s = document.createElement('script'); s.src = src; s.async = true;
            s.onload = resolve; s.onerror = () => reject(new Error('Failed to load ' + src));
            document.head.appendChild(s);
          });
          if(!window.jspdf) await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js');
          if(!window.jspdf?.autoTable) await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.5.25/jspdf.plugin.autotable.min.js');
          const { jsPDF } = window.jspdf;
          const doc = new jsPDF({ orientation:'portrait', unit:'pt', format:'a4' });
          const m = 40;
          doc.setFontSize(14); doc.text('Mindoro State University - ComLab', m, 50);
          doc.setFontSize(12); doc.text('Subject: '    + (sched.subject    || ''), m,  70);
          doc.text('Instructor: ' + (sched.instructor  || ''), m,  88);
          doc.text('Laboratory: ' + (sched.laboratoryRoom||''), m, 106);
          doc.text('Date: '       + (sched.createdAt ? new Date(sched.createdAt).toLocaleString() : ''), m, 124);
          doc.setFontSize(11);
          doc.text(`Present: ${presentCount}   Late: ${lateCount}   Absent: ${absentCount}`, m, 148);
          doc.autoTable({
            startY: 165,
            head: [['Student ID','Full Name','Status','Time In']],
            body: rows.map(r => [r.studentId||'—', r.fullName||'—', r.status||'—', r.timeIn||'—']),
            styles: { fontSize:10 },
            headStyles: { fillColor:[30,64,60] }
          });
          doc.save('Attendance_Report.pdf');
        }catch(err){ console.error(err); alert('Failed to export PDF.'); }
      });

    }catch(err){
      content.innerHTML = `<div style="text-align:center;padding:3rem;color:rgb(248,113,113);">
        <i class="fas fa-exclamation-triangle" style="font-size:2rem;margin-bottom:0.5rem;display:block;"></i>
        Failed to load attendance details.
      </div>`;
      console.error(err);
    }
  }

  // Stat card helper for modal header
  function statCard(label, value, bg, border, icon){
    return `
      <div style="padding:0.875rem 1rem;border-radius:0.75rem;background:${bg};border:1px solid ${border};">
        <div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.35rem;">
          <i class="fas ${icon}" style="font-size:0.875rem;color:inherit;opacity:.8;"></i>
          <span style="font-size:0.6875rem;font-weight:600;text-transform:uppercase;letter-spacing:.06em;opacity:.75;">${escapeHtml(label)}</span>
        </div>
        <div style="font-size:2rem;font-weight:700;color:#fff;line-height:1;">${escapeHtml(String(value))}</div>
      </div>`;
  }

  // Info chip helper
  function infoChip(icon, text){
    return `<span style="display:inline-flex;align-items:center;gap:0.35rem;font-size:0.8125rem;color:rgb(167,243,208);">
      <i class="fas ${icon}" style="font-size:0.75rem;opacity:.6;"></i>${escapeHtml(text)}
    </span>`;
  }

  function closeAttendanceSessionModal(){
    const modal = document.getElementById('attendanceSessionModal');
    if(modal) modal.classList.add('hidden');
    try{ document.body.classList.remove('modal-open'); }catch(e){}
    // Clear header extras
    const headerExtrasEl = document.getElementById('attendanceSessionModalHeaderExtras');
    if(headerExtrasEl) headerExtrasEl.innerHTML = '';
  }
  window.closeAttendanceSessionModal = closeAttendanceSessionModal;

  function filterAttendanceTable(){
    renderSessions(allSessions);
  }

  document.addEventListener('DOMContentLoaded', () => {
    fetchSessions();

    const searchInput = document.getElementById('attendanceSearch');
    if(searchInput) searchInput.addEventListener('input', (e) => { activeSearchText = e.target.value; filterAttendanceTable(); });

    const campusFilter = document.getElementById('attendanceCampusFilter');
    if(campusFilter) campusFilter.addEventListener('change', (e) => { activeCampusFilter = e.target.value; filterAttendanceTable(); });

    const labFilter = document.getElementById('attendanceLabFilter');
    if(labFilter) labFilter.addEventListener('change', (e) => { activeLabFilter = e.target.value; filterAttendanceTable(); });

    const dateFilter = document.getElementById('attendanceDateFilter');
    if(dateFilter) dateFilter.addEventListener('change', (e) => { activeDateFilter = e.target.value; filterAttendanceTable(); });
  });
})();
