/*
    MIT License
    
    Copyright (c) 2025 Christian I. Cabrera || XianFire Framework
    Mindoro State University - Philippines

    Permission is hereby granted, free of charge, to any person obtaining a copy
    of this software and associated documentation files (the "Software"), to deal
    in the Software without restriction, including without limitation the rights
    to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
    copies of the Software, and to permit persons to whom the Software is
    furnished to do so, subject to the following conditions:

    The above copyright notice and this permission notice shall be included in all
    copies or substantial portions of the Software.

    THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
    IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
    FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
    AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
    LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
    OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
    SOFTWARE.
*/

import { DataTypes, Op } from "sequelize";
import { MaintenanceRequest, sequelize } from "../models/maintenanceRequestModel.js";
import { User } from "../models/userModel.js";
import { Equipment } from "../models/equipmentModel.js";
import { logAuditEntry } from "./auditController.js";
import { getUserCampusFromSession, canManageRecord } from "./campusAuthController.js";
import EquipmentAuditTrail from "../models/equipmentAuditTrailModel.js";
import { getArchivedEntityIds } from "../models/archiveRecords.js";

const normalizeStatus = (status) => {
  const normalized = (status || "").toString().trim();
  if (!normalized) return "Pending";

  const value = normalized.toLowerCase();
  if (["pending", "new"].includes(value)) return "Pending";
  if (["under repair", "in progress", "in-progress", "repair", "working"].includes(value)) return "In Progress";
  if (["fixed", "resolved", "done", "complete"].includes(value)) return "Resolved";
  if (["rejected", "declined", "cancelled", "canceled"].includes(value)) return "Rejected";
  return normalized;
};

const ensureMaintenanceRequestColumns = async () => {
  try {
    const queryInterface = sequelize.getQueryInterface();
    const tableDefinition = await queryInterface.describeTable("maintenance_requests");

    if (!tableDefinition.resolvedBy) {
      await queryInterface.addColumn("maintenance_requests", "resolvedBy", {
        type: DataTypes.STRING,
        allowNull: true
      });
    }

    if (!tableDefinition.serialNumber) {
      await queryInterface.addColumn("maintenance_requests", "serialNumber", {
        type: DataTypes.STRING(100),
        allowNull: true
      });
      try {
        await sequelize.query("CREATE INDEX idx_maintenance_requests_serialNumber ON maintenance_requests (serialNumber)");
      } catch (indexError) {
        if (!/duplicate|exists/i.test(String(indexError.message || ""))) {
          console.warn("Serial number index could not be created:", indexError.message);
        }
      }
    }
    await sequelize.query(`
      UPDATE maintenance_requests mr
      INNER JOIN equipment e ON e.equipmentId = mr.equipmentId
      SET mr.serialNumber = e.serialNumber
      WHERE (mr.serialNumber IS NULL OR mr.serialNumber = '')
        AND e.serialNumber IS NOT NULL
        AND e.serialNumber <> ''
    `);

    if (tableDefinition.status) {
      try {
        await queryInterface.changeColumn("maintenance_requests", "status", {
          type: DataTypes.STRING,
          allowNull: false,
          defaultValue: "Pending"
        });
      } catch (changeError) {
        try {
          await sequelize.query('ALTER TABLE maintenance_requests MODIFY COLUMN status VARCHAR(255) NOT NULL DEFAULT "Pending"');
        } catch (sqlError) {
          console.warn("Status column could not be altered via SQL fallback:", sqlError.message);
        }
      }
    }
  } catch (error) {
    console.warn("Unable to ensure maintenance request columns:", error.message);
  }
};

const ensureMaintenanceTables = async () => {
  await Promise.all([
    User.sync({ force: false, alter: false, logging: false }),
    Equipment.sync({ force: false, alter: false, logging: false }),
    MaintenanceRequest.sync({ force: false, alter: false, logging: false })
  ]);
};

const getCampusVariants = (campus) => {
  const normalizedCampus = String(campus || "").trim();
  const campusName = normalizedCampus.replace(/\s*Campus\s*$/i, "").trim();
  return [...new Set([normalizedCampus, campusName, `${campusName} Campus`].filter(Boolean))];
};

