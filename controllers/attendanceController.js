import { Op, QueryTypes } from "sequelize";
import { randomBytes } from "node:crypto";
import { sequelize } from "../models/db.js";
import QRCode from "qrcode";
import { logAuditEntry } from "./auditController.js";
import { getUserCampusFromSession, canManageRecord } from "./campusAuthController.js";
import { Attendance } from "../models/attendanceModel.js";
import { AttendanceSession } from "../models/attendanceSessionModel.js";
import { LaboratorySchedule } from "../models/laboratoryScheduleModel.js";
import { ClassListEntry } from "../models/classListEntryModel.js";
import { getArchivedEntityIds } from "../models/archiveRecords.js";
import { User } from "../models/userModel.js";
import XLSX from "xlsx";
import {
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  WidthType
} from "docx";

const getConfiguredBaseUrl = (req = null) => {
  const configuredBaseUrl = process.env.BASE_URL?.trim();

  if (configuredBaseUrl) {
    return configuredBaseUrl.replace(/\/+$/, "");
  }

  if (req) {
    const forwardedProto = req.headers?.["x-forwarded-proto"];
    const protocol = Array.isArray(forwardedProto)
      ? forwardedProto[0]
      : forwardedProto || req.protocol || "http";
    const host = req.get?.("host") || req.headers?.host || "localhost:3000";
    return `${protocol}://${host}`.replace(/\/+$/, "");
  }

  console.warn("[attendance] BASE_URL is not configured. Falling back to the current request host so QR codes can still be generated.");
  return "http://localhost:3000";
};

const buildScanUrl = (token, req = null) => {
  const baseUrl = getConfiguredBaseUrl(req);
  if (!baseUrl) {
    return null;
  }

  return `${baseUrl}/attendance/scan/${encodeURIComponent(token)}`;
};

const sendJsonError = (res, status, message, error) => {
  console.error(message, error);
  return res.status(status).json({
    success: false,
    error: message,
    details: error?.message || null
  });
};

const escapeHtml = (value) => String(value)
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/\"/g, "&quot;")
  .replace(/'/g, "&#39;");

const normalizeAttendanceYear = (value) => {
  const normalized = String(value || "").trim().toLocaleLowerCase().replace(/[\s._-]+/g, "");
  const yearAliases = {
    "1": "1st Year", "1st": "1st Year", "1styear": "1st Year", "first": "1st Year", "firstyear": "1st Year",
    "2": "2nd Year", "2nd": "2nd Year", "2ndyear": "2nd Year", "second": "2nd Year", "secondyear": "2nd Year",
    "3": "3rd Year", "3rd": "3rd Year", "3rdyear": "3rd Year", "third": "3rd Year", "thirdyear": "3rd Year",
    "4": "4th Year", "4th": "4th Year", "4thyear": "4th Year", "fourth": "4th Year", "fourthyear": "4th Year"
  };
  return yearAliases[normalized] || null;
};

const normalizeAttendanceSection = (value) => String(value || "").trim().replace(/\s+/g, " ").toLocaleUpperCase();

const getAttendanceCohortError = (student, schedule) => {
  const scheduledYear = normalizeAttendanceYear(schedule?.yearLevel);
  const scheduledSection = normalizeAttendanceSection(schedule?.section);
  if (!scheduledYear || !scheduledSection) {
    return "This schedule does not have a valid year level and section yet. Please contact the administrator before checking in.";
  }

  const studentYear = normalizeAttendanceYear(student?.year || student?.yearLevel || student?.yearLevelName);
  const studentSection = normalizeAttendanceSection(student?.section || student?.sectionName);
  if (!studentYear || !studentSection) {
    return "Your account is missing a valid year level or section. Please update your student profile before checking in.";
  }

  if (studentYear !== scheduledYear || studentSection !== scheduledSection) {
    return `This class is for ${schedule.yearLevel}, Section ${schedule.section}. Your account is registered as ${student.year || student.yearLevel || "unknown year"}, Section ${student.section || student.sectionName || "unknown"}. You cannot attend a different year level or section.`;
  }
  return null;
};

const sendAttendanceCohortError = (req, res, message, status = 403) => {
  if (req.accepts("html")) {
    return res.status(status).send(renderAttendancePageHtml({
      title: "Class Section Mismatch",
      heading: "You Cannot Attend This Class",
      message,
      detailRows: [["Status", "Year level and section do not match"]],
      statusLabel: "Check-in blocked",
      primaryLabel: "Return to Student Dashboard",
      primaryHref: "/student/dashboard",
      secondaryLabel: "Close",
      secondaryHref: "#",
      success: false
    }));
  }
  return res.status(status).json({ success: false, error: message });
};

const formatDateLabel = (value) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
};

const formatTimeLabel = (value) => {
  if (!value) return "—";
  return value;
};

const getAttendanceRecordIdentity = (record) => {
  if (record?.id) return `id:${String(record.id).trim().toLowerCase()}`;

  const studentId = record?.studentId || record?.student_number || record?.studentNumber || "";
  const sessionToken = record?.sessionToken || record?.token || "";
  const dateValue = record?.date || record?.createdAt || record?.updatedAt || "";
  const subjectValue = record?.subject || "";
  const labValue = record?.lab || "";

  if (studentId || sessionToken) {
    return [
      "session",
      String(studentId).trim().toLowerCase(),
      String(sessionToken).trim().toLowerCase(),
      String(dateValue).trim().toLowerCase(),
      String(subjectValue).trim().toLowerCase(),
      String(labValue).trim().toLowerCase()
    ].join("|");
  }

  return [
    String(dateValue).trim().toLowerCase(),
    String(record?.timeIn || record?.time || "").trim().toLowerCase(),
    String(subjectValue).trim().toLowerCase(),
    String(labValue).trim().toLowerCase()
  ].join("|");
};

const deduplicateAttendanceRecords = (records = []) => {
  const uniqueRecords = [];
  const seen = new Set();

  (Array.isArray(records) ? records : []).forEach((record) => {
    const identity = getAttendanceRecordIdentity(record);
    if (!seen.has(identity)) {
      seen.add(identity);
      uniqueRecords.push(record);
    }
  });

  return uniqueRecords.sort((a, b) => (b.date || b.createdAt || "").localeCompare(a.date || a.createdAt || ""));
};

const parseAttendanceScanTime = (value, referenceDate = new Date()) => {
  if (!value || String(value).trim() === "" || String(value).trim().toLowerCase() === "not recorded") {
    return null;
  }

  const text = String(value).trim();
  const directDate = new Date(text);
  if (!Number.isNaN(directDate.getTime())) {
    return directDate;
  }

  const clockMatch = text.match(/^(\d{1,2})(?::(\d{1,2}))?(?::(\d{1,2}))?\s*(AM|PM)$/i);
  if (clockMatch) {
    let hours = Number(clockMatch[1]);
    const minutes = Number(clockMatch[2] || 0);
    const seconds = Number(clockMatch[3] || 0);
    const meridiem = clockMatch[4].toUpperCase();

    if (meridiem === "AM" && hours === 12) hours = 0;
    if (meridiem === "PM" && hours !== 12) hours += 12;

    const parsedDate = new Date(referenceDate);
    parsedDate.setHours(hours, minutes, seconds, 0);
    return parsedDate;
  }

  return null;
};

const parseScheduleClockTime = (value, referenceDate = new Date()) => {
  if (!value) return null;

  const text = String(value).trim();
  const match = text.match(/^(\d{1,2})(?::(\d{1,2}))?\s*(AM|PM)$/i);
  if (!match) {
    const fallback = Number(text);
    if (!Number.isNaN(fallback)) {
      const date = new Date(referenceDate);
      date.setHours(0, fallback, 0, 0);
      return date;
    }
    return null;
  }

  let hours = Number(match[1]);
  const minutes = Number(match[2] || 0);
  const meridiem = match[3].toUpperCase();

  if (meridiem === "AM" && hours === 12) hours = 0;
  if (meridiem === "PM" && hours !== 12) hours += 12;

  const date = new Date(referenceDate);
  date.setHours(hours, minutes, 0, 0);
  return date;
};

const getScheduleAttendanceWindow = (schedule, referenceDate = new Date()) => {
  if (!schedule) return null;

  const startTime = parseScheduleClockTime(schedule.startTime, referenceDate);
  const rawEndTime = parseScheduleClockTime(schedule.endTime, referenceDate);
  if (!startTime || !rawEndTime) return null;

  let endTime = new Date(rawEndTime);
  if (endTime.getTime() <= startTime.getTime()) {
    endTime = new Date(endTime.getTime() + 24 * 60 * 60000);
  }

  const presentUntil = new Date(startTime.getTime() + 15 * 60000);
  const lateUntil = new Date(startTime.getTime() + 30 * 60000);
  return { startTime, endTime, presentUntil, lateUntil };
};

const parseScheduleMinutes = (value) => {
  const match = String(value || "").trim().match(/^(\d{1,2})(?::(\d{1,2}))?\s*(AM|PM)?$/i);
  if (!match) return null;
  let hours = Number(match[1]);
  const minutes = Number(match[2] || 0);
  if (minutes > 59 || hours > 24 || (hours === 24 && minutes !== 0)) return null;
  if (match[3]) {
    if (hours < 1 || hours > 12) return null;
    const meridiem = match[3].toUpperCase();
    if (meridiem === "AM" && hours === 12) hours = 0;
    if (meridiem === "PM" && hours !== 12) hours += 12;
  } else if (hours === 24) {
    hours = 0;
  }
  return hours * 60 + minutes;
};

const getManilaDateTimeParts = (date) => {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Manila",
    weekday: "long",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date);
  return Object.fromEntries(parts.map(({ type, value }) => [type, value]));
};

export const getClassScheduleStatus = (schedule, now = new Date()) => {
  const dayOrder = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const scheduledDay = dayOrder.find((day) => day.toLowerCase() === String(schedule?.dayOfWeek || "").trim().toLowerCase());
  const startMinutes = parseScheduleMinutes(schedule?.startTime);
  const endMinutes = parseScheduleMinutes(schedule?.endTime);
  if (!scheduledDay || startMinutes === null || endMinutes === null) return "Upcoming";

  const local = getManilaDateTimeParts(now);
  const today = local.weekday;
  const currentMinutes = Number(local.hour) * 60 + Number(local.minute);
  if (today === scheduledDay) {
    if (endMinutes > startMinutes) {
      if (currentMinutes >= endMinutes) return "Ended";
      if (currentMinutes >= startMinutes) return "In Progress";
      return "Upcoming";
    }
    return currentMinutes >= startMinutes ? "In Progress" : "Upcoming";
  }

  const previousDay = dayOrder[(dayOrder.indexOf(today) + 6) % 7];
  if (endMinutes <= startMinutes && scheduledDay === previousDay) {
    return currentMinutes < endMinutes ? "In Progress" : "Ended";
  }
  return "Upcoming";
};

export const getManilaScheduleEndDate = (schedule, now = new Date()) => {
  const local = getManilaDateTimeParts(now);
  const dayOrder = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const today = local.weekday;
  const scheduledDay = dayOrder.find((day) => day.toLowerCase() === String(schedule?.dayOfWeek || "").trim().toLowerCase());
  const endMinutes = parseScheduleMinutes(schedule?.endTime);
  const startMinutes = parseScheduleMinutes(schedule?.startTime);
  if (!scheduledDay || endMinutes === null || startMinutes === null) return null;

  let date = new Date(Date.UTC(Number(local.year), Number(local.month) - 1, Number(local.day)));
  if (today !== scheduledDay) {
    const previousDay = dayOrder[(dayOrder.indexOf(today) + 6) % 7];
    if (endMinutes > startMinutes || previousDay !== scheduledDay) return null;
  } else if (endMinutes <= startMinutes && Number(local.hour) * 60 + Number(local.minute) < startMinutes) {
    date.setUTCDate(date.getUTCDate() + 1);
  }

  const endDayOffset = endMinutes <= startMinutes && today === scheduledDay ? 1 : 0;
  date.setUTCDate(date.getUTCDate() + endDayOffset);
  return new Date(Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
    Math.floor(endMinutes / 60) - 8,
    endMinutes % 60
  ));
};

