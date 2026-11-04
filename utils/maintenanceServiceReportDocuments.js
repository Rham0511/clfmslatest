import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  ImageRun,
  PageNumber,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType
} from 'docx';
import { readFileSync } from 'node:fs';
import { deflateSync, inflateSync } from 'node:zlib';
import {
  MAINTENANCE_DETAIL_FIELDS,
  formatReportDate,
  formatSubmittedAt,
  getMaintenanceReportDetails
} from './maintenanceReportData.js';

const GREEN = '166534';
const DARK_GREEN = '14532D';
const PALE_GREEN = 'EFF6F0';
const BORDER_GREEN = '9CBBA4';
const VALUE_COLOR = '30363B';
const NA_COLOR = '8B918C';
const BODY_FONT = 'Calibri';
const DOCX_PAGE_WIDTH = 11906;
const DOCX_CONTENT_WIDTH = DOCX_PAGE_WIDTH - 2 * 1440;
const PDF_PAGE_WIDTH = 595.28;
const PDF_PAGE_HEIGHT = 841.89;
const PDF_MARGIN = 72;
const PDF_CONTENT_BOTTOM = 68;
const PDF_FOOTER_Y = 27;
const UNIVERSITY_LOGO = readFileSync(new URL('../public/images/minsu-logo.png.jpg', import.meta.url));
const CCS_LOGO = readFileSync(new URL('../img/ccs_logo.png', import.meta.url));

function getJpegDimensions(buffer) {
  let offset = 2;
  while (offset < buffer.length) {
    if (buffer[offset] !== 0xff) { offset += 1; continue; }
    const marker = buffer[offset + 1];
    const length = buffer.readUInt16BE(offset + 2);
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      return { width: buffer.readUInt16BE(offset + 7), height: buffer.readUInt16BE(offset + 5) };
    }
    offset += 2 + length;
  }
  return { width: 200, height: 200 };
}

const UNIVERSITY_LOGO_DIMENSIONS = getJpegDimensions(UNIVERSITY_LOGO);
function getPngRgbImage(buffer) {
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const imageData = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
    } else if (type === 'IDAT') imageData.push(data);
    else if (type === 'IEND') break;
    offset += 12 + length;
  }
  if (!width || !height || bitDepth !== 8 || colorType !== 6) {
    throw new Error('The CCS logo must be a non-interlaced 8-bit RGBA PNG.');
  }
  const bytesPerPixel = 4;
  const stride = width * bytesPerPixel;
  const filtered = inflateSync(Buffer.concat(imageData));
  const rgba = Buffer.alloc(height * stride);
  const paeth = (left, above, upperLeft) => {
    const estimate = left + above - upperLeft;
    const leftDistance = Math.abs(estimate - left);
    const aboveDistance = Math.abs(estimate - above);
    const upperLeftDistance = Math.abs(estimate - upperLeft);
    if (leftDistance <= aboveDistance && leftDistance <= upperLeftDistance) return left;
    return aboveDistance <= upperLeftDistance ? above : upperLeft;
  };
  let sourceOffset = 0;
  for (let row = 0; row < height; row += 1) {
    const filter = filtered[sourceOffset++];
    const rowOffset = row * stride;
    for (let index = 0; index < stride; index += 1) {
      const raw = filtered[sourceOffset++];
      const left = index >= bytesPerPixel ? rgba[rowOffset + index - bytesPerPixel] : 0;
      const above = row > 0 ? rgba[rowOffset + index - stride] : 0;
      const upperLeft = row > 0 && index >= bytesPerPixel ? rgba[rowOffset + index - stride - bytesPerPixel] : 0;
      let predictor = 0;
      if (filter === 1) predictor = left;
      else if (filter === 2) predictor = above;
      else if (filter === 3) predictor = Math.floor((left + above) / 2);
      else if (filter === 4) predictor = paeth(left, above, upperLeft);
      else if (filter !== 0) throw new Error(`Unsupported CCS logo PNG filter: ${filter}`);
      rgba[rowOffset + index] = (raw + predictor) & 0xff;
    }
  }
  const rgb = Buffer.alloc(width * height * 3);
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    const source = pixel * 4;
    const target = pixel * 3;
    const alpha = rgba[source + 3];
    for (let channel = 0; channel < 3; channel += 1) {
      rgb[target + channel] = Math.round((rgba[source + channel] * alpha + 255 * (255 - alpha)) / 255);
    }
  }
  return { width, height, data: deflateSync(rgb) };
}

const CCS_LOGO_IMAGE = getPngRgbImage(CCS_LOGO);
const normalizeHyphens = (value) => String(value ?? '').replace(/[‐‑‒–—−]/g, '-');