const getStudentReportAccessForEquipment = async (student, equipmentId) => {
  const equipmentIdentifier = String(equipmentId || "").trim();

  if (!student) {
    return {
      canSubmitReport: false,
      attendanceStatus: "Invalid",
      attendanceMessage: "User account could not be verified."
    };
  }

  if (!equipmentIdentifier) {
    return {
      canSubmitReport: false,
      attendanceStatus: "Invalid",
      attendanceMessage: "Enter an equipment ID to verify the equipment."
    };
  }

  const studentCampus = String(student.campus || "").trim();
  if (!studentCampus) {
    return {
      canSubmitReport: false,
      attendanceStatus: "Invalid",
      attendanceMessage: "Report Not Allowed: Your account does not have a campus assigned."
    };
  }

  const equipment = await Equipment.findOne({
    where: {
      equipmentId: equipmentIdentifier,
      campus: { [Op.in]: getCampusVariants(studentCampus) }
    }
  });

  if (!equipment) {
    return {
      canSubmitReport: false,
      attendanceStatus: "Invalid",
      attendanceMessage: "Equipment not found. Please enter a valid equipment ID."
    };
  }

  const equipmentCampus = String(equipment.campus || "").trim();
  if (studentCampus && equipmentCampus && !canManageRecord(studentCampus, equipmentCampus)) {
    return {
      canSubmitReport: false,
      attendanceStatus: "Invalid",
      attendanceMessage: `Report Not Allowed: This equipment belongs to another campus. You can only report equipment from ${studentCampus} Campus.`
    };
  }

  return {
    canSubmitReport: true,
    attendanceStatus: "Not required",
    attendanceMessage: `Equipment: ${equipment.name} (${equipment.equipmentId}) | Campus: ${equipment.campus} | Status: ${equipment.status || "Available"} | Students may report issues at any time.`,
    equipmentMeta: {
      equipmentId: equipment.equipmentId,
      name: equipment.name,
      campus: equipment.campus,
      status: equipment.status || "Available",
      reportStatus: "Allowed"
    }
  };
};

const getStudentMaintenanceContext = async (req, equipmentId = null) => {
  if (!req.session?.userId) return null;

  await ensureMaintenanceTables();

  const student = await User.findByPk(req.session.userId, {
    attributes: ["id", "name", "student_number", "campus", "role", "email"]
  });
  const studentCampus = String(student?.campus || "").trim();
  const archivedEquipmentIds = await getArchivedEntityIds("equipment");
  const equipmentRows = studentCampus
    ? await Equipment.findAll({
        where: {
          equipmentId: { [Op.notIn]: archivedEquipmentIds },
          campus: { [Op.in]: getCampusVariants(studentCampus) }
        },
        attributes: ["equipmentId", "name", "laboratoryRoom"],
        order: [["name", "ASC"], ["equipmentId", "ASC"]]
      })
    : [];
  const equipment = equipmentRows.map((item) => ({
    equipmentId: item.equipmentId,
    name: item.name,
    laboratoryRoom: item.laboratoryRoom || null
  }));

  const studentIdentifier = student?.student_number || String(req.session.userId);
  const role = String(student?.role || "").trim().toLowerCase();
  const isFaculty = role === "faculty" || role === "instructor";
  const attendanceContext = isFaculty
    ? {
        canSubmitReport: false,
        attendanceStatus: "Not required",
        attendanceMessage: "Faculty reports do not require student attendance."
      }
    : await getStudentReportAccessForEquipment(student, equipmentId);

  return {
    student,
    studentId: studentIdentifier,
    studentName: student?.name || "Student",
    equipment,
    ...attendanceContext
  };
};

