// PC Sets Table with Expandable Rows - Integrated Equipment Inventory

const PC_SETS_ROWS_PER_PAGE = 8;
let currentPCSetsPage = 1;
let currentPCSetRows = [];
let currentPCSetUnassigned = {};
let activePCSetActionsMenu = null;
let activePCSetActionsTrigger = null;

function escapePCSetHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (character) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[character]);
}

function closePCSetActionsMenu() {
    activePCSetActionsMenu?.remove();
    activePCSetActionsMenu = null;
    activePCSetActionsTrigger?.setAttribute('aria-expanded', 'false');
    activePCSetActionsTrigger = null;
}

function togglePCSetActions(event, setId, componentCount) {
    event.preventDefault();
    event.stopPropagation();

    if (activePCSetActionsMenu?.dataset.setId === setId) {
        closePCSetActionsMenu();
        return;
    }

    closePCSetActionsMenu();

    const trigger = event.currentTarget;
    const menu = document.createElement('div');
    menu.className = 'pc-set-actions-menu';
    menu.dataset.setId = setId;

    const actions = [
        { label: 'Edit PC Set', icon: 'fa-edit', run: () => editPCSetInline(setId) },
    ];
    if (String(window.__CURRENT_USER__?.role || '').toLowerCase().includes('admin')) {
        actions.push({ label: 'Archive PC Set', icon: 'fa-box-archive', run: () => archivePCSetInline(setId, componentCount) });
    }

    actions.forEach(({ label, icon, danger, run }) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = danger ? 'danger' : '';
        button.innerHTML = `<i class="fas ${icon}" aria-hidden="true"></i><span></span>`;
        button.querySelector('span').textContent = label;
        button.addEventListener('click', () => {
            closePCSetActionsMenu();
            run();
        });
        menu.appendChild(button);
    });

    document.body.appendChild(menu);
    activePCSetActionsMenu = menu;
    activePCSetActionsTrigger = trigger;
    trigger.setAttribute('aria-expanded', 'true');

    const menuRect = menu.getBoundingClientRect();
    const triggerRect = trigger.getBoundingClientRect();
    const left = Math.max(8, Math.min(triggerRect.right - menuRect.width, window.innerWidth - menuRect.width - 8));
    const top = triggerRect.bottom + menuRect.height + 8 <= window.innerHeight
        ? triggerRect.bottom + 6
        : Math.max(8, triggerRect.top - menuRect.height - 6);
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
}

document.addEventListener('click', (event) => {
    if (activePCSetActionsMenu && !activePCSetActionsMenu.contains(event.target)) {
        closePCSetActionsMenu();
    }
});

document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closePCSetActionsMenu();
});

window.addEventListener('resize', closePCSetActionsMenu);
window.addEventListener('scroll', closePCSetActionsMenu, true);