function compactEquipmentArea(value, campusName = '') {
  let segments = normalizeHyphens(value).split(/\s*[·•]\s*/).map((part) => part.trim()).filter(Boolean);
  if (!segments.length || segments[0].toUpperCase() === 'N/A') return 'N/A';
  const campusKey = normalizeHyphens(campusName).replace(/\s+Campus$/i, '').trim().toLowerCase();
  let entireArea = false;
  segments = segments.flatMap((part) => {
    if (/^entire (?:laboratory )?area\b/i.test(part)) {
      entireArea = true;
      part = part.replace(/^entire (?:laboratory )?area\b/i, '').replace(/^\s*-\s*/, '').trim();
      if (!part) return [];
    }
    const campusAndRoom = part.match(/^(.+?\s+Campus)\s+-\s+(.+)$/i);
    if (campusAndRoom) part = campusAndRoom[2].trim();
    const normalizedPart = part.replace(/\s+Campus$/i, '').trim().toLowerCase();
    if (/\s+Campus$/i.test(part) || (campusKey && normalizedPart === campusKey)) return [];
    const equipmentIdAndName = part.match(/^([A-Z0-9]+(?:[-_][A-Z0-9]+)+)\s+-\s+(.+)$/i);
    if (equipmentIdAndName) part = equipmentIdAndName[2].trim();
    return [part];
  });
  if (entireArea) segments.unshift('Entire laboratory area');
  return segments.map((part) => part.replace(/\s+-\s+/g, ' — ')).join(' · ') || (entireArea ? 'Entire laboratory area' : 'N/A');
}

function normalizeCampusName(value) {
  return normalizeHyphens(value || 'N/A').trim().replace(/\s+Campus$/i, '').trim() || 'N/A';
}

function statusLabel(value) {
  const status = String(value || 'draft');
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function getDocumentData(report = {}) {
  const technicianName = normalizeHyphens(report.technicianName || '').trim().replace(/\s+/g, ' ');
  if (!technicianName || ['technician', 'lab technician', 'laboratory technician', 'n/a'].includes(technicianName.toLowerCase())) {
    throw new Error('A full technician name is required. Complete your profile before downloading this report.');
  }
  const campus = normalizeCampusName(report.campusId);
  const details = getMaintenanceReportDetails(report);
  for (const [key, value] of Object.entries(details)) details[key] = normalizeHyphens(value || 'N/A');
  details.equipmentArea = compactEquipmentArea(details.equipmentArea, campus);
  return {
    reportId: normalizeHyphens(report.reportId || `TECH-${report.id || 'N/A'}`),
    reportDate: normalizeHyphens(formatReportDate(report.reportDate)),
    submittedAt: normalizeHyphens(formatSubmittedAt(report.submittedAt)),
    technician: technicianName,
    notedBy: normalizeHyphens(report.notedByName || '').trim(),
    approvedBy: normalizeHyphens(report.approvedByName || '').trim(),
    approvedByRole: normalizeHyphens(report.approvedByRole || 'Approving Authority'),
    equipmentPropertyNo: normalizeHyphens(report.equipmentPropertyNo || '').trim() || 'N/A',
    campus,
    campusHeader: campus === 'N/A' ? 'N/A Campus' : `${campus} Campus`,
    status: statusLabel(report.status),
    details,
    recommendations: normalizeHyphens(report.recommendations || '').trim() || 'N/A'
  };
}

function makeBorder(style = BorderStyle.SINGLE, color = BORDER_GREEN, size = 4) {
  return { style, color, size };
}

function createTableBorders() {
  const border = makeBorder();
  return {
    top: border,
    bottom: border,
    left: border,
    right: border,
    insideHorizontal: border,
    insideVertical: border
  };
}

function createBorderlessTableBorders() {
  const border = makeBorder(BorderStyle.NONE, 'FFFFFF', 0);
  return { top: border, bottom: border, left: border, right: border, insideHorizontal: border, insideVertical: border };
}

function makeTextRuns(value, { bold = false, italic = false, color = VALUE_COLOR, size = 20 } = {}) {
  const lines = normalizeHyphens(value ?? 'N/A').split(/\r\n|\r|\n/);
  return lines.flatMap((line, index) => {
    const isNA = line.trim().toUpperCase() === 'N/A';
    return [
      ...(index ? [new TextRun({ break: 1 })] : []),
      new TextRun({
        text: line || ' ',
        bold,
        italic: italic || isNA,
        color: isNA ? NA_COLOR : color,
        size,
        font: BODY_FONT
      })
    ];
  });
}

function makeParagraph(value, options = {}) {
  const { alignment = AlignmentType.LEFT, keepNext = false, keepLines = true, spacing = {} } = options;
  return new Paragraph({
    alignment,
    keepNext,
    keepLines,
    spacing: { before: 0, after: 0, ...spacing },
    children: makeTextRuns(value, options)
  });
}

function makeReportCell(label, value, width, { shaded = false, fontSize = 20, keepLines = true } = {}) {
  const labelCell = Boolean(label);
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    verticalAlign: 'top',
    shading: labelCell && shaded ? { fill: PALE_GREEN } : undefined,
    margins: { top: 90, bottom: 90, left: 100, right: 100 },
    children: [makeParagraph(labelCell ? label : value, {
      bold: labelCell,
      color: labelCell ? DARK_GREEN : VALUE_COLOR,
      size: fontSize,
      keepLines
    })]
  });
}