export const getStudentMaintenanceContextRoute = async (req, res) => {
  if (!req.session?.userId) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const equipmentId = String(req.query.equipmentId || req.query.equipment_id || "").trim();

  try {
    const context = await getStudentMaintenanceContext(req, equipmentId);
    const role = String(context?.student?.role || "").trim().toLowerCase();
    if (!["student", "faculty", "instructor"].includes(role)) {
      return res.status(403).json({ error: "Student or Faculty access is required." });
    }

    let equipmentMeta = context?.equipmentMeta || null;
    let canSubmitReport = context?.canSubmitReport || false;
    let attendanceStatus = context?.attendanceStatus || "Invalid";
    let attendanceMessage = context?.attendanceMessage || "Unable to verify equipment report access.";

    if (role === "faculty" || role === "instructor") {
      const equipment = context?.equipment?.find((item) => String(item.equipmentId) === equipmentId);
      equipmentMeta = equipment ? {
        equipmentId: equipment.equipmentId,
        name: equipment.name,
        campus: context?.student?.campus || null,
        reportStatus: "Allowed"
      } : null;
      canSubmitReport = Boolean(equipmentMeta);
      attendanceStatus = "Not required";
      attendanceMessage = equipmentMeta
        ? `Faculty access verified | Campus: ${equipmentMeta.campus}`
        : "Select equipment assigned to your campus.";
    }

    return res.json({
      success: true,
      studentId: context?.studentId || null,
      studentName: context?.studentName || null,
      equipment: context?.equipment || [],
      equipmentMeta,
      canSubmitReport,
      attendanceStatus,
      attendanceMessage
    });
  } catch (error) {
    console.error("Failed to load student maintenance context:", error);
    return res.status(500).json({ error: "Unable to load equipment." });
  }
};

