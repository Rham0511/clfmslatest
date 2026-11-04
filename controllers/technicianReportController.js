/**
 * Technician Report Controller
 * Manages weekly technician reports
 */

import EquipmentTechnicianReport, { ensureTechnicianReportSequenceTable } from '../models/equipmentTechnicianReportModel.js';
import { Equipment } from '../models/equipmentModel.js';
import { User } from '../models/userModel.js';
import { Op, col, fn, where } from 'sequelize';
import { sequelize } from '../models/db.js';
import { getArchivedEntityIds } from '../models/archiveRecords.js';
import { logAuditEntry } from './auditController.js';
import { Document, Packer, Paragraph, TextRun } from 'docx';
import {
    buildMaintenanceSummary,
    formatMaintenanceReportId,
    getMaintenanceReportDetails,
    getTodayInManilaIso,
    normalizeIsoReportDate
} from '../utils/maintenanceReportData.js';
import {
    createMaintenanceServiceDocx,
    createMaintenanceServicePdf
} from '../utils/maintenanceServiceReportDocuments.js';

const technicianRoles = ['technician', 'laboratory technician', 'lab technician'];
const adminRoles = ['admin', 'administrator'];

function hasFullTechnicianName(value) {
    const name = String(value || '').trim().replace(/\s+/g, ' ');
    return name.split(' ').length >= 3 && !['technician', 'lab technician', 'laboratory technician', 'n/a'].includes(name.toLowerCase());
}

function reportFilename(report, extension) {
    const identifier = String(report.reportId || `TECH-${report.id}`).replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
    return `${identifier || `TECH-${report.id}`}.${extension}`;
}

function reportDocumentTitle(report) {
    const titles = {
        weekly: 'WEEKLY ACCOMPLISHMENT REPORT',
        incident: 'EQUIPMENT INCIDENT REPORT',
        maintenance: 'MAINTENANCE SERVICE REPORT',
        audit: 'INVENTORY AUDIT REPORT'
    };
    return titles[String(report.reportType || '').toLowerCase()] || 'TECHNICIAN WORK REPORT';
}

function pdfSafeText(value) {
    return String(value ?? '')
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[‘’]/g, "'")
        .replace(/[“”]/g, '"')
        .replace(/[–—]/g, '-')
        .replace(/…/g, '...')
        .replace(/\u00a0/g, ' ')
        .replace(/[^\x20-\x7e]/g, '?');
}