function makeInfoTable(rows) {
  const widths = [1805, 2708, 1805, DOCX_CONTENT_WIDTH - 6318];
  const tableRows = rows.map(([label1, value1, label2, value2]) => {
    const cells = [
      makeReportCell(label1, '', widths[0], { shaded: true }),
      makeReportCell('', value1, widths[1]),
      makeReportCell(label2, '', widths[2], { shaded: true }),
      makeReportCell('', value2, widths[3])
    ];
    return new TableRow({ cantSplit: true, children: cells });
  });
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    columnWidths: widths,
    rows: tableRows,
    borders: createTableBorders()
  });
}

function makeServiceTable(rows) {
  const widths = [2708, DOCX_CONTENT_WIDTH - 2708];
  const tableRows = rows.map(([label, value]) => new TableRow({
    cantSplit: false,
    children: [
      makeReportCell(label, '', widths[0], { shaded: true, keepLines: false }),
      makeReportCell('', value || 'N/A', widths[1], { keepLines: false })
    ]
  }));
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    columnWidths: widths,
    rows: tableRows,
    borders: createTableBorders()
  });
}

function sectionHeading(text, { keepNext = true, before = 150, after = 75 } = {}) {
  return new Paragraph({
    keepNext,
    keepLines: true,
    spacing: { before, after },
    children: [new TextRun({ text, bold: true, color: DARK_GREEN, size: 24, font: BODY_FONT })]
  });
}

function headerCell(children, width, alignment = AlignmentType.CENTER) {
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    verticalAlign: 'center',
    margins: { top: 0, bottom: 50, left: 0, right: 0 },
    children: Array.isArray(children) ? children : [children],
    borders: {
      top: makeBorder(BorderStyle.NONE, 'FFFFFF', 0),
      bottom: makeBorder(BorderStyle.SINGLE, GREEN, 8),
      left: makeBorder(BorderStyle.NONE, 'FFFFFF', 0),
      right: makeBorder(BorderStyle.NONE, 'FFFFFF', 0)
    }
  });
}

function createLetterhead(data) {
  const imageWidth = UNIVERSITY_LOGO_DIMENSIONS.width;
  const imageHeight = UNIVERSITY_LOGO_DIMENSIONS.height;
  const scale = Math.min(112 / imageWidth, 112 / imageHeight);
  const ccsScale = Math.min(112 / CCS_LOGO_IMAGE.width, 112 / CCS_LOGO_IMAGE.height);
  const logo = new Paragraph({
    alignment: AlignmentType.LEFT,
    spacing: { before: 0, after: 0 },
    children: [new ImageRun({
      data: UNIVERSITY_LOGO,
      type: 'jpg',
      transformation: { width: imageWidth * scale, height: imageHeight * scale }
    })]
  });
  const ccsLogo = new Paragraph({
    alignment: AlignmentType.RIGHT,
    spacing: { before: 0, after: 0 },
    children: [new ImageRun({
      data: CCS_LOGO,
      type: 'png',
      transformation: { width: CCS_LOGO_IMAGE.width * ccsScale, height: CCS_LOGO_IMAGE.height * ccsScale }
    })]
  });
  const lines = [
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 0, after: 10 }, children: [new TextRun({ text: 'MINDORO STATE UNIVERSITY', bold: true, size: 28, font: BODY_FONT, color: DARK_GREEN })] }),
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 0, after: 10 }, children: [new TextRun({ text: data.campusHeader, size: 22, font: BODY_FONT, color: VALUE_COLOR })] }),
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 0, after: 0 }, children: [new TextRun({ text: 'ComLab Facilities Management', bold: true, size: 24, font: BODY_FONT, color: DARK_GREEN })] })
  ];
  const widths = [1750, DOCX_CONTENT_WIDTH - 3500, 1750];
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    columnWidths: widths,
    rows: [new TableRow({
      cantSplit: true,
      children: [headerCell(logo, widths[0], AlignmentType.LEFT), headerCell(lines, widths[1]), headerCell(ccsLogo, widths[2], AlignmentType.RIGHT)]
    })],
    borders: createBorderlessTableBorders()
  });
}

