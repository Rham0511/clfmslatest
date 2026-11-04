import { Op, QueryTypes } from "sequelize";
import { Equipment, EquipmentCategory } from "../models/equipmentModel.js";
import { BorrowRecord } from "../models/borrowRecordModel.js";
import { LaboratorySchedule } from "../models/laboratoryScheduleModel.js";
import { MaintenanceRequest } from "../models/maintenanceRequestModel.js";
import EquipmentTechnicianReport from "../models/equipmentTechnicianReportModel.js";
import { User } from "../models/userModel.js";
import { sequelize } from "../models/db.js";
import { ensureArchiveRecordsTable } from "../models/archiveRecords.js";
import { ensurePCStationSessionsTable } from "../models/pcStationSessionModel.js";
import { getUserCampusFromSession } from "./campusAuthController.js";
import { logAuditEntry } from "./auditController.js";

const entityTypes = new Set([
  "equipment",
  "equipment-category",
  "computer-lab",
  "pc-set",
  "laboratory-schedule",
  "maintenance-report",
  "technician-report",
  "borrow-record",
  "borrow-request",
  "faculty-account"
]);
const entityTypeAliases = new Map([
  ["schedule", "laboratory-schedule"],
  ["borrow_request", "borrow-request"],
  ["maintenance", "maintenance-report"],
  ["technician-report", "technician-report"]
]);
const adminRoles = new Set(["admin", "administrator", "superadmin", "centraladmin", "systemadmin"]);

async function requireAdmin(req, res) {
  if (!req.session?.userId) {
    res.status(401).json({ error: "Please log in to manage archived records." });
    return false;
  }

  const user = await User.findByPk(req.session.userId, { attributes: ["role"] });
  if (!user || !adminRoles.has(String(user.role || "").trim().toLowerCase().replace(/[_-]+/g, ""))) {
    res.status(403).json({ error: "Only administrators can manage archived records." });
    return false;
  }
  return true;
}

async function findArchiveTarget(entityType, entityId) {
  switch (entityType) {
    case "equipment": {
      const item = await Equipment.findOne({
        where: { [Op.or]: [{ id: entityId }, { equipmentId: entityId }] }
      });
      return item && {
        id: String(item.equipmentId),
        title: `${item.equipmentId} — ${item.name}`,
        details: [
          item.category,
          item.serialNumber ? `Serial: ${item.serialNumber}` : null,
          item.location || item.laboratoryRoom || item.campus
        ].filter(Boolean).join(" · ")
      };
    }
    case "equipment-category": {
      const category = await EquipmentCategory.findByPk(entityId);
      return category && {
        id: String(category.id),
        title: category.name,
        details: `Equipment type prefix: ${category.prefix}`
      };
    }
    case "pc-set": {
      const rows = await sequelize.query(
        "SELECT setId, setName, location FROM equipment_sets WHERE BINARY setId = BINARY ? LIMIT 1",
        { replacements: [entityId], type: QueryTypes.SELECT }
      );
      const set = rows[0];
      return set && {
        id: String(set.setId),
        title: `${set.setId} — ${set.setName}`,
        details: set.location || "PC station"
      };
    }
    case "laboratory-schedule": {
      const schedule = await LaboratorySchedule.findByPk(entityId);
      return schedule && {
        id: String(schedule.id),
        title: schedule.subject,
        details: [
          schedule.section ? `Section: ${schedule.section}` : null,
          schedule.yearLevel ? `Year: ${schedule.yearLevel}` : null,
          schedule.campus,
          schedule.laboratoryRoom,
          `${schedule.dayOfWeek} ${schedule.startTime}-${schedule.endTime}`
        ].filter(Boolean).join(" · ")
      };
    }
    case "computer-lab": {
      const rows = await sequelize.query(
        `SELECT id, name, roomNumber, campus FROM computer_labs WHERE id = ? LIMIT 1`,
        { replacements: [entityId], type: QueryTypes.SELECT }
      );
      const lab = rows[0];
      return lab && {
        id: String(lab.id),
        title: lab.name,
        details: [lab.roomNumber || "Room/location not specified", lab.campus].filter(Boolean).join(" · ")
      };
    }
    case "faculty-account": {
      const faculty = await User.findOne({
        where: {
          id: entityId,
          role: { [Op.in]: ["faculty", "Faculty", "instructor", "Instructor"] }
        },
        attributes: ["id", "name", "email", "college", "campus"]
      });
      return faculty && {
        id: String(faculty.id),
        title: faculty.name,
        details: [faculty.email, faculty.college, faculty.campus].filter(Boolean).join(" · ")
      };
    }
    case "maintenance-report": {
      const report = await MaintenanceRequest.findByPk(entityId);
      return report && {
        id: String(report.id),
        title: report.issueTitle || `Issue report #${report.id}`,
        details: `${report.status} · ${report.description}`
      };
    }
    case "technician-report": {
      const report = await EquipmentTechnicianReport.findOne({
        where: { [Op.or]: [{ id: entityId }, { reportId: entityId }] }
      });
      return report && {
        id: String(report.id),
        title: report.reportId,
        details: `${report.reportType} · ${report.status} · ${report.technicianName || "Technician report"}`
      };
    }
    case "borrow-record":
    case "borrow-request": {
      const record = await BorrowRecord.findByPk(entityId);
      return record && {
        id: String(record.id),
        title: `${record.equipmentId} — ${record.equipmentName} (${record.borrowerName})`,
        details: [
          record.status,
          record.serialNumber ? `Serial: ${record.serialNumber}` : null,
          record.campus,
          record.purpose
        ].filter(Boolean).join(" · "),
        status: record.status
      };
    }
    default:
      return null;
  }
}

