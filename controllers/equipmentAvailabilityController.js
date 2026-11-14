import { Op } from "sequelize";
import { Equipment } from "../models/equipmentModel.js";
import { EquipmentAssignment } from "../models/equipmentAssignmentModel.js";
import { BorrowRecord } from "../models/borrowRecordModel.js";
import { getArchivedEntityIds } from "../models/archiveRecords.js";
import { User } from "../models/userModel.js";
import { getUserAuthContext, isAdminRole, isTechnicianRole } from "./campusAuthController.js";

function getCampusVariants(campus) {
  const normalizedCampus = String(campus || "").trim();
  const campusName = normalizedCampus.replace(/\s*Campus\s*$/i, "").trim();
  return [...new Set([normalizedCampus, campusName, `${campusName} Campus`].filter(Boolean))];
}

function parseRecordDate(record, dateField, timeField, fallbackTime) {
  const date = record?.[dateField];
  if (!date) return null;
  const time = String(record?.[timeField] || fallbackTime).slice(0, 5);
  const parsed = new Date(`${String(date).slice(0, 10)}T${time}:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function isValidBorrowRecord(record) {
  return String(record?.status || "").trim().toLowerCase() !== "rejected";
}

function normalizeCampus(campus) {
  return String(campus || "").trim().toLowerCase().replace(/\s*campus\s*$/i, "");
}

function isMatchingEquipmentReference(record, equipment) {
  if (!record || !equipment) return false;
  if (record.equipmentRecordId && Number(record.equipmentRecordId) !== Number(equipment.id)) return false;
  return String(record.equipmentId || "").trim() === String(equipment.equipmentId || "").trim() &&
    String(record.equipmentName || "").trim() === String(equipment.name || "").trim() &&
    normalizeCampus(record.campus) === normalizeCampus(equipment.campus);
}

function isCurrentlyBorrowed(record, now = new Date()) {
  const status = String(record?.status || "").trim().toLowerCase();
  if (status !== "approved" && status !== "borrowed") return false;

  const start = parseRecordDate(record, "borrowDate", "borrowStartTime", "00:00");
  if (!record?.expectedReturnDate) return !start || start <= now;
  const end = parseRecordDate(record, "expectedReturnDate", "expectedReturnTime", "23:59");
  if (!start || !end) return status === "borrowed";
  return start <= now && now <= end;
}

function toDateValue(value) {
  return value ? String(value).slice(0, 10) : null;
}

function buildHistoryResponse(record) {
  const item = record.toJSON ? record.toJSON() : record;
  return {
    id: item.id,
    borrowerName: item.borrowerName,
    borrowerType: item.borrowerType,
    equipmentId: item.equipmentId,
    equipmentName: item.equipmentName,
    borrowDate: toDateValue(item.borrowDate),
    borrowStartTime: item.borrowStartTime || null,
    expectedReturnDate: toDateValue(item.expectedReturnDate),
    expectedReturnTime: item.expectedReturnTime || null,
    returnDate: toDateValue(item.returnDate),
    returnTime: item.returnTime || null,
    status: item.status,
    condition: item.condition || null,
    purpose: item.purpose || null,
    remarks: item.remarks || null,
    campus: item.campus || null
  };
}

async function getAdminCampusScope(req, res, { allowFaculty = false } = {}) {
  const context = await getUserAuthContext(req);
  if (!context.userId) {
    res.status(401).json({ error: "Please log in to view equipment availability." });
    return null;
  }

  const user = await User.findByPk(context.userId, { attributes: ["role", "campus"] });
  if (!user) {
    res.status(401).json({ error: "Authenticated user was not found." });
    return null;
  }

  const userCampus = String(user.campus || "").trim();
  const isFaculty = ["faculty", "instructor"].includes(String(user.role || "").trim().toLowerCase());
  if (!isAdminRole(user.role) && !isTechnicianRole(user.role) && !(allowFaculty && isFaculty)) {
    res.status(403).json({ error: "Admin or technician access is required." });
    return null;
  }
  if (!userCampus) {
    res.status(403).json({ error: "User campus is not assigned." });
    return null;
  }
  return {
    campus: userCampus,
    campusVariants: getCampusVariants(userCampus)
  };
}

export const listEquipmentAvailability = async (req, res) => {
  try {
    const scope = await getAdminCampusScope(req, res, { allowFaculty: true });
    if (!scope) return;

    const [equipment, borrowRecords, archivedEquipmentIds] = await Promise.all([
      Equipment.findAll({
        where: { campus: { [Op.in]: scope.campusVariants } },
        order: [["name", "ASC"], ["equipmentId", "ASC"]]
      }),
      BorrowRecord.findAll({
        where: { campus: { [Op.in]: scope.campusVariants } },
        order: [["borrowDate", "DESC"], ["created_at", "DESC"]]
      }),
      getArchivedEntityIds("equipment")
    ]);

    const activeAssignments = equipment.length
      ? await EquipmentAssignment.findAll({
          where: {
            equipmentRecordId: { [Op.in]: equipment.map((item) => item.id) },
            unassignedAt: null
          },
          order: [["assignedAt", "DESC"], ["id", "DESC"]]
        })
      : [];
    const assignmentByEquipment = new Map();
    activeAssignments.forEach((assignment) => {
      const key = Number(assignment.equipmentRecordId);
      if (!assignmentByEquipment.has(key)) assignmentByEquipment.set(key, assignment);
    });

    const validRecords = borrowRecords.filter(isValidBorrowRecord);
    const archivedEquipment = new Set(archivedEquipmentIds);
    const now = new Date();
    const response = equipment.filter((item) => !archivedEquipment.has(String(item.equipmentId))).map((item) => {
      const itemRecords = validRecords.filter((record) => isMatchingEquipmentReference(record, item));
      const status = String(item.status || "Serviceable");
      const unavailable = ["unserviceable", "lost", "missing", "under maintenance", "in use", "for repair", "for disposal"].includes(status.toLowerCase());
      const currentlyBorrowed = !unavailable && itemRecords.some((record) => isCurrentlyBorrowed(record, now));
      const assignment = assignmentByEquipment.get(Number(item.id));
      const hasCurrentAccountability = Boolean(assignment);
      const availability = unavailable
        ? "UNAVAILABLE"
        : currentlyBorrowed
          ? "BORROWED"
          : hasCurrentAccountability
            ? "AVAILABLE"
            : "UNAVAILABLE";
      return {
        databaseId: item.id,
        equipmentId: item.equipmentId,
        serialNumber: item.serialNumber || null,
        name: item.name,
        category: item.category,
        laboratoryRoom: item.laboratoryRoom || null,
        campus: item.campus,
        status,
        availability,
        availabilityReason: unavailable
          ? "Equipment condition/status does not allow borrowing"
          : currentlyBorrowed
            ? "Currently borrowed"
            : hasCurrentAccountability
              ? "Ready to borrow"
              : "No current MR Faculty assignment",
        hasCurrentAccountability,
        timesBorrowed: itemRecords.length
      };
    });

    res.json(response);
  } catch (error) {
    console.error("Failed to load equipment availability.", error);
    res.status(500).json({ error: "Failed to load equipment availability." });
  }
};

export const getEquipmentBorrowingHistory = async (req, res) => {
  try {
    const scope = await getAdminCampusScope(req, res);
    if (!scope) return;

    const archivedEquipmentIds = await getArchivedEntityIds("equipment");
    const equipment = await Equipment.findOne({
      where: {
        equipmentId: { [Op.eq]: req.params.equipmentId, [Op.notIn]: archivedEquipmentIds },
        campus: { [Op.in]: scope.campusVariants }
      }
    });
    if (!equipment) {
      return res.status(404).json({ error: "Equipment not found in your campus." });
    }

    const records = await BorrowRecord.findAll({
      where: {
        equipmentId: equipment.equipmentId,
        campus: { [Op.in]: scope.campusVariants }
      },
      order: [["borrowDate", "DESC"], ["created_at", "DESC"]]
    });
    const history = records.filter(isValidBorrowRecord).map(buildHistoryResponse);
    const now = new Date();
    const returned = history.filter((record) => String(record.status || "").toLowerCase() === "returned").length;
    const lost = history.filter((record) => String(record.status || "").toLowerCase() === "pending replacement" || String(record.condition || "").toLowerCase() === "lost").length;
    const overdue = history.filter((record) => {
      const status = String(record.status || "").toLowerCase();
      if (status === "returned" || status === "pending replacement") return false;
      const due = parseRecordDate(record, "expectedReturnDate", "expectedReturnTime", "23:59");
      return due && due < now;
    }).length;

    res.json({
      equipment: {
        equipmentId: equipment.equipmentId,
        name: equipment.name,
        laboratoryRoom: equipment.laboratoryRoom || null,
        status: equipment.status,
        campus: equipment.campus
      },
      summary: { totalBorrowed: history.length, returned, overdue, lost },
      history
    });
  } catch (error) {
    console.error("Failed to load equipment borrowing history.", error);
    res.status(500).json({ error: "Failed to load equipment borrowing history." });
  }
};