export const createMaintenanceRequest = async (req, res) => {
  if (!req.session?.userId) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const { equipmentId, equipment_id, description, damageDescription, category, priority, source } = req.body;
  const resolvedEquipmentId = String(equipmentId || equipment_id || "").trim();
  const resolvedDescription = (description || damageDescription || "").toString().trim();

  if (!resolvedEquipmentId || !resolvedDescription) {
    return res.status(400).json({ error: "Equipment and damage description are required." });
  }
  if (resolvedDescription.length > 3000) {
    return res.status(400).json({ error: "The issue description must be 3,000 characters or fewer." });
  }
  if (priority && !["Low", "Medium", "High", "Critical"].includes(priority)) {
    return res.status(400).json({ error: "Priority must be Low, Medium, High, or Critical." });
  }

  try {
    console.log('[maintenance] report creation request');
    await ensureMaintenanceTables();
    await ensureMaintenanceRequestColumns();

    const student = await User.findByPk(req.session.userId, {
      attributes: ["id", "name", "student_number", "campus", "role", "email"]
    });
    if (!student) {
      return res.status(401).json({ error: "User account could not be verified." });
    }

    const role = String(student.role || "").trim().toLowerCase();
    const isFaculty = role === "faculty" || role === "instructor";
    if (role !== "student" && !isFaculty) {
      return res.status(403).json({ error: "Only Students and Faculty may report equipment issues." });
    }

    const studentCampus = String(student.campus || "").trim();
    if (!studentCampus) {
      return res.status(403).json({ error: "Report Not Allowed: Your account does not have a campus assigned." });
    }

    const equipment = await Equipment.findOne({
      where: {
        equipmentId: resolvedEquipmentId,
        campus: { [Op.in]: getCampusVariants(studentCampus) }
      }
    });
    if (!equipment) {
      return res.status(404).json({ error: "Equipment not found in your campus." });
    }

    if (studentCampus && String(equipment.campus || "").trim() && !canManageRecord(studentCampus, equipment.campus)) {
      return res.status(403).json({
        error: `Report Not Allowed: This equipment belongs to another campus. You can only report equipment from ${studentCampus} Campus.`
      });
    }

    if (!isFaculty) {
      const attendanceCheck = await getStudentReportAccessForEquipment(student, resolvedEquipmentId);
      if (!attendanceCheck.canSubmitReport) {
        return res.status(403).json({
          error: attendanceCheck.attendanceMessage || "Unable to verify equipment report access."
        });
      }
    }

    const reportCategory = ["Equipment Damage", "Equipment Missing", "Connectivity", "Other"].includes(category)
      ? category
      : "Equipment Damage";
    const reportPriority = ["Low", "Medium", "High", "Critical"].includes(priority) ? priority : "Medium";
    const equipmentCampus = equipment?.campus || "Main";
    const maintenance = await MaintenanceRequest.create({
      student_id: req.session?.userId || null,
      student_name: student.name || null,
      equipment_id: resolvedEquipmentId,
      serialNumber: equipment.serialNumber || null,
      laboratory_id: null,
      subject_id: null,
      instructor_id: null,
      laboratory_room: equipment?.laboratoryRoom || null,
      subject: null,
      instructor: null,
      equipmentId: resolvedEquipmentId,
      reportedBy: req.session?.userId || null,
      campus: equipmentCampus,
      issueTitle: `${reportCategory}: ${resolvedEquipmentId}`,
      description: resolvedDescription,
      category: reportCategory,
      priority: reportPriority,
      status: "Pending",
      dateReported: new Date()
    });

    const auditRole = isFaculty ? "faculty" : "student";
    try {
      await EquipmentAuditTrail.create({
        equipmentId: equipment.id,
        serialNumber: equipment.serialNumber || null,
        actionType: "equipment_issue_reported",
        actionDescription: `${reportCategory} reported for ${equipment.name || resolvedEquipmentId} (${resolvedEquipmentId}) by ${student.name || `user #${student.id}`} (${auditRole})${source === "qr_scan" ? " after QR scan" : ""}.`,
        performedBy: student.id,
        performedByName: student.name || null,
        userRole: auditRole,
        ipAddress: req.ip || null,
        userAgent: req.get("user-agent") || null,
        beforeState: null,
        afterState: {
          maintenanceRequestId: maintenance.id,
          equipmentId: resolvedEquipmentId,
          category: reportCategory,
          priority: reportPriority,
          reporterId: student.id,
          reporterName: student.name || null,
          reporterRole: auditRole,
          source: source === "qr_scan" ? "qr_scan" : "report_form",
          description: resolvedDescription
        },
        actionTimestamp: new Date()
      });
    } catch (auditError) {
      console.error("[maintenance] Report was created but its equipment audit event could not be recorded:", auditError);
    }

    try {
      const total = await MaintenanceRequest.count({ where: { equipmentId: resolvedEquipmentId, description: resolvedDescription } });
      console.log('[maintenance] created report ID', maintenance.id);
      console.log('[maintenance] total records inserted', total);
    } catch (countErr) {
      console.log('[maintenance] created report ID', maintenance.id);
      console.warn('[maintenance] unable to count similar records:', countErr.message);
    }

    await logAuditEntry(req, {
      action: "Maintenance Request Created",
      module: "Maintenance Monitoring",
      resourceId: maintenance.id,
      description: `Maintenance request created for equipment ${resolvedEquipmentId}.`,
      details: {
        maintenanceId: maintenance.id,
        equipmentId: resolvedEquipmentId,
        issueTitle: maintenance.issueTitle,
        reportedBy: req.session?.userId || null
      }
    });

    return res.status(201).json({
      success: true,
      message: "Equipment report submitted successfully.",
      data: maintenance
    });
  } catch (error) {
    console.error("Failed to create maintenance request:", error);
    return res.status(500).json({
      error: "Failed to create maintenance request.",
      details: error.message || "Unknown error"
    });
  }
};

export const getMaintenanceHistoryForEquipment = async (req, res) => {
  const { equipmentId } = req.params;

  try {
    await ensureMaintenanceTables();
    await ensureMaintenanceRequestColumns();

    const equipment = await Equipment.findOne({
      where: {
        [Op.or]: [
          { equipmentId },
          { serialNumber: equipmentId }
        ]
      },
      attributes: ["id", "equipmentId", "serialNumber", "name", "campus"]
    });

    if (!equipment) {
      return res.status(404).json({ error: "Equipment not found." });
    }

    const userCampus = await getUserCampusFromSession(req);
    if (userCampus && !canManageRecord(userCampus, equipment.campus)) {
      return res.status(403).json({ error: "You do not have permission to view this equipment." });
    }

    const records = await MaintenanceRequest.findAll({
      where: {
        id: { [Op.notIn]: await getArchivedEntityIds("maintenance-report") },
        [Op.or]: [
          { equipmentId: equipment.equipmentId },
          ...(equipment.serialNumber ? [{ serialNumber: equipment.serialNumber }] : [])
        ]
      },
      order: [["created_at", "DESC"]],
      attributes: [
        "id", "equipmentId", "serialNumber", "issueTitle", "description",
        "category", "priority", "status", "technicianNotes", "resolvedBy",
        "dateReported", "dateResolved"
      ]
    });

    return res.json({
      success: true,
      equipment: equipment.toJSON(),
      records
    });
  } catch (error) {
    console.error("Failed to load equipment maintenance history:", error);
    return res.status(500).json({ error: "Failed to load equipment maintenance history." });
  }
};