export async function listArchivedRecords(req, res) {
  try {
    if (!await requireAdmin(req, res)) return;
    await ensureArchiveRecordsTable();
    const archivedRecords = await sequelize.query(
      `SELECT id, entityType, entityId, title, details, archivedBy, archivedAt
       FROM archived_records
       ORDER BY archivedAt DESC, id DESC`,
      { type: QueryTypes.SELECT }
    );
    const records = await Promise.all(archivedRecords.map(async (record) => {
      const currentTarget = await findArchiveTarget(record.entityType, String(record.entityId));
      return {
        id: String(record.id),
        entityType: record.entityType,
        entityId: String(record.entityId),
        title: currentTarget?.title || record.title,
        details: currentTarget?.details || record.details,
        archivedAt: record.archivedAt
      };
    }));
    return res.json({ success: true, records });
  } catch (error) {
    console.error("Failed to list archived records:", error);
    return res.status(500).json({ error: "Failed to load archived records." });
  }
}

export async function getArchivedRecordsRevision(req, res) {
  try {
    if (!await requireAdmin(req, res)) return;
    await ensureArchiveRecordsTable();
    const rows = await sequelize.query(
      `SELECT COUNT(*) AS recordCount, COALESCE(MAX(id), 0) AS newestId,
              COALESCE(DATE_FORMAT(MAX(archivedAt), '%Y-%m-%d %H:%i:%s'), '') AS newestArchive
       FROM archived_records`,
      { type: QueryTypes.SELECT }
    );
    const revision = [rows[0]?.recordCount || 0, rows[0]?.newestId || 0, rows[0]?.newestArchive || ""].join(":");
    res.set("Cache-Control", "no-store");
    return res.json({ success: true, revision });
  } catch (error) {
    console.error("Failed to read archived records revision:", error);
    return res.status(500).json({ error: "Failed to check archived records for updates." });
  }
}