export const getAttendanceStatusForSchedule = (schedule, now = new Date(), referenceDate = now) => {
  const window = getScheduleAttendanceWindow(schedule, referenceDate);
  if (!window) return "Present";

  const scanTime = now;
  const { startTime, presentUntil, lateUntil, endTime } = window;

  console.log("[attendance-status] Start Time:", startTime.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true }));
  console.log("[attendance-status] Present Until:", presentUntil.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true }));
  console.log("[attendance-status] Late Until:", lateUntil.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true }));
  console.log("[attendance-status] End Time:", endTime.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true }));
  console.log("[attendance-status] Scan Time:", scanTime.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true }));

  if (scanTime < startTime) {
    return "Not Yet Open";
  }

  if (scanTime <= presentUntil) {
    return "Present";
  }

  if (scanTime <= lateUntil) {
    return "Late";
  }

  if (scanTime < endTime) {
    return "Absent";
  }

  return "Closed";
};

export const recordPCStationAttendance = async ({ student, station, transaction, now = new Date() }) => {
  const studentId = String(student?.student_number || "").trim();

  const getLabNumber = (value) => {
    const text = String(value || "").trim();
    const lab = text.match(/(?:computer\s*lab|com\s*lab|laboratory|lab)\s*[-#:]?\s*([12])\b/i)?.[1];
    if (lab) return lab;
    const room = text.match(/room\s*(202|204)\b/i)?.[1];
    return room === "202" ? "1" : room === "204" ? "2" : null;
  };
  const stationLabNumber = getLabNumber(station?.location);
  if (!stationLabNumber) return { recorded: false, reason: "invalid-station-location" };

  const campus = String(student.campus || "").trim().replace(/\s*Campus\s*$/i, "").trim();
  const candidates = await LaboratorySchedule.findAll({
    where: {
      status: { [Op.in]: ["Confirmed", "confirmed", "Active", "active"] },
      campus: { [Op.in]: [campus, `${campus} Campus`] }
    },
    order: [["id", "ASC"]],
    transaction,
    lock: transaction?.LOCK?.UPDATE
  });
  const archivedScheduleIds = new Set((await getArchivedEntityIds("laboratory-schedule")).map(String));
  const activeCohortSchedules = candidates.filter((schedule) =>
    !archivedScheduleIds.has(String(schedule.id)) &&
    canManageRecord(student.campus, schedule.campus) &&
    !getAttendanceCohortError(student, schedule) &&
    getLabNumber(schedule.laboratoryRoom) === stationLabNumber &&
    getClassScheduleStatus(schedule, now) === "In Progress"
  );

  if (!activeCohortSchedules.length) return { recorded: false, reason: "no-current-class" };
  if (activeCohortSchedules.length > 1) return { recorded: false, reason: "multiple-current-classes" };

  const schedule = activeCohortSchedules[0];
  const classEnd = getManilaScheduleEndDate(schedule, now);
  const autoLogoutAt = classEnd;
  if (!studentId) return { recorded: false, reason: "missing-student-id", schedule, autoLogoutAt };
  const clock = parseScheduleMinutes(schedule.startTime);
  if (clock === null) return { recorded: false, reason: "invalid-schedule-time", schedule, autoLogoutAt };
  const local = getManilaDateTimeParts(now);
  let elapsedMinutes = Number(local.hour) * 60 + Number(local.minute) - clock;
  if (elapsedMinutes < 0) elapsedMinutes += 24 * 60;
  const status = elapsedMinutes <= 15 ? "Present" : elapsedMinutes <= 30 ? "Late" : null;
  if (!status) return { recorded: false, reason: "attendance-window-closed", schedule, autoLogoutAt };

  const date = `${local.year}-${local.month}-${local.day}`;
  const timeIn = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Manila",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true
  }).format(now);
  const session = await AttendanceSession.findOne({
    where: { laboratoryScheduleId: schedule.id },
    order: [["createdAt", "DESC"]],
    transaction
  });
  const existing = await Attendance.findOne({
    where: { studentId, laboratoryScheduleId: schedule.id, date },
    order: [["updatedAt", "DESC"]],
    transaction,
    lock: transaction?.LOCK?.UPDATE
  });

  if (existing && ["Present", "Late"].includes(existing.status)) {
    if (existing.pcStationSetId !== station.setId) {
      existing.pcStationSetId = station.setId;
      await existing.save({ transaction });
    }
    return {
      recorded: true,
      alreadyRecorded: true,
      status: existing.status,
      schedule,
      stationSetId: station.setId,
      attendanceId: existing.id,
      autoLogoutAt
    };
  }

  const attendanceValues = {
    fullName: student.name || "Student",
    courseSection: [schedule.yearLevel, schedule.section ? `Section ${schedule.section}` : ""].filter(Boolean).join(" • "),
    subject: schedule.subject,
    lab: schedule.laboratoryRoom,
    instructor: schedule.instructor || "Instructor",
    timeIn,
    status,
    sessionToken: session?.token || null,
    pcStationSetId: station.setId
  };

  let attendanceId;
  if (existing) {
    Object.assign(existing, attendanceValues);
    await existing.save({ transaction });
    attendanceId = existing.id;
  } else {
    const attendance = await Attendance.create({
      studentId,
      laboratoryScheduleId: schedule.id,
      date,
      ...attendanceValues
    }, { transaction });
    attendanceId = attendance.id;
  }

  return { recorded: true, status, schedule, stationSetId: station.setId, attendanceId, autoLogoutAt };
};

const getAttendanceStatusForSession = async (session, now = new Date()) => {
  if (!session?.laboratoryScheduleId) return null;

  const schedule = await LaboratorySchedule.findByPk(session.laboratoryScheduleId);
  if (!schedule) return null;

  if (session?.intendedStudentUserId) {
    const classStatus = getClassScheduleStatus(schedule, now);
    if (classStatus === "Upcoming") return "Not Yet Open";
    if (classStatus === "Ended") return "Closed";
    return getAttendanceStatusForSchedule(schedule, now, now);
  }

  const referenceDate = session?.createdAt ? new Date(session.createdAt) : now;
  return getAttendanceStatusForSchedule(schedule, now, referenceDate);
};

const getNextScheduleEndDate = (schedule, now = new Date()) => {
  const dayOrder = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const local = getManilaDateTimeParts(now);
  const currentDay = dayOrder.indexOf(local.weekday);
  const scheduledDay = dayOrder.findIndex((day) => day.toLowerCase() === String(schedule?.dayOfWeek || "").trim().toLowerCase());
  const endMinutes = parseScheduleMinutes(schedule?.endTime);
  if (currentDay < 0 || scheduledDay < 0 || endMinutes === null) return null;

  const daysUntilClass = (scheduledDay - currentDay + 7) % 7;
  const occurrenceDate = new Date(Date.UTC(Number(local.year), Number(local.month) - 1, Number(local.day) + daysUntilClass));
  const endDate = new Date(Date.UTC(
    occurrenceDate.getUTCFullYear(),
    occurrenceDate.getUTCMonth(),
    occurrenceDate.getUTCDate(),
    Math.floor(endMinutes / 60) - 8,
    endMinutes % 60
  ));

  return new Date(endDate.getTime() + 15 * 60000);
};

export const deriveAttendanceStatusFromRecord = (record, schedule, session = null, now = new Date()) => {
  if (!schedule) {
    return record?.status || "Absent";
  }

  const referenceDate = session?.createdAt ? new Date(session.createdAt) : (record?.date ? new Date(`${record.date}T00:00:00`) : now);
  const window = getScheduleAttendanceWindow(schedule, referenceDate);
  if (!window) {
    return record?.status || "Absent";
  }

  if (!record?.timeIn || String(record.timeIn).trim().toLowerCase() === "not recorded") {
    return "Absent";
  }

  const scanTime = parseAttendanceScanTime(record.timeIn, referenceDate);
  if (!scanTime) {
    return record?.status || "Absent";
  }

  if (scanTime <= window.presentUntil) {
    return "Present";
  }

  if (scanTime <= window.lateUntil) {
    return "Late";
  }

  return "Absent";
};

const getSessionCompletionStatus = (session, schedule, now = new Date()) => {
  if (!schedule) return "Completed";

  const window = getScheduleAttendanceWindow(schedule, session?.createdAt || now);
  if (!window) return "Completed";
  return now >= window.lateUntil ? "Completed" : "Active";
};

const finalizeAttendanceForSchedule = async (session, now = new Date()) => {
  if (!session?.laboratoryScheduleId || !session?.token) return null;

  const schedule = await LaboratorySchedule.findByPk(session.laboratoryScheduleId);
  if (!schedule) return null;

  const window = getScheduleAttendanceWindow(schedule, now);
  if (!window || now <= window.endTime) return null;

  const records = await Attendance.findAll({
    where: {
      laboratoryScheduleId: session.laboratoryScheduleId,
      sessionToken: session.token,
      status: "Absent"
    }
  });

  if (!records.length) return null;

  await Promise.all(records.map((record) => Attendance.update({ status: "Absent" }, { where: { id: record.id } })));
  return records.length;
};

const renderAttendancePageHtml = ({
  title,
  heading,
  message,
  detailRows,
  statusLabel,
  primaryLabel,
  primaryHref,
  secondaryLabel,
  secondaryHref,
  success = true,
  formAction = null,
  formInputs = {},
  successVariant = false,
  highlightMessage = null
}) => {
  const detailsHtml = detailRows.map(([label, value]) => `
    <div class="detail-row">
      <span class="detail-label">${escapeHtml(label)}</span>
      <strong class="detail-value">${escapeHtml(value)}</strong>
    </div>
  `).join("");

  const highlightMarkup = highlightMessage
    ? `<div class="highlight-message">${escapeHtml(highlightMessage)}</div>`
    : "";

  const formMarkup = formAction
    ? `
      <form method="POST" action="${escapeHtml(formAction)}" class="actions">
        ${Object.entries(formInputs).map(([name, value]) => `<input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(value)}" />`).join("")}
        <button type="submit" class="primary-btn">${escapeHtml(primaryLabel)}</button>
      </form>
    `
    : `
      <div class="actions">
        <a href="${escapeHtml(primaryHref)}" class="primary-btn">${escapeHtml(primaryLabel)}</a>
        <a href="${escapeHtml(secondaryHref)}" class="secondary-btn">${escapeHtml(secondaryLabel)}</a>
      </div>
    `;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(title)}</title>
  <style>
    :root { color-scheme: dark; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      background: radial-gradient(circle at top left, rgba(16, 185, 129, 0.16), transparent 35%), linear-gradient(135deg, #07120c 0%, #0d1712 55%, #08110c 100%);
      color: #f2f8f4;
      font-family: Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      padding: 1rem;
    }
    .card {
      width: min(100%, 700px);
      border-radius: 1.5rem;
      border: 2px solid rgba(6, 78, 59, 0.6);
      background: linear-gradient(145deg, rgba(8, 19, 14, 0.98), rgba(4, 10, 8, 0.96));
      box-shadow: 0 28px 70px rgba(2, 8, 23, 0.46);
      padding: 1.45rem;
      animation: fadeIn 0.35s ease;
      backdrop-filter: blur(16px);
    }
    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(10px); }
      to { opacity: 1; transform: translateY(0); }
    }
    .status-pill {
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
      padding: 0.6rem 0.95rem;
      border-radius: 999px;
      font-weight: 700;
      background: rgba(2, 44, 34, 0.82);
      border: 1px solid rgba(52, 211, 153, 0.36);
      color: #6ee7b7;
      margin-bottom: 1rem;
      letter-spacing: 0.02em;
    }
    .success-hero {
      display: flex;
      align-items: center;
      gap: 0.9rem;
      padding: 1rem 1rem 1.05rem;
      border-radius: 1rem;
      background: rgba(5, 20, 15, 0.72);
      border: 1px solid rgba(16, 185, 129, 0.2);
      margin-bottom: 1rem;
    }
    .success-hero .icon {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 2.5rem;
      height: 2.5rem;
      border-radius: 999px;
      background: rgba(16, 185, 129, 0.2);
      color: #a7f3d0;
      font-size: 1.15rem;
      border: 1px solid rgba(52, 211, 153, 0.26);
      flex-shrink: 0;
    }
    .highlight-message {
      margin-top: 0.75rem;
      padding: 0.9rem 0.95rem;
      border-radius: 0.95rem;
      background: rgba(4, 20, 15, 0.72);
      color: #bbf7d0;
      border: 1px solid rgba(16, 185, 129, 0.2);
    }
    h1 { margin: 0; font-size: clamp(1.5rem, 3vw, 2rem); color: #ecfdf5; font-weight: 700; }
    p { color: rgba(187, 247, 208, 0.84); line-height: 1.6; margin: 0.35rem 0 0; }
    .detail-list { margin: 1rem 0 1.25rem; display: grid; gap: 0.7rem; }
    .detail-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 1rem;
      padding: 0.9rem 1rem;
      border-radius: 0.95rem;
      background: rgba(6, 14, 10, 0.78);
      border: 1px solid rgba(16, 185, 129, 0.24);
      color: #cbd5e1;
    }
    .detail-label { color: #6ee7b7; font-weight: 700; }
    .detail-value { color: #f5f7f2; text-align: right; font-weight: 700; }
    .actions { display: flex; flex-wrap: wrap; gap: 0.75rem; margin-top: 1.05rem; }
    .primary-btn, .secondary-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 0.85rem 1.1rem;
      border-radius: 0.95rem;
      font-weight: 700;
      text-decoration: none;
      border: none;
      cursor: pointer;
    }
    .primary-btn {
      background: linear-gradient(135deg, #10b981 0%, #059669 100%);
      color: white;
      box-shadow: 0 10px 24px rgba(5, 150, 105, 0.28);
    }
    .secondary-btn {
      background: rgba(6, 14, 10, 0.8);
      color: #e2e8f0;
      border: 1px solid rgba(16, 185, 129, 0.24);
    }
    @media (max-width: 640px) {
      .detail-row { flex-direction: column; align-items: flex-start; }
      .detail-value { text-align: left; }
      .actions { flex-direction: column; }
      .primary-btn, .secondary-btn { width: 100%; }
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="status-pill">${escapeHtml(statusLabel)}</div>
    ${successVariant ? `<div class="success-hero"><div class="icon">✓</div><div><h1>${escapeHtml(heading)}</h1><p>${escapeHtml(message)}</p></div></div>` : `<h1>${escapeHtml(heading)}</h1><p>${escapeHtml(message)}</p>`}
    ${highlightMarkup}
    <div class="detail-list">${detailsHtml}</div>
    ${formMarkup}
  </div>
</body>
</html>`;
};

