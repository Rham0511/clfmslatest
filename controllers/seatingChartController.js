import { sequelize } from "../models/db.js";
import { QueryTypes } from "sequelize";
import { User } from "../models/userModel.js";
import { LaboratorySchedule } from "../models/laboratoryScheduleModel.js";
import { canManageRecord } from "./campusAuthController.js";

/**
 * Get seating chart for a specific laboratory schedule session
 * Shows which students ACTUALLY ATTENDED and which PCs they're using
 * Based on real attendance records, not theoretical class enrollment
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
        section
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
    const todayInManila = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date());

    // 2. Get all students who ACTUALLY ATTENDED this schedule session (not just enrolled)
    // This shows real attendance, not theoretical class roster
    const students = await sequelize.query(
      `SELECT attendanceId, studentId, studentNumber, fullName, email, timeIn, status
       FROM (
         SELECT
           a.id as attendanceId,
           u.id as studentId,
           a.studentId as studentNumber,
           a.fullName as fullName,
           u.email,
           a.timeIn,
           a.status,
           ROW_NUMBER() OVER (
             PARTITION BY COALESCE(CAST(u.id AS CHAR), a.studentId)
             ORDER BY a.createdAt DESC, a.id DESC
           ) as rowNumber
         FROM attendance a
         LEFT JOIN users u ON u.student_number = a.studentId
         WHERE a.laboratoryScheduleId = ?
           AND a.date = ?
           AND a.timeIn IS NOT NULL
           AND a.timeIn <> 'Not recorded'
           AND a.status IN ('Present', 'Late')
       ) latestStudents
       WHERE rowNumber = 1
       ORDER BY fullName`,
      {
        replacements: [scheduleId, todayInManila],
        type: QueryTypes.SELECT
      }
    );

    const stationAttendance = await sequelize.query(
      `SELECT attendanceId, userId, setId, fullName, email, timeIn, status, scannedAt, isActive
       FROM (
         SELECT
           a.id AS attendanceId,
           u.id AS userId,
           a.pcStationSetId AS setId,
           COALESCE(NULLIF(a.fullName, ''), u.name) AS fullName,
           u.email,
           a.timeIn,
           a.status,
           a.createdAt AS scannedAt,
           CASE WHEN ps.activeUserId = u.id THEN 1 ELSE 0 END AS isActive,
           ROW_NUMBER() OVER (
             PARTITION BY a.pcStationSetId
             ORDER BY a.createdAt DESC, a.id DESC
           ) AS rowNumber
         FROM attendance a
         LEFT JOIN users u ON u.student_number = a.studentId
         LEFT JOIN pc_station_sessions ps ON BINARY ps.setId = BINARY a.pcStationSetId
         WHERE a.laboratoryScheduleId = ?
           AND a.date = ?
           AND a.pcStationSetId IS NOT NULL
           AND a.timeIn IS NOT NULL
           AND a.timeIn <> 'Not recorded'
           AND a.status IN ('Present', 'Late')
       ) latestStationAttendance
       WHERE rowNumber = 1
       ORDER BY scannedAt DESC`,
      { replacements: [scheduleId, todayInManila], type: QueryTypes.SELECT }
    );

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

    // 4. Get PC assignments ONLY for students enrolled in this schedule
    // Must have attendance record linked to this schedule
    const assignments = await sequelize.query(
      `SELECT 
        eul.id,
        eul.userId,
        eul.equipmentId,
        eul.serialNumber,
        eul.usageStartTime,
        eul.usageEndTime,
        eul.attendanceId,
        e.setId,
        COALESCE(NULLIF(a.fullName, ''), u.name) as fullName,
        u.email,
        a.studentId,
        ats.expiresAt,
        a.laboratoryScheduleId
      FROM equipment_usage_logs eul
      JOIN users u ON eul.userId = u.id
      JOIN equipment e ON eul.equipmentId = e.id
      JOIN attendance a ON eul.attendanceId = a.id
      LEFT JOIN attendance_sessions ats ON ats.token = a.sessionToken
      JOIN equipment_sets es ON BINARY es.setId = BINARY e.setId
      INNER JOIN equipment setCampusEquipment ON BINARY setCampusEquipment.setId = BINARY es.setId
        AND LOWER(TRIM(REPLACE(setCampusEquipment.campus, ' Campus', ''))) = ?
      WHERE es.status = 'active'
        AND UPPER(REPLACE(REPLACE(TRIM(es.location), ' ', ''), '-', '')) = ?
        AND e.setId IS NOT NULL
        AND a.laboratoryScheduleId = ?
        AND a.date = ?
      ORDER BY eul.usageStartTime DESC, eul.id DESC`,
      {
        replacements: [campusName, `COMLAB${labNumber}`, scheduleId, todayInManila],
        type: QueryTypes.SELECT
      }
    );

    // 5. Map assignments to PC sets
    // Build a map of PC assignments (setId -> assignment)
    const pcAssignmentMap = {};
    stationAttendance.forEach((assignment) => {
      if (assignment.setId && !pcAssignmentMap[assignment.setId]) {
        pcAssignmentMap[assignment.setId] = {
          ...assignment,
          usageStartTime: assignment.scannedAt,
          attendanceStation: true
        };
      }
    });
    assignments.forEach((assignment) => {
      if (assignment.setId && !pcAssignmentMap[assignment.setId]) {
        pcAssignmentMap[assignment.setId] = assignment;
      }
    });

    // 6. Build seating chart data structure
    const seatingChart = pcSets.map((pc) => {
      const assignment = pcAssignmentMap[pc.setId];

      return {
        setId: pc.setId,
        setName: pc.setName,
        location: pc.location,
        setStatus: pc.setStatus,
        components: pc.components,
        componentCount: pc.componentCount,
        status: assignment ? "occupied" : "available",
        student: assignment
          ? {
              id: assignment.userId,
              fullName: assignment.fullName,
              email: assignment.email,
              startTime: assignment.usageStartTime,
              isActive: assignment.attendanceStation
                ? Boolean(Number(assignment.isActive))
                : assignment.usageEndTime === null &&
                  assignment.expiresAt &&
                  new Date(assignment.expiresAt) > new Date(),
              attendanceStatus: assignment.status || null,
              scannedAt: assignment.scannedAt || null,
            }
          : null,
      };
    });

    // 7. Get list of students who ATTENDED but are NOT assigned to any PC
    const assignedUserIds = new Set([...assignments, ...stationAttendance].map(a => String(a.userId)).filter(Boolean));
    const unassignedStudents = students.filter(
      (student) => !assignedUserIds.has(String(student.studentId || ''))
    );

    // 8. Return comprehensive seating chart with ACTUAL ATTENDANCE stats
    res.json({
      schedule: {
        id: schedule.id,
        subject: schedule.subject,
        day: schedule.dayOfWeek,
        time: `${schedule.startTime} - ${schedule.endTime}`,
        room: schedule.laboratoryRoom,
        instructor: schedule.instructor,
        campus: schedule.campus,
        yearLevel: schedule.yearLevel,
        section: schedule.section,
      },
      seatingChart,
      statistics: {
        totalPCs: pcSets.length,
        occupiedPCs: seatingChart.filter((pc) => pc.student?.isActive).length,
        availablePCs: seatingChart.filter((pc) => !pc.student?.isActive).length,
        totalStudents: students.length, // Students who actually attended this session
        assignedStudents: students.length - unassignedStudents.length,
        unassignedStudents: unassignedStudents.length,
      },
      unassignedStudents: unassignedStudents.map((s) => ({
        id: s.studentId,
        fullName: s.fullName,
        email: s.email,
        timeIn: s.timeIn,
        hasPC: false,
      })),
    });
  } catch (error) {
    console.error("Error fetching seating chart:", error);
    res.status(500).json({ error: "Failed to fetch seating chart" });
  }
}