const buildMaintenanceWhereClause = (req, extra = {}) => {
  const role = String(req.session?.userRole || "").toLowerCase();
  const userId = req.session?.userId;
  const userCampus = req.session?.userCampus;
  const whereClause = { ...extra };

  // Normalize the user campus before filtering so campus aliases like
  // "Bongabong" and "Bongabong Campus" match the stored report campus values.
  if (userCampus) {
    const aliases = new Set();
    const values = [String(userCampus).trim()];
    values.forEach((value) => {
      if (!value) return;
      aliases.add(value);
      const noCampus = value.replace(/\s*campus\s*$/i, '').trim();
      if (noCampus) aliases.add(noCampus);
      if (noCampus) aliases.add(`${noCampus} Campus`);
      if (value !== noCampus) aliases.add(value.replace(/\s*campus\s*$/i, '').trim());
    });

    const campusValues = Array.from(aliases).filter(Boolean);
    if (campusValues.length) {
      whereClause.campus = { [Op.in]: campusValues };
    }
  }

  if (role === "technician") {
    return whereClause;
  }

  if (role === "student" || role === "faculty" || role === "instructor") {
    whereClause[Op.or] = [
      { student_id: userId },
      { reportedBy: userId }
    ];
  }

  return whereClause;
};

export const getAllMaintenanceRequests = async (req, res) => {
  if (!req.session?.userId) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const { status, priority, equipmentId, unassigned } = req.query;

  try {
    await ensureMaintenanceTables();
    await ensureMaintenanceRequestColumns();

    const whereClause = buildMaintenanceWhereClause(req);
    whereClause.id = { [Op.notIn]: await getArchivedEntityIds("maintenance-report") };

    if (priority) whereClause.priority = priority;
    if (equipmentId) whereClause.equipmentId = equipmentId;
    if (unassigned === "true") whereClause.assignedTo = null;

    const records = await MaintenanceRequest.findAll({
      where: whereClause,
      order: [["created_at", "DESC"]],
      include: [
        {
          model: User,
          as: "reporter",
          attributes: ["id", "name", "email", "role", "program", "year", "section", "college"]
        },
        {
          model: User,
          as: "technician",
          attributes: ["id", "name", "email"]
        },
        {
          model: Equipment,
          as: "equipment",
          attributes: ["equipmentId", "name", "campus", "laboratoryRoom", "location", "status"]
        }
      ]
    });

    console.log('[maintenance] dashboard query result count', Array.isArray(records) ? records.length : 0);

    // Deduplicate by primary key in case JOINs or unexpected relations produced duplicate rows
    const uniqueMap = new Map();
    (records || []).forEach((r) => {
      const id = r && (r.id || (r.toJSON && r.toJSON().id));
      if (id != null && !uniqueMap.has(id)) uniqueMap.set(id, r);
    });
    const uniqueRecords = Array.from(uniqueMap.values());
    console.log('[maintenance] unique report IDs', uniqueRecords.map(r => r.id));

    const filtered = uniqueRecords.filter((record) => {
      const currentStatus = normalizeStatus(record.status);
      if (status) return currentStatus === normalizeStatus(status);
      return true;
    });

    const fallbackReporterIds = [...new Set(filtered
      .filter((record) => (
        !record.reporter?.program ||
        !record.reporter?.year ||
        !record.reporter?.section ||
        !record.reporter?.college
      ))
      .flatMap((record) => [record.student_id, record.reportedBy])
      .map(Number)
      .filter((id) => Number.isInteger(id) && id > 0))];
    const fallbackReporters = fallbackReporterIds.length
      ? await User.findAll({
          where: { id: { [Op.in]: fallbackReporterIds } },
          attributes: ["id", "name", "email", "role", "program", "year", "section", "college"]
        })
      : [];
    const fallbackReportersById = new Map(fallbackReporters.map((reporter) => {
      const data = reporter.toJSON();
      return [Number(data.id), data];
    }));

    const pendingCount = filtered.filter(r => normalizeStatus(r.status) === 'Pending').length;
    console.log('[maintenance] pending count', pendingCount);

    const formatted = filtered.map((record) => {
      const data = record.toJSON();
      const linkedReporter = data.reporter || null;
      const studentReporter = fallbackReportersById.get(Number(data.reportedBy)) ||
        fallbackReportersById.get(Number(data.student_id)) ||
        null;
      const reporter = linkedReporter || studentReporter;
      const normalizedStatus = normalizeStatus(data.status);
      const timestamp = data.created_at || data.createdAt || data.dateReported;
      const equipmentStatus = data.equipment?.status || data.equipmentStatus || "Serviceable";
      const recordCampus = data.campus || data.equipment?.campus || null;

      return {
        ...data,
        status: normalizedStatus,
        campus: recordCampus,
        equipmentStatus,
        reporter,
        reporterName: reporter?.name || data.student_name || "Guest Student",
        reporterEmail: reporter?.email || null,
        reporterRole: reporter?.role || null,
        reporterProgram: linkedReporter?.program || studentReporter?.program || null,
        reporterYear: linkedReporter?.year || studentReporter?.year || null,
        reporterSection: linkedReporter?.section || studentReporter?.section || null,
        reporterCollege: linkedReporter?.college || studentReporter?.college || null,
        technicianName: data.technician?.name || null,
        technicianEmail: data.technician?.email || null,
        equipmentName: data.equipment?.name || data.equipment_id || "Unknown Equipment",
        equipmentId: data.equipment_id || data.equipmentId || null,
        laboratoryRoom: data.equipment?.laboratoryRoom || data.laboratory_room || null,
        equipmentLocation: data.equipment?.location || null,
        resolvedBy: data.resolvedBy || null,
        resolvedDate: data.dateResolved || null,
        dateReported: data.dateReported || data.created_at || data.createdAt || null,
        date: timestamp
      };
    });

    return res.json(formatted);
  } catch (error) {
    console.error("Failed to load maintenance requests:", error);
    return res.status(500).json({ error: "Failed to load maintenance requests." });
  }
};