function escapePdfText(value) {
    return pdfSafeText(value).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function wrapPdfText(value, maxLength = 88) {
    const words = pdfSafeText(value).replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
    const lines = [];
    let line = '';
    for (const word of words) {
        const parts = word.length > maxLength
            ? word.match(new RegExp(`.{1,${maxLength}}`, 'g')) || [word]
            : [word];
        for (const part of parts) {
            const next = line ? `${line} ${part}` : part;
            if (next.length > maxLength && line) {
                lines.push(line);
                line = part;
            } else {
                line = next;
            }
        }
    }
    if (line) lines.push(line);
    return lines.length ? lines : [''];
}

function reportSummaryBlocks(value) {
    return String(value ?? '').trim().split(/\n\s*\n/).filter(Boolean).map((block) => {
        const lines = block.split(/\r?\n/);
        if (lines.length < 2 || !/^(Equipment \/ area|Reported issue or assigned task|Inspection findings|Parts or materials used|Work performed|Outcome and verification)$/i.test(lines[0].trim())) {
            return { heading: '', body: block.trim() };
        }
        return { heading: lines.shift().trim(), body: lines.join('\n').trim() };
    }).filter((block) => block.heading || block.body);
}

function createLegacyReportPdf(report) {
    const pageWidth = 612;
    const pageHeight = 792;
    const margin = 54;
    const pageContent = [];
    const documentTitle = reportDocumentTitle(report);
    let current = [];
    let y = 650;

    const beginPage = () => {
        current = [
            'q 0.035 0.22 0.13 rg 0 680 612 112 re f Q',
            'BT /F2 19 Tf 1 1 1 rg 54 748 Td (COMLAB) Tj ET',
            `BT /F1 9 Tf 0.77 0.94 0.83 rg 54 728 Td (${escapePdfText(documentTitle)}) Tj ET`,
            'q 0.16 0.75 0.40 rg 54 710 42 3 re f Q'
        ];
        y = 650;
    };
    const savePage = () => pageContent.push(current);
    const ensureRoom = (height = 16) => {
        if (y - height < 58) {
            savePage();
            beginPage();
        }
    };
    const drawText = (value, { size = 10, bold = false, color = '0.12 0.18 0.14', x = margin, gap = 14 } = {}) => {
        ensureRoom(gap);
        current.push(`BT /${bold ? 'F2' : 'F1'} ${size} Tf ${color} rg ${x} ${y} Td (${escapePdfText(value)}) Tj ET`);
        y -= gap;
    };
    const drawWrapped = (value, options = {}) => {
        for (const line of wrapPdfText(value, options.maxLength || 88)) drawText(line, options);
    };
    const section = (title) => {
        ensureRoom(28);
        y -= 5;
        drawText(title.toUpperCase(), { size: 10, bold: true, color: '0.07 0.42 0.22', gap: 17 });
        current.push(`q 0.77 0.87 0.80 RG 54 ${y + 7} m 558 ${y + 7} l S Q`);
        y -= 3;
    };

    beginPage();
    drawText(String(report.reportId || `TECH-${report.id}`), { size: 15, bold: true, color: '0.07 0.42 0.22', gap: 24 });
    drawText(`Report date: ${report.reportDate || 'Not specified'}`, { size: 9, color: '0.34 0.42 0.36', gap: 15 });
    drawText(`Technician: ${report.technicianName || 'Technician'}`, { size: 10, bold: true, gap: 16 });
    drawText(`Campus: ${report.campusId || 'Not specified'}`, { size: 9, color: '0.34 0.42 0.36', gap: 17 });

    section('Service details');
    for (const block of reportSummaryBlocks(report.summary || 'No work description provided.')) {
        if (block.heading) drawText(block.heading, { size: 10, bold: true, color: '0.07 0.42 0.22', gap: 16 });
        if (block.body) drawWrapped(block.body, { size: 10, gap: 14, maxLength: 91 });
    }

    if (report.recommendations) {
        section('Follow-up recommendations');
        drawWrapped(report.recommendations, { size: 10, gap: 14, maxLength: 91 });
    }
    if (report.reviewComments) {
        section('Administrator notes');
        drawWrapped(report.reviewComments, { size: 10, gap: 14, maxLength: 91 });
    }

    savePage();
    const pageIds = pageContent.map((_, index) => 5 + index * 2);
    const objects = new Map();
    objects.set(1, '<< /Type /Catalog /Pages 2 0 R >>');
    objects.set(2, `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`);
    objects.set(3, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
    objects.set(4, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>');

    pageContent.forEach((commands, index) => {
        const pageId = pageIds[index];
        const streamId = pageId + 1;
        commands.push(`BT /F1 8 Tf 0.42 0.49 0.44 rg 54 34 Td (${escapePdfText(report.reportId || `TECH-${report.id}`)}  |  Page ${index + 1} of ${pageContent.length}) Tj ET`);
        const stream = `${commands.join('\n')}\n`;
        objects.set(pageId, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${streamId} 0 R >>`);
        objects.set(streamId, `<< /Length ${Buffer.byteLength(stream, 'ascii')} >>\nstream\n${stream}endstream`);
    });

    const objectCount = Math.max(...objects.keys()) + 1;
    let pdf = '%PDF-1.4\n';
    const offsets = new Array(objectCount).fill(0);
    for (let id = 1; id < objectCount; id += 1) {
        offsets[id] = Buffer.byteLength(pdf, 'ascii');
        pdf += `${id} 0 obj\n${objects.get(id)}\nendobj\n`;
    }
    const xrefOffset = Buffer.byteLength(pdf, 'ascii');
    pdf += `xref\n0 ${objectCount}\n0000000000 65535 f \n`;
    for (let id = 1; id < objectCount; id += 1) pdf += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`;
    pdf += `trailer\n<< /Size ${objectCount} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
    return Buffer.from(pdf, 'ascii');
}

function getSessionUser(req) {
    return {
        id: req.session?.userId || req.user?.id,
        name: req.session?.userName || req.user?.name || req.user?.email || 'Technician',
        role: String(req.session?.userRole || req.user?.role || '').toLowerCase()
    };
}

function getWeekNumberFromIsoDate(isoDate) {
    const [year, month, day] = isoDate.split('-').map(Number);
    const reportDay = Date.UTC(year, month - 1, day);
    const firstDay = Date.UTC(year, 0, 1);
    const firstDayOfWeek = new Date(firstDay).getUTCDay();
    return Math.ceil(((reportDay - firstDay) / 86400000 + firstDayOfWeek + 1) / 7);
}

function generateReportId(isoDate) {
    const year = Number(isoDate.slice(0, 4));
    return `TECH-${year}-W${String(getWeekNumberFromIsoDate(isoDate)).padStart(2, '0')}`;
}

async function nextMaintenanceReportNumber(reportYear, transaction) {
    await sequelize.query(
        `INSERT INTO technician_report_sequences (reportYear, lastNumber) VALUES (?, 0)
         ON DUPLICATE KEY UPDATE reportYear = VALUES(reportYear)`,
        { replacements: [reportYear], transaction }
    );
    const [rows] = await sequelize.query(
        'SELECT lastNumber FROM technician_report_sequences WHERE reportYear = ? FOR UPDATE',
        { replacements: [reportYear], transaction }
    );
    const nextNumber = Number(rows[0]?.lastNumber || 0) + 1;
    await sequelize.query(
        'UPDATE technician_report_sequences SET lastNumber = ? WHERE reportYear = ?',
        { replacements: [nextNumber, reportYear], transaction }
    );
    return nextNumber;
}

/**
 * Get all technician reports
 */
async function getAllReports(req, res) {
    try {
        const actor = getSessionUser(req);
        if (!actor.id) return res.status(401).json({ success: false, message: 'Authentication required.' });
        const account = await User.findByPk(actor.id, { attributes: ['id', 'role', 'campus'] });
        if (!account) return res.status(401).json({ success: false, message: 'Your account could not be verified.' });
        const role = String(account.role || '').trim().toLowerCase();
        const {
            campusId,
            laboratoryId,
            technicianId,
            reportType,
            status,
            startDate,
            endDate
        } = req.query;

        const whereClause = {};
        if (['technician', 'laboratory technician', 'lab technician'].includes(role)) {
            whereClause.technicianId = account.id;
        } else if (['admin', 'administrator'].includes(role)) {
            const campus = String(account.campus || '').trim().replace(/\s*Campus\s*$/i, '');
            if (!campus) return res.status(403).json({ success: false, message: 'Your admin account must have an assigned campus.' });
            whereClause.campusId = { [Op.in]: [campus, `${campus} Campus`] };
        } else {
            return res.status(403).json({ success: false, message: 'Only technicians and administrators can view technician reports.' });
        }
        await ensureTechnicianReportSequenceTable();

        if (campusId && ['admin', 'administrator'].includes(role)) {
            const allowedCampusIds = whereClause.campusId[Op.in];
            if (!allowedCampusIds.some((value) => value.toLowerCase() === String(campusId).trim().toLowerCase())) {
                return res.status(403).json({ success: false, message: 'You can only view reports at your assigned campus.' });
            }
        }
        if (laboratoryId) whereClause.laboratoryId = laboratoryId;
        if (technicianId && ['admin', 'administrator'].includes(role)) whereClause.technicianId = technicianId;
        if (reportType) whereClause.reportType = reportType;
        if (status) whereClause.status = status;
        
        if (startDate || endDate) {
            whereClause.reportDate = {};
            if (startDate) whereClause.reportDate[Op.gte] = startDate;
            if (endDate) whereClause.reportDate[Op.lte] = endDate;
        }
            whereClause.id = { [Op.notIn]: await getArchivedEntityIds('technician-report') };
        
        const reports = await EquipmentTechnicianReport.findAll({
            where: whereClause,
            order: [['reportDate', 'DESC']]
        });
        const reportsNeedingNames = reports.filter((report) => !report.technicianName || String(report.technicianName).trim().toLowerCase() === 'technician');
        const technicianIds = [...new Set(reportsNeedingNames.map((report) => Number(report.technicianId)).filter(Number.isFinite))];
        const technicians = technicianIds.length
            ? await User.findAll({ where: { id: { [Op.in]: technicianIds } }, attributes: ['id', 'name'] })
            : [];
        const technicianNames = new Map(technicians.map((technician) => [Number(technician.id), technician.name]));
        const reportList = reports.map((report) => {
            const item = report.toJSON();
            if (!item.technicianName || String(item.technicianName).trim().toLowerCase() === 'technician') {
                item.technicianName = technicianNames.get(Number(item.technicianId)) || '';
            }
            return item;
        });
        
        res.json({
            success: true,
            reports: reportList
        });
        
    } catch (error) {
        console.error('Error fetching technician reports:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch technician reports',
            error: error.message
        });
    }
}

async function getMyReports(req, res) {
    try {
        const actor = getSessionUser(req);
        if (!actor.id) return res.status(401).json({ success: false, message: 'Authentication required.' });
        const account = await User.findByPk(actor.id, { attributes: ['id', 'role'] });
        if (!account || !['technician', 'laboratory technician', 'lab technician'].includes(String(account.role || '').trim().toLowerCase())) {
            return res.status(403).json({ success: false, message: 'Technician access required.' });
        }
        await ensureTechnicianReportSequenceTable();
        const archivedIds = await getArchivedEntityIds('technician-report');
        const reports = await EquipmentTechnicianReport.findAll({
            where: {
                technicianId: actor.id,
                ...(archivedIds.length ? { id: { [Op.notIn]: archivedIds } } : {})
            },
            order: [['reportDate', 'DESC'], ['createdAt', 'DESC']]
        });
        const reportsNeedingNames = reports.filter((report) => !report.technicianName || String(report.technicianName).trim().toLowerCase() === 'technician');
        const technicianNames = reportsNeedingNames.length
            ? await User.findAll({ where: { id: { [Op.in]: [...new Set(reportsNeedingNames.map((report) => Number(report.technicianId)))] } }, attributes: ['id', 'name'] })
            : [];
        const namesById = new Map(technicianNames.map((technician) => [Number(technician.id), technician.name]));
        const reportList = reports.map((report) => {
            const item = report.toJSON();
            if (!item.technicianName || String(item.technicianName).trim().toLowerCase() === 'technician') {
                item.technicianName = namesById.get(Number(item.technicianId)) || '';
            }
            return item;
        });
        return res.json({ success: true, reports: reportList });
    } catch (error) {
        console.error('Error fetching technician accomplishments:', error);
        return res.status(500).json({ success: false, message: 'Failed to load your accomplishment reports.' });
    }
}

/**
 * Get single report by ID
 */
async function getReportById(req, res) {
    try {
        const { id } = req.params;
        const actor = getSessionUser(req);
        if (!actor.id) return res.status(401).json({ success: false, message: 'Authentication required.' });
        const account = await User.findByPk(actor.id, { attributes: ['id', 'name', 'role', 'campus'] });
        if (!account) return res.status(401).json({ success: false, message: 'Your account could not be verified.' });
        
        const archivedIds = new Set(await getArchivedEntityIds('technician-report'));
        const report = await EquipmentTechnicianReport.findOne({
            where: {
                [Op.or]: [
                    { id: id },
                    { reportId: id }
                ]
            }
        });
        
        if (!report || archivedIds.has(String(report.id))) {
            return res.status(404).json({
                success: false,
                message: 'Report not found'
            });
        }
        const role = String(account.role || '').trim().toLowerCase();
        const ownsReport = Number(report.technicianId) === Number(account.id);
        const sameCampus = String(report.campusId || '').replace(/\s*Campus\s*$/i, '').toLowerCase() === String(account.campus || '').replace(/\s*Campus\s*$/i, '').trim().toLowerCase();
        if (!ownsReport && !(['admin', 'administrator'].includes(role) && sameCampus)) {
            return res.status(403).json({ success: false, message: 'You do not have access to this technician report.' });
        }
        
        res.json({
            success: true,
            report
        });
        
    } catch (error) {
        console.error('Error fetching report:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch report',
            error: error.message
        });
    }
}

async function downloadReport(req, res) {
    try {
        const actor = getSessionUser(req);
        if (!actor.id) return res.status(401).json({ success: false, message: 'Authentication required.' });
        const account = await User.findByPk(actor.id, { attributes: ['id', 'role', 'campus'] });
        if (!account) return res.status(401).json({ success: false, message: 'Your account could not be verified.' });

        await ensureTechnicianReportSequenceTable();

        const archivedIds = new Set(await getArchivedEntityIds('technician-report'));
        const report = await EquipmentTechnicianReport.findOne({
            where: { [Op.or]: [{ id: req.params.id }, { reportId: req.params.id }] }
        });
        if (!report || archivedIds.has(String(report.id))) {
            return res.status(404).json({ success: false, message: 'Report not found.' });
        }

        const role = String(account.role || '').trim().toLowerCase();
        const ownsReport = Number(report.technicianId) === Number(account.id) && technicianRoles.includes(role);
        if (!ownsReport) {
            return res.status(403).json({ success: false, message: 'Only the technician who created this report can download it.' });
        }

        const format = String(req.query.format || '').toLowerCase();
        const reportData = report.toJSON();
        if (!reportData.technicianName || String(reportData.technicianName).trim().toLowerCase() === 'technician') {
            const technician = await User.findByPk(reportData.technicianId, { attributes: ['name'] });
            reportData.technicianName = technician?.name || '';
        }
        const isMaintenanceReport = String(reportData.reportType || '').toLowerCase() === 'maintenance';
        if (isMaintenanceReport && !hasFullTechnicianName(reportData.technicianName)) {
            return res.status(422).json({
                success: false,
                message: 'Your profile is missing your full name. Add your first name, middle initial, and last name before downloading this report.'
            });
        }
        if (isMaintenanceReport && reportData.equipmentId) {
            const equipment = await Equipment.findByPk(reportData.equipmentId, {
                attributes: ['equipmentId', 'assetNumber', 'serialNumber']
            });
            reportData.equipmentPropertyNo = equipment?.equipmentId || equipment?.assetNumber || equipment?.serialNumber || 'N/A';
        } else {
            const reportDetails = getMaintenanceReportDetails(reportData);
            reportData.equipmentPropertyNo = /^Entire area\s*[—-]/i.test(reportDetails.equipmentArea || '')
                ? 'Entire laboratory area'
                : 'N/A';
        }
        // The current schema has no campus or laboratory supervisor assignment relation.
        // Keep the signature name line empty until a real assignment is available.
        reportData.notedByName = '';
        const filename = reportFilename(report, format === 'word' ? 'docx' : format);
        if (format === 'pdf') {
            res.type('application/pdf');
            res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
            return res.send(isMaintenanceReport ? createMaintenanceServicePdf(reportData) : createLegacyReportPdf(reportData));
        }
        if (format !== 'docx' && format !== 'word') {
            return res.status(400).json({ success: false, message: 'Choose either PDF or Word format.' });
        }

        if (isMaintenanceReport) {
            const buffer = await createMaintenanceServiceDocx(reportData);
            res.type('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
            res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
            return res.send(buffer);
        }

        const label = (name, value) => new Paragraph({
            spacing: { after: 140 },
            children: [
                new TextRun({ text: `${name}: `, bold: true, color: '166534' }),
                new TextRun({ text: String(value ?? 'Not specified') })
            ]
        });
        const heading = (text) => new Paragraph({
            spacing: { before: 260, after: 100 },
            children: [new TextRun({ text, bold: true, size: 25, color: '166534' })]
        });
        const doc = new Document({
            creator: 'ComLab Laboratory Facilities Management',
            title: `${reportDocumentTitle(report)} ${report.reportId || report.id}`,
            description: 'Technician work report',
            sections: [{
                properties: { page: { margin: { top: 900, right: 1000, bottom: 900, left: 1000 } } },
                children: [
                    new Paragraph({
                        spacing: { after: 100 },
                        children: [new TextRun({ text: 'COMLAB', bold: true, size: 34, color: '166534' })]
                    }),
                    new Paragraph({
                        spacing: { after: 260 },
                        children: [new TextRun({ text: reportDocumentTitle(report), bold: true, size: 24, color: '45634E' })]
                    }),
                    label('Report ID', report.reportId || `TECH-${report.id}`),
                    label('Report date', report.reportDate || 'Not specified'),
                    label('Technician', report.technicianName || 'Technician'),
                    label('Campus', report.campusId || 'Not specified'),
                    heading('Service details'),
                    ...reportSummaryBlocks(report.summary || 'No work description provided.').flatMap((block) => [
                        ...(block.heading ? [new Paragraph({
                            spacing: { before: 140, after: 60 },
                            children: [new TextRun({ text: block.heading, bold: true, color: '245B3B' })]
                        })] : []),
                        ...(block.body ? [new Paragraph({ text: block.body, spacing: { after: 140 } })] : [])
                    ]),
                    ...(report.recommendations ? [heading('Follow-up recommendations'), new Paragraph({ text: report.recommendations })] : []),
                    ...(report.reviewComments ? [heading('Administrator notes'), new Paragraph({ text: report.reviewComments })] : [])
                ]
            }]
        });
        const buffer = await Packer.toBuffer(doc);
        res.type('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        return res.send(buffer);
    } catch (error) {
        console.error('Error downloading technician report:', error);
        return res.status(500).json({ success: false, message: 'Failed to generate the report file.' });
    }
}

async function getReportEquipmentOptions(req, res) {
    try {
        const actor = getSessionUser(req);
        if (!actor.id) return res.status(401).json({ success: false, message: 'Authentication required.' });
        const account = await User.findByPk(actor.id, { attributes: ['role', 'campus'] });
        if (!account || !['technician', 'laboratory technician', 'lab technician'].includes(String(account.role || '').trim().toLowerCase())) {
            return res.status(403).json({ success: false, message: 'Technician access required.' });
        }
        const campus = String(account.campus || '').trim().replace(/\s*Campus\s*$/i, '');

        const equipmentFilters = [];
        if (campus) equipmentFilters.push({ campus: { [Op.in]: [campus, `${campus} Campus`] } });
        if (String(req.query.excludeChairs || '').toLowerCase() === 'true') {
            equipmentFilters.push(where(fn('LOWER', col('category')), { [Op.notLike]: '%chair%' }));
            equipmentFilters.push(where(fn('LOWER', col('name')), { [Op.notLike]: '%chair%' }));
        }

        const equipment = await Equipment.findAll({
            attributes: ['id', 'equipmentId', 'name', 'serialNumber', 'category', 'campus', 'laboratoryRoom', 'status'],
            ...(equipmentFilters.length ? { where: { [Op.and]: equipmentFilters } } : {}),
            order: [['name', 'ASC'], ['equipmentId', 'ASC']]
        });

        res.json({
            success: true,
            equipment: equipment.map((item) => item.toJSON())
        });
    } catch (error) {
        console.error('Error fetching technician report equipment options:', error);
        res.status(500).json({ success: false, message: 'Failed to load equipment options.' });
    }
}

/**
 * Create new technician report
 */
async function createReport(req, res) {
    try {
        const {
            reportDate,
            campusId: submittedCampusId,
            laboratoryId,
            reportType = 'weekly',
            summary,
            equipmentIssuesCount = 0,
            maintenancePerformed = 0,
            newEquipmentAdded = 0,
            equipmentRetired = 0,
            inventoryCheckCompleted = false,
            inventoryCheckId,
            recommendations,
            attachments,
            equipmentId,
            serialNumber,
            issueType,
            equipmentArea,
            reportedIssue,
            inspectionFindings,
            partsMaterialsUsed,
            workPerformed,
            outcomeVerification,
            timeStarted,
            timeCompleted
        } = req.body;
        const actor = getSessionUser(req);
        if (!actor.id) return res.status(401).json({ success: false, message: 'Authentication required.' });
        const account = await User.findByPk(actor.id, { attributes: ['id', 'name', 'role', 'campus'] });
        if (!account) return res.status(401).json({ success: false, message: 'Your account could not be verified.' });
        const normalizedRole = String(account.role || '').trim().toLowerCase();
        if (!['technician', 'laboratory technician', 'lab technician'].includes(normalizedRole)) {
            return res.status(403).json({ success: false, message: 'Only technicians can submit work accomplishments.' });
        }
        const numericCounts = [equipmentIssuesCount, maintenancePerformed, newEquipmentAdded, equipmentRetired]
            .map((value) => Number(value));
        if (numericCounts.some((value) => !Number.isInteger(value) || value < 0 || value > 99999)) {
            return res.status(400).json({ success: false, message: 'Work counts must be whole numbers between 0 and 99,999.' });
        }
        const normalizedReportType = String(reportType || 'weekly').trim().toLowerCase();
        if (normalizedReportType === 'maintenance' && !hasFullTechnicianName(account.name)) {
            return res.status(422).json({
                success: false,
                message: 'Your profile is missing your full name. Add your first name, middle initial, and last name before submitting a maintenance report.'
            });
        }
        const normalizedReportDate = normalizeIsoReportDate(reportDate)
            || (!reportDate && normalizedReportType !== 'maintenance' ? getTodayInManilaIso() : null);
        if (!normalizedReportDate) {
            return res.status(400).json({ success: false, message: 'Choose a valid report date in YYYY-MM-DD format.' });
        }

        let maintenanceDetails = null;
        let reportSummary = String(summary || '').trim();
        if (normalizedReportType === 'maintenance') {
            maintenanceDetails = getMaintenanceReportDetails({
                summary,
                equipmentArea,
                reportedIssue,
                inspectionFindings,
                partsMaterialsUsed,
                workPerformed,
                outcomeVerification,
                timeStarted,
                timeCompleted
            });
            const requiredFields = [
                ['equipmentArea', 'Select an equipment item or laboratory area.'],
                ['reportedIssue', 'Enter the reported issue or assigned task.'],
                ['workPerformed', 'Describe the work performed (at least 10 characters).']
            ];
            for (const [field, message] of requiredFields) {
                const value = maintenanceDetails[field];
                if (!value || value === 'N/A' || !value.trim()) return res.status(400).json({ success: false, message });
            }
            for (const field of ['timeStarted', 'timeCompleted']) {
                const value = maintenanceDetails[field];
                if (value !== 'N/A' && !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) {
                    return res.status(400).json({ success: false, message: 'Enter valid start and completion times.' });
                }
            }
            if (maintenanceDetails.timeStarted !== 'N/A' && maintenanceDetails.timeCompleted !== 'N/A' &&
                maintenanceDetails.timeCompleted < maintenanceDetails.timeStarted) {
                return res.status(400).json({ success: false, message: 'Completion time must be the same as or later than the start time.' });
            }
            if (maintenanceDetails.workPerformed.length < 10) {
                return res.status(400).json({ success: false, message: 'Describe the work performed in at least 10 characters.' });
            }
            reportSummary = buildMaintenanceSummary(maintenanceDetails);
        } else if (!reportSummary || reportSummary.length < 10 || reportSummary.length > 5000) {
            return res.status(400).json({ success: false, message: 'Describe the completed work in 10 to 5,000 characters.' });
        }
        if (reportSummary.length > 5000) {
            return res.status(400).json({ success: false, message: 'The report details exceed the 5,000 character limit.' });
        }

        const reportYear = Number(normalizedReportDate.slice(0, 4));
        const reportId = normalizedReportType === 'weekly'
            ? generateReportId(normalizedReportDate)
            : null;

        let equipment = null;
        if (equipmentId || serialNumber) {
            equipment = await Equipment.findOne({
                where: equipmentId ? { id: equipmentId } : { serialNumber }
            });
            if (!equipment) return res.status(404).json({ success: false, message: 'Equipment was not found.' });
        }

        const accountCampus = String(account.campus || '').trim();
        if (normalizedRole.includes('technician') && accountCampus && equipment?.campus &&
            accountCampus.replace(/\s*Campus\s*$/i, '').toLowerCase() !== String(equipment.campus).replace(/\s*Campus\s*$/i, '').trim().toLowerCase()) {
            return res.status(403).json({ success: false, message: 'You can submit accomplishments only for equipment at your assigned campus.' });
        }
        const campusId = equipment?.campus
            || equipment?.campusId
            || (normalizedRole.includes('technician') ? accountCampus : submittedCampusId)
            || req.session?.userCampus
            || req.user?.campus
            || req.user?.campusId
            || null;
        if (!campusId) {
            return res.status(400).json({
                success: false,
                message: 'Unable to determine the campus. Select equipment with a campus assignment or contact an administrator.'
            });
        }

        const weekNumber = getWeekNumberFromIsoDate(normalizedReportDate);
        // Check if report already exists for this week and technician
        if (normalizedReportType === 'weekly') {
            const existingReport = await EquipmentTechnicianReport.findOne({
                where: { reportId, technicianId: actor.id, reportType: 'weekly' }
            });
            if (existingReport) {
                return res.status(400).json({
                    success: false,
                    message: `Weekly report already exists for this week: ${reportId}`,
                    existingReport
                });
            }
        }

        if (normalizedReportType === 'maintenance') await ensureTechnicianReportSequenceTable();
        const newReport = await sequelize.transaction(async (transaction) => {
            let generatedReportId = reportId;
            if (normalizedReportType === 'maintenance') {
                const sequence = await nextMaintenanceReportNumber(reportYear, transaction);
                generatedReportId = formatMaintenanceReportId(reportYear, sequence);
            } else if (normalizedReportType === 'incident') {
                generatedReportId = `TECH-INCIDENT-${Date.now()}`;
            } else if (normalizedReportType === 'audit') {
                generatedReportId = `TECH-AUDIT-${Date.now()}`;
            }
            return EquipmentTechnicianReport.create({
                reportId: generatedReportId,
                reportDate: normalizedReportDate,
                weekNumber,
                campusId,
                laboratoryId,
                technicianId: actor.id,
                technicianName: account.name || actor.name,
                equipmentId: equipment?.id || equipmentId || null,
                serialNumber: equipment?.serialNumber || serialNumber || null,
                issueType: issueType || null,
                reportType: normalizedReportType,
                summary: reportSummary,
                equipmentIssuesCount,
                maintenancePerformed,
                newEquipmentAdded,
                equipmentRetired,
                inventoryCheckCompleted,
                inventoryCheckId,
                recommendations: String(recommendations || '').trim() || null,
                attachments: attachments ? JSON.stringify(attachments) : null,
                status: 'draft'
            }, { transaction });
        });
        
        res.status(201).json({
            success: true,
            message: 'Technician report created successfully',
            report: newReport
        });
        
    } catch (error) {
        console.error('Error creating report:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to create report',
            error: error.message
        });
    }
}

/**
 * Update report (only draft or own reports)
 */
async function updateReport(req, res) {
    try {
        const actor = getSessionUser(req);
        const { id } = req.params;
        const updates = req.body;
        if (!actor.id) return res.status(401).json({ success: false, message: 'Authentication required.' });
        const account = await User.findByPk(actor.id, { attributes: ['id', 'role', 'campus'] });
        const role = String(account?.role || '').trim().toLowerCase();
        
        const report = await EquipmentTechnicianReport.findByPk(id);
        
        if (!report) {
            return res.status(404).json({
                success: false,
                message: 'Report not found'
            });
        }
        
        if (!account || !technicianRoles.includes(role)) {
            return res.status(403).json({ success: false, message: 'Only technicians can edit accomplishment reports.' });
        }
        if (Number(report.technicianId) !== Number(actor.id)) {
            return res.status(403).json({ success: false, message: 'You can only edit your own reports.' });
        }
        if (report.status !== 'draft') {
            return res.status(400).json({
                success: false,
                message: `Cannot edit ${report.status} reports.`
            });
        }

        const allowedFields = ['reportDate', 'summary', 'equipmentIssuesCount', 'maintenancePerformed', 'newEquipmentAdded', 'equipmentRetired', 'inventoryCheckCompleted', 'inventoryCheckId', 'recommendations', 'attachments'];
        const safeUpdates = Object.fromEntries(Object.entries(updates).filter(([key]) => allowedFields.includes(key)));
        if (safeUpdates.summary !== undefined && (String(safeUpdates.summary).trim().length < 10 || String(safeUpdates.summary).length > 5000)) {
            return res.status(400).json({ success: false, message: 'Describe the completed work in 10 to 5,000 characters.' });
        }
        for (const field of ['equipmentIssuesCount', 'maintenancePerformed', 'newEquipmentAdded', 'equipmentRetired']) {
            if (safeUpdates[field] === undefined) continue;
            const value = Number(safeUpdates[field]);
            if (!Number.isInteger(value) || value < 0 || value > 99999) {
                return res.status(400).json({ success: false, message: 'Work counts must be whole numbers between 0 and 99,999.' });
            }
            safeUpdates[field] = value;
        }
        if (safeUpdates.attachments) safeUpdates.attachments = JSON.stringify(safeUpdates.attachments);
        await report.update(safeUpdates);
        
        res.json({
            success: true,
            message: 'Report updated successfully',
            report
        });
        
    } catch (error) {
        console.error('Error updating report:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update report',
            error: error.message
        });
    }
}

/**
 * Submit report for review
 */
async function submitReport(req, res) {
    try {
        const actor = getSessionUser(req);
        const { id } = req.params;
        
        const account = await User.findByPk(actor.id, { attributes: ['id', 'role'] });
        if (!account || !technicianRoles.includes(String(account.role || '').trim().toLowerCase())) {
            return res.status(403).json({ success: false, message: 'Only technicians can submit accomplishment reports.' });
        }
        const report = await EquipmentTechnicianReport.findByPk(id);
        
        if (!report) {
            return res.status(404).json({
                success: false,
                message: 'Report not found'
            });
        }
        
        // Check permissions
        if (Number(report.technicianId) !== Number(actor.id)) {
            return res.status(403).json({
                success: false,
                message: 'You can only submit your own reports'
            });
        }
        
        if (report.status !== 'draft') {
            return res.status(400).json({
                success: false,
                message: 'Only draft reports can be submitted'
            });
        }
        
        // Validate required fields
        if (!report.summary || report.summary.trim().length < 10) {
            return res.status(400).json({
                success: false,
                message: 'Report summary is required (minimum 10 characters)'
            });
        }
        
        await report.update({
            status: 'submitted',
            submittedAt: new Date()
        });
        
        res.json({
            success: true,
            message: 'Report submitted successfully',
            report
        });
        
    } catch (error) {
        console.error('Error submitting report:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to submit report',
            error: error.message
        });
    }
}

/** Admins can view reports but cannot approve or edit them. */
async function reviewReport(req, res) {
    const actor = getSessionUser(req);
    if (!actor.id) return res.status(401).json({ success: false, message: 'Authentication required.' });
    return res.status(403).json({ success: false, message: 'Technician accomplishments are view-only for administrators.' });
}

/**
 * Technicians may permanently delete their own draft reports only.
 */
async function deleteReport(req, res) {
    try {
        const actor = getSessionUser(req);
        if (!actor.id) return res.status(401).json({ success: false, message: 'Authentication required.' });
        const account = await User.findByPk(actor.id, { attributes: ['id', 'role'] });
        const role = String(account?.role || '').trim().toLowerCase();
        if (!account || !technicianRoles.includes(role)) {
            return res.status(403).json({ success: false, message: 'Only technicians can delete their own draft reports.' });
        }

        const report = await EquipmentTechnicianReport.findByPk(req.params.id);
        if (!report || (await getArchivedEntityIds('technician-report')).includes(String(report.id))) {
            return res.status(404).json({ success: false, message: 'Report not found.' });
        }
        if (Number(report.technicianId) !== Number(actor.id)) {
            return res.status(403).json({ success: false, message: 'You can only delete your own draft reports.' });
        }
        if (String(report.status || '').trim().toLowerCase() !== 'draft') {
            return res.status(409).json({ success: false, message: 'Submitted reports are retained for audit. Archive this report instead.' });
        }

        const reportId = report.reportId || `TECH-${report.id}`;
        await report.destroy();
        await logAuditEntry(req, {
            action: 'Draft Report Deleted',
            module: 'Technician Reports',
            resourceId: report.id,
            description: `Technician draft report ${reportId} was permanently deleted.`
        });
        return res.json({ success: true, message: 'Draft report deleted successfully.' });
    } catch (error) {
        console.error('Error deleting technician draft report:', error);
        return res.status(500).json({ success: false, message: 'Failed to delete the draft report.' });
    }
}

/**
 * Get report statistics
 */
async function getReportStatistics(req, res) {
    try {
        const { campusId, startDate, endDate } = req.query;
        const actor = getSessionUser(req);
        if (!actor.id) return res.status(401).json({ success: false, message: 'Authentication required.' });
        const account = await User.findByPk(actor.id, { attributes: ['id', 'role', 'campus'] });
        if (!account) return res.status(401).json({ success: false, message: 'Your account could not be verified.' });

        const whereClause = {};
        const role = String(account.role || '').trim().toLowerCase();
        if (technicianRoles.includes(role)) {
            whereClause.technicianId = account.id;
        } else if (adminRoles.includes(role)) {
            const campus = String(account.campus || '').trim().replace(/\s*Campus\s*$/i, '');
            if (!campus) return res.status(403).json({ success: false, message: 'Your admin account must have an assigned campus.' });
            const allowedCampuses = [campus, `${campus} Campus`];
            if (campusId && !allowedCampuses.some((value) => value.toLowerCase() === String(campusId).trim().toLowerCase())) {
                return res.status(403).json({ success: false, message: 'You can only view reports at your assigned campus.' });
            }
            whereClause.campusId = { [Op.in]: allowedCampuses };
        } else {
            return res.status(403).json({ success: false, message: 'Only technicians and administrators can view technician report statistics.' });
        }
        
        if (startDate || endDate) {
            whereClause.reportDate = {};
            if (startDate) whereClause.reportDate[Op.gte] = startDate;
            if (endDate) whereClause.reportDate[Op.lte] = endDate;
        }
        whereClause.id = { [Op.notIn]: await getArchivedEntityIds('technician-report') };
        
        const reports = await EquipmentTechnicianReport.findAll({
            where: whereClause,
            attributes: [
                'equipmentIssuesCount',
                'maintenancePerformed',
                'newEquipmentAdded',
                'equipmentRetired',
                'inventoryCheckCompleted'
            ]
        });
        
        const stats = {
            totalReports: reports.length,
            totalIssues: reports.reduce((sum, r) => sum + (r.equipmentIssuesCount || 0), 0),
            totalMaintenance: reports.reduce((sum, r) => sum + (r.maintenancePerformed || 0), 0),
            totalAdded: reports.reduce((sum, r) => sum + (r.newEquipmentAdded || 0), 0),
            totalRetired: reports.reduce((sum, r) => sum + (r.equipmentRetired || 0), 0),
            inventoryChecksCompleted: reports.filter(r => r.inventoryCheckCompleted).length
        };
        
        res.json({
            success: true,
            statistics: stats
        });
        
    } catch (error) {
        console.error('Error fetching report statistics:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch report statistics',
            error: error.message
        });
    }
}

export {
    getReportEquipmentOptions,
    getAllReports,
    getMyReports,
    getReportById,
    downloadReport,
    createReport,
    updateReport,
    submitReport,
    reviewReport,
    deleteReport,
    getReportStatistics
};
