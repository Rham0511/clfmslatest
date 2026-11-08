import QRCode from "qrcode";
import { QueryTypes } from "sequelize";
import { AuditLog } from "../models/auditLogModel.js";
import { sequelize } from "../models/db.js";
import { User } from "../models/userModel.js";
import { createQrLinkToken, readQrLinkToken } from "../utils/qrLinkToken.js";
import { getArchivedEntityIds } from "../models/archiveRecords.js";
import { recordPCStationAttendance } from "./attendanceController.js";

const getSupportedRole = (role) => {
  const normalized = String(role || "").trim().toLowerCase();
  if (["admin", "administrator"].includes(normalized)) return "admin";
  if (["faculty", "instructor"].includes(normalized)) return "faculty";
  if (normalized === "student") return "student";
  return null;
};

const escapeHtml = (value) => String(value || "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#39;");

const getOpaqueStationPath = (token) => `/pc-station/uid/${encodeURIComponent(token)}`;
const getStationResultPath = (token) => `${getOpaqueStationPath(token)}/status`;

const getStationUrl = (req, token) => {
  const baseUrl = process.env.BASE_URL?.trim();
  const path = getOpaqueStationPath(token);
  if (baseUrl) return `${baseUrl.replace(/\/+$/, "")}${path}`;
  return `${req.protocol}://${req.get("host")}${path}`;
};

const getSessionUser = async (req) => {
  if (!req.session?.userId) return null;
  return User.findByPk(req.session.userId, {
    attributes: ["id", "name", "role", "campus", "student_number", "program", "year", "section"]
  });
};

const writeStationAudit = async (transaction, user, station, action, description) => {
  await AuditLog.create({
    userId: user?.id || null,
    actorName: user?.name || "Unknown user",
    actorRole: getSupportedRole(user?.role),
    action,
    module: "Authentication",
    resourceId: station.setId,
    description,
    userCampus: user?.campus || null
  }, { transaction });
};

const stationAuditDescription = (action, station, reason) =>
  `${action} at PC station ${station.setName} (${station.setId}). ${reason}`;

const startStudentPCStationUsage = async ({ user, station, attendanceId = null, transaction }) => {
  if (getSupportedRole(user?.role) !== "student") return;

  const activeUsage = await sequelize.query(
    `SELECT id
     FROM equipment_usage_logs
     WHERE userId = ? AND BINARY pcSetId = BINARY ? AND usageEndTime IS NULL
     LIMIT 1
     FOR UPDATE`,
    { replacements: [user.id, station.setId], type: QueryTypes.SELECT, transaction }
  );
  if (activeUsage.length) return;

  await sequelize.query(
    `INSERT INTO equipment_usage_logs
       (attendanceId, userId, campusId, laboratoryId, pcSetId, computerLabId, usageStartTime, sessionNotes)
     VALUES (?, ?, ?, ?, ?, ?,
       COALESCE((
         SELECT stationSession.startedAt
         FROM pc_station_sessions stationSession
         WHERE BINARY stationSession.setId = BINARY ? AND stationSession.activeUserId = ?
         LIMIT 1
       ), UTC_TIMESTAMP()),
       ?)`,
    {
      replacements: [
        attendanceId,
        user.id,
        station.campusId ?? user.campus ?? null,
        station.laboratoryId ?? station.location ?? null,
        station.setId,
        station.computerLabId ?? null,
        station.setId,
        user.id,
        `PC station session at ${station.setName || station.setId}.`
      ],
      type: QueryTypes.INSERT,
      transaction
    }
  );
};

const toSqlUtcDateTime = (value) => {
  if (!value) return null;
  if (value instanceof Date) return toUtcSqlDateTime(value);
  const text = String(value).trim();
  const match = text.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})/);
  return match ? `${match[1]} ${match[2]}` : toUtcSqlDateTime(value);
};