function createSignatureCell({ label, name, role }, width) {
  const centered = (value, { bold = false, color = VALUE_COLOR, size = 18, keepNext = true, spacing = {} } = {}) => makeParagraph(value, {
    alignment: AlignmentType.CENTER,
    bold,
    color,
    size,
    keepNext,
    keepLines: true,
    spacing
  });
  const signingLine = new Paragraph({
    alignment: AlignmentType.CENTER,
    keepNext: true,
    keepLines: true,
    spacing: { before: 0, after: 35 },
    border: { bottom: makeBorder(BorderStyle.SINGLE, '59635C', 4) },
    children: [new TextRun({ text: ' ', size: 20, font: BODY_FONT })]
  });
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    verticalAlign: 'top',
    margins: { top: 0, bottom: 0, left: 140, right: 140 },
    children: [
      centered(label, { bold: true, color: DARK_GREEN, size: 18, spacing: { after: 0 } }),
      new Paragraph({ text: ' ', keepNext: true, keepLines: true, spacing: { before: 0, after: 720 } }),
      signingLine,
      centered(name || ' ', { bold: true, color: VALUE_COLOR, size: 20, spacing: { after: 35 } }),
      centered(role, { color: VALUE_COLOR, size: 18, spacing: { after: 70 } }),
      centered('Date:', { color: VALUE_COLOR, size: 18, keepNext: false })
    ]
  });
}

function createSignatureTable(data) {
  const signers = [
    { label: 'Prepared by:', name: data.technician.toUpperCase(), role: 'Technician' },
    { label: 'Noted by:', name: data.notedBy ? data.notedBy.toUpperCase() : '', role: 'Laboratory In-charge / Supervisor' }
  ];
  if (data.approvedBy) signers.push({ label: 'Approved by:', name: data.approvedBy.toUpperCase(), role: data.approvedByRole });
  const widths = signers.map((_, index) => Math.floor(DOCX_CONTENT_WIDTH / signers.length) + (index === signers.length - 1 ? DOCX_CONTENT_WIDTH % signers.length : 0));
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    columnWidths: widths,
    borders: createTableBorders(),
    rows: [new TableRow({
      cantSplit: true,
      children: signers.map((signer, index) => createSignatureCell(signer, widths[index]))
    })]
  });
}

function createDocxFooter(reportId) {
  return new Footer({ children: [new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 0, after: 0 },
    children: [
      new TextRun({ text: `Report ID: ${reportId}  |  Page `, color: '727A74', size: 14, font: BODY_FONT }),
      new TextRun({ children: [PageNumber.CURRENT], color: '727A74', size: 14, font: BODY_FONT }),
      new TextRun({ text: ' of ', color: '727A74', size: 14, font: BODY_FONT }),
      new TextRun({ children: [PageNumber.TOTAL_PAGES], color: '727A74', size: 14, font: BODY_FONT }),
      new TextRun({ text: '  |  Generated by ComLab Facilities Management System', color: '727A74', size: 14, font: BODY_FONT })
    ]
  })] });
}

function createServiceRows(data) {
  const start = String(data.details.timeStarted || '').trim();
  const end = String(data.details.timeCompleted || '').trim();
  let duration = 'N/A';
  if (/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(start) && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(end) && end >= start) {
    const minutes = Number(end.slice(0, 2)) * 60 + Number(end.slice(3, 5)) - (Number(start.slice(0, 2)) * 60 + Number(start.slice(3, 5)));
    const hours = Math.floor(minutes / 60);
    const remainder = minutes % 60;
    duration = `${hours ? `${hours} hr${hours === 1 ? '' : 's'}` : ''}${hours && remainder ? ' ' : ''}${remainder ? `${remainder} min${remainder === 1 ? '' : 's'}` : ''}${!hours && !remainder ? '0 mins' : ''}`;
  }
  const timeSummary = [
    start && start !== 'N/A' ? `Start: ${start}` : '',
    end && end !== 'N/A' ? `Completed: ${end}` : '',
    duration !== 'N/A' ? `Duration: ${duration}` : ''
  ].filter(Boolean).join('\n') || 'N/A';
  return [
    ['Equipment / area', data.details.equipmentArea || 'N/A'],
    ['Equipment ID / Property No.', data.equipmentPropertyNo],
    ['Reported issue or assigned task', data.details.reportedIssue || 'N/A'],
    ['Inspection findings', data.details.inspectionFindings || 'N/A'],
    ['Parts or materials used', data.details.partsMaterialsUsed || 'N/A'],
    ['Work performed', data.details.workPerformed || 'N/A'],
    ['Outcome and verification', data.details.outcomeVerification || 'N/A'],
    ['Time (start - end)', timeSummary],
    ['Recommended follow-up', data.recommendations]
  ];
}

export async function createMaintenanceServiceDocx(report) {
  const data = getDocumentData(report);
  const reportInfoRows = [
    ['Report ID', data.reportId, 'Report date', data.reportDate],
    ['Date submitted', data.submittedAt, 'Status', data.status],
    ['Technician', data.technician, 'Campus', data.campus]
  ];
  const footer = createDocxFooter(data.reportId);
  const document = new Document({
    creator: 'ComLab Facilities Management System',
    title: `Maintenance Service Report ${data.reportId}`,
    description: 'Maintenance service report',
    features: { updateFields: true },
    styles: {
      default: { document: { run: { font: BODY_FONT, size: 22, color: VALUE_COLOR } }, paragraph: { spacing: { after: 0 } } }
    },
    sections: [{
      properties: { page: { size: { width: DOCX_PAGE_WIDTH, height: 16838 }, margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } } },
      footers: { default: footer },
      children: [
        createLetterhead(data),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          keepNext: true,
          keepLines: true,
          spacing: { before: 45, after: 75 },
          children: [new TextRun({ text: 'MAINTENANCE SERVICE REPORT', bold: true, color: DARK_GREEN, size: 32, font: BODY_FONT })]
        }),
        sectionHeading('Report Information'),
        makeInfoTable(reportInfoRows),
        sectionHeading('Service Details', { before: 145, after: 75 }),
        makeServiceTable(createServiceRows(data)),
        createSignatureTable(data)
      ]
    }]
  });
  return Packer.toBuffer(document);
}

