
        // Dropdown toggle function
        function toggleDropdown(event, equipmentId) {
            event.stopPropagation();
            const button = event.currentTarget;
            const dropdown = document.getElementById(`dropdown-${equipmentId}`);
            const allDropdowns = document.querySelectorAll('.dropdown-menu');
            
            // Close all other dropdowns
            allDropdowns.forEach(dd => {
                if (dd.id !== `dropdown-${equipmentId}`) {
                    dd.classList.remove('show');
                }
            });
            
            // Toggle current dropdown
            dropdown.classList.toggle('show');
        }

        // Close dropdown when clicking outside
        document.addEventListener('click', function(event) {
            if (!event.target.closest('.action-dropdown')) {
                const allDropdowns = document.querySelectorAll('.dropdown-menu');
                allDropdowns.forEach(dd => {
                    dd.classList.remove('show');
                });
            }
        });

        let equipmentToDelete = null;
        let equipmentData = [];
        let isRefreshingLastBorrowers = false;
        let equipmentCategories = [];
        let addInventorySets = [];
        let equipmentCampusSummary = {};
        let inventoryAssignmentFilter = '';
        let currentEquipmentPage = 1;
        let equipmentViewStartPage = 1;
        const equipmentRowsPerPage = 10;
        let equipmentPageRequestId = 0;
        let equipmentTotalCount = 0;
        let isLoadingEquipmentPage = false;
        let isLoadingNextEquipmentPage = false;
        let equipmentPCSets = [];
        let qrExportCatalog = null;
        const qrExportImageCache = new Map();

        const qrExportModal = document.getElementById('qrExportModal');
        const qrExportType = document.getElementById('qrExportType');
        const qrExportCategory = document.getElementById('qrExportCategory');
        const qrExportCampus = document.getElementById('qrExportCampus');
        const qrExportStatus = document.getElementById('qrExportStatus');
        const qrExportCount = document.getElementById('qrExportCount');
        const qrExportError = document.getElementById('qrExportError');
        const downloadQrExportButton = document.getElementById('downloadQrExport');

        function getFilteredQrExportRecords() {
            if (!qrExportCatalog) return [];
            const type = qrExportType.value;
            const category = qrExportCategory.value.trim().toLowerCase();
            const campus = normalizeCampusKey(qrExportCampus.value);
            const status = qrExportStatus.value.trim().toLowerCase();

            return qrExportCatalog.filter((record) => {
                if (type !== 'all' && record.type !== type) return false;
                if (category && (record.type !== 'equipment' || String(record.category || '').trim().toLowerCase() !== category)) return false;
                if (campus && normalizeCampusKey(record.campus) !== campus) return false;
                if (status && String(record.status || '').trim().toLowerCase() !== status) return false;
                return true;
            });
        }

        function updateQrExportPreview() {
            if (qrExportType.value === 'pc-sets') {
                qrExportCategory.value = '';
                if (['serviceable', 'unserviceable', 'lost', 'missing', 'under maintenance', 'in use', 'for repair', 'for disposal'].includes(qrExportStatus.value.toLowerCase())) {
                    qrExportStatus.value = '';
                }
            } else if (qrExportType.value === 'equipment' && ['active', 'incomplete', 'maintenance', 'retired'].includes(qrExportStatus.value.toLowerCase())) {
                qrExportStatus.value = '';
            }
            const records = getFilteredQrExportRecords();
            qrExportCount.textContent = qrExportCatalog
                ? `${records.length.toLocaleString()} QR code${records.length === 1 ? '' : 's'} will be included`
                : 'Loading equipment and PC sets…';
            downloadQrExportButton.disabled = !records.length;
            qrExportCategory.disabled = qrExportType.value === 'pc-sets';
        }

        async function loadQrExportCatalog() {
            qrExportCount.textContent = 'Loading equipment and PC sets…';
            downloadQrExportButton.disabled = true;
            qrExportError.classList.add('hidden');
            const [equipmentResponse, setsResponse, categories] = await Promise.all([
                fetch('/api/equipment', { cache: 'no-store' }),
                fetch('/api/equipment-sets', { cache: 'no-store' }),
                fetchCategories()
            ]);
            const equipmentPayload = await equipmentResponse.json().catch(() => null);
            const setsPayload = await setsResponse.json().catch(() => null);
            if (!equipmentResponse.ok) throw new Error(equipmentPayload?.error || 'Unable to load equipment for QR export.');
            if (!setsResponse.ok || !setsPayload?.success) throw new Error(setsPayload?.error || setsPayload?.message || 'Unable to load PC sets for QR export.');
            if (!Array.isArray(equipmentPayload)) throw new Error('Equipment list returned an invalid response.');

            qrExportCatalog = [
                ...equipmentPayload.map((item) => ({
                    type: 'equipment',
                    id: String(item.equipmentId || ''),
                    name: String(item.name || 'Equipment'),
                    category: String(item.category || ''),
                    campus: String(item.campus || ''),
                    status: String(item.status || ''),
                    dateAdded: item.dateAdded || '',
                    qrImage: item.qrImage || ''
                })).filter((item) => item.id),
                ...(Array.isArray(setsPayload.sets) ? setsPayload.sets : []).map((set) => ({
                    type: 'pc-sets',
                    id: String(set.setId || ''),
                    name: String(set.setName || set.setId || 'PC Set'),
                    category: '',
                    campus: String(set.campus || ''),
                    status: String(set.status || ''),
                    dateAdded: set.createdAt || '',
                    qrImage: ''
                })).filter((item) => item.id)
            ];

            const categorySelect = document.getElementById('qrExportCategory');
            const categoryNames = [...new Set([
                ...(Array.isArray(categories) ? categories.map((item) => item.name) : []),
                ...qrExportCatalog.filter((item) => item.type === 'equipment').map((item) => item.category)
            ].map((name) => String(name || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
            categorySelect.replaceChildren(new Option('All categories', ''));
            categoryNames.forEach((name) => categorySelect.add(new Option(name, name)));

            const campusSelect = document.getElementById('qrExportCampus');
            const campusNames = [...new Set(qrExportCatalog.map((item) => item.campus.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
            const selectedCampus = campusSelect.value;
            campusSelect.replaceChildren(new Option('All campuses', ''));
            campusNames.forEach((name) => campusSelect.add(new Option(name, name)));
            if (campusNames.includes(selectedCampus)) campusSelect.value = selectedCampus;
            updateQrExportPreview();
        }

        async function openQrExport() {
            openModal('qrExportModal');
            qrExportError.classList.add('hidden');
            if (qrExportCatalog) {
                updateQrExportPreview();
                return;
            }
            try {
                await loadQrExportCatalog();
            } catch (error) {
                qrExportCount.textContent = 'QR list could not be loaded';
                qrExportError.textContent = error.message || 'Unable to prepare QR export.';
                qrExportError.classList.remove('hidden');
            }
        }

        async function getQrExportImage(record) {
            const cacheKey = `${record.type}:${record.id}`;
            if (qrExportImageCache.has(cacheKey)) return qrExportImageCache.get(cacheKey);
            let image = record.qrImage;
            if (!image || !String(image).startsWith('data:image/')) {
                const url = record.type === 'equipment'
                    ? `/api/equipment/${encodeURIComponent(record.id)}/qr`
                    : `/api/pc-stations/${encodeURIComponent(record.id)}/qr`;
                const response = await fetch(url, { cache: 'no-store' });
                const payload = await response.json().catch(() => ({}));
                if (!response.ok) throw new Error(payload.error || `Unable to generate QR for ${record.id}.`);
                image = record.type === 'equipment' ? payload.qrImage : payload.qrCode;
            }
            if (!image || !String(image).startsWith('data:image/')) throw new Error(`QR image is unavailable for ${record.id}.`);
            qrExportImageCache.set(cacheKey, image);
            return image;
        }

        async function loadQrExportImages(records) {
            const result = [];
            const batchSize = 6;
            for (let index = 0; index < records.length; index += batchSize) {
                const batch = records.slice(index, index + batchSize);
                const images = await Promise.all(batch.map(async (record) => ({
                    ...record,
                    qrImage: await getQrExportImage(record)
                })));
                result.push(...images);
                qrExportCount.textContent = `Preparing QR images… ${result.length} of ${records.length}`;
            }
            return result;
        }

        function resizeQrExportImage(source, size = 320) {
            return new Promise((resolve, reject) => {
                const image = new Image();
                image.onload = () => {
                    const canvas = document.createElement('canvas');
                    canvas.width = size;
                    canvas.height = size;
                    const context = canvas.getContext('2d', { alpha: false });
                    if (!context) {
                        reject(new Error('Unable to prepare QR images for download.'));
                        return;
                    }
                    context.fillStyle = '#ffffff';
                    context.fillRect(0, 0, size, size);
                    context.imageSmoothingEnabled = false;
                    context.drawImage(image, 0, 0, size, size);
                    resolve(canvas.toDataURL('image/png'));
                };
                image.onerror = () => reject(new Error('One of the QR images could not be prepared.'));
                image.src = source;
            });
        }

        async function prepareQrExportImages(records) {
            const result = [];
            const batchSize = 8;
            for (let index = 0; index < records.length; index += batchSize) {
                const batch = records.slice(index, index + batchSize);
                const prepared = await Promise.all(batch.map(async (record) => ({
                    ...record,
                    qrImage: await resizeQrExportImage(record.qrImage)
                })));
                result.push(...prepared);
                qrExportCount.textContent = `Optimizing QR images… ${result.length} of ${records.length}`;
                await new Promise((resolve) => window.setTimeout(resolve, 0));
            }
            return result;
        }

        function startQrExportDownload(blob, filename) {
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = filename;
            document.body.appendChild(link);
            link.click();
            link.remove();
            window.setTimeout(() => URL.revokeObjectURL(url), 1500);
        }

        function getQrExportLabel(record) {
            return record.type === 'pc-sets' ? (record.name || record.id) : record.id;
        }

        async function exportQrPdf(records) {
            if (!window.jspdf?.jsPDF) throw new Error('PDF export is unavailable. Reload the page and try again.');
            const { jsPDF } = window.jspdf;
            const pdf = new jsPDF({ orientation: 'portrait', unit: 'in', format: 'letter' });
            const pageWidth = 8.5;
            const marginX = .25;
            const marginTop = .68;
            const marginBottom = .25;
            const columns = 6;
            const rows = 8;
            const gapX = .025;
            const gapY = .015;
            const cellWidth = (pageWidth - marginX * 2 - gapX * (columns - 1)) / columns;
            const cellHeight = (11 - marginTop - marginBottom - gapY * (rows - 1)) / rows;
            const qrSize = .82;

            for (let index = 0; index < records.length; index += 1) {
                const record = records[index];
                const pageItemIndex = index % (columns * rows);
                if (index > 0 && pageItemIndex === 0) pdf.addPage();
                if (pageItemIndex === 0) {
                    pdf.setFont('helvetica', 'bold');
                    pdf.setFontSize(12);
                    pdf.text('ComLab Equipment and PC Set QR Codes', marginX, .34);
                    pdf.setFont('helvetica', 'normal');
                    pdf.setFontSize(7);
                    pdf.text(`Generated ${new Date().toLocaleDateString()} · ${records.length} QR codes`, marginX, .53);
                }
                const column = pageItemIndex % columns;
                const row = Math.floor(pageItemIndex / columns);
                const cellX = marginX + column * (cellWidth + gapX);
                const cellY = marginTop + row * (cellHeight + gapY);
                const imageX = cellX + (cellWidth - qrSize) / 2;
                pdf.addImage(record.qrImage, 'PNG', imageX, cellY + .035, qrSize, qrSize);
                pdf.setFont('helvetica', 'bold');
                pdf.setFontSize(7.5);
                pdf.setTextColor(10, 35, 22);
                pdf.text(getQrExportLabel(record), cellX + cellWidth / 2, cellY + .035 + qrSize + .13, { align: 'center', maxWidth: cellWidth - .04 });
                pdf.setFont('helvetica', 'normal');
                pdf.setFontSize(5.2);
                pdf.setTextColor(75, 85, 80);
                pdf.text(record.type === 'equipment' ? (record.category || 'Equipment') : 'PC Station', cellX + cellWidth / 2, cellY + .035 + qrSize + .23, { align: 'center', maxWidth: cellWidth - .04 });
                if (pageItemIndex === columns * rows - 1 || index === records.length - 1) {
                    qrExportCount.textContent = `Building PDF… ${index + 1} of ${records.length}`;
                    await new Promise((resolve) => window.setTimeout(resolve, 0));
                }
            }

            return pdf.output('blob');
        }

        function exportQrWord(records) {
            const rows = [];
            for (let index = 0; index < records.length; index += 6) {
                const cells = records.slice(index, index + 6).map((record) => `
                    <td style="width:16.66%;padding:3px 2px;text-align:center;vertical-align:top;border:1px solid #d1d5db">
                        <img src="${record.qrImage}" alt="QR ${escapeHtml(getQrExportLabel(record))}" width="80" height="80" style="display:block;margin:0 auto 3px;width:80px;height:80px">
                        <p style="margin:0;font-family:Arial,sans-serif;font-size:8pt;font-weight:bold;color:#111827">${escapeHtml(getQrExportLabel(record))}</p>
                        <p style="margin:1px 0 0;font-family:Arial,sans-serif;font-size:6pt;color:#4b5563">${escapeHtml(record.type === 'equipment' ? (record.category || 'Equipment') : 'PC Station')}</p>
                    </td>`);
                while (cells.length < 6) cells.push('<td style="width:16.66%;border:1px solid #d1d5db"></td>');
                rows.push(`<tr>${cells.join('')}</tr>`);
            }
            const html = `<!doctype html><html><head><meta charset="utf-8"><title>ComLab QR Codes</title></head><body>
                <h1 style="font-family:Arial,sans-serif;color:#064e3b">ComLab Equipment and PC Set QR Codes</h1>
                <p style="font-family:Arial,sans-serif">Generated ${new Date().toLocaleDateString()} · ${records.length} QR codes</p>
                <table style="width:100%;border-collapse:collapse;table-layout:fixed"><tbody>${rows.join('')}</tbody></table>
                </body></html>`;
            return new Blob(['\ufeff', html], { type: 'application/msword;charset=utf-8' });
        }

        async function downloadQrExport() {
            const records = getFilteredQrExportRecords();
            if (!records.length) return;
            downloadQrExportButton.disabled = true;
            qrExportError.classList.add('hidden');
            try {
                const qrRecords = await loadQrExportImages(records);
                const exportRecords = await prepareQrExportImages(qrRecords);
                const format = document.getElementById('qrExportFormat').value;
                const today = new Date().toISOString().slice(0, 10);
                const blob = format === 'pdf' ? await exportQrPdf(exportRecords) : exportQrWord(exportRecords);
                startQrExportDownload(blob, `comlab-qr-codes-${today}.${format}`);
                qrExportCount.textContent = `${exportRecords.length.toLocaleString()} QR code${exportRecords.length === 1 ? '' : 's'} downloaded`;
            } catch (error) {
                qrExportError.textContent = error.message || 'Unable to download QR codes.';
                qrExportError.classList.remove('hidden');
                qrExportCount.textContent = 'QR export failed';
            } finally {
                updateQrExportPreview();
            }
        }

        document.getElementById('openQrExportModal')?.addEventListener('click', openQrExport);
        document.getElementById('closeQrExportModal')?.addEventListener('click', () => closeModal('qrExportModal'));
        document.getElementById('cancelQrExport')?.addEventListener('click', () => closeModal('qrExportModal'));
        qrExportModal?.addEventListener('click', (event) => {
            if (event.target === qrExportModal) closeModal('qrExportModal');
        });
        [qrExportType, qrExportCategory, qrExportCampus, qrExportStatus]
            .forEach((control) => control?.addEventListener('change', updateQrExportPreview));
        downloadQrExportButton?.addEventListener('click', downloadQrExport);

        function normalizeCampusKey(value) {
            return String(value || '').trim().replace(/\s*Campus\s*$/i, '').trim().toLowerCase();
        }

        function getCampusSummary(campusName) {
            const campusKey = normalizeCampusKey(campusName);
            const matchedSummary = Object.keys(equipmentCampusSummary).find((key) => normalizeCampusKey(key) === campusKey);
            if (!matchedSummary) {
                return { total: 0, assigned: 0, unassigned: 0, Serviceable: 0, Unserviceable: 0, Lost: 0, Missing: 0 };
            }
            return equipmentCampusSummary[matchedSummary] || { total: 0, assigned: 0, unassigned: 0, Serviceable: 0, Unserviceable: 0, Lost: 0, Missing: 0 };
        }

        function getCurrentUserCampus() {
            const userCampus = window.__CURRENT_USER__?.campus || '';
            return String(userCampus).trim();
        }

        function getAllCampusSummary() {
            return Object.entries(equipmentCampusSummary).filter(([key]) => key !== 'allCampuses').reduce((acc, [, summary]) => {
                const current = summary || { total: 0, assigned: 0, unassigned: 0, Serviceable: 0, Unserviceable: 0, Lost: 0, Missing: 0 };
                acc.total += Number(current.total || 0);
                acc.assigned += Number(current.assigned || 0);
                acc.unassigned += Number(current.unassigned || 0);
                acc.Serviceable += Number(current.Serviceable || 0);
                acc.Unserviceable += Number(current.Unserviceable || 0);
                acc.Lost += Number(current.Lost || 0);
                acc.Missing += Number(current.Missing || 0);
                return acc;
            }, { total: 0, assigned: 0, unassigned: 0, Serviceable: 0, Unserviceable: 0, Lost: 0, Missing: 0 });
        }

        function isRestrictedCampusView(selectedCampus) {
            const normalizedSelectedCampus = normalizeCampusKey(selectedCampus);
            const normalizedUserCampus = normalizeCampusKey(getCurrentUserCampus());
            if (!normalizedSelectedCampus || !normalizedUserCampus) {
                return false;
            }
            return normalizedSelectedCampus !== normalizedUserCampus;
        }

        function escapeHtml(value) {
            return String(value || '')
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/\"/g, '&quot;')
                .replace(/'/g, '&#39;');
        }

        function getVisiblePaginationItems(totalPages, currentPage) {
            if (totalPages <= 0) return [];

            const firstPage = Math.max(1, Math.min(currentPage - 1, totalPages - 2));
            const lastPage = Math.min(totalPages, firstPage + 2);
            return Array.from({ length: lastPage - firstPage + 1 }, (_, index) => firstPage + index);
        }

        function renderPaginationControls() {
            const container = document.getElementById('equipmentPagination');
            const info = document.getElementById('equipmentPaginationInfo');
            if (!container || !info) return;

            info.hidden = true;
            const totalPages = Math.max(1, Math.ceil(equipmentTotalCount / equipmentRowsPerPage));
            currentEquipmentPage = Math.min(currentEquipmentPage, totalPages);
            const startIndex = equipmentTotalCount ? (equipmentViewStartPage - 1) * equipmentRowsPerPage + 1 : 0;
            const endIndex = equipmentTotalCount ? Math.min(currentEquipmentPage * equipmentRowsPerPage, equipmentTotalCount) : 0;
            info.textContent = equipmentTotalCount
                ? `Showing ${startIndex}-${endIndex} of ${equipmentTotalCount} · Page ${currentEquipmentPage} of ${totalPages} · Scroll to load more`
                : 'Showing 0 of 0';

            if (!equipmentTotalCount) {
                container.innerHTML = '';
                return;
            }

            const pageItems = getVisiblePaginationItems(totalPages, currentEquipmentPage);
            const pageButtons = pageItems.map((item) => {
                if (item === '...') {
                    return '<span class="equipment-pagination-ellipsis" aria-hidden="true">...</span>';
                }

                const isActive = item === currentEquipmentPage;
                return `
                    <button type="button" onclick="goToEquipmentPage(${item})" class="equipment-pagination-button" aria-label="Page ${item}" ${isActive ? 'aria-current="page"' : ''}>
                        ${item}
                    </button>
                `;
            }).join('');

            container.innerHTML = `
                <button type="button" onclick="previousEquipmentPage()" class="equipment-pagination-button" aria-label="Previous page" ${currentEquipmentPage === 1 ? 'disabled' : ''}>
                    PREV
                </button>
                ${pageButtons}
                <button type="button" onclick="nextEquipmentPage()" class="equipment-pagination-button" aria-label="Next page" ${currentEquipmentPage === totalPages ? 'disabled' : ''}>
                    NEXT
                </button>
            `;
        }

        function goToEquipmentPage(page) {
            if (document.getElementById('viewModeFilter')?.value === 'pc-sets') return;
            void loadEquipment(page);
        }

        function previousEquipmentPage() {
            if (document.getElementById('viewModeFilter')?.value === 'pc-sets') return;
            if (currentEquipmentPage <= 1) return;
            void loadEquipment(currentEquipmentPage - 1);
        }

        function nextEquipmentPage() {
            if (document.getElementById('viewModeFilter')?.value === 'pc-sets') return;
            const totalPages = Math.max(1, Math.ceil(equipmentTotalCount / equipmentRowsPerPage));
            if (currentEquipmentPage >= totalPages) return;
            void loadEquipment(currentEquipmentPage + 1);
        }

        async function fetchCategories() {
            const response = await fetch('/api/equipment-categories');
            return response.ok ? response.json() : [];
        }

        async function fetchEquipmentCampusSummary() {
            const response = await fetch('/api/equipment/campus-totals', { cache: 'no-store' });
            if (!response.ok) return { campusCounts: {}, allCampuses: { total: 0, assigned: 0, unassigned: 0, Serviceable: 0, Unserviceable: 0, Lost: 0, Missing: 0 } };
            const payload = await response.json().catch(() => ({}));
            return {
                campusCounts: payload.campusCounts || {},
                allCampuses: payload.allCampuses || { total: 0, assigned: 0, unassigned: 0, Serviceable: 0, Unserviceable: 0, Lost: 0, Missing: 0 }
            };
        }

        async function refreshInventorySummary() {
            try {
                const [summary, setsResponse] = await Promise.all([
                    fetchEquipmentCampusSummary(),
                    fetch('/api/equipment-sets', { cache: 'no-store' })
                ]);
                equipmentCampusSummary = summary.campusCounts || {};
                equipmentCampusSummary.allCampuses = summary.allCampuses || getAllCampusSummary();
                const setsPayload = await setsResponse.json().catch(() => ({}));
                equipmentPCSets = setsResponse.ok && setsPayload.success && Array.isArray(setsPayload.sets)
                    ? setsPayload.sets
                    : [];
                renderStats();
            } catch (error) {
                console.warn('[equipment] Failed to refresh inventory summary cards:', error);
            }
        }
        window.refreshInventorySummaryCards = refreshInventorySummary;

        function renderEquipmentTypeDatalist() {
            const datalist = document.getElementById('equipmentTypeList');
            if (datalist) datalist.innerHTML = '';
            const componentSelect = document.getElementById('addEquipmentName');
            if (componentSelect) componentSelect.replaceChildren(new Option('Select component type', ''));
            equipmentCategories.forEach((category) => {
                if (datalist) {
                    const option = document.createElement('option');
                    option.value = category.name;
                    datalist.appendChild(option);
                }
                if (componentSelect) componentSelect.add(new Option(category.name, category.name));
            });
        }

        async function loadCategories() {
            equipmentCategories = await fetchCategories();
            renderEquipmentTypeDatalist();
        }

        async function fetchEquipment(campus = '', page = 1) {
            const url = new URL('/api/equipment', window.location.origin);
            if (campus && String(campus).trim()) {
                url.searchParams.set('campus', campus);
            }
            const search = document.getElementById('searchInput')?.value?.trim() || '';
            const status = document.getElementById('statusFilter')?.value || '';
            if (search) url.searchParams.set('search', search);
            if (status) url.searchParams.set('status', status);
            if (inventoryAssignmentFilter) url.searchParams.set('assignment', inventoryAssignmentFilter);
            url.searchParams.set('sortBy', 'name');
            url.searchParams.set('page', String(page));
            url.searchParams.set('pageSize', String(equipmentRowsPerPage));

            const response = await fetch(url.toString(), { cache: 'no-store' });
            const payload = await response.json().catch(() => null);
            if (!response.ok) {
                throw new Error(payload?.error || 'Failed to load equipment.');
            }
            if (Array.isArray(payload)) {
                const total = payload.length;
                const totalPages = Math.max(1, Math.ceil(total / equipmentRowsPerPage));
                const currentPage = Math.min(Math.max(1, page), totalPages);
                const startIndex = (currentPage - 1) * equipmentRowsPerPage;
                return {
                    records: payload.slice(startIndex, startIndex + equipmentRowsPerPage),
                    pagination: { page: currentPage, pageSize: equipmentRowsPerPage, total, totalPages }
                };
            }
            if (!payload ||
                !Array.isArray(payload.records) ||
                !payload.pagination ||
                !Number.isInteger(payload.pagination.page) ||
                !Number.isInteger(payload.pagination.total)) {
                throw new Error('Equipment pagination returned an invalid response.');
            }
            const totalPages = Math.max(1, Math.ceil(payload.pagination.total / equipmentRowsPerPage));
            const currentPage = Math.min(payload.pagination.page, totalPages);
            const records = payload.records.length > equipmentRowsPerPage
                ? payload.records.slice((currentPage - 1) * equipmentRowsPerPage, currentPage * equipmentRowsPerPage)
                : payload.records;
            return {
                records,
                pagination: {
                    page: currentPage,
                    pageSize: equipmentRowsPerPage,
                    total: payload.pagination.total,
                    totalPages
                }
            };
        }

        async function loadEquipment(page = 1, refreshSummary = false) {
            const requestId = ++equipmentPageRequestId;
            isLoadingEquipmentPage = true;
            const selectedCampus = document.getElementById('campusFilter')?.value || '';
            try {
                const [payload] = await Promise.all([
                    fetchEquipment(selectedCampus, page),
                    refreshSummary ? refreshInventorySummary() : Promise.resolve()
                ]);
                if (requestId !== equipmentPageRequestId) return;

                equipmentData = payload.records;
                currentEquipmentPage = payload.pagination.page;
                equipmentViewStartPage = payload.pagination.page;
                equipmentTotalCount = payload.pagination.total;
                if (selectedCampus && isRestrictedCampusView(selectedCampus)) {
                    equipmentData = [];
                    equipmentTotalCount = 0;
                }
                renderEquipmentTable(equipmentData);
                const tableScroller = document.querySelector('#equipmentTableSection > .overflow-x-auto');
                if (tableScroller) tableScroller.scrollTop = 0;
                renderStats();
                requestAnimationFrame(loadNextEquipmentPageIfViewportNeedsRows);
            } catch (error) {
                if (requestId !== equipmentPageRequestId) return;
                console.error('[equipment] Failed to load inventory page:', error);
                equipmentData = [];
                equipmentTotalCount = 0;
                const tbody = document.getElementById('equipmentTable');
                if (tbody) {
                    tbody.innerHTML = '<tr><td colspan="8" class="px-5 py-6 text-center text-rose-300" role="alert">Failed to load equipment. Please try again.</td></tr>';
                }
                renderPaginationControls();
            } finally {
                if (requestId === equipmentPageRequestId) isLoadingEquipmentPage = false;
            }
        }

        async function loadNextEquipmentPage() {
            const totalPages = Math.max(1, Math.ceil(equipmentTotalCount / equipmentRowsPerPage));
            if (isLoadingNextEquipmentPage ||
                isLoadingEquipmentPage ||
                document.getElementById('viewModeFilter')?.value === 'pc-sets' ||
                currentEquipmentPage >= totalPages) return;

            isLoadingNextEquipmentPage = true;
            const startingPage = currentEquipmentPage;
            const requestId = ++equipmentPageRequestId;
            const selectedCampus = document.getElementById('campusFilter')?.value || '';
            try {
                const payload = await fetchEquipment(selectedCampus, startingPage + 1);
                if (requestId !== equipmentPageRequestId || currentEquipmentPage !== startingPage) return;
                equipmentData = equipmentData.concat(payload.records);
                currentEquipmentPage = payload.pagination.page;
                renderEquipmentTable(payload.records, true);
                renderPaginationControls();
                requestAnimationFrame(loadNextEquipmentPageIfViewportNeedsRows);
            } catch (error) {
                console.error('[equipment] Failed to load the next inventory page:', error);
            } finally {
                isLoadingNextEquipmentPage = false;
            }
        }

        function loadNextEquipmentPageIfViewportNeedsRows() {
            if (document.getElementById('viewModeFilter')?.value === 'pc-sets') return;
            const tableScroller = document.querySelector('#equipmentTableSection > .overflow-x-auto');
            if (!tableScroller) return;
            const remainingScroll = tableScroller.scrollHeight - tableScroller.scrollTop - tableScroller.clientHeight;
            if (remainingScroll <= 48) void loadNextEquipmentPage();
        }

        document.querySelector('#equipmentTableSection > .overflow-x-auto')?.addEventListener('scroll', () => {
            loadNextEquipmentPageIfViewportNeedsRows();
        }, { passive: true });

        async function refreshLastBorrowers() {
            if (isRefreshingLastBorrowers ||
                document.visibilityState !== 'visible' ||
                document.getElementById('viewModeFilter')?.value === 'pc-sets') return;

            isRefreshingLastBorrowers = true;
            try {
                const response = await fetch('/api/equipment', { cache: 'no-store' });
                const payload = await response.json().catch(() => ({}));
                if (!response.ok) throw new Error(payload.error || 'Failed to refresh current borrowers.');
                if (!Array.isArray(payload)) throw new Error('Equipment refresh returned an invalid response.');

                const currentById = new Map(payload.map((item) => [String(item.equipmentId), item]));
                equipmentData = equipmentData.map((item) => {
                    const refreshed = currentById.get(String(item.equipmentId));
                    if (!refreshed) return item;
                    const lastBorrower = refreshed.lastBorrower || null;
                    const cell = [...document.querySelectorAll('[data-last-borrower-cell]')]
                        .find((element) => element.dataset.lastBorrowerCell === String(item.equipmentId));
                    if (cell) cell.textContent = lastBorrower?.name || '—';
                    return { ...item, lastBorrower };
                });
            } catch (error) {
                console.error('[equipment] Failed to refresh last borrowers:', error);
            } finally {
                isRefreshingLastBorrowers = false;
            }
        }

        function renderStats() {
            const selectedCampus = document.getElementById('campusFilter')?.value || '';
            const summaryTarget = !selectedCampus
                ? (equipmentCampusSummary.allCampuses || getAllCampusSummary())
                : getCampusSummary(selectedCampus);

            const stats = {
                totalCount: summaryTarget.total || 0,
                serviceableCount: summaryTarget.Serviceable || 0,
                unserviceableCount: summaryTarget.Unserviceable || 0,
                lostCount: summaryTarget.Lost || 0
            };
            Object.entries(stats).forEach(([id, value]) => {
                const element = document.getElementById(id);
                if (element) element.textContent = value;
            });

            const campusKey = normalizeCampusKey(selectedCampus);
            const visibleSets = equipmentPCSets.filter((set) =>
                !campusKey || normalizeCampusKey(set.campus) === campusKey
            );
            const inventoryCards = {
                inventoryCountEquipment: summaryTarget.total || 0,
                inventoryCountPCSets: visibleSets.length,
                inventoryCountAssigned: summaryTarget.assigned || 0,
                inventoryCountUnassigned: summaryTarget.unassigned || 0,
                inventoryCountMissing: summaryTarget.Missing || 0
            };
            Object.entries(inventoryCards).forEach(([id, value]) => {
                const element = document.getElementById(id);
                if (element) element.textContent = Number(value).toLocaleString();
            });

            const activeFilter = document.getElementById('viewModeFilter')?.value === 'pc-sets'
                ? 'pc-sets'
                : document.getElementById('statusFilter')?.value === 'Missing'
                    ? 'missing'
                    : inventoryAssignmentFilter || 'equipment';
            document.querySelectorAll('[data-inventory-filter]').forEach((card) => {
                const isActive = card.dataset.inventoryFilter === activeFilter;
                card.classList.toggle('is-active', isActive);
                card.setAttribute('aria-pressed', String(isActive));
            });
        }

        async function selectInventorySummaryFilter(filter) {
            const viewMode = document.getElementById('viewModeFilter');
            const validFilters = ['equipment', 'pc-sets', 'assigned', 'unassigned', 'missing'];
            if (!validFilters.includes(filter)) return;

            inventoryAssignmentFilter = filter === 'assigned' || filter === 'unassigned' ? filter : '';
            if (filter === 'pc-sets') {
                viewMode.value = 'pc-sets';
            } else {
                viewMode.value = 'all';
            }
            document.getElementById('searchInput').value = '';
            document.getElementById('statusFilter').value = filter === 'missing' ? 'Missing' : '';
            await changeViewMode();
            renderStats();
        }

        function renderEquipmentTable(items, append = false) {
            const tbody = document.getElementById('equipmentTable');
            if (document.getElementById('viewModeFilter')?.value === 'pc-sets') {
                loadPCSetsTable();
                return;
            }
            const sourceItems = Array.isArray(items) ? items : equipmentData;
            const selectedCampus = document.getElementById('campusFilter')?.value || '';
            const activeCampus = selectedCampus && selectedCampus !== 'All Campuses' ? selectedCampus : '';
            const restrictedView = activeCampus && isRestrictedCampusView(activeCampus);

            if (restrictedView) {
                const campusSummary = getCampusSummary(activeCampus);
                const campusLabel = activeCampus ? `${activeCampus.toUpperCase()} CAMPUS TOTAL` : 'SELECTED CAMPUS TOTAL';
                const campusMessage = activeCampus ? `${activeCampus}` : 'the selected campus';
                tbody.innerHTML = `
                    <tr>
                        <td colspan="8" class="px-5 py-6 text-center">
                            <div class="bg-red-950/20 border border-red-500/30 rounded-xl p-5 max-w-lg mx-auto shadow-lg shadow-red-950/30 backdrop-blur-md border-l-4 border-l-red-500">
                                <div class="flex items-start gap-3">
                                    <div class="mt-0.5 text-red-400 shrink-0">
                                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-6 h-6">
                                            <path d="M7 10V8a5 5 0 0 1 10 0v2"/>
                                            <rect x="5" y="10" width="14" height="10" rx="2"/>
                                        </svg>
                                    </div>
                                    <div class="flex-1 text-left">
                                        <div class="text-rose-200 font-extrabold text-xl mb-1">${campusLabel}</div>
                                        <div class="text-rose-200 font-extrabold text-xl mb-1">Total Equipment: ${campusSummary.total || 0}</div>
                                        <p class="text-red-200/80 text-sm font-medium leading-relaxed">
                                            Access Restricted: Detailed equipment inventory and individual item views are disabled for ${campusMessage}.
                                        </p>
                                    </div>
                                </div>
                            </div>
                        </td>
                    </tr>`;
                renderPaginationControls();
                return;
            }

            const canArchiveRecords = String(window.__CURRENT_USER__?.role || '').toLowerCase().includes('admin');
            const renderedRows = sourceItems.length ? sourceItems.map(item => {
                const statusBadgeMap = {
                    'Serviceable':       'background:rgb(20, 83, 45);color:#86efac;border:1px solid rgba(34,197,94,.3);',
                    'Unserviceable':     'background:rgba(107,114,128,.15);color:#d1d5db;border:1px solid rgba(107,114,128,.3);',
                    'Lost':              'background:rgba(239,68,68,.15);color:#fca5a5;border:1px solid rgba(239,68,68,.3);',
                    'Missing':           'background:rgba(251,191,36,.2);color:#fcd34d;border:1px solid rgb(133, 77, 14);',
                    'Under Maintenance': 'background:rgb(88, 28, 135);color:#c4b5fd;border:1px solid rgba(139,92,246,.3);',
                };
                const badgeStyle = statusBadgeMap[item.status] || statusBadgeMap['Unserviceable'];
                const safeName   = escapeHtml(item.name || '');
                const safeId     = escapeHtml(item.equipmentId || '');
                const safeCampus = escapeHtml(item.campus || '');
                const safeStatus = escapeHtml(item.status || '');
                const safeLab    = escapeHtml(item.laboratoryRoom || '');
                const safeSN     = escapeHtml(item.serialNumber || '');
                const safeEquipmentDetails = escapeHtml([item.name, item.serialNumber ? `SN ${item.serialNumber}` : ''].filter(Boolean).join(' · ') || 'Equipment details unavailable');
                const safeSetId  = escapeHtml(item.setId || '');
                const safeLastBorrower = escapeHtml(item.lastBorrower?.name || '—');
                const formattedDate = item.dateAdded ? new Date(item.dateAdded).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : 'N/A';
                const isMissing = item.status === 'Missing';
                const rowStyle  = isMissing ? 'background:rgba(251,191,36,.04);' : '';
                return `
                    <tr class="table-row-hover" data-equipment-id="${safeId}" style="${rowStyle}">
                        <td class="px-3 py-2">
                            <span class="equipment-id-tooltip-trigger" tabindex="0" data-tooltip="${safeEquipmentDetails}" aria-label="${safeId}; hover or focus for equipment details">${safeId}</span>
                        </td>
                        <td class="px-3 py-2 text-sm font-mono text-slate-300">${safeSN || '<span class="text-slate-600 text-xs italic">—</span>'}</td>
                        <td class="px-3 py-2 text-sm">
                            ${safeSetId
                                ? `<span class="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-semibold" style="background:rgba(74,222,128,.12);color:#6ee7b7;border:1px solid rgba(74,222,128,.2);">${safeSetId}</span>`
                                : '<span class="text-slate-600 text-xs italic">—</span>'}
                        </td>
                        <td class="px-3 py-2 text-sm text-slate-300">${safeCampus}</td>
                        <td class="px-3 py-2">
                            <span class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold" style="${badgeStyle}">
                                ${isMissing ? '<i class="fas fa-exclamation-triangle" style="font-size:0.65rem;"></i>' : ''}
                                ${safeStatus}
                            </span>
                        </td>
                        <td class="px-3 py-2 text-xs text-slate-400" data-last-borrower-cell="${safeId}">${safeLastBorrower}</td>
                        <td class="px-3 py-2 text-xs text-slate-400">${formattedDate}</td>
                        <td class="px-2 py-2">
                            <div class="actions-cell equipment-row-actions">
                                <button type="button" data-action="view-qr" data-id="${safeId}" class="action-btn action-btn-qr" title="View QR Code" aria-label="View QR code for ${safeName}">
                                    <i class="fas fa-qrcode"></i>
                                </button>
                                <div class="action-dropdown">
                                    <button type="button" class="dropdown-toggle" title="Actions" onclick="toggleDropdown(event, '${safeId}')">
                                        <i class="fas fa-ellipsis-v"></i>
                                    </button>
                                    <div class="dropdown-menu" id="dropdown-${safeId}">
                                        <button type="button" data-action="edit"
                                            data-id="${safeId}" data-name="${safeName}" data-campus="${safeCampus}"
                                            data-status="${safeStatus}" data-lab="${safeLab}"
                                            data-sn="${safeSN}" data-setid="${safeSetId}"
                                            class="dropdown-item edit">
                                            <i class="fas fa-edit"></i>
                                            <span>Edit Equipment</span>
                                        </button>
                                        ${isMissing
                                            ? `<button type="button" data-action="mark-found" data-id="${safeId}" data-name="${safeName}"
                                                    class="dropdown-item edit">
                                                    <i class="fas fa-check-circle"></i>
                                                    <span>Mark as Found</span>
                                                </button>`
                                            : `<button type="button" data-action="report-missing" data-id="${safeId}" data-name="${safeName}"
                                                    class="dropdown-item warning">
                                                    <i class="fas fa-exclamation-triangle"></i>
                                                    <span>Report Missing</span>
                                                </button>`
                                        }
                                        <button type="button" data-action="transfer-set"
                                            data-id="${safeId}" data-name="${safeName}" data-setid="${safeSetId}"
                                            class="dropdown-item purple">
                                            <i class="fas fa-exchange-alt"></i>
                                            <span>Replace / Transfer to Set</span>
                                        </button>
                                        <button type="button" data-action="view-history" data-id="${safeId}" data-name="${safeName}"
                                            class="dropdown-item info">
                                            <i class="fas fa-history"></i>
                                            <span>View History</span>
                                        </button>
                                        ${canArchiveRecords ? `<div class="dropdown-divider"></div>
                                        <button type="button" data-action="archive" data-id="${safeId}" class="dropdown-item">
                                            <i class="fas fa-box-archive"></i>
                                            <span>Archive Equipment</span>
                                        </button>` : ''}
                                    </div>
                                </div>
                            </div>
                        </td>
                    </tr>`;
            }).join('') : `
                <tr>
                    <td colspan="8" class="px-5 py-6 text-center text-slate-500">No equipment found.</td>
                </tr>`;

            if (append && sourceItems.length) {
                tbody.insertAdjacentHTML('beforeend', renderedRows);
            } else {
                tbody.innerHTML = renderedRows;
            }

            renderPaginationControls();
        }

        function handleEquipmentTableClick(event) {
            const button = event.target.closest('button[data-action]');
            if (!button) return;
            
            // Close all dropdowns when an action is clicked
            const allDropdowns = document.querySelectorAll('.dropdown-menu');
            allDropdowns.forEach(dd => {
                dd.classList.remove('show');
            });
            
            const action = button.dataset.action;
            const id = button.dataset.id;
            if (action === 'view-qr') {
                viewEquipmentQr(id);
            } else if (action === 'edit') {
                editEquipment(
                    id,
                    button.dataset.name,
                    button.dataset.campus,
                    button.dataset.status,
                    button.dataset.lab,
                    button.dataset.sn,
                    button.dataset.setid
                );
            } else if (action === 'archive') {
                archiveEquipment(id);
            } else if (action === 'report-missing') {
                openReportMissingModal(id, button.dataset.name);
            } else if (action === 'mark-found') {
                openMarkFoundModal(id, button.dataset.name);
            } else if (action === 'transfer-set') {
                openTransferSetModal(id, button.dataset.name, button.dataset.setid);
            } else if (action === 'view-history') {
                openEquipmentHistoryModal(id, button.dataset.name);
            }
        }

        function toggleSidebar() {
            const sidebar = document.getElementById('sidebar');
            if (!sidebar) return;
            sidebar.classList.toggle('mobile-open');
        }

        function setActive(event) {
            event.preventDefault();
            const items = document.querySelectorAll('.nav-item');
            items.forEach(item => item.classList.remove('active'));
            const target = event.target.closest('.nav-item');
            if (target) target.classList.add('active');
            
            if (window.innerWidth < 768) {
                const sidebar = document.getElementById('sidebar');
                if (sidebar) sidebar.classList.remove('mobile-open');
            }
        }

        function openModal(modalId) {
            const modal = document.getElementById(modalId);
            if (modal) {
                modal.classList.add('show');
            }
        }

        function closeModal(modalId) {
            const modal = document.getElementById(modalId);
            if (modal) {
                modal.classList.remove('show');
            }
        }

        function editEquipment(id, name, campus, status, laboratoryRoom, serialNumber, setId) {
            document.getElementById('editEquipmentId').value = id;
            document.getElementById('editEquipmentName').value = name.replace(/&quot;/g, '"').replace(/&#39;/g, "'");
            document.getElementById('editCampus').value = campus;
            document.getElementById('editLaboratoryRoom').value = laboratoryRoom || '';
            document.getElementById('editEquipmentStatusHidden').value = status || 'Serviceable';
            document.getElementById('editSerialNumber').value = serialNumber || '';
            document.getElementById('editSetId').value = setId || '';
            openModal('editModal');
        }

        function archiveEquipment(id) {
            equipmentToDelete = id;
            document.getElementById('deleteEquipmentId').textContent = id;
            openModal('deleteModal');
        }

        async function confirmArchive() {
            if (!equipmentToDelete) return;
            const response = await fetch(`/api/archive/equipment/${encodeURIComponent(equipmentToDelete)}`, { method: 'POST' });
            if (response.ok) {
                await loadEquipment(1, true);
                closeModal('deleteModal');
            } else {
                const result = await response.json().catch(() => ({}));
                alert(result.error || 'Failed to archive equipment.');
            }
        }

        function getCampusOption(value) {
            const key = normalizeCampusKey(value);
            return ['Calapan Campus', 'Victoria Campus', 'Bongabong Campus']
                .find((campus) => normalizeCampusKey(campus) === key) || '';
        }

        function normalizeSetLaboratory(value) {
            const normalized = String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
            if (normalized.includes('2')) return 'Lab2';
            if (normalized.includes('1')) return 'Lab1';
            return '';
        }

        function getComponentSetOptions(category = '') {
            const campus = normalizeCampusKey(getCurrentUserCampus());
            return addInventorySets.filter((set) => {
                if (String(set.computedStatus || set.status || '').toLowerCase() === 'retired') return false;
                if (Number(set.campusCount || 0) > 1 || !normalizeSetLaboratory(set.location)) return false;
                if (set.campus && normalizeCampusKey(set.campus) !== campus) return false;
                if (!set.campus && String(set.createdBy || '') !== String(window.__CURRENT_USER__?.id || '')) return false;
                const categories = Array.isArray(set.componentCategories) ? set.componentCategories : [];
                return !category || !categories.some((value) => String(value).toLowerCase() === category.toLowerCase());
            });
        }

        function renderAddComponentSetOptions(selectedSetId = '') {
            const select = document.getElementById('addSetId');
            if (!select) return;
            selectedSetId = selectedSetId || select.value;
            select.replaceChildren(new Option('Not assigned to a PC set', ''));
            const category = document.getElementById('addEquipmentName')?.value || '';
            getComponentSetOptions(category).forEach((set) => {
                const lab = normalizeSetLaboratory(set.location);
                const campus = getCampusOption(set.campus || getCurrentUserCampus());
                const option = new Option(`${set.setId} — ${set.setName || 'PC set'}${lab ? ` · ComLab ${lab.slice(-1)}` : ''}`, set.setId);
                option.dataset.campus = campus;
                option.dataset.laboratoryRoom = lab;
                select.add(option);
            });
            if (selectedSetId && [...select.options].some((option) => option.value === selectedSetId)) {
                select.value = selectedSetId;
            }
        }

        async function loadAddInventorySets() {
            const help = document.getElementById('addEquipmentSetHelp');
            const response = await fetch('/api/equipment-sets', { cache: 'no-store' });
            if (!response.ok) {
                throw new Error('Could not load PC sets. Refresh and try again.');
            }
            const data = await response.json();
            if (!data.success || !Array.isArray(data.sets)) {
                throw new Error(data.message || 'Could not load PC sets.');
            }
            addInventorySets = data.sets;
            renderAddComponentSetOptions();
            if (help) help.classList.add('hidden');
        }

        function syncAddEquipmentSetFields() {
            const setSelect = document.getElementById('addSetId');
            const selectedOption = setSelect?.selectedOptions?.[0];
            const hasSet = Boolean(setSelect?.value);
            const campus = document.getElementById('addCampus');
            const room = document.getElementById('addLaboratoryRoom');
            const help = document.getElementById('addEquipmentSetHelp');

            if (hasSet) {
                campus.value = selectedOption.dataset.campus || getCampusOption(getCurrentUserCampus());
                room.value = selectedOption.dataset.laboratoryRoom || '';
            } else {
                campus.value = getCampusOption(getCurrentUserCampus());
                room.value = '';
            }
            campus.disabled = true;
            room.disabled = hasSet;
            if (help) {
                help.textContent = hasSet
                    ? 'Campus and ComLab are taken from the selected PC set to keep its components in the correct location.'
                    : '';
                help.classList.toggle('hidden', !hasSet);
            }
        }

        function suggestNextPCSetId() {
            const nextId = addInventorySets.reduce((max, set) => {
                const match = String(set.setId || '').match(/^PC-SET-(\d+)$/i);
                return match ? Math.max(max, Number(match[1])) : max;
            }, 0) + 1;
            const suggestion = `PC-SET-${String(nextId).padStart(3, '0')}`;
            const input = document.getElementById('newSetId');
            const hint = document.getElementById('newSetIdSuggestion');
            if (input && !input.value) input.value = suggestion;
            if (hint) hint.textContent = `Suggested next ID: ${suggestion}. The server checks that IDs are unique.`;
        }

        function setAddInventoryMode(preferredMode = '') {
            const form = document.getElementById('addInventoryForm');
            const mode = preferredMode || document.getElementById('addRecordType')?.value || 'equipment';
            const isPCSet = mode === 'pc-set';
            const selector = document.getElementById('addRecordType');
            if (preferredMode && selector) selector.value = preferredMode;
            document.getElementById('addEquipmentFields')?.classList.toggle('hidden', isPCSet);
            document.getElementById('addPCSetFields')?.classList.toggle('hidden', !isPCSet);
            document.getElementById('addInventoryTitle').textContent = isPCSet ? 'Create PC Set' : 'Add Equipment Component';
            document.getElementById('addInventorySubmit').textContent = isPCSet ? 'Create PC set' : 'Add component';
            const campusNote = document.getElementById('addInventoryCampusNote');
            if (campusNote) {
                const accountCampus = getCampusOption(getCurrentUserCampus());
                campusNote.textContent = accountCampus
                    ? isPCSet
                        ? `The set is linked to your account. Its first component must use ${accountCampus} and the selected ComLab.`
                        : `New equipment is created under ${accountCampus}; campus is set from your account.`
                    : 'Your account has no recognized campus. Ask an administrator to update your profile before adding inventory.';
                document.getElementById('addInventorySubmit').disabled = !accountCampus;
            }

            ['addEquipmentName', 'addLaboratoryRoom', 'addCampus'].forEach((id) => {
                const field = document.getElementById(id);
                if (field) field.required = !isPCSet;
            });
            ['newSetId', 'newSetName', 'newLocation'].forEach((id) => {
                const field = document.getElementById(id);
                if (field) field.required = isPCSet;
            });
            if (form) form.dataset.mode = mode;
            if (isPCSet) suggestNextPCSetId();
        }

        async function openAddInventoryModal(preferredMode = '') {
            const form = document.getElementById('addInventoryForm');
            if (form) form.reset();
            initializeCampusDefaults();
            const currentView = document.getElementById('viewModeFilter')?.value;
            const mode = preferredMode || (currentView === 'pc-sets' ? 'pc-set' : 'equipment');
            setAddInventoryMode(mode);
            openModal('addModal');
            try {
                await loadAddInventorySets();
                renderAddComponentSetOptions();
                suggestNextPCSetId();
                syncAddEquipmentSetFields();
            } catch (error) {
                console.error('[equipment] Could not load PC sets for the add form:', error);
                const help = document.getElementById('addEquipmentSetHelp');
                if (help) {
                    help.textContent = error.message;
                    help.classList.remove('hidden');
                }
            }
        }

        async function handleAddInventory(event) {
            event.preventDefault();
            const form = event.currentTarget;
            const isPCSet = form.dataset.mode === 'pc-set';
            const endpoint = isPCSet ? '/api/equipment-sets' : '/api/equipment';
            const data = isPCSet
                ? {
                    setId: document.getElementById('newSetId').value.trim(),
                    setName: document.getElementById('newSetName').value.trim(),
                    description: document.getElementById('newDescription').value.trim() || null,
                    location: document.getElementById('newLocation').value
                }
                : {
                    name: document.getElementById('addEquipmentName').value,
                    campus: document.getElementById('addCampus').value,
                    laboratoryRoom: document.getElementById('addLaboratoryRoom').value,
                    serialNumber: document.getElementById('addSerialNumber').value.trim() || null,
                    setId: document.getElementById('addSetId').value || null,
                    status: 'Serviceable'
                };

            const response = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });
            const result = await response.json().catch(() => ({}));
            if (!response.ok || result.success === false) {
                alert(result.error || result.message || (isPCSet ? 'Failed to create PC set.' : 'Failed to add equipment.'));
                return;
            }

            await loadEquipment(1, true);
            if (document.getElementById('viewModeFilter')?.value === 'pc-sets') await loadPCSets();
            closeModal('addModal');
            form.reset();
            initializeCampusDefaults();
            setAddInventoryMode('equipment');
        }

        async function handleEditEquipment(event) {
            event.preventDefault();
            const id = document.getElementById('editEquipmentId')?.value || '';
            const data = {
                name: document.getElementById('editEquipmentName')?.value?.trim() || '',
                campus: document.getElementById('editCampus')?.value || '',
                laboratoryRoom: document.getElementById('editLaboratoryRoom')?.value?.trim() || '',
                status: document.getElementById('editEquipmentStatusHidden')?.value || 'Serviceable',
                serialNumber: document.getElementById('editSerialNumber')?.value?.trim() || null,
            };
            // Only send setId if the field has a value (don't accidentally clear it)
            const editSetIdVal = document.getElementById('editSetId')?.value?.trim();
            if (editSetIdVal !== undefined) data.setId = editSetIdVal || null;

            const response = await fetch(`/api/equipment/${encodeURIComponent(id)}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });

            if (response.ok) {
                await loadEquipment(1, true);
                closeModal('editModal');
            } else {
                const result = await response.json().catch(() => ({}));
                alert(result.error || 'Failed to update equipment.');
            }
        }

        async function filterEquipment() {
            if (document.getElementById('viewModeFilter')?.value === 'pc-sets') {
                await loadPCSetsTable();
                return;
            }
            // Reload equipment data when campus filter changes
            await loadEquipment(1);
        }

        async function changeViewMode() {
            const viewMode = document.getElementById('viewModeFilter')?.value || 'all';
            
            if (viewMode === 'pc-sets') {
                inventoryAssignmentFilter = '';
                currentEquipmentPage = 1;
                // Show PC sets in table with expandable rows
                await loadPCSetsTable();
            } else {
                // Show regular equipment view - restore headers
                document.getElementById('equipmentTableSection')?.classList.remove('pc-sets-view');
                const thead = document.getElementById('tableHeaderRow');
                thead.innerHTML = `
                    <th class="px-5 py-3 text-left text-sm font-semibold text-slate-300 uppercase">Equipment</th>
                    <th class="px-5 py-3 text-left text-sm font-semibold text-slate-300 uppercase">Serial Number</th>
                    <th class="px-5 py-3 text-left text-sm font-semibold text-slate-300 uppercase">PC Station</th>
                    <th class="px-5 py-3 text-left text-sm font-semibold text-slate-300 uppercase">Campus</th>
                    <th class="px-5 py-3 text-left text-sm font-semibold text-slate-300 uppercase">Condition</th>
                    <th class="px-5 py-3 text-left text-sm font-semibold text-slate-300 uppercase">Last Borrower</th>
                    <th class="px-5 py-3 text-left text-sm font-semibold text-slate-300 uppercase">Date Added</th>
                    <th class="px-5 py-3 text-left text-sm font-semibold text-slate-300 uppercase">Actions</th>
                `;
                await filterEquipment();
            }
            renderStats();
        }

        async function loadPCSets() {
            try {
                const response = await fetch('/api/equipment-sets');
                if (!response.ok) throw new Error('Failed to fetch PC sets');
                
                const data = await response.json();
                if (data.success) {
                    renderPCSetsView(data.sets);
                }
            } catch (error) {
                console.error('Error loading PC sets:', error);
                renderPCSetsView([]);
            }
        }

        function renderPCSetsView(sets) {
            const tableSection = document.querySelector('.card.overflow-hidden');
            if (!tableSection) return;

            if (!sets || sets.length === 0) {
                tableSection.innerHTML = `
                    <div class="p-8 text-center text-slate-400">
                        <i class="fas fa-desktop text-4xl mb-4 text-emerald-800"></i>
                        <p class="text-lg">No PC sets found</p>
                        <button onclick="openAddInventoryModal('pc-set')" class="mt-4 btn-primary rounded-lg px-4 py-2 text-sm">
                            <i class="fas fa-plus"></i> Create PC Set
                        </button>
                    </div>
                `;
                return;
            }

            // Create grid layout for PC sets
            tableSection.innerHTML = `
                <div class="p-4">
                    <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
                        ${sets.map(set => createPCSetCard(set)).join('')}
                    </div>
                </div>
            `;
        }

        function createPCSetCard(set) {
            const statusColors = {
                'active':      'background:rgb(20, 83, 45);color:#86efac;border-color:rgba(34,197,94,.3);',
                'incomplete':  'background:rgb(133, 77, 14);color:#fcd34d;border-color:rgba(251,191,36,.3);',
                'maintenance': 'background:rgb(88, 28, 135);color:#c4b5fd;border-color:rgba(139,92,246,.3);',
                'retired':     'background:rgba(107,114,128,.15);color:#d1d5db;border-color:rgba(107,114,128,.3);',
            };
            const sc = statusColors[set.status] || statusColors['incomplete'];
            const missing   = Number(set.missingCount || 0);
            const total     = Number(set.componentCount || 0);
            const pct       = Number(set.completenessPercent ?? (total > 0 ? Math.round((Number(set.serviceableCount||0)/total)*100) : 0));
            const barColor  = pct === 100 ? '#22c55e' : pct >= 75 ? '#84cc16' : pct >= 50 ? '#eab308' : '#ef4444';

            return `
                <div class="card-hover rounded-xl p-5" style="border:1px solid rgba(74,222,128,.15);">
                    <!-- Header -->
                    <div class="flex items-start justify-between mb-3">
                        <div class="min-w-0 flex-1">
                            <div class="flex items-center gap-2 flex-wrap">
                                <h3 class="text-lg font-bold text-emerald-400 font-mono">${escapeHtml(set.setId)}</h3>
                                <span class="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold border" style="${sc}">${escapeHtml(set.status||'unknown')}</span>
                                ${missing > 0 ? `<span class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-bold" style="background:rgb(133, 77, 14);color:#fcd34d;border:1px solid rgba(251,191,36,.3);"><i class="fas fa-exclamation-triangle" style="font-size:0.6rem;"></i>${missing} missing</span>` : ''}
                            </div>
                            <p class="text-sm text-slate-300 mt-0.5">${escapeHtml(set.setName||'')}</p>
                            ${set.location ? `<p class="text-xs text-slate-500 mt-0.5"><i class="fas fa-map-marker-alt mr-1"></i>${escapeHtml(set.location)}</p>` : ''}
                        </div>
                        <div class="ml-3 text-right shrink-0">
                            <div class="text-lg font-bold" style="color:${barColor};">${pct}%</div>
                            <div class="text-xs text-slate-500">complete</div>
                        </div>
                    </div>

                    <!-- Completeness bar -->
                    <div class="mb-4 rounded-full h-1.5 overflow-hidden" style="background:rgba(255,255,255,.07);">
                        <div class="h-full rounded-full transition-all" style="width:${pct}%;background:${barColor};"></div>
                    </div>

                    ${set.description ? `<p class="text-xs text-slate-500 mb-3">${escapeHtml(set.description)}</p>` : ''}

                    <!-- Components -->
                    <div class="rounded-lg p-3 mb-4" style="background:rgba(0,0,0,.25);border:1px solid rgba(74,222,128,.08);">
                        <div class="flex items-center justify-between mb-2">
                            <span class="text-xs font-semibold uppercase tracking-wide text-slate-400"><i class="fas fa-cube mr-1 text-emerald-600"></i>Components</span>
                            <span class="text-xs text-slate-500">${total} item${total!==1?'s':''}</span>
                        </div>
                        <div id="components-${escapeHtml(set.setId)}" class="space-y-1.5">
                            ${set.components ? parseComponentsEnhanced(set.components) : '<p class="text-xs text-slate-600 italic">No components yet</p>'}
                        </div>
                    </div>

                    <!-- Actions -->
                    <div class="flex items-center gap-2 flex-wrap">
                        <button onclick="viewSetComponents('${escapeHtml(set.setId)}')" class="flex-1 btn-secondary rounded-lg px-3 py-2 text-sm font-medium">
                            <i class="fas fa-list mr-1"></i> Manage
                        </button>
                        <button onclick="editPCSet('${escapeHtml(set.setId)}')" class="btn-secondary rounded-lg px-3 py-2 text-sm font-medium" title="Edit Set">
                            <i class="fas fa-edit"></i>
                        </button>
                    </div>
                </div>
            `;
        }

        function parseComponentsEnhanced(componentsString) {
            if (!componentsString) return '<p class="text-xs text-slate-600 italic">No components</p>';
            const parts = String(componentsString).matchAll(/(.+?)\s+\[([^\]]+)\](?:,\s*|$)/g);
            return [...parts].map(([, namepart, rawStatus]) => {
                const status = rawStatus.trim();
                const normalizedStatus = status.toLowerCase();
                const icon = getCategoryIcon(namepart);
                const isMissing = normalizedStatus === 'missing';
                const isUnderMaint = normalizedStatus === 'under maintenance';
                const dotColor = isMissing ? '#fcd34d' : isUnderMaint ? '#c4b5fd' : normalizedStatus === 'serviceable' ? '#86efac' : '#9ca3af';
                return `
                    <div class="flex items-center gap-2 text-xs ${isMissing ? 'opacity-80' : ''}">
                        <span class="w-2 h-2 rounded-full flex-shrink-0" style="background:${dotColor};"></span>
                        <i class="${icon} text-emerald-600 w-3 flex-shrink-0" style="font-size:0.65rem;"></i>
                        <span class="${isMissing ? 'line-through text-slate-500' : 'text-slate-300'}">${escapeHtml(namepart)}</span>
                        ${isMissing ? `<span class="ml-auto font-semibold" style="color:#fcd34d;font-size:0.6rem;">MISSING</span>` : ''}
                        ${isUnderMaint ? `<span class="ml-auto font-semibold" style="color:#c4b5fd;font-size:0.6rem;">MAINT.</span>` : ''}
                    </div>`;
            }).join('');
        }

        function parseComponents(componentsString) {
            if (!componentsString) return '<p class="text-sm text-slate-400">No components</p>';
            
            const components = componentsString.split(', ');
            return components.map(comp => {
                const icon = getCategoryIcon(comp);
                return `
                    <div class="flex items-center gap-2 text-sm text-slate-300">
                        <i class="${icon} text-emerald-400 w-4"></i>
                        <span>${comp}</span>
                    </div>
                `;
            }).join('');
        }

        function getCategoryIcon(component) {
            if (component.toLowerCase().includes('system unit') || component.includes('CPU')) return 'fas fa-microchip';
            if (component.includes('Monitor')) return 'fas fa-desktop';
            if (component.includes('Keyboard')) return 'fas fa-keyboard';
            if (component.includes('Mouse')) return 'fas fa-mouse';
            if (component.includes('AVR')) return 'fas fa-plug';
            return 'fas fa-cube';
        }

        async function viewSetComponents(setId) {
            try {
                const response = await fetch(`/api/equipment-sets/${setId}`);
                const data = await response.json();
                
                if (data.success) {
                    showComponentsModal(data.set, data.components);
                }
            } catch (error) {
                console.error('Error loading components:', error);
                alert('Failed to load components');
            }
        }

        function showComponentsModal(set, components) {
            const categoryCounts = components.reduce((counts, component) => {
                const category = String(component.category || '').trim().toLowerCase();
                if (category) counts.set(category, (counts.get(category) || 0) + 1);
                return counts;
            }, new Map());
            const modal = document.createElement('div');
            modal.className = 'modal show';
            modal.innerHTML = `
                <div class="modal-content mx-auto w-full max-w-3xl">
                    <div class="flex items-start justify-between mb-6">
                        <div>
                            <h3 class="text-2xl font-bold text-white">${set.setName}</h3>
                            <p class="text-slate-400 mt-1">${set.setId} - Components</p>
                        </div>
                        <button onclick="this.closest('.modal').remove()" class="text-2xl text-emerald-400 hover:text-emerald-200">
                            <i class="fas fa-times"></i>
                        </button>
                    </div>

                    <div class="space-y-3 max-h-96 overflow-y-auto mb-6">
                        ${components.length === 0 ? '<p class="text-slate-400 text-center py-8">No components in this set</p>' : 
                            components.map(comp => {
                                const isMissing = comp.status === 'Missing';
                                const isUnderMaint = comp.status === 'Under Maintenance';
                                const hasDuplicateType = (categoryCounts.get(String(comp.category || '').trim().toLowerCase()) || 0) > 1;
                                const statusStyle = isMissing
                                    ? 'background:rgba(251,191,36,.1);border:1px solid rgba(251,191,36,.2);'
                                    : isUnderMaint
                                        ? 'background:rgba(139,92,246,.1);border:1px solid rgba(139,92,246,.2);'
                                        : 'background:rgba(74,222,128,.05);border:1px solid rgba(74,222,128,.15);';
                                const statusColor = isMissing ? '#fcd34d' : isUnderMaint ? '#c4b5fd' : comp.status === 'Serviceable' ? '#86efac' : '#9ca3af';
                                return `
                                <div class="rounded-lg p-4 flex items-start justify-between" style="${statusStyle}">
                                    <div class="flex-1 min-w-0">
                                        <div class="font-semibold flex items-center gap-2 ${isMissing ? 'text-yellow-200' : 'text-white'}">
                                            <i class="${getCategoryIcon(comp.category)} text-emerald-400"></i>
                                            ${escapeHtml(comp.name)}
                                            ${hasDuplicateType ? '<span class="text-xs font-bold px-1.5 py-0.5 rounded" style="background:rgba(239,68,68,.15);color:#fca5a5;">DUPLICATE TYPE</span>' : ''}
                                            ${isMissing ? '<span class="text-xs font-bold px-1.5 py-0.5 rounded" style="background:rgba(251,191,36,.2);color:#fcd34d;">MISSING</span>' : ''}
                                            ${isUnderMaint ? '<span class="text-xs font-bold px-1.5 py-0.5 rounded" style="background:rgba(139,92,246,.2);color:#c4b5fd;">MAINTENANCE</span>' : ''}
                                        </div>
                                        <div class="text-sm text-slate-400 mt-1">
                                            ${escapeHtml(comp.category)} •
                                            SN: <span class="font-mono">${escapeHtml(comp.serialNumber || 'N/A')}</span> •
                                            <span style="color:${statusColor};">${escapeHtml(comp.status)}</span>
                                        </div>
                                        ${comp.manufacturer || comp.model ? `<div class="text-xs text-slate-500 mt-1">${escapeHtml(comp.manufacturer||'')} ${escapeHtml(comp.model||'')}</div>` : ''}
                                        ${comp.location ? `<div class="text-xs text-slate-500"><i class="fas fa-map-marker-alt mr-1"></i>${escapeHtml(comp.location)}</div>` : ''}
                                    </div>
                                    ${!isMissing ? `
                                    <button onclick="removeComponentFromSet('${escapeHtml(set.setId)}', ${comp.id})"
                                            class="text-red-400 hover:text-red-300 ml-4 flex-shrink-0" title="Remove from set">
                                        <i class="fas fa-times"></i>
                                    </button>` : `
                                    <div class="ml-4 flex-shrink-0 text-xs text-yellow-500/60 italic">Cannot remove<br>while missing</div>`}
                                </div>`;
                            }).join('')
                        }
                    </div>

                    <div class="flex gap-3">
                        <button onclick="addComponentsToSet('${set.setId}')" class="flex-1 btn-primary rounded-lg px-4 py-2.5 text-sm font-medium">
                            <i class="fas fa-plus"></i> Add Components
                        </button>
                        <button onclick="this.closest('.modal').remove()" class="btn-secondary rounded-lg px-4 py-2.5 text-sm font-medium">
                            Close
                        </button>
                    </div>
                </div>
            `;
            document.body.appendChild(modal);
        }

        async function removeComponentFromSet(setId, componentId) {
            if (!await window.appDialogs.confirm('Remove this component from the set?')) return;

            try {
                const response = await fetch(`/api/equipment-sets/${setId}/components/${componentId}`, {
                    method: 'DELETE'
                });
                
                const data = await response.json();
                if (data.success) {
                    // Close modal and reload
                    document.querySelectorAll('.modal').forEach(m => m.remove());
                    await loadPCSets();
                    alert('Component removed successfully');
                } else {
                    alert(data.message || 'Failed to remove component');
                }
            } catch (error) {
                console.error('Error:', error);
                alert('Failed to remove component');
            }
        }

        async function addComponentsToSet(setId) {
            try {
                const [response, setResponse] = await Promise.all([
                    fetch('/api/equipment/available-for-sets'),
                    fetch(`/api/equipment-sets/${encodeURIComponent(setId)}`)
                ]);
                const [data, setData] = await Promise.all([
                    response.json(),
                    setResponse.json()
                ]);

                if (response.ok && data.success && setResponse.ok && setData.success) {
                    showAddComponentsModal(setId, data.equipment, setData.components || []);
                } else {
                    throw new Error(data.message || data.error || setData.message || setData.error || 'Failed to load available equipment');
                }
            } catch (error) {
                console.error('Error:', error);
                alert(error.message || 'Failed to load available equipment');
            }
        }

        function showAddComponentsModal(setId, equipment, currentComponents = []) {
            const assignedCategories = new Set(
                currentComponents.map(component => String(component.category || '').trim().toLowerCase()).filter(Boolean)
            );
            const seenCategories = new Set();
            const duplicateCategories = new Set();
            currentComponents.forEach(component => {
                const category = String(component.category || '').trim().toLowerCase();
                if (category && seenCategories.has(category)) duplicateCategories.add(component.category);
                if (category) seenCategories.add(category);
            });
            const availableEquipment = equipment.filter(item =>
                !assignedCategories.has(String(item.category || '').trim().toLowerCase())
            );
            const modal = document.createElement('div');
            modal.className = 'modal show';
            modal.innerHTML = `
                <div class="modal-content mx-auto w-full max-w-3xl">
                    <div class="flex items-start justify-between mb-3">
                        <h3 class="text-xl font-bold text-white">Add Components to Set</h3>
                        <button onclick="this.closest('.modal').remove()" class="text-2xl text-emerald-400 hover:text-emerald-200">
                            <i class="fas fa-times"></i>
                        </button>
                    </div>

                    <input id="componentSearch" type="search" placeholder="Search by equipment ID, name, serial number, or category..."
                           aria-label="Search available equipment"
                           class="mb-1 w-full rounded-lg border border-emerald-800/60 bg-[#060e0a] px-3 py-2 text-emerald-100 placeholder:text-slate-500 focus:border-emerald-500 focus:outline-none" />
                    <div id="componentSearchCount" class="mb-2 text-xs text-slate-400">${availableEquipment.length} available equipment items</div>
                    ${assignedCategories.size ? `<p class="mb-2 text-xs text-amber-300">Already in this PC set (cannot add duplicates): ${[...assignedCategories].map(category => category.replace(/\b\w/g, letter => letter.toUpperCase())).join(', ')}</p>` : ''}
                    ${duplicateCategories.size ? `<p class="mb-2 text-xs text-red-300">This set already has duplicate types: ${[...duplicateCategories].join(', ')}. Remove the extra items before adding more.</p>` : ''}
                    <div class="space-y-1 max-h-96 overflow-y-auto mb-4" id="availableEquipmentList">
                        ${availableEquipment.length === 0 ? '<p class="text-slate-400 text-center py-8">No equipment types are available to add to this PC set.</p>' :
                            availableEquipment.map(item => `
                                <label class="bg-emerald-950/30 border border-emerald-800/40 rounded-md p-2 flex items-start gap-2 cursor-pointer hover:border-emerald-600/40" style="padding:6px 10px;gap:8px;">
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
                    <p id="componentSearchEmpty" class="hidden mb-6 text-center text-sm text-slate-400">No equipment matches your search.</p>

                    <div class="flex gap-3">
                        <button onclick="saveSelectedComponents('${setId}')" class="flex-1 btn-primary rounded-lg px-4 py-2.5 text-sm font-medium">
                            <i class="fas fa-check"></i> Add Components
                        </button>
                        <button onclick="this.closest('.modal').remove()" class="btn-secondary rounded-lg px-4 py-2.5 text-sm font-medium">
                            Cancel
                        </button>
                    </div>
                </div>
            `;
            document.body.appendChild(modal);
            const searchInput = modal.querySelector('#componentSearch');
            const searchCount = modal.querySelector('#componentSearchCount');
            const emptyMessage = modal.querySelector('#componentSearchEmpty');
            const availableItems = [...modal.querySelectorAll('#availableEquipmentList label')];
            const categoryCheckboxes = [...modal.querySelectorAll('.component-checkbox')];
            categoryCheckboxes.forEach(checkbox => checkbox.addEventListener('change', () => {
                const selectedCategories = new Set(
                    categoryCheckboxes.filter(item => item.checked).map(item => item.dataset.category)
                );
                categoryCheckboxes.forEach(item => {
                    if (!item.checked) item.disabled = selectedCategories.has(item.dataset.category);
                });
            }));

            searchInput.addEventListener('input', () => {
                const query = searchInput.value.trim().toLowerCase();
                let visibleCount = 0;
                availableItems.forEach((item) => {
                    const matches = item.textContent.toLowerCase().includes(query);
                    item.style.display = matches ? '' : 'none';
                    if (matches) visibleCount++;
                });

                searchCount.textContent = query
                    ? `${visibleCount} of ${availableItems.length} equipment items shown`
                    : `${availableItems.length} available equipment items`;
                emptyMessage.classList.toggle('hidden', !query || visibleCount > 0);
            });
        }

        async function saveSelectedComponents(setId) {
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
                    await loadPCSets();
                    alert(data.message);
                } else {
                    alert(data.message || 'Failed to add components');
                }
            } catch (error) {
                console.error('Error:', error);
                alert('Failed to add components');
            }
        }

        function editPCSet(setId) {
            window.location.href = '/pc-set-management';
        }

        function navigateToPCSetManagement() {
            window.location.href = '/pc-set-management';
        }

        function openCategoryModal() {
            document.getElementById('newCategoryName').value = '';
            document.getElementById('newCategoryPrefix').value = '';
            openModal('categoryModal');
        }

        async function handleSaveCategory(event) {
            event.preventDefault();
            const name = document.getElementById('newCategoryName').value.trim();
            const prefix = document.getElementById('newCategoryPrefix').value.trim().toUpperCase();

            if (!name || !prefix) {
                return alert('Category name and prefix are required.');
            }

            const response = await fetch('/api/equipment-categories', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, prefix })
            });

            if (response.ok) {
                await loadCategories();
                closeModal('categoryModal');
            } else {
                const result = await response.json().catch(() => ({}));
                alert(result.error || 'Failed to save category.');
            }
        }

        async function openArchiveCategoryModal() {
            if (!String(window.__CURRENT_USER__?.role || '').toLowerCase().includes('admin')) {
                alert('Only administrators can archive equipment types.');
                return;
            }
            await loadCategories();
            renderArchiveCategoryList();
            openModal('deleteCategoryModal');
        }

        function renderArchiveCategoryList() {
            const list = document.getElementById('deleteCategoryList');
            if (!list) return;

            list.innerHTML = '';
            const categoriesToRender = equipmentCategories.filter(category => category.name !== 'Access Point');

            if (!categoriesToRender.length) {
                list.innerHTML = '<p class="text-slate-300">No equipment types available to archive.</p>';
                return;
            }

            categoriesToRender.forEach(category => {
                const row = document.createElement('div');
                row.className = 'flex items-center justify-between border-b border-[rgba(90,255,150,0.12)] py-3';

                const label = document.createElement('span');
                label.className = 'text-slate-200';
                label.textContent = category.name;

                const button = document.createElement('button');
                button.type = 'button';
                button.className = 'btn-secondary border border-[rgba(90,255,150,0.12)] text-slate-300 px-3 py-2 rounded-2xl font-medium hover:bg-[rgba(7, 17, 31,0.9)]';
                button.textContent = 'Archive';
                button.addEventListener('click', () => archiveCategory(category.id, category.name));

                row.appendChild(label);
                row.appendChild(button);
                list.appendChild(row);
            });
        }

        async function archiveCategory(id, name) {
            if (!await window.appDialogs.confirm(`Archive equipment type "${name}"? It can be restored from Archived Records.`)) {
                return;
            }

            const response = await fetch(`/api/archive/equipment-category/${encodeURIComponent(id)}`, {
                method: 'POST'
            });

            if (response.ok) {
                await loadCategories();
                renderArchiveCategoryList();
            } else {
                const result = await response.json().catch(() => ({}));
                alert(result.error || 'Failed to archive equipment type.');
            }
        }

        function generateQrCode(payload) {
            const qrElement = document.getElementById('qrCanvas');
            if (!qrElement) return;

            const size = 320;
            qrElement.width = size;
            qrElement.height = size;
            qrElement.style.width = '100%';
            qrElement.style.height = '100%';

            const context = qrElement.getContext('2d');
            if (context) {
                context.clearRect(0, 0, size, size);
                context.fillStyle = '#ffffff';
                context.fillRect(0, 0, size, size);
                context.imageSmoothingEnabled = true;
                context.imageSmoothingQuality = 'high';
            }

            if (!window.QRious) {
                if (context) {
                    context.fillStyle = '#111827';
                    context.font = '24px sans-serif';
                    context.textAlign = 'center';
                    context.fillText('QR unavailable', size / 2, size / 2);
                }
                return;
            }

            try {
                new window.QRious({
                    element: qrElement,
                    value: payload,
                    size,
                    background: '#F4FFF1',
                    foreground: '#020617',
                    padding: 16,
                    level: 'H'
                });
            } catch (error) {
                console.warn('Failed to render QR code.', error);
                if (context) {
                    context.fillStyle = '#111827';
                    context.font = '24px sans-serif';
                    context.textAlign = 'center';
                    context.fillText('QR unavailable', size / 2, size / 2);
                }
            }
        }

        function escapeSvgValue(value) {
            return String(value || '')
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;');
        }

        function buildStickerSvgTemplate({ equipmentId, equipmentName, serialNumber, campus, laboratory, status, dateAdded, qrDataUrl }) {
            const width = 420;
            const headerHeight = 112;
            const qrSize = 300;
            const footerHeight = 78;
            const verticalGapHeaderToQr = 16;
            const verticalGapQrToInfo = 12;
            const bottomMargin = 14;
            const height = headerHeight + verticalGapHeaderToQr + qrSize + verticalGapQrToInfo + 96 + footerHeight + bottomMargin;
            const radius = 28;
            const framePadding = 12;
            const frameSize = qrSize + framePadding * 2;
            const frameX = Math.round((width - frameSize) / 2);
            const frameY = headerHeight + verticalGapHeaderToQr - framePadding;
            const qrX = frameX + framePadding;
            const qrY = frameY + framePadding;
            const footerTop = height - footerHeight - bottomMargin;
            const safeEquipmentId = escapeSvgValue(equipmentId || '—');
            const safeEquipmentName = escapeSvgValue(equipmentName || 'Not Assigned');
            const safeSerialNumber = escapeSvgValue(serialNumber || '—');
            const safeCampus = escapeSvgValue(campus || 'Not Assigned');
            const safeLaboratory = escapeSvgValue(laboratory || 'Not Assigned');
            const safeStatus = escapeSvgValue(status || 'Not Assigned');
            const safeDateAdded = escapeSvgValue(dateAdded || 'Not Assigned');

            return `
                <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
                    <rect x="1.5" y="1.5" width="${width - 3}" height="${height - 3}" rx="${radius}" ry="${radius}" fill="#F4FFF1" stroke="#16a34a" stroke-width="3"/>
                    <rect x="0" y="0" width="${width}" height="${headerHeight}" fill="#0f5132"/>
                    <text x="${width / 2}" y="44" text-anchor="middle" fill="#ffffff" font-family="Inter, Arial, sans-serif" font-size="20" font-weight="700">MINDORO STATE UNIVERSITY</text>
                    <text x="${width / 2}" y="74" text-anchor="middle" fill="#ffffff" font-family="Inter, Arial, sans-serif" font-size="13" font-weight="600">College of Computer Studies</text>
                    <text x="${width / 2}" y="96" text-anchor="middle" fill="#ffffff" font-family="Inter, Arial, sans-serif" font-size="12" font-weight="600">Computer Laboratory Facilities Management System</text>
                    <rect x="${frameX}" y="${frameY}" width="${frameSize}" height="${frameSize}" rx="14" ry="14" fill="#ffffff" stroke="#d1fae5" stroke-width="2"/>
                    <image href="${qrDataUrl}" x="${qrX}" y="${qrY}" width="${qrSize}" height="${qrSize}" preserveAspectRatio="xMidYMid meet"/>
                    <text x="${width / 2}" y="${qrY + qrSize + 20}" text-anchor="middle" fill="#111827" font-family="Inter, Arial, sans-serif" font-size="14" font-weight="700">Equipment ID</text>
                    <text x="${width / 2}" y="${qrY + qrSize + 40}" text-anchor="middle" fill="#111827" font-family="Inter, Arial, sans-serif" font-size="17" font-weight="700">${safeEquipmentId}</text>
                    <text x="${width / 2}" y="${qrY + qrSize + 60}" text-anchor="middle" fill="#111827" font-family="Inter, Arial, sans-serif" font-size="13" font-weight="700">Serial Number</text>
                    <text x="${width / 2}" y="${qrY + qrSize + 80}" text-anchor="middle" fill="#111827" font-family="Inter, Arial, sans-serif" font-size="15" font-weight="700">${safeSerialNumber}</text>
                    <line x1="40" y1="${footerTop - 12}" x2="${width - 40}" y2="${footerTop - 12}" stroke="#16a34a" stroke-width="1.2"/>
                    <text x="${width / 2}" y="${footerTop + 24}" text-anchor="middle" fill="#166534" font-family="Inter, Arial, sans-serif" font-size="13" font-weight="700">SCAN ME!</text>
                    <text x="${width / 2}" y="${footerTop + 46}" text-anchor="middle" fill="#6b7280" font-family="Inter, Arial, sans-serif" font-size="10"></text>
                </svg>`;
        }

        function renderProfessionalSticker({ equipmentId, equipmentName, serialNumber, campus, laboratory, status, dateAdded }) {
            return new Promise((resolve) => {
                const exportCanvas = document.getElementById('stickerExportCanvas');
                const qrElement = document.getElementById('qrCanvas');
                if (!exportCanvas || !qrElement) {
                    resolve('');
                    return;
                }

                const ctx = exportCanvas.getContext('2d');
                const width = 420;
                const headerHeight = 112;
                const qrSize = 300;
                const footerHeight = 78;
                const verticalGapHeaderToQr = 16;
                const verticalGapQrToInfo = 12;
                const bottomMargin = 14;
                const height = headerHeight + verticalGapHeaderToQr + qrSize + verticalGapQrToInfo + 96 + footerHeight + bottomMargin;
                exportCanvas.width = width;
                exportCanvas.height = height;

                ctx.clearRect(0, 0, width, height);
                ctx.fillStyle = '#ffffff';
                ctx.fillRect(0, 0, width, height);

                const qrImageData = qrElement.toDataURL('image/png', 1.0);
                const svgMarkup = buildStickerSvgTemplate({
                    equipmentId,
                    equipmentName,
                    serialNumber,
                    campus,
                    laboratory,
                    status,
                    dateAdded,
                    qrDataUrl: qrImageData
                });
                const svgBlob = new Blob([svgMarkup], { type: 'image/svg+xml;charset=utf-8' });
                const svgUrl = URL.createObjectURL(svgBlob);
                const stickerImage = new Image();
                stickerImage.onload = () => {
                    ctx.drawImage(stickerImage, 0, 0, width, height);
                    resolve(exportCanvas.toDataURL('image/png', 1.0));
                    URL.revokeObjectURL(svgUrl);
                };
                stickerImage.onerror = () => {
                    resolve('');
                    URL.revokeObjectURL(svgUrl);
                };
                stickerImage.src = svgUrl;
            });
        }

        async function viewEquipmentQr(id) {
            const response = await fetch(`/api/equipment/${encodeURIComponent(id)}/qr`);
            if (!response.ok) {
                const result = await response.json().catch(() => ({}));
                return alert(result.error || 'Failed to load equipment QR.');
            }

            const data = await response.json();
            const equipment = data.equipment || {};
            const qrCode = data.qrCode || '';
            const qrImage = data.qrImage || '';
            const payload = qrCode;
            const equipmentName = String(equipment.name || equipment.equipmentName || equipment.type || equipment.equipmentType || 'Equipment').trim() || 'Equipment';

            document.getElementById('qrModalEquipmentId').textContent = equipment.equipmentId || id;
            document.getElementById('qrModalEquipmentName').textContent = equipmentName;
            document.getElementById('qrModalSerialNumber').textContent = equipment.serialNumber || '—';
            document.getElementById('qrModalSetId').textContent = equipment.setId || '—';
            document.getElementById('qrModalLaboratory').textContent = equipment.laboratoryRoom || 'Not Assigned';
            document.getElementById('qrModalCampus').textContent = equipment.campus || 'Not Assigned';
            document.getElementById('qrModalTitle').textContent = equipmentName;
            document.getElementById('qrModalSubtitle').textContent = `Asset record • ${equipmentName}`;
            const statusValue = equipment.status || 'Not Assigned';
            const statusElement = document.getElementById('qrModalStatus');
            const statusColors = { 'Serviceable':'rgb(20, 83, 45);color:#86efac', 'Missing':'rgb(133, 77, 14);color:#fcd34d', 'Under Maintenance':'rgb(88, 28, 135);color:#c4b5fd', 'Unserviceable':'rgba(107,114,128,.15);color:#d1d5db', 'Lost':'rgba(239,68,68,.15);color:#fca5a5' };
            const sc = statusColors[statusValue] || statusColors['Unserviceable'];
            statusElement.innerHTML = `<span style="display:inline-flex;align-items:center;gap:0.3rem;padding:0.2rem 0.65rem;border-radius:999px;font-size:0.8rem;font-weight:700;background:${sc.split(';')[0]};${sc.split(';')[1]}">${statusValue}</span>`;
            document.getElementById('qrModalDateAdded').textContent = equipment.dateAdded ? new Date(equipment.dateAdded).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }) : 'Not Assigned';
            document.getElementById('qrModalPayload').value = payload;
            document.getElementById('qrModalDownloadFilename').value = `${(equipment.equipmentId || id || 'equipment').replace(/[^a-z0-9]+/gi, '-')}-sticker.png`;

            if (payload) {
                generateQrCode(payload);
            } else if (qrImage) {
                const qrElement = document.getElementById('qrCanvas');
                const context = qrElement.getContext('2d');
                const img = new Image();
                img.onload = () => {
                    const size = 320;
                    qrElement.width = size;
                    qrElement.height = size;
                    context.clearRect(0, 0, qrElement.width, qrElement.height);
                    context.drawImage(img, 0, 0, qrElement.width, qrElement.height);
                };
                img.src = qrImage;
            }

            const index = equipmentData.findIndex(item => item.equipmentId === equipment.equipmentId);
            if (index !== -1) {
                equipmentData[index] = { ...equipmentData[index], ...equipment, qrCode, qrImage, qrGeneratedAt: data.qrGeneratedAt };
            }

            openModal('qrModal');
        }

        async function downloadSticker() {
            try {
                const equipmentId = document.getElementById('qrModalEquipmentId').textContent;
                const equipmentName = document.getElementById('qrModalEquipmentName').textContent;
                const laboratory = document.getElementById('qrModalLaboratory').textContent;
                const campus = document.getElementById('qrModalCampus').textContent;
                const status = document.getElementById('qrModalStatus').textContent;
                const dateAdded = document.getElementById('qrModalDateAdded').textContent;
                const serialNumber = document.getElementById('qrModalSerialNumber').textContent;
                const filename = document.getElementById('qrModalDownloadFilename').value || 'equipment-sticker.png';
                const imgDataUrl = await renderProfessionalSticker({
                    equipmentId,
                    equipmentName,
                    serialNumber,
                    campus,
                    laboratory,
                    status,
                    dateAdded
                });
                if (!imgDataUrl) {
                    throw new Error('Unable to generate sticker image.');
                }

                const link = document.createElement('a');
                link.href = imgDataUrl;
                link.download = filename;
                link.click();

                if (window.jspdf) {
                    const { jsPDF } = window.jspdf;
                    const pdf = new jsPDF({ orientation: 'portrait', unit: 'in', format: [3, 4] });
                    pdf.addImage(imgDataUrl, 'PNG', 0, 0, 3, 4);
                    pdf.save(filename.replace(/\.png$/i, '.pdf'));
                }
            } catch (error) {
                console.error('Failed to download sticker.', error);
                alert('Unable to download the sticker right now.');
            }
        }

        async function printSticker() {
            try {
                const equipmentId = document.getElementById('qrModalEquipmentId').textContent;
                const equipmentName = document.getElementById('qrModalEquipmentName').textContent;
                const laboratory = document.getElementById('qrModalLaboratory').textContent;
                const campus = document.getElementById('qrModalCampus').textContent;
                const status = document.getElementById('qrModalStatus').textContent;
                const dateAdded = document.getElementById('qrModalDateAdded').textContent;
                const serialNumber = document.getElementById('qrModalSerialNumber').textContent;
                const imgDataUrl = await renderProfessionalSticker({
                    equipmentId,
                    equipmentName,
                    serialNumber,
                    campus,
                    laboratory,
                    status,
                    dateAdded
                });
                if (!imgDataUrl) {
                    throw new Error('Unable to generate sticker image.');
                }

                const stickerHtml = `
                    <!DOCTYPE html>
                    <html lang="en">
                    <head>
                        <meta charset="UTF-8">
                        <title>Print Equipment Sticker</title>
                        <style>
                            @page { size: 4.2in 6.2in; margin: 0; }
                            html, body {
                                margin: 0;
                                padding: 0;
                                width: 100%;
                                height: 100%;
                                background: #081B14 !important;
                                -webkit-print-color-adjust: exact !important;
                                print-color-adjust: exact !important;
                            }
                            body {
                                display: flex;
                                align-items: center;
                                justify-content: center;
                                background: #081B14 !important;
                            }
                            .page {
                                width: 4.2in;
                                height: 6.2in;
                                display: flex;
                                align-items: center;
                                justify-content: center;
                                margin: 0;
                                padding: 0;
                                background: #081B14;
                                -webkit-print-color-adjust: exact !important;
                                print-color-adjust: exact !important;
                            }
                            img {
                                display: block;
                                width: 100%;
                                height: auto;
                                max-width: 4.2in;
                                max-height: 6.2in;
                                background: #081B14;
                                -webkit-print-color-adjust: exact !important;
                                print-color-adjust: exact !important;
                            }
                            @media print {
                                html, body {
                                    background: #081B14 !important;
                                    -webkit-print-color-adjust: exact !important;
                                    print-color-adjust: exact !important;
                                }
                                body {
                                    margin: 0;
                                }
                                .page, img {
                                    -webkit-print-color-adjust: exact !important;
                                    print-color-adjust: exact !important;
                                }
                            }
                        </style>
                    </head>
                    <body>
                        <div class="page"><img src="${imgDataUrl}" alt="Equipment Sticker" /></div>
                        <script>
                            window.onload = function() { window.print(); window.onafterprint = function() { window.close(); } }
                        <\/script>
                    </body>
                    </html>`;
                const printWindow = window.open('', '_blank', 'width=420,height=680');
                if (printWindow) {
                    printWindow.document.open();
                    printWindow.document.write(stickerHtml);
                    printWindow.document.close();
                }
            } catch (error) {
                console.error('Failed to print sticker.', error);
                alert('Unable to print the sticker right now.');
            }
        }

        function bindQrModalActions() {
            const downloadButton = document.getElementById('qrDownloadStickerBtn');
            const printButton = document.getElementById('qrPrintStickerBtn');
            const closeButton = document.getElementById('qrCloseBtn');
            const closeActionButton = document.getElementById('qrCloseActionBtn');

            const handleAction = (callback) => (event) => {
                event.preventDefault();
                event.stopPropagation();
                callback();
            };

            if (downloadButton) {
                downloadButton.onclick = null;
                downloadButton.addEventListener('click', handleAction(downloadSticker));
            }
            if (printButton) {
                printButton.onclick = null;
                printButton.addEventListener('click', handleAction(printSticker));
            }
            if (closeButton) {
                closeButton.onclick = null;
                closeButton.addEventListener('click', handleAction(() => closeModal('qrModal')));
            }
            if (closeActionButton) {
                closeActionButton.onclick = null;
                closeActionButton.addEventListener('click', handleAction(() => closeModal('qrModal')));
            }
        }

        document.addEventListener('click', function(event) {
            if (event.target.classList.contains('modal')) {
                event.target.classList.remove('show');
            }
        });

        document.addEventListener('click', function(event) {
            const sidebar = document.getElementById('sidebar');
            const hamburger = event.target.closest('[onclick="toggleSidebar()"]');
            if (!sidebar) return;
            if (!sidebar.contains(event.target) && !hamburger && window.innerWidth < 768) {
                sidebar.classList.remove('mobile-open');
            }
        });

        window.addEventListener('resize', function() {
            const sidebar = document.getElementById('sidebar');
            if (!sidebar) return;
            if (window.innerWidth >= 768) {
                sidebar.classList.remove('mobile-open');
            }
        });

        function getInitials(name, email) {
            const value = (name || '').trim() || (email || '').split('@')[0].trim();
            if (!value) return 'AD';
            return value.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part.charAt(0).toUpperCase()).join('') || 'AD';
        }

        function hydrateAdminProfile() {
            const user = window.__CURRENT_USER__ || {};
            const isAdmin = ['admin', 'administrator'].includes(String(user.role || '').trim().toLowerCase());
            const displayName = user.name || 'Administrator';
            const initials = user.initials || getInitials(displayName, user.email || '');
            const roleText = isAdmin ? 'Super Admin' : 'Admin';

            const adminNameElement = document.getElementById('adminUserName');
            const adminRoleElement = document.getElementById('adminUserRole');
            const adminAvatarElement = document.getElementById('adminAvatar');

            if (adminNameElement) adminNameElement.textContent = displayName;
            if (adminRoleElement) adminRoleElement.textContent = roleText;
            if (adminAvatarElement) adminAvatarElement.textContent = initials;
        }

        function initializeCampusDefaults() {
            const user = window.__CURRENT_USER__ || {};
            const userCampus = user.campus || null;

            const campusMap = {
                'bongabong': 'Bongabong Campus',
                'victoria': 'Victoria Campus',
                'calapan': 'Calapan Campus'
            };
            const normalizedCampus = String(userCampus || '').trim().toLowerCase();
            const formCampusValue = campusMap[normalizedCampus];
            const addCampusSelect = document.getElementById('addCampus');
            if (addCampusSelect) {
                addCampusSelect.replaceChildren(new Option(formCampusValue || 'Campus not available', formCampusValue || ''));
                addCampusSelect.value = formCampusValue || '';
                addCampusSelect.disabled = true;
            }
        }
document.getElementById('equipmentTable').addEventListener('click', handleEquipmentTableClick);
        document.addEventListener('DOMContentLoaded', async () => {
            hydrateAdminProfile();
            initializeCampusDefaults();
            const labSelect = document.getElementById('addLaboratoryRoom');
            if (labSelect) {
                try {
                    const labsResponse = await fetch('/api/computer-labs', { credentials: 'same-origin', cache: 'no-store' });
                    const labs = labsResponse.ok ? await labsResponse.json() : [];
                    if (Array.isArray(labs)) {
                        labSelect.replaceChildren(new Option('Select a computer lab', ''));
                        labs.forEach((lab) => {
                            const room = lab.roomNumbers?.[0] || lab.roomNumber || '';
                            const label = [lab.name, room].filter(Boolean).join(' — ');
                            const option = new Option(label, label);
                            option.dataset.laboratoryRoom = label;
                            labSelect.add(option);
                        });
                    }
                } catch (error) {
                    console.warn('Could not load registered computer labs:', error);
                }
            }
            const archiveCategoryButton = document.getElementById('archiveCategoryButton');
            if (archiveCategoryButton && !String(window.__CURRENT_USER__?.role || '').toLowerCase().includes('admin')) {
                archiveCategoryButton.hidden = true;
            }
            bindQrModalActions();
            const inventoryParams = new URLSearchParams(window.location.search);
            const requestedView = inventoryParams.get('view');
            const requestedStatus = inventoryParams.get('status');
            const viewModeFilter = document.getElementById('viewModeFilter');
            const statusFilter = document.getElementById('statusFilter');
            if (requestedView === 'all' && viewModeFilter) viewModeFilter.value = 'all';
            if (requestedStatus && statusFilter && [...statusFilter.options].some((option) => option.value === requestedStatus)) {
                statusFilter.value = requestedStatus;
            }
            await loadCategories();
            await loadEquipment(1, true);
            window.setInterval(refreshLastBorrowers, 30000);
            document.addEventListener('visibilitychange', refreshLastBorrowers);
        });