export async function archiveRecord(req, res) {
  const entityType = String(req.params.entityType || (req.params.id !== undefined ? "computer-lab" : ""));
  let archiveStage = "validating the request";
  try {
    let entityId = String(req.params.entityId ?? req.params.id ?? "").trim();
    if (!entityTypes.has(entityType) || !entityId || entityId.length > 191) {
      return res.status(400).json({ error: "A supported record type and valid record ID are required." });
    }

    if (entityType === "laboratory-schedule") {
      archiveStage = "authorizing the schedule archive";
      if (!req.session?.userId) {
        return res.status(401).json({ error: "Please log in to manage laboratory schedules." });
      }
      const user = await User.findByPk(req.session.userId, {
        attributes: ["id", "role", "campus"]
      });
      const role = String(user?.role || "").trim().toLowerCase().replace(/[_-]+/g, "");
      if (!user || !["faculty", "instructor"].includes(role)) {
        return res.status(403).json({ error: "Only the assigned faculty instructor can remove this schedule." });
      }
      const schedule = await LaboratorySchedule.findByPk(entityId);
      if (!schedule) return res.status(404).json({ error: "Record not found." });
      const isOwner = String(schedule.instructorUserId || "") === String(user.id);
      const userCampus = await getUserCampusFromSession(req);
      const normalizeCampus = (campus) => String(campus || "").trim().replace(/\s*Campus\s*$/i, "").toLowerCase();
      if (!isOwner || !normalizeCampus(userCampus) || normalizeCampus(userCampus) !== normalizeCampus(schedule.campus)) {
        return res.status(403).json({ error: "You can remove only schedules assigned to you at your campus." });
      }
    } else if (entityType === "technician-report") {
      archiveStage = "authorizing the technician report archive";
      if (!req.session?.userId) {
        return res.status(401).json({ error: "Please log in to archive technician reports." });
      }
      const user = await User.findByPk(req.session.userId, { attributes: ["id", "role"] });
      const role = String(user?.role || "").trim().toLowerCase();
      const report = await EquipmentTechnicianReport.findOne({
        where: { [Op.or]: [{ id: entityId }, { reportId: entityId }] },
        attributes: ["id", "technicianId"]
      });
      if (!report) return res.status(404).json({ error: "Technician report not found." });
      if (["technician", "laboratory technician", "lab technician"].includes(role)) {
        if (Number(report.technicianId) !== Number(user.id)) {
          return res.status(403).json({ error: "You can archive only your own technician reports." });
        }
      } else if (!adminRoles.has(role.replace(/[_-]+/g, ""))) {
        return res.status(403).json({ error: "Only the report owner or an administrator can archive technician reports." });
      }
      entityId = String(report.id);
    } else if (entityType === "faculty-account") {
      archiveStage = "authorizing the Faculty account archive";
      if (!await requireAdmin(req, res)) return;
      const admin = await User.findByPk(req.session.userId, { attributes: ["campus"] });
      const faculty = await User.findOne({
        where: {
          id: entityId,
          role: { [Op.in]: ["faculty", "Faculty", "instructor", "Instructor"] }
        },
        attributes: ["id", "campus"]
      });
      if (!faculty) return res.status(404).json({ error: "Faculty account not found." });
      const normalizeCampus = (campus) => String(campus || "").trim().replace(/\s*Campus\s*$/i, "").toLowerCase();
      if (!normalizeCampus(admin?.campus) || normalizeCampus(admin.campus) !== normalizeCampus(faculty.campus)) {
        return res.status(403).json({ error: "You can archive Faculty accounts only at your assigned campus." });
      }
    } else if (entityType === "computer-lab") {
      archiveStage = "validating the computer lab";
      const labId = Number(entityId);
      if (!/^\d+$/.test(entityId) || !Number.isSafeInteger(labId) || labId < 1) {
        const message = "A valid computer lab ID is required.";
        return res.status(400).json({ success: false, message, error: message });
      }
      entityId = String(labId);
      if (!await requireAdmin(req, res)) return;
      const rows = await sequelize.query(
        "SELECT campus FROM computer_labs WHERE id = ? LIMIT 1",
        { replacements: [labId], type: QueryTypes.SELECT }
      );
      const lab = rows[0];
      if (!lab) {
        const message = "Computer lab not found.";
        return res.status(404).json({ success: false, message, error: message });
      }
      const userCampus = await getUserCampusFromSession(req);
      const normalizeCampus = (campus) => String(campus || "").trim().replace(/\s*Campus\s*$/i, "").toLowerCase();
      if (!normalizeCampus(userCampus) || normalizeCampus(userCampus) !== normalizeCampus(lab.campus)) {
        return res.status(403).json({ error: "You can archive computer labs only at your assigned campus." });
      }
    } else if (!await requireAdmin(req, res)) {
      return;
    }

    archiveStage = "preparing the archive table";
    await ensureArchiveRecordsTable();
    archiveStage = "loading the record to archive";
    const target = await findArchiveTarget(entityType, entityId);
    if (!target) return res.status(404).json({ error: "Record not found." });

    if (
      ["borrow-record", "borrow-request"].includes(entityType) &&
      ["pending", "approved", "borrowed"].includes(String(target.status || "").trim().toLowerCase())
    ) {
      return res.status(409).json({ error: "An active borrow request or loan cannot be archived." });
    }

    if (entityType === "equipment") {
      archiveStage = "checking equipment dependencies";
      const equipment = await Equipment.findOne({ where: { equipmentId: target.id }, attributes: ["id", "setId"] });
      if (equipment?.setId) {
        return res.status(409).json({ error: "Remove the equipment from its PC set before archiving it." });
      }
      const activeBorrows = equipment
        ? await BorrowRecord.count({
            where: { equipmentRecordId: equipment.id, status: { [Op.in]: ["Pending", "Approved", "Borrowed"] } }
          })
        : 0;
      if (activeBorrows) {
        return res.status(409).json({ error: "Equipment with an active borrow cannot be archived." });
      }
    }
    if (entityType === "pc-set") {
      archiveStage = "checking PC station dependencies";
      const rows = await sequelize.query(
        "SELECT COUNT(*) AS componentCount FROM equipment WHERE BINARY setId = BINARY ?",
        { replacements: [target.id], type: QueryTypes.SELECT }
      );
      if (Number(rows[0]?.componentCount || 0) > 0) {
        return res.status(409).json({ error: "A PC set with components cannot be archived. Remove or move its components first." });
      }
      const activeSessions = await sequelize.query(
        "SELECT COUNT(*) AS activeCount FROM pc_station_sessions WHERE BINARY setId = BINARY ? AND activeUserId IS NOT NULL",
        { replacements: [target.id], type: QueryTypes.SELECT }
      );
      if (Number(activeSessions[0]?.activeCount || 0) > 0) {
        return res.status(409).json({ error: "A PC station with an active session cannot be archived." });
      }
    }

    if (entityType === "computer-lab") {
      archiveStage = "preparing PC station session checks";
      await ensurePCStationSessionsTable();
      const labId = Number(entityId);
      archiveStage = "checking active computer lab borrows";
      const [activeBorrowRows] = await sequelize.query(
        `SELECT COUNT(*) AS activeCount
         FROM borrow_records br
        INNER JOIN equipment e ON e.id = br.equipment_record_id
         WHERE e.computerLabId = ? AND br.status IN ('Pending', 'Approved', 'Borrowed')`,
        { replacements: [labId] }
      );
      if (Number(activeBorrowRows[0]?.activeCount || 0) > 0) {
        return res.status(409).json({ error: "This lab has equipment with active borrow requests or loans. Resolve them before archiving the lab." });
      }
      archiveStage = "checking active PC station sessions";
      const [activeSessionRows] = await sequelize.query(
        `SELECT COUNT(*) AS activeCount
         FROM pc_station_sessions ps
         INNER JOIN equipment_sets es ON BINARY es.setId = BINARY ps.setId
         WHERE es.computerLabId = ? AND ps.activeUserId IS NOT NULL`,
        { replacements: [labId] }
      );
      if (Number(activeSessionRows[0]?.activeCount || 0) > 0) {
        return res.status(409).json({ error: "This lab has a PC station with an active session. End the session before archiving the lab." });
      }

      archiveStage = "archiving linked computer lab records";
      await sequelize.transaction(async (transaction) => {
        const childTypes = [
          {
            entityType: "equipment",
            sql: `SELECT equipmentId AS entityId, CONCAT(equipmentId, ' — ', name) AS title,
                         CONCAT_WS(' · ', category, laboratoryRoom, campus) AS details
                  FROM equipment WHERE computerLabId = ?`
          },
          {
            entityType: "pc-set",
            sql: `SELECT setId AS entityId, CONCAT(setId, ' — ', setName) AS title, location AS details
                  FROM equipment_sets WHERE computerLabId = ?`
          },
          {
            entityType: "laboratory-schedule",
            sql: `SELECT id AS entityId, subject AS title,
                         CONCAT_WS(' · ', section, campus, laboratoryRoom, dayOfWeek, CONCAT(startTime, '-', endTime)) AS details
                  FROM laboratory_schedules WHERE computerLabId = ?`
          },
          {
            entityType: "maintenance-report",
            sql: `SELECT id AS entityId, COALESCE(issueTitle, CONCAT('Issue report #', id)) AS title,
                         CONCAT_WS(' · ', status, description) AS details
                  FROM maintenance_requests WHERE computerLabId = ?`
          },
          {
            entityType: "technician-report",
            sql: `SELECT id AS entityId, reportId AS title,
                         CONCAT_WS(' · ', reportType, status, technicianName) AS details
                  FROM equipment_technician_reports WHERE computerLabId = ?`
          }
        ];
        for (const childType of childTypes) {
          archiveStage = `loading linked ${childType.entityType} records`;
          const children = await sequelize.query(childType.sql, {
            replacements: [labId],
            type: QueryTypes.SELECT,
            transaction
          });
          for (const child of children) {
            archiveStage = `saving archived ${childType.entityType} records`;
            await sequelize.query(
              `INSERT INTO archived_records (entityType, entityId, title, details, archivedBy, parentEntityType, parentEntityId)
               VALUES (?, ?, ?, ?, ?, 'computer-lab', ?)
               ON DUPLICATE KEY UPDATE title = VALUES(title), details = VALUES(details), archivedBy = VALUES(archivedBy),
                 archivedAt = CURRENT_TIMESTAMP, parentEntityType = VALUES(parentEntityType), parentEntityId = VALUES(parentEntityId)`,
              {
                replacements: [childType.entityType, String(child.entityId), child.title || String(child.entityId), child.details || null, req.session.userId, String(labId)],
                type: QueryTypes.INSERT,
                transaction
              }
            );
          }
        }
        archiveStage = "saving the computer lab archive record";
        await sequelize.query(
          `INSERT INTO archived_records (entityType, entityId, title, details, archivedBy)
           VALUES (?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE title = VALUES(title), details = VALUES(details), archivedBy = VALUES(archivedBy), archivedAt = CURRENT_TIMESTAMP`,
          {
            replacements: [entityType, target.id, target.title, target.details, req.session.userId],
            type: QueryTypes.INSERT,
            transaction
          }
        );
      });

      archiveStage = "writing the computer lab archive audit entry";
      await logAuditEntry(req, {
        action: "Record Archived",
        module: "Archive",
        resourceId: target.id,
        description: `${entityType} ${target.title} and its linked records were archived.`,
        details: { entityType, entityId: target.id, cascade: true }
      });
      return res.json({ success: true, message: "Computer lab and its linked records were archived successfully." });
    }

    archiveStage = "saving the archive record";
    await sequelize.query(
      `INSERT INTO archived_records (entityType, entityId, title, details, archivedBy)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE title = VALUES(title), details = VALUES(details), archivedBy = VALUES(archivedBy), archivedAt = CURRENT_TIMESTAMP`,
      {
        replacements: [entityType, target.id, target.title, target.details, req.session.userId],
        type: QueryTypes.INSERT
      }
    );

    archiveStage = "writing the archive audit entry";
    await logAuditEntry(req, {
      action: "Record Archived",
      module: "Archive",
      resourceId: target.id,
      description: `${entityType} ${target.title} was archived.`,
      details: { entityType, entityId: target.id }
    });
    return res.json({ success: true, message: "Record archived successfully." });
  } catch (error) {
    console.error(`Failed to archive record while ${archiveStage}:`, error);
    if (entityType === "computer-lab") {
      console.error("=== ARCHIVE LAB ERROR ===", error);
      console.error("Error message:", error?.message);
      console.error("Error stack:", error?.stack);
    }
    const databaseErrorCode = error?.original?.code || error?.parent?.code || error?.code;
    if (
      entityType === "computer-lab" &&
      ["ER_BAD_FIELD_ERROR", "ER_NO_SUCH_TABLE"].includes(databaseErrorCode)
    ) {
      const message = "Computer lab archive setup is incomplete. Apply migrations 035–038 to the ComLab database, then retry.";
      return res.status(500).json({
        success: false,
        message,
        error: message
      });
    }
    const message = entityType === "computer-lab"
      ? `Unable to archive the computer lab while ${archiveStage}.`
      : "Failed to archive record.";
    const diagnosticMessage = databaseErrorCode ? `${message} (${databaseErrorCode})` : message;
    return res.status(500).json({
      success: false,
      message: diagnosticMessage,
      error: diagnosticMessage
    });
  }
}