export const createAttendanceSession = async (req, res) => {
  try {
    const {
      scheduleId,
      sessionId,
      laboratoryScheduleId,
      schedule_id,
      title,
      day,
      time,
      room,
      status = "Confirmed",
      expirationMinutes,
      expiresInMinutes = 15
    } = req.body;

    const resolvedScheduleId = scheduleId ?? sessionId ?? laboratoryScheduleId ?? schedule_id;
    const normalizedExpirationMinutes = Number(expirationMinutes ?? expiresInMinutes ?? 15);
    const now = new Date();

    let resolvedTitle = title;
    let resolvedDay = day;
    let resolvedTime = time;
    let resolvedRoom = room;
    let resolvedStatus = status;
    let linkedSchedule = null;

    if (resolvedScheduleId) {
      linkedSchedule = await LaboratorySchedule.findByPk(resolvedScheduleId);
      if (!linkedSchedule) {
        return res.status(404).json({ error: `Selected schedule ${resolvedScheduleId} was not found.` });
      }

      // Campus-based authorization check
      const userCampus = await getUserCampusFromSession(req);
      if (!userCampus) {
        return res.status(403).json({ error: "Unauthorized: User campus not found." });
      }
      if (!canManageRecord(userCampus, linkedSchedule.campus)) {
        return res.status(403).json({ error: "You do not have permission to create attendance sessions for another campus." });
      }

      if (getClassScheduleStatus(linkedSchedule, now) === "Ended") {
        return res.status(409).json({
          error: "This class has ended. Attendance QR generation is no longer available.",
          classStatus: "Ended"
        });
      }

      resolvedTitle = linkedSchedule.subject || resolvedTitle;
      resolvedDay = linkedSchedule.dayOfWeek || resolvedDay;
      resolvedTime = [linkedSchedule.startTime, linkedSchedule.endTime].filter(Boolean).join(" - ") || resolvedTime;
      resolvedRoom = linkedSchedule.laboratoryRoom || resolvedRoom;
      resolvedStatus = linkedSchedule.status || resolvedStatus;
    }

    if (!resolvedTitle || !resolvedTime || !resolvedRoom) {
      return res.status(400).json({ error: "Title, time, and room are required to create a session." });
    }

    const token = `att-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    let expiresAt = new Date(now.getTime() + normalizedExpirationMinutes * 60000);
    if (linkedSchedule && getClassScheduleStatus(linkedSchedule, now) === "In Progress") {
      const classEnd = getManilaScheduleEndDate(linkedSchedule, now);
      if (classEnd && classEnd > now && classEnd < expiresAt) expiresAt = classEnd;
    }

    const session = await AttendanceSession.create({
      token,
      title: resolvedTitle,
      day: resolvedDay,
      time: resolvedTime,
      room: resolvedRoom,
      status: resolvedStatus,
      courseSection: req.body.courseSection || getScheduleCourseSection(linkedSchedule) || null,
      laboratoryScheduleId: resolvedScheduleId || null,
      expiresAt
    });

    if (resolvedScheduleId) {
      const classListEntries = await ClassListEntry.findAll({
        where: { laboratoryScheduleId: resolvedScheduleId }
      });

      if (classListEntries.length) {
        const today = new Date().toISOString().slice(0, 10);
        const placeholders = classListEntries.filter((entry) => entry.matchStatus === "matched" && entry.studentId).map((entry) => ({
          studentId: entry.studentId,
          fullName: entry.fullName,
          courseSection: entry.courseSection || getScheduleCourseSection(linkedSchedule) || "",
          subject: session.title,
          lab: session.room,
          instructor: resolvedStatus === "Confirmed" ? "Instructor" : "Instructor",
          date: today,
          timeIn: "Not recorded",
          status: "Absent",
          sessionToken: session.token,
          laboratoryScheduleId: resolvedScheduleId
        }));

        await Attendance.bulkCreate(placeholders, { ignoreDuplicates: true });
      }
    }

    await finalizeAttendanceForSchedule(session, now);

    await logAuditEntry(req, {
      action: "Attendance Session Created",
      module: "Attendance Monitoring",
      resourceId: session.id,
      description: `Created attendance session ${session.token} for schedule ${resolvedScheduleId || 'manual'}`,
      details: {
        token: session.token,
        scheduleId: resolvedScheduleId,
        expiresAt: session.expiresAt,
        status: session.status
      }
    });

    const attendanceUrl = buildScanUrl(session.token, req);
    console.log("Attendance URL:", attendanceUrl);
    const qrImage = attendanceUrl
      ? await QRCode.toDataURL(attendanceUrl, {
          width: 320,
          margin: 2,
          errorCorrectionLevel: "H"
        })
      : "";
    console.log(qrImage);

    return res.json({
      success: true,
      session: {
        token: session.token,
        title: session.title,
        day: session.day,
        time: session.time,
        room: session.room,
        status: session.status,
        expiresAt: session.expiresAt,
        scanUrl: attendanceUrl,
        qrCode: qrImage,
        qrImage
      }
    });
  } catch (error) {
    console.error("Attendance session creation failed.");
    console.error(error?.stack || error);
    return sendJsonError(res, 500, error?.message || "Unable to create attendance session.", error);
  }
};

export const getStudentAttendanceQrRoster = async (req, res) => {
  try {
    if (!req.session?.userId) return res.status(401).json({ success: false, error: "Authentication required." });
    const instructor = await User.findByPk(req.session.userId);
    if (!instructor || !["faculty", "instructor"].includes(String(instructor.role || "").trim().toLowerCase())) {
      return res.status(403).json({ success: false, error: "Only faculty instructors can manage student attendance QR codes." });
    }

    const scheduleId = Number(req.params.scheduleId);
    if (!Number.isInteger(scheduleId) || scheduleId <= 0) {
      return res.status(400).json({ success: false, error: "A valid laboratory schedule is required." });
    }
    const schedule = await LaboratorySchedule.findByPk(scheduleId);
    if (!schedule) return res.status(404).json({ success: false, error: "Laboratory schedule not found." });
    if (Number(schedule.instructorUserId) !== Number(instructor.id)) {
      return res.status(403).json({ success: false, error: "You can only manage attendance QR codes for your own schedules." });
    }
    const instructorCampus = await getUserCampusFromSession(req);
    if (!instructorCampus || !schedule.campus || !canManageRecord(instructorCampus, schedule.campus)) {
      return res.status(403).json({ success: false, error: "You do not have permission to manage this schedule." });
    }

    const roster = await ClassListEntry.findAll({
      where: { laboratoryScheduleId: schedule.id },
      order: [["fullName", "ASC"]]
    });
    const matchedIds = [...new Set(roster
      .filter((entry) => String(entry.matchStatus || "").toLowerCase() === "matched" && entry.matchedUserId)
      .map((entry) => Number(entry.matchedUserId))
      .filter((id) => Number.isInteger(id) && id > 0))];
    const students = matchedIds.length
      ? await User.findAll({ where: { id: { [Op.in]: matchedIds } } })
      : [];
    const studentsById = new Map(students
      .filter((student) =>
        String(student.role || "").trim().toLowerCase() === "student" &&
        String(student.student_number || "").trim() &&
        canManageRecord(student.campus, schedule.campus))
      .map((student) => [Number(student.id), student]));
    const eligibleById = new Map();
    roster.forEach((entry) => {
      if (String(entry.matchStatus || "").toLowerCase() !== "matched") return;
      const student = studentsById.get(Number(entry.matchedUserId));
      if (student && !eligibleById.has(Number(student.id))) {
        eligibleById.set(Number(student.id), {
          userId: student.id,
          studentId: student.student_number,
          studentName: entry.fullName || student.name
        });
      }
    });

    const eligible = [...eligibleById.values()];
    if (!eligible.length) {
      return res.status(409).json({
        success: false,
        error: roster.length
          ? "No class-list students are linked to registered student accounts with Student IDs."
          : "This schedule has no class list. Add its students to the roster before generating BYOD attendance QR codes."
      });
    }

    return res.json({
      success: true,
      students: eligible,
      unmatchedStudentCount: Math.max(0, roster.length - eligible.length)
    });
  } catch (error) {
    return sendJsonError(res, 500, "Unable to load BYOD students for attendance QR codes.", error);
  }
};

export const createStudentAttendanceQrs = async (req, res) => {
  let transaction;
  try {
    if (!req.session?.userId) {
      return res.status(401).json({ success: false, error: "Authentication required." });
    }

    const instructor = await User.findByPk(req.session.userId);
    const role = String(instructor?.role || "").trim().toLowerCase();
    if (!instructor || !["faculty", "instructor"].includes(role)) {
      return res.status(403).json({ success: false, error: "Only the assigned faculty instructor can generate student attendance QR codes." });
    }

    const scheduleId = Number(req.params.scheduleId);
    if (!Number.isInteger(scheduleId) || scheduleId <= 0) {
      return res.status(400).json({ success: false, error: "A valid laboratory schedule is required." });
    }

    transaction = await sequelize.transaction();
    const schedule = await LaboratorySchedule.findByPk(scheduleId, {
      transaction,
      lock: transaction.LOCK.UPDATE
    });
    if (!schedule) {
      await transaction.rollback();
      return res.status(404).json({ success: false, error: "Laboratory schedule not found." });
    }
    if (Number(schedule.instructorUserId) !== Number(instructor.id)) {
      await transaction.rollback();
      return res.status(403).json({ success: false, error: "You can only generate attendance QR codes for your own schedules." });
    }

    const instructorCampus = await getUserCampusFromSession(req);
    if (!instructorCampus || !schedule.campus || !canManageRecord(instructorCampus, schedule.campus)) {
      await transaction.rollback();
      return res.status(403).json({ success: false, error: "You do not have permission to manage this schedule." });
    }

    const now = new Date();
    if (getClassScheduleStatus(schedule, now) === "Ended") {
      await transaction.rollback();
      return res.status(409).json({ success: false, error: "This class has ended. Attendance QR codes can no longer be generated." });
    }

    const expiresAt = getNextScheduleEndDate(schedule, now);
    if (!expiresAt || expiresAt <= now) {
      await transaction.rollback();
      return res.status(409).json({ success: false, error: "The schedule day or end time is invalid. Ask an administrator to update the schedule." });
    }

    const roster = await ClassListEntry.findAll({
      where: { laboratoryScheduleId: schedule.id },
      order: [["fullName", "ASC"]],
      transaction
    });
    if (!roster.length) {
      await transaction.rollback();
      return res.status(409).json({
        success: false,
        error: "This schedule has no class list. Add the students to its roster before generating individual attendance QR codes."
      });
    }

    const studentUserIds = [...new Set(roster
      .filter((entry) => String(entry.matchStatus || "").toLowerCase() === "matched" && entry.matchedUserId)
      .map((entry) => Number(entry.matchedUserId))
      .filter((id) => Number.isInteger(id) && id > 0))];
    const registeredStudents = studentUserIds.length
      ? await User.findAll({ where: { id: { [Op.in]: studentUserIds } }, transaction })
      : [];
    const studentsById = new Map(registeredStudents
      .filter((student) =>
        String(student.role || "").trim().toLowerCase() === "student" &&
        String(student.student_number || "").trim() &&
        canManageRecord(student.campus, schedule.campus))
      .map((student) => [Number(student.id), student]));

    const eligibleStudents = [...new Map(roster
      .map((entry) => {
        if (String(entry.matchStatus || "").toLowerCase() !== "matched") return null;
        const student = studentsById.get(Number(entry.matchedUserId));
        return student ? [Number(student.id), { entry, student }] : null;
      })
      .filter(Boolean)).values()];
    if (!eligibleStudents.length) {
      await transaction.rollback();
      return res.status(409).json({
        success: false,
        error: "No roster students are linked to registered student accounts with Student IDs. Match the class list to student accounts first."
      });
    }

    const requestedIds = req.body?.studentUserIds;
    if (!Array.isArray(requestedIds) || !requestedIds.length) {
      await transaction.rollback();
      transaction = null;
      return res.status(400).json({ success: false, error: "Select at least one BYOD student before generating QR codes." });
    }
    const selectedIds = [...new Set(requestedIds.map(Number))];
    if (selectedIds.some((id) => !Number.isInteger(id) || id <= 0)) {
      await transaction.rollback();
      transaction = null;
      return res.status(400).json({ success: false, error: "The selected student list is invalid." });
    }
    const eligibleById = new Map(eligibleStudents.map((item) => [Number(item.student.id), item]));
    if (selectedIds.some((id) => !eligibleById.has(id))) {
      await transaction.rollback();
      transaction = null;
      return res.status(400).json({ success: false, error: "The selection contains a student who is not on this class roster." });
    }
    const selectedStudents = selectedIds.map((id) => eligibleById.get(id));

    const activeSessions = await AttendanceSession.findAll({
      where: {
        laboratoryScheduleId: schedule.id,
        intendedStudentUserId: { [Op.in]: selectedIds },
        expiresAt: { [Op.gt]: now }
      },
      transaction,
      lock: transaction.LOCK.UPDATE
    });
    const activeByStudent = new Map(activeSessions.map((session) => [Number(session.intendedStudentUserId), session]));
    const codes = [];
    const eligibleStudentIds = new Set(eligibleStudents.map(({ student }) => Number(student.id)));
    const unmatchedStudentCount = roster.filter((entry) =>
      String(entry.matchStatus || "").toLowerCase() !== "matched" ||
      !eligibleStudentIds.has(Number(entry.matchedUserId))
    ).length;

    for (const { entry, student } of selectedStudents) {
      let session = activeByStudent.get(Number(student.id));
      if (!session) {
        session = await AttendanceSession.create({
          token: `att-${randomBytes(24).toString("hex")}`,
          title: schedule.subject,
          day: schedule.dayOfWeek,
          time: [schedule.startTime, schedule.endTime].filter(Boolean).join(" - "),
          room: schedule.laboratoryRoom,
          courseSection: entry.courseSection || getScheduleCourseSection(schedule),
          status: schedule.status || "Confirmed",
          laboratoryScheduleId: schedule.id,
          intendedStudentUserId: student.id,
          expiresAt
        }, { transaction });
      }

      const scanUrl = buildScanUrl(session.token, req);
      if (!scanUrl) throw new Error("Unable to construct attendance QR URLs.");
      const qrCode = await QRCode.toDataURL(scanUrl, {
        width: 320,
        margin: 2,
        errorCorrectionLevel: "H"
      });
      codes.push({
        studentId: student.student_number,
        studentName: entry.fullName || student.name,
        qrCode,
        scanUrl,
        expiresAt: session.expiresAt
      });
    }

    await transaction.commit();
    transaction = null;

    await logAuditEntry(req, {
      action: "Student Attendance QR Codes Generated",
      module: "Attendance Monitoring",
      resourceId: schedule.id,
      description: `Generated or reused individual attendance QR codes for ${codes.length} students in schedule ${schedule.id}.`,
      details: {
        scheduleId: schedule.id,
        studentCount: codes.length,
        unmatchedStudentCount,
        expiresAt
      }
    });

    return res.json({
      success: true,
      scheduleId: schedule.id,
      total: codes.length,
      unmatchedStudentCount,
      expiresAt,
      codes
    });
  } catch (error) {
    if (transaction) await transaction.rollback();
    return sendJsonError(res, 500, "Unable to generate individual attendance QR codes.", error);
  }
};

const isInstructorRole = (role) => {
  const normalizedRole = String(role || "").trim().toLowerCase();
  return ["admin", "technician", "faculty", "instructor"].includes(normalizedRole);
};

const isAdminRole = (role) => {
  return String(role || "").toLowerCase() === "admin";
};

const buildAttendanceCampusWhere = (campus) => {
  const canonicalCampus = String(campus || "").trim().replace(/\s*Campus\s*$/i, "").trim();
  return {
    [Op.or]: [
      { campus: canonicalCampus },
      { campus: `${canonicalCampus} Campus` }
    ]
  };
};

const getInstructorScheduleScope = async (req) => {
  if (!req.session?.userId) return null;

  const user = await User.findByPk(req.session.userId);
  if (!user) return null;

  if (user.role === "student") {
    const studentIds = [...new Set(
      [user.student_number, user.id]
        .map((value) => String(value || "").trim())
        .filter(Boolean)
    )];
    return {
      kind: "student",
      userId: user.id,
      studentIds
    };
  }

  if (isAdminRole(user.role)) {
    if (!user.campus || !String(user.campus).trim()) {
      return { kind: "instructor", user, schedules: [], scheduleIds: [], sessionTokens: [] };
    }
    // Admins can view attendance sessions for their campus, regardless of who created each schedule.
    const campusFilter = buildAttendanceCampusWhere(user.campus);
    const archivedScheduleIds = await getArchivedEntityIds("laboratory-schedule");
    
    const campusSchedules = await LaboratorySchedule.findAll({
      where: { ...campusFilter, id: { [Op.notIn]: archivedScheduleIds } },
      attributes: ["id", "subject", "dayOfWeek", "startTime", "endTime", "laboratoryRoom", "campus", "yearLevel", "section"]
    });

    const campusScheduleIds = campusSchedules.map((schedule) => schedule.id);
    const campusSessions = await AttendanceSession.findAll({
      where: {
        laboratoryScheduleId: { [Op.in]: campusScheduleIds }
      },
      attributes: ["token"]
    });

    const campusSessionTokens = campusSessions.map((session) => session.token).filter(Boolean);

    return {
      kind: "instructor",
      user,
      schedules: campusSchedules,
      scheduleIds: campusScheduleIds,
      sessionTokens: campusSessionTokens
    };
  }

  if (!isInstructorRole(user.role)) {
    return { kind: "other" };
  }

  const isFaculty = ["faculty", "instructor"].includes(String(user.role || "").trim().toLowerCase());
  if (!user.campus || !String(user.campus).trim()) {
    return { kind: "instructor", user, schedules: [], scheduleIds: [], sessionTokens: [] };
  }
  const campusFilter = buildAttendanceCampusWhere(user.campus);
  const archivedScheduleIds = await getArchivedEntityIds("laboratory-schedule");

  const schedules = await LaboratorySchedule.findAll({
    where: {
      ...(isFaculty ? campusFilter : { createdBy: user.id, ...campusFilter }),
      id: { [Op.notIn]: archivedScheduleIds }
    },
    attributes: ["id", "subject", "dayOfWeek", "startTime", "endTime", "laboratoryRoom", "campus", "instructor", "instructorUserId", "yearLevel", "section"]
  });
  const instructorName = String(user.name || "").trim().toLowerCase();
  const scopedSchedules = isFaculty
    ? schedules.filter((schedule) =>
        String(schedule.instructorUserId || "") === String(user.id) ||
        (!schedule.instructorUserId && instructorName && String(schedule.instructor || "").trim().toLowerCase() === instructorName)
      )
    : schedules;

  const scheduleIds = scopedSchedules.map((schedule) => schedule.id);
  return {
    kind: "instructor",
    user,
    schedules: scopedSchedules,
    scheduleIds,
    sessionTokens: []
  };
};

const getStudentAttendanceIdentityFilter = async (scope) => {
  const identityConditions = [];
  if (scope.studentIds?.length) {
    identityConditions.push({ studentId: { [Op.in]: scope.studentIds } });
  }

  const linkedAttendance = await sequelize.query(
    `SELECT DISTINCT attendanceId
     FROM equipment_usage_logs
     WHERE userId = :userId
       AND attendanceId IS NOT NULL`,
    {
      replacements: { userId: scope.userId },
      type: QueryTypes.SELECT
    }
  );
  const linkedAttendanceIds = linkedAttendance
    .map((record) => Number(record.attendanceId))
    .filter(Number.isSafeInteger);
  if (linkedAttendanceIds.length) {
    identityConditions.push({ id: { [Op.in]: linkedAttendanceIds } });
  }

  return { [Op.or]: identityConditions };
};

const getInstructorSessionStatus = (session, records, now = new Date()) => {
  const recordCount = records.length;
  const expired = session?.expiresAt ? new Date(session.expiresAt).getTime() <= now.getTime() : false;

  if (recordCount === 0 && !expired) {
    return "Active";
  }

  if (recordCount === 0) {
    return "No Records";
  }

  return expired ? "Completed" : "Active";
};

const getInstructorCourseSection = (session, records) => {
  if (session?.courseSection) return session.courseSection;
  const firstRecord = records[0];
  return firstRecord?.courseSection || "—";
};

const getScheduleCourseSection = (schedule) => {
  if (!schedule) return "";
  return [
    schedule.yearLevel,
    schedule.section ? `Section ${schedule.section}` : ""
  ].filter(Boolean).join(" • ");
};

const splitCourseSection = (courseSection) => {
  const parts = String(courseSection || "")
    .split(/\s*•\s*|\s+\|\s+/)
    .map((part) => part.trim())
    .filter(Boolean);

  if (!parts.length) {
    return { course: "—", section: "—" };
  }

  if (parts.length === 1) {
    return { course: parts[0], section: "—" };
  }

  return {
    course: parts[0],
    section: parts.slice(1).join(" • ")
  };
};

const getInstructorDateRange = (range, sessions) => {
  const normalized = String(range || "all").toLowerCase();
  const now = new Date();
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const startOfWeek = new Date(startOfToday);
  startOfWeek.setDate(startOfToday.getDate() - ((startOfToday.getDay() + 6) % 7));
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  return sessions.filter((session) => {
    const sessionDate = new Date(session.createdAt || session.updatedAt || session.date || now);
    if (normalized === "today") return sessionDate >= startOfToday;
    if (normalized === "week") return sessionDate >= startOfWeek;
    if (normalized === "month") return sessionDate >= startOfMonth;
    return true;
  });
};

const getInstructorAttendanceContext = async (req) => {
  const scope = await getInstructorScheduleScope(req);
  if (!scope || scope.kind !== "instructor") {
    return { scope: null, sessions: [], records: [], schedules: [] };
  }

  const now = new Date();
  const scheduleIds = scope.scheduleIds || [];
  const scheduleLookup = new Map((scope.schedules || []).map((schedule) => [String(schedule.id), schedule]));
  // Ensure there is at least one AttendanceSession record per schedule.
  // Batch existing sessions lookup and create any missing sessions in bulk
  // to avoid performing a separate DB query per schedule (which is slow).
  const scheduleList = (scope.schedules || []).filter(s => s && s.id);
  if (scheduleList.length) {
    const scheduleIds = scheduleList.map(s => s.id);
    const existingSessions = await AttendanceSession.findAll({
      where: { laboratoryScheduleId: { [Op.in]: scheduleIds } },
      attributes: ['laboratoryScheduleId']
    });
    // Build set of scheduleIds that ALREADY have at least one session — do NOT create more
    const existingMap = new Set(existingSessions.map(s => String(s.laboratoryScheduleId)));
    // Only create a session for schedules that have ZERO existing sessions ever
    const toCreate = scheduleList
      .filter(s => !existingMap.has(String(s.id)))
      .map((schedule) => ({
        token: `att-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        title: schedule.subject || "Attendance Session",
        day: schedule.dayOfWeek || null,
        time: [schedule.startTime, schedule.endTime].filter(Boolean).join(" - "),
        room: schedule.laboratoryRoom || null,
        courseSection: getScheduleCourseSection(schedule) || null,
        status: schedule.status || "Confirmed",
        laboratoryScheduleId: schedule.id,
        expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000) // 1 year — sessions never auto-expire
      }));

    if (toCreate.length) {
      try {
        await AttendanceSession.bulkCreate(toCreate, { ignoreDuplicates: true });
      } catch (err) {
        for (const s of toCreate) {
          try { await AttendanceSession.create(s); } catch (e) { /* ignore */ }
        }
      }
    }
  }
  const fallbackSessionConditions = (scope.schedules || [])
    .map((schedule) => ({
      [Op.and]: [
        { title: schedule.subject },
        { day: schedule.dayOfWeek },
        { time: `${schedule.startTime} - ${schedule.endTime}` },
        { room: schedule.laboratoryRoom }
      ]
    }));

  const sessionWhere = scheduleIds.length || fallbackSessionConditions.length || (scope.sessionTokens?.length)
    ? {
        [Op.or]: [
          ...(scheduleIds.length ? [{ laboratoryScheduleId: { [Op.in]: scheduleIds } }] : []),
          ...fallbackSessionConditions,
          ...(scope.sessionTokens?.length ? [{ token: { [Op.in]: scope.sessionTokens } }] : [])
        ]
      }
    : null;

  const sessions = sessionWhere
    ? await AttendanceSession.findAll({
        where: sessionWhere,
        order: [["createdAt", "DESC"]]
      })
    : [];

  const sessionTokens = sessions.map((session) => session.token).filter(Boolean);
  const recordWhere = sessionTokens.length || scheduleIds.length
    ? {
        [Op.or]: [
          ...(scheduleIds.length ? [{ laboratoryScheduleId: { [Op.in]: scheduleIds } }] : []),
          ...(sessionTokens.length ? [{ sessionToken: { [Op.in]: sessionTokens } }] : [])
        ]
      }
    : null;

  const records = recordWhere
    ? await Attendance.findAll({
        where: recordWhere,
        order: [["createdAt", "ASC"]]
      })
    : [];

  const classListEntries = scheduleIds.length
    ? await ClassListEntry.findAll({
        where: { laboratoryScheduleId: { [Op.in]: scheduleIds } },
        order: [["fullName", "ASC"]]
      })
    : [];
  const rosterBySchedule = classListEntries.reduce((map, entry) => {
    const key = String(entry.laboratoryScheduleId || "");
    if (!key) return map;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(entry);
    return map;
  }, new Map());

  // Trigger finalization of attendance for sessions but do not await each
  // finalization operation — this prevents expensive DB writes from blocking
  // the dashboard API response and improves perceived load time.
  for (const session of sessions) {
    // fire-and-forget; log errors but don't block
    finalizeAttendanceForSchedule(session, now).catch((err) => {
      console.warn('finalizeAttendanceForSchedule failed (non-blocking):', err?.message || err);
    });
  }

  const recordsByToken = records.reduce((accumulator, record) => {
    const key = record.sessionToken || String(record.laboratoryScheduleId || "");
    if (!key) return accumulator;
    if (!accumulator.has(key)) accumulator.set(key, []);
    accumulator.get(key).push(record);
    return accumulator;
  }, new Map());

  const sessionsWithRecords = sessions.map((session) => {
    const matchedRecords = recordsByToken.get(session.token) || recordsByToken.get(String(session.laboratoryScheduleId || "")) || [];
    const schedule = session.laboratoryScheduleId ? scheduleLookup.get(String(session.laboratoryScheduleId)) : null;
    const roster = rosterBySchedule.get(String(session.laboratoryScheduleId || "")) || [];
    const courseSection = getScheduleCourseSection(schedule) ||
      getInstructorCourseSection(session, matchedRecords);
    const sectionDetails = splitCourseSection(courseSection);
    const presentCount = matchedRecords.filter((record) => deriveAttendanceStatusFromRecord(record, schedule, session, now) === "Present").length;
    const lateCount = matchedRecords.filter((record) => deriveAttendanceStatusFromRecord(record, schedule, session, now) === "Late").length;
    const attendanceStatus = getSessionCompletionStatus(session, schedule, now);
    const absentCount = attendanceStatus === "Completed"
      ? Math.max(0, roster.length - presentCount - lateCount)
      : 0;
    const subject = session.title || schedule?.subject || matchedRecords[0]?.subject || "—";
    const laboratory = session.room || schedule?.laboratoryRoom || matchedRecords[0]?.lab || "—";
    const time = session.time || [schedule?.startTime, schedule?.endTime].filter(Boolean).join(" - ") || "—";
    const sessionDate = session.createdAt || matchedRecords[0]?.date || now;
    const status = attendanceStatus;

    return {
      id: session.id,
      token: session.token,
      date: sessionDate,
      subject,
      section: sectionDetails.section,
      course: sectionDetails.course,
      laboratory,
      campus: schedule?.campus || "",
      instructor: session.instructor || schedule?.instructor || matchedRecords[0]?.instructor || "Instructor",
      startTime: schedule?.startTime || null,
      endTime: schedule?.endTime || null,
      yearLevel: schedule?.yearLevel || null,
      scheduleSection: schedule?.section || null,
      classSection: getScheduleCourseSection(schedule) || "—",
      time,
      studentsPresent: presentCount,
      studentsLate: lateCount,
      studentsAbsent: absentCount,
      attendanceStatus: status,
      createdAt: session.createdAt,
      scheduleId: session.laboratoryScheduleId || null,
      totalStudents: roster.length,
      records: matchedRecords
    };
  });

  return {
    scope,
    schedules: scope.schedules || [],
    sessions: sessionsWithRecords,
    records,
    now
  };
};

