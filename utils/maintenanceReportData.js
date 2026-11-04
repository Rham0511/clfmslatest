export const MAINTENANCE_DETAIL_FIELDS = [
  { key: 'equipmentArea', label: 'Equipment / area' },
  { key: 'reportedIssue', label: 'Reported issue or assigned task' },
  { key: 'inspectionFindings', label: 'Inspection findings' },
  { key: 'partsMaterialsUsed', label: 'Parts or materials used' },
  { key: 'workPerformed', label: 'Work performed' },
  { key: 'outcomeVerification', label: 'Outcome and verification' },
  { key: 'timeStarted', label: 'Time started' },
  { key: 'timeCompleted', label: 'Time completed' }
];

const detailFieldByLabel = new Map(MAINTENANCE_DETAIL_FIELDS.map((field) => [field.label.toLowerCase(), field.key]));

export function parseMaintenanceSummary(summary = '') {
  const parsed = Object.fromEntries(MAINTENANCE_DETAIL_FIELDS.map(({ key }) => [key, '']));
  const legacyLines = [];
  let activeField = null;

  for (const line of String(summary ?? '').split(/\r\n|\r|\n/)) {
    const heading = line.match(/^\s*([^:]+?)\s*:?\s*$/);
    const inlineHeading = line.match(/^\s*([^:]+?)\s*:\s*(.*)$/);
    const label = (inlineHeading?.[1] || heading?.[1] || '').trim().toLowerCase();
    const fieldKey = detailFieldByLabel.get(label);
    if (fieldKey) {
      activeField = fieldKey;
      if (inlineHeading?.[2]) parsed[activeField] += `${parsed[activeField] ? '\n' : ''}${inlineHeading[2]}`;
      continue;
    }
    if (activeField) parsed[activeField] += `${parsed[activeField] ? '\n' : ''}${line}`;
    else if (line.trim()) legacyLines.push(line);
  }

  if (!parsed.workPerformed.trim() && legacyLines.length) parsed.workPerformed = legacyLines.join('\n').trim();
  for (const field of MAINTENANCE_DETAIL_FIELDS) parsed[field.key] = parsed[field.key].trim();
  return parsed;
}

export function getMaintenanceReportDetails(report = {}) {
  const parsed = parseMaintenanceSummary(report.summary);
  return Object.fromEntries(MAINTENANCE_DETAIL_FIELDS.map(({ key }) => {
    const submitted = String(report[key] ?? '').trim();
    const existing = String(parsed[key] ?? '').trim();
    return [key, submitted || existing || 'N/A'];
  }));
}

export function buildMaintenanceSummary(details = {}) {
  const normalized = getMaintenanceReportDetails(details);
  return MAINTENANCE_DETAIL_FIELDS
    .map(({ key, label }) => `${label}\n${normalized[key] || 'N/A'}`)
    .join('\n\n');
}

export function normalizeIsoReportDate(value) {
  const match = String(value ?? '').trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const [, yearText, monthText, dayText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;
  return `${yearText}-${monthText}-${dayText}`;
}

export function formatReportDate(value) {
  const dateText = value instanceof Date && !Number.isNaN(value.getTime())
    ? `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, '0')}-${String(value.getUTCDate()).padStart(2, '0')}`
    : String(value ?? '').slice(0, 10);
  const isoDate = normalizeIsoReportDate(dateText);
  if (!isoDate) return 'N/A';
  const [year, month, day] = isoDate.split('-').map(Number);
  return new Intl.DateTimeFormat('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC'
  }).format(new Date(Date.UTC(year, month - 1, day, 12)));
}

export function formatSubmittedAt(value) {
  if (!value) return 'N/A';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return 'N/A';
  return new Intl.DateTimeFormat('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'Asia/Manila',
    timeZoneName: 'short'
  }).format(date);
}

export function getTodayInManilaIso(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'Asia/Manila'
  }).formatToParts(now);
  const values = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function formatMaintenanceReportId(year, sequence) {
  return `TM-${String(year).padStart(4, '0')}-${String(sequence).padStart(4, '0')}`;
}