export async function restoreArchivedRecord(req, res) {
  try {
    if (!await requireAdmin(req, res)) return;
    await ensureArchiveRecordsTable();

    await restoreArchiveEntry(req, req.params.archiveId);
    return res.json({ success: true, message: "Record restored successfully." });
  } catch (error) {
    console.error("Failed to restore archived record:", error);
    return res.status(error.statusCode || 500).json({ error: error.message || "Failed to restore archived record." });
  }
}

const archivedEntityDeleteTargets = {
  equipment: { table: "equipment", column: "equipmentId", binary: true },
  "faculty-account": { table: "users", column: "id" },
  "equipment-category": { table: "equipment_categories", column: "id" },
  "pc-set": { table: "equipment_sets", column: "setId", binary: true },
  "laboratory-schedule": { table: "laboratory_schedules", column: "id" },
  "maintenance-report": { table: "maintenance_requests", column: "id" },
  "technician-report": { table: "equipment_technician_reports", column: "reportId", binary: true },
  "borrow-record": { table: "borrow_records", column: "id" },
  "borrow-request": { table: "borrow_records", column: "id" }
};

async function permanentlyDeleteArchivedEntry(archiveId) {
  return sequelize.transaction(async (transaction) => {
    const rows = await sequelize.query(
      `SELECT id, entityType, entityId, title FROM archived_records WHERE id = ? LIMIT 1 FOR UPDATE`,
      { replacements: [archiveId], type: QueryTypes.SELECT, transaction }
    );
    const archived = rows[0];
    if (!archived) {
      const error = new Error("Archived record not found.");
      error.statusCode = 404;
      throw error;
    }

    if (archived.entityType === "computer-lab") {
      const labId = String(archived.entityId);
      const labRows = await sequelize.query(
        "SELECT id FROM computer_labs WHERE id = ? LIMIT 1 FOR UPDATE",
        { replacements: [labId], type: QueryTypes.SELECT, transaction }
      );
      if (!labRows.length) {
        const error = new Error("The original computer lab no longer exists.");
        error.statusCode = 409;
        throw error;
      }

      // Preserve linked records and their archive entries as standalone records.
      for (const table of [
        "equipment", "laboratory_schedules", "attendance_sessions", "attendance",
        "equipment_sets", "maintenance_requests", "missing_equipment_history",
        "equipment_usage_logs", "equipment_technician_reports", "equipment_inventory_checks"
      ]) {
        await sequelize.query(`UPDATE ${table} SET computerLabId = NULL WHERE computerLabId = ?`, {
          replacements: [labId], transaction
        });
      }
      await sequelize.query(
        `UPDATE archived_records SET parentEntityType = NULL, parentEntityId = NULL
         WHERE parentEntityType = 'computer-lab' AND parentEntityId = ?`,
        { replacements: [labId], transaction }
      );
      await sequelize.query("DELETE FROM computer_labs WHERE id = ?", {
        replacements: [labId], transaction
      });
    } else {
      const target = archivedEntityDeleteTargets[archived.entityType];
      if (!target) {
        const error = new Error("Permanent deletion is not supported for this archived record type.");
        error.statusCode = 400;
        throw error;
      }
      const comparison = target.binary ? `BINARY ${target.column} = BINARY ?` : `${target.column} = ?`;
      const recordRows = await sequelize.query(
        `SELECT ${target.column} FROM ${target.table} WHERE ${comparison} LIMIT 2 FOR UPDATE`,
        { replacements: [archived.entityId], type: QueryTypes.SELECT, transaction }
      );
      if (!recordRows.length) {
        const error = new Error("The original record no longer exists.");
        error.statusCode = 409;
        throw error;
      }
      if (recordRows.length > 1) {
        const error = new Error("This archived equipment ID is ambiguous. Resolve duplicate equipment IDs before deleting it.");
        error.statusCode = 409;
        throw error;
      }
      await sequelize.query(
        `DELETE FROM ${target.table} WHERE ${comparison}`,
        { replacements: [archived.entityId], transaction }
      );
    }

    await sequelize.query("DELETE FROM archived_records WHERE id = ?", {
      replacements: [archived.id], transaction
    });
    return archived;
  });
}