export const getInstructorAttendanceDashboard = async (req, res) => {
  try {
    const { searchSubject = "", searchSection = "", dateRange = "all", status = "all" } = req.query;
    const context = await getInstructorAttendanceContext(req);

    if (!context.scope) {
      return res.status(403).json({ error: "Instructor access required." });
    }

    const now = context.now || new Date();
    const todayLabel = now.toISOString().slice(0, 10);
    const todayRecords = context.records.filter((record) => String(record.date) === todayLabel);
    const completedSessions = (context.sessions || []).filter((session) => String(session.attendanceStatus || "").toLowerCase() === "completed");
    const summary = {
      totalSessions: completedSessions.length,
      attendanceSessionsConducted: completedSessions.length,
      studentsPresentToday: completedSessions.reduce((total, session) => total + (session.studentsPresent || 0), 0),
      lateToday: completedSessions.reduce((total, session) => total + (session.studentsLate || 0), 0),
      absentToday: completedSessions.reduce((total, session) => total + (session.studentsAbsent || 0), 0)
    };

    const filteredSessions = getInstructorDateRange(dateRange, completedSessions)
      .filter((session) => {
        const matchesSubject = !searchSubject || String(session.subject || "").toLowerCase().includes(String(searchSubject).toLowerCase());
        const matchesSection = !searchSection || String(session.section || "").toLowerCase().includes(String(searchSection).toLowerCase());
        const matchesStatus = status === "all" || !status || String(session.attendanceStatus || "").toLowerCase() === String(status).toLowerCase();
        return matchesSubject && matchesSection && matchesStatus;
      })
      .sort((a, b) => new Date(b.date || b.createdAt || 0) - new Date(a.date || a.createdAt || 0));

    const trendMap = new Map();
    const trendDates = [];
    for (let offset = 6; offset >= 0; offset -= 1) {
      const date = new Date(now);
      date.setDate(now.getDate() - offset);
      const key = date.toISOString().slice(0, 10);
      trendDates.push(key);
      trendMap.set(key, 0);
    }
    context.records.forEach((record) => {
      const key = String(record.date || "");
      if (trendMap.has(key)) {
        trendMap.set(key, trendMap.get(key) + 1);
      }
    });

    const statusDistribution = filteredSessions.reduce((accumulator, session) => {
      const key = session.attendanceStatus || "No Records";
      accumulator[key] = (accumulator[key] || 0) + 1;
      return accumulator;
    }, {});

    return res.json({
      success: true,
      summary,
      chart: {
        labels: trendDates.map((date) => new Date(date + "T00:00:00").toLocaleDateString("en-US", { weekday: "short" })),
        trend: trendDates.map((date) => trendMap.get(date) || 0),
        statusLabels: Object.keys(statusDistribution),
        statusValues: Object.values(statusDistribution)
      },
      sessions: filteredSessions
    });
  } catch (error) {
    return sendJsonError(res, 500, "Unable to load instructor attendance dashboard.", error);
  }
};