const finishStudentPCStationUsage = async ({ userId, station, startedAt = null, scheduledEndAt = null, transaction }) => {
  const endAt = toSqlUtcDateTime(scheduledEndAt);
  const [, metadata] = await sequelize.query(
    `UPDATE equipment_usage_logs
     SET usageEndTime = COALESCE(?, UTC_TIMESTAMP()),
         durationMinutes = GREATEST(ROUND(TIMESTAMPDIFF(SECOND, usageStartTime, COALESCE(?, UTC_TIMESTAMP())) / 60), 1)
     WHERE userId = ? AND BINARY pcSetId = BINARY ? AND usageEndTime IS NULL`,
    { replacements: [endAt, endAt, userId, station.setId], type: QueryTypes.UPDATE, transaction }
  );
  const affectedRows = typeof metadata === "number"
    ? metadata
    : Number(metadata?.affectedRows || 0);
  if (affectedRows) return;

  if (startedAt) {
    const completedUsage = await sequelize.query(
      `SELECT id
       FROM equipment_usage_logs
       WHERE userId = ? AND BINARY pcSetId = BINARY ?
         AND usageStartTime = ? AND usageEndTime IS NOT NULL
       LIMIT 1
       FOR UPDATE`,
      { replacements: [userId, station.setId, startedAt], type: QueryTypes.SELECT, transaction }
    );
    if (completedUsage.length) return;
  }

  const sessionStartedAt = toSqlUtcDateTime(startedAt) || toUtcSqlDateTime(new Date());
  await sequelize.query(
    `INSERT INTO equipment_usage_logs
       (userId, campusId, laboratoryId, pcSetId, computerLabId, usageStartTime, usageEndTime, durationMinutes, sessionNotes)
       VALUES (?, ?, ?, ?, ?, ?, COALESCE(?, UTC_TIMESTAMP()), GREATEST(ROUND(TIMESTAMPDIFF(SECOND, ?, COALESCE(?, UTC_TIMESTAMP())) / 60), 1), ?)`,
    {
      replacements: [
        userId,
        station.campusId ?? null,
        station.laboratoryId ?? station.location ?? null,
        station.setId,
        station.computerLabId ?? null,
        sessionStartedAt,
        endAt,
        sessionStartedAt,
        endAt,
        `PC station session at ${station.setName || station.setId}.`
      ],
      type: QueryTypes.INSERT,
      transaction
    }
  );
};

const getValidSetId = (value) => {
  const setId = String(value || "").trim();
  return setId.length > 0 && setId.length <= 50 ? setId : null;
};

const getDisplaySetId = (station) => {
  const localNumber = String(station?.setName || "").match(/(?:PC\s*Station|Station)\s*[-#:]?\s*(\d+)\s*$/i)?.[1];
  return localNumber
    ? `PC-SET-${String(Number(localNumber)).padStart(3, "0")}`
    : station?.setId;
};

const toUtcSqlDateTime = (value) => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 19).replace("T", " ");
};

export const getPCStationQr = async (req, res) => {
  try {
    const user = await getSessionUser(req);
    if (!user) return res.status(401).json({ error: "Please log in to manage PC station QR codes." });
    const role = String(user.role || "").trim().toLowerCase().replace(/[_-]+/g, "");
    if (!role.includes("admin") && role !== "technician") {
      return res.status(403).json({ error: "Only administrators and technicians can generate PC station QR codes." });
    }

    const setId = getValidSetId(req.params.setId);
    if (!setId) return res.status(400).json({ error: "A valid PC station ID is required." });
    if ((await getArchivedEntityIds("pc-set")).includes(setId)) {
      return res.status(404).json({ error: "PC station not found." });
    }

    const stations = await sequelize.query(
      "SELECT setId, setName, location FROM equipment_sets WHERE BINARY setId = BINARY ? LIMIT 1",
      { replacements: [setId], type: QueryTypes.SELECT }
    );
    const station = stations[0];
    if (!station) return res.status(404).json({ error: "PC station not found." });

    const token = createQrLinkToken("pc-station", station.setId);
    const url = getStationUrl(req, token);
    const qrCode = await QRCode.toDataURL(url, {
      type: "image/png",
      width: 800,
      margin: 4,
      errorCorrectionLevel: "H"
    });

    return res.json({
      success: true,
      station: {
        setId: station.setId,
        displaySetId: getDisplaySetId(station),
        setName: station.setName,
        location: station.location
      },
      url,
      qrCode
    });
  } catch (error) {
    console.error("[PCStation] Failed to generate station QR code:", error);
    return res.status(500).json({ error: "Failed to generate PC station QR code." });
  }
};

export const getPCStationScanAvailability = async (req, res) => {
  const setId = getValidSetId(readQrLinkToken(req.params.token, "pc-station"));
  if (!setId) return res.status(400).json({ success: false, error: "Invalid PC station QR code." });
  if (!req.session?.userId) {
    return res.status(401).json({ success: false, error: "Please sign in before scanning a PC station." });
  }

  try {
    if ((await getArchivedEntityIds("pc-set")).includes(setId)) {
      return res.status(404).json({ success: false, error: "PC station not found." });
    }

    const user = await getSessionUser(req);
    const role = getSupportedRole(user?.role);
    if (!user || !role) {
      return res.status(403).json({ success: false, error: "Your account cannot use PC station sign-in." });
    }

    const [station] = await sequelize.query(
      "SELECT setId, setName, status FROM equipment_sets WHERE BINARY setId = BINARY ? LIMIT 1",
      { replacements: [setId], type: QueryTypes.SELECT }
    );
    if (!station) return res.status(404).json({ success: false, error: "PC station not found." });

    const [session] = await sequelize.query(
      `SELECT activeUserId,
              (autoLogoutAt IS NOT NULL AND autoLogoutAt <= UTC_TIMESTAMP()) AS sessionExpired
       FROM pc_station_sessions
       WHERE BINARY setId = BINARY ?
       LIMIT 1`,
      { replacements: [station.setId], type: QueryTypes.SELECT }
    );
    const activeUserId = session?.activeUserId == null ? null : Number(session.activeUserId);
    const sessionExpired = Number(session?.sessionExpired || 0) === 1;
    const isMine = activeUserId === Number(user.id) && !sessionExpired;
    const isOccupied = activeUserId !== null && activeUserId !== Number(user.id) && !sessionExpired;
    const isActive = String(station.status || "").toLowerCase() === "active";

    res.set({ "Cache-Control": "no-store, private" });
    return res.json({
      success: true,
      station: {
        setId: station.setId,
        displaySetId: getDisplaySetId(station),
        setName: station.setName || station.setId
      },
      state: !isActive ? "unavailable" : isOccupied ? "occupied" : isMine ? "mine" : "available",
      occupied: isOccupied
    });
  } catch (error) {
    console.error("[PCStation] Unable to check station availability during QR scan:", error);
    return res.status(500).json({ success: false, error: "Unable to check this PC station. Please try again." });
  }
};

