import { Op } from "sequelize";
import { Equipment } from "../models/equipmentModel.js";
import { EquipmentAssignment } from "../models/equipmentAssignmentModel.js";
import EquipmentAuditTrail from "../models/equipmentAuditTrailModel.js";
import { User } from "../models/userModel.js";
import { logAuditEntry } from "./auditController.js";
import { canManageRecord, getUserAuthContext, isAdminRole } from "./campusAuthController.js";
import { getArchivedEntityIds } from "../models/archiveRecords.js";

const getCampusVariants = (campus) => {
  const normalized = String(campus || "").trim();
  const name = normalized.replace(/\s*Campus\s*$/i, "").trim();
  return [...new Set([normalized, name, `${name} Campus`].filter(Boolean))];
};

const isLegacyFacultyRole = (role) => ["faculty", "instructor"].includes(String(role || "").trim().toLowerCase());

function getAuditStateObject(state) {
  if (!state) return {};
  if (typeof state === "object") return state;
  if (typeof state !== "string") return {};
  try {
    const parsed = JSON.parse(state);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (error) {
    console.error("Failed to parse equipment assignment audit state.", error);
    return {};
  }
}

async function getFacultyAssignmentContext(req, res) {
  const auth = await getUserAuthContext(req);
  if (!auth.userId) {
    res.status(401).json({ error: "Please log in to view your assigned equipment." });
    return null;
  }
  const user = await User.findByPk(auth.userId, { attributes: ["id", "name", "role"] });
  if (!user || !isLegacyFacultyRole(user.role)) {
    res.status(403).json({ error: "Only Faculty accounts can view Faculty equipment assignments." });
    return null;
  }
  return { userId: Number(user.id), name: user.name };
}

export const listMyEquipmentAssignments = async (req, res) => {
  try {
    const auth = await getFacultyAssignmentContext(req, res);
    if (!auth) return;

    const assignments = await EquipmentAssignment.findAll({
      where: { facultyUserId: auth.userId, unassignedAt: null },
      order: [["assignedAt", "DESC"], ["id", "DESC"]]
    });
    const equipmentIds = [...new Set(assignments.map((assignment) => Number(assignment.equipmentRecordId)))];
    const equipmentRecords = equipmentIds.length
      ? await Equipment.findAll({
          where: {
            id: { [Op.in]: equipmentIds },
            equipmentId: { [Op.notIn]: await getArchivedEntityIds("equipment") }
          },
          attributes: ["id", "equipmentId", "name", "category", "serialNumber", "campus", "laboratoryRoom", "location", "status", "condition"]
        })
      : [];
    const equipmentById = new Map(equipmentRecords.map((equipment) => [Number(equipment.id), equipment]));
    const assignerIds = [...new Set(assignments.map((assignment) => Number(assignment.assignedByAdminId)))];
    const assigners = assignerIds.length
      ? await User.findAll({ where: { id: { [Op.in]: assignerIds } }, attributes: ["id", "name"] })
      : [];
    const assignerById = new Map(assigners.map((user) => [Number(user.id), user.name]));

    return res.json({
      success: true,
      assignments: assignments.flatMap((assignment) => {
        const equipment = equipmentById.get(Number(assignment.equipmentRecordId));
        if (!equipment) return [];
        return [{
          ...equipment.toJSON(),
          assignmentId: assignment.id,
          assignedAt: assignment.assignedAt,
          assignedBy: assignerById.get(Number(assignment.assignedByAdminId)) || null,
          remarks: assignment.remarks || null
        }];
      })
    });
  } catch (error) {
    console.error("Failed to load Faculty equipment assignments.", error);
    return res.status(500).json({ error: "Failed to load your assigned equipment." });
  }
};

export const getMyEquipmentAssignmentHistory = async (req, res) => {
  try {
    const auth = await getFacultyAssignmentContext(req, res);
    if (!auth) return;

    const assignments = await EquipmentAssignment.findAll({
      where: { facultyUserId: auth.userId },
      attributes: ["id", "equipmentRecordId"],
      order: [["assignedAt", "DESC"], ["id", "DESC"]]
    });
    const equipmentIds = [...new Set(assignments.map((assignment) => Number(assignment.equipmentRecordId)))];
    const assignmentById = new Map(assignments.map((assignment) => [Number(assignment.id), assignment]));
    if (!equipmentIds.length) {
      return res.json({ success: true, history: [] });
    }

    const auditRows = await EquipmentAuditTrail.findAll({
      where: {
        equipmentId: { [Op.in]: equipmentIds },
        actionType: { [Op.in]: ["accountability_assigned", "accountability_removed"] }
      },
      order: [["actionTimestamp", "DESC"]],
      limit: 500
    });
    const history = auditRows.flatMap((row) => {
      const state = getAuditStateObject(row.actionType === "accountability_removed" ? row.beforeState : row.afterState);
      const accountabilityFaculty = state.accountableFaculty;
      const assignment = assignmentById.get(Number(state.assignmentId));
      if (!assignment || Number(accountabilityFaculty?.id) !== auth.userId) return [];
      return [{
        ...row.toJSON(),
        accountabilityFacultyName: accountabilityFaculty.name || auth.name
      }];
    });
    const performerIds = [...new Set(history.map((entry) => Number(entry.performedBy)).filter(Number.isInteger))];
    const performers = performerIds.length
      ? await User.findAll({ where: { id: { [Op.in]: performerIds } }, attributes: ["id", "name", "college"] })
      : [];
    const performerById = new Map(performers.map((user) => [Number(user.id), user]));
    const equipmentRecords = await Equipment.findAll({
      where: { id: { [Op.in]: equipmentIds } },
      attributes: ["id", "equipmentId", "name", "serialNumber"]
    });
    const equipmentById = new Map(equipmentRecords.map((equipment) => [Number(equipment.id), equipment]));

    return res.json({
      success: true,
      history: history.map((entry) => {
        const equipment = equipmentById.get(Number(entry.equipmentId));
        const performer = performerById.get(Number(entry.performedBy));
        return {
          ...entry,
          equipmentCode: equipment?.equipmentId || null,
          equipmentName: equipment?.name || null,
          serialNumber: entry.serialNumber || equipment?.serialNumber || null,
          performedByName: entry.performedByName || performer?.name || null,
          performedByCollege: performer?.college || null
        };
      })
    });
  } catch (error) {
    console.error("Failed to load Faculty equipment assignment history.", error);
    return res.status(500).json({ error: "Failed to load your equipment assignment history." });
  }
};

async function getAdminContext(req, res) {
  const auth = await getUserAuthContext(req);
  if (!auth.userId) {
    res.status(401).json({ error: "Please log in to manage equipment accountability." });
    return null;
  }
  const user = await User.findByPk(auth.userId, { attributes: ["name", "role", "campus"] });
  if (!user || !isAdminRole(user.role)) {
    res.status(403).json({ error: "Only administrators can manage equipment accountability." });
    return null;
  }
  return { ...auth, name: user.name, role: user.role, campus: user.campus || null };
}

function canManageCampus(adminCampus, targetCampus) {
  return !String(adminCampus || "").trim() || canManageRecord(adminCampus, targetCampus);
}

export const listEquipmentAssignments = async (req, res) => {
  try {
    const auth = await getAdminContext(req, res);
    if (!auth) return;

    const campusWhere = auth.campus ? { campus: { [Op.in]: getCampusVariants(auth.campus) } } : {};
    const [equipment, faculty] = await Promise.all([
      Equipment.findAll({
        where: {
          ...campusWhere,
          equipmentId: { [Op.notIn]: await getArchivedEntityIds("equipment") }
        },
        attributes: ["id", "equipmentId", "name", "category", "serialNumber", "campus", "laboratoryRoom", "location", "status", "condition"],
        order: [["campus", "ASC"], ["name", "ASC"], ["equipmentId", "ASC"]]
      }),
      User.findAll({
        where: {
          role: { [Op.in]: ["faculty", "Faculty", "instructor", "Instructor"] },
          ...(auth.campus ? { campus: { [Op.in]: getCampusVariants(auth.campus) } } : {})
        },
        attributes: ["id", "name", "email", "campus"],
        order: [["name", "ASC"]]
      })
    ]);

    const equipmentIds = equipment.map((item) => item.id);
    const activeAssignments = equipmentIds.length
      ? await EquipmentAssignment.findAll({
          where: { equipmentRecordId: { [Op.in]: equipmentIds }, unassignedAt: null },
          order: [["assignedAt", "DESC"], ["id", "DESC"]]
        })
      : [];
    const assignmentByEquipment = new Map();
    activeAssignments.forEach((assignment) => {
      if (!assignmentByEquipment.has(assignment.equipmentRecordId)) {
        assignmentByEquipment.set(assignment.equipmentRecordId, assignment);
      }
    });
    const assignedFacultyIds = [...new Set(activeAssignments.map((assignment) => assignment.facultyUserId))];
    const assignedFaculty = assignedFacultyIds.length
      ? await User.findAll({ where: { id: { [Op.in]: assignedFacultyIds } }, attributes: ["id", "name", "email", "campus"] })
      : [];
    const facultyById = new Map(assignedFaculty.map((person) => [Number(person.id), person]));

    return res.json({
      equipment: equipment.map((item) => {
        const assignment = assignmentByEquipment.get(item.id);
        const accountableFaculty = assignment ? facultyById.get(Number(assignment.facultyUserId)) : null;
        return {
          ...item.toJSON(),
          accountableFaculty: accountableFaculty ? {
            id: accountableFaculty.id,
            name: accountableFaculty.name,
            email: accountableFaculty.email
          } : null,
          assignmentId: assignment?.id || null,
          assignedAt: assignment?.assignedAt || null
        };
      }),
      faculty: faculty.map((person) => ({
        id: person.id,
        name: person.name,
        email: person.email,
        campus: person.campus
      }))
    });
  } catch (error) {
    console.error("Failed to list equipment assignments.", error);
    return res.status(500).json({ error: "Failed to load equipment accountability records." });
  }
};

export const updateEquipmentAssignment = async (req, res) => {
  const { id } = req.params;
  const hasFacultyId = Object.prototype.hasOwnProperty.call(req.body || {}, "facultyId");
  if (!hasFacultyId) {
    return res.status(400).json({ error: "facultyId is required. Use null to remove the current assignment." });
  }

  const requestedFacultyId = req.body.facultyId == null || req.body.facultyId === ""
    ? null
    : Number(req.body.facultyId);
  if (requestedFacultyId !== null && (!Number.isInteger(requestedFacultyId) || requestedFacultyId <= 0)) {
    return res.status(400).json({ error: "facultyId must identify a valid faculty account." });
  }

  const remarks = String(req.body.remarks || "").trim() || null;

  try {
    const auth = await getAdminContext(req, res);
    if (!auth) return;

    const equipmentId = Number(id);
    if (!Number.isInteger(equipmentId) || equipmentId <= 0) {
      return res.status(400).json({ error: "A valid equipment record ID is required." });
    }
    const equipment = await Equipment.findByPk(equipmentId);
    if (!equipment) return res.status(404).json({ error: "Equipment record not found." });
    if (!canManageCampus(auth.campus, equipment.campus)) {
      return res.status(403).json({ error: "You do not have permission to manage equipment at another campus." });
    }

    let faculty = null;
    if (requestedFacultyId !== null) {
      faculty = await User.findByPk(requestedFacultyId, { attributes: ["id", "name", "email", "role", "campus"] });
      if (!faculty || !isLegacyFacultyRole(faculty.role)) {
        return res.status(400).json({ error: "The selected account is not a Faculty account." });
      }
      if (!canManageCampus(auth.campus, faculty.campus) || !canManageRecord(equipment.campus, faculty.campus)) {
        return res.status(400).json({ error: "The Faculty account and equipment must belong to the same campus." });
      }
    }

    const outcome = await EquipmentAssignment.sequelize.transaction(async (transaction) => {
      await Equipment.findByPk(equipment.id, {
        attributes: ["id"],
        transaction,
        lock: transaction.LOCK.UPDATE
      });
      const currentAssignments = await EquipmentAssignment.findAll({
        where: { equipmentRecordId: equipment.id, unassignedAt: null },
        order: [["assignedAt", "DESC"], ["id", "DESC"]],
        transaction,
        lock: transaction.LOCK.UPDATE
      });
      const current = currentAssignments[0] || null;

      if (!current && requestedFacultyId === null) {
        return { changed: false, current: null };
      }

      if (current && requestedFacultyId === Number(current.facultyUserId)) {
        return { changed: false, current };
      }

      const now = new Date();
      const previousFacultyIds = [...new Set(currentAssignments.map((assignment) => Number(assignment.facultyUserId)))];
      const previousFaculty = previousFacultyIds.length
        ? await User.findAll({
            where: { id: { [Op.in]: previousFacultyIds } },
            attributes: ["id", "name", "email"],
            transaction
          })
        : [];
      const previousFacultyById = new Map(previousFaculty.map((person) => [Number(person.id), person]));

      if (currentAssignments.length) {
        await EquipmentAssignment.update({
          unassignedAt: now,
          unassignedByAdminId: auth.userId,
          unassignmentRemarks: remarks
        }, {
          where: { id: { [Op.in]: currentAssignments.map((assignment) => assignment.id) }, unassignedAt: null },
          transaction
        });
      }

      for (const assignment of currentAssignments) {
        const previouslyAssignedFaculty = previousFacultyById.get(Number(assignment.facultyUserId));
        await EquipmentAuditTrail.create({
          equipmentId: equipment.id,
          serialNumber: equipment.serialNumber || null,
          actionType: "accountability_removed",
          actionDescription: `Accountability for ${equipment.equipmentId} (${equipment.name}) was removed from ${previouslyAssignedFaculty?.name || `Faculty account #${assignment.facultyUserId}`}${previouslyAssignedFaculty?.email ? ` (${previouslyAssignedFaculty.email})` : ""}.${remarks ? ` Remarks: ${remarks}` : ""}`,
          performedBy: auth.userId,
          performedByName: auth.name,
          userRole: "admin",
          beforeState: {
            accountableFaculty: previouslyAssignedFaculty
              ? { id: previouslyAssignedFaculty.id, name: previouslyAssignedFaculty.name, email: previouslyAssignedFaculty.email }
              : { id: assignment.facultyUserId },
            assignmentId: assignment.id
          },
          afterState: { accountableFaculty: null, assignmentId: assignment.id, remarks },
          actionTimestamp: now
        }, { transaction });
      }

      if (!faculty) return { changed: true, current: null };

      const assignment = await EquipmentAssignment.create({
        equipmentRecordId: equipment.id,
        facultyUserId: faculty.id,
        assignedByAdminId: auth.userId,
        assignedAt: now,
        remarks
      }, { transaction });
      await EquipmentAuditTrail.create({
        equipmentId: equipment.id,
        serialNumber: equipment.serialNumber || null,
        actionType: "accountability_assigned",
        actionDescription: `${equipment.equipmentId} (${equipment.name}) was assigned to ${faculty.name}${faculty.email ? ` (${faculty.email})` : ""}.${remarks ? ` Remarks: ${remarks}` : ""}`,
        performedBy: auth.userId,
        performedByName: auth.name,
        userRole: "admin",
        beforeState: current ? {
          accountableFaculty: previousFacultyById.get(Number(current.facultyUserId))
            ? {
                id: previousFacultyById.get(Number(current.facultyUserId)).id,
                name: previousFacultyById.get(Number(current.facultyUserId)).name,
                email: previousFacultyById.get(Number(current.facultyUserId)).email
              }
            : { id: current.facultyUserId }
        } : null,
        afterState: {
          accountableFaculty: { id: faculty.id, name: faculty.name, email: faculty.email },
          assignmentId: assignment.id,
          remarks
        },
        actionTimestamp: now
      }, { transaction });
      return { changed: true, current: assignment };
    });

    if (!outcome.changed) {
      return res.json({ success: true, unchanged: true, message: "This Faculty member is already accountable for the equipment." });
    }

    const action = requestedFacultyId === null ? "EQUIPMENT_ACCOUNTABILITY_REMOVED" : "EQUIPMENT_ACCOUNTABILITY_ASSIGNED";
    const description = requestedFacultyId === null
      ? `Accountability was removed from ${equipment.equipmentId} (${equipment.name}).`
      : `${faculty.name} was assigned accountability for ${equipment.equipmentId} (${equipment.name}).`;
    await logAuditEntry(req, {
      action,
      module: "Equipment Assignment",
      resourceId: equipment.id,
      description: remarks ? `${description} Remarks: ${remarks}` : description
    });

    return res.json({
      success: true,
      equipmentRecordId: equipment.id,
      accountableFaculty: faculty ? { id: faculty.id, name: faculty.name, email: faculty.email } : null,
      assignmentId: outcome.current?.id || null
    });
  } catch (error) {
    console.error("Failed to update equipment accountability.", error);
    return res.status(500).json({ error: "Failed to update equipment accountability." });
  }
};

export const getEquipmentAssignmentHistory = async (req, res) => {
  try {
    const auth = await getAdminContext(req, res);
    if (!auth) return;

    const equipmentId = Number(req.params.id);
    if (!Number.isInteger(equipmentId) || equipmentId <= 0) {
      return res.status(400).json({ error: "A valid equipment record ID is required." });
    }
    const equipment = await Equipment.findByPk(equipmentId, {
      attributes: ["id", "equipmentId", "name", "campus"]
    });
    if (!equipment) return res.status(404).json({ error: "Equipment record not found." });
    if (!canManageCampus(auth.campus, equipment.campus)) {
      return res.status(403).json({ error: "You do not have permission to view assignment history for another campus." });
    }

    const assignments = await EquipmentAssignment.findAll({
      where: { equipmentRecordId: equipment.id },
      order: [["assignedAt", "DESC"], ["id", "DESC"]]
    });
    const userIds = [...new Set(assignments.flatMap((assignment) => [
      assignment.facultyUserId,
      assignment.assignedByAdminId,
      assignment.unassignedByAdminId
    ]).filter(Boolean))];
    const users = userIds.length
      ? await User.findAll({ where: { id: { [Op.in]: userIds } }, attributes: ["id", "name", "email"] })
      : [];
    const userById = new Map(users.map((person) => [Number(person.id), person]));

    return res.json({
      equipment: equipment.toJSON(),
      history: assignments.map((assignment) => ({
        id: assignment.id,
        faculty: userById.get(Number(assignment.facultyUserId)) || null,
        assignedBy: userById.get(Number(assignment.assignedByAdminId)) || null,
        unassignedBy: assignment.unassignedByAdminId ? userById.get(Number(assignment.unassignedByAdminId)) || null : null,
        assignedAt: assignment.assignedAt,
        unassignedAt: assignment.unassignedAt,
        remarks: assignment.remarks,
        unassignmentRemarks: assignment.unassignmentRemarks
      }))
    });
  } catch (error) {
    console.error("Failed to load equipment accountability history.", error);
    return res.status(500).json({ error: "Failed to load equipment accountability history." });
  }
};