export async function deleteArchivedRecord(req, res) {
  try {
    if (!await requireAdmin(req, res)) return;
    await ensureArchiveRecordsTable();
    const archived = await permanentlyDeleteArchivedEntry(req.params.archiveId);
    await logAuditEntry(req, {
      action: "Archived Record Permanently Deleted",
      module: "Archive",
      resourceId: archived.entityId,
      description: `${archived.entityType} ${archived.title} was permanently deleted from the archive.`,
      details: { entityType: archived.entityType, entityId: archived.entityId }
    });
    return res.json({ success: true, message: "Archived record permanently deleted." });
  } catch (error) {
    console.error("Failed to permanently delete archived record:", error);
    const databaseErrorCode = error?.original?.code || error?.parent?.code || error?.code;
    if (["ER_ROW_IS_REFERENCED_2", "ER_ROW_IS_REFERENCED"].includes(databaseErrorCode)) {
      return res.status(409).json({
        error: "This record is still referenced by other data and cannot be permanently deleted yet."
      });
    }
    return res.status(error.statusCode || 500).json({
      error: error.message || "Failed to permanently delete archived record."
    });
  }
}

async function restoreArchiveEntry(req, archiveId) {
  const rows = await sequelize.query(
    "SELECT id, entityType, entityId, title FROM archived_records WHERE id = ? LIMIT 1",
    { replacements: [archiveId], type: QueryTypes.SELECT }
  );
  const archived = rows[0];
  if (!archived) {
    const error = new Error("Archived record not found.");
    error.statusCode = 404;
    throw error;
  }

  const target = await findArchiveTarget(archived.entityType, archived.entityId);
  if (!target) {
    const error = new Error("The original record no longer exists and cannot be restored.");
    error.statusCode = 409;
    throw error;
  }

  if (archived.entityType === "computer-lab") {
    await sequelize.transaction(async (transaction) => {
      await sequelize.query(
        "DELETE FROM archived_records WHERE parentEntityType = 'computer-lab' AND parentEntityId = ?",
        { replacements: [String(archived.entityId)], type: QueryTypes.DELETE, transaction }
      );
      await sequelize.query("DELETE FROM archived_records WHERE id = ?", {
        replacements: [archived.id],
        type: QueryTypes.DELETE,
        transaction
      });
    });
  } else {
    await sequelize.query("DELETE FROM archived_records WHERE id = ?", {
      replacements: [archived.id],
      type: QueryTypes.DELETE
    });
  }
  await logAuditEntry(req, {
    action: "Record Restored",
    module: "Archive",
    resourceId: archived.entityId,
    description: `${archived.entityType} ${archived.title} was restored from archive.`,
    details: { entityType: archived.entityType, entityId: archived.entityId }
  });
}