export const getInstructorAttendanceSessionDetails = async (req, res) => {
  try {
    const sessionId = req.params.sessionId;
    const context = await getInstructorAttendanceContext(req);

    if (!context.scope) {
      return res.status(403).json({ error: "Instructor access required." });
    }

    const session = context.sessions.find((item) => String(item.id) === String(sessionId) || String(item.token) === String(sessionId));
    if (!session) {
      return res.status(404).json({ error: "Attendance session not found." });
    }

    const schedule = session.scheduleId ? await LaboratorySchedule.findByPk(session.scheduleId) : null;
    const records = session.records || [];
    const now = new Date();
    return res.json({
      success: true,
      session: {
        ...session,
        startTime: session.startTime || schedule?.startTime || null,
        endTime: session.endTime || schedule?.endTime || null,
        instructor: session.instructor || schedule?.instructor || "Instructor"
      },
      records: records.map((record) => ({
        id: record.id,
        studentId: record.studentId,
        studentName: record.fullName,
        course: splitCourseSection(record.courseSection).course,
        section: splitCourseSection(record.courseSection).section,
        timeIn: record.timeIn,
        pcStationSetId: record.pcStationSetId || null,
        attendanceStatus: deriveAttendanceStatusFromRecord(record, schedule, session, now),
        courseSection: record.courseSection
      }))
    });
  } catch (error) {
    return sendJsonError(res, 500, "Unable to load attendance session details.", error);
  }
};