export const getMaintenanceRequestById = async (req, res) => {
  const { id } = req.params;

  if (!req.session?.userId) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    await ensureMaintenanceTables();
    await ensureMaintenanceRequestColumns();

    const maintenance = await MaintenanceRequest.findOne({
      where: { id: { [Op.eq]: id, [Op.notIn]: await getArchivedEntityIds("maintenance-report") } },
      include: [
        {
          model: User,
          as: "reporter",
          attributes: ["id", "name", "email"]
        },
        {
          model: User,
          as: "technician",
          attributes: ["id", "name", "email"]
        },
        {
          model: Equipment,
          as: "equipment",
          attributes: ["equipmentId", "name", "campus", "status"]
        }
      ]
    });

    if (!maintenance) {
      return res.status(404).json({ error: "Maintenance request not found." });
    }

    // Campus-based authorization check
    const userCampus = req.session?.userCampus;
    if (!userCampus || !canManageRecord(userCampus, maintenance.campus)) {
      return res.status(403).json({ error: "You do not have permission to view this maintenance request." });
    }

    const data = maintenance.toJSON();
    const role = String(req.session?.userRole || "").toLowerCase();
    if (
      !["admin", "technician"].includes(role) &&
      Number(data.reportedBy || data.student_id) !== Number(req.session.userId)
    ) {
      return res.status(403).json({ error: "You do not have permission to view this maintenance request." });
    }

    return res.json({
      ...data,
      status: normalizeStatus(data.status),
      campus: data.campus || data.equipment?.campus || null,
      equipmentStatus: data.equipment?.status || "Serviceable",
      reporterName: data.reporter?.name || data.student_name || "Guest Student",
      technicianName: data.technician?.name || null,
      equipmentName: data.equipment?.name || data.equipment_id || "Unknown Equipment"
    });
  } catch (error) {
    console.error("Failed to retrieve maintenance request:", error);
    return res.status(500).json({ error: "Failed to retrieve maintenance request." });
  }
};