export const redirectLegacyPCStationQr = async (req, res) => {
  const setId = getValidSetId(req.params.setId);
  if (!setId) return res.status(400).send("Invalid PC station QR code.");

  try {
    if ((await getArchivedEntityIds("pc-set")).includes(setId)) {
      return res.status(404).send("PC station not found.");
    }
    const stations = await sequelize.query(
      "SELECT setId FROM equipment_sets WHERE BINARY setId = BINARY ? LIMIT 1",
      { replacements: [setId], type: QueryTypes.SELECT }
    );
    if (!stations[0]) return res.status(404).send("PC station not found.");

    const token = createQrLinkToken("pc-station", stations[0].setId);
    const isStatusPath = req.path.endsWith("/status");
    const suffix = isStatusPath
      ? `/status${req.query.result === "logout" ? "?result=logout" : "?result=login"}`
      : "";
    return res.redirect(302, `${getOpaqueStationPath(token)}${suffix}`);
  } catch (error) {
    console.error("[PCStation] Failed to update legacy station QR link:", error);
    return res.status(500).send("Unable to open this PC station QR code.");
  }
};

export const scanPCStationQr = async (req, res) => {
  const token = req.params.token;
  const setId = getValidSetId(readQrLinkToken(token, "pc-station"));
  if (!setId) return res.status(400).send("Invalid PC station ID.");
  if (!req.session?.userId) {
    req.session.redirectTo = getOpaqueStationPath(token);
    return res.redirect("/login");
  }

  const user = await getSessionUser(req);
  if (getSupportedRole(user?.role) === "student") {
    try {
      const activeSessions = await sequelize.query(
        `SELECT activeUserId,
                (autoLogoutAt IS NOT NULL AND autoLogoutAt <= UTC_TIMESTAMP()) AS sessionExpired
         FROM pc_station_sessions
         WHERE BINARY setId = BINARY ?
         LIMIT 1`,
        { replacements: [setId], type: QueryTypes.SELECT }
      );
      const sessionExpired = Number(activeSessions[0]?.sessionExpired || 0) === 1;
      const activeUserId = sessionExpired || activeSessions[0]?.activeUserId == null
        ? null
        : Number(activeSessions[0].activeUserId);
      if (activeUserId === Number(user.id)) {
        req.body = { ...(req.body || {}), action: "logout", autoScan: "1" };
        return submitPCStationAction(req, res);
      }
      if (activeUserId === null) {
        req.body = { ...(req.body || {}), action: "login", autoScan: "1" };
        return submitPCStationAction(req, res);
      }
    } catch (error) {
      console.error("[PCStation] Unable to check active station before student scan:", error);
      return res.status(500).send("Unable to check this PC station. Please try again.");
    }
  }
  return res.redirect(303, getStationResultPath(token));
};