const getFacultyScheduleAttendanceData = async (req, requestedScheduleId = null) => {
  const scope = await getInstructorScheduleScope(req);
  if (!scope || scope.kind !== "instructor") {
    return { status: 403, error: "Faculty access required." };
  }

  const schedules = requestedScheduleId
    ? scope.schedules.filter((schedule) => String(schedule.id) === String(requestedScheduleId))
    : scope.schedules;
  if (requestedScheduleId && !schedules.length) {
    return { status: 404, error: "Assigned schedule not found." };
  }

  const scheduleIds = schedules.map((schedule) => schedule.id);
  const attendanceQuery = {
    where: { laboratoryScheduleId: { [Op.in]: scheduleIds } },
    order: [["date", "DESC"], ["createdAt", "DESC"]]
  };
  if (!requestedScheduleId) attendanceQuery.limit = 1000;
  const records = scheduleIds.length ? await Attendance.findAll(attendanceQuery) : [];
  const scheduleById = new Map(schedules.map((schedule) => [String(schedule.id), schedule]));
  const sessions = records.length
    ? await AttendanceSession.findAll({
        where: { token: { [Op.in]: [...new Set(records.map((record) => record.sessionToken).filter(Boolean))] } }
      })
    : [];
  const sessionByToken = new Map(sessions.map((session) => [String(session.token), session]));
  const attendance = records.map((record) => {
    const schedule = scheduleById.get(String(record.laboratoryScheduleId));
    return {
      id: record.id,
      scheduleId: record.laboratoryScheduleId,
      subject: record.subject || schedule?.subject || "—",
      studentId: record.studentId,
      studentName: record.fullName,
      courseSection: record.courseSection || getScheduleCourseSection(schedule) || "—",
      yearLevel: schedule?.yearLevel || null,
      section: schedule?.section || null,
      date: record.date,
      timeIn: record.timeIn,
      pcStationSetId: record.pcStationSetId || null,
      status: deriveAttendanceStatusFromRecord(record, schedule, sessionByToken.get(String(record.sessionToken || ""))),
      recordedAt: record.createdAt
    };
  });

  return { schedules, attendance };
};

export const getFacultyScheduleAttendanceHistory = async (req, res) => {
  try {
    const data = await getFacultyScheduleAttendanceData(req, req.params.scheduleId || req.query.scheduleId || null);
    if (data.error) return res.status(data.status).json({ success: false, error: data.error });

    return res.json({
      success: true,
      schedules: data.schedules.map((schedule) => ({
        id: schedule.id,
        subject: schedule.subject,
        dayOfWeek: schedule.dayOfWeek,
        startTime: schedule.startTime,
        endTime: schedule.endTime,
        laboratoryRoom: schedule.laboratoryRoom,
        campus: schedule.campus,
        yearLevel: schedule.yearLevel,
        section: schedule.section
      })),
      attendance: data.attendance
    });
  } catch (error) {
    return sendJsonError(res, 500, "Unable to load faculty attendance history.", error);
  }
};

const formatAttendanceExportDate = (value) => {
  if (!value) return "";
  if (typeof value === "string") return value.slice(0, 10);
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? String(value)
    : new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(date);
};

const countAttendanceStatuses = (attendance) => attendance.reduce((counts, record) => {
  const status = String(record.status || "").toLowerCase();
  if (status in counts) counts[status] += 1;
  return counts;
}, { present: 0, late: 0, absent: 0 });

export const exportFacultyScheduleAttendanceHistory = async (req, res) => {
  try {
    const data = await getFacultyScheduleAttendanceData(req, req.params.scheduleId);
    if (data.error) return res.status(data.status).json({ success: false, error: data.error });
    const schedule = data.schedules[0];
    const attendance = data.attendance;
    const counts = countAttendanceStatuses(attendance);
    const format = String(req.query.format || "").toLowerCase();
    const safeScheduleId = String(schedule.id).replace(/[^a-zA-Z0-9_-]/g, "");
    const subject = schedule.subject || "Laboratory attendance";
    const courseSection = [schedule.yearLevel, schedule.section ? `Section ${schedule.section}` : ""]
      .filter(Boolean)
      .join(" · ") || "Not set";

    if (format === "xlsx") {
      const rows = [
        ["Attendance Report"],
        ["Subject", subject],
        ["Instructor", schedule.instructor || ""],
        ["Campus", schedule.campus || ""],
        ["Laboratory", schedule.laboratoryRoom || ""],
        ["Day", schedule.dayOfWeek || ""],
        ["Scheduled time", [schedule.startTime, schedule.endTime].filter(Boolean).join(" – ")],
        ["Year level", schedule.yearLevel || ""],
        ["Section", schedule.section || ""],
        ["Present", counts.present],
        ["Late", counts.late],
        ["Absent", counts.absent],
        [],
        ["Attendance ID", "Schedule ID", "Subject", "Campus", "Laboratory", "Day", "Start time", "End time", "Year level", "Section", "Student ID", "Student name", "Course/section", "Class date", "Time in", "PC Set", "Status", "Recorded at"]
      ];
      attendance.forEach((record) => rows.push([
        record.id,
        record.scheduleId,
        record.subject,
        schedule.campus || "",
        schedule.laboratoryRoom || "",
        schedule.dayOfWeek || "",
        schedule.startTime || "",
        schedule.endTime || "",
        record.yearLevel || "",
        record.section || "",
        record.studentId || "",
        record.studentName || "",
        record.courseSection || "",
        formatAttendanceExportDate(record.date),
        record.timeIn || "",
        record.pcStationSetId || "",
        record.status || "",
        record.recordedAt ? new Date(record.recordedAt).toISOString() : ""
      ]));
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), "Attendance");
      const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
      res.setHeader("Content-Disposition", `attachment; filename="attendance-${safeScheduleId}.xlsx"`);
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      return res.send(buffer);
    }

    if (format === "docx") {
      const headerLabels = ["Student ID", "Student name", "Course / section", "Class date", "Status", "Time in", "PC Set", "Recorded at"];
      const docRows = [
        new TableRow({
          tableHeader: true,
          children: headerLabels.map((label) => new TableCell({
            children: [new Paragraph({ text: label, bold: true })],
            width: { size: 100 / headerLabels.length, type: WidthType.PERCENTAGE }
          }))
        }),
        ...attendance.map((record) => new TableRow({
          children: [
            record.studentId,
            record.studentName,
            record.courseSection,
            formatAttendanceExportDate(record.date),
            record.status,
            record.timeIn,
            record.pcStationSetId,
            record.recordedAt ? new Date(record.recordedAt).toLocaleString("en-PH", { timeZone: "Asia/Manila" }) : ""
          ].map((value) => new TableCell({
            children: [new Paragraph({ text: String(value || "—") })],
            width: { size: 100 / headerLabels.length, type: WidthType.PERCENTAGE }
          }))
        }))
      ];
      const document = new Document({
        sections: [{
          properties: { page: { size: { orientation: "landscape" } } },
          children: [
            new Paragraph({ text: "Student Attendance History", heading: HeadingLevel.TITLE }),
            new Paragraph({ text: [subject, courseSection].filter(Boolean).join(" · ") }),
            new Paragraph({ text: `${schedule.dayOfWeek || "Day not set"} · ${[schedule.startTime, schedule.endTime].filter(Boolean).join(" – ") || "Time not set"} · ${schedule.laboratoryRoom || "Laboratory not set"}` }),
            new Paragraph({ text: `Present: ${counts.present}    Late: ${counts.late}    Absent: ${counts.absent}` }),
            new Paragraph({ text: `Total attendance records: ${attendance.length}` }),
            new Paragraph({ text: "Attendance records", heading: HeadingLevel.HEADING_2 }),
            new Table({
              rows: docRows,
              width: { size: 100, type: WidthType.PERCENTAGE },
              columnWidths: Array(headerLabels.length).fill(Math.floor(100 / headerLabels.length))
            })
          ]
        }]
      });
      const buffer = await Packer.toBuffer(document);
      res.setHeader("Content-Disposition", `attachment; filename="attendance-${safeScheduleId}.docx"`);
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
      return res.send(buffer);
    }

    return res.status(400).json({ success: false, error: "Unsupported export format. Use xlsx or docx." });
  } catch (error) {
    return sendJsonError(res, 500, "Unable to export faculty attendance history.", error);
  }
};

export const getAttendanceRecords = async (req, res) => {
  try {
    const { search = "", status } = req.query;
    const where = {};

    if (status && status !== "All") {
      where.status = status;
    }

    if (search) {
      where[Op.or] = [
        { fullName: { [Op.like]: `%${search}%` } },
        { subject: { [Op.like]: `%${search}%` } },
        { lab: { [Op.like]: `%${search}%` } },
        { instructor: { [Op.like]: `%${search}%` } },
        { courseSection: { [Op.like]: `%${search}%` } }
      ];
    }

    const scope = await getInstructorScheduleScope(req);
    if (scope?.kind === "student") {
      const identityFilter = await getStudentAttendanceIdentityFilter(scope);
      if (!identityFilter[Op.or].length) {
        return res.status(403).json({ error: "Student ID is not configured for this account." });
      }
      where[Op.and] = [...(where[Op.and] || []), identityFilter];
    } else if (scope?.kind === "instructor") {
      const orConditions = [];
      if (scope.scheduleIds?.length) orConditions.push({ laboratoryScheduleId: { [Op.in]: scope.scheduleIds } });
      if (scope.sessionTokens?.length) orConditions.push({ sessionToken: { [Op.in]: scope.sessionTokens } });
      if (!orConditions.length) return res.json([]);
      where[Op.and] = [...(where[Op.and] || []), { [Op.or]: orConditions }];
    } else {
      return res.status(scope ? 403 : 401).json({ error: "Not authorized to view attendance records." });
    }

    const records = await Attendance.findAll({
      where,
      order: [["createdAt", "DESC"]],
      limit: 200
    });

    const recordsWithDerivedStatus = await Promise.all(records.map(async (record) => {
      const schedule = record.laboratoryScheduleId ? await LaboratorySchedule.findByPk(record.laboratoryScheduleId) : null;
      const derivedStatus = schedule ? deriveAttendanceStatusFromRecord(record, schedule, null, new Date()) : record.status;
      return { ...record.toJSON(), status: derivedStatus };
    }));

    res.json(deduplicateAttendanceRecords(recordsWithDerivedStatus));
  } catch (error) {
    return sendJsonError(res, 500, "Unable to load attendance records.", error);
  }
};

export const getAttendanceStats = async (req, res) => {
  try {
    const scope = await getInstructorScheduleScope(req);
    
    // Get TODAY's date range (start and end of day in Manila timezone)
    const now = new Date();
    const today = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Manila' }));
    const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 0, 0, 0);
    const todayEnd = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59);

    if (scope?.kind === "student") {
      const period = ["thisWeek", "lastWeek", "thisMonth", "lastMonth"].includes(req.query.period)
        ? req.query.period
        : "all";
      const manilaToday = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()));
      const tomorrow = new Date(manilaToday);
      tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
      const weekStart = new Date(manilaToday);
      weekStart.setUTCDate(weekStart.getUTCDate() - ((weekStart.getUTCDay() + 6) % 7));
      const monthStart = new Date(Date.UTC(manilaToday.getUTCFullYear(), manilaToday.getUTCMonth(), 1));
      const dateKey = (date) => date.toISOString().slice(0, 10);
      let startDate = null;
      let endDate = null;

      if (period === "thisWeek") {
        startDate = dateKey(weekStart);
        endDate = dateKey(tomorrow);
      } else if (period === "lastWeek") {
        const lastWeekStart = new Date(weekStart);
        lastWeekStart.setUTCDate(lastWeekStart.getUTCDate() - 7);
        startDate = dateKey(lastWeekStart);
        endDate = dateKey(weekStart);
      } else if (period === "thisMonth") {
        startDate = dateKey(monthStart);
        endDate = dateKey(tomorrow);
      } else if (period === "lastMonth") {
        const lastMonthStart = new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() - 1, 1));
        startDate = dateKey(lastMonthStart);
        endDate = dateKey(monthStart);
      }

      // Include the account ID for older records created before attendance
      // capture consistently used the student's official student number.
      const identityFilter = await getStudentAttendanceIdentityFilter(scope);
      if (!identityFilter[Op.or].length) {
        return res.status(403).json({ error: "Student ID is not configured for this account." });
      }
      const attendanceWhere = identityFilter;
      if (startDate && endDate) {
        attendanceWhere.date = { [Op.gte]: startDate, [Op.lt]: endDate };
      }
      const records = await Attendance.findAll({
        where: attendanceWhere,
        order: [["createdAt", "DESC"]]
      });

      const recordsWithDerivedStatus = await Promise.all(records.map(async (record) => {
        const schedule = record.laboratoryScheduleId ? await LaboratorySchedule.findByPk(record.laboratoryScheduleId) : null;
        const derivedStatus = schedule ? deriveAttendanceStatusFromRecord(record, schedule, null, new Date()) : record.status;
        return { ...record.toJSON(), status: derivedStatus };
      }));

      const studentRecords = deduplicateAttendanceRecords(recordsWithDerivedStatus);
      const total = studentRecords.length;
      const present = studentRecords.filter((record) => String(record.status || "").toLowerCase() === "present").length;
      const late = studentRecords.filter((record) => String(record.status || "").toLowerCase() === "late").length;
      const absent = studentRecords.filter((record) => String(record.status || "").toLowerCase() === "absent").length;

      return res.json({ total, present, late, absent });
    }

    if (scope?.kind !== "instructor") {
      return res.status(scope ? 403 : 401).json({ error: "Not authorized to view attendance statistics." });
    }

    // Count TODAY's attendance records by status
    const todayAttendance = await Attendance.findAll({
      where: {
        laboratoryScheduleId: { [Op.in]: scope.scheduleIds || [] },
        createdAt: {
          [Op.gte]: todayStart,
          [Op.lte]: todayEnd
        }
      },
      attributes: ['status', [sequelize.fn('COUNT', sequelize.col('id')), 'count']],
      group: ['status'],
      raw: true
    });

    // Count completed sessions today
    const context = await getInstructorAttendanceContext(req);
    const todayCompletedSessions = (context.sessions || []).filter(session => {
      const sessionDate = new Date(session.createdAt || session.date);
      return sessionDate >= todayStart && 
             sessionDate <= todayEnd && 
             String(session.attendanceStatus || "").toLowerCase() === "completed";
    });

    const statusMap = {};
    todayAttendance.forEach(row => {
      const status = String(row.status || '').toLowerCase();
      statusMap[status] = Number(row.count || 0);
    });

    return res.json({ 
      total: todayCompletedSessions.length,
      present: statusMap['present'] || 0,
      late: statusMap['late'] || 0,
      absent: statusMap['absent'] || 0
    });
  } catch (error) {
    console.error("[getAttendanceStats] Error:", error);
    return sendJsonError(res, 500, "Unable to load attendance stats.", error);
  }
};