async function openPCStationQr(setId) {
    const modal = document.createElement('div');
    modal.className = 'modal show';
    modal.innerHTML = `
        <div class="modal-content mx-auto w-full max-w-md text-center">
            <div class="mb-3 flex items-center justify-between">
                <h3 class="text-xl font-bold text-white">PC Station Login QR</h3>
                <button type="button" class="close-pc-station-qr text-2xl text-emerald-400" aria-label="Close">&times;</button>
            </div>
            <p class="pc-station-qr-status text-sm text-emerald-200">Generating QR code…</p>
        </div>`;
    document.body.appendChild(modal);
    modal.querySelector('.close-pc-station-qr').addEventListener('click', () => modal.remove());

    try {
        const response = await fetch(`/api/pc-stations/${encodeURIComponent(setId)}/qr`, { cache: 'no-store' });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || !payload.success) {
            throw new Error(payload.error || 'Unable to generate station QR code.');
        }

        const stationName = payload.station?.setName || payload.station?.setId || setId;
        const safeName = escapePCSetHtml(stationName);
        const safeSetId = escapePCSetHtml(payload.station?.setId || setId);
        const safeUrl = escapePCSetHtml(payload.url || '');
        const safeQr = escapePCSetHtml(payload.qrCode || '');
        const fileName = String(payload.station?.setId || setId).replace(/[^a-z0-9_-]+/gi, '-');
        modal.querySelector('.modal-content').innerHTML = `
            <div class="mb-3 flex items-center justify-between">
                <h3 class="text-xl font-bold text-white">PC Station Login QR</h3>
                <button type="button" class="close-pc-station-qr text-2xl text-emerald-400" aria-label="Close">&times;</button>
            </div>
            <p class="mb-1 font-semibold text-emerald-200">${safeName}</p>
            <p class="mb-4 text-xs text-emerald-200/70">${safeSetId}</p>
            <img class="mx-auto mb-4 h-64 w-64 rounded bg-white p-2" src="${safeQr}" alt="Login and logout QR code for ${safeName}">
            <p class="mb-4 break-all text-xs text-emerald-200/70">${safeUrl}</p>
            <div class="flex justify-center gap-2">
                <a class="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white" href="${safeQr}" download="${escapePCSetHtml(fileName)}-station-qr.png">Download QR</a>
                <button type="button" class="print-pc-station-qr rounded-lg border border-emerald-700 px-4 py-2 text-sm font-semibold text-emerald-200">Print QR</button>
            </div>`;
        modal.querySelector('.close-pc-station-qr').addEventListener('click', () => modal.remove());
        modal.querySelector('.print-pc-station-qr').addEventListener('click', () => {
            const printWindow = window.open('', '_blank');
            if (!printWindow) {
                alert('Allow pop-ups to print the PC station QR code.');
                return;
            }
            printWindow.onload = () => printWindow.print();
            printWindow.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${safeSetId} PC Station QR</title><style>
                *{box-sizing:border-box}
                @page{size:4in 5.5in;margin:0.2in}
                body{font-family:Arial,sans-serif;text-align:center;color:#111;margin:0;padding:0.15in}
                .sticker{width:100%;border:2px solid #111;border-radius:12px;padding:0.18in}
                .name{font-size:20pt;font-weight:700;margin:0 0 0.12in}
                .set-label{font-size:10pt;font-weight:700;letter-spacing:.12em;text-transform:uppercase;margin:0}
                .set-id{font-size:24pt;font-weight:800;margin:0.04in 0 0.12in;overflow-wrap:anywhere}
                img{display:block;width:3.35in;height:3.35in;object-fit:contain;margin:0 auto}
                .instruction{font-size:10pt;font-weight:600;margin:0.12in 0 0}
                @media print{body{print-color-adjust:exact;-webkit-print-color-adjust:exact}}
            </style></head><body><main class="sticker"><h1 class="name">${safeName}</h1><p class="set-label">PC Set Number</p><p class="set-id">${safeSetId}</p><img src="${safeQr}" alt="PC station login and logout QR"><p class="instruction">Scan to sign in or out</p></main></body></html>`);
            printWindow.document.close();
            printWindow.focus();
        });
    } catch (error) {
        console.error('Failed to generate PC station QR:', error);
        const status = modal.querySelector('.pc-station-qr-status');
        if (status) status.textContent = error.message || 'Unable to generate station QR code.';
    }
}

function getCategoryIcon(component) {
    if (!component) return 'fas fa-cube';
    const comp = String(component).toLowerCase();
    if (comp.includes('system unit') || comp.includes('cpu')) return 'fas fa-microchip';
    if (comp.includes('monitor')) return 'fas fa-desktop';
    if (comp.includes('keyboard')) return 'fas fa-keyboard';
    if (comp.includes('mouse')) return 'fas fa-mouse';
    if (comp.includes('avr')) return 'fas fa-plug';
    return 'fas fa-cube';
}

async function loadPCSetsTable() {
    try {
        const response = await fetch('/api/equipment-sets');
        const data = await response.json().catch(() => ({}));
        const selectedCampus = document.getElementById('campusFilter')?.value || '';
        const normalizeCampus = (value) => String(value || '').trim().replace(/\s*Campus\s*$/i, '').toLowerCase();
        const scopeToSelectedCampus = (sets) => selectedCampus
            ? sets.filter((set) => normalizeCampus(set.campus) === normalizeCampus(selectedCampus))
            : sets;

        if (response.ok && data.success) {
            currentPCSetsPage = 1;
            renderPCSetsTable(scopeToSelectedCampus(Array.isArray(data.sets) ? data.sets : []), data.unassigned || {});
            window.refreshInventorySummaryCards?.();
            return;
        }

        // Older databases may not have the equipment_sets table yet. Build the
        // same view from equipment assignments so the inventory filter remains usable.
        const fallbackResponse = await fetch('/api/equipment/pc-sets');
        if (!fallbackResponse.ok) throw new Error('Failed to fetch PC sets');

        const fallbackSets = await fallbackResponse.json();
        currentPCSetsPage = 1;
        renderPCSetsTable(scopeToSelectedCampus((Array.isArray(fallbackSets) ? fallbackSets : []).map((set) => ({
            ...set,
            setName: set.setName || set.setId,
            location: set.location || set.campus || '',
            componentCount: Array.isArray(set.components) ? set.components.length : 0,
            serviceableCount: 0,
            missingCount: 0,
            unserviceableCount: 0,
            underMaintenanceCount: 0
        }))));
        window.refreshInventorySummaryCards?.();
    } catch (error) {
        console.error('Error loading PC sets:', error);
        currentPCSetsPage = 1;
        renderPCSetsTable([]);
    }
}

function goToPCSetPage(page) {
    const totalPages = Math.max(1, Math.ceil(currentPCSetRows.length / PC_SETS_ROWS_PER_PAGE));
    const requestedPage = Number(page);
    if (!Number.isInteger(requestedPage) || requestedPage < 1 || requestedPage > totalPages) return;

    currentPCSetsPage = requestedPage;
    renderPCSetsTable(currentPCSetRows, currentPCSetUnassigned);
}

function renderPCSetsTable(sets, unassigned = {}) {
    closePCSetActionsMenu();
    const thead = document.getElementById('tableHeaderRow');
    const tbody = document.getElementById('equipmentTable');
    const pagination = document.getElementById('equipmentPagination');
    const paginationInfo = document.getElementById('equipmentPaginationInfo');
    document.getElementById('equipmentTableSection')?.classList.add('pc-sets-view');

    currentPCSetRows = Array.isArray(sets) ? sets : [];
    currentPCSetUnassigned = unassigned || {};
    const totalPages = Math.max(1, Math.ceil(currentPCSetRows.length / PC_SETS_ROWS_PER_PAGE));
    currentPCSetsPage = Math.min(currentPCSetsPage, totalPages);
    const startIndex = currentPCSetRows.length ? (currentPCSetsPage - 1) * PC_SETS_ROWS_PER_PAGE : 0;
    const pageSets = currentPCSetRows.slice(startIndex, startIndex + PC_SETS_ROWS_PER_PAGE);

    if (paginationInfo) {
        paginationInfo.hidden = true;
        const firstItem = currentPCSetRows.length ? startIndex + 1 : 0;
        const lastItem = Math.min(startIndex + PC_SETS_ROWS_PER_PAGE, currentPCSetRows.length);
        paginationInfo.textContent = currentPCSetRows.length
            ? `Showing ${firstItem}-${lastItem} of ${currentPCSetRows.length} PC stations`
            : 'Showing 0 of 0 PC stations';
    }

    if (pagination) {
        if (!currentPCSetRows.length) {
            pagination.innerHTML = '';
        } else {
            const visiblePages = getVisiblePaginationItems(totalPages, currentPCSetsPage);
            const pageButtons = visiblePages.map((page) => {
                const isActive = page === currentPCSetsPage;
                return `<button type="button" onclick="goToPCSetPage(${page})" class="flex h-10 min-w-10 items-center justify-center rounded-lg border px-3 text-sm font-semibold transition ${isActive ? 'border-emerald-500 bg-emerald-600 text-white' : 'border-emerald-800/50 bg-emerald-950/40 text-emerald-200 hover:bg-emerald-900/60'}" ${isActive ? 'aria-current="page"' : ''} aria-label="Page ${page}">${page}</button>`;
            }).join('');
            pagination.innerHTML = `
                <button type="button" onclick="goToPCSetPage(${currentPCSetsPage - 1})" class="rounded-lg border border-emerald-800/50 bg-emerald-950/40 px-4 py-2 text-sm font-semibold text-emerald-200 transition hover:bg-emerald-900/60 disabled:cursor-not-allowed disabled:opacity-40" ${currentPCSetsPage === 1 ? 'disabled' : ''} aria-label="Previous page">PREV</button>
                ${pageButtons}
                <button type="button" onclick="goToPCSetPage(${currentPCSetsPage + 1})" class="rounded-lg border border-emerald-800/50 bg-emerald-950/40 px-4 py-2 text-sm font-semibold text-emerald-200 transition hover:bg-emerald-900/60 disabled:cursor-not-allowed disabled:opacity-40" ${currentPCSetsPage === totalPages ? 'disabled' : ''} aria-label="Next page">NEXT</button>
            `;
        }
    }

    // Update table headers for PC sets view
    thead.innerHTML = `
        <th class="px-3 py-3 text-left text-sm font-bold text-white uppercase" style="width: 40px;"></th>
        <th class="px-3 py-3 text-left text-sm font-bold text-white uppercase">PC Station ID</th>
        <th class="px-3 py-3 text-left text-sm font-bold text-white uppercase">Station Name</th>
        <th class="px-3 py-3 text-left text-sm font-bold text-white uppercase">Lab / Location</th>
        <th class="px-3 py-3 text-left text-sm font-bold text-white uppercase">Equipment Count</th>
        <th class="px-3 py-3 text-left text-sm font-bold text-white uppercase">Availability</th>
        <th class="px-3 py-3 text-left text-sm font-bold text-white uppercase">Actions</th>
    `;
    
    if (currentPCSetRows.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="7" class="px-5 py-8 text-center">
                    <div class="flex flex-col items-center gap-3">
                        <i class="fas fa-desktop text-4xl text-emerald-800"></i>
                        <p class="text-emerald-200">No PC sets found</p>
                        <button onclick="createNewPCSet()" class="btn-primary rounded-lg px-4 py-2 text-sm">
                            <i class="fas fa-plus mr-2"></i>Create PC Set
                        </button>
                    </div>
                </td>
            </tr>
        `;
        return;
    }
    
    tbody.innerHTML = pageSets.map((set) => {
        const statusMap = {
            'active':      { label: '✔ Ready to Use', style: 'background:rgba(34,197,94,.2);color:#bbf7d0;border:1px solid rgba(74,222,128,.5);' },
            'incomplete':  { label: '⚠ Missing Component', style: 'background:rgba(4,106,56,.24);color:#a7f3d0;border:1px solid rgba(74,222,128,.38);' },
            'maintenance': { label: '🔧 Under Maintenance', style: 'background:rgba(4,106,56,.32);color:#d1fae5;border:1px solid rgba(74,222,128,.42);' },
            'retired':     { label: '✕ Retired', style: 'background:rgba(4,106,56,.16);color:#86efac;border:1px solid rgba(74,222,128,.28);' },
        };
        const st = statusMap[set.status] || statusMap['incomplete'];
        const missing = Number(set.missingCount || 0);
        const total   = Number(set.componentCount || 0);

        return `
            <tr class="group hover:bg-emerald-950/30 transition-colors border-b border-emerald-900/20" data-set-id="${set.setId}">
                <td class="px-3 py-3">
                    <button onclick="togglePCSetExpand('${set.setId}')"
                            class="text-emerald-400 hover:text-emerald-300 transition-transform duration-200"
                            id="expand-btn-${set.setId}" title="Show / hide equipment">
                        <i class="fas fa-chevron-right"></i>
                    </button>
                </td>
                <td class="px-3 py-3">
                    <span class="font-mono text-white font-medium text-sm">${set.setId}</span>
                </td>
                <td class="px-3 py-3">
                    <div class="font-medium text-sm text-white">${set.setName}</div>
                    ${set.description ? `<div class="text-sm text-emerald-200/80">${set.description}</div>` : ''}
                </td>
                <td class="px-3 py-3 text-sm font-medium text-white">
                    ${set.location
                        ? `<span class="flex items-center gap-1"><i class="fas fa-map-marker-alt text-emerald-400 text-sm"></i>${set.location}</span>`
                        : '<span class="text-emerald-300/70 italic text-sm">Not specified</span>'}
                </td>
                <td class="px-3 py-3">
                    <div class="flex flex-wrap items-baseline gap-x-2">
                        <span class="text-sm text-white font-medium">${total} piece${total !== 1 ? 's' : ''}</span>
                        ${missing > 0
                            ? `<span class="text-sm font-medium text-white"><i class="fas fa-exclamation-triangle mr-1 text-emerald-400"></i>${missing} missing</span>`
                            : `<span class="text-sm font-medium text-white">All accounted for</span>`}
                    </div>
                </td>
                <td class="px-3 py-3">
                    <span class="inline-flex items-center rounded-full px-3 py-1 text-sm font-semibold" style="${st.style}">
                        ${st.label}
                    </span>
                </td>
                <td class="px-3 py-3">
                    <div class="flex items-center justify-start gap-2">
                        <button type="button"
                                data-pc-set-qr="${escapePCSetHtml(set.setId)}"
                                class="pc-set-qr-button bg-emerald-950/60 hover:bg-emerald-800 text-emerald-300 border border-emerald-600/40 p-2 rounded-lg"
                                title="View QR Log"
                                aria-label="View QR Log for ${escapePCSetHtml(set.setName || set.setId)}">
                            <i class="fas fa-qrcode" aria-hidden="true"></i>
                        </button>
                        <button type="button"
                                data-pc-set-actions="${escapePCSetHtml(set.setId)}"
                                data-component-count="${total}"
                                class="pc-set-actions-toggle"
                                title="PC station actions"
                                aria-label="Actions for ${escapePCSetHtml(set.setName || set.setId)}"
                                aria-haspopup="menu"
                                aria-expanded="false">
                            <i class="fas fa-ellipsis-h" aria-hidden="true"></i>
                        </button>
                    </div>
                </td>
            </tr>
            <tr id="expanded-${set.setId}" class="hidden bg-emerald-950/20">
                <td colspan="7" class="px-3 py-2">
                    <div class="pl-8">
                        <div class="flex items-center justify-between mb-2">
                            <div>
                                <h4 class="text-sm font-bold text-emerald-400 uppercase tracking-wide">
                                    <i class="fas fa-desktop mr-2"></i>${set.setName} — Equipment List
                                </h4>
                            </div>
                            <button onclick="addComponentsModal('${set.setId}')"
                                    class="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-500 transition-colors">
                                <i class="fas fa-plus mr-1"></i>Add Components
                            </button>
                        </div>
                        <div id="components-list-${set.setId}" class="space-y-1">
                            <div class="text-center text-emerald-200 py-2">
                                <i class="fas fa-spinner fa-spin mr-2"></i>Loading equipment list...
                            </div>
                        </div>
                    </div>
                </td>
            </tr>
        `;
    }).join('');

    tbody.querySelectorAll('[data-pc-set-actions]').forEach((button) => {
        button.addEventListener('click', (event) => {
            togglePCSetActions(event, button.dataset.pcSetActions, Number(button.dataset.componentCount));
        });
    });
    tbody.querySelectorAll('[data-pc-set-qr]').forEach((button) => {
        button.addEventListener('click', () => openPCStationQr(button.dataset.pcSetQr));
    });

}

async function togglePCSetExpand(setId) {
    const expandedRow = document.getElementById(`expanded-${setId}`);
    const expandBtn = document.getElementById(`expand-btn-${setId}`);
    const icon = expandBtn.querySelector('i');
    
    if (expandedRow.classList.contains('hidden')) {
        // Expand - load components
        expandedRow.classList.remove('hidden');
        icon.classList.remove('fa-chevron-right');
        icon.classList.add('fa-chevron-down');
        await loadPCSetComponents(setId);
    } else {
        // Collapse
        expandedRow.classList.add('hidden');
        icon.classList.remove('fa-chevron-down');
        icon.classList.add('fa-chevron-right');
    }
}

async function loadPCSetComponents(setId) {
    const container = document.getElementById(`components-list-${setId}`);
    
    try {
        const response = await fetch(`/api/equipment-sets/${setId}`);
        const data = await response.json();
        
        if (data.success && data.components) {
            if (data.components.length === 0) {
                container.innerHTML = `
                    <div class="text-center text-slate-500 py-6">
                        <i class="fas fa-inbox text-2xl mb-2 block"></i>
                        <p class="text-sm">No equipment added yet.</p>
                    </div>
                `;
            } else {
                const categoryCounts = data.components.reduce((counts, component) => {
                    const category = String(component.category || '').trim().toLowerCase();
                    if (category) counts.set(category, (counts.get(category) || 0) + 1);
                    return counts;
                }, new Map());
                container.innerHTML = `
                    <table class="pc-components-table" style="width:100%;border-collapse:collapse;">
                        <thead>
                            <tr style="border-bottom:1px solid rgba(74,222,128,.1);">
                                <th style="padding:3px 6px;text-align:left;font-size:0.62rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:rgba(100,180,130,.5);width:35%;">Equipment Name</th>
                                <th style="padding:3px 6px;text-align:left;font-size:0.62rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:rgba(100,180,130,.5);width:15%;">Type</th>
                                <th style="padding:3px 6px;text-align:left;font-size:0.62rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:rgba(100,180,130,.5);width:20%;">Serial Number</th>
                                <th style="padding:3px 6px;text-align:left;font-size:0.62rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:rgba(100,180,130,.5);width:18%;">Condition</th>
                                <th style="padding:3px 6px;width:12%;"></th>
                            </tr>
                        </thead>
                        <tbody>
                            ${data.components.map(comp => {
                                const icon = getCategoryIcon(comp.category);
                                const isMissing = comp.status === 'Missing';
                                const isUnderMaint = comp.status === 'Under Maintenance';
                                const hasDuplicateType = (categoryCounts.get(String(comp.category || '').trim().toLowerCase()) || 0) > 1;

                                const conditionBadge = isMissing
                                    ? `<span style="background:rgba(4,106,56,.24);color:#a7f3d0;padding:4px 9px;border-radius:999px;font-size:0.85rem;font-weight:700;">MISSING</span>`
                                    : isUnderMaint
                                        ? `<span style="background:rgba(4,106,56,.32);color:#d1fae5;padding:4px 9px;border-radius:999px;font-size:0.85rem;font-weight:700;">MAINTENANCE</span>`
                                        : `<span style="background:rgba(34,197,94,.15);color:#bbf7d0;padding:4px 9px;border-radius:999px;font-size:0.85rem;font-weight:600;">Serviceable</span>`;

                                return `
                                    <tr style="border-bottom:1px solid rgba(74,222,128,.12);">
                                        <td style="padding:10px 12px;">
                                            <div style="display:flex;align-items:center;gap:8px;">
                                                <div style="width:18px;height:18px;border-radius:5px;background:rgba(34,197,94,.1);display:flex;align-items:center;justify-content:center;flex-shrink:0;">
                                                    <i class="${icon}" style="color:#6ee7b7;font-size:0.8rem;"></i>
                                                </div>
                                                <span style="font-size:0.95rem;font-weight:600;color:#ecfdf5;${isMissing ? 'text-decoration:line-through;' : ''}">${comp.name}</span>
                                            </div>
                                        </td>
                                        <td style="padding:10px 12px;font-size:0.9rem;color:#a7f3d0;">${comp.category}${hasDuplicateType ? ' <span style="color:#fca5a5;font-size:0.8rem;font-weight:700;">DUPLICATE TYPE</span>' : ''}</td>
                                        <td style="padding:10px 12px;font-size:0.9rem;font-family:monospace;color:#d1fae5;">${comp.serialNumber || '—'}</td>
                                        <td style="padding:10px 12px;">${conditionBadge}</td>
                                        <td style="padding:10px 12px;text-align:right;">
                                            ${!isMissing
                                                ? `<div style="display:flex;justify-content:flex-end;gap:6px;">
                                                        <button onclick="openReplaceComponentModal('${comp.equipmentId}', '${String(comp.name || '').replace(/'/g, "\\'")}', '${setId}')"
                                                                style="background:rgba(139,92,246,.12);border:1px solid rgba(139,92,246,.25);color:#c4b5fd;padding:2px 7px;border-radius:5px;font-size:0.64rem;font-weight:600;cursor:pointer;">
                                                                <i class="fas fa-right-left" style="margin-right:4px;"></i>Replace
                                                        </button>
                                                        <button onclick="removeComponentFromSetInline('${setId}', '${String(comp.equipmentId || comp.id).replace(/'/g, "\\'")}')"
                                                                style="background:rgba(239,68,68,.1);border:1px solid rgba(239,68,68,.2);color:#fca5a5;padding:2px 7px;border-radius:5px;font-size:0.64rem;font-weight:600;cursor:pointer;">
                                                                <i class="fas fa-times" style="margin-right:4px;"></i>Remove
                                                        </button>
                                                   </div>`
                                                : `<span style="font-size:0.7rem;color:rgba(251,191,36,.4);font-style:italic;">Locked</span>`
                                            }
                                        </td>
                                    </tr>`;
                            }).join('')}
                        </tbody>
                    </table>
                `;
            }

        }
    } catch (error) {
        console.error('Error loading components:', error);
        container.innerHTML = `
            <div class="text-center text-red-400 py-4">
                <i class="fas fa-exclamation-circle mr-2"></i>Failed to load equipment list
            </div>
        `;
    }
}

function openReplaceComponentModal(equipmentId, name, currentSetId) {
    if (typeof openTransferSetModal !== 'function') {
        console.error('Transfer modal is not available.');
        return;
    }

    openTransferSetModal(equipmentId, name, currentSetId);

    const title = document.querySelector('#transferSetModal h3');
    const submitButton = document.querySelector('#transferSetModal button[onclick="submitTransferSet()"]');
    if (title) title.textContent = 'Replace Equipment in PC Set';
    if (submitButton) submitButton.innerHTML = '<i class="fas fa-right-left mr-1"></i>Replace Equipment';
}

function createNewPCSet() {
    if (typeof window.openAddInventoryModal === 'function') {
        window.openAddInventoryModal('pc-set');
    }
}

async function editPCSetInline(setId) {
    try {
        const response = await fetch(`/api/equipment-sets/${setId}`);
        const data = await response.json();
        
        if (data.success) {
            const set = data.set;
            const modal = document.createElement('div');
            modal.className = 'modal show';
            modal.innerHTML = `
                <div class="modal-content mx-auto w-full max-w-2xl">
                    <div class="flex items-start justify-between mb-6">
                        <div>
                            <h3 class="text-2xl font-bold text-white">Edit PC Set</h3>
                            <p class="text-slate-400 mt-1">${setId}</p>
                        </div>
                        <button onclick="this.closest('.modal').remove()" class="text-2xl text-emerald-400 hover:text-emerald-200">
                            <i class="fas fa-times"></i>
                        </button>
                    </div>
                    <form id="editPCSetForm">
                        <div class="space-y-4">
                            <div>
                                <label class="block text-sm font-medium text-emerald-300 mb-2">Set Name *</label>
                                <input type="text" id="editSetName" value="${set.setName}" 
                                       class="w-full rounded-lg border border-emerald-800/60 bg-[#060e0a] px-4 py-3 text-emerald-100 focus:border-emerald-500 focus:outline-none" required>
                            </div>
                            <div>
                                <label class="block text-sm font-medium text-emerald-300 mb-2">Description</label>
                                <textarea id="editDescription" rows="2" 
                                          class="w-full rounded-lg border border-emerald-800/60 bg-[#060e0a] px-4 py-3 text-emerald-100 focus:border-emerald-500 focus:outline-none">${set.description || ''}</textarea>
                            </div>
                            <div>
                                <label class="block text-sm font-medium text-emerald-300 mb-2">Location</label>
                                <input type="text" id="editLocation" value="${set.location || ''}" 
                                       class="w-full rounded-lg border border-emerald-800/60 bg-[#060e0a] px-4 py-3 text-emerald-100 focus:border-emerald-500 focus:outline-none">
                            </div>
                            <div>
                                <label class="block text-sm font-medium text-emerald-300 mb-2">Status</label>
                                <select id="editStatus" 
                                        class="w-full rounded-lg border border-emerald-800/60 bg-[#060e0a] px-4 py-3 text-emerald-100 focus:border-emerald-500 focus:outline-none">
                                    <option value="incomplete" ${set.status === 'incomplete' ? 'selected' : ''}>Incomplete</option>
                                    <option value="active" ${set.status === 'active' ? 'selected' : ''}>Active</option>
                                    <option value="maintenance" ${set.status === 'maintenance' ? 'selected' : ''}>Maintenance</option>
                                    <option value="retired" ${set.status === 'retired' ? 'selected' : ''}>Retired</option>
                                </select>
                            </div>
                        </div>
                        <div class="flex gap-3 mt-6">
                            <button type="button" onclick="this.closest('.modal').remove()" 
                                    class="flex-1 rounded-lg border border-emerald-800/60 bg-emerald-950/30 px-4 py-2.5 text-emerald-300 hover:bg-emerald-900/50 font-semibold">
                                Cancel
                            </button>
                            <button type="submit" 
                                    class="flex-1 rounded-lg bg-emerald-600 px-4 py-2.5 text-white font-semibold hover:bg-emerald-500">
                                <i class="fas fa-save mr-2"></i>Update
                            </button>
                        </div>
                    </form>
                </div>
            `;
            document.body.appendChild(modal);
            
            document.getElementById('editPCSetForm').addEventListener('submit', async (e) => {
                e.preventDefault();
                await updatePCSet(setId);
            });
        }
    } catch (error) {
        console.error('Error:', error);
        alert('Failed to load PC set details');
    }
}

async function updatePCSet(setId) {
    const setName = document.getElementById('editSetName').value.trim();
    const description = document.getElementById('editDescription').value.trim();
    const location = document.getElementById('editLocation').value.trim();
    const status = document.getElementById('editStatus').value;
    
    try {
        const response = await fetch(`/api/equipment-sets/${setId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ setName, description, location, status })
        });
        
        const data = await response.json();
        if (data.success) {
            document.querySelectorAll('.modal').forEach(m => m.remove());
            await loadPCSetsTable();
            await window.refreshInventorySummaryCards?.();
            alert('PC set updated successfully!');
        } else {
            alert(data.message || 'Failed to update PC set');
        }
    } catch (error) {
        console.error('Error:', error);
        alert('Failed to update PC set');
    }
}

async function archivePCSetInline(setId, componentCount) {
    if (componentCount > 0) {
        alert(`This PC set cannot be archived while it has ${componentCount} component(s). Remove or move all components first.`);
        return;
    }
    
    if (!await window.appDialogs.confirm(`Archive ${setId}? It will be hidden from active lists and can be restored from Archived Records.`)) {
        return;
    }
    
    try {
        const response = await fetch(`/api/archive/pc-set/${encodeURIComponent(setId)}`, {
            method: 'POST'
        });
        
        const data = await response.json();
        if (data.success) {
            await loadPCSetsTable();
            await window.refreshInventorySummaryCards?.();
            alert('PC set archived successfully!');
        } else {
            alert(data.message || 'Failed to archive PC set');
        }
    } catch (error) {
        console.error('Error:', error);
        alert('Failed to archive PC set');
    }
}

async function addComponentsModal(setId) {
    try {
        const [response, setResponse] = await Promise.all([
            fetch('/api/equipment/available-for-sets'),
            fetch(`/api/equipment-sets/${encodeURIComponent(setId)}`)
        ]);
        const [data, setData] = await Promise.all([
            response.json(),
            setResponse.json()
        ]);
        
        if (!response.ok || !data.success) {
            throw new Error(data.message || data.error || 'Failed to load available equipment');
        }
        if (!setResponse.ok || !setData.success) {
            throw new Error(setData.message || setData.error || 'Failed to load PC set components');
        }

        const assignedCategories = new Set(
            (setData.components || [])
                .map(component => String(component.category || '').trim().toLowerCase())
                .filter(Boolean)
        );
        const duplicateCategories = new Set();
        const seenCategories = new Set();
        for (const component of setData.components || []) {
            const category = String(component.category || '').trim().toLowerCase();
            if (category && seenCategories.has(category)) duplicateCategories.add(component.category);
            if (category) seenCategories.add(category);
        }
        const availableEquipment = data.equipment.filter(item =>
            !assignedCategories.has(String(item.category || '').trim().toLowerCase())
        );
        const modal = document.createElement('div');
        modal.className = 'modal show';
        modal.innerHTML = `
                <div class="modal-content mx-auto w-full max-w-3xl">
                    <div class="flex items-start justify-between mb-3">
                        <div>
                            <h3 class="text-xl font-bold text-white">Add Components</h3>
                            <p class="text-sm text-slate-400 mt-0.5">Select equipment to add to ${setId}</p>
                        </div>
                        <button onclick="this.closest('.modal').remove()" class="text-2xl text-emerald-400 hover:text-emerald-200">
                            <i class="fas fa-times"></i>
                        </button>
                    </div>
                    
                    <input id="availableEquipmentSearch" type="search" placeholder="Search by equipment ID, name, or category..."
                           class="mb-1 w-full rounded-lg border border-emerald-800/60 bg-[#060e0a] px-3 py-2 text-emerald-100 focus:border-emerald-500 focus:outline-none" />
                    <div id="availableEquipmentCount" class="mb-2 text-xs text-slate-400">${availableEquipment.length} equipment items available</div>
                    ${assignedCategories.size ? `<p class="mb-2 text-xs text-amber-300">Already in this PC set (cannot add duplicates): ${[...assignedCategories].map(category => category.replace(/\b\w/g, letter => letter.toUpperCase())).join(', ')}</p>` : ''}
                    ${duplicateCategories.size ? `<p class="mb-2 text-xs text-red-300">This set already has duplicate types: ${[...duplicateCategories].join(', ')}. Remove the extra items before adding more.</p>` : ''}
                    <div class="space-y-1 max-h-96 overflow-y-auto mb-4" id="availableEquipmentList">
                        ${availableEquipment.length === 0 ?
                            '<div class="text-center text-slate-400 py-8">No equipment types are available to add to this PC set.</div>' :
                            availableEquipment.map(item => `
                                <label class="flex items-start gap-2 p-2 bg-[#0d1e17] border border-emerald-800/40 rounded-md cursor-pointer hover:border-emerald-600/40 transition-colors" style="padding:6px 10px;gap:8px;">
                                    <input type="checkbox" value="${item.id}" data-category="${String(item.category || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').toLowerCase()}" class="mt-0.5 component-checkbox" />
                                    <div class="flex-1">
                                        <div class="text-sm font-semibold text-white leading-tight">${item.name}</div>
                                        <div class="text-xs text-slate-400 mt-0.5 leading-tight">
                                            <span class="font-mono text-emerald-300">${item.equipmentId}</span> • ${item.category} • SN: ${item.serialNumber || 'N/A'} • ${item.campus || 'N/A'}
                                        </div>
                                    </div>
                                </label>
                            `).join('')
                        }
                    </div>

                    <div class="flex gap-3">
                        <button type="button" onclick="this.closest('.modal').remove()" 
                                class="flex-1 rounded-lg border border-emerald-800/60 bg-emerald-950/30 px-4 py-2.5 text-emerald-300 hover:bg-emerald-900/50 font-semibold">
                            Cancel
                        </button>
                        <button type="button" onclick="saveSelectedComponentsInline('${setId}')" 
                                class="flex-1 rounded-lg bg-emerald-600 px-4 py-2.5 text-white font-semibold hover:bg-emerald-500">
                            <i class="fas fa-check mr-2"></i>Add Components
                        </button>
                    </div>
                </div>
            `;
            document.body.appendChild(modal);
            const searchInput = document.getElementById('availableEquipmentSearch');
            const availableItems = [...document.querySelectorAll('#availableEquipmentList label')];
            const countLabel = document.getElementById('availableEquipmentCount');
            const categoryCheckboxes = [...modal.querySelectorAll('.component-checkbox')];
            categoryCheckboxes.forEach(checkbox => checkbox.addEventListener('change', () => {
                const selectedCategories = new Set(
                    categoryCheckboxes.filter(item => item.checked).map(item => item.dataset.category)
                );
                categoryCheckboxes.forEach(item => {
                    if (!item.checked) item.disabled = selectedCategories.has(item.dataset.category);
                });
            }));
        searchInput?.addEventListener('input', () => {
                const query = searchInput.value.trim().toLowerCase();
                let visibleCount = 0;
                availableItems.forEach((item) => {
                    const matches = item.textContent.toLowerCase().includes(query);
                    item.style.display = matches ? '' : 'none';
                    if (matches) visibleCount++;
                });
                if (countLabel) countLabel.textContent = `${visibleCount} of ${availableItems.length} equipment items shown`;
        });
    } catch (error) {
        console.error('Error:', error);
        alert('Failed to load available equipment');
    }
}

async function saveSelectedComponentsInline(setId) {
    const checkboxes = document.querySelectorAll('.component-checkbox:checked');
    const equipmentIds = Array.from(checkboxes).map(cb => parseInt(cb.value));

    if (equipmentIds.length === 0) {
        alert('Please select at least one component');
        return;
    }

    try {
        const response = await fetch(`/api/equipment-sets/${setId}/components`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ equipmentIds })
        });

        const data = await response.json();
        if (data.success) {
            document.querySelectorAll('.modal').forEach(m => m.remove());
            await loadPCSetsTable();
            await window.refreshInventorySummaryCards?.();
            // Expand the row to show new components
            const expandedRow = document.getElementById(`expanded-${setId}`);
            if (expandedRow.classList.contains('hidden')) {
                await togglePCSetExpand(setId);
            } else {
                await loadPCSetComponents(setId);
            }
            alert(data.message);
        } else {
            alert(data.message || data.error || 'Failed to add components');
        }
    } catch (error) {
        console.error('Error:', error);
        alert('Failed to add components');
    }
}

async function removeComponentFromSetInline(setId, componentId) {
    const reason = await window.appDialogs.prompt('Why should this equipment be removed from the set?');
    if (reason === null) return;
    if (!reason.trim()) {
        alert('A reason is required before removing equipment from the set.');
        return;
    }

    try {
        const response = await fetch(`/api/equipment/${encodeURIComponent(componentId)}/transfer-set`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ targetSetId: null, reason: reason.trim() })
        });

        const data = await response.json().catch(() => ({}));
        if (response.ok && data.success) {
            await loadPCSetComponents(setId);
            await loadPCSetsTable(); // Refresh to update component count
            await window.refreshInventorySummaryCards?.();
        } else {
            alert(data.error || data.message || 'Failed to remove component from set.');
        }
    } catch (error) {
        console.error('Error:', error);
        alert('Failed to remove component from set.');
    }
}