function normalizeArchiveType(type) {
  const normalizedType = String(type || "").trim().toLowerCase();
  return entityTypeAliases.get(normalizedType) || normalizedType;
}

async function restoreArchiveEntity(req, record) {
  const type = normalizeArchiveType(record?.type);
  const id = String(record?.id ?? "").trim();
  if (!entityTypes.has(type) || !id || id.length > 191) {
    const error = new Error("A supported record type and valid record ID are required.");
    error.statusCode = 400;
    throw error;
  }

  const rows = await sequelize.query(
    "SELECT id, entityType, entityId, title FROM archived_records WHERE entityType = ? AND BINARY entityId = BINARY ? LIMIT 1",
    { replacements: [type, id], type: QueryTypes.SELECT }
  );
  const archived = rows[0];
  if (!archived) {
    const error = new Error("Archived record not found.");
    error.statusCode = 404;
    throw error;
  }

  await restoreArchiveEntry(req, archived.id);
  return { id, type, title: archived.title };
}

export async function restoreArchivedRecordPayload(req, res) {
  try {
    if (!await requireAdmin(req, res)) return;
    await ensureArchiveRecordsTable();
    const restored = await restoreArchiveEntity(req, req.body);
    return res.json({
      success: true,
      message: `Record ${restored.id} restored successfully.`,
      record: restored
    });
  } catch (error) {
    console.error("Failed to restore archived record payload:", error);
    return res.status(error.statusCode || 500).json({
      error: error.message || "Failed to restore archived record."
    });
  }
}