const buildAttendanceRecordPayload = async (req, session, token) => {
  const student = req.session?.userId ? await User.findByPk(req.session.userId) : null;
  const studentId = student?.student_number || "";
  const fullName = student?.name || req.query.fullName || req.body.fullName || "Student";
  const program = student?.program || student?.course || student?.programName || student?.department || "—";
  const yearLevel = student?.year || student?.yearLevel || student?.yearLevelName || "—";
  const section = student?.section || student?.sectionName || "—";
  const courseSection = req.query.courseSection || req.body.courseSection || [program, yearLevel, section].filter(Boolean).join(" • ") || "Student";
  const status = (req.query.status || req.body.status || "Present").trim();
  const dateString = new Date().toISOString().slice(0, 10);
  const timeString = new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });

  return {
    token,
    session,
    student,
    studentId,
    fullName,
    program,
    yearLevel,
    section,
    courseSection,
    status,
    dateString,
    timeString,
    subject: session?.title || req.query.subject || req.body.subject || "Attendance Session",
    lab: session?.room || req.query.lab || req.body.lab || "Laboratory",
    instructor: session?.status === "Confirmed" ? "Instructor" : "Instructor"
  };
};

const recordAttendance = async (req, res, token, session) => {
  const payload = await buildAttendanceRecordPayload(req, session, token);
  if (!payload.student || String(payload.student.role || "").trim().toLocaleLowerCase() !== "student" || !payload.studentId) {
    return res.status(403).json({ success: false, error: "Attendance requires a registered student account with an official Student ID." });
  }
  if (session?.intendedStudentUserId && Number(session.intendedStudentUserId) !== Number(payload.student.id)) {
    const message = "This attendance QR code was issued to another student. Please scan the QR code assigned to your name.";
    if (req.accepts("html")) return res.status(403).send(renderAttendancePageHtml({
      title: "Student QR Mismatch",
      heading: "This QR Code Is Not Yours",
      message,
      detailRows: [["Status", "Attendance check-in blocked"]],
      statusLabel: "Wrong student QR",
      primaryLabel: "Return to Student Dashboard",
      primaryHref: "/student/dashboard",
      secondaryLabel: "Close",
      secondaryHref: "#",
      success: false
    }));
    return res.status(403).json({ success: false, error: message });
  }
  if (session?.intendedStudentUserId) {
    const rosterEntry = await ClassListEntry.findOne({
      where: {
        laboratoryScheduleId: session.laboratoryScheduleId,
        matchedUserId: payload.student.id,
        matchStatus: "matched"
      }
    });
    if (!rosterEntry) {
      const message = "You are no longer on this class roster. Contact the instructor if this is a mistake.";
      if (req.accepts("html")) return res.status(403).send(renderAttendancePageHtml({
        title: "Not on Class Roster",
        heading: "Attendance Check-in Blocked",
        message,
        detailRows: [["Status", "Student is not on the schedule roster"]],
        statusLabel: "Roster verification failed",
        primaryLabel: "Return to Student Dashboard",
        primaryHref: "/student/dashboard",
        secondaryLabel: "Close",
        secondaryHref: "#",
        success: false
      }));
      return res.status(403).json({ success: false, error: message });
    }
  }
  const now = new Date();
  let schedule = null;

  if (session?.laboratoryScheduleId) schedule = await LaboratorySchedule.findByPk(session.laboratoryScheduleId);

  if (!schedule) {
    return sendAttendanceCohortError(req, res, "This attendance session is not linked to a class schedule, so your class section cannot be verified.", 409);
  }

  const userCampus = await getUserCampusFromSession(req);
  if (!userCampus || !schedule.campus || !canManageRecord(userCampus, schedule.campus)) {
    return res.status(403).json({ success: false, error: "You do not have permission to record attendance for another campus." });
  }
  const cohortError = getAttendanceCohortError(payload.student, schedule);
  if (cohortError) {
    const hasValidScheduleCohort = normalizeAttendanceYear(schedule.yearLevel) && normalizeAttendanceSection(schedule.section);
    return sendAttendanceCohortError(req, res, cohortError, hasValidScheduleCohort ? 403 : 409);
  }

  const attendanceStatus = schedule ? await getAttendanceStatusForSession(session, now) : (payload.status === "Late" ? "Late" : payload.status === "Absent" ? "Absent" : "Present");

  if (attendanceStatus === "Not Yet Open") {
    const referenceDate = session?.createdAt ? new Date(session.createdAt) : now;
    const startTime = schedule ? parseScheduleClockTime(schedule.startTime, referenceDate) : null;
    const formattedStartTime = startTime ? startTime.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true }) : schedule?.startTime || "the scheduled start time";
    const notOpenMessage = `Attendance for this session will open at ${formattedStartTime}.`;
    const html = renderAttendancePageHtml({
      title: "Attendance Not Yet Open",
      heading: "Attendance Not Yet Open",
      message: notOpenMessage,
      detailRows: [["Status", "Attendance has not yet opened"]],
      statusLabel: "Not Yet Open",
      primaryLabel: "Back to Dashboard",
      primaryHref: "/student/dashboard",
      secondaryLabel: "Close",
      secondaryHref: "#",
      success: false
    });

    if (req.accepts("html")) return res.status(409).send(html);
    return res.status(409).json({ success: false, error: notOpenMessage });
  }

  if (attendanceStatus === "Closed") {
    const closedMessage = "Attendance for this schedule has already closed. No further scans are accepted.";
    const html = renderAttendancePageHtml({
      title: "Attendance Closed",
      heading: "Attendance Closed",
      message: closedMessage,
      detailRows: [["Status", "The attendance window has ended"]],
      statusLabel: "Closed",
      primaryLabel: "Back to Dashboard",
      primaryHref: "/student/dashboard",
      secondaryLabel: "Close",
      secondaryHref: "#",
      success: false
    });

    if (req.accepts("html")) return res.status(410).send(html);
    return res.status(410).json({ success: false, error: closedMessage });
  }

  if (attendanceStatus === "Absent") {
    const absentMessage = "The Present and Late attendance windows have ended. No check-in is recorded.";
    const html = renderAttendancePageHtml({
      title: "Attendance Window Closed",
      heading: "Attendance Window Closed",
      message: absentMessage,
      detailRows: [["Status", "Absent"]],
      statusLabel: "Absent",
      primaryLabel: "Back to Dashboard",
      primaryHref: "/student/dashboard",
      secondaryLabel: "Close",
      secondaryHref: "#",
      success: false
    });

    if (req.accepts("html")) return res.status(410).send(html);
    return res.status(410).json({ success: false, error: absentMessage, status: "Absent" });
  }

  let existing;
  if (session?.intendedStudentUserId) {
    const recordedAttendance = await Attendance.findOne({
      where: {
        studentId: payload.studentId,
        laboratoryScheduleId: session.laboratoryScheduleId,
        date: payload.dateString,
        status: { [Op.in]: ["Present", "Late"] }
      }
    });
    existing = recordedAttendance || await Attendance.findOne({
      where: {
        studentId: payload.studentId,
        laboratoryScheduleId: session.laboratoryScheduleId,
        date: payload.dateString
      }
    });
  } else {
    existing = await Attendance.findOne({
      where: {
        studentId: payload.studentId,
        sessionToken: token,
        date: payload.dateString
      }
    });
  }

  if (existing) {
    if (existing.status === "Absent") {
      existing.status = attendanceStatus === "Late" ? "Late" : attendanceStatus === "Absent" ? "Absent" : "Present";
      existing.timeIn = payload.timeString;
      existing.courseSection = payload.courseSection;
      existing.fullName = payload.fullName;
      existing.lab = payload.lab;
      existing.instructor = payload.instructor;
      if (session?.intendedStudentUserId) existing.sessionToken = token;
      await existing.save();

        await logAuditEntry(req, {
          action: "Attendance Updated",
          module: "Attendance Monitoring",
          resourceId: existing.id,
          description: `Updated attendance for ${existing.fullName} (${existing.studentId}) in session ${token}.`,
          details: {
            studentId: existing.studentId,
            studentName: existing.fullName,
            sessionToken: token,
            status: existing.status,
            timeIn: existing.timeIn
          }
        });

      const html = renderAttendancePageHtml({
        title: "Attendance Updated",
        heading: "Attendance Updated Successfully",
        message: "Your attendance status has been updated for this session.",
        detailRows: details,
        statusLabel: "✓ Attendance Updated",
        primaryLabel: "View My Attendance History",
        primaryHref: "/student/dashboard#attendance",
        secondaryLabel: "Return to Student Dashboard",
        secondaryHref: "/student/dashboard",
        successVariant: true,
        highlightMessage: "Your attendance has been updated successfully."
      });

      if (req.accepts("html")) return res.send(html);
      return res.json({ success: true, message: "Attendance updated successfully.", attendance: existing });
    }

    const details = [
      ["Student Name", existing.fullName],
      ["Student Number", existing.studentId],
      ["Program", payload.program || "—"],
      ["Year & Section", [payload.yearLevel, payload.section].filter(Boolean).join(" • ") || "—"],
      ["Subject", existing.subject],
      ["Laboratory Room", existing.lab],
      ["Date", formatDateLabel(existing.date)],
      ["Time Recorded", formatTimeLabel(existing.timeIn)],
      ["Attendance Status", existing.status]
    ];

    const html = renderAttendancePageHtml({
      title: "Attendance Recorded",
      heading: "Attendance Recorded Successfully",
      message: "Your attendance has already been recorded for this session.",
      detailRows: details,
      statusLabel: "✓ Attendance Recorded",
      primaryLabel: "View My Attendance History",
      primaryHref: "/student/dashboard#attendance",
      secondaryLabel: "Return to Student Dashboard",
      secondaryHref: "/student/dashboard",
      successVariant: true,
      highlightMessage: "Your attendance has already been recorded for this session."
    });

    if (req.accepts("html")) return res.send(html);
    return res.json({ success: true, message: "Attendance was already recorded for this session.", attendance: existing });
  }

  const attendance = await Attendance.create({
    studentId: payload.studentId,
    fullName: payload.fullName,
    courseSection: payload.courseSection,
    subject: payload.subject,
    lab: payload.lab,
    instructor: payload.instructor,
    date: payload.dateString,
    timeIn: payload.timeString,
    status: attendanceStatus === "Late" ? "Late" : attendanceStatus === "Absent" ? "Absent" : "Present",
    sessionToken: token,
    laboratoryScheduleId: session?.laboratoryScheduleId || null
  });

  await logAuditEntry(req, {
    action: "Attendance Recorded",
    module: "Attendance Monitoring",
    resourceId: attendance.id,
    description: `Recorded attendance for ${attendance.fullName} (${attendance.studentId}) in session ${token}.`,
    details: {
      studentId: attendance.studentId,
      studentName: attendance.fullName,
      sessionToken: token,
      status: attendance.status,
      timeIn: attendance.timeIn
    }
  });

  if (session?.token && !session.courseSection && payload.courseSection) {
    await AttendanceSession.update({ courseSection: payload.courseSection }, { where: { token: session.token } });
  }

  const details = [
    ["Student Name", attendance.fullName],
    ["Student Number", attendance.studentId],
    ["Program", payload.program || "—"],
    ["Year & Section", [payload.yearLevel, payload.section].filter(Boolean).join(" • ") || "—"],
    ["Subject", attendance.subject],
    ["Laboratory Room", attendance.lab],
    ["Date", formatDateLabel(attendance.date)],
    ["Time Recorded", formatTimeLabel(attendance.timeIn)],
    ["Attendance Status", attendance.status]
  ];

  const html = renderAttendancePageHtml({
    title: "Attendance Recorded",
    heading: "Attendance Recorded Successfully",
    message: `Thank you, ${attendance.fullName}! Your attendance has been successfully recorded.`,
    detailRows: details,
    statusLabel: "✓ Attendance Recorded",
    primaryLabel: session?.intendedStudentUserId ? "Return to Student Dashboard" : "Select Your PC Station",
    primaryHref: session?.intendedStudentUserId
      ? "/student/dashboard#attendance"
      : `/attendance/select-pc?attendanceId=${attendance.id}&scheduleId=${session?.laboratoryScheduleId || ''}`,
    secondaryLabel: session?.intendedStudentUserId ? "Close" : "Skip for Now",
    secondaryHref: session?.intendedStudentUserId ? "#" : "/student/dashboard",
    successVariant: true,
    highlightMessage: session?.intendedStudentUserId
      ? "Your BYOD attendance is complete. No PC station sign-in is needed."
      : "Please select your PC station to complete check-in."
  });

  if (req.accepts("html")) return res.send(html);
  return res.json({ 
    success: true, 
    attendance, 
    message: "Attendance recorded successfully.",
    attendanceMethod: session?.intendedStudentUserId ? "byod-qr" : "attendance-qr",
    requiresPCSelection: !session?.intendedStudentUserId,
    attendanceId: attendance.id,
    scheduleId: session?.laboratoryScheduleId
  });
};

