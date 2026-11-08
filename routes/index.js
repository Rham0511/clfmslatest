/*
  MIT License
  
  Copyright (c) 2025 Christian I. Cabrera || XianFire Framework
  Mindoro State University - Philippines

*/

import express from "express";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { dirname } from "path";
import multer from "multer";
import bcryptjs from "bcryptjs";
import { User } from "../models/userModel.js";
import { Equipment } from "../models/equipmentModel.js";
import { BorrowRecord } from "../models/borrowRecordModel.js";
import { MaintenanceRequest } from "../models/maintenanceRequestModel.js";
import { loginPage, registerPage, loginUser, registerUser, dashboardPage, logoutUser, forgotPasswordPage, forgotPassword, verifyOtpPage, verifyOtp, resendOtp, resetPasswordPage, resetPassword, verifyEmail, updateProfile, uploadStudentPhoto } from "../controllers/authController.js";
import { homePage } from "../controllers/homeController.js";
import { inventoryPage, scanEquipmentQr, redirectLegacyEquipmentQr, resolveEquipmentQrToken, getEquipment, getStudentEquipment, getEquipmentCampusTotals, createEquipment, updateEquipment, updateEquipmentStatus, deleteEquipment, getEquipmentQr, getEquipmentCategories, createEquipmentCategory, deleteEquipmentCategory, reportEquipmentMissing, markEquipmentFound, transferEquipmentSet, getMissingEquipment, getEquipmentHistory, getEquipmentBorrowCycle, logEquipmentScan, getEquipmentScanHistory } from "../controllers/equipmentController.js";
import { listBorrowRecords, createBorrowRecord, createStudentQrBorrowRecord, createFacultyQrBorrowRecord, getFacultyQrBorrowStatus, getStudentQrBorrowStatus, returnBorrowRecord, requestBorrowReturn, cancelBorrowRecord, releaseBorrowRecord, getBorrowHistory, listBorrowAudit, approveBorrowRecord, rejectBorrowRecord, listBorrowNotifications, markBorrowNotificationRead, markBorrowRecordLost } from "../controllers/borrowController.js";
import { listEquipmentAvailability, getEquipmentBorrowingHistory } from "../controllers/equipmentAvailabilityController.js";
import { listEquipmentAssignments, updateEquipmentAssignment, getEquipmentAssignmentHistory, listMyEquipmentAssignments, getMyEquipmentAssignmentHistory } from "../controllers/equipmentAssignmentController.js";
import { getAttendanceRecords, getAttendanceStats, getInstructorAttendanceDashboard, getInstructorAttendanceSessionDetails, getFacultyScheduleAttendanceHistory, exportFacultyScheduleAttendanceHistory, scanAttendance, createAttendanceSession, getStudentAttendanceQrRoster, createStudentAttendanceQrs } from "../controllers/attendanceController.js";
import { getAuditLogs, logAuditEntry } from "../controllers/auditController.js";
import { getPCStationQr, getPCStationScanAvailability, getMyPCStationSessions, logoutMyPCStationSession, redirectLegacyPCStationQr, scanPCStationQr, showPCStationScanResult, submitPCStationAction } from "../controllers/pcStationController.js";
import { getAuditTrail } from "../controllers/auditTrailController.js";
import { getPCAvailability, assignPC, endPCSession, getCurrentPCAssignment } from "../controllers/pcAssignmentController.js";
import { answerRoleHelp, createRoleHelpChat, getRoleHelpChatMessages, listRoleHelpChats } from "../controllers/roleHelpController.js";
import { getScheduleSeatingChart } from "../controllers/seatingChartController.js";
import { getUserAuthContext, getUserCampusFromSession, canManageRecord, isAdminRole as isCampusAdminRole } from "../controllers/campusAuthController.js";
import { LaboratorySchedule } from "../models/laboratoryScheduleModel.js";
import { ClassListEntry } from "../models/classListEntryModel.js";
import { AttendanceSession } from "../models/attendanceSessionModel.js";
import { Attendance } from "../models/attendanceModel.js";
import { sequelize } from "../models/db.js";
import { ensureArchiveRecordsTable, getArchivedEntityIds } from "../models/archiveRecords.js";
import { formatComputerLabLocation, normalizeLabLabel } from "../models/computerLabService.js";
import { DataTypes, Op, QueryTypes } from "sequelize";
import XLSX from "xlsx";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname, "../public/uploads")),
  filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`)
});
const upload = multer({ storage });
const scheduleClassListUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, callback) => {
    if (/\.(xlsx|xls|csv)$/i.test(file.originalname)) return callback(null, true);
    return callback(new Error("Class list must be an .xlsx, .xls, or .csv file."));
  }
});
const handleScheduleClassListUpload = (req, res, next) => scheduleClassListUpload.single("classListFile")(req, res, (error) => {
  if (!error) return next();
  const tooLarge = error.code === "LIMIT_FILE_SIZE";
  console.error("Schedule class list upload rejected.", error);
  return res.status(tooLarge ? 413 : 400).json({
    error: tooLarge ? "Class list file must be 10 MB or smaller." : error.message || "Unable to upload the class list."
  });
});

const getUploadedFileBuffer = (uploadedFile) => {
  if (uploadedFile?.buffer) return uploadedFile.buffer;
  if (uploadedFile?.path && fs.existsSync(uploadedFile.path)) {
    return fs.readFileSync(uploadedFile.path);
  }
  return null;
};

const router = express.Router();

const staticHtmlPages = [
  "admin-dashboard",
  "admin-profile",
  "admin-computer-labs",
  "admin-facilities",
  "admin-faculty-management",
  "admin-user-management",
  "admin-technician-accomplishments",
  "equipment-assignment",
  "faculty-dashboard",
  "faculty-borrow-equipment",
  "faculty-mir-items",
  "faculty-audit-history",
  "faculty-equipment-availability",
  "faculty-profile",
  "faculty-my-requests",
  "faculty-report-equipment",
  "faculty-laboratory-schedules",
  "student-dashboard",
  "student-audit-history",
  "student-borrow-equipment",
  "student-scan-attendance",
  "student-profile",
  "student-my-requests",
  "student-report-issue",
  "student-report-equipment",
  "my-pc-station",
  "technician-dashboard",
  "technician-profile",
  "attendance",
  "maintenance-reports",
  "borrow-equipment"
];

const normalizeRoleName = (role) => String(role || "").trim().toLowerCase();
const isAdminRole = (role) => normalizeRoleName(role).includes("admin");
const getRequestRoleValue = (req) => req.session?.userRole || req.user?.role || "";
const canBypassAuditAccessForDev = (req) => {
  if (process.env.NODE_ENV === "production") return false;
  const rawBypass = String(req.query?.devBypass || "").toLowerCase();
  const devRole = normalizeRoleName(req.headers?.["x-dev-role"] || req.query?.devRole || req.query?.role);
  return devRole === "admin" || rawBypass === "true" || rawBypass === "1";
};
const requireAdminForAudit = async (req, res, next) => {
  if (canBypassAuditAccessForDev(req)) return next();
  if (!req.session?.userId) return res.status(403).send("Forbidden: admin only.");

  try {
    const sessionRole = normalizeRoleName(getRequestRoleValue(req));
    if (isAdminRole(sessionRole)) return next();

    const user = await User.findByPk(req.session.userId, { attributes: ["role"] });
    if (isAdminRole(user?.role)) return next();
  } catch (error) {
    console.warn("[AuditAuth] Failed to resolve admin role from session", error?.message || error);
  }

  res.status(403).send("Forbidden: admin only.");
};
const requireScheduleUpdateAccess = async (req, res, next) => {
  if (!req.session?.userId) return res.status(401).json({ error: "Please log in to update laboratory schedules." });
  try {
    const user = await User.findByPk(req.session.userId, {
      attributes: ["id", "role", "campus"]
    });
    if (!user) return res.status(401).json({ error: "Your account could not be verified." });
    const role = normalizeRoleName(user.role);
    if (!["faculty", "instructor"].includes(role)) {
      return res.status(403).json({ error: "Only the assigned faculty instructor or an administrator can update this schedule." });
    }
    const schedule = await LaboratorySchedule.findByPk(req.params.id);
    if (!schedule) return res.status(404).json({ error: "Schedule not found." });
    const isOwner = String(schedule.instructorUserId || "") === String(user.id);
    const userCampus = normalizeCampus(user.campus) || await getUserCampusFromSession(req);
    if (!isOwner || !userCampus || !canManageRecord(userCampus, schedule.campus)) {
      return res.status(403).json({ error: "You can update only schedules assigned to you at your campus." });
    }
    req.scheduleManager = user;
    return next();
  } catch (error) {
    console.error("Failed to authorize laboratory schedule update.", error);
    return res.status(500).json({ error: "Failed to authorize schedule update." });
  }
};
const requireScheduleCreatorRole = async (req, res, next) => {
  if (!req.session?.userId) return res.status(401).json({ error: "Please log in to create laboratory schedules." });
  try {
    const user = await User.findByPk(req.session.userId, {
      attributes: ["id", "name", "role", "campus"]
    });
    const role = normalizeRoleName(user?.role);
    if (!user || !isAdminRole(role)) {
      return res.status(403).json({ error: "Only administrators can create laboratory schedules." });
    }
    req.scheduleCreator = user;
    return next();
  } catch (error) {
    console.error("Failed to authorize laboratory schedule creation.", error);
    return res.status(500).json({ error: "Failed to authorize schedule creation." });
  }
};

const pageConfigs = {
  "attendance-monitoring": {
    title: "Attendance Monitoring",
    description: "",
    backRoute: "/faculty-dashboard",
    backLabel: "Back to Faculty Dashboard",
    content: `
      <style>
        :root {
          --bg: #07150F;
          --bg-secondary: #0A1D15;
          --panel: linear-gradient(180deg, rgba(15,36,27,.96), rgba(10,29,21,.96));
          --panel-strong: linear-gradient(180deg, rgba(15,36,27,.98), rgba(10,29,21,.98));
          --panel-soft: rgba(74,222,128,.06);
          --border: rgba(74,222,128,.15);
          --text: #F8FAFC;
          --muted: #B6D7C8;
          --accent: #22C55E;
          --accent-strong: #16A34A;
          --accent-soft: rgba(74,222,128,.12);
          --shadow: 0 12px 35px rgba(6,64,43,.18);
          --shadow-hover: 0 18px 40px rgba(34,197,94,.18);
        }

        .attendance-page-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 1rem;
          padding: 1.35rem 1.35rem 1.4rem;
          border-radius: 24px;
          border: 1px solid var(--border);
          background: linear-gradient(180deg, rgba(15,36,27,.96), rgba(10,29,21,.96));
          box-shadow: var(--shadow);
          backdrop-filter: blur(16px) saturate(1.04);
          margin-bottom: 1.5rem;
        }

        .attendance-page-title {
          font-size: 2rem;
          font-weight: 800;
          color: #f8fafc;
          line-height: 1.15;
          letter-spacing: -0.02em;
          margin: 0;
        }

        .attendance-page-card {
          border: 1px solid var(--border);
          background: var(--panel);
          border-radius: 20px;
          box-shadow: var(--shadow);
          backdrop-filter: blur(14px) saturate(1.04);
          overflow: hidden;
          padding: 1.25rem 1.3rem 1.35rem;
        }

        .attendance-summary-grid {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 1rem;
          margin-bottom: 1.2rem;
        }

        .attendance-summary-card {
          position: relative;
          border: 1px solid var(--border);
          border-radius: 18px;
          padding: 1rem 1.05rem 1rem;
          background: var(--panel);
          box-shadow: var(--shadow);
          min-height: 122px;
          backdrop-filter: blur(14px) saturate(1.04);
          transition: transform 0.25s ease, box-shadow 0.25s ease;
        }

        .attendance-summary-card:hover {
          transform: translateY(-3px);
          box-shadow: var(--shadow-hover);
        }

        .attendance-summary-icon {
          position: absolute;
          top: 0.8rem;
          right: 0.8rem;
          color: #bbf7d0;
          font-size: 1.7rem;
          opacity: 0.95;
          background: rgba(74,222,128,.12);
          border: 1px solid rgba(74,222,128,.16);
          border-radius: 0.85rem;
          width: 2.6rem;
          height: 2.6rem;
          display: inline-flex;
          align-items: center;
          justify-content: center;
        }

        .attendance-summary-label {
          color: #bbf7d0;
          font-size: 0.92rem;
          text-transform: uppercase;
          letter-spacing: 0.12em;
          font-weight: 700;
        }

        .attendance-summary-value {
          font-size: 2.15rem;
          font-weight: 800;
          margin-top: 0.5rem;
          color: #f8fafc;
          line-height: 1.15;
        }

        .attendance-filter-row {
          display: grid;
          grid-template-columns: 2.1fr 1fr 1.15fr 1fr;
          gap: 0.9rem;
          margin-top: 0.25rem;
          margin-bottom: 1.1rem;
          padding-top: 1.15rem;
          align-items: start;
        }

        .attendance-filter-field {
          display: flex;
          flex-direction: column;
          gap: 0.55rem;
        }

        .attendance-filter-label {
          font-size: 1rem;
          font-weight: 700;
          color: #cbd5e1;
          letter-spacing: 0.02em;
        }

        .attendance-filter-input,
        .attendance-filter-select {
          width: 100%;
          background: linear-gradient(180deg, rgba(15,36,27,.96), rgba(10,29,21,.96));
          color: var(--text);
          border: 1px solid rgba(74,222,128,.16);
          border-radius: 0.75rem;
          padding: 0.9rem 1.2rem;
          outline: none;
          font-size: 1rem;
          line-height: 1.4;
        }

        .attendance-filter-input:focus,
        .attendance-filter-select:focus {
          border-color: rgba(110,231,183,.62);
          box-shadow: 0 0 0 3px rgba(34,197,94,.1);
        }

        .attendance-table-wrap {
          overflow-x: auto;
          overflow-y: auto;
          max-height: 44rem;
          border-radius: 16px;
          border: 1px solid rgba(74,222,128,.12);
          background: rgba(74,222,128,.04);
          box-shadow: inset 0 1px 0 rgba(255,255,255,.02);
          margin-bottom: 1.1rem;
          scrollbar-color: rgba(74,222,128,.55) rgba(6,16,11,.75);
          scrollbar-width: thin;
        }

        .attendance-table-wrap::-webkit-scrollbar {
          width: 0.5rem;
          height: 0.5rem;
        }

        .attendance-table-wrap::-webkit-scrollbar-track {
          background: rgba(6,16,11,.75);
          border-radius: 9999px;
        }

        .attendance-table-wrap::-webkit-scrollbar-thumb {
          background: rgba(74,222,128,.55);
          border: 1px solid rgba(6,16,11,.75);
          border-radius: 9999px;
        }

        .attendance-table {
          width: 100%;
          border-collapse: collapse;
        }

        .attendance-table th {
          position: sticky;
          top: 0;
          z-index: 1;
          text-align: left;
          padding: 0.95rem 0.9rem;
          font-size: 0.92rem;
          text-transform: uppercase;
          letter-spacing: 0.1em;
          font-weight: 700;
          color: #D1FAE5;
          background: linear-gradient(180deg, rgba(18,49,36,.95), rgba(20,59,42,.95));
          border-bottom: 1px solid rgba(148, 163, 184, 0.12);
          white-space: nowrap;
        }

        .attendance-table td {
          text-align: left;
          padding: 0.95rem 0.9rem;
          font-size: 1rem;
          border-bottom: 1px solid rgba(148, 163, 184, 0.12);
          white-space: nowrap;
          line-height: 1.5;
          color: var(--text);
        }

        .attendance-table tbody tr {
          transition: background-color 0.2s ease;
        }

        .attendance-table tbody tr:hover {
          background: rgba(20,59,42,.45);
        }

        .attendance-action-btn {
          border: 1px solid rgba(74,222,128,.16);
          background: linear-gradient(180deg, rgba(15,36,27,.96), rgba(10,29,21,.96));
          color: var(--text);
          border-radius: 999px;
          padding: 0.6rem 0.9rem;
          font-size: 1rem;
          font-weight: 700;
          transition: all 0.2s ease;
          box-shadow: inset 0 1px 0 rgba(255,255,255,.03);
          cursor: pointer;
          white-space: nowrap;
        }

        .attendance-action-btn:hover {
          border-color: rgba(74,222,128,.24);
          transform: translateY(-1px);
          box-shadow: var(--shadow-hover);
        }

        .attendance-pagination-row {
          display: flex;
          flex-wrap: wrap;
          justify-content: flex-end;
          align-items: center;
          gap: 0.55rem;
          margin-top: 0.9rem;
        }

        .attendance-pagination-btn {
          min-width: 2.2rem;
          height: 2.2rem;
          border: 1px solid rgba(74,222,128,.16);
          background: linear-gradient(180deg, rgba(15,36,27,.96), rgba(10,29,21,.96));
          color: var(--text);
          border-radius: 999px;
          padding: 0 0.8rem;
          font-size: 0.98rem;
          font-weight: 700;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          transition: all 0.2s ease;
          box-shadow: inset 0 1px 0 rgba(255,255,255,.03);
          cursor: pointer;
        }

        .attendance-pagination-btn:hover:not(:disabled) {
          border-color: rgba(74,222,128,.24);
          transform: translateY(-1px);
          box-shadow: var(--shadow-hover);
        }

        .attendance-pagination-btn.active {
          border-color: rgba(74,222,128,.2);
          background: linear-gradient(135deg, rgba(16,185,129,1), rgba(52,211,153,1));
          color: #000;
          font-weight: 800;
          border-radius: 0.5rem;
          padding: 0.25rem 0.75rem;
          box-shadow: 0 10px 24px rgba(6,64,43,.16);
        }

        .attendance-pagination-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
          transform: none;
          box-shadow: none;
        }

        .attendance-pagination-info {
          font-size: 1rem;
          color: #cbd5e1;
        }

        body.attendance-monitoring-page .main-container.theme-light .page-content :is(
          h1, h2, h3, h4, h5, h6, p, span, label, th, td, button, input, select, option, textarea, a, li, strong, b, small
        ) {
          font-weight: 600 !important;
        }

        body.attendance-monitoring-page .main-container.theme-light .page-content :is(h1, h2, h3, h4, h5, h6) {
          font-weight: 700 !important;
        }

        body.attendance-monitoring-page .main-container.theme-light .attendance-summary-label,
        body.attendance-monitoring-page .main-container.theme-light .attendance-filter-label,
        body.attendance-monitoring-page .main-container.theme-light .attendance-table th {
          font-weight: 700 !important;
        }

        @media (max-width: 1024px) {
          .attendance-summary-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
          .attendance-filter-row {
            grid-template-columns: 1fr 1fr;
          }
        }

        @media (max-width: 720px) {
          body.faculty-portal {
            min-height: 100%;
            height: auto;
            overflow-y: auto;
            -webkit-overflow-scrolling: touch;
          }

          body.faculty-portal .main-container,
          body.faculty-portal .page-content {
            height: auto;
            min-height: 100%;
            overflow-y: visible;
          }

          body.faculty-portal .page-content {
            padding-bottom: max(1.5rem, env(safe-area-inset-bottom, 0px)) !important;
          }

          .attendance-page-header {
            align-items: center;
            min-height: 4.5rem;
            margin-bottom: .75rem;
            padding: .85rem .9rem .85rem 4.25rem;
            border-radius: 1rem;
          }

          .attendance-page-title {
            font-size: clamp(1.15rem, 5vw, 1.5rem);
            line-height: 1.2;
            letter-spacing: -.025em;
          }

          .attendance-page-card {
            padding: .8rem;
            border-radius: 1.15rem;
          }

          .attendance-summary-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: .65rem;
            margin-bottom: .8rem;
          }

          .attendance-summary-card {
            min-height: 6.4rem;
            padding: .75rem;
            border-radius: .95rem;
          }

          .attendance-summary-icon {
            top: .6rem;
            right: .6rem;
            width: 2rem;
            height: 2rem;
            border-radius: .65rem;
            font-size: 1rem;
          }

          .attendance-summary-label {
            max-width: calc(100% - 1.8rem);
            font-size: .76rem;
            letter-spacing: .08em;
            line-height: 1.35;
          }

          .attendance-summary-value {
            margin-top: .35rem;
            font-size: 1.65rem;
            line-height: 1;
          }

          .attendance-filter-row {
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: .6rem;
            margin-bottom: .8rem;
            padding-top: .75rem;
          }

          .attendance-filter-field:first-child {
            grid-column: 1 / -1;
          }

          .attendance-filter-field {
            min-width: 0;
            gap: .35rem;
          }

          .attendance-filter-label {
            font-size: .88rem;
          }

          .attendance-filter-input,
          .attendance-filter-select {
            min-width: 0;
            padding: .7rem .75rem;
            font-size: 16px;
          }

          .attendance-table-wrap {
            height: auto;
            max-height: none;
            margin-bottom: .65rem;
            -webkit-overflow-scrolling: touch;
            overscroll-behavior-inline: contain;
          }

          .attendance-table {
            min-width: 48rem;
          }

          .attendance-table th,
          .attendance-table td {
            font-size: .9rem;
            padding: .65rem .55rem;
          }

          .attendance-action-btn {
            padding: .48rem .7rem;
            font-size: .9rem;
          }

          .attendance-pagination-row {
            justify-content: space-between;
            gap: .5rem;
          }

          .attendance-pagination-info {
            font-size: .9rem;
          }
        }
      </style>

      <div class="attendance-page-header">
        <h2 class="attendance-page-title">Completed Attendance Sessions</h2>
      </div>

      <div class="attendance-page-card">
        <div class="attendance-summary-grid">
          <div class="attendance-summary-card">
            <div class="attendance-summary-icon"><i class="fas fa-users"></i></div>
            <div class="attendance-summary-label">Total Sessions</div>
            <div class="attendance-summary-value" id="totalSessionsValue">0</div>
          </div>
          <div class="attendance-summary-card">
            <div class="attendance-summary-icon"><i class="fas fa-check-circle"></i></div>
            <div class="attendance-summary-label">Present Today</div>
            <div class="attendance-summary-value" id="presentTodayValue">0</div>
          </div>
          <div class="attendance-summary-card">
            <div class="attendance-summary-icon"><i class="fas fa-times-circle"></i></div>
            <div class="attendance-summary-label">Absent Today</div>
            <div class="attendance-summary-value" id="absentTodayValue">0</div>
          </div>
          <div class="attendance-summary-card">
            <div class="attendance-summary-icon"><i class="fas fa-clock"></i></div>
            <div class="attendance-summary-label">Late Today</div>
            <div class="attendance-summary-value" id="lateTodayValue">0</div>
          </div>
        </div>

        <div class="attendance-filter-row">
          <div class="attendance-filter-field">
            <label class="attendance-filter-label">Search</label>
            <input id="attendanceSearch" type="text" placeholder="Search by subject or instructor" class="attendance-filter-input" />
          </div>
          <div class="attendance-filter-field">
            <label class="attendance-filter-label">Campus</label>
            <select id="attendanceCampusFilter" class="attendance-filter-select">
              <option value="">All Campuses</option>
              <option value="Bongabong">Bongabong</option>
              <option value="Calapan">Calapan</option>
              <option value="Victoria">Victoria</option>
            </select>
          </div>
          <div class="attendance-filter-field">
            <label class="attendance-filter-label">Laboratory</label>
            <select id="attendanceLabFilter" class="attendance-filter-select">
              <option value="">All Laboratories</option>
              <option value="Laboratory 1 — Room 202">Lab 1 — Room 202</option>
              <option value="Laboratory 2 — Room 204">Lab 2 — Room 204</option>
            </select>
          </div>
          <div class="attendance-filter-field">
            <label class="attendance-filter-label">Date</label>
            <input id="attendanceDateFilter" type="date" class="attendance-filter-input" />
          </div>
        </div>

        <div class="attendance-table-wrap">
          <table class="attendance-table">
            <thead>
              <tr>
                <th>Subject</th>
                <th>Laboratory</th>
                <th>Instructor</th>
                <th>Date</th>
                <th>Time</th>
                <th>Counts</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody id="attendanceMonitorTableBody">
              <tr>
                <td colspan="7" class="text-center text-slate-400">Loading attendance sessions...</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div class="attendance-pagination-row">
          <div class="attendance-pagination-info" id="attendancePaginationInfo">Showing 0 of 0</div>
          <div id="attendancePagination" class="flex flex-wrap items-center gap-2"></div>
        </div>
      </div>

      <style>
        body.modal-open { overflow: hidden; }

        #attendanceSessionModal .modal-content {
          width: min(100%, 58rem);
          max-width: 58rem;
          max-height: 88vh;
          min-height: 0;
          padding: 0;
          overflow: hidden;
          background: linear-gradient(180deg, rgba(15,36,27,.98), rgba(8,24,17,.98));
          border: 2px solid rgba(74,222,128,.28);
          border-radius: 24px;
          box-shadow: 0 24px 70px rgba(6,64,43,.38), inset 0 1px 0 rgba(255,255,255,.04);
          backdrop-filter: blur(18px) saturate(1.08);
        }

        #attendanceSessionModal .attendance-modal-header {
          padding: 1.5rem 1.75rem 1.35rem;
          background: linear-gradient(180deg, rgba(18,48,34,.96), rgba(10,31,21,.92));
          border-bottom: 1px solid rgba(74,222,128,.2);
        }

        #attendanceSessionModal .attendance-modal-subtitle {
          color: rgba(167,243,208,.72);
          margin-top: .4rem;
        }

        #attendanceSessionModal .attendance-modal-close {
          color: rgba(167,243,208,.72);
          transition: color .2s ease, background .2s ease;
          border-radius: .75rem;
          padding: .35rem .5rem;
        }

        #attendanceSessionModal .attendance-modal-close:hover {
          color: #f0fdf4;
          background: rgba(74,222,128,.12);
        }

        #attendanceSessionModal .attendance-modal-body {
          min-height: 0;
          padding: 1.5rem 1.75rem 1.75rem;
          background: linear-gradient(180deg, rgba(8,24,17,.72), rgba(6,20,14,.88));
          overflow: hidden;
        }

        #attendanceSessionModal .attendance-modal-body > #attendanceSessionModalContent {
          min-width: 0;
        }

        #attendanceSessionModal .attendance-summary-grid {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 1rem;
          margin-top: 1.35rem;
        }

        #attendanceSessionModal .attendance-summary-card {
          min-height: 6.8rem;
          padding: 1rem 1.05rem;
          border-radius: 1rem;
          border: 1px solid rgba(74,222,128,.2);
          background: linear-gradient(180deg, rgba(18,48,34,.82), rgba(10,29,21,.9));
          box-shadow: inset 0 1px 0 rgba(255,255,255,.035), 0 10px 24px rgba(6,64,43,.14);
        }

        #attendanceSessionModal .attendance-summary-card .card-header {
          padding: 0;
          gap: .75rem;
        }

        #attendanceSessionModal .attendance-summary-card .card-title {
          color: rgba(216,243,224,.72);
          font-size: .75rem;
          letter-spacing: .08em;
          text-transform: uppercase;
        }

        #attendanceSessionModal .attendance-summary-card h2 {
          margin-top: .55rem;
          line-height: 1;
        }

        #attendanceSessionModal .attendance-summary-card .card-icon {
          width: 2.5rem;
          height: 2.5rem;
          border-radius: .85rem;
          flex-shrink: 0;
        }

        #attendanceSessionModal .attendance-modal-controls {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: .75rem;
          margin-bottom: 1.15rem;
        }

        #attendanceSessionModal .attendance-modal-controls input {
          min-width: min(100%, 18rem);
          flex: 1 1 18rem;
          border: 1px solid rgba(74,222,128,.2);
          border-radius: .85rem;
          background: rgba(12,30,22,.72);
          color: #ecfdf5;
          padding: .7rem .9rem;
          outline: none;
        }

        #attendanceSessionModal .attendance-modal-controls input:focus {
          border-color: rgba(110,231,183,.62);
          box-shadow: 0 0 0 3px rgba(34,197,94,.1);
        }

        #attendanceSessionModal .attendance-modal-controls button {
          border: 1px solid rgba(74,222,128,.22);
          border-radius: .85rem;
          background: rgba(34,197,94,.12);
          color: #d1fae5;
          padding: .7rem .95rem;
          font-weight: 600;
          transition: background .2s ease, border-color .2s ease;
        }

        #attendanceSessionModal .attendance-modal-controls button:hover {
          background: rgba(34,197,94,.2);
          border-color: rgba(110,231,183,.45);
        }

        #attendanceSessionModal .attendance-table-wrap {
          max-height: min(50vh, 28rem);
          overflow-x: auto;
          overflow-y: auto;
          border: 1px solid rgba(74,222,128,.16);
          border-radius: 1rem;
          background: rgba(8,20,14,.55);
        }

        #attendanceSessionModal .attendance-table-wrap table {
          width: 100%;
          min-width: 0;
          table-layout: auto;
          border-collapse: separate;
          border-spacing: 0;
        }

        #attendanceSessionModal .attendance-table-wrap th,
        #attendanceSessionModal .attendance-table-wrap td {
          vertical-align: top;
          overflow-wrap: anywhere;
          white-space: normal;
        }

        #attendanceSessionModal .attendance-table-wrap th {
          position: sticky;
          top: 0;
          z-index: 1;
          white-space: nowrap;
        }

        #attendanceSessionModal .attendance-table-wrap td {
          line-height: 1.45;
        }

        #attendanceSessionModal .attendance-student-name {
          min-width: 11rem;
          color: #f0fdf4;
        }

        #attendanceSessionModal .attendance-table-wrap thead {
          background: linear-gradient(180deg, rgba(18,48,34,.96), rgba(10,29,21,.96));
          border-bottom: 1px solid rgba(74,222,128,.2);
        }

        #attendanceSessionModal .attendance-table-wrap tbody {
          color: #d8f3e0;
        }

        #attendanceSessionModal .attendance-table-wrap tbody tr {
          border-color: rgba(74,222,128,.1);
        }

        #attendanceSessionModal .attendance-table-wrap tbody tr:hover {
          background: rgba(34,197,94,.07);
        }

        @media (max-width: 767px) {
          #attendanceSessionModal .modal-content {
            max-height: 92vh;
          }

          #attendanceSessionModal .attendance-table-wrap {
            max-height: min(45vh, 24rem);
          }

          #attendanceSessionModal .attendance-modal-header,
          #attendanceSessionModal .attendance-modal-body {
            padding-left: 1rem;
            padding-right: 1rem;
          }

          #attendanceSessionModal .attendance-summary-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: .75rem;
          }
        }

        @media (max-width: 430px) {
          #attendanceSessionModal .attendance-summary-grid {
            grid-template-columns: 1fr;
          }

          #attendanceSessionModal .attendance-table-wrap {
            overflow-x: hidden;
            max-height: min(42vh, 22rem);
            border: 0;
            background: transparent;
          }

          #attendanceSessionModal .attendance-detail-table,
          #attendanceSessionModal .attendance-detail-table tbody,
          #attendanceSessionModal .attendance-detail-table tr,
          #attendanceSessionModal .attendance-detail-table td {
            display: block;
            width: 100%;
          }

          #attendanceSessionModal .attendance-detail-table thead {
            display: none;
          }

          #attendanceSessionModal .attendance-detail-table tbody tr {
            margin-bottom: .75rem;
            padding: .35rem .85rem;
            border: 1px solid rgba(74,222,128,.16);
            border-radius: .85rem;
            background: rgba(18,48,34,.62);
          }

          #attendanceSessionModal .attendance-detail-table td {
            display: grid;
            grid-template-columns: 5.5rem minmax(0, 1fr);
            gap: .75rem;
            padding: .55rem 0;
            border-bottom: 1px solid rgba(74,222,128,.1);
          }

          #attendanceSessionModal .attendance-detail-table td:last-child {
            border-bottom: 0;
          }

          #attendanceSessionModal .attendance-detail-table td::before {
            content: attr(data-label);
            color: rgba(167,243,208,.72);
            font-size: .7rem;
            font-weight: 700;
            letter-spacing: .06em;
            text-transform: uppercase;
          }

          #attendanceSessionModal .attendance-student-name {
            min-width: 0;
          }
        }
      </style>

      <div id="attendanceSessionModal" class="hidden fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 backdrop-blur-sm px-4 py-6 overflow-hidden">
          <div class="modal-content relative flex w-full max-w-4xl flex-col">

          <!-- Header (fixed height, non-shrinking) -->
          <div class="attendance-modal-header flex-shrink-0">
            <div class="flex items-center">
              <div class="flex-1">
                <h3 id="attendanceSessionModalTitle" class="text-2xl font-semibold text-white">Attendance Details</h3>
                <p id="attendanceSessionModalSubtitle" class="attendance-modal-subtitle text-sm">Final attendance summary for this completed session.</p>
              </div>
              <div class="ml-4">
                <button type="button" onclick="closeAttendanceSessionModal()" class="attendance-modal-close text-2xl"><i class="fas fa-times"></i></button>
              </div>
            </div>
            <div id="attendanceSessionModalHeaderExtras"></div>
          </div>

          <!-- Modal body keeps the header visible; the student list owns scrolling. -->
          <div id="attendanceSessionModalBody" class="attendance-modal-body flex-1">
            <div id="attendanceSessionModalContent" class="space-y-6"></div>
          </div>
        </div>
      </div>
      <script src="/js/attendance-monitoring.js?v=20261006" defer></script>
    `
  },
  "laboratory-schedules": {
    title: "Laboratory Schedules",
    description: "",
    backRoute: "/admin-dashboard",
    backLabel: "Back to Admin Dashboard",
    content: `
      <style>
        .page-hero-card {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 1rem;
          min-height: 72px;
          padding: 0.7rem 0.95rem;
          border-radius: 24px;
          border: 1px solid rgba(74,222,128,.24);
          background: linear-gradient(180deg, rgba(15,36,27,.96), rgba(10,29,21,.96));
          box-shadow: 0 12px 35px rgba(6,64,43,.18);
          backdrop-filter: blur(16px) saturate(1.04);
          margin: 0.6rem 0 0.7rem;
        }
        .page-hero-meta {
          display: flex;
          flex-direction: column;
          gap: 0.45rem;
        }
        .page-eyebrow {
          font-size: 0.78rem;
          font-weight: 700;
          letter-spacing: 0.24em;
          text-transform: uppercase;
          color: rgba(110, 231, 183, 0.72);
          margin: 0;
        }
        .page-title {
          font-size: 2rem;
          font-weight: 800;
          color: #f8fafc;
          line-height: 1.15;
          letter-spacing: -0.02em;
          margin: 0;
        }
        .page-subtitle {
          color: #cbd5e1;
          font-size: 0.95rem;
          line-height: 1.5;
          margin: 0;
          max-width: 44rem;
        }
        .page-hero-badge {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 3rem;
          height: 3rem;
          border-radius: 1rem;
          background: rgba(16,87,55,.35);
          color: #86efac;
          border: 1px solid rgba(74,222,128,.24);
          box-shadow: inset 0 1px 0 rgba(255,255,255,.06);
          flex-shrink: 0;
        }
        body.app-shell .page-content {
          background: linear-gradient(180deg, rgba(4, 14, 10, 0.98), rgba(2, 9, 6, 0.98)) !important;
          border-radius: 24px;
          padding: 0.7rem 0.85rem 0.85rem;
          box-shadow: inset 0 1px 0 rgba(255,255,255,.03);
        }
        .seating-chart-modal {
          position: fixed;
          inset: 0 0 0 var(--sidebar-width);
          z-index: 1301;
          box-sizing: border-box;
          padding: clamp(0.5rem, 2vw, 1.5rem);
        }
        .seating-chart-modal__dialog {
          width: min(100%, 72rem);
          max-height: calc(100vh - 1rem);
          max-height: calc(100dvh - 1rem);
          margin: 0;
          overscroll-behavior: contain;
        }
        body.app-shell .main-container.seating-chart-open { z-index: auto; }
        @media (max-width: 768px) {
          .seating-chart-modal {
            inset: 0;
            padding: 0.5rem;
          }
          .seating-chart-modal__dialog {
            max-height: calc(100vh - 1rem);
            max-height: calc(100dvh - 1rem);
          }
        }
        .page-content .card,
        .page-content .card.sm,
        .page-content .page-hero-card {
          background: linear-gradient(180deg, rgba(15,36,27,.96), rgba(10,29,21,.96)) !important;
          border: 1px solid rgba(74,222,128,.16) !important;
          box-shadow: inset 0 1px 0 rgba(255,255,255,.03), 0 12px 35px rgba(6,64,43,.18) !important;
          color: #f8fafc !important;
          padding: 0.8rem !important;
        }
        .page-content .card.sm {
          padding: 0.75rem !important;
        }
        .page-content .card-header {
          margin-bottom: 0.6rem !important;
        }
        .page-content .card:hover {
          transform: translateY(-3px);
          box-shadow: 0 16px 42px rgba(34,197,94,.16);
          border-color: rgba(74,222,128,.38) !important;
        }
        .page-content .card-title {
          color: #d1fae5 !important;
          letter-spacing: 0.16em;
        }
        .page-content .card .text-gray-400,
        .page-content .card .text-slate-400,
        .page-content .card .text-gray-500,
        .page-content .card .text-slate-300 {
          color: #d8f5e0 !important;
        }
        .page-content .card-icon {
          background: rgba(16,87,55,.35) !important;
          color: #86efac !important;
          border: 1px solid rgba(74,222,128,.24) !important;
        }
        .page-content .card .rounded-2xl.border-dashed,
        .page-content .card .rounded-2xl.border,
        .page-content .card .rounded-3xl {
          background: linear-gradient(180deg, rgba(8,24,18,.9), rgba(6,16,12,.88)) !important;
          border-color: rgba(74,222,128,.18) !important;
        }
        #scheduleGrid {
          gap: 1rem !important;
        }
        .schedule-summary-grid {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 0.85rem;
          margin: 0 0 0.85rem;
        }
        .schedule-summary-card {
          position: relative;
          display: flex;
          flex-direction: column;
          justify-content: space-between;
          min-height: 120px;
          padding: 1.25rem;
          border-radius: 1rem;
          border: 1px solid rgba(16,185,129,.2);
          background: rgba(2,40,20,.6);
          box-shadow: 0 10px 25px rgba(2,40,20,.2);
          backdrop-filter: blur(12px);
        }
        .schedule-summary-card--next {
          border-color: rgba(74,222,128,.4);
        }
        .schedule-summary-card--wide {
          min-height: 120px;
        }
        .schedule-summary-header {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 0.75rem;
        }
        .schedule-summary-label {
          margin: 0;
          color: #bbf7d0;
          font-size: 0.72rem;
          font-weight: 700;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          line-height: 1.3;
        }
        .schedule-summary-icon {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 2.3rem;
          height: 2.3rem;
          border-radius: 0.8rem;
          border: 1px solid rgba(74,222,128,.22);
          background: rgba(16,87,55,.28);
          color: #86efac;
          font-size: 0.9rem;
          flex-shrink: 0;
        }
        .schedule-summary-value {
          margin: 0.4rem 0 0;
          color: #f8fafc;
          font-size: clamp(1.5rem, 2.5vw, 2.1rem);
          line-height: 1.05;
          font-weight: 800;
          letter-spacing: -0.04em;
        }
        .schedule-summary-detail {
          margin: 0.5rem 0 0;
          color: #d9f9e6;
          font-size: 0.76rem;
          line-height: 1.5;
          font-weight: 600;
        }
        .schedule-summary-detail strong {
          color: #f8fafc;
          font-weight: 700;
        }
        .schedule-manager-card {
          padding: clamp(1rem, 2vw, 1.5rem);
          border-radius: 1.4rem;
          border: 1px solid rgba(110,231,183,.2);
          background:
            radial-gradient(ellipse at 0% 0%, rgba(34,197,94,.09), transparent 35%),
            linear-gradient(155deg, rgba(12,34,24,.98), rgba(6,20,14,.98));
          box-shadow: inset 0 1px 0 rgba(255,255,255,.045), 0 20px 50px rgba(0,0,0,.18);
        }
        .schedule-manager-intro {
          display: flex;
          align-items: center;
          gap: .9rem;
          margin: 0 0 1.1rem;
        }
        .schedule-manager-icon {
          display: grid;
          place-items: center;
          flex: 0 0 auto;
          width: 3rem;
          height: 3rem;
          border: 1px solid rgba(110,231,183,.25);
          border-radius: 1rem;
          background: linear-gradient(145deg, rgba(34,197,94,.2), rgba(16,87,55,.18));
          color: #86efac;
          font-size: 1.1rem;
          box-shadow: inset 0 1px 0 rgba(255,255,255,.06);
        }
        .schedule-manager-heading { min-width: 0; }
        .schedule-manager-eyebrow {
          margin: 0 0 .2rem;
          color: #6ee7b7;
          font-size: .64rem;
          font-weight: 800;
          letter-spacing: .15em;
          text-transform: uppercase;
        }
        .schedule-manager-heading .schedule-manager-title {
          margin: 0;
          color: #f0fdf4;
          font-size: clamp(1.2rem, 2vw, 1.55rem);
          font-weight: 800;
          letter-spacing: -.035em;
          line-height: 1.15;
        }
        .schedule-manager-description {
          margin: .25rem 0 0;
          color: #a8c8b5;
          font-size: .8rem;
          line-height: 1.45;
        }
        .schedule-manager-hours {
          display: inline-flex;
          align-items: center;
          gap: .45rem;
          margin-left: auto;
          padding: .55rem .75rem;
          border: 1px solid rgba(110,231,183,.14);
          border-radius: 999px;
          background: rgba(2,18,11,.38);
          color: #b8d9c5;
          font-size: .72rem;
          font-weight: 700;
          white-space: nowrap;
        }
        .schedule-manager-hours i { color: #6ee7b7; }
        .schedule-manager-header {
          display: flex;
          align-items: center;
          justify-content: flex-end;
          gap: 0.9rem;
          margin-bottom: 0.9rem;
        }
        .schedule-manager-title {
          margin: 0;
          color: #f8fafc;
          font-size: 1.15rem;
          font-weight: 700;
          letter-spacing: -0.02em;
        }
        .schedule-manager-button {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 0.5rem;
          padding: 0.7rem 0.95rem;
          border-radius: 0.95rem;
          border: 1px solid rgba(74,222,128,.2);
          background: linear-gradient(180deg, rgba(22,163,74,.95), rgba(21,128,61,.95));
          color: #f8fafc;
          font-size: 0.82rem;
          font-weight: 700;
          box-shadow: 0 8px 18px rgba(34,197,94,.14);
        }
        .schedule-toolbar {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: .7rem;
          margin-bottom: 0.95rem;
          padding: .8rem;
          border: 1px solid rgba(110,231,183,.12);
          border-radius: 1rem;
          background: rgba(2,16,10,.38);
        }
        .schedule-filter-group {
          display: flex;
          align-items: center;
          gap: .55rem;
          min-width: 0;
          color: #a7f3d0;
          font-size: .66rem;
          font-weight: 700;
          letter-spacing: .08em;
          text-transform: uppercase;
        }
        .schedule-instructor-filter {
          display: flex;
          flex: 0 1 auto;
          min-width: 0;
        }
        .schedule-lab-filters {
          display: flex;
          flex-wrap: nowrap;
          flex: 0 0 auto;
          gap: .35rem;
          padding: .22rem;
          border: 1px solid rgba(110,231,183,.12);
          border-radius: .85rem;
          background: rgba(1,12,8,.54);
        }
        .schedule-lab-filter {
          min-height: 2.15rem;
          padding: .42rem .72rem;
          border: 1px solid transparent;
          border-radius: .65rem;
          background: transparent;
          color: #a9c5b4;
          font-size: .72rem;
          font-weight: 700;
          white-space: nowrap;
          transition: color 140ms ease, background-color 140ms ease, border-color 140ms ease;
        }
        .schedule-lab-filter:hover,
        .schedule-lab-filter.is-active {
          border-color: rgba(110,231,183,.22);
          background: linear-gradient(180deg, rgba(22,101,61,.56), rgba(13,66,41,.5));
          color: #d1fae5;
          box-shadow: inset 0 1px 0 rgba(255,255,255,.06);
        }
        .schedule-count {
          flex: 0 0 auto;
          margin-left: auto;
          color: #a7f3d0;
          font-size: .7rem;
          font-weight: 600;
          white-space: nowrap;
        }
        .schedule-calendar-scroll {
          overflow-x: auto;
          overflow-y: hidden;
          border: 1px solid rgba(110,231,183,.18);
          border-radius: 1.1rem;
          background: rgba(2,12,8,.5);
          box-shadow: inset 0 1px 0 rgba(255,255,255,.025), 0 12px 28px rgba(0,0,0,.12);
          scrollbar-color: rgba(34,197,94,.45) rgba(2,6,23,.45);
        }
        .schedule-calendar {
          min-width: 930px;
        }
        .schedule-calendar-header,
        .schedule-calendar-body {
          display: grid;
          grid-template-columns: 126px repeat(5, minmax(160px, 1fr));
        }
        .schedule-calendar-header {
          position: sticky;
          top: 0;
          z-index: 5;
          background: linear-gradient(180deg, #10271b, #0b1d14);
          border-bottom: 1px solid rgba(110,231,183,.2);
          box-shadow: 0 5px 12px rgba(0,0,0,.1);
        }
        .schedule-calendar-day-heading {
          padding: .85rem .35rem;
          border-left: 1px solid rgba(110,231,183,.1);
          color: #d8f7e4;
          text-align: center;
          font-size: .72rem;
          font-weight: 800;
          letter-spacing: .1em;
          text-transform: uppercase;
        }
        .schedule-calendar-day-heading.is-today {
          background: rgba(34,197,94,.13);
          color: #86efac;
          box-shadow: inset 0 -2px #34d399;
        }
        .schedule-calendar-body {
          position: relative;
          grid-auto-rows: 40px;
          min-height: 800px;
        }
        .schedule-calendar-time {
          display: flex;
          align-items: center;
          justify-content: flex-end;
          padding: 0 .65rem 0 0;
          border-top: 1px solid rgba(110,231,183,.09);
          background: rgba(11,29,20,.36);
          color: #b8d9c5;
          font-size: .7rem;
          font-weight: 700;
          white-space: nowrap;
        }
        .schedule-day-column {
          position: relative;
          display: grid;
          grid-row: 1 / -1;
          border-left: 1px solid rgba(110,231,183,.1);
          background-color: rgba(14,38,26,.15);
          background-image: repeating-linear-gradient(
            to bottom,
            transparent 0,
            transparent calc(var(--schedule-row-height, 40px) - 1px),
            rgba(110,231,183,.105) calc(var(--schedule-row-height, 40px) - 1px),
            rgba(110,231,183,.105) var(--schedule-row-height, 40px)
          );
        }
        .schedule-day-column:nth-of-type(even) { background-color: rgba(20,49,34,.19); }
        .schedule-day-column.is-today {
          background-color: rgba(34,197,94,.045);
          box-shadow: inset 1px 0 rgba(52,211,153,.16), inset -1px 0 rgba(52,211,153,.16);
        }
        .schedule-event {
          position: absolute;
          z-index: 2;
          overflow: hidden;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: .2rem;
          padding: .38rem .45rem;
          border: 1px solid rgba(255,255,255,.48);
          border-radius: .8rem;
          background-image: linear-gradient(145deg, rgba(255,255,255,.12), transparent 58%), linear-gradient(0deg, rgba(0,0,0,.07), rgba(0,0,0,.07));
          cursor: pointer;
          text-align: center;
          box-shadow: 0 7px 18px rgba(0,0,0,.3), inset 0 1px 0 rgba(255,255,255,.14);
          box-sizing: border-box;
        }
        .schedule-event--hardcoded {
          position: relative;
          min-width: 0;
          min-height: 0;
          margin: 1px 2px;
          cursor: default;
        }
        .schedule-event:hover,
        .schedule-event:focus-visible {
          z-index: 4;
          filter: brightness(1.08);
          outline: 2px solid #f0fdf4;
          outline-offset: 1px;
        }
        .schedule-event-subject,
        .schedule-event-instructor,
        .schedule-event-time {
          display: block;
          overflow: hidden;
          margin-top: 0;
          font-size: .78rem;
          font-weight: 650;
          line-height: 1.12;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .schedule-event-subject {
          font-size: .98rem;
          font-weight: 850;
          letter-spacing: -.02em;
          white-space: normal;
          overflow-wrap: anywhere;
          display: -webkit-box;
          -webkit-box-orient: vertical;
          -webkit-line-clamp: 2;
        }
        .schedule-event--compact .schedule-event-subject {
          font-size: .86rem;
          -webkit-line-clamp: 1;
        }
        .schedule-event-meta {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: .1rem;
          min-width: 0;
        }
        .schedule-event-meta > span {
          width: 100%;
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .schedule-event-time {
          font-size: .72rem !important;
          font-weight: 800 !important;
        }
        .schedule-event-cohort {
          display: block;
          max-width: 100%;
          overflow: hidden;
          font-size: .68rem;
          font-weight: 800;
          line-height: 1rem;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .schedule-event--compact .schedule-event-cohort {
          font-size: .62rem;
          line-height: .8rem;
        }
        .schedule-event-instructor {
          font-size: .88rem !important;
          font-style: normal;
          font-weight: 700 !important;
        }
        .schedule-event-location {
          font-size: .68rem;
          line-height: 1.1;
          white-space: normal;
          overflow-wrap: anywhere;
        }
        .schedule-context-menu {
          position: fixed;
          z-index: 12000;
          display: none;
          min-width: 190px;
          padding: .4rem;
          border: 1px solid rgba(110,231,183,.34);
          border-radius: .9rem;
          background: rgba(7,20,14,.98);
          box-shadow: 0 18px 48px rgba(0,0,0,.58);
          backdrop-filter: blur(14px);
        }
        .schedule-context-menu.is-open {
          display: grid;
          gap: .2rem;
        }
        .schedule-context-action {
          display: flex;
          align-items: center;
          gap: .65rem;
          width: 100%;
          min-height: 2.55rem;
          padding: .55rem .7rem;
          border: 0;
          border-radius: .55rem;
          background: transparent;
          color: #ecfdf5;
          font-size: .9rem;
          font-weight: 700;
          text-align: left;
          cursor: pointer;
        }
        .schedule-context-action:hover,
        .schedule-context-action:focus-visible {
          outline: none;
          background: rgba(16,185,129,.2);
        }
        .schedule-context-action--danger {
          color: #fecaca;
        }
        .schedule-context-action--danger:hover,
        .schedule-context-action--danger:focus-visible {
          background: rgba(239,68,68,.18);
        }
        .schedule-context-action[hidden] {
          display: none;
        }
        .schedule-toolbar .schedule-manager-button {
          flex: 0 0 auto;
          min-height: 2.25rem;
          margin-left: 0;
          padding: .45rem .72rem;
          white-space: nowrap;
        }
        .schedule-filter {
          width: 10.5rem;
          min-width: 0;
          height: 2.25rem;
          font-size: .75rem;
        }
        @media (max-width: 1180px) and (min-width: 768px) {
          .schedule-toolbar {
            gap: .38rem;
          }
          .schedule-filter {
            width: 9rem;
          }
          .schedule-lab-filter {
            padding-right: .48rem;
            padding-left: .48rem;
            font-size: .66rem;
          }
        }
        .schedule-calendar-empty {
          grid-column: 2 / -1;
          align-self: center;
          padding: .75rem;
          color: #94a3b8;
          font-size: .85rem;
          text-align: center;
        }
        .schedule-search-wrap {
          position: relative;
          flex: 1 1 220px;
          min-width: 180px;
        }
        .schedule-search-wrap i {
          position: absolute;
          left: 0.85rem;
          top: 50%;
          transform: translateY(-50%);
          color: #bbf7d0;
          font-size: 0.8rem;
        }
        .schedule-filter,
        .schedule-search {
          height: 2.6rem;
          border-radius: 0.9rem;
          border: 1px solid rgba(74,222,128,.18);
          background: rgba(11, 26, 19, 0.72);
          color: #f8fafc;
          font-size: 0.82rem;
          padding: 0 0.9rem;
          box-shadow: inset 0 1px 0 rgba(255,255,255,.02);
        }
        .schedule-search {
          width: 100%;
          padding-left: 2.2rem;
        }
        .schedule-filter {
          min-width: 130px;
        }
        .schedule-color-control {
          display: flex;
          align-items: center;
          gap: .8rem;
          min-height: 3rem;
          padding: .45rem .7rem;
          border: 1px solid rgba(74,222,128,.22);
          border-radius: .9rem;
          background: rgba(11,26,19,.72);
        }
        .schedule-color-control input[type="color"] {
          width: 2.5rem;
          height: 2.2rem;
          padding: .15rem;
          border: 1px solid rgba(255,255,255,.35);
          border-radius: .6rem;
          background: transparent;
          cursor: pointer;
        }
        .schedule-color-value {
          min-width: 5.25rem;
          padding: .35rem .55rem;
          border: 1px solid rgba(255,255,255,.25);
          border-radius: .55rem;
          font-size: .82rem;
          font-weight: 700;
          letter-spacing: .04em;
          text-align: center;
        }
        .schedule-table-wrap {
          overflow-x: auto;
          border: 1px solid rgba(71, 85, 105, 0.7);
          border-radius: 1rem;
          background: rgba(2, 6, 23, 0.4);
          scrollbar-color: rgba(34,197,94,.45) rgba(2,6,23,.45);
        }
        .schedule-table {
          width: 100%;
          border-collapse: collapse;
          min-width: 980px;
        }
        .schedule-table thead {
          background: rgba(15, 23, 42, 0.7);
        }
        .schedule-table th,
        .schedule-table td {
          padding: 0.8rem 0.9rem;
          border-bottom: 1px solid rgba(74,222,128,.09);
          vertical-align: top;
          text-align: left;
        }
        .schedule-table th {
          color: #cbd5e1;
          font-size: 0.7rem;
          font-weight: 700;
          letter-spacing: 0.12em;
          text-transform: uppercase;
        }
        .schedule-table td {
          color: #e2e8f0;
          font-size: 0.82rem;
          line-height: 1.5;
        }
        .schedule-table th:nth-child(1),
        .schedule-table th:nth-child(3),
        .schedule-table th:nth-child(6),
        .schedule-table th:nth-child(7),
        .schedule-table th:nth-child(8),
        .schedule-table td:nth-child(1),
        .schedule-table td:nth-child(3),
        .schedule-table td:nth-child(6),
        .schedule-table td:nth-child(7),
        .schedule-table td:nth-child(8) {
          white-space: nowrap;
        }
        .schedule-table tbody tr {
          transition: background-color 150ms ease;
        }
        .schedule-table tbody tr:hover {
          background: rgba(2,40,20,.3);
        }
        .schedule-table .schedule-row-subject {
          font-weight: 700;
          color: #f8fafc;
        }
        .schedule-row-meta {
          color: #a7f3d0;
          display: inline-flex;
          align-items: center;
          gap: 0.35rem;
          font-size: 0.72rem;
          font-weight: 600;
        }
        .schedule-action-group {
          display: flex;
          align-items: center;
          gap: 0.4rem;
          flex-wrap: wrap;
        }
        .schedule-action-button {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          min-width: 2.1rem;
          height: 2.1rem;
          border-radius: 0.7rem;
          border: 1px solid rgba(74,222,128,.18);
          background: rgba(10, 20, 16, 0.82);
          color: #d1fae5;
          transition: all 150ms ease;
        }
        .schedule-action-button:hover {
          background: rgba(34,197,94,.12);
          border-color: rgba(74,222,128,.34);
        }
        .schedule-action-button--danger {
          border-color: rgba(248,113,113,.22);
          color: #fecaca;
        }
        .schedule-action-button--danger:hover {
          background: rgba(239,68,68,.12);
          border-color: rgba(248,113,113,.32);
        }
        .schedule-details-actions {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: .65rem;
        }
        .schedule-details-button {
          display: inline-flex;
          min-height: 2.75rem;
          align-items: center;
          justify-content: center;
          gap: .5rem;
          padding: .65rem .8rem;
          border: 1px solid rgba(74,222,128,.28);
          border-radius: .8rem;
          background: rgba(16,87,55,.24);
          color: #d1fae5;
          font-size: .82rem;
          font-weight: 700;
          white-space: nowrap;
          transition: background-color 150ms ease, border-color 150ms ease, transform 150ms ease;
        }
        .schedule-details-button:hover {
          transform: translateY(-1px);
          border-color: rgba(74,222,128,.55);
          background: rgba(16,87,55,.48);
        }
        .schedule-details-button:focus-visible {
          outline: 2px solid #4ade80;
          outline-offset: 2px;
        }
        .schedule-details-button--primary {
          border-color: rgba(74,222,128,.52);
          background: linear-gradient(180deg, rgba(22,163,74,.85), rgba(21,128,61,.85));
          color: #fff;
        }
        .schedule-details-button--primary:hover {
          background: linear-gradient(180deg, rgba(34,197,94,.95), rgba(22,163,74,.95));
        }
        #schedulePagination {
          margin-top: 0.75rem;
          gap: 0.45rem;
          padding-top: 0.1rem;
          justify-content: flex-end;
        }
        #scheduleModal .w-full,
        #qrModal .w-full,
        #scheduleModal .rounded-3xl,
        #qrModal .rounded-3xl {
          background: linear-gradient(180deg, rgba(13,23,18,.98), rgba(10,18,14,.96)) !important;
          border: 1px solid rgba(74,222,128,.24) !important;
          box-shadow: 0 16px 40px rgba(6,64,43,.22) !important;
        }
        #scheduleModal input,
        #scheduleModal select,
        #scheduleModal textarea,
        #qrModal input,
        #qrModal select,
        #qrModal textarea {
          background: rgba(6,14,10,.94) !important;
          border: 1px solid rgba(74,222,128,.28) !important;
          color: #f8fafc !important;
        }
        #scheduleModal input::placeholder,
        #scheduleModal textarea::placeholder {
          color: #86efac !important;
        }
        @media (max-width: 767px) {
          .schedule-manager-intro { align-items: flex-start; }
          .schedule-manager-icon { width: 2.65rem; height: 2.65rem; border-radius: .85rem; }
          .schedule-manager-hours { display: none; }
          .schedule-manager-description { max-width: 32rem; }
          .schedule-toolbar { align-items: stretch; }
          .schedule-manager-header {
            align-items: flex-start;
            flex-direction: column;
          }
          .schedule-toolbar {
            flex-direction: column;
            align-items: stretch;
          }
          .schedule-search-wrap,
          .schedule-filter {
            width: 100%;
          }
          .schedule-filter-group {
            width: 100%;
          }
          .schedule-toolbar .schedule-manager-button {
            width: 100%;
            margin-left: 0;
          }
          .schedule-instructor-filter,
          .schedule-lab-filters { width: 100%; }
          .schedule-instructor-filter .schedule-filter-group { align-items: stretch; flex-direction: column; gap: .35rem; }
          .schedule-lab-filters > * { flex: 1 1 0; }
          .schedule-lab-filter { padding-right: .45rem; padding-left: .45rem; font-size: .66rem; }
          .schedule-count {
            width: 100%;
            margin-left: 0;
          }
        }
        .page-content .schedule-manager-card {
          padding: clamp(1rem, 2vw, 1.5rem) !important;
          border: 1px solid rgba(110,231,183,.2) !important;
          background:
            radial-gradient(ellipse at 0% 0%, rgba(34,197,94,.09), transparent 35%),
            linear-gradient(155deg, rgba(12,34,24,.98), rgba(6,20,14,.98)) !important;
          box-shadow: inset 0 1px 0 rgba(255,255,255,.045), 0 20px 50px rgba(0,0,0,.18) !important;
        }
        .page-content .schedule-manager-card:hover {
          transform: none;
          border-color: rgba(110,231,183,.25) !important;
        }
      </style>
      <section class="schedule-manager-card card">
        <header class="schedule-manager-intro">
          <span class="schedule-manager-icon" aria-hidden="true"><i class="fas fa-calendar-week"></i></span>
          <div class="schedule-manager-heading">
            <p class="schedule-manager-eyebrow">Academic planning</p>
            <h2 class="schedule-manager-title">Weekly laboratory schedule</h2>
            <p class="schedule-manager-description">Monitor class schedules, filter the weekly timetable, and inspect laboratory availability.</p>
          </div>
          <span class="schedule-manager-hours"><i class="fas fa-clock" aria-hidden="true"></i> Monday–Friday <span aria-hidden="true">·</span> 7:30 AM–5:30 PM</span>
        </header>
        <div class="schedule-toolbar">
          <div class="schedule-instructor-filter">
            <label class="schedule-filter-group">
              <span>Instructor</span>
              <select id="scheduleFilterInstructor" class="schedule-filter">
                <option value="">All Instructors</option>
              </select>
            </label>
          </div>
          <div class="schedule-lab-filters" role="group" aria-label="Filter by laboratory">
            <button type="button" class="schedule-lab-filter is-active" data-lab-filter="1" aria-pressed="true">COMLAB 1</button>
            <button type="button" class="schedule-lab-filter" data-lab-filter="2" aria-pressed="false">COMLAB 2</button>
          </div>
          <span id="scheduleCount" class="schedule-count" aria-live="polite">Loading schedules…</span>
        </div>

        <div class="schedule-calendar-scroll">
          <div id="scheduleCalendar" class="schedule-calendar" aria-label="Weekly laboratory schedule"></div>
        </div>
      </section>

      <div id="scheduleContextMenu" class="schedule-context-menu" role="menu" aria-label="Schedule actions" aria-hidden="true">
        <button type="button" class="schedule-context-action" data-schedule-action="view" role="menuitem"><i class="fas fa-eye"></i> View details</button>
      </div>

      <div id="scheduleDetailsModal" class="hidden fixed inset-0 z-[9999] items-center justify-center bg-black/80 backdrop-blur-sm px-4 py-6" role="dialog" aria-modal="true" aria-labelledby="scheduleDetailsTitle">
        <section class="w-full max-w-lg rounded-3xl border border-emerald-400/20 bg-[#0d1712] p-5 shadow-2xl">
          <div class="flex items-start justify-between gap-4">
            <div>
              <p id="scheduleDetailsLab" class="text-xs font-bold uppercase tracking-[.18em] text-emerald-300"></p>
              <h3 id="scheduleDetailsTitle" class="mt-1 text-xl font-bold text-white"></h3>
            </div>
            <button type="button" onclick="window.closeScheduleDetails && window.closeScheduleDetails()" class="rounded-lg px-2 text-xl text-slate-400 hover:text-white" aria-label="Close details">&times;</button>
          </div>
          <dl id="scheduleDetailsList" class="mt-5 grid gap-3 text-sm"></dl>
          <div class="schedule-details-actions mt-6 border-t border-white/10 pt-4">
            <button id="scheduleDetailsSeatingButton" type="button" class="schedule-details-button"><i class="fas fa-chair" aria-hidden="true"></i> Seating</button>
            <button id="scheduleDetailsQrButton" type="button" class="schedule-details-button schedule-details-button--primary"><i class="fas fa-qrcode" aria-hidden="true"></i> Attendance QR</button>
            <button type="button" onclick="window.closeScheduleDetails && window.closeScheduleDetails()" class="schedule-details-button"><i class="fas fa-xmark" aria-hidden="true"></i> Close</button>
          </div>
        </section>
      </div>

      <div id="scheduleModal" class="hidden fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 backdrop-blur-sm px-4 py-6 overflow-hidden">
        <div class="modal-content mx-auto w-full max-w-2xl rounded-3xl border-2 border-emerald-800/60 bg-[#0d1712] p-6 shadow-2xl overflow-hidden max-h-[85vh] flex flex-col">
          <div class="flex items-start justify-between gap-4 mb-6">
            <div>
              <h3 id="scheduleModalTitle" class="text-2xl font-semibold text-white">Add Lab Schedule</h3>
              <p id="scheduleModalSubtitle" class="text-sm text-gray-400">Create a weekly schedule and assign it to a weekday.</p>
            </div>
            <button id="closeScheduleModalBtn" type="button" onclick="window.closeScheduleModal && window.closeScheduleModal()" class="text-gray-400 hover:text-white text-2xl">
              <i class="fas fa-times"></i>
            </button>
          </div>
          <form id="scheduleForm" class="flex flex-col flex-1 min-h-0" onsubmit="handleScheduleSubmit(event)" enctype="multipart/form-data">
            <div class="modal-body overflow-y-auto flex-1 min-h-0 space-y-4 pr-1">
              <div class="grid gap-4 md:grid-cols-2">
                <div>
                  <label class="block text-sm font-medium text-gray-300 mb-2">Weekly day</label>
                  <select id="scheduleDay" class="w-full rounded-2xl border border-slate-700 bg-slate-900/80 px-4 py-3 text-white focus:border-green-500 focus:outline-none" required>
                    <option value="Monday">Monday</option>
                    <option value="Tuesday">Tuesday</option>
                    <option value="Wednesday">Wednesday</option>
                    <option value="Thursday">Thursday</option>
                    <option value="Friday">Friday</option>
                    <option value="Saturday">Saturday</option>
                    <option value="Sunday">Sunday</option>
                  </select>
                </div>
                <div>
                  <label class="block text-sm font-medium text-gray-300 mb-2">Laboratory</label>
                  <select id="scheduleRoom" class="w-full rounded-2xl border border-slate-700 bg-slate-900/80 px-4 py-3 text-white focus:border-green-500 focus:outline-none" required>
                    <option value="">Select Laboratory</option>
                    <option value="Laboratory 1 — Room 202">COMLAB 1 — Room 202</option>
                    <option value="Laboratory 2 — Room 204">COMLAB 2 — Room 204</option>
                  </select>
                </div>
              </div>
              <div class="grid gap-4 md:grid-cols-2">
                <div>
                  <label class="block text-sm font-medium text-gray-300 mb-2">Subject / Course</label>
                  <input id="scheduleTitle" type="text" placeholder="e.g., Circuit Design" class="w-full rounded-2xl border border-slate-700 bg-slate-900/80 px-4 py-3 text-white focus:border-green-500 focus:outline-none" required />
                </div>
                <div>
                  <label class="block text-sm font-medium text-gray-300 mb-2">Instructor</label>
                  <select id="scheduleInstructorId" required class="w-full rounded-2xl border border-slate-700 bg-slate-900/80 px-4 py-3 text-white focus:border-green-500 focus:outline-none">
                    <option value="">Select Faculty</option>
                  </select>
                </div>
                <div>
                  <label for="scheduleYearLevel" class="block text-sm font-medium text-gray-300 mb-2">Year level</label>
                  <select id="scheduleYearLevel" required class="w-full rounded-2xl border border-slate-700 bg-slate-900/80 px-4 py-3 text-white focus:border-green-500 focus:outline-none">
                    <option value="">Select Year Level</option>
                    <option value="1st Year">1st Year</option>
                    <option value="2nd Year">2nd Year</option>
                    <option value="3rd Year">3rd Year</option>
                    <option value="4th Year">4th Year</option>
                  </select>
                </div>
                <div>
                  <label for="scheduleSection" class="block text-sm font-medium text-gray-300 mb-2">Section</label>
                  <select id="scheduleSection" required class="w-full rounded-2xl border border-slate-700 bg-slate-900/80 px-4 py-3 text-white focus:border-green-500 focus:outline-none">
                    <option value="">Select Section</option>
                    <option value="F1">F1</option>
                    <option value="F2">F2</option>
                    <option value="F3">F3</option>
                  </select>
                  <p class="mt-1 text-xs text-slate-400">Example class: 4th Year · F1</p>
                </div>
                <div>
                  <label class="block text-sm font-medium text-gray-300 mb-2">Campus</label>
                  <input id="scheduleCampus" type="text" readonly required aria-readonly="true" placeholder="Uses instructor or Supply Office campus" class="w-full rounded-2xl border border-slate-700 bg-slate-900/80 px-4 py-3 text-white focus:border-green-500 focus:outline-none" />
                </div>
                <div>
                  <label for="scheduleColor" class="block text-sm font-medium text-gray-300 mb-2">Schedule color</label>
                  <div class="schedule-color-control">
                    <input id="scheduleColor" type="color" value="#16a34a" aria-label="Choose schedule color" />
                    <output id="scheduleColorValue" class="schedule-color-value" for="scheduleColor">#16A34A</output>
                    <span class="text-xs text-slate-300">Used on the weekly schedule map</span>
                  </div>
                </div>
              </div>
              <div class="grid gap-4 md:grid-cols-2">
                <div>
                  <label class="block text-sm font-medium text-gray-300 mb-2">Start Time</label>
                  <select id="scheduleStartTime" class="w-full rounded-2xl border border-slate-700 bg-slate-900/80 px-4 py-3 text-white focus:border-green-500 focus:outline-none" required>
                    <option value="">Select Start Time</option>
                  </select>
                </div>
                <div>
                  <label class="block text-sm font-medium text-gray-300 mb-2">End Time</label>
                  <select id="scheduleEndTime" class="w-full rounded-2xl border border-slate-700 bg-slate-900/80 px-4 py-3 text-white focus:border-green-500 focus:outline-none" required>
                    <option value="">Select End Time</option>
                  </select>
                </div>
              </div>
              <div class="rounded-3xl border border-emerald-500/30 bg-emerald-500/10 p-4 shadow-[0_0_0_1px_rgba(16,185,129,0.08)] backdrop-blur-sm">
                <div class="flex items-start gap-3">
                  <div class="mt-1 flex h-10 w-10 items-center justify-center rounded-2xl bg-emerald-500/20 text-emerald-200">
                    <i class="fas fa-file-upload"></i>
                  </div>
                  <div class="flex-1">
                    <h4 class="text-lg font-semibold text-white">Student Class List <span class="text-sm text-slate-400">(Optional)</span></h4>
                    <p class="mt-1 text-sm text-emerald-100/80">Upload the official class list for this laboratory schedule. You can add this later if needed.</p>
                    <p class="mt-2 text-sm text-slate-300">Accepted file formats: .xlsx, .xls, .csv</p>
                    <p class="mt-2 text-xs text-slate-400">Columns: Last Name, First Name, Middle Initial. Course, Year, and Section are supported when available.</p>
                    <label class="mt-4 inline-flex cursor-pointer items-center gap-2 rounded-2xl border border-emerald-500/40 bg-slate-950/60 px-4 py-3 text-sm font-semibold text-emerald-200 hover:bg-slate-900">
                      <i class="fas fa-cloud-upload-alt"></i>
                      <span>Choose File</span>
                      <input id="scheduleClassListFile" type="file" accept=".csv,.xlsx,.xls" onchange="window.handleClassListFileChange && window.handleClassListFileChange(this.files)" class="hidden" />
                    </label>
                    <div id="scheduleClassListStatus" class="mt-4 rounded-2xl border border-slate-700/70 bg-slate-950/50 p-3 text-sm text-slate-300">
                      <div id="scheduleClassListMessage" class="text-slate-400">No class list selected.</div>
                      <div id="scheduleClassListMeta" class="mt-2 flex flex-wrap items-center gap-3 text-xs text-slate-400"></div>
                    </div>
                    <div id="scheduleClassListValidation" class="mt-3 hidden rounded-2xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
                      Please upload the official class list (optional - can be added later).
                    </div>
                  </div>
                </div>
              </div>
              <label class="flex items-center gap-3 text-sm text-gray-300">
                <input id="scheduleQrEnabled" type="checkbox" class="h-4 w-4 rounded border-slate-700 bg-slate-900 text-green-600 focus:ring-green-500" />
                Enable attendance QR
              </label>
            </div>
            <div class="modal-footer flex flex-col sm:flex-row gap-3 pt-3 border-t border-emerald-800/20 mt-3">
              <button type="button" onclick="closeScheduleModal && closeScheduleModal()" class="flex-1 rounded-2xl border border-slate-700 bg-transparent px-4 py-3 text-slate-300 hover:bg-slate-800">Cancel</button>
              <button type="submit" id="scheduleSubmitButton" class="flex-1 rounded-2xl bg-green-600 px-4 py-3 text-white hover:bg-green-700">Save Schedule</button>
            </div>
          </form>
        </div>
      </div>

      <div id="qrModal" class="hidden fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 backdrop-blur-sm px-4 py-6 overflow-hidden">
        <div class="modal-content mx-auto w-full max-w-2xl rounded-3xl border-2 border-emerald-800/60 bg-[#0d1712] p-6 shadow-2xl overflow-y-auto max-h-[85vh]">
            <div class="flex items-start justify-between gap-4 mb-4">
              <div>
                <h3 class="text-2xl font-semibold text-white">Attendance QR</h3>
                <p id="qrModalSubtitle" class="text-sm text-gray-400">Generate a one-time QR for this lab session.</p>
              </div>
              <button onclick="closeQrModal()" class="text-gray-400 hover:text-white text-2xl">
                <i class="fas fa-times"></i>
              </button>
            </div>
            <div class="space-y-4">
              <div class="grid gap-3 md:grid-cols-[1fr_auto]">
                <div>
                  <label class="block text-sm font-medium text-gray-300 mb-2">QR Expiration</label>
                  <select id="qrExpirySelect" class="w-full rounded-2xl border border-slate-700 bg-slate-900/80 px-4 py-3 text-white focus:border-green-500 focus:outline-none">
                    <option value="10">10 minutes</option>
                    <option value="15" selected>15 minutes</option>
                    <option value="20">20 minutes</option>
                    <option value="30">30 minutes</option>
                  </select>
                </div>
                <div class="flex items-end">
                  <button id="generateQrButton" type="button" onclick="event.preventDefault(); generateCurrentQr();" class="w-full rounded-2xl bg-green-600 px-4 py-3 text-white hover:bg-green-700">Generate QR</button>
                </div>
              </div>
                <div class="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
                <div id="qrPreview" class="flex min-h-[180px] items-center justify-center rounded-2xl border border-dashed border-slate-700 bg-slate-950/70 p-4 text-sm text-gray-400">No QR generated yet.</div>
                <div class="mt-4 flex flex-wrap gap-3">
                  <button id="downloadQrButton" type="button" onclick="downloadCurrentQr()" class="rounded-2xl border border-slate-700 bg-transparent px-3 py-2 text-sm text-slate-300 hover:bg-slate-800">Download QR</button>
                  <button id="printQrButton" type="button" onclick="printCurrentQr()" class="rounded-2xl border border-slate-700 bg-transparent px-3 py-2 text-sm text-slate-300 hover:bg-slate-800">Print QR</button>
                  <button id="regenerateQrButton" type="button" onclick="regenerateCurrentQr()" class="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm font-semibold text-emerald-200 hover:bg-emerald-500/20">Regenerate QR</button>
                </div>
                <div class="mt-4 flex items-center justify-between gap-3 rounded-2xl border border-slate-800 bg-slate-950/70 px-3 py-2 text-sm text-gray-300">
                  <span>Class Status</span>
                  <span id="classStatusBadge" class="rounded-full bg-sky-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-sky-200">Upcoming</span>
                </div>
                <div id="qrStatusRow" class="mt-4 flex items-center justify-between gap-3 rounded-2xl border border-slate-800 bg-slate-950/70 px-3 py-2 text-sm text-gray-300">
                  <span>QR Status</span>
                  <span id="qrStatusBadge" class="rounded-full bg-slate-600/70 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-slate-200">Expired</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <style>
          #scheduleModal.show,
          #qrModal.show,
          #attendanceSessionModal.show,
          #userModal.show {
              display: flex !important;
              align-items: center !important;
              justify-content: center !important;
              overflow: auto !important;
          }
          @media (max-width: 768px) {
            #scheduleModal.show,
            #qrModal.show,
            #attendanceSessionModal.show,
            #userModal.show {
              align-items: flex-start !important;
              padding-top: 1.5rem !important;
              padding-bottom: 1.5rem !important;
            }
          }
          /* Ensure modal content is a column and inner content scrolls while footer/action row stays visible */
          #scheduleModal .modal-content,
          #qrModal .modal-content,
          #attendanceSessionModal .modal-content,
          #userModal .modal-content {
              display: flex !important;
              flex-direction: column !important;
          }
          #scheduleModal .modal-content > .space-y-4,
          #qrModal .modal-content > .space-y-4,
          #attendanceSessionModal .modal-content > .space-y-4,
          #userModal .modal-content > .space-y-4 {
              overflow: auto !important;
              flex: 1 1 auto !important;
              padding-right: 0.5rem !important;
          }
          /* Pin the QR action buttons/footer to bottom of modal when scrolling */
          #qrModal .qr-actions,
          #scheduleModal .modal-footer,
          #attendanceSessionModal .modal-footer {
              position: sticky !important;
              bottom: 0 !important;
              background: linear-gradient(180deg, rgba(13,23,18,.98), rgba(10,18,14,.96)) !important;
              padding-top: 0.6rem !important;
              padding-bottom: 0.6rem !important;
              z-index: 20 !important;
          }
        #scheduleModal.hidden,
        #qrModal.hidden,
        #attendanceSessionModal.hidden,
        #userModal.hidden {
            display: none;
        }
        .modal-content {
            width: min(100%, 46rem);
            max-width: 46rem;
            max-height: 85vh;
            overflow: hidden;
            background: rgba(13,23,18,0.96);
            border: 2px solid rgba(16,185,129,0.35);
            box-shadow: 0 24px 60px rgba(6,64,43,0.35);
        }
        .modal-content[style*="overflow-y-auto"],
        .modal-content .form-inner,
        .modal-content .space-y-4 {
            max-height: 85vh;
            overflow-y: auto;
        }
        .modal-content::-webkit-scrollbar,
        .modal-content .form-inner::-webkit-scrollbar {
            width: 10px;
        }
        .modal-content::-webkit-scrollbar-thumb,
        .modal-content .form-inner::-webkit-scrollbar-thumb {
            background: rgba(16,185,129,0.35);
            border-radius: 999px;
        }
        /* Constrain QR preview images to avoid modal scrolling */
        #qrPreview img,
        #qrPreview canvas,
        #qrPreview svg {
          max-width: 320px !important;
          max-height: 320px !important;
          width: auto !important;
          height: auto !important;
          object-fit: contain !important;
        }
        </style>

        <script src="https://cdn.jsdelivr.net/npm/xlsx@0.18.3/dist/xlsx.full.min.js"></script>
        <script src="/js/comlab1-weekly-schedule.js?v=20261107-1"></script>
        <script src="/js/laboratory-schedules-page.js?v=20261107-comlab1-5"></script>

        <!-- Seating Chart Modal -->
        <div id="seatingChartModal" class="seating-chart-modal hidden fixed inset-0 z-50 items-center justify-center bg-black/70 backdrop-blur-sm">
          <div class="seating-chart-modal__dialog relative w-full max-w-6xl max-h-[90vh] overflow-y-auto bg-gradient-to-br from-slate-900 to-slate-800 rounded-2xl shadow-2xl border border-emerald-500/20 m-4">
            <!-- Modal Header -->
            <div class="sticky top-0 z-10 bg-gradient-to-r from-emerald-900/90 to-teal-900/90 backdrop-blur-sm border-b border-emerald-500/30 px-6 py-4">
              <div class="flex items-start justify-between">
                <div class="flex-1">
                  <h3 id="seatingScheduleSubject" class="text-2xl font-bold text-white mb-1">Lab Session</h3>
                  <div class="flex items-center gap-4 text-sm text-emerald-200">
                    <span id="seatingScheduleTime" class="flex items-center gap-2">
                      <i class="fas fa-clock"></i>
                      <span>Loading...</span>
                    </span>
                    <span id="seatingScheduleRoom" class="flex items-center gap-2">
                      <i class="fas fa-door-open"></i>
                      <span>Loading...</span>
                    </span>
                  </div>
                </div>
                <button onclick="closeSeatingChartModal()" class="text-slate-300 hover:text-white transition-colors">
                  <i class="fas fa-times text-xl"></i>
                </button>
              </div>

              <!-- Statistics Bar -->
              <div class="grid grid-cols-4 gap-3 mt-4">
                <div class="bg-emerald-500/10 border border-emerald-500/30 rounded-lg px-3 py-2">
                  <p class="text-xs text-emerald-300 font-semibold uppercase tracking-wide">Occupied</p>
                  <p id="statOccupiedPCs" class="text-2xl font-bold text-white mt-1">0</p>
                </div>
                <div class="bg-slate-500/10 border border-slate-500/30 rounded-lg px-3 py-2">
                  <p class="text-xs text-slate-300 font-semibold uppercase tracking-wide">Available</p>
                  <p id="statAvailablePCs" class="text-2xl font-bold text-white mt-1">0</p>
                </div>
                <div class="bg-blue-500/10 border border-blue-500/30 rounded-lg px-3 py-2">
                  <p class="text-xs text-blue-300 font-semibold uppercase tracking-wide">Assigned</p>
                  <p id="statAssignedStudents" class="text-2xl font-bold text-white mt-1">0</p>
                </div>
                <div class="bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
                  <p class="text-xs text-red-300 font-semibold uppercase tracking-wide">Unassigned</p>
                  <p id="statUnassignedStudents" class="text-2xl font-bold text-white mt-1">0</p>
                </div>
              </div>
            </div>

            <!-- Modal Body -->
            <div class="p-6">
              <!-- Loading State -->
              <div id="seatingChartLoading" class="flex items-center justify-center py-12">
                <div class="text-center">
                  <i class="fas fa-spinner fa-spin text-4xl text-emerald-400 mb-4"></i>
                  <p class="text-slate-300">Loading seating chart...</p>
                </div>
              </div>

              <!-- Error State -->
              <div id="seatingChartError" class="hidden rounded-xl border border-red-500/30 bg-red-500/10 p-6 text-center">
                <i class="fas fa-exclamation-triangle text-3xl text-red-400 mb-3"></i>
                <p id="seatingChartErrorMessage" class="text-red-200">Failed to load seating chart</p>
              </div>

              <!-- Content -->
              <div id="seatingChartContent" class="hidden space-y-6">
                <!-- PC Seating Grid -->
                <div>
                  <h4 class="text-lg font-bold text-white mb-4 flex items-center gap-2">
                    <i class="fas fa-desktop text-emerald-400"></i>
                    PC Station Assignments
                  </h4>
                  <div id="pcSeatingGrid" class="grid max-h-[52vh] grid-cols-2 gap-3 overflow-y-auto overscroll-contain pr-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
                    <!-- PC seats will be rendered here -->
                  </div>
                </div>

                <!-- Unassigned Students -->
                <div>
                  <h4 class="text-lg font-bold text-white mb-4 flex items-center gap-2">
                    <i class="fas fa-user-slash text-red-400"></i>
                    Students Without PC Assignment
                  </h4>
                  <div id="unassignedStudentsList" class="space-y-2">
                    <!-- Unassigned students will be rendered here -->
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

      </section>
    `
  },
  "audit-logs": {
    title: "Audit Logs",
    description: "Review login and logout activity across all users and campuses.",
    backRoute: "/admin-dashboard",
    backLabel: "Back to Admin Dashboard",
    content: String.raw`
      <style>
        body.app-shell .page-content {
          background:
            radial-gradient(circle at top left, rgba(34,197,94,0.08), transparent 32%),
            linear-gradient(180deg, rgba(4,14,10,0.98), rgba(2,9,6,0.98)) !important;
          border-radius: 24px;
          padding: 1rem;
          box-shadow: inset 0 1px 0 rgba(255,255,255,.03);
        }
        body.app-shell.system-layout-page .main-container,
        body.app-shell.system-layout-page .page-content,
        body.app-shell.system-layout-page .page-content > .table-card,
        body.app-shell.system-layout-page #systemAuditPanel,
        body.app-shell.system-layout-page #equipmentAuditTrailPanel,
        body.app-shell.system-layout-page #loginLogoutAuditPanel {
          height: auto !important;
          max-height: none !important;
          overflow: visible !important;
        }
        .page-hero-card {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 1rem;
          padding: 1.35rem 1.35rem 1.4rem;
          border-radius: 24px;
          border: 1px solid rgba(74,222,128,.16);
          background:
            radial-gradient(circle at top left, rgba(34,197,94,0.09), transparent 36%),
            linear-gradient(180deg, rgba(15,36,27,.96), rgba(10,29,21,.96));
          box-shadow: 0 12px 35px rgba(6,64,43,.18);
          backdrop-filter: blur(16px) saturate(1.04);
          margin-bottom: 1.5rem;
        }
        body.app-shell .main-container.theme-light .audit-page-hero {
          border-color: #d7e3da !important;
          background: #ffffff !important;
          color: #1f2937 !important;
          box-shadow: 0 8px 24px rgba(31, 41, 55, .07) !important;
        }
        body.app-shell .main-container.theme-light .audit-page-hero .page-title {
          color: #1f2937 !important;
        }
        .page-title { font-size: 2rem; font-weight: 800; color: #f8fafc; margin: 0; }
        .audit-filters-shell {
          display: grid;
          grid-template-columns: minmax(150px, 1.35fr) repeat(3, minmax(125px, 1fr)) max-content max-content;
          align-items: end;
          gap: 0.55rem;
          padding: .7rem;
          border-radius: .9rem;
          border: 1px solid rgba(74,222,128,.16);
          background: linear-gradient(180deg, rgba(12,28,20,.96), rgba(8,20,14,.95));
          box-shadow: 0 12px 32px rgba(6,64,43,.16);
        }
        body.app-shell .main-container.theme-light #systemAuditPanel .audit-filters-shell {
          border-color: #a7c9ae !important;
          background: #ffffff !important;
          color: #1f2937 !important;
          box-shadow: 0 6px 20px rgba(31, 41, 55, .07) !important;
        }
        .audit-filters-grid {
          display: grid;
          gap: 0.6rem;
          grid-template-columns: minmax(0, 2.2fr) minmax(180px, 1fr) minmax(160px, 1fr) minmax(140px, 140px) minmax(140px, 140px);
          align-items: center;
        }
        .audit-filter-group {
          display: flex;
          flex-direction: column;
          gap: 0.25rem;
          min-width: 0;
        }
        .audit-filter-label {
          font-size: 0.72rem;
          font-weight: 700;
          letter-spacing: 0.2em;
          text-transform: uppercase;
          color: rgba(167,243,208,.8);
        }
        body.app-shell .main-container.theme-light #systemAuditPanel .audit-filter-label {
          color: #1f2937 !important;
        }
        .audit-filter-field {
          width: 100%;
          border-radius: 0.95rem;
          border: 1px solid rgba(74,222,128,.16);
          background: rgba(8,20,14,.92);
          color: #e2e8f0;
          padding: 0.55rem 0.75rem;
          min-height: 2.35rem;
        }
        body.app-shell .main-container.theme-light #systemAuditPanel .audit-filter-field {
          border-color: #a7c9ae !important;
          background: #ffffff !important;
          color: #1f2937 !important;
          box-shadow: inset 0 1px 2px rgba(31, 41, 55, .04) !important;
        }
        body.app-shell .main-container.theme-light #systemAuditPanel .audit-filter-field::placeholder {
          color: #64748b !important;
        }
        body.app-shell .main-container.theme-light #systemAuditPanel .audit-filter-field:focus {
          border-color: #4b8b5b !important;
          box-shadow: 0 0 0 3px rgba(34, 110, 61, .12) !important;
        }
        .audit-filter-field::placeholder { color: rgba(148,163,184,.72); }
        .audit-filter-field:focus {
          outline: none;
          border-color: rgba(74,222,128,.42);
          box-shadow: 0 0 0 3px rgba(16,185,129,.12);
        }
        .audit-filter-btn {
          width: 100%;
          min-height: 2.35rem;
          border-radius: 0.95rem;
          border: 1px solid transparent;
          cursor: pointer;
          padding: 0.55rem .8rem;
          font-weight: 700;
          transition: transform .16s ease, background-color .16s ease, border-color .16s ease;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          white-space: nowrap;
        }
        .audit-filter-btn:hover { transform: translateY(-1px); }
        .audit-filter-btn-primary {
          background: linear-gradient(135deg, #16a34a, #22c55e);
          color: white;
        }
        .audit-filter-btn-secondary {
          background: rgba(15,23,42,.72);
          color: #e2e8f0;
          border-color: rgba(148,163,184,.2);
        }
        .audit-action-buttons { display: contents; }
        .table-card { border: 1px solid rgba(74,222,128,.16); border-radius: 1rem; background: linear-gradient(180deg, rgba(15,36,27,.96), rgba(10,29,21,.96)); padding: .75rem; box-shadow: 0 12px 35px rgba(6,64,43,.18); }
        .system-audit-table-wrap,
        .equipment-trail-table-wrap {
          max-height: none !important;
          overflow: visible !important;
          overscroll-behavior: contain;
          scrollbar-gutter: stable;
          scrollbar-width: thin;
          scrollbar-color: rgba(52, 211, 112, .72) rgba(5, 20, 13, .72);
          border: 1px solid rgba(74,222,128,.12);
          border-radius: 0.75rem;
        }
        .system-audit-table-wrap::-webkit-scrollbar,
        .equipment-trail-table-wrap::-webkit-scrollbar { width: 10px; height: 10px; }
        .system-audit-table-wrap::-webkit-scrollbar-track,
        .equipment-trail-table-wrap::-webkit-scrollbar-track {
          background: rgba(5, 20, 13, .72);
          border-radius: 999px;
        }
        .system-audit-table-wrap::-webkit-scrollbar-thumb,
        .equipment-trail-table-wrap::-webkit-scrollbar-thumb {
          background: linear-gradient(180deg, #4ade80, #059669);
          border: 2px solid rgba(5, 20, 13, .72);
          border-radius: 999px;
        }
        .system-audit-table-wrap::-webkit-scrollbar-thumb:hover,
        .equipment-trail-table-wrap::-webkit-scrollbar-thumb:hover {
          background: linear-gradient(180deg, #86efac, #10b981);
        }
        .system-audit-table-wrap thead th,
        .equipment-trail-table-wrap thead th { position: sticky; top: 0; z-index: 2; background: #071510; }
        .action-pill { display: inline-flex; align-items: center; gap: 0.4rem; border-radius: 999px; padding: 0.55rem 0.85rem; font-size: 0.8rem; font-weight: 700; }
        .pill-module { background: rgba(34,197,94,.12); color: #d9f8e7; }
        .pill-action { background: rgba(16,185,129,.12); color: #a7f3d0; }
        #loginLogoutAuditPanel { padding: .7rem; }
        .pc-logs-toolbar {
          display: flex;
          align-items: flex-end;
          justify-content: space-between;
          gap: 1.25rem;
          margin-bottom: 1rem;
        }
        .pc-logs-filter-grid {
          display: grid;
          grid-template-columns: minmax(210px, 1.5fr) repeat(2, minmax(140px, .8fr)) auto;
          align-items: end;
          gap: .75rem;
          padding: .85rem;
          border: 1px solid rgba(74,222,128,.14);
          border-radius: 1rem;
          background: linear-gradient(145deg, rgba(7,24,16,.88), rgba(11,34,23,.72));
        }
        .pc-logs-filter-label {
          display: block;
          margin-bottom: .35rem;
          color: rgba(167,243,208,.72);
          font-size: .68rem;
          font-weight: 800;
          letter-spacing: .12em;
          text-transform: uppercase;
        }
        .pc-logs-filter-grid .audit-filter-field {
          min-height: 2.7rem;
          padding: .62rem .8rem;
          border-radius: .75rem;
          border-color: rgba(74,222,128,.2);
          background-color: rgba(3,15,10,.92);
          font-size: .84rem;
        }
        .pc-logs-clear-btn {
          display: inline-flex;
          min-height: 2.7rem;
          align-items: center;
          justify-content: center;
          gap: .45rem;
          padding: .55rem .8rem;
          border: 1px solid rgba(148,163,184,.2);
          border-radius: .75rem;
          background: rgba(15,23,42,.38);
          color: #cbd5e1;
          font-size: .78rem;
          font-weight: 700;
          transition: .18s ease;
        }
        .pc-logs-clear-btn:hover { border-color: rgba(74,222,128,.35); background: rgba(16,185,129,.1); color: #d1fae5; }
        .pc-logs-table-wrap { overflow: visible !important; border: 1px solid rgba(74,222,128,.16); border-radius: 1rem; background: rgba(4,16,11,.45); }
        .pc-logs-table { width: 100%; min-width: 900px; border-collapse: separate; border-spacing: 0; text-align: left; }
        .pc-logs-table thead th {
          position: sticky;
          top: 0;
          z-index: 2;
          padding: .8rem 1rem;
          border-bottom: 1px solid rgba(74,222,128,.2);
          background: #081a12;
          color: rgba(167,243,208,.72);
          font-size: .68rem;
          font-weight: 800;
          letter-spacing: .12em;
          text-transform: uppercase;
          white-space: nowrap;
        }
        .pc-logs-table tbody td { padding: .85rem 1rem; border-bottom: 1px solid rgba(74,222,128,.09); vertical-align: middle; }
        .pc-logs-table tbody tr:last-child td { border-bottom: 0; }
        .pc-logs-table tbody tr { transition: background .16s ease; }
        .pc-logs-table tbody tr:nth-child(even) { background: rgba(9,29,19,.42); }
        .pc-logs-table tbody tr:hover { background: rgba(16,185,129,.09); }
        .pc-logs-user { display: flex; min-width: 150px; align-items: center; gap: .7rem; }
        .pc-logs-user-avatar {
          display: grid;
          width: 2.15rem;
          height: 2.15rem;
          flex: 0 0 auto;
          place-items: center;
          border: 1px solid rgba(52,211,153,.26);
          border-radius: .75rem;
          background: rgba(16,185,129,.12);
          color: #a7f3d0;
          font-size: .72rem;
          font-weight: 800;
        }
        .pc-logs-user-name { color: #e2f8eb; font-weight: 700; line-height: 1.25; }
        .pc-logs-role-pill, .pc-logs-station-pill, .pc-logs-action-pill {
          display: inline-flex;
          align-items: center;
          gap: .4rem;
          border: 1px solid rgba(74,222,128,.16);
          border-radius: 999px;
          padding: .35rem .65rem;
          font-size: .72rem;
          font-weight: 750;
          white-space: nowrap;
        }
        .pc-logs-role-pill { background: rgba(30,41,59,.52); color: #cbd5e1; border-color: rgba(148,163,184,.15); text-transform: capitalize; }
        .pc-logs-station-pill { background: rgba(16,185,129,.08); color: #a7f3d0; }
        .pc-logs-action-pill.is-login { background: rgba(16,185,129,.13); color: #a7f3d0; }
        .pc-logs-action-pill.is-logout { background: rgba(245,158,11,.1); color: #fcd34d; border-color: rgba(245,158,11,.2); }
        .pc-logs-details { max-width: 440px; color: #94a3b8; font-size: .76rem; line-height: 1.45; }
        .pc-logs-detail-trigger {
          display: inline-flex;
          min-width: 2.5rem;
          min-height: 2.2rem;
          align-items: center;
          justify-content: center;
          gap: .4rem;
          padding: .35rem .65rem;
          border: 1px solid rgba(74, 222, 128, .35);
          border-radius: .7rem;
          background: rgba(4, 106, 56, .22);
          color: #a7f3d0;
          cursor: pointer;
          font-size: .76rem;
          font-weight: 750;
        }
        .pc-logs-detail-trigger:hover,
        .pc-logs-detail-trigger:focus-visible {
          border-color: #86efac;
          background: rgba(4, 106, 56, .5);
          color: #f0fdf4;
          outline: none;
        }
        .pc-logs-time { color: #d1fae5; font-size: .8rem; font-weight: 650; white-space: nowrap; }
        .pc-logs-empty { padding: 2.75rem 1rem !important; text-align: center; color: #94a3b8; }
        .pc-logs-empty-icon { display: grid; width: 2.75rem; height: 2.75rem; margin: 0 auto .75rem; place-items: center; border-radius: 1rem; background: rgba(16,185,129,.1); color: #6ee7b7; }
        .pc-logs-footer { display: flex; align-items: center; justify-content: space-between; gap: 1rem; margin-top: 1rem; }
        body.app-shell .main-container.theme-light #loginLogoutAuditPanel { background: #fff !important; border-color: #d7e3da !important; color: #1f2937 !important; }
        body.app-shell .main-container.theme-light .pc-logs-filter-grid { background: #f7faf8; border-color: #d7e3da; }
        body.app-shell .main-container.theme-light .pc-logs-filter-label { color: #476252; }
        body.app-shell .main-container.theme-light .pc-logs-filter-grid .audit-filter-field { background: #fff; color: #1f2937; border-color: #cbd5ce; }
        body.app-shell .main-container.theme-light .pc-logs-table-wrap { background: #fff; border-color: #d7e3da; }
        body.app-shell .main-container.theme-light .pc-logs-table thead th { background: #f0f7f2; color: #476252; border-color: #d7e3da; }
        body.app-shell .main-container.theme-light .pc-logs-table tbody td { border-color: #edf2ee; }
        body.app-shell .main-container.theme-light .pc-logs-table tbody tr:nth-child(even) { background: #fafcfb; }
        body.app-shell .main-container.theme-light .pc-logs-table tbody tr:hover { background: #effaf2; }
        body.app-shell .main-container.theme-light .pc-logs-user-name { color: #1f2937; }
        body.app-shell .main-container.theme-light .pc-logs-details { color: #64748b; }
        body.app-shell .main-container.theme-light .pc-logs-time { color: #166534; }
        body.app-shell #loginLogoutAuditPanel .pc-logs-role-pill.is-faculty { border-color: #60a5fa; background: #173251; color: #bfdbfe; }
        body.app-shell #loginLogoutAuditPanel .pc-logs-role-pill.is-student { border-color: #4ade80; background: #123b28; color: #bbf7d0; }
        body.app-shell #loginLogoutAuditPanel .pc-logs-role-pill.is-admin { border-color: #c4b5fd; background: #30234e; color: #ddd6fe; }
        body.app-shell #loginLogoutAuditPanel .pc-logs-user-avatar.is-faculty { border-color: #60a5fa; background: #173251; color: #bfdbfe; }
        body.app-shell #loginLogoutAuditPanel .pc-logs-user-avatar.is-student { border-color: #4ade80; background: #123b28; color: #bbf7d0; }
        body.app-shell #loginLogoutAuditPanel .pc-logs-user-avatar.is-admin { border-color: #c4b5fd; background: #30234e; color: #ddd6fe; }
        body.app-shell #loginLogoutAuditPanel .pc-logs-action-pill.is-login { border-color: #4ade80; background: #123b28; color: #bbf7d0; }
        body.app-shell #loginLogoutAuditPanel .pc-logs-action-pill.is-logout { border-color: #fb7185; background: #3d1b22; color: #fecdd3; }
        body.app-shell .main-container.theme-light #loginLogoutAuditPanel .pc-logs-role-pill.is-faculty { border-color: #bfdbfe; background: #eff6ff; color: #1d4ed8; }
        body.app-shell .main-container.theme-light #loginLogoutAuditPanel .pc-logs-role-pill.is-student { border-color: #bbf7d0; background: #ecfdf3; color: #166534; }
        body.app-shell .main-container.theme-light #loginLogoutAuditPanel .pc-logs-role-pill.is-admin { border-color: #ddd6fe; background: #f5f3ff; color: #6d28d9; }
        body.app-shell .main-container.theme-light #loginLogoutAuditPanel .pc-logs-user-avatar.is-faculty { border-color: #bfdbfe; background: #eff6ff; color: #1d4ed8; }
        body.app-shell .main-container.theme-light #loginLogoutAuditPanel .pc-logs-user-avatar.is-student { border-color: #bbf7d0; background: #ecfdf3; color: #166534; }
        body.app-shell .main-container.theme-light #loginLogoutAuditPanel .pc-logs-user-avatar.is-admin { border-color: #ddd6fe; background: #f5f3ff; color: #6d28d9; }
        body.app-shell .main-container.theme-light #loginLogoutAuditPanel .pc-logs-action-pill.is-login { border-color: #bbf7d0; background: #ecfdf3; color: #166534; }
        body.app-shell .main-container.theme-light #loginLogoutAuditPanel .pc-logs-action-pill.is-logout { border-color: #fecdd3; background: #fff1f2; color: #be123c; }
        #systemAuditPanel { padding: .85rem; }
        #systemAuditPanel .audit-filters-shell {
          grid-template-columns: minmax(150px, 1.35fr) repeat(3, minmax(125px, 1fr)) max-content max-content;
          gap: .5rem;
          padding: .7rem .75rem;
          margin-bottom: .65rem !important;
          border-radius: .95rem;
        }
        #systemAuditPanel .audit-filters-shell > .audit-filter-group { min-width: 0; }
        #systemAuditPanel .audit-filters-shell > .audit-action-buttons { gap: .45rem; margin: 0 !important; }
        #systemAuditPanel .audit-filter-group { gap: .25rem; }
        #systemAuditPanel .audit-filter-label { font-size: .64rem; letter-spacing: .14em; }
        #systemAuditPanel .audit-filter-field {
          min-height: 2.35rem;
          padding: .48rem .75rem;
          border-radius: .72rem;
          font-size: .82rem;
        }
        #systemAuditPanel .audit-filters-shell button {
          height: 2.25rem;
          min-height: 2.25rem;
          padding: .4rem .8rem;
          border-radius: .7rem;
          font-size: .78rem;
        }
        #systemAuditPanel .system-audit-table-wrap { max-height: min(68vh, 48rem); border-radius: .85rem; }
        #systemAuditPanel .audit-logs-table { width: 100%; min-width: 940px; table-layout: fixed; border-collapse: separate; border-spacing: 0; }
        #systemAuditPanel .audit-logs-table th {
          padding: .52rem .65rem !important;
          color: #d1fae5 !important;
          font-size: .8rem !important;
          font-weight: 700 !important;
          letter-spacing: .04em;
        }
        #systemAuditPanel .audit-logs-table th:nth-child(1) { width: 15%; }
        #systemAuditPanel .audit-logs-table th:nth-child(2) { width: 8%; }
        #systemAuditPanel .audit-logs-table th:nth-child(3) { width: 22%; }
        #systemAuditPanel .audit-logs-table th:nth-child(4) { width: 14%; }
        #systemAuditPanel .audit-logs-table th:nth-child(5) { width: 29%; }
        #systemAuditPanel .audit-logs-table th:nth-child(6) { width: 12%; }
        #systemAuditPanel .audit-logs-table tbody td {
          padding: .42rem .65rem !important;
          border-bottom: 1px solid rgba(74,222,128,.08);
          color: #d1fae5 !important;
          font-size: .84rem !important;
          font-weight: 600 !important;
          line-height: 1.35 !important;
          vertical-align: middle;
        }
        #systemAuditPanel .audit-logs-table tbody td:first-child > div:first-child { font-size: .84rem !important; font-weight: 700 !important; }
        #systemAuditPanel .audit-logs-table tbody td:nth-child(2) { font-size: .8rem !important; font-weight: 600 !important; }
        #systemAuditPanel .audit-logs-table tbody tr:nth-child(even) { background: rgba(9,29,19,.35); }
        #systemAuditPanel .audit-logs-table tbody tr:hover { background: rgba(16,185,129,.08); }
        #systemAuditPanel #auditLogsSummary { color: #a7f3d0 !important; font-size: .875rem; }
        #systemAuditPanel .system-audit-table-wrap .action-pill {
          max-width: 100%;
          padding: .28rem .5rem !important;
          font-size: .76rem !important;
          font-weight: 700 !important;
          line-height: 1.4 !important;
          white-space: normal;
          overflow-wrap: anywhere;
        }
        #systemAuditPanel .pill-action { color: #a7f3d0 !important; }
        #systemAuditPanel .pill-module { color: #d9f8e7 !important; }
        #systemAuditPanel .audit-log-actor-meta {
          color: #a7f3d0 !important;
          font-size: .78rem !important;
          font-weight: 700 !important;
          line-height: 1.4 !important;
        }
        #systemAuditPanel .audit-log-description {
          display: inline-block;
          max-width: min(24rem, 100%);
          overflow: hidden;
          color: #a7f3d0;
          font-size: .76rem !important;
          font-weight: 600 !important;
          line-height: 1.4 !important;
          text-overflow: ellipsis;
          white-space: nowrap;
          text-decoration: underline dotted;
          text-underline-offset: .2em;
          cursor: help;
        }
        #systemAuditPanel .audit-log-description:hover,
        #systemAuditPanel .audit-log-description:focus-visible { color: #f0fdf4; }
        .audit-description-tooltip {
          position: fixed;
          z-index: 10000;
          width: max-content;
          max-width: min(32rem, calc(100vw - 1rem));
          padding: .85rem 1rem;
          border: 1px solid rgba(74, 222, 128, .48);
          border-radius: .8rem;
          background: #046a38;
          box-shadow: 0 14px 36px rgba(0, 0, 0, .42);
          color: #f0fdf4;
          font-size: .9375rem;
          font-weight: 500;
          line-height: 1.55;
          white-space: normal;
          overflow-wrap: anywhere;
          pointer-events: none;
        }
        .audit-description-tooltip[hidden] { display: none; }
        #systemAuditPanel .audit-log-timestamp {
          display: grid;
          gap: .16rem;
          color: #d1fae5;
          font-size: .78rem !important;
          font-weight: 600 !important;
          line-height: 1.4 !important;
          white-space: nowrap;
        }
        #systemAuditPanel .audit-log-timestamp span:last-child { color: #a7f3d0; font-size: .78rem !important; }
        body.app-shell .main-container.theme-light #systemAuditPanel .audit-logs-table tbody td { border-color: #edf2ee; }
        body.app-shell .main-container.theme-light #systemAuditPanel .audit-logs-table tbody tr:nth-child(even) { background: #fafcfb; }
        body.app-shell .main-container.theme-light #systemAuditPanel .audit-logs-table tbody tr:hover { background: #effaf2; }
        body.app-shell .main-container.theme-light #systemAuditPanel .audit-logs-table tbody td { color: #14532d !important; }
        body.app-shell .main-container.theme-light #systemAuditPanel .audit-logs-table thead th,
        body.app-shell .main-container.theme-light #systemAuditPanel .audit-logs-table thead th * { color: #000000 !important; }
        body.app-shell .main-container.theme-light #systemAuditPanel .pill-action { color: #166534 !important; }
        body.app-shell .main-container.theme-light #systemAuditPanel .pill-module { color: #14532d !important; }
        body.app-shell .main-container.theme-light #systemAuditPanel .audit-log-actor-meta { color: #15803d !important; }
        body.app-shell .main-container.theme-light #systemAuditPanel .audit-log-description { color: #166534; }
        body.app-shell .main-container.theme-light #systemAuditPanel .audit-log-timestamp { color: #166534; }
        body.app-shell .main-container.theme-light #systemAuditPanel .audit-log-timestamp span:last-child { color: #15803d; }
        body.app-shell .main-container.theme-light #systemAuditPanel #auditLogsSummary { color: #166534 !important; }
        #equipmentAuditTrailPanel { padding: .85rem; }
        #equipmentAuditTrailPanel > div:first-child { gap: .6rem; margin-bottom: .65rem !important; }
        #equipmentAuditTrailPanel > div:first-child h3 { font-size: 1.5rem; line-height: 1.3; font-weight: 800; }
        #equipmentAuditTrailPanel > div:first-child p { margin-top: .25rem; color: #a7f3d0; font-size: 1rem; line-height: 1.5; }
        #equipmentAuditTrailPanel #refreshEquipmentTrailBtn { min-height: 2.6rem; padding: .55rem .9rem; border-radius: .7rem; color: #d1fae5; font-size: .9375rem; font-weight: 700; }
        #equipmentAuditTrailPanel .equipment-trail-filters {
          grid-template-columns: minmax(0, 1.5fr) minmax(190px, 1fr) minmax(150px, .8fr);
          align-items: center;
          gap: .55rem;
          margin-bottom: .65rem !important;
        }
        #equipmentAuditTrailPanel .equipment-trail-filter { min-height: 2.25rem; padding: .45rem .7rem; border-radius: .7rem; font-size: .78rem; }
        #equipmentAuditTrailPanel .equipment-trail-search-wrap { position: relative; display: block; min-width: 0; }
        #equipmentAuditTrailPanel .equipment-trail-search-wrap > i { position: absolute; top: 50%; left: .72rem; z-index: 1; color: #16834a; transform: translateY(-50%); pointer-events: none; }
        #equipmentAuditTrailPanel .equipment-trail-search-wrap input { width: 100%; padding-left: 2.15rem; }
        #equipmentAuditTrailPanel .equipment-trail-date-fields { grid-column: 1 / -1; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: .55rem; }
        #equipmentAuditTrailPanel .equipment-trail-date-fields[hidden] { display: none; }
        #equipmentAuditTrailPanel .equipment-trail-date-fields label { display: grid; min-width: 0; gap: .2rem; color: #a7f3d0; font-size: .68rem; font-weight: 750; }
        #equipmentAuditTrailPanel .equipment-trail-date-fields input { width: 100%; color-scheme: dark; }
        #equipmentAuditTrailPanel .equipment-trail-table-wrap { max-height: min(68vh, 48rem); border-radius: .8rem; }
        #equipmentAuditTrailPanel:not(.hidden) {
          display: block;
          min-height: 0;
          max-height: none;
          overflow: visible;
        }
        #equipmentAuditTrailPanel:not(.hidden) > div:first-child,
        #equipmentAuditTrailPanel:not(.hidden) .equipment-trail-filters,
        #equipmentAuditTrailPanel:not(.hidden) .equipment-trail-footer { flex: none; }
        #equipmentAuditTrailPanel:not(.hidden) .equipment-trail-table-wrap {
          min-height: 0;
          max-height: none !important;
          flex: none;
          overflow: visible !important;
          border-radius: .8rem;
        }
        #equipmentAuditTrailPanel .equipment-trail-table-wrap thead th {
          padding: .42rem .58rem !important;
          background: #0a2e1d !important;
          color: #d1fae5 !important;
          font-size: .82rem !important;
          font-weight: 700 !important;
          letter-spacing: .035em;
          line-height: 1.4 !important;
        }
        #equipmentAuditTrailPanel .equipment-trail-table-wrap tbody tr { background-color: #07150f; }
        #equipmentAuditTrailPanel .equipment-trail-table-wrap tbody tr:nth-child(even) { background-color: #0a2116; }
        #equipmentAuditTrailPanel .equipment-trail-table-wrap tbody tr:hover { background-color: #0d3020; }
        #equipmentAuditTrailPanel .equipment-trail-table-wrap tbody td {
          padding: .34rem .52rem !important;
          color: #d1fae5 !important;
          font-size: .82rem !important;
          font-weight: 500 !important;
          line-height: 1.3 !important;
          vertical-align: middle;
        }
        #equipmentAuditTrailPanel .equipment-trail-table-wrap tbody td * {
          font-size: .82rem !important;
        }
        #equipmentAuditTrailPanel .equipment-trail-table-wrap tbody td:nth-child(3) > div {
          margin-bottom: .15rem !important;
          line-height: 1.22 !important;
        }
        #equipmentAuditTrailPanel .equipment-trail-table-wrap tbody td [class*="text-\\["] {
          color: #a7f3d0 !important;
          font-size: .82rem !important;
          line-height: 1.4 !important;
        }
        #equipmentAuditTrailPanel .equipment-trail-action { padding: .24rem .42rem !important; font-size: .75rem !important; line-height: 1.25 !important; }
        #equipmentAuditTrailPanel .equipment-trail-view { padding: .25rem .42rem !important; font-size: .75rem !important; }
        #equipmentAuditTrailPanel .equipment-trail-table-wrap tbody td .equipment-trail-performer {
          color: inherit;
          font-size: .82rem;
          font-weight: 600;
          text-decoration: none;
          cursor: help;
        }
        #equipmentAuditTrailPanel .equipment-trail-table-wrap tbody td .equipment-trail-equipment {
          display: grid;
          min-width: 0;
          color: inherit;
          font-size: .82rem;
          font-weight: 600;
          text-decoration: none;
          cursor: help;
        }
        #equipmentAuditTrailPanel .equipment-trail-id { color: #6b8a76; font-size: .68rem !important; font-weight: 600; }
        #equipmentAuditTrailPanel .equipment-trail-reason { display: -webkit-box; overflow: hidden; color: inherit; font-size: .78rem; line-height: 1.35; overflow-wrap: anywhere; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
        .equipment-trail-performer-tooltip {
          position: fixed;
          z-index: 10001;
          width: max-content;
          max-width: min(30rem, calc(100vw - 1rem));
          padding: .75rem .9rem;
          border: 1px solid #046a38;
          border-radius: .75rem;
          background: #046a38;
          box-shadow: 0 14px 36px rgba(0, 0, 0, .42);
          color: #ffffff !important;
          font-size: .9375rem;
          font-weight: 500;
          line-height: 1.5;
          white-space: normal;
          overflow-wrap: anywhere;
          pointer-events: none;
        }
        .equipment-trail-performer-tooltip[hidden] { display: none; }
        #equipmentAuditTrailPanel .equipment-trail-footer { display: flex; align-items: center; justify-content: space-between; gap: .75rem; margin-top: .6rem; }
        #equipmentAuditTrailPanel .equipment-trail-pagination { display: flex; flex: 0 0 auto; align-items: center; gap: .45rem; }
        #equipmentAuditTrailPanel #equipmentTrailPageLabel {
          min-width: 5.5rem;
          color: #f0fdf4 !important;
          font-size: .9375rem !important;
          font-weight: 800 !important;
          text-align: center;
          white-space: nowrap;
        }
        #equipmentAuditTrailPanel #equipmentTrailPageButtons {
          display: inline-flex;
          min-height: 2.7rem;
          align-items: center;
          gap: .4rem;
          padding: .3rem .4rem;
          border-color: rgba(74, 222, 128, .32);
          background: #061b11;
        }
        #equipmentAuditTrailPanel #equipmentTrailPageButtons .pagination-btn {
          display: inline-flex !important;
          width: 2.5rem !important;
          min-width: 2.5rem !important;
          height: 2.5rem !important;
          flex: 0 0 2.5rem !important;
          align-items: center !important;
          justify-content: center !important;
          padding: 0 !important;
          border: 1px solid rgba(74, 222, 128, .48) !important;
          background: #0b2b1b !important;
          color: #d1fae5 !important;
          font-size: 1rem !important;
          font-weight: 800 !important;
          line-height: 1 !important;
          opacity: 1 !important;
          visibility: visible !important;
        }
        #equipmentAuditTrailPanel #equipmentTrailPageButtons .pagination-btn.active,
        body.app-shell .main-container.theme-light #equipmentAuditTrailPanel #equipmentTrailPageButtons .pagination-btn.active {
          border-color: #86efac !important;
          background: #16a34a !important;
          color: #ffffff !important;
          box-shadow: 0 0 0 2px rgba(134, 239, 172, .24) !important;
        }
        #equipmentAuditTrailPanel #equipmentTrailPageButtons .pagination-btn:hover:not(:disabled) {
          border-color: #86efac !important;
          background: #15803d !important;
          color: #ffffff !important;
        }
        #equipmentAuditTrailPanel #equipmentAuditTrailSummary { margin: 0; color: #a7f3d0 !important; font-size: .875rem; font-weight: 600; }
        body.app-shell .main-container.theme-light #equipmentAuditTrailPanel .equipment-trail-table-wrap thead,
        body.app-shell .main-container.theme-light #equipmentAuditTrailPanel .equipment-trail-table-wrap thead tr,
        body.app-shell .main-container.theme-light #equipmentAuditTrailPanel .equipment-trail-table-wrap thead th {
          background: #046a38 !important;
          color: #ffffff !important;
          font-weight: 700 !important;
        }
        body.app-shell .main-container.theme-light #equipmentAuditTrailPanel .equipment-trail-table-wrap tbody tr {
          background: #ffffff !important;
        }
        body.app-shell .main-container.theme-light #equipmentAuditTrailPanel .equipment-trail-table-wrap tbody tr:nth-child(even) {
          background: #f3f4f6 !important;
        }
        body.app-shell .main-container.theme-light #equipmentAuditTrailPanel .equipment-trail-table-wrap tbody tr:hover {
          background: #e8f5ec !important;
        }
        body.app-shell .main-container.theme-light #equipmentAuditTrailPanel .equipment-trail-table-wrap tbody td {
          background: transparent !important;
          color: #111827 !important;
          border-color: #d1d5db !important;
        }
        body.app-shell .main-container.theme-light #equipmentAuditTrailPanel .equipment-trail-table-wrap tbody td * {
          color: #111827 !important;
        }
        body.app-shell .main-container.theme-light #equipmentAuditTrailPanel .equipment-trail-date-fields label { color: #496657 !important; }
        body.app-shell .main-container.theme-light #equipmentAuditTrailPanel .equipment-trail-date-fields input { color-scheme: light; }
        body.app-shell .main-container.theme-light #equipmentAuditTrailPanel #equipmentAuditTrailSummary { color: #a7f3d0 !important; }
        body.app-shell .main-container.theme-light #equipmentAuditTrailPanel .equipment-trail-table-wrap { border-color: #d7e3da; }
        body.app-shell .main-container.theme-light #equipmentAuditTrailPanel .equipment-trail-table-wrap thead th { border-color: #047857 !important; }
        @media (max-width: 920px) {
          #equipmentAuditTrailPanel .equipment-trail-filters { grid-template-columns: repeat(2, minmax(0, 1fr)); }
          #equipmentAuditTrailPanel .equipment-trail-search-wrap,
          #equipmentAuditTrailPanel .equipment-trail-date-fields { grid-column: 1 / -1; }
        }
        @media (max-width: 720px) {
          #equipmentAuditTrailPanel .equipment-trail-filters { grid-template-columns: minmax(0, 1fr); }
          #equipmentAuditTrailPanel .equipment-trail-search-wrap,
          #equipmentAuditTrailPanel .equipment-trail-date-fields { grid-column: 1; }
          #equipmentAuditTrailPanel .equipment-trail-footer { align-items: stretch; flex-direction: column; }
          #equipmentAuditTrailPanel .equipment-trail-pagination { flex-wrap: wrap; justify-content: flex-end; }
        }
        #loginLogoutAuditPanel { padding: .85rem; }
        .pc-logs-toolbar { gap: .8rem; margin-bottom: .65rem; }
        .pc-logs-filter-grid { gap: .55rem; padding: .6rem; border-radius: .85rem; }
        .pc-logs-filter-grid .audit-filter-field { min-height: 2.3rem; padding: .45rem .65rem; font-size: .78rem; }
        .pc-logs-filter-label { margin-bottom: .22rem; font-size: .62rem; }
        .pc-logs-clear-btn { min-height: 2.3rem; padding: .42rem .65rem; font-size: .73rem; }
        .pc-logs-table-wrap { border-radius: .8rem; }
        .pc-logs-table { min-width: 860px; }
        .pc-logs-table thead th { padding: .48rem .6rem !important; font-size: .64rem !important; letter-spacing: .08em; }
        .pc-logs-table tbody td { padding: .4rem .6rem !important; font-size: .8rem !important; line-height: 1.3 !important; }
        .pc-logs-user { min-width: 130px; gap: .5rem; }
        .pc-logs-user-avatar { width: 1.8rem; height: 1.8rem; border-radius: .6rem; font-size: .65rem; }
        .pc-logs-role-pill, .pc-logs-station-pill, .pc-logs-action-pill { padding: .25rem .5rem; font-size: .66rem; }
        .pc-logs-details { max-width: 380px; font-size: .7rem; line-height: 1.35; }
        .pc-logs-time { font-size: .72rem; }
        .pc-logs-footer { margin-top: .65rem; }
        .system-audit-table-wrap,
        .equipment-trail-table-wrap,
        .pc-logs-table-wrap {
          overflow: visible !important;
          max-height: none !important;
          scrollbar-gutter: auto !important;
          scrollbar-width: none !important;
        }
        .system-audit-table-wrap::-webkit-scrollbar,
        .equipment-trail-table-wrap::-webkit-scrollbar,
        .pc-logs-table-wrap::-webkit-scrollbar {
          display: none !important;
          width: 0 !important;
          height: 0 !important;
        }
        @media (max-width: 850px) {
          .pc-logs-toolbar { align-items: stretch; flex-direction: column; }
          .pc-logs-filter-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
          .pc-logs-clear-btn { width: 100%; }
        }
        @media (max-width: 520px) {
          .pc-logs-filter-grid { grid-template-columns: minmax(0, 1fr); }
          .pc-logs-footer { align-items: flex-start; flex-direction: column; }
        }
        .detail-button { border: 1px solid rgba(74,222,128,.16); background: rgba(8,20,14,.92); color: #d8f5e0; border-radius: 0.9rem; padding: 0.65rem 0.95rem; cursor: pointer; }
        .detail-button:hover { background: rgba(16,31,24,.95); }
        #equipmentAuditTrailPanel { padding: 0.85rem; }
        .equipment-trail-filter { min-height: 2.5rem; padding: 0.6rem 0.75rem; border-radius: 0.75rem; }
        .equipment-trail-action { padding: 0.3rem 0.55rem; font-size: 0.7rem; line-height: 1rem; }
        .equipment-trail-view { border: 1px solid rgba(74,222,128,.2); border-radius: 0.55rem; background: rgba(16,185,129,.1); color: #a7f3d0; padding: 0.3rem 0.6rem; font-size: 0.72rem; font-weight: 700; }
        .equipment-trail-view:hover { background: rgba(16,185,129,.2); }
        .equipment-trail-modal { position: fixed; inset: 0; z-index: 10000; display: flex; align-items: center; justify-content: center; padding: 1rem; background: rgba(2,9,6,.72); }
        .equipment-trail-modal[hidden] { display: none; }
        .equipment-trail-modal-card { width: min(100%, 30rem); border: 1px solid rgba(74,222,128,.2); border-radius: 1rem; background: #071510; padding: 1rem; box-shadow: 0 20px 50px rgba(0,0,0,.45); }
        body.app-shell .main-container #equipmentTrailDetailsModal .equipment-trail-modal-card { color: #e8f5ec !important; }
        body.app-shell .main-container #equipmentTrailDetailsTitle { color: #f0fdf4 !important; }
        body.app-shell .main-container #equipmentTrailDetailsContext { color: #a7d9b6 !important; opacity: 1 !important; }
        body.app-shell .main-container #equipmentTrailDetailsReason { margin: 0 !important; color: #e2eee5 !important; font-size: .92rem !important; line-height: 1.65 !important; }
        body.app-shell .main-container #closeEquipmentTrailDetails { border: 1px solid #42694f !important; background: #173321 !important; color: #e8f5ec !important; }
        body.app-shell .main-container #closeEquipmentTrailDetails:hover { background: #244b32 !important; }
        body.app-shell .main-container.theme-light #equipmentTrailDetailsModal { background: rgba(15, 23, 42, .38) !important; }
        body.app-shell .main-container.theme-light #equipmentTrailDetailsModal .equipment-trail-modal-card { border-color: #cbdccf !important; background: #ffffff !important; color: #24372b !important; box-shadow: 0 20px 55px rgba(24, 59, 38, .2) !important; }
        body.app-shell .main-container.theme-light #equipmentTrailDetailsTitle { color: #17271e !important; }
        body.app-shell .main-container.theme-light #equipmentTrailDetailsContext { color: #52705d !important; }
        body.app-shell .main-container.theme-light #equipmentTrailDetailsReason { color: #26382e !important; }
        body.app-shell .main-container.theme-light #closeEquipmentTrailDetails { border-color: #c9dbcf !important; background: #edf5ef !important; color: #315d40 !important; }
        body.app-shell .main-container.theme-light #closeEquipmentTrailDetails:hover { background: #dcebe0 !important; }
        .pagination-btn {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          min-width: 2.2rem;
          height: 2.2rem;
          padding: 0;
          border-radius: 999px;
          border: 1px solid rgba(74,222,128,.18);
          background: rgba(6,14,10,.72);
          color: #a7f3d0;
          font-size: 0.9rem;
          font-weight: 600;
          transition: all 0.2s ease;
        }
        .pagination-btn:hover:not(:disabled) {
          background: rgba(16,31,24,.95);
          color: #f8fafc;
        }
        .pagination-btn.active {
          background: linear-gradient(135deg, #10b981 0%, #059669 100%);
          color: #f8fafc;
          border-color: rgba(16,185,129,.45);
          box-shadow: 0 8px 20px rgba(5,150,105,.28);
        }
        .pagination-btn:disabled {
          opacity: 0.4;
          cursor: not-allowed;
          box-shadow: none;
        }
        .pagination-nav {
          display: inline-flex;
          align-items: center;
          gap: 0.5rem;
          padding: 0.35rem 0.45rem;
          border-radius: 999px;
          background: rgba(6,14,10,.45);
          border: 1px solid rgba(74,222,128,.13);
        }
        .pagination-nav-btn {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          padding: 0.45rem 0.8rem;
          border-radius: 0.8rem;
          border: 1px solid rgba(74,222,128,.15);
          background: rgba(4,20,15,.65);
          color: #a7f3d0;
          font-size: 0.86rem;
          font-weight: 600;
          transition: all 0.2s ease;
        }
        .pagination-nav-btn:hover:not(:disabled) {
          background: rgba(16,31,24,.88);
          color: #f8fafc;
        }
        .pagination-nav-btn:disabled {
          opacity: 0.4;
          cursor: not-allowed;
          box-shadow: none;
        }
        body.app-shell .main-container.theme-light :is(
          #exportAuditLogsBtn,
          .audit-filter-btn-primary,
          .equipment-trail-view,
          .pagination-btn.active
        ) {
          border: 1px solid #10b981 !important;
          background: #10b981 !important;
          background-image: none !important;
          color: #052e16 !important;
          box-shadow: 0 2px 6px rgba(16, 185, 129, .18) !important;
        }
        body.app-shell .main-container.theme-light :is(#systemAuditTab, #loginLogoutTab, #equipmentTrailTab)[aria-selected="true"],
        body.app-shell .main-container.theme-light .pagination-btn.active {
          border: 1px solid #c8decf !important;
          border-bottom: 3px solid #16834a !important;
          background: #f4faf6 !important;
          color: #14532d !important;
          box-shadow: none !important;
        }
        body.app-shell .main-container.theme-light :is(#systemAuditTab, #loginLogoutTab, #equipmentTrailTab)[aria-selected="false"] {
          border: 1px solid #cbd5d1 !important;
          background: #f3f4f6 !important;
          color: #334155 !important;
        }
        body.app-shell .main-container.theme-light :is(
          #systemAuditTab,
          #loginLogoutTab,
          #equipmentTrailTab,
          #exportAuditLogsBtn,
          .audit-filter-btn-primary,
          .equipment-trail-view,
          .pagination-btn.active
        ):hover:not(:disabled) {
          border-color: #059669 !important;
          background: #059669 !important;
          color: #ffffff !important;
        }
        body.app-shell .main-container.theme-light :is(
          #exportAuditLogsBtn,
          .audit-filter-btn-primary,
          .equipment-trail-view,
          .pagination-btn.active
        ):disabled {
          opacity: .55;
        }
        .modal-overlay { position: fixed; inset: 0; z-index: 9999; background: rgba(2,9,6,.75); display: none; align-items: center; justify-content: center; padding: 1.5rem; }
        .modal-overlay.active { display: flex; }
        .modal-card { width: min(100%, 46rem); border-radius: 24px; background: rgba(7,21,17,.96); border: 1px solid rgba(74,222,128,.18); box-shadow: 0 24px 60px rgba(4,18,12,.48); padding: 1.5rem; }
        .modal-header { display: flex; align-items: center; justify-content: space-between; gap: 1rem; margin-bottom: 1rem; }
        .modal-header h3 { margin: 0; color: #f8fafc; font-size: 1.35rem; }
        .modal-close { background: rgba(15,23,42,.8); color: #d8f5e0; border: none; border-radius: 0.95rem; padding: 0.75rem 1rem; cursor: pointer; }
        .modal-close:hover { background: rgba(15,23,42,.95); }
        .modal-body { display: grid; gap: 0.85rem; }
        .modal-row { display: flex; justify-content: space-between; gap: 1rem; padding: 0.95rem 1rem; border-radius: 1rem; background: rgba(10,25,18,.8); border: 1px solid rgba(74,222,128,.12); }
        .modal-label { color: rgba(148,163,184,.8); font-size: 0.9rem; }
        .modal-value { color: #f8fafc; font-size: 0.95rem; text-align: right; }
        @media (max-width: 980px) {
          .audit-filters-shell { grid-template-columns: repeat(4, minmax(0, 1fr)); }
          #systemAuditPanel .audit-filters-shell > .audit-action-buttons { display: flex; grid-column: span 2; justify-content: flex-start; }
        }
        @media (max-width: 640px) {
          .audit-filters-shell { grid-template-columns: minmax(0, 1fr); }
          #systemAuditPanel .audit-filters-shell > .audit-action-buttons { grid-column: auto; }
          .audit-action-buttons { flex-direction: row; }
          .audit-action-buttons .audit-filter-btn { width: auto; }
        }
      </style>

      <div class="audit-header-spacer" aria-hidden="true"></div>
      <header class="system-dashboard-heading audit-fixed-header comlab-slim-page-header" data-comlab-fixed-page-header="true">
        <div class="system-dashboard-heading-main">
          <button id="mobileMenuToggle" class="menu-toggle" type="button" aria-label="Open navigation" onclick="toggleSidebar()">
            <i class="fas fa-bars" aria-hidden="true"></i>
          </button>
        </div>
        <div class="system-dashboard-heading-actions">
          <a id="adminBorrowNotificationsButton" class="comlab-notification-button" href="/borrow-equipment" aria-label="Notifications" title="Open borrow requests" data-comlab-notification-button="true">
            <i class="fas fa-bell" aria-hidden="true"></i>
            <span class="comlab-notification-badge hidden" data-comlab-notification-count aria-live="polite"></span>
          </a>
          <div class="inline-flex shrink-0 items-center" data-theme-toggle-anchor></div>
          <div class="system-profile-badge profile-theme-static bg-[#04281b] text-white">
            <span class="system-profile-badge-avatar bg-[#06402b] text-emerald-300" id="adminBadgeAvatar">AD</span>
            <span class="system-profile-badge-copy text-white">
              <span class="system-profile-badge-name text-white" id="adminBadgeName">Administrator</span>
              <span class="system-profile-badge-role text-emerald-400" id="adminBadgeRole">Admin</span>
            </span>
          </div>
        </div>
      </header>

      <div class="audit-tabs mb-5 flex flex-wrap gap-2 rounded-2xl border border-emerald-800/50 bg-[#081910] p-2" role="tablist" aria-label="Audit views">
        <button id="systemAuditTab" type="button" class="audit-view-tab rounded-xl bg-emerald-500 px-4 py-2 text-sm font-bold text-black" role="tab" aria-controls="systemAuditPanel" aria-selected="true">
          <i class="fas fa-list-check mr-2"></i>System Logs
        </button>
        <button id="equipmentTrailTab" type="button" class="audit-view-tab rounded-xl px-4 py-2 text-sm font-bold text-emerald-200 hover:bg-emerald-900/50" role="tab" aria-controls="equipmentAuditTrailPanel" aria-selected="false">
          <i class="fas fa-timeline mr-2"></i>Equipment Audit Trail
        </button>
        <button id="loginLogoutTab" type="button" class="audit-view-tab rounded-xl px-4 py-2 text-sm font-bold text-emerald-200 hover:bg-emerald-900/50" role="tab" aria-controls="loginLogoutAuditPanel" aria-selected="false">
          <i class="fas fa-desktop mr-2"></i>PC Logs
        </button>
      </div>

      <section id="systemAuditPanel" class="table-card mb-6" role="tabpanel" aria-labelledby="systemAuditTab" tabindex="0">
        <div class="audit-filters-shell mb-4">
          <div class="audit-filter-group">
              <label class="audit-filter-label font-bold text-xs uppercase text-emerald-300/80 mb-1 block" for="auditSearchInput">Search</label>
              <input id="auditSearchInput" type="search" placeholder="Search audit logs..." class="audit-filter-field h-10" />
          </div>
          <div class="audit-filter-group">
              <label class="audit-filter-label font-bold text-xs uppercase text-emerald-300/80 mb-1 block" for="auditUserSelect">User</label>
              <select id="auditUserSelect" class="audit-filter-field h-10">
                <option value="">All Users</option>
              </select>
          </div>
          <div class="audit-filter-group">
              <label class="audit-filter-label font-bold text-xs uppercase text-emerald-300/80 mb-1 block" for="auditDateRangeSelect">Date Range</label>
              <select id="auditDateRangeSelect" class="audit-filter-field h-10">
                <option value="all">All Time</option>
                <option value="today">Today</option>
                <option value="week">This Week</option>
                <option value="month">This Month</option>
                <option value="year">This Year</option>
              </select>
          </div>
          <div class="audit-filter-group">
              <label class="audit-filter-label font-bold text-xs uppercase text-emerald-300/80 mb-1 block" for="auditCampusDisplay">Campus</label>
              <div id="auditCampusDisplay" class="audit-filter-field h-10 flex items-center" aria-readonly="true"></div>
          </div>
          <div class="audit-action-buttons flex items-center justify-end gap-3">
            <button id="exportAuditLogsBtn" type="button" class="h-10 px-5 bg-emerald-500 hover:bg-emerald-400 text-black font-bold rounded-lg inline-flex items-center justify-center gap-2 transition min-w-[130px]" onclick="window.exportAuditLogs && window.exportAuditLogs('pdf')">
              <i class="fas fa-file-pdf"></i> Export PDF
            </button>
            <button id="printAuditLogs" type="button" class="h-10 px-5 bg-slate-700 hover:bg-slate-600 text-white font-bold rounded-lg inline-flex items-center justify-center gap-2 transition min-w-[100px]" onclick="window.exportAuditLogs && window.exportAuditLogs('print')">
              <i class="fas fa-print"></i> Print
            </button>
          </div>
        </div>
        <div class="system-audit-table-wrap">
          <table class="audit-logs-table min-w-full text-left divide-y divide-slate-700">
            <thead class="bg-slate-950 border-b border-slate-800">
              <tr>
                <th class="px-4 py-3 text-sm font-semibold text-slate-300">Actor</th>
                <th class="px-4 py-3 text-sm font-semibold text-slate-300">Role</th>
                <th class="px-4 py-3 text-sm font-semibold text-slate-300">Action</th>
                <th class="px-4 py-3 text-sm font-semibold text-slate-300">Module</th>
                <th class="px-4 py-3 text-sm font-semibold text-slate-300">Description</th>
                <th class="px-4 py-3 text-sm font-semibold text-slate-300">Date / Time</th>
              </tr>
            </thead>
            <tbody id="auditLogsTableBody" class="divide-y divide-slate-800 text-sm text-slate-200">
              <tr><td colspan="6" class="px-4 py-6 text-center text-slate-400">Loading audit logs...</td></tr>
            </tbody>
          </table>
        </div>
        <div class="mt-4 flex w-full items-center justify-between gap-3">
          <div id="auditLogsSummary" class="text-slate-400 text-sm">Showing 0 audit entries.</div>
          <div class="flex items-center gap-2">
            <button id="auditPrevPage" class="pagination-nav-btn" type="button">Previous</button>
            <div class="pagination-nav" id="auditPageButtons"></div>
            <button id="auditNextPage" class="pagination-nav-btn" type="button">Next</button>
          </div>
        </div>
      </section>

      <section id="loginLogoutAuditPanel" class="table-card mb-6 hidden" role="tabpanel" aria-labelledby="loginLogoutTab" tabindex="0">
        <div class="pc-logs-toolbar">
          <div>
            <div class="mb-1 inline-flex items-center gap-2 text-xs font-bold uppercase tracking-[.16em] text-emerald-300/75">
              <i class="fas fa-desktop" aria-hidden="true"></i> Station activity
            </div>
            <h3 class="text-xl font-bold text-white">PC Logs</h3>
          </div>
          <div class="pc-logs-filter-grid" aria-label="Filter PC logs">
            <label for="loginLogoutStationFilter">
              <span class="pc-logs-filter-label">PC Station</span>
              <select id="loginLogoutStationFilter" class="audit-filter-field">
                <option value="">All PC stations</option>
              </select>
            </label>
            <label for="loginLogoutRoleFilter">
              <span class="pc-logs-filter-label">Role</span>
              <select id="loginLogoutRoleFilter" class="audit-filter-field">
                <option value="">All roles</option>
                <option value="admin">Admin</option>
                <option value="faculty">Faculty</option>
                <option value="student">Student</option>
              </select>
            </label>
            <label for="loginLogoutActionFilter">
              <span class="pc-logs-filter-label">Action</span>
              <select id="loginLogoutActionFilter" class="audit-filter-field">
                <option value="">All actions</option>
                <option value="login">Login</option>
                <option value="logout">Logout</option>
              </select>
            </label>
            <button id="loginLogoutClearFilters" class="pc-logs-clear-btn" type="button">
              <i class="fas fa-rotate-left" aria-hidden="true"></i>Clear
            </button>
          </div>
        </div>
        <div class="pc-logs-table-wrap">
          <table class="pc-logs-table">
            <thead>
              <tr>
                <th class="px-4 py-3 text-sm font-semibold text-slate-300">User</th>
                <th class="px-4 py-3 text-sm font-semibold text-slate-300">Role</th>
                <th class="px-4 py-3 text-sm font-semibold text-slate-300">Event</th>
                <th class="px-4 py-3 text-sm font-semibold text-slate-300">PC Station</th>
                <th class="px-4 py-3 text-sm font-semibold text-slate-300">Action</th>
                <th class="px-4 py-3 text-sm font-semibold text-slate-300">Date / Time</th>
              </tr>
            </thead>
            <tbody id="loginLogoutTableBody" class="text-sm text-slate-200">
              <tr><td colspan="6" class="pc-logs-empty">Select PC Logs to load entries.</td></tr>
            </tbody>
          </table>
        </div>
        <div class="pc-logs-footer">
          <div id="loginLogoutSummary" class="text-slate-400 text-sm" aria-live="polite">No PC station logs loaded.</div>
          <div class="flex items-center gap-2">
            <button id="loginLogoutPrevPage" class="pagination-nav-btn" type="button" disabled>Previous</button>
            <span id="loginLogoutPageLabel" class="text-sm text-slate-400">Page 1</span>
            <button id="loginLogoutNextPage" class="pagination-nav-btn" type="button" disabled>Next</button>
          </div>
        </div>
      </section>

      <div id="pcLogsDetailsModal" class="pc-logs-modal" hidden>
        <div class="pc-logs-modal-backdrop" data-pc-logs-modal-close></div>
        <section class="pc-logs-modal-card" role="dialog" aria-modal="true" aria-labelledby="pcLogsDetailsTitle" aria-describedby="pcLogsDetailsDescription">
          <header class="pc-logs-modal-header">
            <div>
              <p class="pc-logs-modal-eyebrow">Station activity</p>
              <h3 id="pcLogsDetailsTitle">PC Session Details</h3>
            </div>
            <button type="button" class="pc-logs-modal-icon-close" data-pc-logs-modal-close aria-label="Close log details">
              <i class="fas fa-times" aria-hidden="true"></i>
            </button>
          </header>
          <div class="pc-logs-modal-user">
            <span id="pcLogsDetailsAvatar" class="pc-logs-modal-avatar" aria-hidden="true"></span>
            <div>
              <strong id="pcLogsDetailsUser"></strong>
              <span id="pcLogsDetailsRole" class="pc-logs-role-pill"></span>
            </div>
          </div>
          <dl class="pc-logs-modal-grid">
            <div><dt>PC station</dt><dd id="pcLogsDetailsStation"></dd></div>
            <div><dt>Event</dt><dd id="pcLogsDetailsEvent"></dd></div>
            <div><dt>Date / time</dt><dd id="pcLogsDetailsTime"></dd></div>
            <div id="pcLogsDetailsMethodRow" hidden><dt>Method</dt><dd id="pcLogsDetailsMethod"></dd></div>
          </dl>
          <div class="pc-logs-modal-description">
            <h4>Log details</h4>
            <p id="pcLogsDetailsDescription"></p>
          </div>
          <footer class="pc-logs-modal-footer">
            <button type="button" class="pc-logs-modal-close" data-pc-logs-modal-close>Close</button>
          </footer>
        </section>
      </div>

      <section id="equipmentAuditTrailPanel" class="table-card mb-6 hidden" role="tabpanel" aria-labelledby="equipmentTrailTab" tabindex="0">
        <div class="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 class="text-xl font-bold text-white">Equipment Audit Trail</h3>
          </div>
          <button id="refreshEquipmentTrailBtn" type="button" class="audit-filter-btn audit-filter-btn-secondary !w-auto">
            <i class="fas fa-rotate mr-2"></i>Refresh
          </button>
        </div>
        <div class="equipment-trail-filters mb-4 grid grid-cols-1 gap-3 md:grid-cols-2">
          <label class="equipment-trail-search-wrap" for="equipmentTrailSearch">
            <i class="fas fa-search" aria-hidden="true"></i>
            <input id="equipmentTrailSearch" type="search" placeholder="Search equipment, ID, serial, action, or actor..." class="audit-filter-field equipment-trail-filter" aria-label="Search equipment audit trail" />
          </label>
          <label class="sr-only" for="equipmentTrailAction">Filter by action</label>
          <select id="equipmentTrailAction" class="audit-filter-field equipment-trail-filter" aria-label="Filter by equipment action">
            <option value="">All equipment actions</option>
            <option value="created">Registration</option>
            <option value="equipment_scanned">QR scan</option>
            <option value="equipment_issue_reported">Issue reported</option>
            <option value="borrow_requested">Borrow request submitted</option>
            <option value="return_requested">Return marked by borrower</option>
            <option value="borrowed">Borrowed</option>
            <option value="returned">Returned</option>
            <option value="accountability_assigned">Assigned</option>
            <option value="accountability_removed">Unassigned</option>
            <option value="maintenance_started">Repair started</option>
            <option value="maintenance_completed">Repair completed</option>
            <option value="status_changed">Status changed</option>
            <option value="condition_changed">Condition changed</option>
            <option value="location_changed">Location changed</option>
            <option value="assigned_to_set">Set changed</option>
            <option value="removed_from_set">Removed from set</option>
            <option value="deleted">Disposed</option>
            <option value="updated">Updated</option>
          </select>
          <label class="sr-only" for="equipmentTrailDateRange">Filter by date</label>
          <select id="equipmentTrailDateRange" class="audit-filter-field equipment-trail-filter" aria-label="Filter by date range">
            <option value="all">Any date</option>
            <option value="today">Today</option>
            <option value="7days">Last 7 days</option>
            <option value="custom">Custom range</option>
          </select>
          <div id="equipmentTrailCustomDates" class="equipment-trail-date-fields" hidden>
            <label>From <input id="equipmentTrailDateFrom" type="date" class="audit-filter-field equipment-trail-filter" aria-label="Start date" /></label>
            <label>To <input id="equipmentTrailDateTo" type="date" class="audit-filter-field equipment-trail-filter" aria-label="End date" /></label>
          </div>
        </div>
        <div class="equipment-trail-table-wrap">
          <table class="min-w-[780px] w-full table-fixed text-left text-sm divide-y divide-slate-700">
            <colgroup>
              <col style="width:19%" />
              <col style="width:15%" />
              <col style="width:25%" />
              <col style="width:17%" />
              <col style="width:15%" />
              <col style="width:9%" />
            </colgroup>
            <thead class="sticky top-0 z-10 bg-slate-950 border-b border-slate-800">
              <tr>
                <th class="px-3 py-2 font-semibold text-slate-300">Equipment</th>
                <th class="px-3 py-2 font-semibold text-slate-300">Activity</th>
                <th class="px-3 py-2 font-semibold text-slate-300">Reason</th>
                <th class="px-3 py-2 font-semibold text-slate-300">Performed by</th>
                <th class="px-3 py-2 font-semibold text-slate-300 whitespace-nowrap">Date / Time</th>
                <th class="px-3 py-2 font-semibold text-slate-300">Action</th>
              </tr>
            </thead>
            <tbody id="equipmentAuditTrailBody" class="divide-y divide-slate-800 text-sm text-slate-200">
              <tr><td colspan="6" class="px-3 py-5 text-center text-slate-400">Select Equipment Audit Trail to load entries.</td></tr>
            </tbody>
          </table>
        </div>
        <div class="equipment-trail-footer">
          <div id="equipmentAuditTrailSummary" class="text-sm text-slate-400" aria-live="polite">No trail entries loaded.</div>
          <div class="equipment-trail-pagination">
            <button id="equipmentTrailPrevPage" class="pagination-nav-btn" type="button" disabled>Previous</button>
            <span id="equipmentTrailPageLabel" aria-live="polite">Page 1 of 1</span>
            <div class="pagination-nav" id="equipmentTrailPageButtons" aria-label="Equipment audit trail pages"></div>
            <button id="equipmentTrailNextPage" class="pagination-nav-btn" type="button" disabled>Next</button>
          </div>
        </div>
      </section>

      <div id="equipmentTrailDetailsModal" class="equipment-trail-modal" role="dialog" aria-modal="true" aria-labelledby="equipmentTrailDetailsTitle" hidden>
        <div class="equipment-trail-modal-card">
          <div class="mb-3 flex items-center justify-between gap-3">
            <div>
              <h3 id="equipmentTrailDetailsTitle" class="text-base font-bold">Audit details</h3>
              <p id="equipmentTrailDetailsContext" class="mt-1 text-xs"></p>
            </div>
            <button id="closeEquipmentTrailDetails" type="button" class="rounded-lg px-2.5 py-1.5" aria-label="Close details">
              <i class="fas fa-times"></i>
            </button>
          </div>
          <p id="equipmentTrailDetailsReason" class="whitespace-pre-wrap break-words text-sm leading-relaxed"></p>
        </div>
      </div>

    `
  },
  "reports": {
    title: "Reports",
    description: "",
    backRoute: "/admin-dashboard",
    backLabel: "Back to Admin Dashboard",
    content: String.raw`
      <style>
        :root {
          color-scheme: dark;
          --bg: #07150F;
          --bg-secondary: #0A1D15;
          --panel: linear-gradient(180deg, rgba(15,36,27,.96), rgba(10,29,21,.96));
          --panel-strong: linear-gradient(180deg, rgba(15,36,27,.98), rgba(10,29,21,.98));
          --panel-soft: rgba(74,222,128,.06);
          --border: rgba(74,222,128,.15);
          --text: #F8FAFC;
          --muted: #B6D7C8;
          --accent: #22C55E;
          --accent-strong: #16A34A;
          --accent-soft: rgba(74,222,128,.12);
          --shadow: 0 12px 35px rgba(6,64,43,.18);
        }

        body {
          background: radial-gradient(circle at top left, rgba(34,197,94,.16), transparent 24%),
                      radial-gradient(circle at bottom right, rgba(74,222,128,.10), transparent 26%),
                      linear-gradient(180deg, #07150F 0%, #0A1D15 100%);
          color: var(--text);
        }

        body.app-shell .page-content {
          background:
            radial-gradient(circle at top left, rgba(34,197,94,.16), transparent 24%),
            radial-gradient(circle at bottom right, rgba(74,222,128,.10), transparent 26%),
            linear-gradient(180deg, #07150F 0%, #0A1D15 100%) !important;
          border-radius: 24px;
          padding: 1rem;
          box-shadow: inset 0 1px 0 rgba(255,255,255,.03);
        }

        .panel-card {
          background: var(--panel);
          border: 1px solid var(--border);
          border-radius: 1.25rem;
          box-shadow: var(--shadow);
        }

        .report-select {
          box-sizing: border-box;
          width: 100%;
          min-width: 0;
          min-height: 2.65rem;
          background: rgba(6, 16, 12, 0.9);
          border: 1px solid rgba(74, 222, 128, 0.35);
          color: #f8fafc;
          border-radius: 0.9rem;
          box-shadow: inset 0 1px 0 rgba(255,255,255,.04);
        }
        .report-select:focus {
          border-color: rgba(74,222,128,.45);
          box-shadow: 0 0 0 3px rgba(34,197,94,.15);
          outline: none;
        }
        .report-select option {
          background: rgba(6,16,11,.98);
          color: #f8fafc;
        }
        .report-filter-grid {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          align-items: end;
          gap: .75rem .9rem;
        }
        .report-filter-grid > div > label {
          display: block;
          margin: 0 0 .35rem;
          color: #426451;
          font-size: .75rem;
          font-weight: 750;
        }
        .report-filter-field[hidden],
        .report-custom-date-fields[hidden] { display: none !important; }
        .report-custom-date-fields {
          grid-column: 1 / -1;
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: .75rem .9rem;
        }
        .report-search-control { position: relative; flex: 1 1 auto; min-width: 0; }
        .report-search-actions { display: flex; align-items: center; gap: .5rem; }
        .report-search-control > i {
          position: absolute;
          top: 50%;
          left: .8rem;
          transform: translateY(-50%);
          color: #22c55e;
          pointer-events: none;
        }
        .report-search-control input { padding-right: 2.6rem !important; padding-left: 2.35rem !important; }
        .report-search-clear {
          position: absolute;
          top: 50%;
          right: .45rem;
          display: inline-grid;
          width: 1.75rem;
          height: 1.75rem;
          place-items: center;
          transform: translateY(-50%);
          border: 0;
          border-radius: 999px;
          background: rgba(34,197,94,.12);
          color: #426451;
          cursor: pointer;
        }
        .report-search-clear[hidden] { display: none !important; }
        .report-builder-card {
          position: relative;
          z-index: 30;
          overflow: visible !important;
        }
        #reportPdfPreviewModal {
          position: fixed !important;
          inset: 0 !important;
          z-index: 99999 !important;
        }
        .report-actions-menu-wrap { position: relative; flex: 0 0 auto; }
        .report-actions-toggle {
          display: inline-grid;
          width: 2.65rem;
          height: 2.65rem;
          place-items: center;
          border: 1px solid #9bbda3;
          border-radius: .85rem;
          background: #fff;
          color: #14532d;
          font-size: 1.1rem;
          cursor: pointer;
          transition: background .16s ease, border-color .16s ease, transform .16s ease;
        }
        .report-actions-toggle:hover { background: #f0fdf4; border-color: #4b8b5b; }
        .report-actions-menu {
          position: absolute;
          z-index: 50;
          top: calc(100% + .45rem);
          right: 0;
          display: grid;
          width: min(15rem, calc(100vw - 3rem));
          gap: .2rem;
          padding: .4rem;
          border: 1px solid #cbd5e1;
          border-radius: .9rem;
          background: #fff;
          color: #172a20;
          box-shadow: 0 16px 36px rgba(15, 23, 42, .2);
        }
        .report-actions-menu[hidden] { display: none !important; }
        .report-actions-menu-item {
          display: flex;
          width: 100%;
          align-items: center;
          gap: .65rem;
          padding: .65rem .7rem;
          border: 0;
          border-radius: .6rem;
          background: transparent;
          color: inherit;
          font: inherit;
          font-size: .84rem;
          font-weight: 650;
          text-align: left;
          cursor: pointer;
        }
        .report-actions-menu-item:hover:not(:disabled) { background: #f0fdf4; }
        .report-actions-menu-item:disabled { cursor: not-allowed; opacity: .45; }
        .report-actions-menu-item i { width: 1rem; color: #16834c; text-align: center; }
        .report-actions-menu-divider { height: 1px; margin: .2rem .35rem; background: #dbe7df; }
        body.app-shell .main-container.theme-dark .report-filter-grid > div > label {
          color: #b6d7c8;
        }
        body.app-shell .main-container.theme-dark .report-actions-toggle {
          border-color: rgba(74, 222, 128, .38);
          background: #0a2117;
          color: #d1fae5;
        }
        body.app-shell .main-container.theme-dark .report-actions-toggle:hover { background: #123c2a; }
        body.app-shell .main-container.theme-dark .report-actions-menu {
          border-color: rgba(74, 222, 128, .28);
          background: #092016;
          color: #e5f5eb;
          box-shadow: 0 18px 40px rgba(0,0,0,.42);
        }
        body.app-shell .main-container.theme-dark .report-actions-menu-item:hover:not(:disabled) { background: #123c2a; }
        body.app-shell .main-container.theme-dark .report-actions-menu-divider { background: rgba(167, 243, 208, .16); }
        @media (max-width: 820px) {
          .report-filter-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        }
        @media (max-width: 540px) {
          .report-filter-grid { grid-template-columns: minmax(0, 1fr); gap: .65rem; }
          .report-custom-date-fields { grid-template-columns: minmax(0, 1fr); gap: .65rem; }
        }
        body.app-shell .main-container.theme-light .report-select {
          border-color: #9bbda3 !important;
          background: #ffffff !important;
          color: #1f2937 !important;
          box-shadow: inset 0 1px 2px rgba(31, 41, 55, .04) !important;
        }
        body.app-shell .main-container.theme-light .report-select:focus {
          border-color: #4b8b5b !important;
          background: #ffffff !important;
          box-shadow: 0 0 0 3px rgba(34, 110, 61, .12) !important;
        }
        body.app-shell .main-container.theme-light .report-select option {
          background: #ffffff !important;
          color: #1f2937 !important;
        }
        .page-hero-card {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 1rem;
          padding: 1.35rem 1.35rem 1.4rem;
          border-radius: 24px;
          border: 1px solid var(--border);
          background: var(--panel);
          box-shadow: var(--shadow);
          backdrop-filter: blur(16px) saturate(1.04);
          margin-bottom: 1.5rem;
        }
        body.app-shell .main-container.theme-light .reports-page-hero {
          border-color: #d7e3da !important;
          background: #ffffff !important;
          color: #1f2937 !important;
          box-shadow: 0 8px 24px rgba(31, 41, 55, .07) !important;
        }
        body.app-shell .main-container.theme-light .reports-page-hero .page-title {
          color: #1f2937 !important;
        }
        body.app-shell .main-container.theme-light .reports-page-hero .page-hero-student-badge {
          border-color: rgba(74, 222, 128, .32) !important;
          background: #04281b !important;
          color: #ffffff !important;
          box-shadow: 0 4px 14px rgba(4, 40, 27, .18) !important;
        }
        body.app-shell .main-container.theme-light .reports-page-hero .page-hero-student-badge #adminBadgeRole {
          color: #6ee7b7 !important;
        }
        body.app-shell .main-container.theme-light .reports-page-hero .page-hero-student-badge #adminBadgeName {
          color: #ffffff !important;
        }
        body.app-shell .main-container.theme-light .reports-page-hero .page-hero-student-badge #adminBadgeAvatar {
          border-color: rgba(74, 222, 128, .4) !important;
          background: #06402b !important;
          color: #a7f3d0 !important;
        }
        body.app-shell .main-container.theme-light .reports-export-notice,
        body.app-shell .main-container.theme-light .report-empty-state {
          border-color: #a7d9b8 !important;
          background: #ecfdf3 !important;
          color: #17452a !important;
          box-shadow: 0 4px 14px rgba(21, 128, 61, .08) !important;
        }
        .report-card-surface {
          background: var(--panel);
          border: 1px solid var(--border);
          box-shadow: var(--shadow);
        }
        body.app-shell .main-container.theme-dark .report-card-surface {
          background: linear-gradient(180deg, #0f241b, #0a1d15) !important;
          border-color: rgba(74,222,128,.18) !important;
          color: #f8fafc !important;
        }
        body.app-shell .main-container.theme-light .report-card-surface {
          background: #ffffff !important;
          border-color: #d7e3da !important;
          color: #1f2937 !important;
          box-shadow: 0 8px 24px rgba(31,41,55,.07) !important;
        }
        .report-table-shell {
          max-height: min(56vh, 42rem);
          overflow: auto !important;
          background: #07150f !important;
          border: 1px solid rgba(74,222,128,.18) !important;
          border-radius: .9rem !important;
          box-shadow: none !important;
          padding: 0 !important;
          scrollbar-gutter: stable;
        }
        #reportPreviewTable {
          border-collapse: collapse !important;
          border-spacing: 0 !important;
        }
        #reportPreviewTable thead,
        .report-preview-table thead tr {
          background: #04120c !important;
          border-radius: 0 !important;
          box-shadow: none !important;
        }
        #reportPreviewTable thead th,
        #reportPreviewTable thead th.theme-locked-table-header {
          position: sticky !important;
          top: 0;
          z-index: 5;
          color: #d1fae5 !important;
          font-size: .95rem !important;
          padding: .9rem 1rem !important;
          background: #04120c !important;
          border: 0 !important;
          border-bottom: 1px solid rgba(6, 78, 59, .5) !important;
          border-radius: 0 !important;
          box-shadow: none !important;
          text-align: left !important;
          vertical-align: bottom;
          white-space: nowrap;
        }
        body.app-shell .main-container.theme-dark .report-preview-table thead,
        body.app-shell .main-container.theme-dark .report-preview-table thead tr,
        body.app-shell .main-container.theme-dark .report-preview-table thead th {
          background: #04120c !important;
          color: #f9fafb !important;
          border-bottom: 1px solid rgba(148,163,184,.22) !important;
        }
        body.app-shell .main-container.theme-light .report-preview-table thead,
        body.app-shell .main-container.theme-light .report-preview-table thead tr,
        body.app-shell .main-container.theme-light .report-preview-table thead th {
          background: #0a2e1d !important;
          color: #d1fae5 !important;
          border-bottom: 1px solid #174b34 !important;
        }
        #reportPreviewTable tbody {
          background: #07150f !important;
        }
        body.app-shell .main-container .report-table-shell #reportPreviewTable tbody tr {
          background: #07150f !important;
          background-image: none !important;
          border: 0 !important;
          border-radius: 0 !important;
          box-shadow: none !important;
          color: #f9fafb !important;
        }
        body.app-shell .main-container.theme-dark .report-table-shell {
          background: #07150f !important;
          border-color: rgba(148,163,184,.2) !important;
        }
        body.app-shell .main-container.theme-dark #reportPreviewTable tbody tr:nth-child(even) {
          background: #0a1d15 !important;
        }
        body.app-shell .main-container.theme-dark #reportPreviewTable tbody td {
          border-bottom-color: rgba(148,163,184,.18) !important;
        }
        body.app-shell .main-container .report-table-shell #reportPreviewTable tbody tr:hover {
          background: #0a2e1d !important;
        }
        body.app-shell .main-container.theme-light .report-table-shell {
          background: #ffffff !important;
          border-color: #cbd8cf !important;
        }
        body.app-shell .main-container.theme-light #reportPreviewTable tbody {
          background: #ffffff !important;
        }
        body.app-shell .main-container.theme-light .report-table-shell #reportPreviewTable tbody tr,
        body.app-shell .main-container.theme-light .report-table-shell #reportPreviewTable tbody tr:nth-child(odd) {
          background: #ffffff !important;
          color: #1f2937 !important;
        }
        body.app-shell .main-container.theme-light .report-table-shell #reportPreviewTable tbody tr:nth-child(even) {
          background: #f5f8f6 !important;
          color: #1f2937 !important;
        }
        body.app-shell .main-container.theme-light .report-table-shell #reportPreviewTable tbody tr:hover {
          background: #eaf5ed !important;
        }
        body.app-shell .main-container .report-table-shell #reportPreviewTable tbody td,
        body.app-shell .main-container .report-table-shell #reportPreviewTable tbody tr > td {
          background: transparent !important;
          color: #d1fae5 !important;
          font-size: 1rem !important;
          line-height: 1.5 !important;
          padding: .9rem 1rem !important;
          border: 0 !important;
          border-bottom: 1px solid rgba(74, 222, 128, .2) !important;
          border-radius: 0 !important;
          box-shadow: none !important;
        }
        body.app-shell .main-container.theme-light .report-table-shell #reportPreviewTable tbody td,
        body.app-shell .main-container.theme-light .report-table-shell #reportPreviewTable tbody tr > td {
          color: #1f2937 !important;
          border-bottom-color: #dfe7e1 !important;
        }
        body.app-shell .main-container.theme-light #previewReportTitle,
        body.app-shell .main-container.theme-light #reportCountText,
        body.app-shell .main-container.theme-light #previewGeneratedAt {
          color: #1f2937 !important;
        }
        .reports-export-notice {
          border: 0 !important;
          border-radius: 0 !important;
          background: transparent !important;
          box-shadow: none !important;
          color: #b6d7c8 !important;
          padding: 0 !important;
        }
        .report-access-notice {
          max-width: 42rem;
          margin: 0 auto;
          padding: 1.25rem;
          border: 0;
          border-radius: 0;
          background: transparent;
          box-shadow: none;
          backdrop-filter: none;
          color: #b6d7c8;
          text-align: center;
        }
        .report-access-notice-title {
          color: #6ee7b7;
          font-weight: 800;
          letter-spacing: .12em;
          text-transform: uppercase;
        }
        .report-access-notice-total {
          margin-top: .5rem;
          color: #f0fdf4;
          font-size: 1.5rem;
          font-weight: 800;
        }
        .report-access-notice p {
          margin-top: .5rem;
          color: #b6d7c8;
          line-height: 1.5;
        }
        .report-empty-state {
          background: linear-gradient(180deg, rgba(11,26,19,.98), rgba(8,20,14,.96));
          border: 1px solid var(--border);
          color: #d1fae5;
        }
        .report-empty-state i { color: #22c55e; font-size: 1.3rem; }
        .report-empty-state strong { display: block; margin-top: .45rem; font-size: .95rem; }
        .report-empty-state p { margin: .25rem 0 0; color: inherit; opacity: .78; }
        #summaryCards > div {
          background: var(--panel);
          border: 1px solid var(--border);
          box-shadow: var(--shadow);
        }
        body.app-shell .main-container.theme-light #summaryCards > div {
          border-color: #d1d5db !important;
          background: #ffffff !important;
          box-shadow: 0 4px 12px rgba(17, 24, 39, .08) !important;
        }
        body.app-shell .main-container.theme-light #summaryCards > div > p {
          color: #000 !important;
        }
        #summaryCards > div {
          display: flex;
          min-height: 5.25rem;
          flex-direction: column;
          justify-content: space-between;
          gap: .55rem;
          padding: 1rem !important;
        }
        #summaryCards .report-summary-value {
          margin: 0;
          font-size: 2rem !important;
          font-weight: 800 !important;
          line-height: 1;
          letter-spacing: -.035em;
        }
        #summaryCards .report-summary-label {
          margin: 0;
          font-weight: 700;
          letter-spacing: .18em;
        }
        body.app-shell .main-container.theme-dark #summaryCards > div.report-summary-warning {
          border-color: rgba(251,146,60,.55) !important;
          background: linear-gradient(140deg, rgba(124,45,18,.35), rgba(11,26,19,.96)) !important;
        }
        body.app-shell .main-container.theme-dark #summaryCards > div.report-summary-warning > p {
          color: #fed7aa !important;
        }
        body.app-shell .main-container.theme-light #summaryCards > div.report-summary-warning {
          border-color: #fdba74 !important;
          background: #fff7ed !important;
        }
        body.app-shell .main-container.theme-light #summaryCards > div.report-summary-warning > p {
          color: #9a3412 !important;
        }
        #reportPagination button {
          border: 1px solid rgba(74,222,128,.18);
          background: #06100b;
          color: #d1fae5;
        }
        #reportPagination button:hover:not(:disabled) {
          background: rgba(34,197,94,.12);
          border-color: rgba(74,222,128,.3);
        }
        #reportPagination button.active {
          background: linear-gradient(135deg, #22C55E, #16A34A);
          color: #06100b;
          border-color: rgba(74,222,128,.2);
        }
        #generateReportButton {
          background: linear-gradient(135deg, #16A34A, #22C55E);
          color: #f0fdf4;
          border-radius: 999px;
          border: 1px solid rgba(74,222,128,.2);
          font-weight: 700;
          box-shadow: 0 10px 24px rgba(6,64,43,.16);
        }
        #generateReportButton:hover:not(:disabled) {
          background: linear-gradient(135deg, #22C55E, #4ADE80);
        }
        button[onclick*="exportReport"] {
          background: transparent;
          border: 1px solid rgba(74, 222, 128, .42);
          color: #064e3b;
          border-radius: 999px;
          box-shadow: none;
        }
        button[onclick*="exportReport"]:hover {
          background: rgba(34,197,94,.08);
          border-color: rgba(74, 222, 128, .42);
        }
        body.app-shell .main-container.theme-dark button[onclick*="exportReport"],
        body.app-shell .main-container.theme-dark #resetReportFilters {
          color: #d1fae5 !important;
        }
        body.app-shell .main-container.theme-dark button[onclick*="exportReport"]:hover,
        body.app-shell .main-container.theme-dark #resetReportFilters:hover {
          background: rgba(34,197,94,.12) !important;
        }
        body.app-shell .main-container.theme-light button[onclick*="exportReport"],
        body.app-shell .main-container.theme-light #resetReportFilters {
          background: #ffffff !important;
          color: #065f46 !important;
          border-color: #9bbda3 !important;
        }
        body.app-shell .main-container.theme-light button[onclick*="exportReport"]:hover,
        body.app-shell .main-container.theme-light #resetReportFilters:hover {
          background: #ecfdf3 !important;
        }
        .page-hero-meta {
          display: flex;
          flex-direction: column;
          gap: 0.45rem;
        }
        .page-eyebrow {
          font-size: 0.78rem;
          font-weight: 700;
          letter-spacing: 0.24em;
          text-transform: uppercase;
          color: rgba(110, 231, 183, 0.72);
          margin: 0;
        }
        .page-title {
          font-size: 2rem;
          font-weight: 800;
          color: #f8fafc;
          line-height: 1.15;
          letter-spacing: -0.02em;
          margin: 0;
        }
        .page-subtitle {
          color: #cbd5e1;
          font-size: 0.95rem;
          line-height: 1.5;
          margin: 0;
          max-width: 44rem;
        }
        .page-hero-badge {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 3rem;
          height: 3rem;
          border-radius: 1rem;
          background: rgba(74,222,128,.14);
          color: #f8fafc;
          border: 1px solid rgba(74,222,128,.18);
          box-shadow: inset 0 1px 0 rgba(255,255,255,.06);
          flex-shrink: 0;
        }
        @media (max-width: 1023px) {
          .page-hero-card {
            gap: 16px;
          }
          .page-hero-card > .menu-toggle {
            position: static !important;
            flex-shrink: 0;
          }
        }
        @media (max-width: 480px) {
          .page-hero-card {
            flex-wrap: wrap;
          }
          .page-hero-card > .page-hero-meta {
            flex: 1 1 auto;
            min-width: 0;
            padding-left: 0;
          }
          .page-hero-card > .page-hero-student-badge {
            margin-left: 3.5rem;
          }
        }
      </style>
      <header class="system-dashboard-heading reports-page-header" data-comlab-hide-auto-title="true">
        <div class="system-dashboard-heading-main">
          <button id="mobileMenuToggle" class="menu-toggle" type="button" aria-label="Open navigation" onclick="toggleSidebar()">
            <i class="fas fa-bars" aria-hidden="true"></i>
          </button>
        </div>
        <div class="system-dashboard-heading-actions">
          <div class="inline-flex shrink-0 items-center" data-theme-toggle-anchor></div>
          <div class="system-profile-badge profile-theme-static bg-[#04281b] text-white">
            <span class="system-profile-badge-avatar bg-[#06402b] text-emerald-300" id="adminBadgeAvatar">AD</span>
            <span class="system-profile-badge-copy text-white">
              <span class="system-profile-badge-name text-white" id="adminBadgeName">Administrator</span>
              <span class="system-profile-badge-role text-emerald-400" id="adminBadgeRole">Admin</span>
            </span>
          </div>
        </div>
      </header>

      <section class="card mb-6 report-card-surface panel-card report-builder-card" style="padding: 1rem;">
        <div class="report-builder-intro">
          <span class="report-builder-icon" aria-hidden="true"><i class="fas fa-sliders-h"></i></span>
          <div>
            <h2>Build a report</h2>
            <p>Choose a report type. The preview updates automatically as you adjust filters.</p>
          </div>
        </div>
        <div id="reportFiltersForm" class="grid gap-4">
          <div class="report-filter-grid">
            <div>
              <label class="block text-sm font-semibold text-emerald-100/80 mb-1.5">Report Type</label>
              <select id="reportTypeSelect" class="form-control report-select">
                <option>Equipment Inventory</option>
                <option>Borrow Equipment</option>
                <option>Maintenance</option>
                <option>Attendance</option>
                <option>User Activity</option>
              </select>
            </div>
            <div id="campusFilterField" class="report-filter-field">
              <label class="block text-sm font-semibold text-emerald-100/80 mb-1.5">Campus</label>
              <select id="campusFilter" class="form-control report-select">
                <option value="">All Campuses</option>
              </select>
            </div>
            <div id="reportPeriodField" class="report-filter-field">
              <label class="block text-sm font-semibold text-emerald-100/80 mb-1.5">Report Period</label>
              <select id="reportPeriodFilter" class="form-control report-select">
                <option value="all">All Records</option>
                <option value="today">Today</option>
                <option value="week">This Week</option>
                <option value="month">This Month</option>
                <option value="semester">This Semester</option>
                <option value="school-year">This School Year</option>
                <option value="custom">Custom Date Range</option>
              </select>
            </div>
            <div id="laboratoryFilterField" class="report-filter-field">
              <label class="block text-sm font-semibold text-emerald-100/80 mb-1.5">Laboratory</label>
              <select id="laboratoryFilter" class="form-control report-select">
                <option value="">All Laboratories</option>
              </select>
            </div>
            <div id="statusFilterField" class="report-filter-field">
              <label id="statusFilterLabel" class="block text-sm font-semibold text-emerald-100/80 mb-1.5">Status</label>
              <select id="statusFilter" class="form-control report-select">
                <option value="">All Statuses</option>
              </select>
            </div>
            <div id="technicianFilterField" class="report-filter-field" hidden>
              <label class="block text-sm font-semibold text-emerald-100/80 mb-1.5" for="technicianFilter">Technician</label>
              <select id="technicianFilter" class="form-control report-select"><option value="">All Technicians</option></select>
            </div>
            <div id="issueTypeFilterField" class="report-filter-field" hidden>
              <label class="block text-sm font-semibold text-emerald-100/80 mb-1.5" for="issueTypeFilter">Issue Type</label>
              <select id="issueTypeFilter" class="form-control report-select"><option value="">All Issue Types</option></select>
            </div>
            <div id="reportSearchField" class="report-filter-field">
              <label id="reportSearchLabel" class="block text-sm font-semibold text-emerald-100/80 mb-1.5" for="reportSearchInput">Search</label>
              <div class="report-search-actions">
                <div class="report-search-control">
                  <i class="fas fa-search" aria-hidden="true"></i>
                  <input id="reportSearchInput" type="search" class="form-control report-select" placeholder="Search matching records" autocomplete="off">
                  <button id="reportSearchClear" type="button" class="report-search-clear" aria-label="Clear search" title="Clear search" hidden><i class="fas fa-xmark" aria-hidden="true"></i></button>
                </div>
                <div id="reportActionsMenuWrap" class="report-actions-menu-wrap">
                  <button id="reportActionsToggle" type="button" class="report-actions-toggle" aria-label="Report actions" title="Report actions" aria-haspopup="menu" aria-expanded="false" aria-controls="reportActionsMenu">
                    <i class="fas fa-ellipsis-vertical" aria-hidden="true"></i>
                  </button>
                  <div id="reportActionsMenu" class="report-actions-menu" role="menu" aria-label="Report actions" hidden>
                    <button type="button" role="menuitem" data-report-export onclick="exportReport('pdf-preview')" class="report-actions-menu-item"><i class="fas fa-eye" aria-hidden="true"></i> Preview PDF</button>
                    <button type="button" role="menuitem" data-report-export onclick="exportReport('pdf')" class="report-actions-menu-item"><i class="fas fa-file-pdf" aria-hidden="true"></i> Export PDF</button>
                    <button type="button" role="menuitem" data-report-export onclick="exportReport('print')" class="report-actions-menu-item"><i class="fas fa-print" aria-hidden="true"></i> Print Report</button>
                    <button type="button" role="menuitem" data-report-export onclick="exportReport('csv')" class="report-actions-menu-item"><i class="fas fa-file-csv" aria-hidden="true"></i> Export CSV</button>
                    <div class="report-actions-menu-divider" role="separator"></div>
                    <button id="resetReportFilters" type="button" role="menuitem" class="report-actions-menu-item"><i class="fas fa-rotate-left" aria-hidden="true"></i> Reset Filters</button>
                  </div>
                </div>
              </div>
            </div>
            <div id="customDateRangeFields" class="report-custom-date-fields" hidden>
              <div>
                <label class="block text-sm font-semibold text-emerald-100/80 mb-1.5" for="reportDateFromFilter">From</label>
                <input id="reportDateFromFilter" type="date" class="form-control report-select">
              </div>
              <div>
                <label class="block text-sm font-semibold text-emerald-100/80 mb-1.5" for="reportDateToFilter">To</label>
                <input id="reportDateToFilter" type="date" class="form-control report-select">
              </div>
            </div>

          </div>
        </div>
      </section>

      <section class="card mb-6 report-card-surface panel-card" style="">
        <div class="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p class="text-sm uppercase tracking-[0.35em] text-emerald-400/80"></p>
            <h3 id="previewReportTitle" class="mt-2 text-xl font-semibold text-white"></h3>
            <p id="reportCountText" class="mt-1 text-sm text-emerald-100/70"></p>
            <div id="generatedMeta" class="mt-2 flex flex-wrap gap-2 text-xs text-emerald-100/60">
              <span id="previewGeneratedAt"></span>
            </div>
          </div>
          <div class="reports-export-notice rounded-3xl border border-emerald-700/60 bg-[#06100b] px-4 py-3 text-sm text-emerald-100/70">Preview and exports follow the selected filters.</div>
        </div>

        <div id="summaryCards" class="panel-card mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4"></div>

        <div class="report-table-shell panel-card mt-5 overflow-x-auto rounded-3xl p-2">
          <table id="reportPreviewTable" class="report-preview-table min-w-full border-collapse text-left text-sm text-emerald-50/90">
            <thead class="bg-[#06100b]">
              <tr id="reportTableHeader"></tr>
            </thead>
            <tbody id="reportTableBody"></tbody>
          </table>
        </div>
        <div id="reportPagination" class="mt-3 flex flex-wrap items-center justify-end gap-2"></div>

        <div id="reportEmptyState" class="report-empty-state mt-6 rounded-3xl px-5 py-8 text-center text-sm text-emerald-100/70">
          <i id="reportEmptyIcon" class="fas fa-magnifying-glass" aria-hidden="true"></i>
          <strong id="reportEmptyTitle">Loading report preview</strong>
          <p id="reportEmptyMessage">Your preview will update automatically when data is ready.</p>
        </div>
      </section>

      <div id="reportPdfPreviewModal" class="fixed inset-0 z-[100] hidden items-center justify-center bg-slate-950/80 p-3 sm:p-6" role="dialog" aria-modal="true" aria-labelledby="reportPdfPreviewTitle">
        <div class="flex h-[94vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-emerald-800/30 bg-white text-slate-900 shadow-2xl">
          <header class="flex items-center justify-between gap-4 border-b border-slate-200 px-4 py-3 sm:px-6">
            <div class="min-w-0">
              <h2 id="reportPdfPreviewTitle" class="font-semibold">PDF preview</h2>
              <p id="reportPdfPreviewFilename" class="truncate text-xs text-slate-500"></p>
            </div>
            <button type="button" onclick="closeReportPdfPreview()" class="inline-flex shrink-0 items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold hover:bg-slate-100" aria-label="Close PDF preview">
              <i class="fas fa-xmark" aria-hidden="true"></i> Close
            </button>
          </header>
          <iframe id="reportPdfPreviewFrame" title="Generated report PDF preview" class="min-h-0 w-full flex-1 bg-slate-200"></iframe>
          <footer class="flex flex-wrap items-center justify-end gap-2 border-t border-slate-200 px-4 py-3 sm:px-6">
            <button type="button" onclick="closeReportPdfPreview()" class="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold hover:bg-slate-100">Cancel</button>
            <button type="button" onclick="downloadReportPdfPreview()" class="inline-flex items-center gap-2 rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800">
              <i class="fas fa-download" aria-hidden="true"></i> Download PDF
            </button>
          </footer>
        </div>
      </div>

      <script src="https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js"></script>
      <script src="https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.5.0/jspdf.plugin.autotable.min.js"></script>
      <script src="/js/reports-page.js?v=20261104"></script>
    `
  },
  "maintenance-queue": {
    title: "Maintenance Queue",
    description: "Track incoming equipment issues assigned to technicians.",
    backRoute: "/technician-dashboard",
    backLabel: "Back to Technician Dashboard",
    content: `
      <section class="table-card mb-6">
        <div class="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-5">
          <div>
            <h3 class="text-xl font-semibold text-gray-900">Open Requests</h3>
            <p class="text-sm text-gray-600">Review and accept pending maintenance tasks.</p>
          </div>
          <button class="inline-flex items-center gap-2 px-4 py-3 rounded-xl bg-green-600 text-white hover:bg-green-700">
            <i class="fas fa-plus"></i> New Request
          </button>
        </div>
        <div class="overflow-x-auto">
          <table class="min-w-full text-left divide-y divide-gray-200 text-sm text-gray-700">
            <thead class="bg-gray-50">
              <tr>
                <th class="px-4 py-3">Request</th>
                <th class="px-4 py-3">Equipment</th>
                <th class="px-4 py-3">Priority</th>
                <th class="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-100">
              <tr class="hover:bg-gray-50">
                <td class="px-4 py-4">Replace sensor board</td>
                <td class="px-4 py-4">3D Printer #2</td>
                <td class="px-4 py-4"><span class="px-3 py-1 rounded-full bg-red-100 text-red-700">High</span></td>
                <td class="px-4 py-4"><span class="px-3 py-1 rounded-full bg-amber-100 text-amber-700">Pending</span></td>
              </tr>
              <tr class="hover:bg-gray-50">
                <td class="px-4 py-4">Calibrate oscilloscope</td>
                <td class="px-4 py-4">Oscilloscope 101</td>
                <td class="px-4 py-4"><span class="px-3 py-1 rounded-full bg-yellow-100 text-yellow-700">Medium</span></td>
                <td class="px-4 py-4"><span class="px-3 py-1 rounded-full bg-emerald-100 text-emerald-700">In progress</span></td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    `
  },
  "repair-history": {
    title: "Repair History",
    description: "Review completed repairs and equipment maintenance logs.",
    backRoute: "/technician-dashboard",
    backLabel: "Back to Technician Dashboard",
    content: `
      <section class="table-card">
        <div class="mb-5">
          <h3 class="text-xl font-semibold text-gray-900">Completed Repairs</h3>
          <p class="text-sm text-gray-600">Historical repair records with service details.</p>
        </div>
        <div class="overflow-x-auto">
          <table class="min-w-full text-left divide-y divide-gray-200 text-sm text-gray-700">
            <thead class="bg-gray-50">
              <tr>
                <th class="px-4 py-3">Date</th>
                <th class="px-4 py-3">Equipment</th>
                <th class="px-4 py-3">Issue</th>
                <th class="px-4 py-3">Technician</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-100">
              <tr class="hover:bg-gray-50">
                <td class="px-4 py-4">May 28, 2026</td>
                <td class="px-4 py-4">3D Printer #1</td>
                <td class="px-4 py-4">Extruder rebuild</td>
                <td class="px-4 py-4">Liza Tan</td>
              </tr>
              <tr class="hover:bg-gray-50">
                <td class="px-4 py-4">May 21, 2026</td>
                <td class="px-4 py-4">Cooling System</td>
                <td class="px-4 py-4">Pump replacement</td>
                <td class="px-4 py-4">Marco Lim</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    `
  },
  "statistics": {
    title: "Statistics",
    description: "See performance metrics for equipment and lab usage.",
    backRoute: "/admin-dashboard",
    backLabel: "Back to Admin Dashboard",
    content: `
      <section class="grid gap-4 md:grid-cols-3 mb-6">
        <div class="card">
          <p class="text-sm uppercase tracking-wide text-gray-500">Uptime</p>
          <h2 class="mt-3 text-3xl font-bold text-gray-900">97%</h2>
        </div>
        <div class="card">
          <p class="text-sm uppercase tracking-wide text-gray-500">Utilization</p>
          <h2 class="mt-3 text-3xl font-bold text-green-600">82%</h2>
        </div>
        <div class="card">
          <p class="text-sm uppercase tracking-wide text-gray-500">Issues Logged</p>
          <h2 class="mt-3 text-3xl font-bold text-gray-900">15</h2>
        </div>
      </section>
      <div class="table-card">
        <h3 class="text-xl font-semibold text-gray-900 mb-4">Summary Metrics</h3>
        <div class="grid gap-4 md:grid-cols-2">
          <div class="rounded-3xl bg-gray-50 p-5 border border-gray-200">
            <p class="font-medium text-gray-900">Equipment Availability</p>
            <p class="mt-2 text-sm text-gray-600">Current serviceable equipment is performing above target.</p>
          </div>
          <div class="rounded-3xl bg-gray-50 p-5 border border-gray-200">
            <p class="font-medium text-gray-900">Student Check-in Rate</p>
            <p class="mt-2 text-sm text-gray-600">Average attendance continues to improve this term.</p>
          </div>
        </div>
      </div>
    `
  },
  "schedule": {
    title: "Schedule",
    description: "View your upcoming sessions and personal timetable.",
    backRoute: "/student-dashboard",
    backLabel: "Back to Student Dashboard",
    content: `
      <section class="grid gap-4 md:grid-cols-3 mb-6">
        <div class="card sm">
          <p class="text-sm uppercase tracking-wide text-gray-500">Next Class</p>
          <h2 class="mt-3 text-3xl font-bold text-gray-900">Network Lab</h2>
          <p class="text-sm text-gray-600 mt-2">Jun 4, 2026 • 9:00 AM</p>
        </div>
        <div class="card sm">
          <p class="text-sm uppercase tracking-wide text-gray-500">Credits</p>
          <h2 class="mt-3 text-3xl font-bold text-green-600">18</h2>
        </div>
        <div class="card sm">
          <p class="text-sm uppercase tracking-wide text-gray-500">Lab Sessions</p>
          <h2 class="mt-3 text-3xl font-bold text-gray-900">5</h2>
        </div>
      </section>
      <div class="card">
        <div class="flex items-center justify-between mb-5">
          <div>
            <h3 class="text-xl font-semibold text-gray-900">Weekly Timetable</h3>
            <p class="text-sm text-gray-600">Your classes and lab sessions for the current week.</p>
          </div>
        </div>
        <div class="grid gap-4 md:grid-cols-2">
          <div class="rounded-3xl bg-gray-50 p-5 border border-gray-200">
            <p class="font-semibold text-gray-800">Thursday</p>
            <p class="text-sm text-gray-600 mt-2">Network Lab • 9:00 AM - 11:00 AM • Room 302</p>
          </div>
          <div class="rounded-3xl bg-gray-50 p-5 border border-gray-200">
            <p class="font-semibold text-gray-800">Friday</p>
            <p class="text-sm text-gray-600 mt-2">Robotics • 1:00 PM - 3:00 PM • Room 204</p>
          </div>
        </div>
      </div>
    `
  },
  "my-attendance": {
    title: "My Attendance",
    description: "Track your own attendance history and class participation.",
    backRoute: "/student-dashboard",
    backLabel: "Back to Student Dashboard",
    content: `
      <section class="grid gap-4 md:grid-cols-3 mb-6">
        <div class="card sm">
          <p class="text-sm uppercase tracking-wide text-gray-500">Days Present</p>
          <h2 class="mt-3 text-3xl font-bold text-green-600">42</h2>
        </div>
        <div class="card sm">
          <p class="text-sm uppercase tracking-wide text-gray-500">Days Absent</p>
          <h2 class="mt-3 text-3xl font-bold text-red-600">3</h2>
        </div>
        <div class="card sm">
          <p class="text-sm uppercase tracking-wide text-gray-500">Late</p>
          <h2 class="mt-3 text-3xl font-bold text-amber-600">1</h2>
        </div>
      </section>
      <div class="card">
        <h3 class="text-xl font-semibold text-gray-900 mb-4">Attendance Record</h3>
        <div class="overflow-x-auto">
          <table class="min-w-full text-left divide-y divide-gray-200 text-sm text-gray-700">
            <thead class="bg-gray-50">
              <tr>
                <th class="px-4 py-3">Date</th>
                <th class="px-4 py-3">Class</th>
                <th class="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-100">
              <tr class="hover:bg-gray-50">
                <td class="px-4 py-4">Jun 3, 2026</td>
                <td class="px-4 py-4">Automation Lab</td>
                <td class="px-4 py-4"><span class="px-3 py-1 rounded-full bg-emerald-100 text-emerald-700">Present</span></td>
              </tr>
              <tr class="hover:bg-gray-50">
                <td class="px-4 py-4">Jun 1, 2026</td>
                <td class="px-4 py-4">Power Systems</td>
                <td class="px-4 py-4"><span class="px-3 py-1 rounded-full bg-green-100 text-green-700">Present</span></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    `
  },
  "report-damage": {
    title: "Report Damage",
    description: "Submit new damage reports for broken or malfunctioning equipment.",
    backRoute: "/student-dashboard",
    backLabel: "Back to Student Dashboard",
    content: `
      <section class="card">
        <h3 class="text-xl font-semibold text-gray-900 mb-4">Report Damaged Equipment</h3>
        <form class="space-y-5">
          <div>
            <label class="block text-sm font-medium text-gray-700">Equipment</label>
            <input type="text" placeholder="3D Printer #2" class="mt-2 w-full px-4 py-3 border border-gray-200 rounded-xl focus:outline-none focus:border-green-600" />
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700">Location</label>
            <input type="text" placeholder="Electronics Lab" class="mt-2 w-full px-4 py-3 border border-gray-200 rounded-xl focus:outline-none focus:border-green-600" />
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700">Description</label>
            <textarea rows="5" placeholder="Describe the issue..." class="mt-2 w-full px-4 py-3 border border-gray-200 rounded-xl focus:outline-none focus:border-green-600"></textarea>
          </div>
          <button class="inline-flex items-center gap-2 px-5 py-3 bg-green-600 text-white rounded-xl hover:bg-green-700">Submit report</button>
        </form>
      </section>
    `
  },
  "feedback": {
    title: "Feedback",
    description: "Send suggestions or report issues to the ComLab team.",
    backRoute: "/student-dashboard",
    backLabel: "Back to Student Dashboard",
    content: `
      <section class="grid gap-4 md:grid-cols-2 mb-6">
        <div class="card sm">
          <h3 class="text-lg font-semibold text-gray-900">Need help?</h3>
          <p class="mt-2 text-sm text-gray-600">Send feedback about lab equipment, schedules, or system improvements.</p>
        </div>
        <div class="card sm">
          <h3 class="text-lg font-semibold text-gray-900">Recent Responses</h3>
          <p class="mt-2 text-sm text-gray-600">Our team aims to respond within 24 hours.</p>
        </div>
      </section>
      <section class="card">
        <form class="space-y-5">
          <div>
            <label class="block text-sm font-medium text-gray-700">Subject</label>
            <input type="text" placeholder="Feedback subject" class="mt-2 w-full px-4 py-3 border border-gray-200 rounded-xl focus:outline-none focus:border-green-600" />
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700">Message</label>
            <textarea rows="6" placeholder="Write your feedback here..." class="mt-2 w-full px-4 py-3 border border-gray-200 rounded-xl focus:outline-none focus:border-green-600"></textarea>
          </div>
          <button class="inline-flex items-center gap-2 px-5 py-3 bg-green-600 text-white rounded-xl hover:bg-green-700">Submit feedback</button>
        </form>
      </section>
    `
  },
  "maintenance-requests": {
    title: "Maintenance Requests",
    description: "Manage assigned maintenance jobs and technician tasks.",
    backRoute: "/technician-dashboard",
    backLabel: "Back to Technician Dashboard",
    content: `
      <section class="table-card mb-6">
        <div class="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-5">
          <div>
            <h3 class="text-xl font-semibold text-gray-900">Active Maintenance</h3>
            <p class="text-sm text-gray-600">Track open requests and update progress.</p>
          </div>
          <button class="inline-flex items-center gap-2 px-4 py-3 rounded-xl bg-green-600 text-white hover:bg-green-700">
            <i class="fas fa-check"></i> Mark Complete
          </button>
        </div>
        <div class="overflow-x-auto">
          <table class="min-w-full text-left divide-y divide-gray-200 text-sm text-gray-700">
            <thead class="bg-gray-50">
              <tr>
                <th class="px-4 py-3">Request</th>
                <th class="px-4 py-3">Status</th>
                <th class="px-4 py-3">Assigned</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-100">
              <tr class="hover:bg-gray-50">
                <td class="px-4 py-4">Sensor calibration</td>
                <td class="px-4 py-4"><span class="px-3 py-1 rounded-full bg-amber-100 text-amber-700">In progress</span></td>
                <td class="px-4 py-4">Carlos</td>
              </tr>
              <tr class="hover:bg-gray-50">
                <td class="px-4 py-4">Replace broken PSU</td>
                <td class="px-4 py-4"><span class="px-3 py-1 rounded-full bg-red-100 text-red-700">Pending</span></td>
                <td class="px-4 py-4">Mia</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    `
  }
};

const serveHtmlPage = (req, res) => {
  const page = req.params.page || req.path.replace(/^\//, "");
  if (!staticHtmlPages.includes(page)) return res.status(404).send("Page not found");

  if (page === "attendance" && req.query?.token) {
    return scanAttendance(req, res);
  }

  // Add no-cache headers to prevent stale HTML
  res.set({
    'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
    'Pragma': 'no-cache',
    'Expires': '0',
    'Surrogate-Control': 'no-store'
  });

  // Determine subfolder based on page type
  let subfolder = "";
  if (page.startsWith("admin-") || page === "attendance" || page === "borrow-equipment" || page === "equipment-inventory" || page === "equipment-assignment" || page === "maintenance-reports") {
    subfolder = "admin/";
  } else if (page.startsWith("faculty-")) {
    subfolder = "faculty/";
  } else if (page.startsWith("student-") || page === "my-pc-station") {
    subfolder = "student/";
  } else if (page.startsWith("technician-")) {
    subfolder = "technician/";
  }

  const dashboardPath = path.join(process.cwd(), "views", subfolder, `${page}.html`);
  const currentUserId = req.session?.userId;

  const loadDashboard = async () => {
    if (!currentUserId) {
      return res.redirect("/login");
    }

    let currentUser = null;

    const user = await User.findByPk(currentUserId, {
      attributes: ["name", "email", "role", "student_number", "college", "program", "year", "section", "campus", "photo"]
    });

    if (user) {
      const normalizedRole = normalizeRoleName(user.role);
      const adminPages = new Set(["admin-dashboard", "admin-profile", "admin-computer-labs", "admin-facilities", "admin-faculty-management", "admin-user-management", "admin-technician-accomplishments", "attendance", "maintenance-reports", "equipment-assignment"]);
      if (page === "student-dashboard" && ["faculty", "instructor"].includes(normalizedRole)) {
        return res.redirect("/faculty-dashboard");
      }
      if (page === "student-dashboard" && normalizedRole !== "student") {
        return res.status(403).send("Forbidden: Student access required.");
      }
      if (page.startsWith("faculty-") && !["faculty", "instructor"].includes(normalizedRole)) {
        return res.status(403).send("Forbidden: Faculty access required.");
      }
      if (page.startsWith("technician-") && normalizedRole !== "technician") {
        return res.status(403).send("Forbidden: Technician access required.");
      }
      if (adminPages.has(page) && !isAdminRole(normalizedRole)) {
        return res.status(403).send("Forbidden: admin access required.");
      }
      if (["borrow-equipment", "equipment-inventory"].includes(page) &&
          !isAdminRole(normalizedRole) && normalizedRole !== "technician") {
        return res.status(403).send("Forbidden: staff access required.");
      }

      const userName = user.name || (page.startsWith("student-") || page === "my-pc-station" ? "Student" : "Technician");
      const initials = userName
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map(part => part.charAt(0).toUpperCase())
        .join("") || "ST";

      currentUser = {
        id: currentUserId,
        name: userName,
        email: user.email || "",
        role: user.role || (page === "student-dashboard" ? "student" : "technician"),
        studentId: user.student_number || "",
        student_number: user.student_number || "",
        college: user.college || "",
        program: user.program || "",
        year: user.year || "",
        section: user.section || "",
        campus: user.campus || null,
        yearSection: [user.year, user.section].filter(Boolean).join(" • "),
        course: user.program || "",
        photo: user.photo || null,
        initials
      };
    }

    const html = await fs.promises.readFile(dashboardPath, "utf8");
    const hydratedHtml = html.replaceAll(
      "__CURRENT_USER_JSON__",
      JSON.stringify(currentUser)
    );

    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.type("html").send(hydratedHtml);
  };

  loadDashboard().catch(error => {
    console.error(`Failed to render ${page}:`, error);
    res.status(500).send("Failed to load dashboard.");
  });
};

const renderFeaturePage = (config, currentUserName = "Administrator", pageName = "", currentUserCampus = "", currentUserRole = "", embeddedSchedule = false) => {
  const hideTopHeaderPages = ["user-management", "reports", "audit-logs"];
  const showTopHeader = !hideTopHeaderPages.includes(pageName);
  const pageContentStyle = hideTopHeaderPages.includes(pageName) ? ' style="padding-top: 0.35rem !important;"' : "";
  const isFaculty = ["faculty", "instructor"].includes(normalizeRoleName(currentUserRole));
  const portalClass = isFaculty ? " faculty-portal student-portal" : "";
  const laboratorySchedulesPageClass = pageName === "laboratory-schedules" ? " laboratory-schedules-page" : "";
  const dashboardHeaderPageClass = ["audit-logs", "reports"].includes(pageName) ? " system-layout-page" : "";
  const reportsPageClass = pageName === "reports" ? " reports-page" : "";
  const auditLogsPageClass = pageName === "audit-logs" ? " audit-logs-page" : "";
  const dashboardHeaderStylesheet = dashboardHeaderPageClass
    ? '<link rel="stylesheet" href="/css/system-layout.css?v=8">'
    : "";
  const scheduleStylesheet = pageName === "laboratory-schedules"
    ? '<link rel="stylesheet" href="/css/laboratory-schedules.css?v=7">'
    : "";
  const embeddedScheduleStyles = embeddedSchedule && pageName === "laboratory-schedules"
    ? `<style>
        html, body.laboratory-schedules-page { width: 100%; height: 100%; min-height: 0; overflow: hidden; }
        body.laboratory-schedules-page .main-container { width: 100%; height: 100vh; height: 100dvh; min-height: 0 !important; margin: 0 !important; padding: 0 !important; }
        body.laboratory-schedules-page .page-content { padding: .55rem !important; }
      </style>`
    : "";
  const reportsStylesheet = pageName === "reports"
    ? '<link rel="stylesheet" href="/css/reports.css?v=2">'
    : "";
  const adminMobilePolishStyles = ["laboratory-schedules", "reports"].includes(pageName)
    ? '<link rel="stylesheet" href="/css/admin-mobile-polish.css?v=2">'
    : "";
  const auditLogsStylesheet = pageName === "audit-logs"
    ? '<link rel="stylesheet" href="/css/audit-logs.css?v=11">'
    : "";
  const auditLogsScript = pageName === "audit-logs"
    ? '<script src="/js/audit-logs-page.js?v=20261104-fix1" defer></script>'
    : "";
  const inlineJson = (value) => JSON.stringify(value).replaceAll("<", "\\u003c");
  const currentUserJson = inlineJson({
    name: currentUserName,
    role: currentUserRole,
    campus: currentUserCampus
  });
  const facultySidebarScripts = isFaculty
    ? '<script>window.__CURRENT_USER__ = {name: ' + inlineJson(currentUserName) + ', role: "faculty", campus: ' + inlineJson(currentUserCampus || "") + '};</script><script src="/js/student-sidebar-config.js?v=29" defer></script>'
    : "";
  const scheduleCreationStyles = pageName === "laboratory-schedules"
    ? "<style>#scheduleModal{display:none!important}</style>"
    : "";
  const topHeaderSearch = pageName === "laboratory-schedules" ? "" : `
        <div class="search-box">
          <i class="fas fa-search"></i>
          <input type="text" placeholder="Search..." />
        </div>`;
  const topHeaderTitle = pageName === "laboratory-schedules" ? "" : `
        <div class="header-meta ml-3">
          <h2 class="header-title">${config.title}</h2>
          <p class="text-sm text-gray-400 mt-1">${config.description}</p>
        </div>`;

  // The Computer Labs page hosts this document in an iframe. Return a dedicated
  // content-only document so it can never inherit or inject a second app shell.
  if (embeddedSchedule && pageName === "laboratory-schedules") {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${config.title} | ComLab</title>
  ${scheduleCreationStyles}
  <script src="https://cdn.tailwindcss.com"></script>
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
  <link rel="stylesheet" href="/css/sidebar.css?v=75">
  ${scheduleStylesheet}
  ${adminMobilePolishStyles}
  <link rel="stylesheet" href="/css/table-readability.css?v=1">
  <style>
    html { height: 100%; }
    html body.laboratory-schedules-page.schedule-embedded { width: 100%; height: 100% !important; min-height: 0 !important; margin: 0; overflow: hidden !important; }
    html body.laboratory-schedules-page.schedule-embedded { background: transparent !important; }
    html body.laboratory-schedules-page.schedule-embedded .main-container { box-sizing: border-box; display: flex; width: 100%; max-width: none; height: 100% !important; min-height: 0 !important; margin: 0; padding: 0; overflow: hidden !important; background: transparent !important; }
    html body.laboratory-schedules-page.schedule-embedded .page-content { box-sizing: border-box; display: flex; width: 100%; height: 100%; min-height: 0 !important; margin: 0; padding: 0 !important; overflow: hidden !important; border-radius: 0; background: transparent !important; box-shadow: none !important; }
    html body.laboratory-schedules-page.schedule-embedded :is(#shared-sidebar, .sidebar, .sidebar-overlay, .top-header, .comlab-slim-page-header, .comlab-page-header-spacer) { display: none !important; }
    html body.laboratory-schedules-page.schedule-embedded .schedule-manager-card { width: 100%; min-width: 0; min-height: 0; padding: 0 !important; border: 0 !important; border-radius: 0 !important; background: transparent !important; box-shadow: none !important; }
  </style>
</head>
<body class="app-shell laboratory-schedules-page schedule-embedded">
  <script>window.__CURRENT_USER__ = ${currentUserJson};</script>
  <script>window.__CURRENT_USER_NAME__ = ${inlineJson(currentUserName)}; window.__CURRENT_USER_CAMPUS__ = ${inlineJson(currentUserCampus || "")}; window.__CURRENT_USER_ROLE__ = ${inlineJson(normalizeRoleName(currentUserRole))};</script>
  <div class="main-container"><main class="page-content">${config.content}</main></div>
</body>
</html>`;
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${config.title} | ComLab</title>
  ${scheduleCreationStyles}
  <script src="https://cdn.tailwindcss.com"></script>
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
  <link rel="stylesheet" href="/css/sidebar.css?v=74">
  ${dashboardHeaderStylesheet}
  ${scheduleStylesheet}
  ${reportsStylesheet}
  ${adminMobilePolishStyles}
  <link rel="stylesheet" href="/css/table-readability.css?v=1">
  ${auditLogsStylesheet}
  ${auditLogsScript}
  ${embeddedScheduleStyles}
</head>
<body class="app-shell${portalClass}${laboratorySchedulesPageClass}${dashboardHeaderPageClass}${reportsPageClass}${auditLogsPageClass}${embeddedSchedule ? " schedule-embedded" : ""}">
  <script>window.__CURRENT_USER__ = ${currentUserJson};</script>
  <script>window.__CURRENT_USER_NAME__ = ${inlineJson(currentUserName)}; window.__CURRENT_USER_CAMPUS__ = ${inlineJson(currentUserCampus || "")}; window.__CURRENT_USER_ROLE__ = ${inlineJson(normalizeRoleName(currentUserRole))};</script>
  ${portalClass ? '<style>.faculty-portal #scheduleModal,.faculty-portal button[onclick^="openEditScheduleModal"],.faculty-portal button[onclick^="confirmScheduleArchive"]{display:none!important}</style>' : ""}
  ${embeddedSchedule ? "" : '<div id="shared-sidebar"></div>'}
  <div class="main-container">
    ${showTopHeader && !embeddedSchedule ? `<div class="top-header">
      <div class="header-left flex items-center space-x-3 pl-14 lg:pl-0">
        <button id="mobileMenuToggle" class="menu-toggle fixed left-4 top-4 z-50 block lg:hidden" onclick="toggleSidebar()" aria-label="Open navigation">
          <i class="fas fa-bars"></i>
        </button>
        ${topHeaderTitle}
      </div>
      <div class="header-right">
        ${topHeaderSearch}
        <div class="header-icons"></div>
        <div class="user-profile">
          <div class="user-avatar">AD</div>
          <div class="user-info">
            <span class="user-name">Admin User</span>
            <span class="user-role">Administrator</span>
          </div>
          <i class="fas fa-chevron-down" style="color: #94f9b3; font-size: 0.75rem;"></i>
        </div>
      </div>
    </div>` : ""}

    <main class="page-content"${pageContentStyle}>
      ${config.content}
    </main>
  </div>
  ${facultySidebarScripts}
  ${embeddedSchedule ? "" : '<script src="/js/sidebar-component.js?v=77" defer></script>'}
</body>
</html>`;
};

const serveFeaturePage = async (req, res) => {
  const page = req.params.page;
  if (page === "attendance-monitoring") return res.status(404).send("Page not found");
  const config = pageConfigs[page];
  if (!config) return res.status(404).send("Page not found");
  if (page === "laboratory-schedules" || page === "audit-logs" || page === "reports") {
    res.set({
      "Cache-Control": "no-store, no-cache, must-revalidate, private",
      "Pragma": "no-cache",
      "Expires": "0",
      "Surrogate-Control": "no-store"
    });
  }

  if (page === "user-management") {
    const authContext = await getUserAuthContext(req);
    if (!authContext.userId) return res.redirect("/login");
    if (!isAdminRole(authContext.role)) return res.status(403).send("Forbidden: admin access required.");
  }

  if (page === "reports") {
    const authContext = await getUserAuthContext(req);
    if (!authContext.userId) return res.redirect("/login");
    if (["faculty", "instructor"].includes(normalizeRoleName(authContext.role))) {
      return res.redirect("/faculty-my-requests");
    }
    if (!isAdminRole(authContext.role) && normalizeRoleName(authContext.role) !== "technician") {
      return res.status(403).send("Forbidden: admin or technician access required.");
    }
  }

  if (page === "laboratory-schedules") {
    const authContext = await getUserAuthContext(req);
    if (!authContext.userId) return res.redirect("/login");
    const normalizedRole = normalizeRoleName(authContext.role);
    if (!isAdminRole(normalizedRole) && !["faculty", "instructor", "technician"].includes(normalizedRole)) {
      return res.status(403).send("Forbidden: administrator, faculty, or technician access required.");
    }
    if (["faculty", "instructor"].includes(normalizedRole) && req.path !== "/faculty-laboratory-schedules") {
      return res.redirect("/faculty-laboratory-schedules");
    }
  }

  if (page === "audit-logs") {
    if (canBypassAuditAccessForDev(req)) {
      // Development bypass allowed for the local Audit Logs debug UI.
    } else if (!req.session?.userId) {
      return res.status(403).send("Forbidden: admin only.");
    } else {
      const sessionRole = normalizeRoleName(getRequestRoleValue(req));
      const isSessionAdmin = isAdminRole(sessionRole);
      if (!isSessionAdmin) {
        try {
          const currentUser = await User.findByPk(req.session.userId, { attributes: ["role"] });
          if (!isAdminRole(currentUser?.role)) {
            return res.status(403).send("Forbidden: admin only.");
          }
        } catch (error) {
          console.error("Failed to resolve current user role for Audit Logs page access.", error);
          return res.status(403).send("Forbidden: admin only.");
        }
      }
    }
  }

  let currentUserName = "Administrator";
  let currentUserCampus = "";
  let currentUserRole = "";
  const currentUserId = req.session?.userId;
  if (currentUserId) {
    try {
      const currentUser = await User.findByPk(currentUserId, { attributes: ["name", "campus", "role"] });
      if (currentUser?.name) {
        currentUserName = currentUser.name;
      }
      currentUserCampus = currentUser?.campus || "";
      currentUserRole = currentUser?.role || "";
    } catch (error) {
      console.error("Failed to load current user for feature page:", error);
    }
  }

  res.send(renderFeaturePage(
    config,
    currentUserName,
    page,
    currentUserCampus,
    currentUserRole,
    page === "laboratory-schedules" && ["1", "standalone-v2"].includes(String(req.query.embedded || ""))
  ));
};

// ==================== Laboratory Schedule Helper Functions ====================

// Canonical room map for normalizing room names
const CANONICAL_ROOM_MAP = {
  'room 202': 'Laboratory 1 — Room 202',
  'room202': 'Laboratory 1 — Room 202',
  'rm 202': 'Laboratory 1 — Room 202',
  'rm202': 'Laboratory 1 — Room 202',
  'laboratory 1': 'Laboratory 1 — Room 202',
  'lab 1': 'Laboratory 1 — Room 202',
  'lab1': 'Laboratory 1 — Room 202',
  'laboratory1': 'Laboratory 1 — Room 202',
  'room 204': 'Laboratory 2 — Room 204',
  'room204': 'Laboratory 2 — Room 204',
  'rm 204': 'Laboratory 2 — Room 204',
  'rm204': 'Laboratory 2 — Room 204',
  'laboratory 2': 'Laboratory 2 — Room 204',
  'lab 2': 'Laboratory 2 — Room 204',
  'lab2': 'Laboratory 2 — Room 204',
  'laboratory2': 'Laboratory 2 — Room 204'
};

// Normalize room values for consistent matching
const normalizeRoom = (value) => {
  if (!value && value !== '') return null;
  const key = String(value || '').trim().toLowerCase();
  if (CANONICAL_ROOM_MAP[key]) return CANONICAL_ROOM_MAP[key];
  // If already canonical
  for (const v of Object.values(CANONICAL_ROOM_MAP)) {
    if (String(v).toLowerCase() === key) return v;
  }
  return null;
};

// Normalize campus values
const normalizeCampus = (value) => {
  if (!value && value !== '') return null;
  const key = String(value || '').trim().toLowerCase();
  const campusMap = {
    'bongabong': 'Bongabong',
    'calapan': 'Calapan',
    'victoria': 'Victoria'
  };
  return campusMap[key] || null;
};

// Allowed days for scheduling
const ALLOWED_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const ALLOWED_SCHEDULE_YEAR_LEVELS = new Set(["1st Year", "2nd Year", "3rd Year", "4th Year"]);
const ALLOWED_SCHEDULE_SECTIONS = new Set(["F1", "F2", "F3"]);

const ALLOWED_SCHEDULE_MINUTES = Array.from({ length: 21 }, (_, index) => 7 * 60 + 30 + index * 30);

// Parse supported schedule times into minutes after midnight.
const parseScheduleClockTime = (value) => {
  const text = String(value || '').replace(/\u00a0/g, ' ').trim();
  const match = text.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i);
  if (!match) return null;

  let hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes) || minutes > 59) return null;

  if (match[3]) {
    const meridiem = match[3].toUpperCase();
    if (hours < 1 || hours > 12) return null;
    if (meridiem === 'AM' && hours === 12) hours = 0;
    if (meridiem === 'PM' && hours !== 12) hours += 12;
  } else if (hours > 23) {
    return null;
  }

  return hours * 60 + minutes;
};

const isAllowedScheduleClockTime = (value) => {
  const minutes = parseScheduleClockTime(value);
  return minutes !== null && ALLOWED_SCHEDULE_MINUTES.includes(minutes);
};

// Check if two time ranges overlap
const timeRangesOverlap = (start1, end1, start2, end2) => {
  return start1 < end2 && start2 < end1;
};

const normalizeStoredCampus = (value) => normalizeCampus(String(value || '').replace(/\s*Campus\s*$/i, '').trim());
const normalizeStoredRoom = (value) => normalizeRoom(value) || String(value || '').trim().toLowerCase();
const DEFAULT_SCHEDULE_COLOR = "#16a34a";
const normalizeScheduleColor = (value) => {
  const color = String(value || "").trim();
  return /^#[0-9a-f]{6}$/i.test(color) ? color.toLowerCase() : null;
};
const normalizeScheduleClassSection = (yearLevel, section) => {
  const rawYearLevel = String(yearLevel || "").trim().toLocaleLowerCase();
  const normalizedYearLevel = [...ALLOWED_SCHEDULE_YEAR_LEVELS]
    .find((year) => year.toLocaleLowerCase() === rawYearLevel);
  const normalizedSection = String(section || "").trim().replace(/\s+/g, " ").toLocaleUpperCase();
  if (!normalizedYearLevel) {
    return { error: "Choose a valid year level from 1st Year to 4th Year." };
  }
  if (!ALLOWED_SCHEDULE_SECTIONS.has(normalizedSection)) {
    return { error: "Choose a valid section: F1, F2, or F3." };
  }
  return { yearLevel: normalizedYearLevel, section: normalizedSection };
};
const getScheduleCourseSection = (yearLevel, section) =>
  [yearLevel, section ? `Section ${section}` : ""].filter(Boolean).join(" • ");

// Find conflicting schedules
const findConflictingSchedule = async ({ laboratoryRoom, instructor, instructorUserId = null, dayOfWeek, campus, startTime, endTime, excludeId = null } = {}) => {
  if (!laboratoryRoom || !dayOfWeek || !campus || !startTime || !endTime) return null;

  const checkStart = parseScheduleClockTime(startTime);
  const checkEnd = parseScheduleClockTime(endTime);
  if (checkStart === null || checkEnd === null || checkStart >= checkEnd) return null;

  const requestedDay = String(dayOfWeek).trim().toLocaleLowerCase();
  const schedules = await LaboratorySchedule.findAll({
    where: sequelize.where(
      sequelize.fn("LOWER", sequelize.fn("TRIM", sequelize.col("dayOfWeek"))),
      requestedDay
    )
  });
  const requestedCampus = normalizeStoredCampus(campus);
  const requestedRoom = normalizeStoredRoom(laboratoryRoom);
  const requestedInstructor = String(instructor || "").trim().toLocaleLowerCase();

  for (const schedule of schedules) {
    if (excludeId !== null && String(schedule.id) === String(excludeId)) continue;
    if (String(schedule.dayOfWeek || "").trim().toLocaleLowerCase() !== requestedDay) continue;

    const sameCampus = normalizeStoredCampus(schedule.campus) === requestedCampus;
    const roomConflict = sameCampus && normalizeStoredRoom(schedule.laboratoryRoom) === requestedRoom;
    const instructorConflict = requestedInstructor && (
      (instructorUserId && String(schedule.instructorUserId || "") === String(instructorUserId)) ||
      (!schedule.instructorUserId && String(schedule.instructor || "").trim().toLocaleLowerCase() === requestedInstructor)
    );
    if (!roomConflict && !instructorConflict) continue;

    const scheduleStart = parseScheduleClockTime(schedule.startTime);
    const scheduleEnd = parseScheduleClockTime(schedule.endTime);
    if (scheduleStart === null || scheduleEnd === null || scheduleStart >= scheduleEnd) continue;

    if (timeRangesOverlap(checkStart, checkEnd, scheduleStart, scheduleEnd)) {
      return { schedule, type: roomConflict ? "laboratory" : "instructor" };
    }
  }
  return null;
};

// Parse class list from file buffer (supports XLSX, XLS, CSV)
const parseClassListRows = async (buffer, originalname = "") => {
  try {
    const workbook = XLSX.read(buffer, { type: "buffer" });
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) return [];

    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: "", blankrows: false });

    return rows
      .map((row) => ({
        studentId: row['Student ID'] || row['Student Number'] || row['Student No.'] || row['studentId'] || row['student_id'] || row['student_number'] || row['ID'] || row['id'] || '',
        lastName: row['Last Name'] || row['lastName'] || row['last_name'] || '',
        firstName: row['First Name'] || row['firstName'] || row['first_name'] || '',
        middleInitial: row['Middle Initial'] || row['middleInitial'] || row['middle_initial'] || '',
        fullName: row['Student Name'] || row['studentName'] || row['student_name'] || row['Full Name'] || row['fullName'] || row['Name'] || row['name'] || '',
        courseSection: row['Course Section'] || row['courseSection'] || row['Section'] || row['section'] || '',
        program: row['Program'] || row['program'] || '',
        year: row['Year'] || row['year'] || '',
        section: row['Section'] || row['section'] || '',
        email: row['Email'] || row['email'] || ''
      }))
      .filter((row) => row.studentId || row.fullName || (row.lastName && row.firstName));
  } catch (error) {
    console.error("Error parsing class list:", error);
    return [];
  }
};

const normalizeStudentName = (value) => String(value || "")
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .toLowerCase()
  .replace(/[^a-z0-9]/g, "");

const getNameParts = (value) => String(value || "")
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, " ")
  .trim()
  .split(/\s+/)
  .filter(Boolean);

const buildClassListName = (entry) => {
  const fullName = String(entry.fullName || "").trim();
  if (fullName) return fullName;
  return [entry.firstName, entry.middleInitial, entry.lastName].filter(Boolean).join(" ").trim();
};

const getRegisteredStudentsForCampus = async (campus) => User.findAll({
  where: {
    role: "student",
    [Op.or]: [
      { campus },
      { campus: `${String(campus || "").replace(/\s*Campus\s*$/i, "").trim()} Campus` }
    ]
  },
  attributes: ["id", "name", "student_number", "program", "year", "section", "campus"]
});

const matchClassListEntryToStudent = (entry, registeredStudents) => {
  const suppliedStudentId = String(entry.studentId || entry.studentNumber || entry.student_number || "").trim();
  let candidates = suppliedStudentId
    ? registeredStudents.filter((student) => String(student.student_number || "").trim() === suppliedStudentId)
    : [];
  const normalizedName = normalizeStudentName(buildClassListName(entry));
  if (!candidates.length && normalizedName) {
    candidates = registeredStudents.filter((student) => normalizeStudentName(student.name) === normalizedName);
  }

  if (!candidates.length) {
    const classListFullName = String(entry.fullName || "").trim();
    const commaParts = classListFullName.split(",").map((part) => part.trim()).filter(Boolean);
    const classFirstNameParts = entry.firstName
      ? getNameParts(entry.firstName)
      : commaParts.length > 1
        ? getNameParts(commaParts.slice(1).join(" "))
        : getNameParts(classListFullName);
    const classLastNameParts = entry.lastName
      ? getNameParts(entry.lastName)
      : commaParts.length > 1
        ? getNameParts(commaParts[0])
        : getNameParts(classListFullName).slice(-1);
    const classFirstName = classFirstNameParts[0];
    const classLastName = classLastNameParts[classLastNameParts.length - 1];
    candidates = registeredStudents.filter((student) => {
      const registeredNameParts = getNameParts(student.name);
      return classFirstName
        && classLastName
        && registeredNameParts[0] === classFirstName
        && registeredNameParts[registeredNameParts.length - 1] === classLastName;
    });
  }

  if (candidates.length > 1) {
    candidates = candidates.filter((student) => {
      const sameProgram = !entry.program || normalizeStudentName(student.program) === normalizeStudentName(entry.program);
      const sameYear = !entry.year || normalizeStudentName(student.year) === normalizeStudentName(entry.year);
      const sameSection = !entry.section || normalizeStudentName(student.section) === normalizeStudentName(entry.section);
      return sameProgram && sameYear && sameSection;
    });
  }

  return {
    student: candidates.length === 1 ? candidates[0] : null,
    status: candidates.length > 1 ? "review" : candidates.length === 1 ? "matched" : "unmatched"
  };
};

const reconcileClassListIdentities = async (entries, campus) => {
  if (!entries.length) return entries;
  const registeredStudents = await getRegisteredStudentsForCampus(campus);

  await Promise.all(entries.map(async (entry) => {
    const { student, status } = matchClassListEntryToStudent(entry, registeredStudents);
    const officialStudentId = student?.student_number || null;
    const identityStatus = status === "matched" && !String(officialStudentId || "").trim()
      ? "incomplete_id"
      : status;
    const nextValues = {
      matchedUserId: student?.id || null,
      studentId: officialStudentId,
      matchStatus: identityStatus
    };
    if (entry.matchedUserId !== nextValues.matchedUserId || entry.studentId !== nextValues.studentId || entry.matchStatus !== nextValues.matchStatus) {
      await entry.update(nextValues);
    }
  }));

  return entries;
};

const resolveClassListEntries = async (entries = [], laboratoryScheduleId, campus) => {
  const registeredStudents = await getRegisteredStudentsForCampus(campus);

  return entries
    .map((entry) => {
      const { student: matchedStudent, status: matchStatus } = matchClassListEntryToStudent(entry, registeredStudents);
      const fullName = buildClassListName(entry) || String(matchedStudent?.name || "").trim();
      const identityStatus = matchStatus === "matched" && !String(matchedStudent?.student_number || "").trim()
        ? "incomplete_id"
        : matchStatus;
      return {
        laboratoryScheduleId,
        studentId: matchedStudent?.student_number || null,
        matchedUserId: matchedStudent?.id || null,
        matchStatus: identityStatus,
        fullName,
        courseSection: entry.courseSection ? String(entry.courseSection).trim() : null,
        program: entry.program ? String(entry.program).trim() : matchedStudent?.program || null,
        year: entry.year ? String(entry.year).trim() : matchedStudent?.year || null,
        section: entry.section ? String(entry.section).trim() : matchedStudent?.section || null,
        email: entry.email ? String(entry.email).trim() : null
      };
    })
    .filter((entry) => entry.fullName);
};

// ==================== End Laboratory Schedule Helper Functions ====================

const facultyPortalPage = async (req, res, page) => {
  const authContext = await getUserAuthContext(req);
  if (!authContext.userId) return res.redirect("/login");
  if (!["faculty", "instructor"].includes(normalizeRoleName(authContext.role))) {
    return res.status(403).send("Forbidden: Faculty access required.");
  }
  req.params.page = page;
  return serveHtmlPage(req, res);
};

const studentPortalPage = async (req, res, page, facultyPath) => {
  const authContext = await getUserAuthContext(req);
  if (!authContext.userId) return res.redirect("/login");
  const role = normalizeRoleName(authContext.role);
  if (["faculty", "instructor"].includes(role)) return res.redirect(facultyPath);
  if (role !== "student") return res.status(403).send("Forbidden: Student access required.");
  req.params.page = page;
  return serveHtmlPage(req, res);
};

router.get("/", homePage);
router.get("/landing", (req, res) => res.redirect("/"));
router.get("/equipment-inventory", inventoryPage);
router.get("/equipment-assignment", serveHtmlPage);
router.get("/borrow-equipment", async (req, res) => {
  if (req.session?.userId) {
    const user = await User.findByPk(req.session.userId, { attributes: ["role"] });
    if (["faculty", "instructor"].includes(normalizeRoleName(user?.role))) {
      return res.redirect("/faculty-borrow-equipment");
    }
  }
  return serveHtmlPage(req, res);
});
router.get("/equipment/uid/:token", scanEquipmentQr);
router.get("/equipment/s/:token", scanEquipmentQr);
router.get("/equipment/view/:equipmentId", redirectLegacyEquipmentQr);
router.get("/admin-dashboard", serveHtmlPage);
router.get("/admin-profile", async (req, res) => {
  if (!req.session?.userId) return res.redirect("/login");
  try {
    const user = await User.findByPk(req.session.userId, { attributes: ["role"] });
    if (!user || !isAdminRole(user.role)) return res.status(403).send("Forbidden: admin access required.");
    return serveHtmlPage(req, res);
  } catch (error) {
    console.error("Failed to authorize administrator profile page:", error);
    return res.status(500).send("Unable to load the administrator profile page.");
  }
});
router.get("/computer-labs", (req, res) => {
  req.params.page = "admin-computer-labs";
  return serveHtmlPage(req, res);
});
router.get("/faculty-management", (req, res) => {
  req.params.page = "admin-faculty-management";
  return serveHtmlPage(req, res);
});
router.get("/user-management", (req, res) => {
  req.params.page = "admin-user-management";
  return serveHtmlPage(req, res);
});
router.get("/technician-accomplishments", (req, res) => {
  req.params.page = "admin-technician-accomplishments";
  return serveHtmlPage(req, res);
});
router.get("/page/faculty-management", (req, res) => {
  req.params.page = "admin-faculty-management";
  return serveHtmlPage(req, res);
});
router.get("/page/computer-labs", (req, res) => {
  req.params.page = "admin-computer-labs";
  return serveHtmlPage(req, res);
});
router.get("/page/facilities", (req, res) => {
  req.params.page = "admin-facilities";
  return serveHtmlPage(req, res);
});
router.get("/maintenance-monitoring", (req, res) => {
  req.params.page = "admin-dashboard";
  return serveHtmlPage(req, res);
});
router.get("/attendance", serveHtmlPage);
router.get("/maintenance-reports", serveHtmlPage);
router.get("/student-dashboard", serveHtmlPage);
router.get("/student-audit-history", (req, res) =>
  studentPortalPage(req, res, "student-audit-history", "/faculty-audit-history"));
router.get("/faculty-dashboard", serveHtmlPage);
router.get("/student-borrow-equipment", (req, res) =>
  studentPortalPage(req, res, "student-borrow-equipment", "/faculty-borrow-equipment"));
router.get("/faculty-borrow-equipment", (req, res) =>
  facultyPortalPage(req, res, req.query.view === "availability"
    ? "faculty-equipment-availability"
    : "faculty-borrow-equipment"));
router.get("/faculty-mir-items", (req, res) =>
  facultyPortalPage(req, res, "faculty-mir-items"));
router.get("/faculty-equipment-availability", (req, res) =>
  facultyPortalPage(req, res, "faculty-equipment-availability"));
router.get("/faculty-my-requests", (req, res) =>
  facultyPortalPage(req, res, "faculty-my-requests"));
router.get("/faculty-audit-history", (req, res) =>
  facultyPortalPage(req, res, "faculty-audit-history"));
router.get("/faculty-report-equipment", (req, res) =>
  facultyPortalPage(req, res, "faculty-report-equipment"));
router.get("/faculty-profile", (req, res) =>
  facultyPortalPage(req, res, "faculty-profile"));
router.get("/faculty-laboratory-schedules", (req, res) =>
  facultyPortalPage(req, res, "faculty-laboratory-schedules"));
router.get("/student-profile", (req, res) =>
  studentPortalPage(req, res, "student-profile", "/faculty-profile"));
router.get("/my-pc-station", serveHtmlPage);
router.get("/student/scan-attendance", (req, res) =>
  studentPortalPage(req, res, "student-scan-attendance", "/faculty-dashboard"));
router.get("/student/report-issue", (req, res) => res.redirect("/student-report-equipment"));
router.get("/student/report-damage", (req, res) => res.redirect("/student-report-equipment"));
router.get("/report-equipment-issue", (req, res) => res.redirect("/student-report-equipment"));
router.get("/student/my-requests", (req, res) => res.redirect("/student-my-requests"));
router.get("/student/profile", (req, res) => res.redirect("/student-profile"));
router.get("/student/dashboard", (req, res) => res.redirect("/student-dashboard"));
router.get("/student/borrow-equipment", async (req, res) => {
  const currentUserId = req.session?.userId;
  if (!currentUserId) return res.redirect("/login");

  try {
    const user = await User.findByPk(currentUserId, {
      attributes: ["name", "email", "role", "student_number", "program", "year", "section", "campus", "photo"]
    });
    const role = normalizeRoleName(user?.role);
    if (["faculty", "instructor"].includes(role)) {
      return res.redirect("/faculty-borrow-equipment");
    }
    if (role !== "student") {
      return res.status(403).send("Forbidden: Student access required.");
    }

    const currentUser = user ? {
      id: currentUserId,
      name: user.name || "Student",
      email: user.email || "",
      role: user.role || "student",
      studentId: user.student_number || "",
      student_number: user.student_number || "",
      program: user.program || "",
      year: user.year || "",
      section: user.section || "",
      campus: user.campus || null,
      yearSection: [user.year, user.section].filter(Boolean).join(" • "),
      course: user.program || "",
      photo: user.photo || null,
      initials: (user.name || "Student").split(/\s+/).filter(Boolean).slice(0, 2).map(part => part.charAt(0).toUpperCase()).join("") || "ST"
    } : null;

    const html = await fs.promises.readFile(path.join(__dirname, "../views/student/student-borrow-equipment.html"), "utf8");
    const hydratedHtml = html.replaceAll("__CURRENT_USER_JSON__", JSON.stringify(currentUser));
    res.type("html").send(hydratedHtml.replace("window.__CURRENT_USER__ = __CURRENT_USER_JSON__;", `window.__CURRENT_USER__ = ${JSON.stringify(currentUser)};`));
  } catch (error) {
    console.error("Failed to render student borrow page:", error);
    res.status(500).send("Failed to load Borrow Equipment page.");
  }
});
router.get("/student-report-issue", (req, res) => res.redirect("/student-report-equipment"));
router.get("/student-report-equipment", (req, res) =>
  studentPortalPage(req, res, "student-report-equipment", "/faculty-report-equipment"));
router.get("/student-my-requests", (req, res) =>
  studentPortalPage(req, res, "student-my-requests", "/faculty-my-requests"));
router.get("/technician-dashboard", serveHtmlPage);
router.get("/technician-profile", serveHtmlPage);
router.get("/page/:page", serveFeaturePage);

router.get("/login", loginPage);
router.post("/login", loginUser);
router.get("/api/pc-stations/qr/:token/status", getPCStationScanAvailability);
router.get("/api/pc-stations/my-sessions", getMyPCStationSessions);
router.post("/api/pc-stations/my-sessions/logout", logoutMyPCStationSession);
router.get("/api/help/chats", listRoleHelpChats);
router.post("/api/help/chats", createRoleHelpChat);
router.get("/api/help/chats/:chatId/messages", getRoleHelpChatMessages);
router.post("/api/help/chat", answerRoleHelp);
router.post("/pc-station/uid/:token/action", submitPCStationAction);
router.get("/pc-station/s/:token/status", showPCStationScanResult);
router.get("/pc-station/s/:token", scanPCStationQr);
router.get("/pc-station/uid/:token/status", showPCStationScanResult);
router.get("/pc-station/uid/:token", scanPCStationQr);
router.get("/pc-station/:setId/status", redirectLegacyPCStationQr);
router.get("/pc-station/:setId", redirectLegacyPCStationQr);
router.get("/register", registerPage);
router.post("/register", registerUser);
router.post("/api/profile", updateProfile);
router.patch("/api/admin/profile", async (req, res) => {
  if (!req.session?.userId) return res.status(401).json({ success: false, error: "Please log in to update your profile." });

  try {
    const user = await User.findByPk(req.session.userId, { attributes: ["id", "name", "role"] });
    if (!user || !isAdminRole(user.role)) {
      return res.status(403).json({ success: false, error: "Admin access is required to update this profile." });
    }

    const name = String(req.body?.name || "").trim().replace(/\s+/g, " ");
    const nameParts = name.split(" ").filter(Boolean);
    if (name.length > 120 || nameParts.length < 2 || ["administrator", "admin", "n/a"].includes(name.toLocaleLowerCase())) {
      return res.status(400).json({ success: false, error: "Enter your first and last name." });
    }

    if (name !== user.name) {
      await user.update({ name });
      await logAuditEntry(req, {
        action: "User Updated",
        module: "User Management",
        resourceId: user.id,
        description: `Administrator updated their profile name for account ${user.id}.`
      });
    }

    return res.json({ success: true, profile: { name: user.name } });
  } catch (error) {
    console.error("Failed to update administrator profile:", error);
    return res.status(500).json({ success: false, error: "Unable to update your profile right now." });
  }
});
router.patch("/api/admin/profile/password", async (req, res) => {
  if (!req.session?.userId) return res.status(401).json({ success: false, error: "Please log in to change your password." });

  try {
    const user = await User.findByPk(req.session.userId, { attributes: ["id", "role", "password"] });
    if (!user || !isAdminRole(user.role)) {
      return res.status(403).json({ success: false, error: "Admin access is required to change this password." });
    }

    const currentPassword = String(req.body?.currentPassword || "");
    const newPassword = String(req.body?.newPassword || "");
    const confirmPassword = String(req.body?.confirmPassword || "");
    if (!currentPassword || !newPassword || !confirmPassword) {
      return res.status(400).json({ success: false, error: "Complete all password fields." });
    }
    if (newPassword.length < 8 || newPassword.length > 128) {
      return res.status(400).json({ success: false, error: "Use a new password between 8 and 128 characters." });
    }
    if (newPassword !== confirmPassword) {
      return res.status(400).json({ success: false, error: "The new passwords do not match." });
    }
    if (!await bcryptjs.compare(currentPassword, user.password)) {
      return res.status(400).json({ success: false, error: "Your current password is incorrect." });
    }
    if (await bcryptjs.compare(newPassword, user.password)) {
      return res.status(400).json({ success: false, error: "Choose a password different from your current one." });
    }

    await user.update({ password: await bcryptjs.hash(newPassword, 10) });
    await logAuditEntry(req, {
      action: "Password Changed",
      module: "Authentication",
      resourceId: user.id,
      description: `Administrator changed the password for their own account ${user.id}.`
    });
    return res.json({ success: true, message: "Your password has been changed." });
  } catch (error) {
    console.error("Failed to change administrator password:", error);
    return res.status(500).json({ success: false, error: "Unable to change your password right now." });
  }
});
router.post("/api/student/photo", uploadStudentPhoto);
router.get("/forgot-password", forgotPasswordPage);
router.post("/forgot-password", forgotPassword);
router.get('/verify-otp', verifyOtpPage);
router.post('/verify-otp', verifyOtp);
router.get('/resend-otp', resendOtp);
router.get('/reset-password', resetPasswordPage);
router.post('/reset-password', resetPassword);
router.get('/check-your-email', (req, res) => res.render('check-email', { title: 'Check your email' }));
router.get('/verify-email/:token', verifyEmail);
router.get("/dashboard", dashboardPage);
router.get("/logout", logoutUser);

router.get("/api/equipment", getEquipment);
router.get("/api/faculty/assigned-equipment", listMyEquipmentAssignments);
router.get("/api/faculty/assignment-history", getMyEquipmentAssignmentHistory);
router.get("/api/equipment-assignments", listEquipmentAssignments);
router.put("/api/equipment-assignments/:id", updateEquipmentAssignment);
router.get("/api/equipment-assignments/:id/history", getEquipmentAssignmentHistory);
router.get("/api/student/equipment", getStudentEquipment);
router.get("/api/equipment/campus-totals", getEquipmentCampusTotals);

// --- NEW: Missing equipment list (must be before /:id routes) ---
router.get("/api/equipment/missing", getMissingEquipment);

router.get("/api/equipment/:id/qr", getEquipmentQr);
router.get("/api/equipment/qr/:token/resolve", resolveEquipmentQrToken);
router.post("/api/equipment", createEquipment);
router.put("/api/equipment/:id", updateEquipment);
router.put("/api/equipment/:id/status", updateEquipmentStatus);
router.delete("/api/equipment/:id", deleteEquipment);

// --- NEW: Missing / Found / Transfer / History ---
router.post("/api/equipment/:id/report-missing", reportEquipmentMissing);
router.post("/api/equipment/:id/mark-found", markEquipmentFound);
router.post("/api/equipment/:id/transfer-set", transferEquipmentSet);
router.get("/api/equipment/:id/history", getEquipmentHistory);
router.get("/api/equipment/:id/borrow-cycle", getEquipmentBorrowCycle);
router.post("/api/equipment/:id/scan", logEquipmentScan);
router.get("/api/equipment-scan-history", getEquipmentScanHistory);

router.get("/api/equipment-categories", getEquipmentCategories);
router.post("/api/equipment-categories", createEquipmentCategory);
router.delete("/api/equipment-categories/:id", deleteEquipmentCategory);

// PC Assignment routes
router.get("/api/equipment/pc-availability", getPCAvailability);
router.post("/api/equipment/assign-pc", assignPC);
router.post("/api/equipment/end-pc-session", endPCSession);
router.get("/api/equipment/current-assignment/:userId", getCurrentPCAssignment);
router.get("/api/equipment/usage-history/:userId", async (req, res) => {
  try {
    const userId = req.session?.userId;
    if (!userId) return res.status(401).json({ success: false, error: "Authentication required." });

    await sequelize.query(
      `UPDATE equipment_usage_logs eul
       INNER JOIN attendance a ON a.id = eul.attendanceId
       INNER JOIN attendance_sessions ats ON ats.token = a.sessionToken
       SET eul.usageEndTime = GREATEST(eul.usageStartTime, ats.expiresAt),
           eul.durationMinutes = GREATEST(
             ROUND(TIMESTAMPDIFF(
               SECOND,
               eul.usageStartTime,
               GREATEST(eul.usageStartTime, ats.expiresAt)
             ) / 60),
             1
           )
       WHERE eul.userId = ?
         AND eul.usageEndTime IS NULL
         AND ats.expiresAt <= UTC_TIMESTAMP()`,
      { replacements: [userId] }
    );

    // Attendance is optional: keep every PC usage session in the student's history,
    // including sessions started outside a scheduled class.
    const history = await sequelize.query(
      `SELECT eul.id as usageLogId, eul.equipmentId, eul.serialNumber,
              eul.usageEndTime,
              CASE
                WHEN eul.usageEndTime IS NOT NULL
                  AND eul.usageStartTime > eul.usageEndTime
                  AND stationLoginAudit.createdAt IS NOT NULL
                  THEN GREATEST(ROUND(TIMESTAMPDIFF(SECOND, stationLoginAudit.createdAt, eul.usageEndTime) / 60), 1)
                WHEN eul.usageEndTime IS NOT NULL AND eul.usageStartTime IS NOT NULL
                  AND eul.usageStartTime <= eul.usageEndTime
                  THEN GREATEST(ROUND(TIMESTAMPDIFF(SECOND, eul.usageStartTime, eul.usageEndTime) / 60), 1)
                WHEN eul.usageEndTime IS NOT NULL AND eul.usageStartTime > eul.usageEndTime
                  THEN NULL
                ELSE eul.durationMinutes
              END AS durationMinutes,
              CASE
                WHEN eul.usageEndTime IS NOT NULL
                  AND eul.usageStartTime > eul.usageEndTime
                  AND stationLoginAudit.createdAt IS NOT NULL
                  THEN stationLoginAudit.createdAt
                ELSE eul.usageStartTime
              END AS usageStartTime,
              COALESCE(eul.pcSetId, e.setId) as pcSetId,
              stationSet.setName as stationName,
              e.name as equipmentName, e.assetNumber,
              COALESCE(
                NULLIF(CONCAT_WS(
                  ' — ',
                  NULLIF(TRIM(historyLab.name), ''),
                  NULLIF(TRIM(historyLab.roomNumber), '')
                ), ''),
                NULLIF(TRIM(e.laboratoryRoom), ''),
                NULLIF(TRIM(eul.laboratoryId), '')
              ) as laboratoryRoom,
              a.id as attendanceId, a.date as attendanceDate, a.timeIn as attendanceTime,
              a.status as attendanceStatus, a.subject, a.lab as attendanceLab,
              a.courseSection, a.instructor, a.sessionToken,
              CASE WHEN a.id IS NULL THEN 'No class schedule' ELSE 'Linked to attendance' END as traceStatus
       FROM equipment_usage_logs eul
       LEFT JOIN equipment e ON e.id = eul.equipmentId
       LEFT JOIN equipment_sets stationSet
         ON BINARY stationSet.setId = BINARY COALESCE(eul.pcSetId, e.setId)
       LEFT JOIN computer_labs historyLab
         ON historyLab.id = COALESCE(eul.computerLabId, stationSet.computerLabId)
       LEFT JOIN attendance a ON a.id = eul.attendanceId
       LEFT JOIN audit_logs stationLoginAudit
         ON eul.usageEndTime IS NOT NULL
         AND eul.usageStartTime > eul.usageEndTime
         AND stationLoginAudit.id = (
           SELECT al.id
           FROM audit_logs al
           WHERE al.userId = eul.userId
             AND BINARY al.resourceId = BINARY COALESCE(eul.pcSetId, e.setId)
             AND al.module = 'Authentication'
             AND al.action = 'Login'
             AND al.createdAt <= eul.usageEndTime
           ORDER BY al.createdAt DESC, al.id DESC
           LIMIT 1
         )
       WHERE eul.userId = ?
       ORDER BY eul.usageStartTime DESC
       LIMIT 50`,
      { replacements: [userId], type: QueryTypes.SELECT }
    );

    return res.json({ success: true, usageHistory: history });
  } catch (error) {
    console.error("[usage-history] Failed to load student usage history", error);
    return res.status(500).json({ success: false, error: "Unable to load usage history." });
  }
});

// PC Sets endpoint for inventory
router.get("/api/equipment/pc-sets", async (req, res) => {
  try {
    const pcSets = await sequelize.query(
      `SELECT 
        e.setId,
        e.campus,
        MIN(e.status) as status,
        MIN(DATE_FORMAT(e.dateAdded, '%Y-%m-%d')) as dateAdded,
        GROUP_CONCAT(
          CONCAT(e.category, ':', COALESCE(e.serialNumber, 'N/A'), ':', e.equipmentId)
          ORDER BY e.category
          SEPARATOR '|'
        ) as componentsList
      FROM equipment e
      WHERE e.setId IS NOT NULL AND e.setId != ''
      GROUP BY e.setId, e.campus
      ORDER BY e.setId`,
      { type: QueryTypes.SELECT }
    );

    const formatted = pcSets.map(set => {
      const components = set.componentsList ? set.componentsList.split('|').map(c => {
        const [category, serialNumber, equipmentId] = c.split(':');
        return { category, serialNumber, equipmentId };
      }) : [];

      return {
        setId: set.setId,
        campus: set.campus,
        status: set.status,
        dateAdded: set.dateAdded,
        components,
        qrCode: null // Can add QR generation later
      };
    });

    res.json(formatted);
  } catch (error) {
    console.error('Error fetching PC sets:', error);
    res.status(500).json({ error: 'Failed to fetch PC sets' });
  }
});

// PC Selection after attendance
router.get("/attendance/select-pc", async (req, res) => {
  const { attendanceId, scheduleId } = req.query;
  
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Select PC Station | ComLab</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
  <style>
    body { 
      background: radial-gradient(circle at top left, rgba(34,197,94,.16), transparent 24%), 
                  radial-gradient(circle at bottom right, rgba(74,222,128,.10), transparent 28%),
                  linear-gradient(180deg, #07150F 0%, #0A1D15 100%);
      min-height: 100vh; 
    }
    .pc-card { 
      transition: all 0.3s; 
      background: linear-gradient(180deg, rgba(15,36,27,.96), rgba(10,29,21,.96));
      border: 1px solid rgba(74,222,128,.16);
    }
    .pc-card:hover:not(.occupied) { 
      transform: translateY(-4px); 
      box-shadow: 0 18px 40px rgba(34,197,94,.18);
      border-color: rgba(74,222,128,.3);
    }
    .pc-card.available { 
      border-color: rgba(34,197,94,.3); 
      cursor: pointer;
    }
    .pc-card.occupied { 
      border-color: rgba(239,68,68,.3); 
      opacity: 0.6; 
      cursor: not-allowed; 
    }
    .component-tag {
      background: rgba(74,222,128,.12);
      border: 1px solid rgba(74,222,128,.2);
      padding: 0.25rem 0.5rem;
      border-radius: 0.375rem;
      font-size: 0.75rem;
      color: #d1fae5;
    }
  </style>
</head>
<body class="p-6">
  <div class="max-w-6xl mx-auto">
    <div class="rounded-2xl shadow-2xl p-8 border border-emerald-500/20" style="background: linear-gradient(180deg, rgba(15,36,27,.96), rgba(10,29,21,.96));">
      <div class="text-center mb-8">
        <div class="inline-block p-4 bg-emerald-500/20 rounded-full mb-4">
          <i class="fas fa-desktop text-4xl text-emerald-400"></i>
        </div>
        <h1 class="text-3xl font-bold text-white mb-2">Select Your PC Station</h1>
        <p class="text-slate-300">Choose your workstation for this session</p>
      </div>

      <div id="pcGrid" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
        <div class="text-center text-slate-400 col-span-full">
          <i class="fas fa-spinner fa-spin text-2xl mb-2"></i>
          <p>Loading PC stations...</p>
        </div>
      </div>

      <div class="text-center">
        <a href="/student/dashboard" class="text-slate-400 hover:text-emerald-400 transition-colors">
          <i class="fas fa-arrow-left mr-2"></i>Skip for now
        </a>
      </div>
    </div>
  </div>

  <script>
    const attendanceId = ${JSON.stringify(attendanceId)};
    const scheduleId = ${JSON.stringify(scheduleId)};

    async function loadPCStations() {
      try {
        // Fetch PC sets with detailed information
        const setsResponse = await fetch('/api/equipment-sets');
        const setsData = await setsResponse.json();
        
        if (!setsData.success || !setsData.sets || setsData.sets.length === 0) {
          document.getElementById('pcGrid').innerHTML = 
            '<div class="col-span-full text-center text-slate-400"><p>No PC stations available</p></div>';
          return;
        }

        // Fetch availability status
        const availResponse = await fetch('/api/equipment/pc-availability?attendanceId=' + encodeURIComponent(attendanceId || ''));
        const availData = await availResponse.json();
        
        // Create availability map
        const availMap = new Map();
        if (availData.pcStations) {
          availData.pcStations.forEach(pc => {
            availMap.set(pc.setId, pc);
          });
        }

        const grid = document.getElementById('pcGrid');
        grid.innerHTML = setsData.sets
          .filter(set => set.status === 'active' && availMap.has(set.setId)) // Only show active sets in this session's laboratory
          .map(set => {
            const avail = availMap.get(set.setId);
            const isAvailable = avail.status === 'available';
            const components = set.components ? set.components.split(', ') : [];
            
            return \`
              <div class="pc-card \${isAvailable ? 'available' : 'occupied'} rounded-xl p-5" 
                   onclick="\${isAvailable ? \`selectPC('\${set.setId}')\` : 'return false'}">
                <!-- Header -->
                <div class="flex items-start justify-between mb-3">
                  <div>
                    <h3 class="font-bold text-lg text-emerald-400">\${set.setId}</h3>
                    <p class="text-sm text-slate-300">\${set.setName}</p>
                  </div>
                  <span class="px-2 py-1 rounded-full text-xs font-semibold \${
                    isAvailable 
                      ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30' 
                      : 'bg-red-500/20 text-red-300 border border-red-500/30'
                  }">
                    \${isAvailable ? 'Available' : 'Occupied'}
                  </span>
                </div>

                \${set.location ? \`
                  <div class="text-xs text-slate-400 mb-3">
                    <i class="fas fa-map-marker-alt mr-1"></i>\${set.location}
                  </div>
                \` : ''}

                <!-- Components -->
                <div class="bg-emerald-950/30 rounded-lg p-3">
                  <div class="text-xs font-semibold text-white uppercase tracking-wide mb-2">
                    <i class="fas fa-cube text-emerald-400 mr-1"></i>Components
                  </div>
                  <div class="space-y-1">
                    \${components.slice(0, 4).map(comp => {
                      const icon = getComponentIcon(comp);
                      return \`
                        <div class="flex items-center gap-2 text-xs text-slate-300">
                          <i class="\${icon} text-emerald-400 w-3"></i>
                          <span class="truncate">\${comp.split(' - ')[0]}</span>
                        </div>
                      \`;
                    }).join('')}
                    \${components.length > 4 ? \`
                      <div class="text-xs text-slate-400 mt-1">
                        +\${components.length - 4} more...
                      </div>
                    \` : ''}
                  </div>
                </div>

                \${!isAvailable && avail?.occupiedByName ? \`
                  <div class="mt-3 text-xs text-red-300">
                    <i class="fas fa-user mr-1"></i>Used by \${avail.occupiedByName}
                  </div>
                \` : ''}
              </div>
            \`;
          }).join('');
      } catch (error) {
        console.error('Error loading PCs:', error);
        document.getElementById('pcGrid').innerHTML = 
          '<div class="col-span-full text-center text-red-400"><p>Failed to load PC stations</p></div>';
      }
    }

    function getComponentIcon(component) {
      if (component.includes('CPU')) return 'fas fa-microchip';
      if (component.includes('Monitor')) return 'fas fa-desktop';
      if (component.includes('Keyboard')) return 'fas fa-keyboard';
      if (component.includes('Mouse')) return 'fas fa-mouse';
      if (component.includes('AVR')) return 'fas fa-plug';
      return 'fas fa-cube';
    }

    async function selectPC(setId) {
      try {
        const response = await fetch('/api/equipment/assign-pc', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            setId, 
            attendanceId,
            scheduleId 
          })
        });

        const result = await response.json();
        
        if (result.success) {
          alert('PC station assigned successfully!');
          window.location.href = '/student/dashboard';
        } else {
          alert(result.error || 'Failed to assign PC station');
          loadPCStations(); // Reload to show updated status
        }
      } catch (error) {
        console.error('Error assigning PC:', error);
        alert('Failed to assign PC station');
      }
    }

    loadPCStations();
  </script>
</body>
</html>`;
  
  res.send(html);
});

// Laboratory Schedule Seating Chart
router.get("/api/laboratory-schedules/:scheduleId/seating-chart", getScheduleSeatingChart);

router.get("/api/borrow-records", listBorrowRecords);
router.post("/api/borrow-records", createBorrowRecord);
router.post("/api/borrow-records/qr-student", createStudentQrBorrowRecord);
router.get("/api/borrow-records/qr-student/:equipmentId/status", getStudentQrBorrowStatus);
router.post("/api/borrow-records/qr", createFacultyQrBorrowRecord);
router.get("/api/borrow-records/qr/:equipmentId/status", getFacultyQrBorrowStatus);
router.put("/api/borrow-records/:id/approve", approveBorrowRecord);
router.put("/api/borrow-records/:id/reject", rejectBorrowRecord);
router.put("/api/borrow-records/:id/cancel", cancelBorrowRecord);
router.put("/api/borrow-records/:id/release", releaseBorrowRecord);
router.put("/api/borrow-records/:id/request-return", requestBorrowReturn);
router.put("/api/borrow-records/:id/return", returnBorrowRecord);
router.put("/api/borrow-records/:id/mark-lost", markBorrowRecordLost);
router.get("/api/borrow-records/:id/history", getBorrowHistory);
router.get("/api/borrow-audit", listBorrowAudit);
router.get("/api/equipment-availability", listEquipmentAvailability);
router.get("/api/equipment-availability/:equipmentId/history", getEquipmentBorrowingHistory);
router.get("/api/admin/notifications", listBorrowNotifications);
router.get("/api/borrow-notifications", listBorrowNotifications);
router.put("/api/borrow-notifications/:id/read", markBorrowNotificationRead);
router.get("/api/audit-logs", getAuditLogs);
router.get("/api/equipment-audit-trail", requireAdminForAudit, getAuditTrail);
router.get("/api/announcements", (req, res) => {
  res.json([]);
});
router.get("/api/attendance/records", getAttendanceRecords);
router.get("/api/attendance/stats", getAttendanceStats);
router.get("/api/attendance/current", async (req, res) => {
  try {
    const userId = req.session?.userId;
    if (!userId) return res.status(401).json({ success: false, error: "Authentication required." });

    const records = await sequelize.query(
      `SELECT a.id, a.sessionToken, a.subject, a.instructor, a.lab,
              a.laboratoryScheduleId, ats.expiresAt
       FROM attendance a
       INNER JOIN attendance_sessions ats ON ats.token = a.sessionToken
       INNER JOIN users u ON u.id = ?
       WHERE (BINARY a.studentId = BINARY u.student_number OR BINARY a.studentId = BINARY CAST(? AS CHAR))
         AND ats.expiresAt > NOW()
       ORDER BY a.createdAt DESC
       LIMIT 1`,
      { replacements: [userId, userId], type: QueryTypes.SELECT }
    );

    return res.json({
      success: true,
      hasActiveAttendance: records.length > 0,
      attendance: records[0] || null
    });
  } catch (error) {
    console.error("[attendance/current] Failed to resolve active attendance", error);
    return res.status(500).json({ success: false, error: "Unable to check active attendance." });
  }
});
router.get("/api/instructor/attendance-dashboard", getInstructorAttendanceDashboard);
router.get("/api/instructor/attendance-dashboard/:sessionId", getInstructorAttendanceSessionDetails);
router.get("/api/faculty/attendance-history", getFacultyScheduleAttendanceHistory);
router.get("/api/faculty/schedules/:scheduleId/attendance", getFacultyScheduleAttendanceHistory);
router.get("/api/faculty/schedules/:scheduleId/attendance/export", exportFacultyScheduleAttendanceHistory);
router.get("/api/attendance/scan", scanAttendance);
router.post("/api/attendance/scan", scanAttendance);
router.get("/attendance/scan/:token", scanAttendance);
router.post("/attendance/scan/:token", scanAttendance);
router.post("/api/attendance/session", createAttendanceSession);
router.get("/api/faculty/schedules/:scheduleId/attendance-qr-students", getStudentAttendanceQrRoster);
router.post("/api/faculty/schedules/:scheduleId/attendance-qr-codes", createStudentAttendanceQrs);
router.get("/api/laboratory-schedule-instructors", async (req, res) => {
  try {
    if (!req.session?.userId) {
      return res.status(401).json({ error: "Please log in to view laboratory schedule instructors." });
    }
    const currentUser = await User.findByPk(req.session.userId, {
      attributes: ["id", "name", "role", "campus", "college"]
    });
    const currentRole = normalizeRoleName(currentUser?.role);
    if (!currentUser) return res.status(401).json({ error: "Your account could not be verified." });
    if (["faculty", "instructor"].includes(currentRole)) {
      return res.json([{
        id: `user:${currentUser.id}`,
        accountId: String(currentUser.id),
        name: String(currentUser.name || "").trim(),
        campus: currentUser.campus || "",
        college: currentUser.college || ""
      }]);
    }
    if (!isAdminRole(currentRole)) {
      return res.status(403).json({ error: "Only faculty instructors can view or select schedule instructors." });
    }

    const accounts = await User.findAll({
      where: { role: { [Op.in]: ["faculty", "Faculty", "instructor", "Instructor"] } },
      attributes: ["id", "name", "role", "campus", "college"],
      order: [["name", "ASC"]]
    });
    const instructors = accounts.flatMap((account) => {
      const item = account.toJSON();
      const name = String(item.name || "").trim();
      if (!name || String(item.college || "").trim().toUpperCase() !== "CCS") return [];
      return [{
        id: `user:${item.id}`,
        accountId: String(item.id),
        name,
        campus: item.campus || "",
        college: "CCS"
      }];
    });
    res.json(instructors);
  } catch (error) {
    console.error("Failed to load laboratory schedule instructors.", error);
    res.status(500).json({ error: "Failed to load Faculty accounts." });
  }
});
const getComputerLabAdminContext = async (req, res) => {
  if (!req.session?.userId) {
    res.status(401).json({ error: "Please log in to manage computer labs." });
    return null;
  }
  const user = await User.findByPk(req.session.userId, { attributes: ["id", "role", "campus"] });
  if (!user || !isAdminRole(user.role)) {
    res.status(403).json({ error: "Only administrators can manage computer labs." });
    return null;
  }
  const campus = normalizeCampus(user.campus) || normalizeCampus(String(user.campus || "").replace(/\s*Campus\s*$/i, ""));
  if (!campus) {
    res.status(403).json({ error: "Your administrator account must have an assigned campus." });
    return null;
  }
  return { user, campus };
};

const getComputerLabReadContext = async (req, res) => {
  if (!req.session?.userId) {
    res.status(401).json({ error: "Please log in to view computer labs." });
    return null;
  }
  const user = await User.findByPk(req.session.userId, { attributes: ["id", "role", "campus"] });
  const campus = normalizeCampus(user?.campus) || normalizeCampus(String(user?.campus || "").replace(/\s*Campus\s*$/i, ""));
  if (!user || !campus) {
    res.status(403).json({ error: "Your account must have an assigned campus to view computer labs." });
    return null;
  }
  return { user, campus };
};

router.get("/api/computer-labs/revision", async (req, res) => {
  try {
    const context = await getComputerLabReadContext(req, res);
    if (!context) return;
    await ensureArchiveRecordsTable();
    const [rows] = await sequelize.query(
      `SELECT
         (SELECT COUNT(*) FROM computer_labs WHERE campus = ?) AS labCount,
         COALESCE((SELECT DATE_FORMAT(MAX(GREATEST(createdAt, updatedAt)), '%Y-%m-%d %H:%i:%s')
                   FROM computer_labs WHERE campus = ?), '') AS latestLabChange,
         (SELECT COUNT(*)
          FROM archived_records ar
          INNER JOIN computer_labs lab
            ON ar.entityType = 'computer-lab' AND BINARY ar.entityId = BINARY CAST(lab.id AS CHAR)
          WHERE lab.campus = ?) AS archivedCount,
         COALESCE((SELECT DATE_FORMAT(MAX(ar.archivedAt), '%Y-%m-%d %H:%i:%s')
                   FROM archived_records ar
                   INNER JOIN computer_labs lab
                     ON ar.entityType = 'computer-lab' AND BINARY ar.entityId = BINARY CAST(lab.id AS CHAR)
                   WHERE lab.campus = ?), '') AS latestArchiveChange`,
      { replacements: [context.campus, context.campus, context.campus, context.campus] }
    );
    const row = rows[0] || {};
    // Bump the feed revision when its room aggregation rules change so already
    // open directory pages fetch the corrected room list on their next poll.
    const revision = ["registered-room-priority-v1", row.labCount || 0, row.latestLabChange || "", row.archivedCount || 0, row.latestArchiveChange || ""].join(":");
    res.set("Cache-Control", "no-store");
    return res.json({ success: true, revision });
  } catch (error) {
    console.error("Failed to read computer lab revision:", error);
    return res.status(500).json({ error: "Failed to check computer labs for updates." });
  }
});

router.get("/api/computer-labs", async (req, res) => {
  try {
    const context = await getComputerLabReadContext(req, res);
    if (!context) return;
    const campusNames = [context.campus, `${context.campus} Campus`];
    const [[savedLabs], [equipmentLabs], [scheduledLabs]] = await Promise.all([
      sequelize.query(
        `SELECT id, name, roomNumber, campus, sourceKey, createdAt
         FROM computer_labs WHERE campus = ? ORDER BY name ASC, id ASC`,
        { replacements: [context.campus] }
      ),
      sequelize.query(
        `SELECT laboratoryRoom AS label, COUNT(*) AS equipmentCount
         FROM equipment
         WHERE campus IN (:campusNames) AND laboratoryRoom IS NOT NULL AND TRIM(laboratoryRoom) <> ''
         GROUP BY laboratoryRoom`,
        { replacements: { campusNames } }
      ),
      sequelize.query(
        `SELECT laboratoryRoom AS label
         FROM laboratory_schedules
         WHERE campus IN (:campusNames) AND laboratoryRoom IS NOT NULL AND TRIM(laboratoryRoom) <> ''
         GROUP BY laboratoryRoom`,
        { replacements: { campusNames } }
      )
    ]);

    const labsByName = new Map();
    const savedBySourceKey = new Map(savedLabs.filter((lab) => lab.sourceKey).map((lab) => [lab.sourceKey, lab]));
    const savedByLabel = new Map();
    savedLabs.forEach((lab) => {
      [lab.name, formatComputerLabLocation(lab), `${lab.name} - ${lab.roomNumber || ""}`]
        .filter(Boolean)
        .forEach((label) => savedByLabel.set(normalizeLabLabel(label), lab));
    });
    const getLabDetails = (label) => {
      const sourceLabel = String(label || '').trim();
      const labNumber = sourceLabel.match(/(?:computer\s*lab|com\s*lab|comlab|laboratory|lab)\s*[-#:]?\s*(\d+)\b/i)?.[1];
      const roomLabel = sourceLabel.match(/\b(?:room|rm\.?)\s*[-#:]?\s*([a-z0-9-]+)\b/i)?.[1];
      const knownRoom = { "1": "202", "2": "204" }[labNumber] || null;
      return {
        name: labNumber ? `COMLAB ${labNumber}` : sourceLabel,
        roomNumber: roomLabel ? `Room ${roomLabel}` : knownRoom ? `Room ${knownRoom}` : null,
        sourceKey: labNumber ? `legacy:computer lab ${labNumber}` : `legacy:${normalizeLabLabel(sourceLabel)}`
      };
    };
    const addLab = ({ label, roomNumber = null, id = null, createdAt = null, equipmentCount = 0 }) => {
      const details = getLabDetails(label);
      const existingSaved = savedByLabel.get(normalizeLabLabel(label)) ||
        savedByLabel.get(normalizeLabLabel(details.name)) ||
        savedBySourceKey.get(details.sourceKey);
      const key = existingSaved ? `id:${existingSaved.id}` : details.name.toLocaleLowerCase();
      let lab = labsByName.get(key);
      if (!lab) {
        const saved = existingSaved || (id ? savedLabs.find((record) => String(record.id) === String(id)) : null);
        lab = {
          id: saved?.id || id,
          name: saved?.name || details.name,
          roomNumbers: saved?.roomNumber ? [saved.roomNumber] : [],
          campus: saved?.campus || context.campus,
          equipmentCount: 0,
          createdAt: saved?.createdAt || createdAt,
          sourceKey: saved?.sourceKey || (saved ? null : details.sourceKey)
        };
        labsByName.set(key, lab);
      } else if (id && !lab.id) {
        lab.id = id;
        lab.createdAt = createdAt;
      }
      // A registered lab's roomNumber is its canonical location. Equipment and
      // schedule labels can retain older room text, so only infer a room from
      // those labels when the saved lab has no room of its own.
      const room = existingSaved?.roomNumber
        ? ''
        : String(roomNumber || details.roomNumber || '').trim();
      if (room && !lab.roomNumbers.some((existingRoom) => existingRoom.toLowerCase() === room.toLowerCase())) {
        lab.roomNumbers.push(room);
      }
      lab.equipmentCount += Number(equipmentCount || 0);
    };

    equipmentLabs.forEach((lab) => addLab(lab));
    scheduledLabs.forEach((lab) => addLab(lab));

    savedLabs.forEach((lab) => addLab({ ...lab, label: lab.name }));
    const archivedIds = new Set(await getArchivedEntityIds("computer-lab"));

    return res.json([...labsByName.values()]
      .filter((lab) => lab.id && !archivedIds.has(String(lab.id)))
      .sort((a, b) => a.name.localeCompare(b.name)));
  } catch (error) {
    console.error("Failed to load computer labs.", error);
    return res.status(500).json({ error: "Failed to load computer labs." });
  }
});

router.post("/api/computer-labs", async (req, res) => {
  try {
    const context = await getComputerLabAdminContext(req, res);
    if (!context) return;
    const name = String(req.body?.name ?? req.body?.lab_name ?? "").trim().replace(/\s+/g, " ");
    const roomNumber = String(
      req.body?.roomNumber ?? req.body?.room_number ?? req.body?.room_location ?? ""
    ).trim().replace(/\s+/g, " ");
    if (!name || name.length > 100) {
      return res.status(400).json({
        success: false,
        message: "Enter a lab name up to 100 characters.",
        error: "Enter a lab name up to 100 characters."
      });
    }
    if (roomNumber.length > 50) {
      return res.status(400).json({
        success: false,
        message: "Room number must be 50 characters or fewer.",
        error: "Room number must be 50 characters or fewer."
      });
    }
    await ensureArchiveRecordsTable();
    const [existing] = await sequelize.query(
      `SELECT lab.id, ar.id AS archiveId
       FROM computer_labs lab
       LEFT JOIN archived_records ar
         ON ar.entityType = 'computer-lab' AND BINARY ar.entityId = BINARY CAST(lab.id AS CHAR)
       WHERE lab.campus = ? AND LOWER(lab.name) = LOWER(?)
         AND LOWER(COALESCE(lab.roomNumber, '')) = LOWER(?)
       LIMIT 1`,
      { replacements: [context.campus, name, roomNumber] }
    );
    if (existing.length) {
      if (existing[0].archiveId) {
        const message = "This computer lab is archived. Restore it from Archived Records before adding it again.";
        return res.status(409).json({
          success: false,
          code: "COMPUTER_LAB_ARCHIVED",
          archived: true,
          archiveId: existing[0].archiveId,
          message,
          error: message
        });
      }
      const message = "A computer lab with this name and room already exists at your campus.";
      return res.status(409).json({ success: false, message, error: message });
    }
    const [result] = await sequelize.query(
      `INSERT INTO computer_labs (name, roomNumber, campus, createdBy, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, NOW(), NOW())`,
      { replacements: [name, roomNumber, context.campus, context.user.id] }
    );
    return res.status(201).json({
      success: true,
      message: `${name} was created successfully.`,
      id: result.insertId,
      name,
      roomNumber: roomNumber || null,
      campus: context.campus
    });
  } catch (error) {
    console.error("Failed to create computer lab.", error);
    const databaseErrorCode = error?.original?.code || error?.parent?.code || error?.code;
    if (databaseErrorCode === "ER_DUP_ENTRY") {
      const message = "A computer lab with this name and room already exists at your campus.";
      return res.status(409).json({ success: false, message, error: message });
    }
    const message = ["ER_BAD_FIELD_ERROR", "ER_NO_SUCH_TABLE", "ER_BAD_NULL_ERROR", "ER_NO_DEFAULT_FOR_FIELD"].includes(databaseErrorCode)
      ? "Computer lab database setup is incomplete. Verify migrations 035 and 036 are applied."
      : ["ER_ACCESS_DENIED_ERROR", "ER_TABLEACCESS_DENIED_ERROR", "ER_DBACCESS_DENIED_ERROR"].includes(databaseErrorCode)
        ? "The database account does not have permission to add computer labs. Contact the system administrator."
        : databaseErrorCode
          ? `Unable to create the computer lab (database error ${databaseErrorCode}). Please contact the system administrator.`
          : error?.name
            ? `Unable to create the computer lab (${error.name}). Please contact the system administrator.`
            : "Unable to create the computer lab. Please try again.";
    return res.status(500).json({ success: false, message, error: message });
  }
});

router.put("/api/computer-labs/:id", async (req, res) => {
  try {
    const context = await getComputerLabAdminContext(req, res);
    if (!context) return;
    const id = String(req.params.id || "").trim();
    if (!/^\d+$/.test(id)) return res.status(400).json({ error: "Invalid computer lab." });
    const name = String(req.body?.name || "").trim().replace(/\s+/g, " ");
    const roomNumber = String(req.body?.roomNumber || "").trim().replace(/\s+/g, " ");
    if (!name || name.length > 100) return res.status(400).json({ error: "Enter a lab name up to 100 characters." });
    if (roomNumber.length > 50) return res.status(400).json({ error: "Room or location must be 50 characters or fewer." });

    const [labs] = await sequelize.query(
      `SELECT id, name, roomNumber FROM computer_labs WHERE id = ? AND campus = ? LIMIT 1`,
      { replacements: [id, context.campus] }
    );
    if (!labs.length) return res.status(404).json({ error: "Computer lab not found at your campus." });
    const [duplicates] = await sequelize.query(
      `SELECT id FROM computer_labs
       WHERE campus = ? AND LOWER(name) = LOWER(?) AND LOWER(COALESCE(roomNumber, '')) = LOWER(?) AND id <> ?
       LIMIT 1`,
      { replacements: [context.campus, name, roomNumber, id] }
    );
    if (duplicates.length) return res.status(409).json({ error: "A computer lab with this name and room already exists at your campus." });

    const locationLabel = formatComputerLabLocation({ name, roomNumber });
    await sequelize.transaction(async (transaction) => {
      await sequelize.query(
        `UPDATE computer_labs SET name = ?, roomNumber = ?, updatedAt = NOW() WHERE id = ? AND campus = ?`,
        { replacements: [name, roomNumber || null, id, context.campus], transaction }
      );
      await sequelize.query(
        `UPDATE equipment SET laboratoryRoom = ? WHERE computerLabId = ?`,
        { replacements: [locationLabel, id], transaction }
      );
      await sequelize.query(
        `UPDATE laboratory_schedules SET laboratoryRoom = ?, updatedAt = NOW() WHERE computerLabId = ?`,
        { replacements: [locationLabel, id], transaction }
      );
      await sequelize.query(
        `UPDATE attendance_sessions SET room = ?, updatedAt = NOW() WHERE computerLabId = ?`,
        { replacements: [locationLabel, id], transaction }
      );
      await sequelize.query(
        `UPDATE attendance SET lab = ?, updatedAt = NOW() WHERE computerLabId = ?`,
        { replacements: [locationLabel, id], transaction }
      );
      await sequelize.query(
        `UPDATE maintenance_requests SET laboratory_room = ?, updated_at = NOW() WHERE computerLabId = ?`,
        { replacements: [locationLabel, id], transaction }
      );
      await sequelize.query(
        `UPDATE missing_equipment_history SET laboratoryRoom = ?, updatedAt = NOW() WHERE computerLabId = ?`,
        { replacements: [locationLabel, id], transaction }
      );
      await sequelize.query(
        `UPDATE equipment_usage_logs SET laboratoryId = ?, updatedAt = NOW() WHERE computerLabId = ?`,
        { replacements: [locationLabel, id], transaction }
      );
      await sequelize.query(
        `UPDATE equipment_inventory_checks SET computerLabId = ?, updatedAt = NOW() WHERE computerLabId = ?`,
        { replacements: [id, id], transaction }
      );
      await sequelize.query(
        `UPDATE equipment_inventory_check_items checkItem
         INNER JOIN equipment e ON e.id = checkItem.equipmentId
         SET checkItem.expectedLocation = ?, checkItem.actualLocation = ?
         WHERE e.computerLabId = ?`,
        { replacements: [locationLabel, locationLabel, id], transaction }
      );
      await sequelize.query(
        `UPDATE equipment_technician_reports SET computerLabId = ?, updatedAt = NOW() WHERE computerLabId = ?`,
        { replacements: [id, id], transaction }
      );
    });
    await logAuditEntry(req, {
      action: "Computer Lab Updated",
      module: "Computer Labs",
      resourceId: id,
      description: `Updated computer lab ${labs[0].name}.`,
      details: { oldName: labs[0].name, oldRoomNumber: labs[0].roomNumber, name, roomNumber: roomNumber || null, campus: context.campus }
    });
    const [updated] = await sequelize.query(
      `SELECT id, name, roomNumber, campus, createdAt FROM computer_labs WHERE id = ?`,
      { replacements: [id] }
    );
    return res.json(updated[0]);
  } catch (error) {
    console.error("Failed to update computer lab.", error);
    return res.status(500).json({ error: "Failed to update computer lab." });
  }
});

router.get("/api/laboratory-schedules", async (req, res) => {
  try {
    const userId = req.session?.userId || null;
    if (!userId) return res.status(401).json({ error: "Please log in to view schedules." });
    const viewer = await User.findByPk(userId, { attributes: ["id", "role", "campus"] });
    if (!viewer) return res.status(401).json({ error: "Your account could not be verified." });
    const userRole = normalizeRoleName(viewer.role);

    // Get user's campus for filtering
    const userCampus = normalizeCampus(viewer.campus) || await getUserCampusFromSession(req);
    
    let where = {};
    const isFaculty = ["faculty", "instructor"].includes(userRole);
    if (isAdminRole(userRole)) {
      if (!userCampus) return res.status(403).json({ error: "User campus is not assigned." });
    } else if (isFaculty) {
      if (!userCampus) return res.status(403).json({ error: "Your campus must be assigned before viewing schedules." });
    } else if (userRole === 'technician') {
      where.createdBy = userId;
    } else {
      // Students and others: no schedules returned
      return res.json([]);
    }

    // Add campus filter - users can only see schedules from their campus
    const campusFilter = {};
    if (userCampus) {
      const campusName = String(userCampus).trim().replace(/\s*Campus\s*$/i, "");
      campusFilter.campus = { [Op.in]: [campusName, `${campusName} Campus`] };
      where = { ...where, ...campusFilter };
    }

    if (req.query.scope === "laboratory") {
      if (!isFaculty) {
        return res.status(403).json({ error: "Only Faculty can view schedules in their laboratory." });
      }
      if (!userCampus) {
        return res.status(403).json({ error: "Your campus must be assigned before viewing laboratory schedules." });
      }
      const laboratoryRoom = String(req.query.laboratoryRoom || "").trim();
      if (!laboratoryRoom) {
        return res.status(400).json({ error: "Choose a laboratory to view its schedule." });
      }
      where = { ...where, ...campusFilter, laboratoryRoom };
    }

    where.id = { [Op.notIn]: await getArchivedEntityIds("laboratory-schedule") };
    const schedules = await LaboratorySchedule.findAll({
      where,
      order: [['dayOfWeek', 'ASC'], ['startTime', 'ASC']]
    });

    const scheduleIds = schedules.map((schedule) => schedule.id).filter(Boolean);
    
    const enrolledCounts = scheduleIds.length
      ? await ClassListEntry.findAll({
          where: { laboratoryScheduleId: { [Op.in]: scheduleIds } },
          attributes: [
            "laboratoryScheduleId",
            [sequelize.fn("COUNT", sequelize.col("id")), "enrolledCount"]
          ],
          group: ["laboratoryScheduleId"],
          raw: true
        })
      : [];
    const countMap = new Map(enrolledCounts.map((entry) => [
      String(entry.laboratoryScheduleId),
      Number(entry.enrolledCount || 0)
    ]));
    const classListSections = scheduleIds.length
      ? await ClassListEntry.findAll({
          where: { laboratoryScheduleId: { [Op.in]: scheduleIds } },
          attributes: ["laboratoryScheduleId", "courseSection", "program", "year", "section"],
          group: ["laboratoryScheduleId", "courseSection", "program", "year", "section"]
        })
      : [];
    const sectionsBySchedule = new Map();
    classListSections.forEach((entry) => {
      const sectionName = entry.courseSection ||
        [entry.program, entry.year, entry.section].filter(Boolean).join(" ");
      if (!sectionName) return;
      const key = String(entry.laboratoryScheduleId);
      const sections = sectionsBySchedule.get(key) || new Set();
      sections.add(sectionName);
      sectionsBySchedule.set(key, sections);
    });

    res.json(schedules.map((schedule) => {
      const item = schedule.toJSON();
      return {
        ...item,
        classListCount: countMap.get(String(item.id)) || 0,
        classSections: Array.from(sectionsBySchedule.get(String(item.id)) || []),
        isOwnSchedule: isFaculty && String(item.instructorUserId || "") === String(viewer.id)
      };
    }));
  } catch (error) {
    console.error("Failed to load laboratory schedules", error);
    res.status(500).json({ error: "Failed to load laboratory schedules" });
  }
});

const resolveScheduleInstructor = async (instructorRef, requestCampus) => {
  const reference = String(instructorRef || "").trim();
  if (reference.startsWith("user:") || /^\d+$/.test(reference)) {
    const userId = reference.startsWith("user:") ? reference.slice(5) : reference;
    const user = await User.findByPk(userId, { attributes: ["id", "name", "role", "campus", "college"] });
    if (!user || !["faculty", "instructor"].includes(normalizeRoleName(user.role)) ||
        String(user.college || "").trim().toUpperCase() !== "CCS") {
      return { error: "Select a registered Faculty account from the schedule instructor list." };
    }
    const name = String(user.name || "").trim();
    const campus = normalizeCampus(user.campus) || normalizeCampus(requestCampus);
    if (!name || !campus) return { error: "The instructor and Supply Office accounts must have a valid campus." };
    return { id: user.id, name, campus };
  }

  return { error: "Select a registered Faculty account from the schedule instructor list." };
};

router.get("/api/faculty/schedule-students", async (req, res) => {
  try {
    if (!req.session?.userId) return res.status(401).json({ error: "Please log in to search students." });
    const faculty = await User.findByPk(req.session.userId, {
      attributes: ["id", "role", "campus"]
    });
    if (!faculty || !["faculty", "instructor"].includes(normalizeRoleName(faculty.role))) {
      return res.status(403).json({ error: "Only Faculty can search students for a schedule roster." });
    }
    const campus = normalizeCampus(faculty.campus);
    if (!campus) return res.status(403).json({ error: "Your Faculty account must have a valid campus." });

    const query = String(req.query.q || "").trim();
    if (query.length < 2) return res.json([]);
    const campusName = String(campus).replace(/\s*Campus\s*$/i, "").trim();
    const students = await User.findAll({
      where: {
        role: "student",
        campus: { [Op.in]: [campusName, `${campusName} Campus`] },
        [Op.or]: [
          { name: { [Op.like]: `%${query}%` } },
          { student_number: { [Op.like]: `%${query}%` } }
        ]
      },
      attributes: ["id", "name", "student_number", "program", "year", "section"],
      order: [["name", "ASC"]],
      limit: 20
    });
    return res.json(students.map((student) => ({
      id: student.id,
      studentId: student.student_number || "",
      name: student.name,
      program: student.program || "",
      year: student.year || "",
      section: student.section || ""
    })));
  } catch (error) {
    console.error("Failed to search students for Faculty schedule roster.", error);
    return res.status(500).json({ error: "Failed to search registered students." });
  }
});

const getFacultyOwnedSchedule = async (req, res) => {
  if (!req.session?.userId) {
    res.status(401).json({ error: "Please log in to manage a schedule roster." });
    return null;
  }
  const faculty = await User.findByPk(req.session.userId, {
    attributes: ["id", "role", "campus"]
  });
  if (!faculty || !["faculty", "instructor"].includes(normalizeRoleName(faculty.role))) {
    res.status(403).json({ error: "Only the assigned instructor can manage this class roster." });
    return null;
  }
  const schedule = await LaboratorySchedule.findByPk(req.params.id);
  if (!schedule) {
    res.status(404).json({ error: "Laboratory schedule not found." });
    return null;
  }
  const isOwner = String(schedule.instructorUserId || "") === String(faculty.id);
  const facultyCampus = normalizeCampus(faculty.campus);
  if (!isOwner || !facultyCampus || !canManageRecord(facultyCampus, schedule.campus)) {
    res.status(403).json({ error: "You can manage rosters only for your own schedules at your campus." });
    return null;
  }
  return { faculty, schedule };
};

router.get("/api/laboratory-schedules/:id/roster", async (req, res) => {
  try {
    const access = await getFacultyOwnedSchedule(req, res);
    if (!access) return;
    const entries = await ClassListEntry.findAll({
      where: { laboratoryScheduleId: access.schedule.id },
      attributes: ["id", "studentId", "fullName", "section", "year", "program", "matchStatus"],
      order: [["fullName", "ASC"]]
    });
    return res.json(entries);
  } catch (error) {
    console.error("Failed to load Faculty schedule roster.", error);
    return res.status(500).json({ error: "Failed to load the class roster." });
  }
});

router.put("/api/laboratory-schedules/:id/roster", async (req, res) => {
  try {
    const access = await getFacultyOwnedSchedule(req, res);
    if (!access) return;
    const requestedStudents = req.body?.students;
    if (!Array.isArray(requestedStudents) || requestedStudents.length > 500) {
      return res.status(400).json({ error: "Provide a roster with no more than 500 students." });
    }
    const normalizedStudents = requestedStudents.map((student) => ({
      studentId: String(student?.studentId || student?.studentNumber || "").trim(),
      fullName: String(student?.fullName || student?.name || "").trim(),
      section: String(student?.section || "").trim(),
      year: String(student?.year || "").trim(),
      program: String(student?.program || "").trim(),
      email: String(student?.email || "").trim()
    }));
    if (normalizedStudents.some((student) => !student.studentId && !student.fullName)) {
      return res.status(400).json({ error: "Each roster entry needs a Student ID or student name." });
    }
    const normalizedIds = normalizedStudents.map((student) => student.studentId.toLocaleLowerCase()).filter(Boolean);
    const normalizedNames = normalizedStudents.map((student) => normalizeStudentName(student.fullName)).filter(Boolean);
    if (new Set(normalizedIds).size !== normalizedIds.length || new Set(normalizedNames).size !== normalizedNames.length) {
      return res.status(400).json({ error: "Remove duplicate Student IDs or names before saving." });
    }

    const validEntries = await resolveClassListEntries(normalizedStudents, access.schedule.id, access.schedule.campus);
    if (validEntries.length !== normalizedStudents.length) {
      return res.status(400).json({ error: "Some roster entries are incomplete. Add a student name or a registered Student ID." });
    }
    const transaction = await sequelize.transaction();
    try {
      await ClassListEntry.destroy({
        where: { laboratoryScheduleId: access.schedule.id },
        transaction
      });
      if (validEntries.length) {
        await ClassListEntry.bulkCreate(validEntries, { transaction });
      }
      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
    await logAuditEntry(req, {
      action: "Laboratory Schedule Roster Updated",
      module: "Laboratory Scheduling",
      resourceId: access.schedule.id,
      description: `Updated the student roster for ${access.schedule.subject}.`,
      details: { scheduleId: access.schedule.id, studentCount: validEntries.length }
    });
    return res.json({ success: true, studentCount: validEntries.length });
  } catch (error) {
    console.error("Failed to update Faculty schedule roster.", error);
    return res.status(500).json({ error: "Failed to save the class roster." });
  }
});

router.post("/api/laboratory-schedules", requireScheduleCreatorRole, handleScheduleClassListUpload, async (req, res) => {
  try {
    const { subject, instructorId, laboratoryRoom, dayOfWeek, startTime, endTime, status, qrEnabled, classList } = req.body;
    const resolvedClassSection = normalizeScheduleClassSection(req.body.yearLevel, req.body.section);
    if (resolvedClassSection.error) return res.status(400).json({ error: resolvedClassSection.error });
    const { yearLevel, section } = resolvedClassSection;
    const requestedScheduleColor = req.body.scheduleColor || DEFAULT_SCHEDULE_COLOR;
    const scheduleColor = normalizeScheduleColor(requestedScheduleColor);
    if (!scheduleColor) return res.status(400).json({ error: "Choose a valid schedule color." });
    const uploadedFile = req.file;
    const sessionUserId = req.session?.userId || null;
    const scheduleCreator = req.scheduleCreator;

    console.log("[schedule-upload] content-type:", req.headers["content-type"]);
    const loggedRequestBody = { ...req.body };
    if (loggedRequestBody.classList) loggedRequestBody.classList = "[redacted]";
    console.log("[schedule-upload] req.body:", loggedRequestBody);
    console.log("[schedule-upload] request.file:", uploadedFile ? { fieldname: uploadedFile.fieldname, originalname: uploadedFile.originalname, mimetype: uploadedFile.mimetype, size: uploadedFile.size } : null);
    console.log("[schedule-upload] session userId:", sessionUserId);
    console.log("[schedule-upload] session userRole:", req.session?.userRole);

    const uploadedClassListBuffer = getUploadedFileBuffer(uploadedFile);
    const hasClassListInput = Boolean(uploadedClassListBuffer || (typeof classList === "string" && classList.length) || (Array.isArray(classList) && classList.length));
    let classListWarning = null;

    const creatorRole = normalizeRoleName(scheduleCreator?.role);
    if (!subject || (!["faculty", "instructor"].includes(creatorRole) && !instructorId) ||
        !laboratoryRoom || !dayOfWeek || !startTime || !endTime) {
      return res.status(400).json({ error: "Subject, instructor, laboratory, day, and time are required." });
    }
    const userCampus = normalizeCampus(scheduleCreator?.campus) || await getUserCampusFromSession(req);
    if (!userCampus) return res.status(403).json({ error: "Unauthorized: User campus not found." });
    const resolvedInstructor = ["faculty", "instructor"].includes(creatorRole)
      ? {
          id: scheduleCreator.id,
          name: String(scheduleCreator.name || "").trim(),
          campus: normalizeCampus(scheduleCreator.campus) || userCampus
        }
      : await resolveScheduleInstructor(instructorId, userCampus);
    if (resolvedInstructor.error) return res.status(400).json({ error: resolvedInstructor.error });
    const { id: instructorUserId, name: instructor, campus: canonicalCampus } = resolvedInstructor;
    // Class list is now optional - removed validation

    // Campus-based authorization check
    if (!canManageRecord(userCampus, canonicalCampus)) {
      return res.status(403).json({ error: "You do not have permission to create schedules for another campus." });
    }

    // Normalize and validate laboratory room and campus and day
    const scheduleLab = await findComputerLabByLabel(laboratoryRoom, canonicalCampus);
    const archivedLabIds = new Set(await getArchivedEntityIds("computer-lab"));
    if (!scheduleLab || archivedLabIds.has(String(scheduleLab.id))) {
      return res.status(400).json({ error: "Choose an active computer lab registered at your campus." });
    }
    const canonicalRoom = formatComputerLabLocation(scheduleLab);

    if (!ALLOWED_DAYS.includes(dayOfWeek)) {
      return res.status(400).json({ error: "Invalid day. Allowed: Monday–Sunday" });
    }

    const parsedStartTime = parseScheduleClockTime(startTime);
    const parsedEndTime = parseScheduleClockTime(endTime);
    if (!isAllowedScheduleClockTime(startTime) || !isAllowedScheduleClockTime(endTime) ||
        parsedStartTime === null || parsedEndTime === null || parsedEndTime <= parsedStartTime) {
      return res.status(400).json({ error: "Choose a time between 7:30 AM and 5:30 PM in 30-minute intervals, and make sure End Time is later than Start Time." });
    }

    // Check for schedule conflicts before creating (authoritative server-side check)
    const conflictResult = await findConflictingSchedule({ laboratoryRoom: canonicalRoom, instructor, instructorUserId, dayOfWeek, campus: canonicalCampus, startTime, endTime });
    if (conflictResult) {
      const conflict = conflictResult.schedule;
      const conflictMessage = conflictResult.type === "laboratory"
        ? `Schedule conflict: ${canonicalRoom.startsWith("Laboratory 2") ? "COMLAB 2" : "COMLAB 1"} is already occupied during this time.`
        : "Schedule conflict: This instructor already has a schedule during this time.";
      return res.status(409).json({
        error: "Schedule Conflict",
        message: conflictMessage,
        conflict: {
          id: conflict.id,
          subject: conflict.subject,
          instructor: conflict.instructor,
          laboratoryRoom: conflict.laboratoryRoom,
          campus: conflict.campus,
          dayOfWeek: conflict.dayOfWeek,
          startTime: conflict.startTime,
          endTime: conflict.endTime
        }
      });
    }

    const transaction = await sequelize.transaction();
    try {
      const schedule = await LaboratorySchedule.create({
        subject,
        instructor: instructor || null,
        instructorUserId,
        yearLevel,
        section,
        laboratoryRoom: canonicalRoom,
        computerLabId: scheduleLab.id,
        campus: canonicalCampus,
        createdBy: sessionUserId || null,
        dayOfWeek,
        startTime,
        endTime,
        status: status || "Confirmed",
        qrEnabled: Boolean(qrEnabled),
        scheduleColor
      }, { transaction });

      const existingSession = await AttendanceSession.findOne({
        where: { laboratoryScheduleId: schedule.id },
        transaction
      });

      if (!existingSession) {
        const sessionToken = `att-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        await AttendanceSession.create({
          token: sessionToken,
          title: subject,
          day: dayOfWeek,
          time: [startTime, endTime].filter(Boolean).join(" - "),
          room: canonicalRoom,
          courseSection: getScheduleCourseSection(yearLevel, section),
          status: status || "Confirmed",
          laboratoryScheduleId: schedule.id,
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
        }, { transaction });
      }

      let parsedStudents = [];
      if (typeof classList === "string") {
        try {
          const parsedJson = JSON.parse(classList);
          parsedStudents = Array.isArray(parsedJson) ? parsedJson : [];
        } catch (error) {
          console.warn("[schedule-upload] classList JSON parse failed", error.message);
        }
      } else if (Array.isArray(classList)) {
        parsedStudents = classList;
      }

      if (!parsedStudents.length && uploadedClassListBuffer) {
        parsedStudents = await parseClassListRows(uploadedClassListBuffer, uploadedFile.originalname);
        console.log("[schedule-upload] parsed rows count:", parsedStudents.length);
      }

      const validEntries = await resolveClassListEntries(parsedStudents, schedule.id, canonicalCampus);

      console.log("[attendance-roster-debug] schedule class-list import", {
        scheduleId: schedule.id,
        campus: canonicalCampus,
        parsedRows: parsedStudents.length,
        resolvedRows: validEntries.length
      });

      const students = validEntries;

      if (students.some((entry) => entry.matchStatus === "matched" && entry.studentId)) {
        const session = await AttendanceSession.findOne({ where: { laboratoryScheduleId: schedule.id }, transaction });
        const placeholderRecords = students.filter((entry) => entry.matchStatus === "matched" && entry.studentId).map((entry) => ({
          studentId: entry.studentId,
          fullName: entry.fullName,
          courseSection: entry.courseSection || getScheduleCourseSection(yearLevel, section),
          subject: subject,
          lab: laboratoryRoom,
          instructor: instructor || "Instructor",
          date: new Date().toISOString().slice(0, 10),
          timeIn: "Not recorded",
          status: "Absent",
          sessionToken: session?.token || null,
          laboratoryScheduleId: schedule.id
        }));

        if (placeholderRecords.length) {
          await Attendance.bulkCreate(placeholderRecords, { transaction, ignoreDuplicates: true });
        }
      }

      console.log("[schedule-upload] students prepared for insertion:", validEntries.length);
      console.log("[schedule-upload] bulkCreate payload size:", validEntries.length);

      if (hasClassListInput && !validEntries.length) {
        classListWarning = "The schedule was created, but the optional class list could not be imported. You can add the roster later.";
        console.warn("[schedule-upload] optional class list could not be imported; continuing without roster entries.");
      }

      if (validEntries.length) {
        try {
          const [schemaResult] = await sequelize.query("SHOW CREATE TABLE class_list_entries");
          console.log("[schedule-upload] class_list_entries schema:", JSON.stringify(schemaResult, null, 2));
        } catch (schemaError) {
          console.error("[schedule-upload] failed to query table schema:", schemaError);
        }
        const bulkCreateResult = await ClassListEntry.bulkCreate(validEntries, { transaction });
        console.log("[schedule-upload] total inserted records:", bulkCreateResult?.length || 0);
      }

      await transaction.commit();
      console.log("[schedule-upload] transaction committed successfully");
      console.log("[schedule-upload] schedule created with ID:", schedule.id);

      await logAuditEntry(req, {
        action: "Laboratory Schedule Created",
        module: "Laboratory Scheduling",
        resourceId: schedule.id,
        description: `Created laboratory schedule ${schedule.subject} (${schedule.id}).`,
        details: {
          scheduleId: schedule.id,
          subject: schedule.subject,
          instructor: schedule.instructor,
          instructorUserId: schedule.instructorUserId,
          yearLevel: schedule.yearLevel,
          section: schedule.section,
          laboratoryRoom: schedule.laboratoryRoom,
          campus: schedule.campus,
          dayOfWeek: schedule.dayOfWeek,
          startTime: schedule.startTime,
          endTime: schedule.endTime,
          scheduleColor: schedule.scheduleColor,
          status: schedule.status,
          createdBy: schedule.createdBy
        }
      });

      res.status(201).json({
        schedule: schedule.toJSON(),
        ...(classListWarning ? { warning: classListWarning } : {})
      });
    } catch (error) {
      await transaction.rollback();
      console.error("[schedule-upload] transaction rolled back due to error", error);
      console.error("\n========== ERROR CREATING LABORATORY SCHEDULE ==========");
      console.error("Error name:", error?.name);
      console.error("Error message:", error?.message);
      console.error("Error code:", error?.code);
      console.error("SQL:", error?.sql);
      console.error("Parent error:", error?.parent?.message);
      console.error("Full error object:", error);
      console.error("\nStack trace:");
      console.error(error?.stack);

      let errorMessage = "Failed to create laboratory schedule";
      if (error?.errors && error.errors.length > 0) {
        console.error("\nSequelize validation errors:");
        error.errors.forEach((err, i) => {
          console.error(`  [${i}] ${err.path}: ${err.message}`);
        });
        errorMessage = error.errors[0].message || errorMessage;
      } else if (error?.message) {
        errorMessage = error.message;
      } else if (error?.parent?.message) {
        errorMessage = error.parent.message;
      }
      console.error("==============================================\n");

      res.status(500).json({ error: errorMessage, details: error?.message });
    }
  } catch (error) {
    console.error("[schedule-upload] outer request handler failed", error);
    res.status(500).json({ error: error?.message || "Failed to create laboratory schedule" });
  }
});
router.put("/api/laboratory-schedules/:id", requireScheduleUpdateAccess, upload.single("classListFile"), async (req, res) => {
  try {
    const schedule = await LaboratorySchedule.findByPk(req.params.id);
    if (!schedule) {
      return res.status(404).json({ error: "Schedule not found" });
    }

    // Campus-based authorization check
    const userCampus = await getUserCampusFromSession(req);
    if (!userCampus) {
      return res.status(403).json({ error: "Unauthorized: User campus not found." });
    }
    if (!canManageRecord(userCampus, schedule.campus)) {
      return res.status(403).json({ error: "You do not have permission to update schedules from another campus." });
    }

    const { subject, instructorId, laboratoryRoom, dayOfWeek, startTime, endTime, status, qrEnabled, classList } = req.body;
    const resolvedClassSection = normalizeScheduleClassSection(req.body.yearLevel, req.body.section);
    if (resolvedClassSection.error) return res.status(400).json({ error: resolvedClassSection.error });
    const { yearLevel, section } = resolvedClassSection;
    const requestedScheduleColor = req.body.scheduleColor || schedule.scheduleColor || DEFAULT_SCHEDULE_COLOR;
    const scheduleColor = normalizeScheduleColor(requestedScheduleColor);
    if (!scheduleColor) return res.status(400).json({ error: "Choose a valid schedule color." });
    const uploadedFile = req.file;
    const uploadedClassListBuffer = getUploadedFileBuffer(uploadedFile);
    console.log("[schedule-upload-edit] content-type:", req.headers["content-type"]);
    console.log("[schedule-upload-edit] req.body:", req.body);
    console.log("[schedule-upload-edit] request.file:", uploadedFile ? { fieldname: uploadedFile.fieldname, originalname: uploadedFile.originalname, mimetype: uploadedFile.mimetype, size: uploadedFile.size } : null);
    const editorRole = normalizeRoleName(req.scheduleManager?.role);
    const isFacultyEditor = ["faculty", "instructor"].includes(editorRole);
    if (!subject || (!isFacultyEditor && !instructorId) || !laboratoryRoom || !dayOfWeek || !startTime || !endTime) {
      return res.status(400).json({ error: "Subject, instructor, laboratory, day, and time are required." });
    }
    const resolvedInstructor = isFacultyEditor
      ? {
          id: req.scheduleManager.id,
          name: String(req.scheduleManager.name || "").trim(),
          campus: normalizeCampus(req.scheduleManager.campus) || userCampus
        }
      : await resolveScheduleInstructor(instructorId, userCampus);
    if (resolvedInstructor.error) return res.status(400).json({ error: resolvedInstructor.error });
    const { id: instructorUserId, name: instructor, campus: canonicalCampus } = resolvedInstructor;

    // Normalize and validate laboratory room, campus, and day for edits
    const scheduleLab = await findComputerLabByLabel(laboratoryRoom, canonicalCampus);
    const archivedLabIds = new Set(await getArchivedEntityIds("computer-lab"));
    if (!scheduleLab || archivedLabIds.has(String(scheduleLab.id))) {
      return res.status(400).json({ error: "Choose an active computer lab registered at your campus." });
    }
    const canonicalRoom = formatComputerLabLocation(scheduleLab);

    if (!canManageRecord(userCampus, canonicalCampus)) {
      return res.status(403).json({ error: "You do not have permission to update schedules for another campus." });
    }

    if (!ALLOWED_DAYS.includes(dayOfWeek)) {
      return res.status(400).json({ error: "Invalid day. Allowed: Monday–Sunday" });
    }

    const parsedStartTime = parseScheduleClockTime(startTime);
    const parsedEndTime = parseScheduleClockTime(endTime);
    if (!isAllowedScheduleClockTime(startTime) || !isAllowedScheduleClockTime(endTime) ||
        parsedStartTime === null || parsedEndTime === null || parsedEndTime <= parsedStartTime) {
      return res.status(400).json({ error: "Choose a time between 7:30 AM and 5:30 PM in 30-minute intervals, and make sure End Time is later than Start Time." });
    }

    const transaction = await sequelize.transaction();
    try {
      await schedule.update({
        subject,
        instructor: instructor || null,
        instructorUserId,
        yearLevel,
        section,
        laboratoryRoom: canonicalRoom,
        computerLabId: scheduleLab.id,
        campus: canonicalCampus,
        dayOfWeek,
        startTime,
        endTime,
        status: status || "Confirmed",
        qrEnabled: Boolean(qrEnabled),
        scheduleColor
      }, { transaction });
      await AttendanceSession.update({
        courseSection: getScheduleCourseSection(yearLevel, section)
      }, {
        where: { laboratoryScheduleId: schedule.id },
        transaction
      });

      // Run conflict detection for edits (exclude current schedule id)
      const editConflictResult = await findConflictingSchedule({ laboratoryRoom: canonicalRoom, instructor, instructorUserId, dayOfWeek, campus: canonicalCampus, startTime, endTime, excludeId: schedule.id });
      if (editConflictResult) {
        await transaction.rollback();
        const editConflict = editConflictResult.schedule;
        const conflictMessage = editConflictResult.type === "laboratory"
          ? `Schedule conflict: ${canonicalRoom.startsWith("Laboratory 2") ? "COMLAB 2" : "COMLAB 1"} is already occupied during this time.`
          : "Schedule conflict: This instructor already has a schedule during this time.";
        return res.status(409).json({
          error: "Schedule Conflict",
          message: conflictMessage,
          conflict: {
            id: editConflict.id,
            subject: editConflict.subject,
            instructor: editConflict.instructor,
            laboratoryRoom: editConflict.laboratoryRoom,
            campus: editConflict.campus,
            dayOfWeek: editConflict.dayOfWeek,
            startTime: editConflict.startTime,
            endTime: editConflict.endTime
          }
        });
      }

      if (uploadedClassListBuffer || typeof classList === "string" || Array.isArray(classList)) {
        await ClassListEntry.destroy({ where: { laboratoryScheduleId: schedule.id }, transaction });

        let parsedStudents = [];
        if (uploadedClassListBuffer) {
          parsedStudents = await parseClassListRows(uploadedClassListBuffer, uploadedFile.originalname);
          console.log("[schedule-upload-edit] parsed rows count:", parsedStudents.length);
          if (parsedStudents[0]) {
            console.log(parsedStudents[0]);
            console.log("typeof studentId:", typeof parsedStudents[0].studentId);
            console.log("studentId:", parsedStudents[0].studentId);
            console.log("[schedule-upload-edit] first parsed student:", parsedStudents[0]);
            console.dir(parsedStudents[0], { depth: null });
          }
        } else if (typeof classList === "string") {
          try {
            const parsedJson = JSON.parse(classList);
            parsedStudents = Array.isArray(parsedJson) ? parsedJson : [];
          } catch (error) {
            console.warn("[schedule-upload-edit] classList JSON parse failed", error.message);
          }
        } else if (Array.isArray(classList)) {
          parsedStudents = classList;
        }

        const validEntries = await resolveClassListEntries(parsedStudents, schedule.id, canonicalCampus);

        console.log("[attendance-roster-debug] schedule class-list edit", {
          scheduleId: schedule.id,
          campus: canonicalCampus,
          parsedRows: parsedStudents.length,
          resolvedRows: validEntries.length,
          sampleNames: validEntries.slice(0, 3).map((entry) => normalizeStudentName(entry.fullName))
        });

        const students = validEntries;
        console.dir(students, { depth: null });
        students.forEach((s, i) => {
          console.log("Student", i);
          console.log("studentId =", s.studentId);
          console.log("typeof =", typeof s.studentId);
          console.log("length =", String(s.studentId).length);
        });
        if (students[0]) {
          console.dir(students[0], { depth: null });
        }

        console.log("[schedule-upload-edit] students prepared for insertion:", students.length);
        if (students[0]) {
          console.log("[schedule-upload-edit] first prepared student:", students[0]);
        }
        console.log("[schedule-upload-edit] bulkCreate payload size:", students.length);
        if (students.length) {
        console.log("[schedule-upload-edit] bulkCreate payload (sample up to 20):", students.slice(0,20));
        try {
          const [schemaResult] = await sequelize.query("SHOW CREATE TABLE class_list_entries");
          console.log("[schedule-upload-edit] class_list_entries schema:", JSON.stringify(schemaResult, null, 2));
        } catch (schemaError) {
          console.error("[schedule-upload-edit] failed to query table schema:", schemaError);
        }
        const bulkCreateResult = await ClassListEntry.bulkCreate(students, { transaction });
          console.log("[schedule-upload-edit] bulkCreate result:", bulkCreateResult);
          console.log("[schedule-upload-edit] total inserted records:", bulkCreateResult?.length || 0);
        } else {
          console.log("[schedule-upload-edit] no valid students to insert; execution stopped before bulkCreate.");
        }
      }

      await transaction.commit();
      console.log("[schedule-upload-edit] transaction committed successfully");

      await logAuditEntry(req, {
        action: "Laboratory Schedule Updated",
        module: "Laboratory Scheduling",
        resourceId: schedule.id,
        description: `Updated laboratory schedule ${schedule.subject} (${schedule.id}).`,
        details: {
          scheduleId: schedule.id,
          subject: schedule.subject,
          instructor: schedule.instructor,
          instructorUserId: schedule.instructorUserId,
          yearLevel: schedule.yearLevel,
          section: schedule.section,
          laboratoryRoom: schedule.laboratoryRoom,
          campus: schedule.campus,
          dayOfWeek: schedule.dayOfWeek,
          startTime: schedule.startTime,
          endTime: schedule.endTime,
          scheduleColor: schedule.scheduleColor,
          status: schedule.status,
          qrEnabled: schedule.qrEnabled
        }
      });

      res.json({ success: true, schedule: schedule.toJSON(), message: "Schedule updated successfully." });
    } catch (error) {
      await transaction.rollback();
      console.error("[schedule-upload-edit] transaction rolled back due to error", error);
      console.error("Failed to update laboratory schedule", error);
      res.status(500).json({ error: "Failed to update laboratory schedule" });
    }
  } catch (error) {
    console.error("[schedule-upload-edit] outer request handler failed", error);
    res.status(500).json({ error: error?.message || "Failed to update laboratory schedule" });
  }
});

// Attendance Monitoring APIs
const getAttendanceAccessContext = async (req) => {
  const context = await getUserAuthContext(req);
  const role = normalizeRoleName(context.role || req.session?.userRole);
  if (!context.userId) return { errorStatus: 401, errorMessage: 'Please log in to view attendance.' };
  if (!isAdminRole(role) && role !== 'instructor' && role !== 'technician') {
    return { errorStatus: 403, errorMessage: 'Not authorized.' };
  }
  if (!context.campus || !String(context.campus).trim()) {
    return { errorStatus: 403, errorMessage: 'Unauthorized: User campus not found.' };
  }
  return { context, role };
};

const getAttendanceCampusWhere = (campus) => {
  const canonicalCampus = String(campus || '').trim().replace(/\s*Campus\s*$/i, '').trim();
  return {
    [Op.or]: [
      { campus: canonicalCampus },
      { campus: `${canonicalCampus} Campus` }
    ]
  };
};

const isAttendanceSessionCompleted = (session) => Boolean(
  session?.expiresAt && new Date(session.expiresAt).getTime() <= Date.now()
);

router.get('/api/attendance-sessions', async (req, res) => {
  try {
    const access = await getAttendanceAccessContext(req);
    if (access.errorStatus) return res.status(access.errorStatus).json({ error: access.errorMessage });
    const { context, role } = access;

    const where = {};
    if (isAdminRole(role)) {
      where[Op.and] = [
        { [Op.or]: [ { createdBy: context.userId }, { createdBy: null } ] },
        getAttendanceCampusWhere(context.campus)
      ];
    } else {
      where[Op.and] = [
        { createdBy: context.userId },
        getAttendanceCampusWhere(context.campus)
      ];
    }

    const schedules = await LaboratorySchedule.findAll({ where, order: [['createdAt', 'DESC']] });

    const results = [];
    for (const s of schedules) {
      const id = s.id;
      const rosterEntries = await ClassListEntry.findAll({ where: { laboratoryScheduleId: id } });
      await reconcileClassListIdentities(rosterEntries, s.campus);
      const total = rosterEntries.length;
      const session = await AttendanceSession.findOne({ where: { laboratoryScheduleId: id }, order: [['createdAt', 'DESC']] });
      // Always query by laboratoryScheduleId OR any session token for this schedule
      // to avoid the token-mismatch bug where scans are stored against an older token
      const allSessionTokens = (await AttendanceSession.findAll({
        where: { laboratoryScheduleId: id },
        attributes: ['token']
      })).map(s => s.token).filter(Boolean);
      const attendanceRecords = await Attendance.findAll({
        where: allSessionTokens.length
          ? { [Op.or]: [{ laboratoryScheduleId: id }, { sessionToken: { [Op.in]: allSessionTokens } }] }
          : { laboratoryScheduleId: id },
        order: [['createdAt', 'ASC']]
      });
      const latestStatusByStudent = new Map();
      attendanceRecords.forEach((record) => {
        const studentId = String(record.studentId || '').trim();
        if (!studentId) return;
        latestStatusByStudent.set(studentId, record.status);
      });
      const present = [...latestStatusByStudent.values()].filter((status) => status === 'Present').length;
      const late = [...latestStatusByStudent.values()].filter((status) => status === 'Late').length;
      const absent = isAttendanceSessionCompleted(session)
        ? Math.max(0, total - present - late)
        : 0;

      console.log("[attendance-roster-debug] monitoring session", {
        sessionId: session?.id || null,
        scheduleId: id,
        campus: s.campus,
        subject: s.subject,
        laboratory: s.laboratoryRoom,
        classListEntryCount: rosterEntries.length,
        rosterCount: total,
        sampleNames: rosterEntries.slice(0, 3).map((entry) => normalizeStudentName(entry.fullName)),
        attendanceRecordCount: attendanceRecords.length,
        present,
        late
      });

      results.push({
        id,
        subject: s.subject,
        instructor: s.instructor,
        dayOfWeek: s.dayOfWeek,
        time: [s.startTime, s.endTime].filter(Boolean).join(' - '),
        laboratoryRoom: String(s.laboratoryRoom || "")
          .replace("Laboratory 1 ??? Room 202", "Laboratory 1 — Room 202")
          .replace("Laboratory 2 ??? Room 204", "Laboratory 2 — Room 204"),
        campus: s.campus,
        createdAt: s.createdAt,
        totalStudents: total,
        present,
        absent,
        late,
        status: isAttendanceSessionCompleted(session) ? 'Completed' : 'Active'
      });
    }

    res.json(results);
  } catch (error) {
    console.error('Failed to load attendance sessions', error);
    res.status(500).json({ error: 'Failed to load attendance sessions' });
  }
});

router.get('/api/attendance-sessions/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const access = await getAttendanceAccessContext(req);
    if (access.errorStatus) return res.status(access.errorStatus).json({ error: access.errorMessage });
    const { context } = access;
    const schedule = await LaboratorySchedule.findOne({
      where: { id, ...getAttendanceCampusWhere(context.campus) }
    });
    if (!schedule) return res.status(404).json({ error: 'Schedule not found' });
    if (!isAdminRole(context.role) && String(schedule.createdBy || '') !== String(context.userId)) {
      return res.status(403).json({ error: 'Not authorized to view this attendance session.' });
    }
    // Ensure session exists
    const session = req.query.sessionId
      ? await AttendanceSession.findOne({ where: { id: req.query.sessionId, laboratoryScheduleId: id } })
      : await AttendanceSession.findOne({ where: { laboratoryScheduleId: id }, order: [['createdAt', 'DESC']] });
    if (req.query.sessionId && !session) return res.status(404).json({ error: 'Attendance session not found' });

    // Auto-mark absent if session exists and has expired
    if (session && session.expiresAt && new Date() > new Date(session.expiresAt)) {
      const classList = await ClassListEntry.findAll({ where: { laboratoryScheduleId: id } });
      const toCreate = [];
      for (const c of classList) {
        if (!c.studentId || c.matchStatus === "review") continue;
        const existing = await Attendance.findOne({ where: { sessionToken: session.token, studentId: c.studentId } });
        if (!existing) {
          toCreate.push({
            laboratoryScheduleId: id,
            studentId: c.studentId,
            fullName: c.fullName,
            status: 'Absent',
            timeIn: null,
            remarks: 'Automatically marked absent',
            sessionToken: session.token
          });
        }
      }
      if (toCreate.length) {
        try {
          await Attendance.bulkCreate(toCreate, { ignoreDuplicates: true });
        } catch (err) {
          console.error('[attendance-monitor] failed to bulk-create absent records', err);
        }
      }
    }

    const students = await ClassListEntry.findAll({ where: { laboratoryScheduleId: id }, order: [['fullName', 'ASC']] });
    await reconcileClassListIdentities(students, schedule.campus);
    const attendanceWhere = session?.token
      ? { [Op.or]: [
        { sessionToken: session.token },
        { laboratoryScheduleId: id, sessionToken: null }
      ] }
      : { laboratoryScheduleId: id };
    const attendance = await Attendance.findAll({
      where: attendanceWhere,
      order: [['createdAt', 'ASC']]
    });

    // Map attendance by studentId
    const attendanceMap = new Map(attendance.map(a => [String(a.studentId), a]));

    // Build rows from class list + fill in actual scans
    const classListRows = students.map((c) => {
      const a = c.studentId ? attendanceMap.get(String(c.studentId)) : null;
      const sessionCompleted = isAttendanceSessionCompleted(session);
      return {
        studentId: c.studentId || 'Not provided',
        fullName: c.fullName,
        status: c.matchStatus === 'review' ? 'Requires Review' : c.matchStatus === 'incomplete_id' ? 'ID Required' : a?.status || (sessionCompleted ? 'Absent' : 'Not Yet Recorded'),
        timeIn: a?.timeIn || null,
        pcStationSetId: a?.pcStationSetId || null,
        remarks: c.matchStatus === 'review' ? 'Multiple registered students match this name.' : c.matchStatus === 'incomplete_id' ? 'Registered student matched, but the official Student ID is not provided.' : c.studentId ? (a?.remarks || (a ? '' : 'Automatically marked absent')) : 'No registered student matched this name.'
      };
    });

    // If class list is empty, fall back to showing actual scan records directly
    // This handles schedules where students scanned QR but are not in the class list
    const classListStudentIds = new Set(students.map(s => String(s.studentId || '')).filter(Boolean));
    const extraScanRows = attendance
      .filter(a => !classListStudentIds.has(String(a.studentId || '')))
      .map(a => ({
        studentId: a.studentId || 'Unknown',
        fullName: a.fullName || 'Unknown',
        status: a.status || 'Present',
        timeIn: a.timeIn || null,
        pcStationSetId: a.pcStationSetId || null,
        remarks: 'Scanned attendance (not in class list)'
      }));

    const rows = [...classListRows, ...extraScanRows];

    const format = (req.query.format || 'json').toLowerCase();
    if (format === 'excel') {
      const wsData = [
        ['Subject', schedule.subject],
        ['Instructor', schedule.instructor || ''],
        ['Laboratory', schedule.laboratoryRoom || ''],
        ['Campus', schedule.campus || ''],
        [],
        ['Student ID', 'Full Name', 'Status', 'Time In', 'PC Set']
      ];
      for (const r of rows) wsData.push([r.studentId || 'Not provided', r.fullName, r.status, r.timeIn || '', r.pcStationSetId || '']);
      const ws = XLSX.utils.aoa_to_sheet(wsData);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Attendance');
      const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
      res.setHeader('Content-Disposition', `attachment; filename="Attendance_Report.xlsx"`);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Length', buf.length);
      return res.send(buf);
    }

    const present = rows.filter(r => r.status === 'Present').length;
    const late = rows.filter(r => r.status === 'Late').length;
    const absent = rows.filter(r => r.status === 'Absent').length;
    const trackedRows = rows.filter(r => ['Present', 'Late', 'Absent'].includes(r.status));

    console.log("[attendance-roster-debug] monitoring details", {
      sessionId: session?.id || null,
      scheduleId: id,
      campus: schedule.campus,
      subject: schedule.subject,
      laboratory: schedule.laboratoryRoom,
      classListEntryCount: students.length,
      rosterCount: rows.length,
      sampleNames: students.slice(0, 3).map((entry) => normalizeStudentName(entry.fullName)),
      attendanceRecordCount: attendance.length,
      present,
      late
    });

    res.json({
      schedule: schedule.toJSON(),
      summary: { total: rows.length, present, absent, late, attendancePercentage: trackedRows.length ? Math.round((present / trackedRows.length) * 100) : 0 },
      rows
    });
  } catch (error) {
    console.error('Failed to load attendance session details', error);
    res.status(500).json({ error: 'Failed to load attendance session details' });
  }
});

router.get('/api/attendance-sessions/:id/export', async (req, res) => {
  try {
    const id = req.params.id;
    const format = (req.query.format || 'excel').toLowerCase();
    const access = await getAttendanceAccessContext(req);
    if (access.errorStatus) return res.status(access.errorStatus).send(access.errorMessage);
    const { context } = access;
    const schedule = await LaboratorySchedule.findOne({
      where: { id, ...getAttendanceCampusWhere(context.campus) }
    });
    if (!schedule) return res.status(404).send('Schedule not found');
    if (!isAdminRole(context.role) && String(schedule.createdBy || '') !== String(context.userId)) {
      return res.status(403).send('Not authorized to export attendance for this schedule.');
    }
    const session = req.query.sessionId
      ? await AttendanceSession.findOne({ where: { id: req.query.sessionId, laboratoryScheduleId: id } })
      : await AttendanceSession.findOne({ where: { laboratoryScheduleId: id }, order: [['createdAt', 'DESC']] });
    if (req.query.sessionId && !session) return res.status(404).send('Attendance session not found');
    const students = await ClassListEntry.findAll({ where: { laboratoryScheduleId: id }, order: [['fullName', 'ASC']] });
    await reconcileClassListIdentities(students, schedule.campus);
    const attendanceWhere = session?.token
      ? { [Op.or]: [
        { sessionToken: session.token },
        { laboratoryScheduleId: id, sessionToken: null }
      ] }
      : { laboratoryScheduleId: id };
    const attendance = await Attendance.findAll({
      where: attendanceWhere,
      order: [['createdAt', 'ASC']]
    });
    const attendanceMap = new Map(attendance.map(a => [String(a.studentId), a]));

    const rows = students.map((c) => {
      const a = c.studentId ? attendanceMap.get(String(c.studentId)) : null;
      const sessionCompleted = isAttendanceSessionCompleted(session);
      return {
        studentId: c.studentId || 'Not provided',
        fullName: c.fullName,
        status: c.matchStatus === 'review' ? 'Requires Review' : c.matchStatus === 'incomplete_id' ? 'ID Required' : a?.status || (sessionCompleted ? 'Absent' : 'Not Yet Recorded'),
        timeIn: a?.timeIn || '',
        pcStationSetId: a?.pcStationSetId || '',
        remarks: c.matchStatus === 'review' ? 'Multiple registered students match this name.' : c.matchStatus === 'incomplete_id' ? 'Registered student matched, but the official Student ID is not provided.' : c.studentId ? (a?.remarks || (a ? '' : 'Automatically marked absent')) : 'No registered student matched this name.'
      };
    });

    if (format === 'excel') {
      const wsData = [
        ['Subject', schedule.subject],
        ['Instructor', schedule.instructor || ''],
        ['Laboratory', schedule.laboratoryRoom || ''],
        ['Campus', schedule.campus || ''],
        [],
        ['Student ID', 'Full Name', 'Status', 'Time In', 'PC Set']
      ];
      for (const r of rows) wsData.push([r.studentId || 'Not provided', r.fullName, r.status, r.timeIn || '', r.pcStationSetId || '']);
      const ws = XLSX.utils.aoa_to_sheet(wsData);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Attendance');
      const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
      res.setHeader('Content-Disposition', `attachment; filename=attendance-${id}.xlsx`);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      return res.send(buf);
    }

    let html = `<!doctype html><html><head><meta charset='utf8'><title>Attendance ${schedule.subject}</title></head><body>`;
    html += `<h1>${schedule.subject}</h1><p>Instructor: ${schedule.instructor || ''}</p><table border='1' cellpadding='6' cellspacing='0'><thead><tr><th>Student ID</th><th>Full Name</th><th>Status</th><th>Time In</th><th>PC Set</th></tr></thead><tbody>`;
    for (const r of rows) html += `<tr><td>${r.studentId || 'Not provided'}</td><td>${r.fullName}</td><td>${r.status}</td><td>${r.timeIn || ''}</td><td>${r.pcStationSetId || ''}</td></tr>`;
    html += `</tbody></table></body></html>`;
    res.setHeader('Content-Disposition', `inline; filename=attendance-${id}.html`);
    res.setHeader('Content-Type', 'text/html');
    res.send(html);
  } catch (error) {
    console.error('Failed to export attendance', error);
    res.status(500).send('Failed to export attendance');
  }
});
router.delete("/api/laboratory-schedules/:id", requireScheduleUpdateAccess, async (req, res) => {
  return res.status(410).json({ error: "Permanent deletion is disabled. Use Archive instead." });
});

const FACULTY_COLLEGES = new Set(["IABE", "CBM", "CCS", "CAS", "CTE", "CCJE", "CAAF", "IF", "GS"]);
const getAdminFacultyContext = async (req, res) => {
  if (!req.session?.userId) {
    res.status(401).json({ error: "Please log in to manage Faculty accounts." });
    return null;
  }
  const admin = await User.findByPk(req.session.userId, { attributes: ["id", "role", "campus"] });
  if (!admin || !isAdminRole(admin.role)) {
    res.status(403).json({ error: "Only administrators can manage Faculty accounts." });
    return null;
  }
  const campus = normalizeCampus(admin.campus) || normalizeCampus(String(admin.campus || "").replace(/\s*Campus\s*$/i, ""));
  if (!campus) {
    res.status(403).json({ error: "Your administrator account must have an assigned campus." });
    return null;
  }
  return { admin, campus };
};

router.get("/api/faculty", async (req, res) => {
  try {
    const context = await getAdminFacultyContext(req, res);
    if (!context) return;
    const archivedFacultyIds = await getArchivedEntityIds("faculty-account");
    const faculty = await User.findAll({
      where: {
        campus: { [Op.in]: [context.campus, `${context.campus} Campus`] },
        role: { [Op.in]: ["faculty", "Faculty", "instructor", "Instructor"] },
        ...(archivedFacultyIds.length ? { id: { [Op.notIn]: archivedFacultyIds } } : {})
      },
      attributes: ["id", "name", "email", "college", "campus", "email_verified", "createdAt"],
      order: [["name", "ASC"]]
    });
    return res.json({ success: true, faculty });
  } catch (error) {
    console.error("Failed to list campus faculty.", error);
    return res.status(500).json({ error: "Failed to load Faculty accounts." });
  }
});

const CENTRAL_ADMIN_ROLES = new Set(["superadmin", "centraladmin", "systemadmin"]);
const isCentralAccountAdmin = (role) => CENTRAL_ADMIN_ROLES.has(
  normalizeRoleName(role).replace(/[\s_-]+/g, "")
);
const STAFF_ACCOUNT_CAMPUSES = new Set(["Bongabong", "Victoria", "Calapan"]);

router.post("/api/staff-accounts", async (req, res) => {
  try {
    if (!req.session?.userId) {
      return res.status(401).json({ error: "Please log in to create staff accounts." });
    }

    const admin = await User.findByPk(req.session.userId, {
      attributes: ["id", "name", "email", "role", "campus"]
    });
    if (!admin || !isAdminRole(admin.role)) {
      return res.status(403).json({ error: "Only administrators can create staff accounts." });
    }

    const isCentralAdmin = isCentralAccountAdmin(admin.role);
    const role = normalizeRoleName(req.body?.role);
    if (!["technician", "admin"].includes(role)) {
      return res.status(400).json({ error: "Select Technician or Administrator." });
    }
    if (role === "admin" && !isCentralAdmin) {
      return res.status(403).json({ error: "Only a central administrator can create Administrator accounts." });
    }

    const name = String(req.body?.name || "").trim().replace(/\s+/g, " ");
    const email = String(req.body?.email || "").trim().toLowerCase();
    const password = String(req.body?.password || "");
    if (!name || name.length > 120) {
      return res.status(400).json({ error: "Enter the account holder’s full name (up to 120 characters)." });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 190) {
      return res.status(400).json({ error: "Enter a valid email address." });
    }
    if (password.length < 8 || password.length > 128) {
      return res.status(400).json({ error: "Set a temporary password with 8 to 128 characters." });
    }

    let campus;
    if (isCentralAdmin) {
      campus = normalizeCampus(req.body?.campus);
      if (!campus || !STAFF_ACCOUNT_CAMPUSES.has(campus)) {
        return res.status(400).json({ error: "Select a valid campus for this account." });
      }
    } else {
      campus = normalizeCampus(admin.campus) ||
        normalizeCampus(String(admin.campus || "").replace(/\s*Campus\s*$/i, ""));
      if (!campus || !STAFF_ACCOUNT_CAMPUSES.has(campus)) {
        return res.status(403).json({ error: "Your administrator account must have a valid assigned campus." });
      }
    }

    const duplicate = await User.findOne({ where: { email }, attributes: ["id"] });
    if (duplicate) {
      return res.status(409).json({ error: "An account already uses this email address." });
    }

    const account = await User.create({
      name,
      email,
      password: await bcryptjs.hash(password, 10),
      role,
      campus,
      email_verified: true,
      last_login_at: null
    });
    await logAuditEntry(req, {
      action: "Staff Account Created",
      module: "User Management",
      resourceId: account.id,
      description: `Created a ${role === "admin" ? "Administrator" : "Technician"} account for ${account.name} at ${campus}.`
    });

    return res.status(201).json({
      success: true,
      message: `${role === "admin" ? "Administrator" : "Technician"} account created successfully.`,
      account: { id: account.id, name: account.name, email: account.email, role: account.role, campus: account.campus }
    });
  } catch (error) {
    console.error("Failed to create staff account.", error);
    return res.status(500).json({ error: "Failed to create the staff account." });
  }
});

router.post("/api/faculty", async (req, res) => {
  try {
    const context = await getAdminFacultyContext(req, res);
    if (!context) return;
    const name = String(req.body?.name || "").trim().replace(/\s+/g, " ");
    const email = String(req.body?.email || "").trim().toLowerCase();
    const college = String(req.body?.college || "").trim().toUpperCase();
    const password = String(req.body?.password || "");
    if (!name || name.length > 120) return res.status(400).json({ error: "Enter the Faculty member’s full name (up to 120 characters)." });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 190) return res.status(400).json({ error: "Enter a valid email address." });
    if (!FACULTY_COLLEGES.has(college)) return res.status(400).json({ error: "Select a valid college or institute." });
    if (password.length < 8 || password.length > 128) return res.status(400).json({ error: "Set a temporary password with 8 to 128 characters." });
    const duplicate = await User.findOne({ where: { email } });
    if (duplicate) return res.status(409).json({ error: "An account already uses this email address." });

    const faculty = await User.create({
      name,
      email,
      password: await bcryptjs.hash(password, 10),
      role: "faculty",
      college,
      campus: context.campus,
      email_verified: true,
      last_login_at: null
    });
    await logAuditEntry(req, {
      action: "Faculty Account Created",
      module: "User Management",
      resourceId: faculty.id,
      description: `Created a Faculty account for ${faculty.name} at ${context.campus}.`
    });
    return res.status(201).json({
      success: true,
      message: "Faculty account created. Share the temporary password securely.",
      faculty: { id: faculty.id, name: faculty.name, email: faculty.email, college: faculty.college, campus: faculty.campus, email_verified: faculty.email_verified, createdAt: faculty.createdAt }
    });
  } catch (error) {
    console.error("Failed to create campus Faculty account.", error);
    return res.status(500).json({ error: "Failed to create the Faculty account." });
  }
});

router.put("/api/faculty/:id", async (req, res) => {
  try {
    const context = await getAdminFacultyContext(req, res);
    if (!context) return;

    const facultyId = Number(req.params.id);
    if (!Number.isSafeInteger(facultyId) || facultyId < 1) {
      return res.status(400).json({ error: "Select a valid Faculty account." });
    }

    const name = String(req.body?.name || "").trim().replace(/\s+/g, " ");
    const email = String(req.body?.email || "").trim().toLowerCase();
    const college = String(req.body?.college || "").trim().toUpperCase();
    if (!name || name.length > 120) {
      return res.status(400).json({ error: "Enter the Faculty member’s full name (up to 120 characters)." });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 190) {
      return res.status(400).json({ error: "Enter a valid email address." });
    }
    if (!FACULTY_COLLEGES.has(college)) {
      return res.status(400).json({ error: "Select a valid college or institute." });
    }

    const faculty = await User.findOne({
      where: {
        id: facultyId,
        campus: { [Op.in]: [context.campus, `${context.campus} Campus`] },
        role: { [Op.in]: ["faculty", "Faculty", "instructor", "Instructor"] }
      }
    });
    if (!faculty) return res.status(404).json({ error: "Faculty account not found at your campus." });
    const archivedFacultyIds = await getArchivedEntityIds("faculty-account");
    if (archivedFacultyIds.includes(String(facultyId))) {
      return res.status(409).json({ error: "This Faculty account is archived. Restore it before editing." });
    }

    const duplicate = await User.findOne({
      where: { email, id: { [Op.ne]: facultyId } },
      attributes: ["id"]
    });
    if (duplicate) return res.status(409).json({ error: "Another account already uses this email address." });

    const previousName = faculty.name;
    const previousEmail = faculty.email;
    const previousCollege = faculty.college;
    await faculty.update({ name, email, college });
    await logAuditEntry(req, {
      action: "Faculty Account Updated",
      module: "User Management",
      resourceId: faculty.id,
      description: `Updated the Faculty account for ${previousName} at ${context.campus}.`
    });

    return res.json({
      success: true,
      faculty: {
        id: faculty.id,
        name: faculty.name,
        email: faculty.email,
        college: faculty.college,
        campus: faculty.campus,
        email_verified: faculty.email_verified,
        createdAt: faculty.createdAt
      },
      changes: {
        name: previousName !== faculty.name,
        email: previousEmail !== faculty.email,
        college: previousCollege !== faculty.college
      }
    });
  } catch (error) {
    console.error("Failed to update campus Faculty account.", error);
    return res.status(500).json({ error: "Failed to update the Faculty account." });
  }
});

// GET - List users (optional role filter)
router.get("/api/users", async (req, res) => {
  try {
    if (!req.session?.userId) {
      return res.status(401).json({ error: "Please log in to view users." });
    }

    const authContext = await getUserAuthContext(req);
    if (!isAdminRole(authContext.role)) {
      return res.status(403).json({ error: "Only administrators can view user accounts." });
    }

    const { role } = req.query;
    const where = {};
    if (role) {
      const normalizedRole = String(role).trim().toLowerCase();
      if (normalizedRole === "admin") {
        where[Op.or] = [{ role: "admin" }, { role: "Administrator" }, { role: "administrator" }];
      } else {
        where.role = normalizedRole;
      }
    }

    const users = await User.findAll({
      where,
      attributes: ["id", "name", "email", "role", "student_number", "campus", "createdAt", "updatedAt", "last_login_at"],
      order: [["name", "ASC"]]
    });
    console.log('[API Users] Returning', users.length, 'users');
    res.json(users);
  } catch (err) {
    console.error('[API Users] Error:', err.message);
    res.status(500).json({ error: "Failed to load users." });
  }
});

const formatDateValue = (date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const getDateRangeFromReportPeriod = (reportPeriod = "all") => {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  if (reportPeriod === "today") {
    return { dateFrom: formatDateValue(today), dateTo: formatDateValue(today) };
  }

  if (reportPeriod === "week") {
    const firstDay = new Date(today);
    const day = today.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    firstDay.setDate(today.getDate() + diff);
    const lastDay = new Date(firstDay);
    lastDay.setDate(firstDay.getDate() + 6);
    return { dateFrom: formatDateValue(firstDay), dateTo: formatDateValue(lastDay) };
  }

  if (reportPeriod === "month") {
    const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
    const lastDay = new Date(today.getFullYear(), today.getMonth() + 1, 0);
    return { dateFrom: formatDateValue(firstDay), dateTo: formatDateValue(lastDay) };
  }

  if (reportPeriod === "semester") {
    const semesterStart = today.getMonth() >= 7
      ? new Date(today.getFullYear(), 7, 1)
      : new Date(today.getFullYear() - 1, 7, 1);
    const semesterEnd = today.getMonth() >= 7
      ? new Date(today.getFullYear(), 11, 31)
      : new Date(today.getFullYear(), 4, 31);
    return { dateFrom: formatDateValue(semesterStart), dateTo: formatDateValue(semesterEnd) };
  }

  if (reportPeriod === "school-year") {
    const schoolYearStart = today.getMonth() >= 7
      ? new Date(today.getFullYear(), 7, 1)
      : new Date(today.getFullYear() - 1, 7, 1);
    const schoolYearEnd = today.getMonth() >= 7
      ? new Date(today.getFullYear() + 1, 6, 31)
      : new Date(today.getFullYear(), 6, 31);
    return { dateFrom: formatDateValue(schoolYearStart), dateTo: formatDateValue(schoolYearEnd) };
  }

  return {};
};

const normalizeReportFilterValue = (value) => {
  if (value === null || value === undefined) return "";
  if (typeof value !== "string") return String(value).trim();
  return value.trim();
};

const normalizeReportedCampusValue = (value) => {
  const normalized = normalizeReportFilterValue(value).toLowerCase();
  if (!normalized || normalized === "all" || normalized === "all campuses" || normalized === "all campus") {
    return "";
  }
  return normalized.replace(/\s*campus\s*$/i, "");
};

const getReportCampusVariants = (campus) => {
  const campusKey = normalizeReportedCampusValue(campus);
  if (!campusKey) return [];
  return [...new Set([campusKey, `${campusKey} campus`])];
};

const isGlobalReportAdmin = (role) => {
  const normalizedRole = normalizeReportFilterValue(role).toLowerCase().replace(/[_-]+/g, "");
  return ["superadmin", "centraladmin", "systemadmin"].includes(normalizedRole);
};

const getReportAccessState = async (req, requestedCampus = "") => {
  const authContext = await getUserAuthContext(req);
  if (!authContext.userId) {
    return { errorStatus: 401, errorMessage: "Please log in to view reports." };
  }
  const authenticatedUser = await User.findByPk(authContext.userId, { attributes: ["role", "campus"] });
  if (!authenticatedUser) {
    return { errorStatus: 403, errorMessage: "Not authorized to view reports." };
  }
  const userCampus = String(authenticatedUser.campus || "").trim();
  const globalAdmin = isGlobalReportAdmin(authenticatedUser.role || authContext.role);
  const userCampusKey = normalizeReportedCampusValue(userCampus);
  const explicitSelectedCampus = normalizeReportedCampusValue(requestedCampus);
  const explicitlyRequestedAllCampuses = Object.prototype.hasOwnProperty.call(req.query || {}, "campus")
    && !explicitSelectedCampus;

  if (!globalAdmin && !userCampusKey) {
    return { errorStatus: 403, errorMessage: "Unauthorized: User campus not found." };
  }

  if (!globalAdmin && explicitSelectedCampus && explicitSelectedCampus !== userCampusKey) {
    return {
      authorizedCampus: userCampus,
      effectiveCampus: requestedCampus,
      isGlobalAdmin: false,
      isRestricted: true,
      restrictedCampus: requestedCampus
    };
  }

  return {
    authorizedCampus: userCampus,
    effectiveCampus: globalAdmin || explicitlyRequestedAllCampuses
      ? (explicitSelectedCampus ? requestedCampus : "")
      : userCampus,
    isGlobalAdmin: globalAdmin,
    isRestricted: false,
    restrictedCampus: ""
  };
};

const createRestrictedReportPayload = ({ campus, campusTotal, visibleCampus }) => ({
  records: [],
  meta: {
    restricted: true,
    restrictedCampus: campus,
    campusTotal,
    visibleCampus
  }
});

const getEquipmentInventoryReportRows = async ({ campus = "", laboratory = "", status = "", dateFrom = "", dateTo = "", search = "" } = {}) => {
  const normalizedCampus = normalizeReportFilterValue(campus);
  const campusKey = normalizeReportedCampusValue(normalizedCampus);
  const normalizedLaboratory = normalizeReportFilterValue(laboratory);
  const normalizedStatus = normalizeReportFilterValue(status);
  const normalizedDateFrom = normalizeReportFilterValue(dateFrom);
  const normalizedDateTo = normalizeReportFilterValue(dateTo);
  const normalizedSearch = normalizeReportFilterValue(search);

  const whereClauses = [];
  const replacements = {};

  if (normalizedCampus && normalizedCampus !== "All Campuses" && campusKey) {
    const campusVariants = [...new Set([
      normalizedCampus,
      normalizedCampus.replace(/\s*campus\s*$/i, "").trim(),
      `${normalizedCampus.replace(/\s*campus\s*$/i, "").trim()} Campus`
    ].filter(Boolean))];

    const campusValueSet = campusVariants.map((value) => String(value).trim()).filter(Boolean);
    const campusPlaceholders = campusValueSet.map((_, index) => `:campus_${index}`).join(", ");

    whereClauses.push(`(LOWER(campus) IN (${campusPlaceholders}) OR LOWER(campus) = :campus_key)`);

    campusValueSet.forEach((value, index) => {
      replacements[`campus_${index}`] = String(value).toLowerCase();
    });
    replacements.campus_key = campusKey;
  }

  if (normalizedLaboratory && normalizedLaboratory !== "All Laboratories") {
    whereClauses.push("laboratoryRoom = :laboratory");
    replacements.laboratory = normalizedLaboratory;
  }

  if (normalizedStatus && normalizedStatus !== "All Statuses") {
    whereClauses.push("status = :status");
    replacements.status = normalizedStatus;
  }

  if (normalizedDateFrom) {
    whereClauses.push("dateAdded >= :dateFrom");
    replacements.dateFrom = normalizedDateFrom;
  }

  if (normalizedDateTo) {
    whereClauses.push("dateAdded <= :dateTo");
    replacements.dateTo = normalizedDateTo;
  }

  if (normalizedSearch) {
    whereClauses.push("(equipmentId LIKE :search OR name LIKE :search OR laboratoryRoom LIKE :search OR campus LIKE :search OR category LIKE :search)");
    replacements.search = `%${normalizedSearch}%`;
  }

  // Keep chair assets out of the inventory report and all of its exports.
  whereClauses.push("LOWER(COALESCE(name, '')) NOT LIKE '%chair%' AND LOWER(COALESCE(category, '')) NOT LIKE '%chair%'");

  const whereSql = whereClauses.length ? `WHERE ${whereClauses.join(" AND ")}` : "";
  const query = `
    SELECT id, equipmentId, assetNumber, name, category, campus, laboratoryRoom, status, quantity, dateAdded, qrCode, qrImage, qrGeneratedAt
    FROM equipment
    ${whereSql}
    ORDER BY dateAdded DESC, id DESC
  `;

  try {
    const rows = await sequelize.query(query, {
      replacements,
      type: QueryTypes.SELECT
    });
    return rows.map((row) => ({
      ...row,
      id: row.id,
      equipmentId: row.equipmentId,
      assetNumber: row.assetNumber,
      name: row.name,
      category: row.category,
      campus: row.campus,
      laboratoryRoom: row.laboratoryRoom,
      status: row.status,
      quantity: row.quantity,
      dateAdded: row.dateAdded
    }));
  } catch (error) {
    console.error("[reports] equipment inventory query failed, falling back to ORM", error);
    const where = {};
    if (normalizedCampus && normalizedCampus !== "All Campuses" && campusKey) {
      const campusVariants = [...new Set([
        normalizedCampus,
        normalizedCampus.replace(/\s*campus\s*$/i, "").trim(),
        `${normalizedCampus.replace(/\s*campus\s*$/i, "").trim()} Campus`
      ].filter(Boolean))];
      where[Op.and] = [{ [Op.or]: campusVariants.map((value) => ({ campus: value })) }];
    }
    if (normalizedLaboratory && normalizedLaboratory !== "All Laboratories") where.laboratoryRoom = normalizedLaboratory;
    if (normalizedStatus && normalizedStatus !== "All Statuses") where.status = normalizedStatus;
    if (normalizedDateFrom || normalizedDateTo) {
      where.dateAdded = {};
      if (normalizedDateFrom) where.dateAdded[Op.gte] = normalizedDateFrom;
      if (normalizedDateTo) where.dateAdded[Op.lte] = normalizedDateTo;
    }
    if (normalizedSearch) {
      where[Op.and] = [...(where[Op.and] || []), { [Op.or]: [
        { equipmentId: { [Op.like]: `%${normalizedSearch}%` } },
        { name: { [Op.like]: `%${normalizedSearch}%` } },
        { laboratoryRoom: { [Op.like]: `%${normalizedSearch}%` } },
        { campus: { [Op.like]: `%${normalizedSearch}%` } },
        { category: { [Op.like]: `%${normalizedSearch}%` } }
      ] }];
    }
    where[Op.and] = [...(where[Op.and] || []), {
      [Op.and]: [
        { [Op.or]: [{ name: { [Op.is]: null } }, { name: { [Op.notLike]: "%chair%" } }] },
        { [Op.or]: [{ category: { [Op.is]: null } }, { category: { [Op.notLike]: "%chair%" } }] }
      ]
    }];
    const records = await Equipment.findAll({ where, order: [["dateAdded", "DESC"]] });
    return records.map((record) => record.toJSON());
  }
};

router.get("/api/reports", async (req, res) => {
  try {
    const userCampus = req.session?.userCampus;
    const hasCampusQueryParam = Object.prototype.hasOwnProperty.call(req.query, "campus");
    let requestedCampus = hasCampusQueryParam ? String(req.query.campus ?? "").trim() : "";

    if (requestedCampus && normalizeReportedCampusValue(requestedCampus) === "") {
      requestedCampus = "";
    }

    if (!hasCampusQueryParam && !requestedCampus && userCampus) {
      requestedCampus = userCampus;
    }

    const accessState = await getReportAccessState(req, requestedCampus);
    if (accessState.errorStatus) {
      return res.status(accessState.errorStatus).json({ error: accessState.errorMessage });
    }
    const { reportType = "Equipment Inventory", laboratory = "", status = "", reportPeriod = "all", search = "" } = req.query;
    const incomingDateFrom = req.query.dateFrom || "";
    const incomingDateTo = req.query.dateTo || "";
    const { dateFrom: derivedDateFrom, dateTo: derivedDateTo } = getDateRangeFromReportPeriod(reportPeriod);
    const dateFrom = incomingDateFrom || derivedDateFrom || "";
    const rawDateTo = incomingDateTo || derivedDateTo || "";
    const dateTo = /^\d{4}-\d{2}-\d{2}$/.test(String(rawDateTo))
      ? `${rawDateTo} 23:59:59.999`
      : rawDateTo;
    const searchTerm = search.toString().trim();
    const campus = String(accessState.effectiveCampus || "").trim();

    console.log('[API Report] Type:', reportType, '| Campus:', campus, '| Status:', status, '| Laboratory:', laboratory, '| Restricted:', accessState.isRestricted);

    if (reportType === "Equipment Inventory") {
      const records = await getEquipmentInventoryReportRows({
        campus,
        laboratory,
        status,
        dateFrom,
        dateTo,
        search: searchTerm
      });

      if (accessState.isRestricted) {
        return res.json(createRestrictedReportPayload({
          campus: accessState.restrictedCampus,
          campusTotal: records.length,
          visibleCampus: accessState.authorizedCampus
        }));
      }

      return res.json(records);
    }

    if (reportType === "Borrow Equipment") {
      const where = {};
      const borrowAuthContext = await getUserAuthContext(req);
      const borrowUserCampus = String(borrowAuthContext.campus || "").trim();
      if (!borrowAuthContext.userId) {
        return res.status(401).json({ error: "Please log in to view borrow reports." });
      }
      if (!borrowUserCampus && !accessState.isGlobalAdmin) {
        return res.status(403).json({ error: "User campus is not assigned." });
      }

      if (campus) {
        where.campus = { [Op.in]: getReportCampusVariants(campus) };
      }

      if (status) where.status = status;
      if (dateFrom || dateTo) {
        where.borrowDate = {};
        if (dateFrom) where.borrowDate[Op.gte] = dateFrom;
        if (dateTo) where.borrowDate[Op.lte] = dateTo;
      }
      if (searchTerm) {
        where[Op.or] = [
          { borrowerName: { [Op.like]: `%${searchTerm}%` } },
          { equipmentName: { [Op.like]: `%${searchTerm}%` } },
          { borrowerType: { [Op.like]: `%${searchTerm}%` } }
        ];
      }

      try {
        let records = await BorrowRecord.findAll({
          where,
          order: [["borrowDate", "DESC"]]
        });

        try {
          const equipmentIds = [...new Set(records.map(r => r.equipmentId).filter(Boolean))];
          if (equipmentIds.length > 0) {
            const equipmentMap = {};
            const equipmentList = await Equipment.findAll({
              where: { equipmentId: { [Op.in]: equipmentIds } }
            });
            equipmentList.forEach(eq => {
              equipmentMap[eq.equipmentId] = eq;
            });

            records = records.map(record => {
              const eq = equipmentMap[record.equipmentId];
              return {
                ...record.toJSON(),
                campus: record.campus || eq?.campus || "",
                laboratoryRoom: record.laboratoryRoom || eq?.laboratoryRoom || ""
              };
            });
          } else {
            records = records.map(r => r.toJSON());
          }
        } catch (equipmentError) {
          console.warn('[API Report Borrow] Equipment enrichment failed:', equipmentError.message);
          records = records.map(r => r.toJSON());
        }

        let formatted = records;

        if (laboratory) {
          formatted = formatted.filter((item) => item.laboratoryRoom === laboratory);
        }

        if (accessState.isRestricted) {
          return res.json(createRestrictedReportPayload({
            campus: accessState.restrictedCampus,
            campusTotal: formatted.length,
            visibleCampus: accessState.authorizedCampus
          }));
        }

        return res.json(formatted);
      } catch (borrowError) {
        console.error('[Report] Borrow query failed:', borrowError.message);
        return res.status(500).json({ error: borrowError.message });
      }
    }

    if (reportType === "Maintenance") {
      const where = {};
      if (status) where.status = status;
      if (campus) {
        const campusVariants = getReportCampusVariants(campus);
        where[Op.and] = [{
          [Op.or]: [
            { campus: { [Op.in]: campusVariants } },
            { "$equipment.campus$": { [Op.in]: campusVariants } }
          ]
        }];
      }
      if (dateFrom || dateTo) {
        where.dateReported = {};
        if (dateFrom) where.dateReported[Op.gte] = dateFrom;
        if (dateTo) where.dateReported[Op.lte] = dateTo;
      }
      if (searchTerm) {
        where[Op.and] = [...(where[Op.and] || []), { [Op.or]: [
          { issueTitle: { [Op.like]: `%${searchTerm}%` } },
          { description: { [Op.like]: `%${searchTerm}%` } },
          { equipmentId: { [Op.like]: `%${searchTerm}%` } }
        ] }];
      }
      const records = await MaintenanceRequest.findAll({
        where,
        order: [["dateReported", "DESC"]],
        include: [
          {
            model: Equipment,
            as: "equipment",
            attributes: ["equipmentId", "name", "campus", "laboratoryRoom"],
            required: false
          },
          {
            model: User,
            as: "technician",
            attributes: ["id", "name"]
          }
        ]
      });
      let formatted = records.map((record) => {
        const item = record.toJSON();
        return {
          ...item,
          equipmentName: item.equipment?.name || item.equipment_id || "—",
          equipmentId: item.equipment?.equipmentId || item.equipment?.equipment_id || item.equipment_id || item.equipmentId || "",
          technicianName: item.technician?.name || "Unassigned",
          dateReported: item.dateReported || item.created_at || item.createdAt || null,
          campus: item.equipment?.campus || item.campus || "",
          laboratoryRoom: item.equipment?.laboratoryRoom || item.laboratory_room || ""
        };
      });
      if (laboratory) {
        formatted = formatted.filter((item) => item.laboratoryRoom === laboratory);
      }

      if (accessState.isRestricted) {
        return res.json(createRestrictedReportPayload({
          campus: accessState.restrictedCampus,
          campusTotal: formatted.length,
          visibleCampus: accessState.authorizedCampus
        }));
      }

      return res.json(formatted);
    }

    if (reportType === "Attendance") {
      const where = {};
      if (campus) {
        const campusSchedules = await LaboratorySchedule.findAll({
          where: { campus: { [Op.in]: getReportCampusVariants(campus) } },
          attributes: ["id"],
          raw: true
        });
        where.laboratoryScheduleId = { [Op.in]: campusSchedules.map((schedule) => schedule.id) };
      }
      if (status) where.status = status;
      if (laboratory) {
        where.lab = laboratory;
      }
      if (dateFrom || dateTo) {
        where.date = {};
        if (dateFrom) where.date[Op.gte] = dateFrom;
        if (dateTo) where.date[Op.lte] = dateTo;
      }
      if (searchTerm) {
        where[Op.or] = [
          { fullName: { [Op.like]: `%${searchTerm}%` } },
          { lab: { [Op.like]: `%${searchTerm}%` } },
          { instructor: { [Op.like]: `%${searchTerm}%` } },
          { studentId: { [Op.like]: `%${searchTerm}%` } }
        ];
      }

      const records = await Attendance.findAll({ where, order: [["date", "DESC"]] });
      const attendanceRows = records.map((record) => record.toJSON());

      if (accessState.isRestricted) {
        return res.json(createRestrictedReportPayload({
          campus: accessState.restrictedCampus,
          campusTotal: attendanceRows.length,
          visibleCampus: accessState.authorizedCampus
        }));
      }

      return res.json(attendanceRows);
    }

    if (reportType === "User Activity") {
      const where = {};
      if (campus) where.campus = { [Op.in]: getReportCampusVariants(campus) };
      if (searchTerm) {
        where[Op.or] = [
          { name: { [Op.like]: `%${searchTerm}%` } },
          { email: { [Op.like]: `%${searchTerm}%` } },
          { role: { [Op.like]: `%${searchTerm}%` } },
          { student_number: { [Op.like]: `%${searchTerm}%` } }
        ];
      }
      const users = await User.findAll({ where, order: [["createdAt", "DESC"]] });
      let events = [];
      users.forEach((user) => {
        const item = user.toJSON();
        if (item.createdAt) {
          events.push({
            user: item.name,
            role: item.role,
            activity: "Account Created",
            date: item.createdAt.toISOString().slice(0, 10),
            time: item.createdAt.toISOString().slice(11, 16)
          });
        }
        if (item.updatedAt && item.updatedAt > item.createdAt) {
          events.push({
            user: item.name,
            role: item.role,
            activity: "Account Updated",
            date: item.updatedAt.toISOString().slice(0, 10),
            time: item.updatedAt.toISOString().slice(11, 16)
          });
        }
      });
      if (status) {
        events = events.filter((item) => item.activity === status);
      }
      if (dateFrom || dateTo) {
        events = events.filter((item) => {
          const itemDate = new Date(item.date);
          if (dateFrom && itemDate < new Date(dateFrom)) return false;
          if (dateTo && itemDate > new Date(dateTo)) return false;
          return true;
        });
      }

      if (accessState.isRestricted) {
        return res.json(createRestrictedReportPayload({
          campus: accessState.restrictedCampus,
          campusTotal: events.length,
          visibleCampus: accessState.authorizedCampus
        }));
      }

      return res.json(events);
    }

    return res.status(400).json({ error: "Invalid report type." });
  } catch (error) {
    console.error("Failed to load report data:", error);
    res.status(500).json({ error: "Failed to load report data." });
  }
});

router.get("/api/reports-summary", async (req, res) => {
  try {
    const authContext = await getUserAuthContext(req);
    const requestedCampus = String(req.query?.campus || "").trim();
    const accessState = await getReportAccessState(req, requestedCampus);
    if (accessState.errorStatus) return res.status(accessState.errorStatus).json({ error: accessState.errorMessage });
    const selectedCampus = String(accessState.effectiveCampus || "").trim();
    const campusVariants = getReportCampusVariants(selectedCampus);
    const campusFilter = selectedCampus ? { campus: { [Op.in]: campusVariants } } : {};

    const equipmentRows = await Equipment.findAll({
      attributes: ["status"],
      where: campusFilter,
      raw: true
    });
    const statusCounts = equipmentRows.reduce((counts, row) => {
      const status = String(row.status || "").trim().toLowerCase();
      if (status === "serviceable") counts.serviceable += 1;
      if (status === "unserviceable") counts.unserviceable += 1;
      if (status === "lost") counts.lost += 1;
      return counts;
    }, { serviceable: 0, unserviceable: 0, lost: 0 });

    const equipmentTotal = equipmentRows.length;
    const serviceableCount = statusCounts.serviceable;
    const unserviceableCount = statusCounts.unserviceable;
    const lostCount = statusCounts.lost;
    const totalUsers = await User.count({
      where: selectedCampus
        ? { campus: campusFilter.campus }
        : {}
    });
    res.json({
      equipmentTotal,
      serviceableCount,
      unserviceableCount,
      lostCount,
      totalUsers,
      equipmentSummary: `${serviceableCount} serviceable / ${unserviceableCount} unserviceable / ${lostCount} lost`,
      userSummary: `${totalUsers} registered users`,
      unserviceableSummary: `${unserviceableCount} items need maintenance`
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to load report summary." });
  }
});

router.get("/download/reports-summary", async (req, res) => {
  try {
    const requestedCampus = String(req.query?.campus || "").trim();
    const accessState = await getReportAccessState(req, requestedCampus);
    if (accessState.errorStatus) return res.status(accessState.errorStatus).send(accessState.errorMessage);
    const selectedCampus = String(accessState.effectiveCampus || "").trim();
    const campusFilter = selectedCampus ? { campus: { [Op.in]: getReportCampusVariants(selectedCampus) } } : {};

    const equipmentTotal = await Equipment.count({ where: campusFilter });
    const serviceableCount = await Equipment.count({ where: { ...campusFilter, status: "Serviceable" } });
    const unserviceableCount = await Equipment.count({ where: { ...campusFilter, status: "Unserviceable" } });
    const lostCount = await Equipment.count({ where: { ...campusFilter, status: "Lost" } });
    const totalUsers = await User.count({ where: campusFilter });
    const rows = [
      ["Report Type", "Count", "Summary"],
      ["Equipment Reports", equipmentTotal, `${serviceableCount} serviceable / ${unserviceableCount} unserviceable / ${lostCount} lost`],
      ["Registered Users", totalUsers, `${totalUsers} registered users`],
      ["Maintenance Reports", unserviceableCount, `${unserviceableCount} items need maintenance`]
    ];
    const csv = rows.map(row => row.map(cell => '"' + String(cell).replace(/"/g, '""') + '"').join(',')).join('\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="comlab_reports_summary.csv"');
    res.send(csv);
  } catch (error) {
    console.error(error);
    res.status(500).send('Failed to generate report CSV.');
  }
});

// ============================================
// PC SET MANAGEMENT ROUTES
// ============================================
import * as equipmentSetController from '../controllers/equipmentSetController.js';

// Get all PC sets
router.get('/api/equipment-sets', equipmentSetController.getAllPCSets);
router.get('/api/pc-stations/:setId/qr', getPCStationQr);

// Get single PC set with details
router.get('/api/equipment-sets/:setId', equipmentSetController.getPCSetDetails);

// Create new PC set
router.post('/api/equipment-sets', equipmentSetController.createPCSet);

// Update PC set
router.put('/api/equipment-sets/:setId', equipmentSetController.updatePCSet);

// Delete PC set
router.delete('/api/equipment-sets/:setId', equipmentSetController.deletePCSet);

// Get available equipment (not in any set)
router.get('/api/equipment/available-for-sets', equipmentSetController.getAvailableEquipment);

// Add components to set
router.post('/api/equipment-sets/:setId/components', equipmentSetController.addComponentToSet);

// Remove component from set
router.delete('/api/equipment-sets/:setId/components/:equipmentId', equipmentSetController.removeComponentFromSet);

// Get PC set statistics
router.get('/api/equipment-sets/stats/overview', equipmentSetController.getPCSetStatistics);

// PC Set Management Page
router.get('/pc-set-management', (req, res) => {
  res.sendFile(path.join(__dirname, '../pc-set-management.html'));
});

export default router;