export const updateMaintenanceStatus = async (req, res) => {
  const role = String(req.session?.userRole || "").toLowerCase();
  if (!req.session?.userId || !["admin", "technician"].includes(role)) {
    return res.status(403).json({ error: "Only Admin or Technician may update maintenance request status." });
  }

  const { id } = req.params;
  const { status, resolvedBy } = req.body;

  if (!status) {
    return res.status(400).json({ error: "Status is required." });
  }

  const normalizedStatus = normalizeStatus(status);
  const validStatuses = ["Pending", "In Progress", "Resolved", "Rejected"];
  if (!validStatuses.includes(normalizedStatus)) {
    return res.status(400).json({ error: "Invalid status value." });
  }

  try {
    await ensureMaintenanceTables();
    await ensureMaintenanceRequestColumns();

    const maintenance = await MaintenanceRequest.findOne({
      where: { id: { [Op.eq]: id, [Op.notIn]: await getArchivedEntityIds("maintenance-report") } }
    });

    if (!maintenance) {
      return res.status(404).json({ error: "Maintenance request not found." });
    }

    const userCampus = await getUserCampusFromSession(req);
    if (!userCampus) {
      return res.status(403).json({ error: "Unauthorized: User campus not found." });
    }

    // User can only update maintenance requests from their own campus
    if (!canManageRecord(userCampus, maintenance.campus)) {
      return res.status(403).json({ error: "You do not have permission to update maintenance requests from another campus." });
    }

    const updateData = { status: normalizedStatus };

    if (normalizedStatus === "Resolved") {
      updateData.dateResolved = new Date();
      updateData.resolvedBy = resolvedBy || req.session?.user?.name || req.session?.userName || "Technician";
    }

    try {
      await maintenance.update(updateData);
    } catch (updateError) {
      console.warn("Model update failed, retrying with direct SQL:", updateError.message);
      await ensureMaintenanceRequestColumns();
      await sequelize.query(
        `UPDATE maintenance_requests SET status = ?, dateResolved = ?, resolvedBy = ? WHERE id = ?`,
        {
          replacements: [
            normalizedStatus,
            updateData.dateResolved ? updateData.dateResolved.toISOString() : null,
            updateData.resolvedBy || null,
            id
          ],
          type: sequelize.QueryTypes.UPDATE
        }
      );
    }

    const refreshedMaintenance = await MaintenanceRequest.findByPk(id);
    await logAuditEntry(req, {
      action: "Maintenance Status Updated",
      module: "Maintenance Monitoring",
      resourceId: id,
      description: `Maintenance request ${id} status changed to ${normalizedStatus}.`,
      details: {
        status: normalizedStatus,
        resolvedBy: updateData.resolvedBy || null,
        campus: maintenance.campus
      }
    });

    return res.json({
      success: true,
      message: "Maintenance request status updated successfully.",
      data: refreshedMaintenance
    });
  } catch (error) {
    console.error("Failed to update maintenance status:", error);
    return res.status(500).json({ error: "Failed to update maintenance request." });
  }
};