export async function restoreArchivedRecordsPayload(req, res) {
  try {
    if (!await requireAdmin(req, res)) return;
    await ensureArchiveRecordsTable();
    const records = req.body?.records;
    if (!Array.isArray(records) || records.length === 0) {
      return res.status(400).json({ error: "Select at least one valid archived record." });
    }

    const results = [];
    for (const record of records) {
      try {
        results.push({ ...await restoreArchiveEntity(req, record), success: true });
      } catch (error) {
        console.error(`Failed to restore archived record ${record?.type}/${record?.id}:`, error);
        results.push({
          id: String(record?.id ?? ""),
          type: normalizeArchiveType(record?.type),
          success: false,
          error: error.message || "Failed to restore record."
        });
      }
    }

    const restoredRecords = results.filter((result) => result.success);
    const failures = results.filter((result) => !result.success);
    return res.json({
      success: true,
      message: `${restoredRecords.length} record${restoredRecords.length === 1 ? "" : "s"} restored successfully.`,
      restoredRecords,
      failures
    });
  } catch (error) {
    console.error("Failed to restore selected archived records:", error);
    return res.status(500).json({ error: "Failed to restore selected archived records." });
  }
}

export async function restoreArchivedRecords(req, res) {
  try {
    if (!await requireAdmin(req, res)) return;
    await ensureArchiveRecordsTable();

    const ids = req.body?.ids;
    if (!Array.isArray(ids) || ids.length === 0 || ids.some((id) => !/^\d+$/.test(String(id)))) {
      return res.status(400).json({ error: "Select at least one valid archived record." });
    }

    const uniqueIds = [...new Set(ids.map(String))];
    const archivedEntries = await sequelize.query(
      `SELECT id, entityType, entityId, parentEntityType, parentEntityId
       FROM archived_records WHERE id IN (:ids)`,
      { replacements: { ids: uniqueIds }, type: QueryTypes.SELECT }
    );
    const archivedById = new Map(archivedEntries.map((entry) => [String(entry.id), entry]));
    const restoredLabIds = new Set();
    const results = [];
    for (const id of uniqueIds) {
      const entry = archivedById.get(id);
      if (entry?.parentEntityType === "computer-lab" && restoredLabIds.has(String(entry.parentEntityId))) {
        results.push({ id, success: true });
        continue;
      }
      try {
        await restoreArchiveEntry(req, id);
        results.push({ id, success: true });
        if (entry?.entityType === "computer-lab") restoredLabIds.add(String(entry.entityId));
      } catch (error) {
        console.error(`Failed to restore archived record ${id}:`, error);
        results.push({ id, success: false, error: error.message || "Failed to restore record." });
      }
    }
    const restoredIds = results.filter((result) => result.success).map(({ id }) => id);
    const failures = results
      .filter((result) => !result.success)
      .map(({ id, error }) => ({ id, error }));

    return res.json({
      success: true,
      message: `${restoredIds.length} record${restoredIds.length === 1 ? "" : "s"} restored successfully.`,
      restoredIds,
      failures
    });
  } catch (error) {
    console.error("Failed to restore selected archived records:", error);
    return res.status(500).json({ error: "Failed to restore selected archived records." });
  }
}