export const submitPCStationAction = async (req, res) => {
  const token = req.params.token;
  const setId = getValidSetId(readQrLinkToken(token, "pc-station"));
  if (!setId) return res.status(400).send("Invalid PC station ID.");
  const requestedAction = String(req.body?.action || "").trim().toLowerCase();
  if (!["login", "logout"].includes(requestedAction)) {
    return res.status(400).send("Choose Login or Logout to continue.");
  }

  if (!req.session?.userId) {
    req.session.redirectTo = getOpaqueStationPath(token);
    return res.redirect("/login");
  }

  try {
    if ((await getArchivedEntityIds("pc-set")).includes(setId)) {
      return res.status(404).send("PC station not found.");
    }
    const user = await getSessionUser(req);
    const role = getSupportedRole(user?.role);
    if (!user || !role) {
      return res.status(403).send("Only signed-in administrators, students, and faculty can use a PC station QR code.");
    }

    const result = await sequelize.transaction(async (transaction) => {
      const stations = await sequelize.query(
        "SELECT setId, setName, location, status, campusId, laboratoryId, computerLabId FROM equipment_sets WHERE BINARY setId = BINARY ? FOR UPDATE",
        { replacements: [setId], type: QueryTypes.SELECT, transaction }
      );
      const station = stations[0];
      if (!station) return { error: "PC station not found.", status: 404 };

      await sequelize.query(
        `INSERT IGNORE INTO pc_station_sessions (setId, activeUserId, startedAt)
         VALUES (?, NULL, NULL)`,
        { replacements: [station.setId], type: QueryTypes.INSERT, transaction }
      );
      const activeSessions = await sequelize.query(
        `SELECT activeUserId, startedAt,
                DATE_FORMAT(autoLogoutAt, '%Y-%m-%d %H:%i:%s') AS autoLogoutAt,
                (autoLogoutAt IS NOT NULL AND autoLogoutAt <= UTC_TIMESTAMP()) AS sessionExpired
         FROM pc_station_sessions
         WHERE BINARY setId = BINARY ?
         FOR UPDATE`,
        { replacements: [station.setId], type: QueryTypes.SELECT, transaction }
      );
      let activeUserId = activeSessions[0]?.activeUserId == null
        ? null
        : Number(activeSessions[0].activeUserId);

      if (activeUserId !== null && Number(activeSessions[0]?.sessionExpired || 0) === 1) {
        const expiredUserId = activeUserId;
        const expiredUser = await User.findByPk(expiredUserId, {
          attributes: ["id", "name", "role", "campus"],
          transaction
        });
        await sequelize.query(
          `UPDATE pc_station_sessions
           SET activeUserId = NULL, startedAt = NULL, autoLogoutAt = NULL
           WHERE BINARY setId = BINARY ? AND activeUserId = ?`,
          { replacements: [station.setId, expiredUserId], type: QueryTypes.UPDATE, transaction }
        );
        if (getSupportedRole(expiredUser?.role) === "student") {
          await finishStudentPCStationUsage({
            userId: expiredUserId,
            station,
            startedAt: activeSessions[0]?.startedAt,
            scheduledEndAt: activeSessions[0]?.autoLogoutAt,
            transaction
          });
        }
        await writeStationAudit(
          transaction,
          expiredUser || { id: expiredUserId },
          station,
          "Logout",
          stationAuditDescription("Automatically logged out", station, "The scheduled PC station session had expired.")
        );
        activeUserId = null;
      }

      if (requestedAction === "logout") {
        if (activeUserId !== Number(user.id)) {
          return { error: "You are not currently signed in at this PC station. Scan the QR code again to sign in.", status: 409 };
        }
        await sequelize.query(
          `UPDATE pc_station_sessions
           SET activeUserId = NULL, startedAt = NULL, autoLogoutAt = NULL
           WHERE BINARY setId = BINARY ? AND activeUserId = ?`,
          { replacements: [station.setId, user.id], type: QueryTypes.UPDATE, transaction }
        );
        if (role === "student") {
          await finishStudentPCStationUsage({
            userId: user.id,
            station,
            startedAt: activeSessions[0]?.startedAt,
            transaction
          });
        }
        await writeStationAudit(
          transaction,
          user,
          station,
          "Logout",
          stationAuditDescription("Logged out", station, req.body?.autoScan === "1"
            ? "The user scanned the station QR code again."
            : "The user confirmed logout after scanning the station QR code.")
        );
        return { station, action: "logout", role };
      }

      if (String(station.status || "").toLowerCase() !== "active") {
        return { error: "This PC station is not currently available for use.", status: 409 };
      }
      if (activeUserId !== null && activeUserId !== Number(user.id)) {
        return {
          station,
          stationOccupied: true,
          error: `${station.setName} is currently in use. Please choose another PC station.`,
          status: 409
        };
      }
      if (activeUserId === Number(user.id)) {
        const attendanceResult = role === "student"
          ? await recordPCStationAttendance({ student: user, station, transaction })
          : null;
        if (role === "student") {
          await startStudentPCStationUsage({
            user,
            station: { ...station, startedAt: activeSessions[0]?.startedAt },
            attendanceId: attendanceResult?.attendanceId || null,
            transaction
          });
        }
        if (attendanceResult?.autoLogoutAt) {
          await sequelize.query(
            `UPDATE pc_station_sessions SET autoLogoutAt = ? WHERE BINARY setId = BINARY ? AND activeUserId = ?`,
            { replacements: [toUtcSqlDateTime(attendanceResult.autoLogoutAt), station.setId, user.id], type: QueryTypes.UPDATE, transaction }
          );
        }
        return { station, action: "login", role, attendanceResult };
      }

      const attendanceResult = role === "student"
        ? await recordPCStationAttendance({ student: user, station, transaction })
        : null;
      await sequelize.query(
        `UPDATE pc_station_sessions
         SET activeUserId = ?, startedAt = UTC_TIMESTAMP(), autoLogoutAt = ?
         WHERE BINARY setId = BINARY ?`,
        { replacements: [user.id, toUtcSqlDateTime(attendanceResult?.autoLogoutAt), station.setId], type: QueryTypes.UPDATE, transaction }
      );
      if (role === "student") {
        const [session] = await sequelize.query(
          "SELECT startedAt FROM pc_station_sessions WHERE BINARY setId = BINARY ? AND activeUserId = ?",
          { replacements: [station.setId, user.id], type: QueryTypes.SELECT, transaction }
        );
        await startStudentPCStationUsage({
          user,
          station: { ...station, startedAt: session?.startedAt },
          attendanceId: attendanceResult?.attendanceId || null,
          transaction
        });
      }
      await writeStationAudit(
        transaction,
        user,
        station,
        "Login",
          stationAuditDescription("Logged in", station, "The user confirmed login after scanning the station QR code.")
      );
      return { station, action: "login", role, attendanceResult };
    });

    if (result.error && result.stationOccupied) return res.redirect(303, getStationResultPath(token));
    if (result.error) return res.status(result.status).send(escapeHtml(result.error));
    if (result.attendanceResult && role === "student") {
      const attendance = result.attendanceResult;
      const subject = attendance.schedule?.subject || "the scheduled class";
      let notice;
      if (attendance.recorded) {
        notice = attendance.alreadyRecorded
          ? `Attendance for ${subject} was already recorded as ${attendance.status}. This PC station is now linked to your attendance.`
          : `Attendance for ${subject} was recorded as ${attendance.status}.`;
      } else if (attendance.reason === "attendance-window-closed") {
        notice = `The attendance window for ${subject} has closed. Your PC sign-in was recorded, but class attendance was not.`;
      } else if (attendance.reason === "multiple-current-classes") {
        notice = "More than one matching class is scheduled now, so attendance was not recorded. Please contact your instructor.";
      } else if (attendance.reason === "missing-student-id") {
        notice = "Your account has no official student ID, so class attendance was not recorded.";
      } else {
        notice = "No matching class schedule is active now, so class attendance was not recorded.";
      }
      req.session.pcStationAttendanceNotice = { setId: result.station.setId, message: notice };
    }
    return res.redirect(303, `${getStationResultPath(token)}?result=${result.action}`);
  } catch (error) {
    console.error("[PCStation] Failed to record station scan:", error);
    return res.status(500).send("Unable to record this PC station session. Please try again.");
  }
};

