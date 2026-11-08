import { sequelize } from "../models/db.js";
import { QueryTypes } from "sequelize";
import { User } from "../models/userModel.js";
import { LaboratorySchedule } from "../models/laboratoryScheduleModel.js";
import { canManageRecord } from "./campusAuthController.js";

const getManilaDateKey = (date = new Date()) => {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
};

const buildPastScheduleDates = (createdLocalDate, weekdayIndex, todayKey, sessionCounts) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(createdLocalDate || "")) || weekdayIndex < 0) return [];
  const cursor = new Date(`${createdLocalDate}T00:00:00Z`);
  const today = new Date(`${todayKey}T00:00:00Z`);
  const pastDates = [];
  while (cursor <= today) {
    const weekday = (cursor.getUTCDay() + 6) % 7;
    if (weekday === weekdayIndex) {
      const sessionDate = cursor.toISOString().slice(0, 10);
      const sessionCount = Number(sessionCounts.get(sessionDate) || 0);
      if (cursor < today || sessionCount > 0) pastDates.push({ sessionDate, sessionCount });
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return pastDates.reverse();
};

const parseScheduleClockMinutes = (value) => {
  const match = String(value || "").trim().match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)?$/i);
  if (!match) return null;
  let hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (minutes > 59) return null;
  const meridiem = match[3]?.toUpperCase();
  if (meridiem) {
    if (hours < 1 || hours > 12) return null;
    hours = (hours % 12) + (meridiem === "PM" ? 12 : 0);
  } else if (hours > 23) {
    return null;
  }
  return hours * 60 + minutes;
};

const toSqlClock = (minutes) =>
  `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}:00`;

/**
 * Get live occupancy or completed PC sessions for a laboratory schedule.
 * Historical sessions are limited to occurrences on the schedule weekday after creation.
 */