export const scanAttendance = async (req, res) => {
  try {
    const token = req.query.token || req.body.token || req.params.token || req.params.sessionId || req.params.sessionToken;
    if (!token) {
      return res.status(400).json({ error: "Attendance token is required." });
    }

    const session = await AttendanceSession.findOne({ where: { token } });
    if (!session) {
      const message = "Attendance session not found. Please scan a valid QR code.";
      if (req.accepts("html")) return res.status(404).send(renderAttendancePageHtml({
        title: "Invalid QR Code",
        heading: "Invalid QR Code",
        message,
        detailRows: [["Status", "Unable to continue"]],
        statusLabel: "Unable to record",
        primaryLabel: "Back to Dashboard",
        primaryHref: "/student/dashboard",
        secondaryLabel: "Close",
        secondaryHref: "#",
        success: false
      }));
      return res.status(404).json({ error: message });
    }

    const schedule = session.laboratoryScheduleId
      ? await LaboratorySchedule.findByPk(session.laboratoryScheduleId)
      : null;
    if (schedule && (await getArchivedEntityIds("laboratory-schedule")).includes(String(schedule.id))) {
      const message = "This laboratory schedule is archived. Attendance can no longer be recorded.";
      if (req.accepts("html")) return res.status(410).send(renderAttendancePageHtml({
        title: "Archived Schedule",
        heading: "Archived Schedule",
        message,
        detailRows: [["Status", "Attendance is unavailable"]],
        statusLabel: "Unable to record",
        primaryLabel: "Back to Dashboard",
        primaryHref: "/student/dashboard",
        secondaryLabel: "Close",
        secondaryHref: "#",
        success: false
      }));
      return res.status(410).json({ error: message });
    }
    if (schedule && getClassScheduleStatus(schedule, new Date()) === "Ended") {
      const message = "This class has ended. Attendance can no longer be recorded.";
      if (req.accepts("html")) return res.status(410).send(renderAttendancePageHtml({
        title: "Class Ended",
        heading: "Class Ended",
        message,
        detailRows: [["Status", "Attendance is closed for this class"]],
        statusLabel: "Unable to record",
        primaryLabel: "Back to Dashboard",
        primaryHref: "/student/dashboard",
        secondaryLabel: "Close",
        secondaryHref: "#",
        success: false
      }));
      return res.status(410).json({ success: false, error: message, classStatus: "Ended" });
    }

    if (session.expiresAt < new Date()) {
      const message = "This attendance QR code has expired. Generate a new one and scan again.";
      if (req.accepts("html")) return res.status(410).send(renderAttendancePageHtml({
        title: "QR Expired",
        heading: "QR Expired",
        message,
        detailRows: [["Status", "The session is no longer active"]],
        statusLabel: "Unable to record",
        primaryLabel: "Back to Dashboard",
        primaryHref: "/student/dashboard",
        secondaryLabel: "Close",
        secondaryHref: "#",
        success: false
      }));
      return res.status(410).json({ error: message });
    }

    if (req.method === "POST") {
      return recordAttendance(req, res, token, session);
    }

    if (!req.session?.userId) {
      req.session.redirectTo = `/attendance/scan/${encodeURIComponent(token)}`;
      return res.redirect("/login");
    }

    const user = await User.findByPk(req.session.userId);
    if (!user || (user.role || "").toLowerCase() !== "student") {
      req.session.redirectTo = `/attendance/scan/${encodeURIComponent(token)}`;
      return res.redirect("/login");
    }
    if (session.intendedStudentUserId && Number(session.intendedStudentUserId) !== Number(user.id)) {
      const message = "This attendance QR code was issued to another student. Please scan the QR code assigned to your name.";
      return res.status(403).send(renderAttendancePageHtml({
        title: "Student QR Mismatch",
        heading: "This QR Code Is Not Yours",
        message,
        detailRows: [["Status", "Attendance check-in blocked"]],
        statusLabel: "Wrong student QR",
        primaryLabel: "Return to Student Dashboard",
        primaryHref: "/student/dashboard",
        secondaryLabel: "Close",
        secondaryHref: "#",
        success: false
      }));
    }
    if (session.intendedStudentUserId) {
      const rosterEntry = await ClassListEntry.findOne({
        where: {
          laboratoryScheduleId: session.laboratoryScheduleId,
          matchedUserId: user.id,
          matchStatus: "matched"
        }
      });
      if (!rosterEntry) {
        return res.status(403).send(renderAttendancePageHtml({
          title: "Not on Class Roster",
          heading: "Attendance Check-in Blocked",
          message: "You are no longer on this class roster. Contact the instructor if this is a mistake.",
          detailRows: [["Status", "Student is not on the schedule roster"]],
          statusLabel: "Roster verification failed",
          primaryLabel: "Return to Student Dashboard",
          primaryHref: "/student/dashboard",
          secondaryLabel: "Close",
          secondaryHref: "#",
          success: false
        }));
      }
    }

    const userCampus = await getUserCampusFromSession(req);
    if (schedule && (!userCampus || !schedule.campus || !canManageRecord(userCampus, schedule.campus))) {
      return res.status(403).send("You do not have permission to access attendance for another campus.");
    }
    const cohortError = getAttendanceCohortError(user, schedule);
    if (cohortError) {
      const hasValidScheduleCohort = normalizeAttendanceYear(schedule?.yearLevel) && normalizeAttendanceSection(schedule?.section);
      return sendAttendanceCohortError(req, res, cohortError, hasValidScheduleCohort ? 403 : 409);
    }
    const attendanceStatus = schedule ? await getAttendanceStatusForSession(session, new Date()) : null;

    if (attendanceStatus === "Not Yet Open") {
      const referenceDate = session?.createdAt ? new Date(session.createdAt) : new Date();
      const startTime = schedule ? parseScheduleClockTime(schedule.startTime, referenceDate) : null;
      const formattedStartTime = startTime ? startTime.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true }) : schedule?.startTime || "the scheduled start time";
      const html = renderAttendancePageHtml({
        title: "Attendance Not Yet Open",
        heading: "Attendance Not Yet Open",
        message: `Attendance for this session will open at ${formattedStartTime}.`,
        detailRows: [["Status", "Attendance has not yet opened"]],
        statusLabel: "Not Yet Open",
        primaryLabel: "Back to Dashboard",
        primaryHref: "/student/dashboard",
        secondaryLabel: "Close",
        secondaryHref: "#",
        success: false
      });

      if (req.accepts("html")) return res.status(409).send(html);
      return res.status(409).json({ success: false, error: `Attendance for this session will open at ${formattedStartTime}.` });
    }

    if (attendanceStatus === "Closed") {
      const closedMessage = "Attendance for this schedule has already closed. No further scans are accepted.";
      const html = renderAttendancePageHtml({
        title: "Attendance Closed",
        heading: "Attendance Closed",
        message: closedMessage,
        detailRows: [["Status", "The attendance window has ended"]],
        statusLabel: "Closed",
        primaryLabel: "Back to Dashboard",
        primaryHref: "/student/dashboard",
        secondaryLabel: "Close",
        secondaryHref: "#",
        success: false
      });

      if (req.accepts("html")) return res.status(410).send(html);
      return res.status(410).json({ success: false, error: closedMessage });
    }

    const payload = await buildAttendanceRecordPayload(req, session, token);
    const detailRows = [
      ["Student Name", payload.fullName],
      ["Student Number", payload.studentId],
      ["Program", payload.program || "—"],
      ["Year", payload.yearLevel || "—"],
      ["Section", payload.section || "—"],
      ["Subject", payload.subject],
      ["Laboratory", payload.lab],
      ["Date", formatDateLabel(payload.dateString)],
      ["Current Time", formatTimeLabel(payload.timeString)],
      ["Attendance Status", "Ready to Check In"]
    ];

    const html = renderAttendancePageHtml({
      title: "Attendance Confirmation",
      heading: "Attendance Confirmation",
      message: "Review the session details below and confirm your attendance.",
      detailRows,
      statusLabel: "Ready to Check In",
      primaryLabel: "Confirm Attendance",
      primaryHref: "/api/attendance/scan",
      secondaryLabel: "Back",
      secondaryHref: "/student/dashboard",
      success: true,
      formAction: "/api/attendance/scan",
      formInputs: {
        token,
        studentId: payload.studentId,
        fullName: payload.fullName,
        subject: payload.subject,
        lab: payload.lab,
        courseSection: payload.courseSection,
        status: payload.status
      }
    });

    if (req.accepts("html")) return res.send(html);
    return res.json({ success: true, attendance: null, payload });
  } catch (error) {
    console.error("Failed to record attendance:", error);
    if (req.accepts("html")) return res.status(500).send(renderAttendancePageHtml({
      title: "Recording Failed",
      heading: "Recording Failed",
      message: "Unable to record attendance at this time.",
      detailRows: [["Status", "Try again in a moment"]],
      statusLabel: "Unable to record",
      primaryLabel: "Back to Dashboard",
      primaryHref: "/student/dashboard",
      secondaryLabel: "Close",
      secondaryHref: "#",
      success: false
    }));
    return res.status(500).json({ error: "Unable to record attendance.", details: error?.message || null });
  }
};