const cp1252Unicode = new Map([
  ['€', 0x80], ['‚', 0x82], ['ƒ', 0x83], ['„', 0x84], ['…', 0x85], ['†', 0x86], ['‡', 0x87], ['ˆ', 0x88],
  ['‰', 0x89], ['Š', 0x8a], ['‹', 0x8b], ['Œ', 0x8c], ['Ž', 0x8e], ['‘', 0x91], ['’', 0x92], ['“', 0x93],
  ['”', 0x94], ['•', 0x95], ['–', 0x96], ['—', 0x97], ['˜', 0x98], ['™', 0x99], ['š', 0x9a], ['›', 0x9b],
  ['œ', 0x9c], ['ž', 0x9e], ['Ÿ', 0x9f]
]);

function pdfSafeText(value) {
  let output = '';
  for (const character of normalizeHyphens(value)) {
    const code = character.codePointAt(0);
    if (character === '\r') continue;
    if (character === '\n' || character === '\t' || (code >= 0x20 && code <= 0xff)) output += character === '\t' ? ' ' : character;
    else if (cp1252Unicode.has(character)) output += String.fromCharCode(cp1252Unicode.get(character));
    else if (character === '\u00a0') output += ' ';
    else output += '?';
  }
  return output;
}

function escapePdfText(value) {
  return pdfSafeText(value).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function pdfTextWidth(value, size, bold = false) {
  const fontFactor = bold ? 0.55 : 0.51;
  let units = 0;
  for (const character of String(value)) {
    if (' ilI.,:;!\'|'.includes(character)) units += 0.27;
    else if ('mwMW@%&'.includes(character)) units += 0.82;
    else if (character === ' ') units += 0.28;
    else if (/[A-Z0-9]/.test(character)) units += 0.62;
    else units += 0.5;
  }
  return units * size * fontFactor / 0.51;
}

function wrapPdfText(value, maxWidth, size = 10, bold = false) {
  const output = [];
  const sourceLines = pdfSafeText(value ?? 'N/A').split(/\r\n|\r|\n/);
  for (const sourceLine of sourceLines) {
    const words = sourceLine.trim().split(/\s+/).filter(Boolean);
    if (!words.length) { output.push(''); continue; }
    let line = '';
    for (const originalWord of words) {
      let word = originalWord;
      if (pdfTextWidth(word, size, bold) > maxWidth) {
        const fragments = [];
        let fragment = '';
        for (const character of word) {
          if (fragment && pdfTextWidth(fragment + character, size, bold) > maxWidth) {
            fragments.push(fragment);
            fragment = character;
          } else fragment += character;
        }
        if (fragment) fragments.push(fragment);
        for (const part of fragments) {
          const next = line ? `${line} ${part}` : part;
          if (line && pdfTextWidth(next, size, bold) > maxWidth) { output.push(line); line = part; }
          else line = next;
        }
        continue;
      }
      const next = line ? `${line} ${word}` : word;
      if (line && pdfTextWidth(next, size, bold) > maxWidth) { output.push(line); line = word; }
      else line = next;
    }
    output.push(line);
  }
  return output.length ? output : ['N/A'];
}

function pdfRgb(hex) {
  return [0, 2, 4].map((offset) => (parseInt(hex.slice(offset, offset + 2), 16) / 255).toFixed(3)).join(' ');
}

function createPdfDocument(pages, reportId) {
  const firstPageObjectId = 7;
  const pageObjectIds = pages.map((_, index) => firstPageObjectId + index * 2);
  const universityLogoObjectId = firstPageObjectId + pages.length * 2;
  const ccsLogoObjectId = universityLogoObjectId + 1;
  const objects = new Map([
    [1, '<< /Type /Catalog /Pages 2 0 R >>'],
    [2, `<< /Type /Pages /Kids [${pageObjectIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageObjectIds.length} >>`],
    [3, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'],
    [4, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>'],
    [5, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Oblique /Encoding /WinAnsiEncoding >>'],
    [6, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-BoldOblique /Encoding /WinAnsiEncoding >>']
  ]);
  pages.forEach((commands, index) => {
    const pageId = pageObjectIds[index];
    const streamId = pageId + 1;
    const footerText = `Report ID: ${reportId}  |  Page ${index + 1} of ${pages.length}  |  Generated by ComLab Facilities Management System`;
    const footerSize = 7;
    const footerX = Math.max(PDF_MARGIN, (PDF_PAGE_WIDTH - pdfTextWidth(footerText, footerSize)) / 2);
    commands.push(`BT /F1 ${footerSize} Tf ${pdfRgb('727A74')} rg ${footerX.toFixed(1)} ${PDF_FOOTER_Y} Td (${escapePdfText(footerText)}) Tj ET`);
    const stream = `${commands.join('\n')}\n`;
    objects.set(pageId, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PDF_PAGE_WIDTH} ${PDF_PAGE_HEIGHT}] /Resources << /Font << /F1 3 0 R /F2 4 0 R /F3 5 0 R /F4 6 0 R >> /XObject << /MinSU ${universityLogoObjectId} 0 R /CCS ${ccsLogoObjectId} 0 R >> >> /Contents ${streamId} 0 R >>`);
    objects.set(streamId, `<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}endstream`);
  });
  objects.set(universityLogoObjectId, `<< /Type /XObject /Subtype /Image /Width ${UNIVERSITY_LOGO_DIMENSIONS.width} /Height ${UNIVERSITY_LOGO_DIMENSIONS.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${UNIVERSITY_LOGO.length} >>\nstream\n${UNIVERSITY_LOGO.toString('latin1')}\nendstream`);
  objects.set(ccsLogoObjectId, `<< /Type /XObject /Subtype /Image /Width ${CCS_LOGO_IMAGE.width} /Height ${CCS_LOGO_IMAGE.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /Length ${CCS_LOGO_IMAGE.data.length} >>\nstream\n${CCS_LOGO_IMAGE.data.toString('latin1')}\nendstream`);
  const objectCount = Math.max(...objects.keys()) + 1;
  let pdf = '%PDF-1.4\n';
  const offsets = new Array(objectCount).fill(0);
  for (let id = 1; id < objectCount; id += 1) {
    offsets[id] = Buffer.byteLength(pdf, 'latin1');
    pdf += `${id} 0 obj\n${objects.get(id)}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\n0 ${objectCount}\n0000000000 65535 f \n`;
  for (let id = 1; id < objectCount; id += 1) pdf += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objectCount} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(pdf, 'latin1');
}

export function createMaintenanceServicePdf(report) {
  const data = getDocumentData(report);
  const pages = [];
  let commands = [];
  let y = 0;
  const contentWidth = PDF_PAGE_WIDTH - 2 * PDF_MARGIN;
  const infoWidths = [contentWidth * 0.20, contentWidth * 0.30, contentWidth * 0.20, contentWidth * 0.30];
  const labelWidth = contentWidth * 0.30;
  const valueWidth = contentWidth - labelWidth;
  const tableLineHeight = 12;
  const cellPadding = 5;

  const drawText = (text, x, baseline, { size = 10, bold = false, italic = false, color = VALUE_COLOR, align = 'left' } = {}) => {
    const isNA = String(text).trim().toUpperCase() === 'N/A';
    const actualColor = isNA ? NA_COLOR : color;
    const font = bold ? (italic ? 'F4' : 'F2') : (italic || isNA ? 'F3' : 'F1');
    const width = pdfTextWidth(text, size, bold);
    const actualX = align === 'center' ? x - width / 2 : align === 'right' ? x - width : x;
    commands.push(`BT /${font} ${size} Tf ${pdfRgb(actualColor)} rg ${actualX.toFixed(1)} ${baseline.toFixed(1)} Td (${escapePdfText(text)}) Tj ET`);
  };

  const drawLine = (x1, y1, x2, y2, { color = BORDER_GREEN, width = 0.5 } = {}) => {
    commands.push(`q ${pdfRgb(color)} RG ${width} w ${x1.toFixed(1)} ${y1.toFixed(1)} m ${x2.toFixed(1)} ${y2.toFixed(1)} l S Q`);
  };

  const drawLogo = (top, maxSize = 44) => {
    const scale = Math.min(maxSize / UNIVERSITY_LOGO_DIMENSIONS.width, maxSize / UNIVERSITY_LOGO_DIMENSIONS.height);
    const logoWidth = UNIVERSITY_LOGO_DIMENSIONS.width * scale;
    const logoHeight = UNIVERSITY_LOGO_DIMENSIONS.height * scale;
    commands.push(`q ${logoWidth.toFixed(1)} 0 0 ${logoHeight.toFixed(1)} ${PDF_MARGIN.toFixed(1)} ${(top - logoHeight).toFixed(1)} cm /MinSU Do Q`);
  };

  const drawCcsLogo = (top, maxSize = 58) => {
    const scale = Math.min(maxSize / CCS_LOGO_IMAGE.width, maxSize / CCS_LOGO_IMAGE.height);
    const logoWidth = CCS_LOGO_IMAGE.width * scale;
    const logoHeight = CCS_LOGO_IMAGE.height * scale;
    const x = PDF_PAGE_WIDTH - PDF_MARGIN - logoWidth;
    commands.push(`q ${logoWidth.toFixed(1)} 0 0 ${logoHeight.toFixed(1)} ${x.toFixed(1)} ${(top - logoHeight).toFixed(1)} cm /CCS Do Q`);
  };

  const drawCenteredText = (text, baseline, options = {}) => drawText(text, PDF_PAGE_WIDTH / 2, baseline, { ...options, align: 'center' });

  const beginPage = (first = false) => {
    commands = [];
    pages.push(commands);
    y = PDF_PAGE_HEIGHT - PDF_MARGIN;
    if (first) {
      drawLogo(y, 84);
      drawCcsLogo(y, 84);
      drawCenteredText('MINDORO STATE UNIVERSITY', y - 23, { size: 13, bold: true, color: DARK_GREEN });
      drawCenteredText(data.campusHeader, y - 39, { size: 10, color: VALUE_COLOR });
      drawCenteredText('ComLab Facilities Management', y - 55, { size: 11, bold: true, color: DARK_GREEN });
      y -= 62;
      drawLine(PDF_MARGIN, y, PDF_PAGE_WIDTH - PDF_MARGIN, y, { color: GREEN, width: 0.8 });
      y -= 23;
      drawCenteredText('MAINTENANCE SERVICE REPORT', y, { size: 16, bold: true, color: DARK_GREEN });
      y -= 19;
    } else {
      drawText(`MAINTENANCE SERVICE REPORT - ${data.reportId}`, PDF_MARGIN, y - 8, { size: 9, bold: true, color: DARK_GREEN });
      y -= 22;
      drawLine(PDF_MARGIN, y, PDF_PAGE_WIDTH - PDF_MARGIN, y, { color: BORDER_GREEN, width: 0.5 });
      y -= 15;
    }
  };

  const startNewPage = () => beginPage(false);

  const drawSectionHeading = (title, neededHeight = tableLineHeight + cellPadding * 2) => {
    const headingHeight = 19;
    if (y - headingHeight - neededHeight < PDF_CONTENT_BOTTOM) startNewPage();
    drawText(title, PDF_MARGIN, y - 12, { size: 12, bold: true, color: DARK_GREEN });
    y -= headingHeight;
  };

  const drawTableText = (lines, x, top, { bold = false, color = VALUE_COLOR, fontSize = 10 } = {}) => {
    lines.forEach((line, index) => {
      const baseline = top - cellPadding - 9 - index * tableLineHeight;
      drawText(line || ' ', x, baseline, { size: fontSize, bold, color });
    });
  };

  const drawInfoRow = (cells) => {
    const wrapped = cells.map((cell, index) => wrapPdfText(cell.value, infoWidths[index] - 10, 10, cell.label));
    const lineCount = Math.max(1, ...wrapped.map((lines) => lines.length));
    const rowHeight = cellPadding * 2 + lineCount * tableLineHeight;
    if (y - rowHeight < PDF_CONTENT_BOTTOM) startNewPage();
    const top = y;
    const bottom = y - rowHeight;
    let x = PDF_MARGIN;
    const positions = [x];
    cells.forEach((cell, index) => {
      if (cell.label) commands.push(`q ${pdfRgb(PALE_GREEN)} rg ${x.toFixed(1)} ${bottom.toFixed(1)} ${infoWidths[index].toFixed(1)} ${rowHeight.toFixed(1)} re f Q`);
      drawTableText(wrapped[index], x + 5, top, { bold: cell.label, color: cell.label ? DARK_GREEN : VALUE_COLOR });
      x += infoWidths[index];
      positions.push(x);
    });
    drawLine(PDF_MARGIN, top, PDF_PAGE_WIDTH - PDF_MARGIN, top);
    drawLine(PDF_MARGIN, bottom, PDF_PAGE_WIDTH - PDF_MARGIN, bottom);
    positions.forEach((position) => drawLine(position, bottom, position, top));
    y = bottom;
  };

  const drawServiceSegment = (label, valueLines, labelLines, top, lineCount) => {
    const rowHeight = cellPadding * 2 + lineCount * tableLineHeight;
    const bottom = top - rowHeight;
    commands.push(`q ${pdfRgb(PALE_GREEN)} rg ${PDF_MARGIN} ${bottom.toFixed(1)} ${labelWidth.toFixed(1)} ${rowHeight.toFixed(1)} re f Q`);
    commands.push(`q ${pdfRgb(BORDER_GREEN)} RG 0.5 w ${PDF_MARGIN.toFixed(1)} ${bottom.toFixed(1)} ${contentWidth.toFixed(1)} ${rowHeight.toFixed(1)} re S Q`);
    drawLine(PDF_MARGIN + labelWidth, bottom, PDF_MARGIN + labelWidth, top);
    drawTableText(labelLines, PDF_MARGIN + 5, top, { bold: true, color: DARK_GREEN });
    drawTableText(valueLines, PDF_MARGIN + labelWidth + 6, top, { color: VALUE_COLOR });
    y = bottom;
  };

  const drawServiceRow = (label, value) => {
    const labelLines = wrapPdfText(label, labelWidth - 10, 10, true);
    const valueLines = wrapPdfText(value || 'N/A', valueWidth - 12, 10);
    const totalLines = Math.max(labelLines.length, valueLines.length);
    const rowHeight = cellPadding * 2 + totalLines * tableLineHeight;
    const freshCapacity = Math.floor((PDF_PAGE_HEIGHT - PDF_MARGIN - 22 - PDF_CONTENT_BOTTOM - cellPadding * 2) / tableLineHeight);
    if (totalLines <= freshCapacity) {
      if (y - rowHeight < PDF_CONTENT_BOTTOM) startNewPage();
      drawServiceSegment(label, valueLines, labelLines, y, totalLines);
      return;
    }
    if (y - PDF_CONTENT_BOTTOM < 5 * tableLineHeight) startNewPage();
    let offset = 0;
    while (offset < valueLines.length) {
      let capacity = Math.floor((y - PDF_CONTENT_BOTTOM - cellPadding * 2) / tableLineHeight);
      if (capacity < 3) {
        startNewPage();
        capacity = Math.floor((y - PDF_CONTENT_BOTTOM - cellPadding * 2) / tableLineHeight);
      }
      const lines = valueLines.slice(offset, offset + capacity);
      const segmentLabel = offset === 0 ? label : `${label} (continued)`;
      const wrappedLabel = wrapPdfText(segmentLabel, labelWidth - 10, 10, true);
      const lineCount = Math.max(lines.length, wrappedLabel.length);
      drawServiceSegment(segmentLabel, lines, wrappedLabel, y, lineCount);
      offset += lines.length;
      if (offset < valueLines.length) startNewPage();
    }
  };

  const drawSignatures = () => {
    const signers = [
      { label: 'Prepared by:', name: data.technician.toUpperCase(), role: 'Technician' },
      { label: 'Noted by:', name: data.notedBy ? data.notedBy.toUpperCase() : '', role: 'Laboratory In-charge / Supervisor' }
    ];
    if (data.approvedBy) signers.push({ label: 'Approved by:', name: data.approvedBy.toUpperCase(), role: data.approvedByRole });
    const blockHeight = 105;
    if (y - blockHeight < PDF_CONTENT_BOTTOM) startNewPage();
    const top = y;
    const columnWidth = contentWidth / signers.length;
    signers.forEach((signer, index) => {
      const columnLeft = PDF_MARGIN + columnWidth * index;
      const columnRight = PDF_MARGIN + columnWidth * (index + 1);
      const bottom = top - blockHeight;
      drawLine(columnLeft, top, columnRight, top, { color: BORDER_GREEN, width: 0.5 });
      drawLine(columnLeft, bottom, columnRight, bottom, { color: BORDER_GREEN, width: 0.5 });
      drawLine(columnLeft, bottom, columnLeft, top, { color: BORDER_GREEN, width: 0.5 });
      drawLine(columnRight, bottom, columnRight, top, { color: BORDER_GREEN, width: 0.5 });
      const centerX = PDF_MARGIN + columnWidth * index + columnWidth / 2;
      drawText(signer.label, centerX, top - 10, { size: 9, bold: true, color: DARK_GREEN, align: 'center' });
      const signatureLineY = top - 52;
      drawLine(PDF_MARGIN + columnWidth * index + 12, signatureLineY, PDF_MARGIN + columnWidth * (index + 1) - 12, signatureLineY, { color: '59635C', width: 0.5 });
      drawText(signer.name, centerX, top - 60, { size: 9, bold: true, color: VALUE_COLOR, align: 'center' });
      drawText(signer.role, centerX, top - 75, { size: signers.length === 3 ? 8 : 9, color: VALUE_COLOR, align: 'center' });
      drawText('Date:', centerX, top - 90, { size: 9, color: VALUE_COLOR, align: 'center' });
    });
    y -= blockHeight;
  };

  beginPage(true);
  drawSectionHeading('Report Information', tableLineHeight + 2 * cellPadding);
  [
    [
      { label: true, value: 'Report ID' }, { label: false, value: data.reportId },
      { label: true, value: 'Report date' }, { label: false, value: data.reportDate }
    ],
    [
      { label: true, value: 'Date submitted' }, { label: false, value: data.submittedAt },
      { label: true, value: 'Status' }, { label: false, value: data.status }
    ],
    [
      { label: true, value: 'Technician' }, { label: false, value: data.technician },
      { label: true, value: 'Campus' }, { label: false, value: data.campus }
    ]
  ].forEach(drawInfoRow);

  drawSectionHeading('Service Details', tableLineHeight + 2 * cellPadding);
  createServiceRows(data).forEach(([label, value]) => drawServiceRow(label, value));
  drawSignatures();
  return createPdfDocument(pages, data.reportId);
}