export async function getScheduleSeatingChart(req, res) {
  const { scheduleId } = req.params;

  try {
    const userId = req.session?.userId;
    if (!userId) return res.status(401).json({ error: "Authentication required." });

    const [user, assignedSchedule] = await Promise.all([
      User.findByPk(userId, { attributes: ["id", "name", "role", "campus"] }),
      LaboratorySchedule.findByPk(scheduleId)
    ]);
    if (!user || !assignedSchedule) return res.status(404).json({ error: "Schedule not found." });

    const role = String(user.role || "").trim().toLowerCase().replace(/[_-]+/g, "");
    const isFaculty = ["faculty", "instructor"].includes(role);
    const isCentralAdmin = ["superadmin", "centraladmin", "systemadmin"].includes(role);
    const isCampusManager = ["admin", "administrator", "technician"].includes(role) &&
      canManageRecord(user.campus, assignedSchedule.campus);
    const isAssignedFaculty = isFaculty && (
      String(assignedSchedule.instructorUserId || "") === String(user.id) ||
      (!assignedSchedule.instructorUserId &&
        String(assignedSchedule.instructor || "").trim().toLowerCase() === String(user.name || "").trim().toLowerCase())
    );
    if (!isCentralAdmin && !isCampusManager && !isAssignedFaculty) {
      return res.status(403).json({ error: "You do not have access to this schedule's seating map." });
    }

    // 1. Get schedule details
    const scheduleRows = await sequelize.query(
      `SELECT 
        id,
        subject,
        dayOfWeek,
        startTime,
        endTime,
        laboratoryRoom,
        instructor,
        campus,
        yearLevel,
        section,
        createdAt,
        DATE_FORMAT(DATE_ADD(createdAt, INTERVAL 8 HOUR), '%Y-%m-%d') AS createdLocalDate
      FROM laboratory_schedules
      WHERE id = ?`,
      {
        replacements: [scheduleId],
        type: QueryTypes.SELECT
      }
    );

    if (scheduleRows.length === 0) {
      return res.status(404).json({ error: "Schedule not found" });
    }

    const schedule = scheduleRows[0];
    // PC station ownership is stored on the PC set, while individual
    // components can retain older room labels from before set assembly.
    const scheduleRoom = String(schedule.laboratoryRoom || '').trim();
    const labNumber = scheduleRoom.match(/(?:laboratory|computer\s*lab|lab)\s*([12])\b/i)?.[1]
      || scheduleRoom.match(/room\s*(202|204)\b/i)?.[1]?.replace('202', '1').replace('204', '2');
    if (!labNumber) {
      return res.status(409).json({ error: 'The schedule does not have a valid laboratory room.' });
    }
    const campusName = String(schedule.campus || '').trim().replace(/\s*Campus\s*$/i, '').toLowerCase();
    
    const pcSets = await sequelize.query(
      `SELECT 
        es.id,
        es.setId,
        es.setName,
        es.location,
        es.status as setStatus,
        GROUP_CONCAT(
          CONCAT(e.category, ': ', COALESCE(e.name, 'N/A'), ' (SN: ', COALESCE(e.serialNumber, 'N/A'), ')')
          ORDER BY FIELD(e.category, 'System Unit', 'CPU', 'Monitor', 'Keyboard', 'Mouse', 'AVR', 'Other')
          SEPARATOR ' | '
        ) as components,
        COUNT(DISTINCT e.id) as componentCount
      FROM equipment_sets es
      LEFT JOIN equipment e ON BINARY es.setId = BINARY e.setId 
        AND e.status = 'Serviceable'
        AND LOWER(TRIM(REPLACE(e.campus, ' Campus', ''))) = ?
      WHERE es.status = 'active'
        AND UPPER(REPLACE(REPLACE(TRIM(es.location), ' ', ''), '-', '')) = ?
      GROUP BY es.id, es.setId, es.setName, es.location, es.status
      HAVING componentCount > 0
      ORDER BY es.setId`,
      { 
        replacements: [campusName, `COMLAB${labNumber}`],
        type: QueryTypes.SELECT 
      }
    );

    const stationSetIds = pcSets.map((pc) => pc.setId);

    const schedulePayload = {
      id: schedule.id,
      subject: schedule.subject,
      day: schedule.dayOfWeek,
      time: `${schedule.startTime} - ${schedule.endTime}`,
      room: schedule.laboratoryRoom,
      instructor: schedule.instructor,
      campus: schedule.campus,
      yearLevel: schedule.yearLevel,
      section: schedule.section,
      createdAt: schedule.createdAt,
      createdLocalDate: schedule.createdLocalDate,
    };

    if (String(req.query.view || '').toLowerCase() === 'history') {
      const weekdays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
      const scheduleWeekday = weekdays.findIndex((day) =>
        day.toLowerCase() === String(schedule.dayOfWeek || '').trim().toLowerCase() ||
        day.slice(0, 3).toLowerCase() === String(schedule.dayOfWeek || '').trim().slice(0, 3).toLowerCase()
      );
      const replacements = {
        stationSetIds,
        scheduleId: schedule.id,
        scheduleCreatedAt: schedule.createdAt,
        scheduleWeekday,
      };
      const startMinutes = parseScheduleClockMinutes(schedule.startTime);
      const endMinutes = parseScheduleClockMinutes(schedule.endTime);
      const scheduleStartTime = startMinutes === null ? null : toSqlClock(Math.max(0, startMinutes - 15));
      const scheduleEndTime = endMinutes === null ? null : toSqlClock(endMinutes);
      const hasScheduleTimeRange = startMinutes !== null && endMinutes !== null && startMinutes !== endMinutes;
      const nullAttendanceTimeFilter = hasScheduleTimeRange
        ? endMinutes > startMinutes
          ? `AND TIME(DATE_ADD(eul.usageStartTime, INTERVAL 8 HOUR)) >= :scheduleStartTime
             AND TIME(DATE_ADD(eul.usageStartTime, INTERVAL 8 HOUR)) < :scheduleEndTime`
          : `AND (TIME(DATE_ADD(eul.usageStartTime, INTERVAL 8 HOUR)) >= :scheduleStartTime
             OR TIME(DATE_ADD(eul.usageStartTime, INTERVAL 8 HOUR)) < :scheduleEndTime)`
        : "";
      const scheduleSessionMatch = `(a.laboratoryScheduleId = :scheduleId OR
        (eul.attendanceId IS NULL ${nullAttendanceTimeFilter}))`;
      const historyReplacements = {
        ...replacements,
        scheduleStartTime,
        scheduleEndTime,
      };
      const dateFilter = String(req.query.date || '').trim();
      const sessionDateRows = stationSetIds.length && scheduleWeekday >= 0
        ? await sequelize.query(
            `SELECT
               DATE_FORMAT(DATE_ADD(eul.usageStartTime, INTERVAL 8 HOUR), '%Y-%m-%d') AS sessionDate,
               COUNT(*) AS sessionCount
             FROM equipment_usage_logs eul
             INNER JOIN users u ON u.id = eul.userId
             LEFT JOIN attendance a ON a.id = eul.attendanceId
             WHERE BINARY eul.pcSetId IN (:stationSetIds)
               AND LOWER(TRIM(COALESCE(u.role, ''))) = 'student'
               AND ${scheduleSessionMatch}
               AND eul.usageStartTime >= :scheduleCreatedAt
               AND eul.usageStartTime < UTC_TIMESTAMP()
               AND eul.usageEndTime IS NOT NULL
               AND WEEKDAY(DATE_ADD(eul.usageStartTime, INTERVAL 8 HOUR)) = :scheduleWeekday
             GROUP BY sessionDate
             ORDER BY sessionDate DESC`,
            { replacements: historyReplacements, type: QueryTypes.SELECT }
          )
        : [];
      const sessionCounts = new Map(sessionDateRows.map((item) => [item.sessionDate, Number(item.sessionCount || 0)]));
      const availableDates = buildPastScheduleDates(
        schedule.createdLocalDate,
        scheduleWeekday,
        getManilaDateKey(),
        sessionCounts
      );

      let historyBySet = new Map();
      if (/^\d{4}-\d{2}-\d{2}$/.test(dateFilter) && availableDates.some((item) => item.sessionDate === dateFilter)) {
        const sessions = await sequelize.query(
          `SELECT
             eul.id,
             eul.pcSetId AS setId,
             eul.userId,
             COALESCE(a.fullName, u.name) AS fullName,
             u.role AS userRole,
             DATE_FORMAT(eul.usageStartTime, '%Y-%m-%dT%H:%i:%sZ') AS startedAt,
             DATE_FORMAT(eul.usageEndTime, '%Y-%m-%dT%H:%i:%sZ') AS endedAt,
             COALESCE(
               eul.durationMinutes,
               GREATEST(ROUND(TIMESTAMPDIFF(SECOND, eul.usageStartTime, eul.usageEndTime) / 60), 1)
             ) AS durationMinutes
           FROM equipment_usage_logs eul
           INNER JOIN users u ON u.id = eul.userId
           LEFT JOIN attendance a ON a.id = eul.attendanceId
           WHERE BINARY eul.pcSetId IN (:stationSetIds)
             AND LOWER(TRIM(COALESCE(u.role, ''))) = 'student'
             AND ${scheduleSessionMatch}
             AND eul.usageStartTime >= :scheduleCreatedAt
             AND eul.usageStartTime < UTC_TIMESTAMP()
             AND eul.usageEndTime IS NOT NULL
             AND DATE(DATE_ADD(eul.usageStartTime, INTERVAL 8 HOUR)) = :sessionDate
             AND WEEKDAY(DATE_ADD(eul.usageStartTime, INTERVAL 8 HOUR)) = :scheduleWeekday
           ORDER BY eul.usageStartTime ASC, eul.id ASC`,
          { replacements: { ...historyReplacements, sessionDate: dateFilter }, type: QueryTypes.SELECT }
        );
        historyBySet = new Map();
        sessions.forEach((session) => {
          const key = String(session.setId);
          const records = historyBySet.get(key) || [];
          records.push({
            id: session.id,
            userId: session.userId,
            fullName: session.fullName,
            role: session.userRole,
            startTime: session.startedAt,
            endTime: session.endedAt,
            durationMinutes: Number(session.durationMinutes || 0),
          });
          historyBySet.set(key, records);
        });
      }

      const seatingChart = pcSets.map((pc) => ({
        setId: pc.setId,
        setName: pc.setName,
        location: pc.location,
        setStatus: pc.setStatus,
        components: pc.components,
        componentCount: pc.componentCount,
        sessions: historyBySet.get(String(pc.setId)) || [],
      }));
      const recordedSessions = [...historyBySet.values()].flat();
      const uniqueStudents = new Set(recordedSessions.map((session) => String(session.userId)));

      res.set({ "Cache-Control": "no-store, private" });
      return res.json({
        schedule: schedulePayload,
        sessionDates: availableDates,
        selectedDate: dateFilter || null,
        seatingChart,
        statistics: {
          totalPCs: pcSets.length,
          usedPCs: historyBySet.size,
          totalSessions: recordedSessions.length,
          totalStudents: uniqueStudents.size,
        },
      });
    }

    const activeSessions = stationSetIds.length
      ? await sequelize.query(
          `SELECT
             ps.setId,
             ps.activeUserId AS userId,
             DATE_FORMAT(ps.startedAt, '%Y-%m-%dT%H:%i:%sZ') AS startedAt,
             DATE_FORMAT(ps.autoLogoutAt, '%Y-%m-%dT%H:%i:%sZ') AS autoLogoutAt,
             u.name AS fullName,
             u.role AS userRole
           FROM pc_station_sessions ps
           LEFT JOIN users u ON u.id = ps.activeUserId
             AND LOWER(TRIM(REPLACE(COALESCE(u.campus, ''), ' Campus', ''))) = :campusName
           WHERE BINARY ps.setId IN (:stationSetIds)
             AND ps.activeUserId IS NOT NULL
             AND (ps.autoLogoutAt IS NULL OR ps.autoLogoutAt > UTC_TIMESTAMP())
           ORDER BY ps.startedAt DESC`,
          { replacements: { stationSetIds, campusName }, type: QueryTypes.SELECT }
        )
      : [];
    const activeSessionBySet = new Map(activeSessions.map((session) => [String(session.setId), session]));
    const studentSessions = activeSessions.filter((session) => String(session.userRole || '').trim().toLowerCase() === 'student');

    // The seat map reflects only currently signed-in users. Old attendance and
    // usage records remain available in attendance and PC logs, not as occupants.
    const seatingChart = pcSets.map((pc) => {
      const session = activeSessionBySet.get(String(pc.setId));

      return {
        setId: pc.setId,
        setName: pc.setName,
        location: pc.location,
        setStatus: pc.setStatus,
        components: pc.components,
        componentCount: pc.componentCount,
        status: session ? "occupied" : "available",
        student: session
          ? {
              id: session.userId,
              fullName: session.fullName,
              role: session.userRole,
              startTime: session.startedAt,
              autoLogoutAt: session.autoLogoutAt,
              isActive: true,
            }
          : null,
      };
    });

    res.set({ "Cache-Control": "no-store, private" });
    return res.json({
      schedule: schedulePayload,
      seatingChart,
      statistics: {
        totalPCs: pcSets.length,
        occupiedPCs: activeSessions.length,
        availablePCs: Math.max(0, pcSets.length - activeSessions.length),
        totalStudents: studentSessions.length,
      },
    });
  } catch (error) {
    console.error("Error fetching seating chart:", error);
    res.status(500).json({ error: "Failed to fetch seating chart" });
  }
}