export const showPCStationScanResult = async (req, res) => {
  const token = req.params.token;
  const setId = getValidSetId(readQrLinkToken(token, "pc-station"));
  if (!setId) return res.status(400).send("Invalid PC station ID.");

  try {
    if ((await getArchivedEntityIds("pc-set")).includes(setId)) {
      return res.status(404).send("PC station not found.");
    }
    const user = await getSessionUser(req);
    const role = getSupportedRole(user?.role);
    if (!user || !role) return res.redirect("/login");

    const stations = await sequelize.query(
      "SELECT setId, setName, location, status FROM equipment_sets WHERE BINARY setId = BINARY ? LIMIT 1",
      { replacements: [setId], type: QueryTypes.SELECT }
    );
    const station = stations[0];
    if (!station) return res.status(404).send("PC station not found.");

    const result = ["login", "logout"].includes(req.query.result) ? req.query.result : null;
    const isComplete = result !== null;
    let attendanceNotice = null;
    if (isComplete && req.session?.pcStationAttendanceNotice?.setId === station.setId) {
      attendanceNotice = req.session.pcStationAttendanceNotice.message;
      delete req.session.pcStationAttendanceNotice;
    }
    let pendingAction = "login";
    let stationOccupied = false;
    const stationUnavailable = String(station.status || "").toLowerCase() !== "active";
    if (!isComplete) {
      const activeSessions = await sequelize.query(
        `SELECT activeUserId,
                (autoLogoutAt IS NOT NULL AND autoLogoutAt <= UTC_TIMESTAMP()) AS sessionExpired
         FROM pc_station_sessions
         WHERE BINARY setId = BINARY ?
         LIMIT 1`,
        { replacements: [station.setId], type: QueryTypes.SELECT }
      );
      const activeUserId = activeSessions[0]?.activeUserId == null
        ? null
        : Number(activeSessions[0].activeUserId);
      const sessionExpired = Number(activeSessions[0]?.sessionExpired || 0) === 1;
      if (activeUserId === Number(user.id) && !sessionExpired) pendingAction = "logout";
      else if (activeUserId !== null && !sessionExpired) stationOccupied = true;
    }
    const isLogin = (result || pendingAction) === "login";
    const auditUrl = role === "admin"
      ? "/page/audit-logs"
      : role === "faculty"
        ? "/faculty-audit-history?view=pc-logs"
        : "/student-audit-history";
    const dashboardUrl = role === "admin"
      ? "/admin-dashboard"
      : role === "faculty"
        ? "/faculty-dashboard"
        : "/student-dashboard";
    const message = isComplete
      ? isLogin
        ? `You are now signed in at ${station.setName}.${attendanceNotice ? ` ${attendanceNotice}` : ""} Scan this station QR again when you are finished.`
        : `You have been signed out from ${station.setName}.`
      : pendingAction === "logout"
        ? `You are currently signed in at ${station.setName}. Confirm below when you are ready to log out.`
        : stationOccupied
          ? `${station.setName} is currently occupied by another signed-in user. This station is locked until they sign out. Please choose another PC station.`
          : stationUnavailable
            ? `${station.setName} is not currently available for sign-in. Please choose another PC station.`
            : `Confirm below to sign in at ${station.setName}.`;
    const heading = isComplete
      ? isLogin ? "PC station login recorded" : "PC station logout recorded"
      : stationOccupied ? "PC station currently in use"
        : stationUnavailable && pendingAction !== "logout" ? "PC station unavailable"
          : pendingAction === "logout" ? "Sign out of this PC station" : "Sign in to this PC station";
    const actionsHtml = isComplete
      ? `<a class="action action-primary" href="${escapeHtml(auditUrl)}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z"/><path d="M8 7h8M8 11h8"/>
        </svg>
        <span>View my audit history</span>
      </a>
      <a class="action action-secondary" href="${escapeHtml(dashboardUrl)}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="m3 10 9-7 9 7"/><path d="M5 9v11h14V9"/><path d="M9 20v-6h6v6"/>
        </svg>
        <span>Go to dashboard</span>
      </a>`
      : stationOccupied || (stationUnavailable && pendingAction !== "logout")
        ? `<a class="action action-secondary" href="${escapeHtml(dashboardUrl)}">Return to dashboard</a>`
      : `<form method="post" action="${escapeHtml(`${getOpaqueStationPath(token)}/action`)}">
        <input type="hidden" name="action" value="${escapeHtml(pendingAction)}">
        <button class="action action-primary" type="submit">${pendingAction === "login" ? "Login to this PC" : "Logout from this PC"}</button>
      </form>`;

    res.set({
      "Cache-Control": "no-store, no-cache, must-revalidate, private",
      "Pragma": "no-cache",
      "Expires": "0"
    });
    return res.type("html").send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta name="theme-color" content="#06140e">
  <title>PC Station Session | ComLab</title>
  <style>
    * { box-sizing: border-box; }
    body {
      min-height: 100vh;
      min-height: 100svh;
      margin: 0;
      display: grid;
      place-items: center;
      padding: max(1.25rem, env(safe-area-inset-top)) max(1rem, env(safe-area-inset-right)) max(1.25rem, env(safe-area-inset-bottom)) max(1rem, env(safe-area-inset-left));
      background: radial-gradient(ellipse at 50% 0%, rgba(16, 91, 58, .22), transparent 55%), #06140e;
      color: #e7fff1;
      font: 16px/1.5 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    .card {
      width: min(100%, 34rem);
      padding: clamp(1.35rem, 5vw, 2.25rem);
      border: 1px solid rgba(52, 211, 153, .27);
      border-radius: 1.5rem;
      background: linear-gradient(150deg, rgba(10, 35, 24, .98), rgba(7, 25, 18, .98));
      box-shadow: 0 28px 80px rgba(0, 0, 0, .38), inset 0 1px rgba(255, 255, 255, .025);
    }
    .result-icon {
      width: 3.5rem;
      height: 3.5rem;
      display: grid;
      place-items: center;
      margin-bottom: 1.25rem;
      border: 1px solid rgba(74, 222, 128, .28);
      border-radius: 1.1rem;
      background: rgba(16, 185, 129, .12);
      color: #6ee7b7;
    }
    .result-icon svg { width: 1.75rem; height: 1.75rem; }
    .eyebrow {
      margin: 0 0 .5rem;
      color: #6ee7b7;
      font-size: .75rem;
      font-weight: 750;
      letter-spacing: .14em;
      text-transform: uppercase;
    }
    h1 {
      margin: 0;
      color: #ecfdf5;
      font-size: clamp(1.55rem, 5vw, 2rem);
      font-weight: 750;
      letter-spacing: -.035em;
      line-height: 1.15;
      text-wrap: balance;
    }
    .message {
      margin: 1rem 0 0;
      color: #b9d2c3;
      font-size: clamp(.98rem, 3.5vw, 1.08rem);
      line-height: 1.65;
      overflow-wrap: anywhere;
    }
    .actions {
      display: grid;
      gap: .75rem;
      margin-top: 1.75rem;
    }
    .action {
      min-height: 3.25rem;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: .65rem;
      padding: .8rem 1rem;
      border: 1px solid transparent;
      border-radius: .9rem;
      color: #f0fdf4;
      font: inherit;
      font-weight: 700;
      line-height: 1.25;
      text-align: center;
      text-decoration: none;
      transition: background-color 140ms ease, border-color 140ms ease, transform 140ms ease;
      -webkit-tap-highlight-color: transparent;
    }
    .action svg { width: 1.15rem; height: 1.15rem; flex: 0 0 auto; }
    .action:active { transform: translateY(1px); }
    .action:focus-visible { outline: 3px solid #a7f3d0; outline-offset: 3px; }
    .action-primary {
      border-color: rgba(52, 211, 153, .4);
      background: #087443;
      box-shadow: 0 8px 22px rgba(4, 120, 87, .2);
    }
    .action-primary:hover { background: #099052; }
    .action-secondary {
      border-color: rgba(110, 231, 183, .24);
      background: rgba(16, 55, 39, .72);
      color: #d1fae5;
    }
    .action-secondary:hover { border-color: rgba(110, 231, 183, .45); background: rgba(21, 75, 51, .8); }
    .actions form { margin: 0; }
    .actions form .action { width: 100%; cursor: pointer; }
    @media (min-width: 480px) {
      .actions { grid-template-columns: 1.15fr 1fr; }
    }
    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after { scroll-behavior: auto !important; transition-duration: .01ms !important; }
    }
  </style>
</head>
<body>
  <main class="card" aria-labelledby="result-title" aria-live="polite">
    <div class="result-icon" aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <path d="M12 3 4.5 6v5.2c0 4.7 3.2 8.1 7.5 9.8 4.3-1.7 7.5-5.1 7.5-9.8V6L12 3Z"/>
        <path d="m8.7 12.2 2.1 2.1 4.6-4.7"/>
      </svg>
    </div>
    <p class="eyebrow">PC station session</p>
    <h1 id="result-title">${escapeHtml(heading)}</h1>
    <p class="message">${escapeHtml(message)}</p>
    <nav class="actions" aria-label="Next steps">
      ${actionsHtml}
    </nav>
  </main>
</body>
</html>`);
  } catch (error) {
    console.error("[PCStation] Failed to show station scan result:", error);
    return res.status(500).send("Unable to load the PC station session result.");
  }
};

export const getMyPCStationSessions = async (req, res) => {
  if (!req.session?.userId) {
    return res.status(401).json({ success: false, error: "Please sign in to view your PC station session." });
  }

  try {
    const user = await getSessionUser(req);
    if (getSupportedRole(user?.role) !== "student") {
      return res.status(403).json({ success: false, error: "This session list is available to students only." });
    }

    const sessions = await sequelize.query(
      `SELECT ps.setId, COALESCE(es.setName, ps.setId) AS setName,
              es.location, ps.startedAt, ps.autoLogoutAt,
              es.campusId, es.laboratoryId, es.computerLabId
       FROM pc_station_sessions ps
       LEFT JOIN equipment_sets es ON BINARY es.setId = BINARY ps.setId
       WHERE ps.activeUserId = ?
         AND (ps.autoLogoutAt IS NULL OR ps.autoLogoutAt > UTC_TIMESTAMP())
       ORDER BY ps.startedAt DESC, ps.setId ASC`,
      { replacements: [user.id], type: QueryTypes.SELECT }
    );

    res.set({ "Cache-Control": "no-store, private" });
    return res.json({ success: true, sessions });
  } catch (error) {
    console.error("[PCStation] Failed to load current student station sessions:", error);
    return res.status(500).json({ success: false, error: "Unable to load your active PC station." });
  }
};

export const logoutMyPCStationSession = async (req, res) => {
  if (!req.session?.userId) {
    return res.status(401).json({ success: false, error: "Please sign in before ending a PC station session." });
  }

  try {
    const user = await getSessionUser(req);
    if (getSupportedRole(user?.role) !== "student") {
      return res.status(403).json({ success: false, error: "Only students can end a session from this page." });
    }

    const setId = getValidSetId(req.body?.setId);
    if (!setId) return res.status(400).json({ success: false, error: "A valid PC station is required." });

    const endedCount = await endUserStationSessions(
      user.id,
      "The student ended the session from My PC Station.",
      setId
    );
    if (!endedCount) {
      return res.status(409).json({ success: false, error: "You are no longer signed in at this PC station." });
    }

    return res.json({ success: true, message: "You have been signed out from this PC station." });
  } catch (error) {
    console.error("[PCStation] Failed to end student station session:", error);
    return res.status(500).json({ success: false, error: "Unable to end this PC station session." });
  }
};

export const endUserStationSessions = async (userId, reason = "The user logged out of ComLab.", setId = null) => {
  if (!userId) return 0;

  return sequelize.transaction(async (transaction) => {
    const activeSessions = await sequelize.query(
      `SELECT setId, startedAt
       FROM pc_station_sessions
       WHERE activeUserId = ?${setId ? " AND BINARY setId = BINARY ?" : ""}
       ORDER BY setId`,
      { replacements: setId ? [userId, setId] : [userId], type: QueryTypes.SELECT, transaction }
    );
    if (!activeSessions.length) return 0;

    const user = await User.findByPk(userId, {
      attributes: ["id", "name", "role", "campus"],
      transaction
    });
    let endedCount = 0;

    for (const session of activeSessions) {
      const stations = await sequelize.query(
        "SELECT setId, setName, location, campusId, laboratoryId, computerLabId FROM equipment_sets WHERE BINARY setId = BINARY ? FOR UPDATE",
        { replacements: [session.setId], type: QueryTypes.SELECT, transaction }
      );
      const activeSession = await sequelize.query(
        `SELECT setId
         FROM pc_station_sessions
         WHERE BINARY setId = BINARY ? AND activeUserId = ?
         FOR UPDATE`,
        { replacements: [session.setId, userId], type: QueryTypes.SELECT, transaction }
      );
      if (!activeSession.length) continue;

      const [, metadata] = await sequelize.query(
        `UPDATE pc_station_sessions
         SET activeUserId = NULL, startedAt = NULL, autoLogoutAt = NULL
         WHERE BINARY setId = BINARY ? AND activeUserId = ?`,
        { replacements: [session.setId, userId], type: QueryTypes.UPDATE, transaction }
      );
      const affectedRows = typeof metadata === "number"
        ? metadata
        : Number(metadata?.affectedRows || 0);
      if (affectedRows !== 1) continue;

      const station = {
        setId: session.setId,
        setName: stations[0]?.setName || session.setId
      };
      await writeStationAudit(
        transaction,
        user || { id: userId },
        station,
        "Logout",
        stationAuditDescription("Logged out", station, reason)
      );
      if (getSupportedRole(user?.role) === "student") {
        await finishStudentPCStationUsage({
          userId,
          station: { ...station, ...stations[0] },
          startedAt: session.startedAt,
          transaction
        });
      }
      endedCount += 1;
    }

    return endedCount;
  });
};

export const expirePCStationSessions = async () => sequelize.transaction(async (transaction) => {
  const dueSessions = await sequelize.query(
    `SELECT setId, activeUserId, startedAt,
            DATE_FORMAT(autoLogoutAt, '%Y-%m-%d %H:%i:%s') AS autoLogoutAt
     FROM pc_station_sessions
     WHERE activeUserId IS NOT NULL AND autoLogoutAt IS NOT NULL AND autoLogoutAt <= UTC_TIMESTAMP()
     ORDER BY setId`,
    { type: QueryTypes.SELECT, transaction }
  );
  let endedCount = 0;

  for (const due of dueSessions) {
    const stations = await sequelize.query(
      "SELECT setId, setName, location, campusId, laboratoryId, computerLabId FROM equipment_sets WHERE BINARY setId = BINARY ? FOR UPDATE",
      { replacements: [due.setId], type: QueryTypes.SELECT, transaction }
    );
    const sessionRows = await sequelize.query(
      `SELECT setId, activeUserId
       FROM pc_station_sessions
       WHERE BINARY setId = BINARY ? AND activeUserId = ? AND autoLogoutAt <= UTC_TIMESTAMP()
       FOR UPDATE`,
      { replacements: [due.setId, due.activeUserId], type: QueryTypes.SELECT, transaction }
    );
    if (!sessionRows.length) continue;

    const user = await User.findByPk(due.activeUserId, {
      attributes: ["id", "name", "role", "campus"],
      transaction
    });
    const [, metadata] = await sequelize.query(
      `UPDATE pc_station_sessions
       SET activeUserId = NULL, startedAt = NULL, autoLogoutAt = NULL
       WHERE BINARY setId = BINARY ? AND activeUserId = ? AND autoLogoutAt <= UTC_TIMESTAMP()`,
      { replacements: [due.setId, due.activeUserId], type: QueryTypes.UPDATE, transaction }
    );
    const affectedRows = typeof metadata === "number"
      ? metadata
      : Number(metadata?.affectedRows || 0);
    if (affectedRows !== 1) continue;

    const station = {
      setId: due.setId,
      setName: stations[0]?.setName || due.setId
    };
    await writeStationAudit(
      transaction,
      user || { id: due.activeUserId },
      station,
      "Logout",
      stationAuditDescription("Automatically logged out", station, "The scheduled class ended.")
    );
    if (getSupportedRole(user?.role) === "student") {
      await finishStudentPCStationUsage({
        userId: due.activeUserId,
        station: { ...station, ...stations[0] },
        startedAt: due.startedAt,
        scheduledEndAt: due.autoLogoutAt,
        transaction
      });
    }
    endedCount += 1;
  }

  return endedCount;
});