export const assignTechnician = async (req, res) => {
  if (!req.session?.userId || req.session.userRole?.toLowerCase() !== "admin") {
    return res.status(403).json({ error: "Forbidden: only admin may assign technicians." });
  }

  const { id } = req.params;
  const { assignedTo } = req.body;

  if (!assignedTo) {
    return res.status(400).json({ error: "Technician ID is required." });
  }

  try {
    const maintenance = await MaintenanceRequest.findOne({
      where: { id: { [Op.eq]: id, [Op.notIn]: await getArchivedEntityIds("maintenance-report") } }
    });

    if (!maintenance) {
      return res.status(404).json({ error: "Maintenance request not found." });
    }

    await maintenance.update({
      assignedTo,
      status: "In Progress"
    });
    await logAuditEntry(req, {
      action: "Technician Assigned",
      module: "Maintenance Monitoring",
      resourceId: id,
      description: `Technician ${assignedTo} assigned to maintenance request ${id}.`,
      details: { assignedTo }
    });

    return res.json({
      success: true,
      message: "Technician assigned successfully.",
      data: maintenance
    });
  } catch (error) {
    console.error("Failed to assign technician:", error);
    return res.status(500).json({ error: "Failed to assign technician." });
  }
};

export const getMaintenanceSummary = async (req, res) => {
  if (!req.session?.userId) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const whereClause = buildMaintenanceWhereClause(req);
    whereClause.id = { [Op.notIn]: await getArchivedEntityIds("maintenance-report") };

    const allRequests = await MaintenanceRequest.findAll({ where: whereClause, attributes: ["id", "status"] });
    console.log('[maintenance] dashboard query result count', Array.isArray(allRequests) ? allRequests.length : 0);

    // Deduplicate by id then compute status counts
    const uniq = new Map();
    (allRequests || []).forEach(r => {
      const id = r && (r.id || (r.toJSON && r.toJSON().id));
      if (id != null && !uniq.has(id)) uniq.set(id, r);
    });
    const uniqueList = Array.from(uniq.values());
    console.log('[maintenance] unique report IDs', uniqueList.map(r => r.id));

    const counts = {
      totalRequests: uniqueList.length,
      pendingRequests: uniqueList.filter((request) => normalizeStatus(request.status) === "Pending").length,
      inProgressRequests: uniqueList.filter((request) => normalizeStatus(request.status) === "In Progress").length,
      resolvedRequests: uniqueList.filter((request) => normalizeStatus(request.status) === "Resolved").length
    };
    console.log('[maintenance] pending count', counts.pendingRequests);

    const totalStudents = await User.count({ where: { role: "student" } });
    const totalTechnicians = await User.count({ where: { role: "technician" } });

    return res.json({
      ...counts,
      totalStudents,
      totalTechnicians
    });
  } catch (error) {
    console.error("Failed to load maintenance summary:", error);
    return res.status(500).json({ error: "Failed to load maintenance summary." });
  }
};

export const getTechnicianActivities = async (req, res) => {
  if (!req.session?.userId || req.session.userRole?.toLowerCase() !== "admin") {
    return res.status(403).json({ error: "Forbidden" });
  }

  try {
    const technicians = await User.findAll({ where: { role: "technician" }, attributes: ["id", "name", "email"] });
    const archivedRequestIds = await getArchivedEntityIds("maintenance-report");
    const activityData = await Promise.all(technicians.map(async (tech) => {
      const assignedRequests = await MaintenanceRequest.findAll({
        where: { assignedTo: tech.id, id: { [Op.notIn]: archivedRequestIds } }
      });
      const inProgressTasks = assignedRequests.filter((request) => normalizeStatus(request.status) === "In Progress").length;
      const resolvedTasks = assignedRequests.filter((request) => normalizeStatus(request.status) === "Resolved").length;
      const latestRequest = assignedRequests.sort((left, right) => new Date(right.created_at || right.createdAt || right.dateReported) - new Date(left.created_at || left.createdAt || left.dateReported))[0];

      return {
        technicianName: tech.name,
        assignedRequestsCount: assignedRequests.length,
        inProgressTasks,
        resolvedTasks,
        lastActivityDate: latestRequest ? (latestRequest.dateResolved || latestRequest.created_at || latestRequest.createdAt || latestRequest.dateReported) : null
      };
    }));

    return res.json(activityData);
  } catch (error) {
    console.error("Failed to load technician activities:", error);
    return res.status(500).json({ error: "Failed to load technician activities." });
  }
};

export const deleteMaintenanceRequest = async (req, res) => {
  return res.status(410).json({ error: "Permanent deletion is disabled. Use Archive instead." });
};
