import { Op } from "sequelize";
import { BorrowHistory, BorrowRecord } from "../models/borrowRecordModel.js";
import { Equipment } from "../models/equipmentModel.js";
import { EquipmentAssignment } from "../models/equipmentAssignmentModel.js";
import { BorrowRequestAccountability } from "../models/borrowRequestAccountabilityModel.js";
import { User } from "../models/userModel.js";
import { MaintenanceRequest } from "../models/maintenanceRequestModel.js";
import EquipmentAuditTrail from "../models/equipmentAuditTrailModel.js";
import { logAuditEntry } from "./auditController.js";
import { getUserAuthContext, isAdminRole, isTechnicianRole, canManageRecord } from "./campusAuthController.js";
import { getArchivedEntityIds } from "../models/archiveRecords.js";

function getCampusVariants(campus) {
  const normalizedCampus = String(campus || "").trim();
  const campusName = normalizedCampus.replace(/\s*Campus\s*$/i, "").trim();
  return [...new Set([
    normalizedCampus,
    campusName,
    `${campusName} Campus`
  ].filter(Boolean))];
}

function isCentralAdministrator(authContext) {
  return isAdminRole(authContext?.role) && !String(authContext?.campus || "").trim();
}

async function getBorrowAccessScope(req) {
  const authContext = await getUserAuthContext(req);
  if (!authContext.userId) {
    return { authenticated: false, centralAdministrator: false, campus: null, where: null };
  }

  const campus = String(authContext.campus || "").trim() || null;
  return {
    authenticated: true,
    userId: authContext.userId,
    role: authContext.role,
    centralAdministrator: isAdminRole(authContext.role) && !campus,
    campus,
    where: campus ? { campus: { [Op.in]: getCampusVariants(campus) } } : null
  };
}

function canAccessBorrowRecord(scope, recordCampus) {
  return Boolean(scope.campus) &&
    Boolean(String(recordCampus || "").trim()) &&
    canManageRecord(scope.campus, recordCampus);
}

function getStrictBorrowWhere(scope) {
  if (!scope.campus) return null;
  return { campus: { [Op.in]: getCampusVariants(scope.campus) } };
}

function normalizeBorrowStatus(status) {
  const value = String(status || "").trim();
  if (!value) return "Pending";
  const lower = value.toLowerCase();
  if (lower === "approved") return "Approved";
  if (lower === "rejected") return "Rejected";
  if (lower === "returned") return "Returned";
  if (lower === "pending") return "Pending";
  if (lower === "borrowed") return "Borrowed";
  return value;
}

function parseDateTime(dateValue, timeValue) {
  if (!dateValue) return null;
  const trimmedDate = String(dateValue).slice(0, 10);
  const trimmedTime = String(timeValue || "00:00").slice(0, 5);
  const parsed = new Date(`${trimmedDate}T${trimmedTime}:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function getCampusDateTime(value = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(value);
  const values = Object.fromEntries(parts.map(({ type, value: partValue }) => [type, partValue]));
  return {
    date: `${values.year}-${values.month}-${values.day}`,
    time: `${values.hour}:${values.minute}`
  };
}

function getBorrowRecordEffectiveStatus(record) {
  const rawStatus = String(record?.status || "").trim();
  const lowerStatus = rawStatus.toLowerCase();

  if (["rejected", "returned", "lost", "pending replacement"].includes(lowerStatus)) {
    return rawStatus || "Returned";
  }

  if (["pending", "approved", "borrowed"].includes(lowerStatus)) {
    const expectedReturn = record?.expectedReturnDate
      ? parseDateTime(record.expectedReturnDate, record.expectedReturnTime || "23:59")
      : null;
    if (expectedReturn && expectedReturn < new Date()) {
      return "Overdue";
    }
    return rawStatus === "Approved" ? "Approved" : (rawStatus === "Pending" ? "Pending" : "Borrowed");
  }

  if (!rawStatus) return "Borrowed";
  return rawStatus;
}

function hasTimeOverlap(startA, endA, startB, endB) {
  if (!startA || !endA || !startB || !endB) return false;
  return startA < endB && endA > startB;
}

function isUnavailableForBorrowing(status) {
  const normalizedStatus = String(status || "").trim().toLowerCase();
  return ["unserviceable", "lost", "missing", "under maintenance", "in use", "for repair", "for disposal"].includes(normalizedStatus);
}

function getUnavailableReason(status) {
  const s = String(status || "").trim().toLowerCase();
  if (s === "missing") return "Equipment is currently marked as Missing and cannot be borrowed.";
  if (s === "under maintenance") return "Equipment is currently Under Maintenance and cannot be borrowed.";
  if (s === "in use") return "Equipment is currently In Use and cannot be borrowed.";
  if (s === "for repair") return "Equipment is marked For Repair and cannot be borrowed.";
  if (s === "for disposal") return "Equipment is marked For Disposal and cannot be borrowed.";
  if (s === "unserviceable") return "Equipment is Unserviceable and cannot be borrowed.";
  if (s === "lost") return "Equipment is marked as Lost and cannot be borrowed.";
  return `Equipment status '${status}' does not allow borrowing.`;
}

function canViewBorrowNotifications(role) {
  const normalizedRole = String(role || "").trim().toLowerCase();
  return isAdminRole(normalizedRole) ||
    isTechnicianRole(normalizedRole);
}

function isFacultyRole(role) {
  return ["faculty", "instructor"].includes(String(role || "").trim().toLowerCase());
}

function isActiveBorrowStatus(status) {
  return ["pending", "approved", "borrowed", "overdue"].includes(String(status || "").trim().toLowerCase());
}

async function getBorrowDecisionAccess(scope, record, identity, transaction) {
  if (isAdminRole(scope.role)) return { allowed: true, approverName: null };

  if (identity?.approvalRequired) {
    if (!isFacultyRole(scope.role) || Number(identity.accountableFacultyUserId) !== Number(scope.userId)) {
      return { allowed: false };
    }
    if (Number(identity.requesterUserId) === Number(scope.userId)) {
      return { allowed: false, selfApproval: true };
    }
    const activeAssignment = await EquipmentAssignment.findOne({
      where: {
        equipmentRecordId: record.equipmentRecordId,
        facultyUserId: scope.userId,
        unassignedAt: null
      },
      ...(transaction ? { transaction, lock: transaction.LOCK.UPDATE } : {})
    });
    if (!activeAssignment) return { allowed: false, assignmentChanged: true };
    return { allowed: true };
  }

  if (String(record.borrowerType || "").trim().toLowerCase() === "faculty") {
    return { allowed: false };
  }
  return { allowed: isTechnicianRole(scope.role) };
}

async function findEquipmentForBorrowRecord(record) {
  return Equipment.findOne({
    where: {
      equipmentId: record.equipmentId,
      campus: { [Op.in]: getCampusVariants(record.campus) }
    }
  });
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

function buildEquipmentDisplay(record, equipment) {
  const resolved = isMatchingEquipmentReference(record, equipment);
  return {
    equipmentReferenceStatus: resolved ? "resolved" : "unresolved",
    equipmentDisplayName: resolved ? record.equipmentName : "Equipment record unavailable",
    originalEquipmentId: record.equipmentId || null,
    serialNumber: record.serialNumber || (resolved ? equipment.serialNumber : null) || null
  };
}

function buildBorrowerDepartmentInfo(record, college) {
  const departmentInfo = String(record.departmentInfo || "").trim();
  const collegePrefix = String(college || "").trim().toUpperCase();
  if (!collegePrefix) return departmentInfo || null;
  if (!departmentInfo) return collegePrefix;
  if (departmentInfo.split(" • ")[0].trim().toUpperCase() === collegePrefix) return departmentInfo;
  return `${collegePrefix} • ${departmentInfo}`;
}

export const listBorrowNotifications = async (req, res) => {
  const scope = await getBorrowAccessScope(req);
  if (!scope.authenticated) return res.status(401).json({ error: "Please log in to view borrow notifications." });
  if (!canViewBorrowNotifications(scope.role)) {
    return res.status(403).json({ error: "Admin or technician access is required." });
  }
  const strictWhere = getStrictBorrowWhere(scope);
  if (!strictWhere) return res.status(403).json({ error: "User campus is not assigned." });
  const records = await BorrowRecord.findAll({
    where: { ...strictWhere, status: "Pending" },
    order: [["created_at", "DESC"]],
    limit: 50
  });
  const borrowedRecords = await BorrowRecord.findAll({
    where: { ...strictWhere, status: "Borrowed" },
    order: [["created_at", "DESC"]],
    limit: 200
  });
  const returnEvents = borrowedRecords.length
    ? await BorrowHistory.findAll({
        where: {
          recordId: { [Op.in]: borrowedRecords.map((record) => record.id) },
          eventType: "return_requested"
        },
        order: [["created_at", "DESC"], ["id", "DESC"]]
      })
    : [];
  const returnEventByRecord = new Map();
  returnEvents.forEach((event) => {
    if (!returnEventByRecord.has(String(event.recordId))) {
      returnEventByRecord.set(String(event.recordId), event);
    }
  });
  const pendingNotifications = records.map((record) => ({
    id: `borrow-${record.id}`,
    type: "borrow_request",
    title: "New Borrow Request",
    message: `${record.borrowerName} requested to borrow ${record.equipmentId} - ${record.equipmentName}.`,
    relatedId: record.id,
    campus: record.campus,
    readAt: null
  }));
  const returnNotifications = borrowedRecords
    .filter((record) => returnEventByRecord.has(String(record.id)))
    .map((record) => {
      const event = returnEventByRecord.get(String(record.id));
      return {
        id: `borrow-return-${record.id}`,
        type: "borrow_return_request",
        title: "Equipment Return Requested",
        message: `${event.processedBy || record.borrowerName} requested to return ${record.equipmentId} - ${record.equipmentName}.`,
        relatedId: record.id,
        campus: record.campus,
        readAt: null
      };
    });
  return res.json([...pendingNotifications, ...returnNotifications]);
};

export const markBorrowNotificationRead = async (req, res) => {
  const scope = await getBorrowAccessScope(req);
  if (!scope.authenticated) return res.status(401).json({ error: "Please log in to update notifications." });
  if (!canViewBorrowNotifications(scope.role)) {
    return res.status(403).json({ error: "Admin or technician access is required." });
  }
  return res.json({ success: true });
};

export const listBorrowAudit = async (req, res) => {
  try {
    const scope = await getBorrowAccessScope(req);
    if (!scope.authenticated) return res.status(401).json({ error: "Please log in to view the borrow audit." });

    const isPersonalBrowse = !isAdminRole(scope.role) && !isTechnicianRole(scope.role);
    if (!isAdminRole(scope.role) && !isTechnicianRole(scope.role) && !isFacultyRole(scope.role) && !/^(student)$/i.test(String(scope.role || ""))) {
      return res.status(403).json({ error: "Administrator, technician, faculty, or student access is required." });
    }

    const strictWhere = getStrictBorrowWhere(scope);
    if (!strictWhere) return res.status(403).json({ error: "User campus is not assigned." });

    const records = await BorrowRecord.findAll({
      where: strictWhere,
      order: [["created_at", "DESC"]]
    });
    if (!records.length) return res.json([]);

    const recordIds = records.map((record) => record.id);
    const identities = await BorrowRequestAccountability.findAll({
      where: { borrowRecordId: { [Op.in]: recordIds } },
      attributes: ["borrowRecordId", "requesterUserId", "accountableFacultyUserId"]
    });
    const identityByRecord = new Map(identities.map((identity) => [String(identity.borrowRecordId), identity]));
    const equipmentRecordIds = [...new Set(records
      .filter((record) => record.equipmentRecordId != null)
      .map((record) => Number(record.equipmentRecordId))
      .filter(Number.isInteger))];
    const currentAssignments = equipmentRecordIds.length
      ? await EquipmentAssignment.findAll({
          where: { equipmentRecordId: { [Op.in]: equipmentRecordIds }, unassignedAt: null },
          order: [["assignedAt", "DESC"], ["id", "DESC"]]
        })
      : [];
    const currentAssignmentByEquipment = new Map();
    currentAssignments.forEach((assignment) => {
      if (!currentAssignmentByEquipment.has(Number(assignment.equipmentRecordId))) {
        currentAssignmentByEquipment.set(Number(assignment.equipmentRecordId), assignment);
      }
    });
    const requesterIds = [...new Set(identities.map((identity) => Number(identity.requesterUserId)).filter(Number.isInteger))];
    const activeFacultyIds = [...new Set(currentAssignments.map((assignment) => Number(assignment.facultyUserId)).filter(Number.isInteger))];
    const involvedUserIds = [...new Set([...requesterIds, ...activeFacultyIds])];
    const involvedUsers = involvedUserIds.length
      ? await User.findAll({
          where: { id: { [Op.in]: involvedUserIds } },
          attributes: ["id", "name", "college"]
        })
      : [];
    const userById = new Map(involvedUsers.map((person) => [Number(person.id), person]));
    const collegeByRequesterId = new Map(involvedUsers.map((person) => [Number(person.id), person.college]));
    let legacyStudentName = "";
    if (isPersonalBrowse && String(scope.role || "").toLowerCase() === "student") {
      const currentUserRecord = await User.findByPk(scope.userId, { attributes: ["name"] });
      legacyStudentName = String(currentUserRecord?.name || req.session?.userName || "").trim();
    }
    const visibleRecordIds = new Set(records
      .filter((record) => {
        if (!isPersonalBrowse) return true;
        const identity = identityByRecord.get(String(record.id));
        if (Number(identity?.requesterUserId) === Number(scope.userId)) return true;
        if (isFacultyRole(scope.role) &&
            Number(identity?.accountableFacultyUserId) === Number(scope.userId)) return true;
        return String(scope.role || "").toLowerCase() === "student" &&
          !identity &&
          String(record.borrowerName || "").trim() === legacyStudentName;
      })
      .map((record) => String(record.id)));
    const histories = await BorrowHistory.findAll({
      where: { recordId: { [Op.in]: recordIds } },
      order: [["created_at", "DESC"], ["id", "DESC"]]
    });
    const equipmentKeyFor = (record) => record.equipmentRecordId
      ? `equipment:${record.equipmentRecordId}`
      : `legacy:${record.equipmentId}:${normalizeCampus(record.campus)}:${record.equipmentName}`;
    const recordsById = new Map(records.map((record) => [String(record.id), record]));
    const currentHolders = new Map();
    for (const record of records) {
      if (String(record.status || "").toLowerCase() !== "borrowed") continue;
      const key = equipmentKeyFor(record);
      const holders = currentHolders.get(key) || [];
      holders.push({
        borrowRecordId: record.id,
        requesterUserId: identityByRecord.get(String(record.id))?.requesterUserId || null,
        name: record.borrowerName,
        quantity: Number(record.quantity || 1)
      });
      currentHolders.set(key, holders);
    }

    const lastBorrowers = new Map();
    for (const event of histories) {
      if (String(event.eventType || "").toLowerCase() !== "borrowed") continue;
      const key = equipmentKeyFor(recordsById.get(String(event.recordId)) || event);
      if (!lastBorrowers.has(key)) {
        lastBorrowers.set(key, {
          name: event.borrowerName,
          requesterUserId: identityByRecord.get(String(event.recordId))?.requesterUserId || null,
          releasedAt: event.created_at || event.createdAt || null
        });
      }
    }

    return res.json(histories
      .filter((event) => !isPersonalBrowse || visibleRecordIds.has(String(event.recordId)))
      .map((event) => {
      const record = recordsById.get(String(event.recordId));
      const key = equipmentKeyFor(record || event);
      const holders = currentHolders.get(key) || [];
      const lastBorrower = lastBorrowers.get(key);
      return {
        id: event.id,
        borrowRecordId: event.recordId,
        equipmentRecordId: event.equipmentRecordId || record?.equipmentRecordId || null,
        equipmentId: event.equipmentId,
        equipmentName: event.equipmentName,
        serialNumber: event.serialNumber || null,
        campus: record?.campus || null,
        borrowerName: event.borrowerName,
        borrowerCollege: collegeByRequesterId.get(Number(identityByRecord.get(String(event.recordId))?.requesterUserId)) || null,
        departmentInfo: record
          ? buildBorrowerDepartmentInfo(
              record,
              collegeByRequesterId.get(Number(identityByRecord.get(String(event.recordId))?.requesterUserId))
            )
          : null,
        quantity: Number(record?.quantity || 1),
        eventType: event.eventType,
        occurredAt: event.created_at || event.createdAt || null,
        status: record?.status || null,
        currentHolders: (isPersonalBrowse
          ? holders.filter((holder) => Number(holder.requesterUserId) === Number(scope.userId))
          : holders).map(({ requesterUserId, ...holder }) => holder),
        lastBorrower: isPersonalBrowse
          ? (Number(lastBorrower?.requesterUserId) === Number(scope.userId)
            ? { name: lastBorrower.name, userId: Number(lastBorrower.requesterUserId), releasedAt: lastBorrower.releasedAt }
            : null)
          : lastBorrower
            ? { name: lastBorrower.name, userId: Number(lastBorrower.requesterUserId) || null, releasedAt: lastBorrower.releasedAt }
            : null,
        processedBy: event.processedBy || null,
        condition: event.condition || null,
        remarks: event.remarks || null,
        purpose: event.purpose || null
      };
    }));
  } catch (error) {
    console.error("Failed to load borrow audit.", error);
    return res.status(500).json({ error: "Failed to load borrow audit." });
  }
};

function buildBorrowResponse(record, equipment = null) {
  const item = record.toJSON ? record.toJSON() : record;
  const effectiveStatus = getBorrowRecordEffectiveStatus(item);
  return {
    ...item,
    ...buildEquipmentDisplay(item, equipment),
    effectiveStatus,
    status: item.status || "Borrowed",
    borrowDate: item.borrowDate ? item.borrowDate.toString() : null,
    borrowStartTime: item.borrowStartTime || null,
    expectedReturnDate: item.expectedReturnDate ? item.expectedReturnDate.toString() : null,
    expectedReturnTime: item.expectedReturnTime || null,
    returnDate: item.returnDate ? item.returnDate.toString() : null,
    returnTime: item.returnTime || null,
    createdAt: item.created_at ? item.created_at.toISOString() : null,
    updatedAt: item.updated_at ? item.updated_at.toISOString() : null
  };
}

async function logEquipmentBorrowAudit(req, { equipment, actionType, description, beforeState = null, afterState = null }) {
  const userId = Number(req.session?.userId);
  if (!Number.isInteger(userId)) {
    console.error("Equipment audit skipped: authenticated user ID is unavailable.");
    return;
  }
  const rawRole = String(req.session?.userRole || "").trim().toLowerCase();
  const userRole = rawRole.includes("admin")
    ? "admin"
    : rawRole.includes("technician")
      ? "technician"
      : rawRole === "instructor" ? "faculty"
        : ["faculty", "student"].includes(rawRole) ? rawRole : null;
  const user = await User.findByPk(userId, { attributes: ["name"] });
  await EquipmentAuditTrail.create({
    equipmentId: equipment?.id || null,
    serialNumber: equipment?.serialNumber || null,
    actionType,
    actionDescription: description,
    performedBy: userId,
    performedByName: user?.name || req.session?.userName || null,
    userRole,
    beforeState,
    afterState,
    ipAddress: req.ip || null,
    userAgent: req.get("user-agent") || null,
    actionTimestamp: new Date()
  });
}

export const listBorrowRecords = async (req, res) => {
  try {
    const scope = await getBorrowAccessScope(req);
    if (!scope.authenticated) return res.status(401).json({ error: "Please log in to view borrow records." });
    let strictWhere = getStrictBorrowWhere(scope);
    if (!strictWhere) return res.status(403).json({ error: "User campus is not assigned." });

    let student = null;
    if (String(scope.role || "").toLowerCase() === "student") {
      student = await User.findByPk(scope.userId, { attributes: ["name"] });
      const requesterIdentities = await BorrowRequestAccountability.findAll({
        where: { requesterUserId: scope.userId },
        attributes: ["borrowRecordId"]
      });
      const requesterRecordIds = requesterIdentities
        .map((identity) => identity.borrowRecordId)
        .filter((id) => id != null);
      const studentRecords = [];
      if (requesterRecordIds.length) {
        studentRecords.push({ id: { [Op.in]: requesterRecordIds } });
      }
      if (String(student?.name || "").trim()) {
        studentRecords.push({ borrowerName: student.name });
      }
      strictWhere = {
        [Op.and]: [
          strictWhere,
          { [Op.or]: studentRecords.length ? studentRecords : [{ id: { [Op.in]: [] } }] }
        ]
      };
    }

    const records = await BorrowRecord.findAll({
      where: strictWhere,
      order: [["created_at", "DESC"]]
    });
    const archivedBorrowRecordIds = new Set(await getArchivedEntityIds("borrow-record"));
    const archivedBorrowRequestIds = new Set(await getArchivedEntityIds("borrow-request"));
    let visibleRecords = records.filter((record) =>
      !archivedBorrowRecordIds.has(String(record.id)) &&
      !archivedBorrowRequestIds.has(String(record.id))
    );
    const activeBorrowRecordIds = visibleRecords
      .filter((record) => String(record.status || "").toLowerCase() === "borrowed")
      .map((record) => record.id);
    const activeBorrowEvents = activeBorrowRecordIds.length
      ? await BorrowHistory.findAll({
          where: {
            recordId: { [Op.in]: activeBorrowRecordIds },
            eventType: "borrowed"
          },
          attributes: ["recordId", "remarks"]
        })
      : [];
    const currentBorrowerByEquipment = new Map();
    visibleRecords.forEach((record) => {
      if (String(record.status || "").toLowerCase() !== "borrowed") return;
      const key = record.equipmentRecordId
        ? `equipment:${record.equipmentRecordId}`
        : `legacy:${record.equipmentId}:${normalizeCampus(record.campus)}`;
      if (!currentBorrowerByEquipment.has(key)) {
        currentBorrowerByEquipment.set(key, record.borrowerName || null);
      }
    });
    const takenOverFromByRecord = new Map();
    activeBorrowEvents.forEach((event) => {
      const match = String(event.remarks || "").match(/^Borrowed directly via QR handoff from (.+?) \([^)]+\)\./);
      if (match) takenOverFromByRecord.set(String(event.recordId), match[1]);
    });

    const identities = visibleRecords.length
      ? await BorrowRequestAccountability.findAll({
          where: { borrowRecordId: { [Op.in]: visibleRecords.map((record) => record.id) } }
        })
      : [];
    const returnEvents = visibleRecords.length
      ? await BorrowHistory.findAll({
          where: {
            recordId: { [Op.in]: visibleRecords.map((record) => record.id) },
            eventType: "return_requested"
          },
          order: [["created_at", "DESC"], ["id", "DESC"]]
        })
      : [];
    const returnRequestByRecord = new Map();
    returnEvents.forEach((event) => {
      if (!returnRequestByRecord.has(String(event.recordId))) {
        returnRequestByRecord.set(String(event.recordId), event);
      }
    });
    const identityByRecord = new Map(identities.map((identity) => [String(identity.borrowRecordId), identity]));
    const equipmentRecordIds = [...new Set(visibleRecords
      .filter((record) => record.equipmentRecordId != null)
      .map((record) => Number(record.equipmentRecordId))
      .filter(Number.isInteger))];
    const currentAssignments = equipmentRecordIds.length
      ? await EquipmentAssignment.findAll({
          where: { equipmentRecordId: { [Op.in]: equipmentRecordIds }, unassignedAt: null },
          order: [["assignedAt", "DESC"], ["id", "DESC"]]
        })
      : [];
    const currentAssignmentByEquipment = new Map();
    currentAssignments.forEach((assignment) => {
      if (!currentAssignmentByEquipment.has(Number(assignment.equipmentRecordId))) {
        currentAssignmentByEquipment.set(Number(assignment.equipmentRecordId), assignment);
      }
    });
    const involvedUserIds = [...new Set([
      ...identities.flatMap((identity) => [
        identity.requesterUserId,
        identity.accountableFacultyUserId,
        identity.approvedByUserId
      ]),
      ...currentAssignments.map((assignment) => assignment.facultyUserId)
    ].filter(Boolean).map(Number))];
    const involvedUsers = involvedUserIds.length
      ? await User.findAll({
          where: { id: { [Op.in]: involvedUserIds } },
        attributes: ["id", "name", "college", "role", "program", "year", "section"]
        })
      : [];
    const userById = new Map(involvedUsers.map((person) => [Number(person.id), person]));
    const currentFacultyEquipmentIds = new Set(currentAssignments
      .filter((assignment) => Number(assignment.facultyUserId) === Number(scope.userId))
      .map((assignment) => Number(assignment.equipmentRecordId)));

    const equipmentIds = [...new Set(visibleRecords.map((record) => record.equipmentId).filter(Boolean))];
    const equipment = equipmentIds.length
      ? await Equipment.findAll({ where: { equipmentId: { [Op.in]: equipmentIds } } })
      : [];
    if (isFacultyRole(scope.role)) {
      visibleRecords = visibleRecords.filter((record) => {
        const identity = identityByRecord.get(String(record.id));
        return Number(identity?.requesterUserId) === Number(scope.userId) ||
          Number(identity?.accountableFacultyUserId) === Number(scope.userId);
      });
    } else if (String(scope.role || "").toLowerCase() === "student") {
      visibleRecords = visibleRecords.filter((record) => {
        const identity = identityByRecord.get(String(record.id));
        return Number(identity?.requesterUserId) === Number(scope.userId) ||
          (!identity && String(record.borrowerName || "").trim() === String(student?.name || "").trim());
      });
    }

    const response = visibleRecords
      .map((record) => {
        const identity = identityByRecord.get(String(record.id));
        const returnRequest = String(record.status || "").toLowerCase() === "borrowed"
          ? returnRequestByRecord.get(String(record.id))
          : null;
        const isRequester = Number(identity?.requesterUserId) === Number(scope.userId) ||
          (String(scope.role || "").toLowerCase() === "student" && !identity && visibleRecords.includes(record));
        const isBorrowed = String(record.status || "").toLowerCase() === "borrowed";
        const takenOverByMatch = String(record.remarks || "").match(/^Transferred to (.+?) via QR handoff/);
        const currentAssignment = currentAssignmentByEquipment.get(Number(record.equipmentRecordId));
        const requester = userById.get(Number(identity?.requesterUserId));
        const equipmentKey = record.equipmentRecordId
          ? `equipment:${record.equipmentRecordId}`
          : `legacy:${record.equipmentId}:${normalizeCampus(record.campus)}`;
        const isLastFacultyBorrower = isBorrowed &&
          isRequester &&
          isFacultyRole(scope.role) &&
          currentFacultyEquipmentIds.has(Number(record.equipmentRecordId)) &&
          Number(currentAssignment?.facultyUserId) === Number(scope.userId);
        const canApprove = String(record.status || "").toLowerCase() === "pending" &&
          getBorrowRecordEffectiveStatus(record.toJSON ? record.toJSON() : record) !== "Overdue" &&
          (isAdminRole(scope.role) ||
            (!isRequester &&
              isFacultyRole(scope.role) &&
              Number(identity?.accountableFacultyUserId) === Number(scope.userId) &&
              currentFacultyEquipmentIds.has(Number(record.equipmentRecordId))));
        const canReturnStudentBorrow = isBorrowed &&
          String(requester?.role || record.borrowerType || "").toLowerCase() === "student" &&
          isFacultyRole(scope.role) &&
          Number(identity?.accountableFacultyUserId) === Number(scope.userId) &&
          currentFacultyEquipmentIds.has(Number(record.equipmentRecordId));
        return {
          ...buildBorrowResponse(record, equipment.find((item) => isMatchingEquipmentReference(record, item))),
          borrowerCollege: userById.get(Number(identity?.requesterUserId))?.college || null,
          borrowerProgram: requester?.program || null,
          borrowerYear: requester?.year || null,
          borrowerSection: requester?.section || null,
          requesterRole: requester?.role || record.borrowerType || null,
          currentBorrowerName: currentBorrowerByEquipment.get(equipmentKey) || null,
          departmentInfo: buildBorrowerDepartmentInfo(
            record,
            requester?.college
          ),
          requesterUserId: identity?.requesterUserId || null,
          accountableFacultyUserId: identity?.accountableFacultyUserId || null,
          accountableFacultyName: userById.get(Number(identity?.accountableFacultyUserId))?.name || null,
          currentAccountableFacultyUserId: currentAssignment?.facultyUserId || null,
          currentAccountableFacultyName: userById.get(Number(currentAssignment?.facultyUserId))?.name || null,
          approvedByUserId: identity?.approvedByUserId || null,
          approvedByName: userById.get(Number(identity?.approvedByUserId))?.name || null,
          approvedAt: identity?.approvedAt || null,
          rejectionReason: identity?.rejectionReason || null,
          requiresFacultyApproval: Boolean(identity?.approvalRequired),
          isStudentQrHandoff: record.remarks === "Student QR handoff request",
          returnRequestedAt: returnRequest?.created_at || null,
          returnRequestedBy: returnRequest?.processedBy || null,
          returnRequestRemarks: returnRequest?.remarks || null,
          takenOverFrom: takenOverFromByRecord.get(String(record.id)) || null,
          wasTakenOver: takenOverFromByRecord.has(String(record.id)),
          takenOverBy: takenOverByMatch?.[1] || null,
          isMyRequest: isRequester,
          isLastBorrower: isLastFacultyBorrower,
          canReturnStudentBorrow,
          canRequestReturn: isRequester && isBorrowed && !returnRequest &&
            (!isFacultyRole(scope.role) || isLastFacultyBorrower),
          canApprove
        };
      })
      .sort((left, right) => {
        const leftTime = new Date(left.created_at || left.createdAt || left.borrowDate || 0).getTime();
        const rightTime = new Date(right.created_at || right.createdAt || right.borrowDate || 0).getTime();
        return rightTime - leftTime;
      });

    res.json(response);
  } catch (error) {
    console.error("Failed to load borrow records.", error);
    res.status(500).json({ error: "Failed to load borrow records." });
  }
};

const createBorrowRecordHandler = async (req, res, { studentQrHandoff = false } = {}) => {
  const scope = await getBorrowAccessScope(req);
  if (!scope.authenticated) return res.status(401).json({ error: "Please log in to create a borrow request." });
  if (!scope.where) return res.status(403).json({ error: "User campus is not assigned." });
  if (!["student", "faculty", "instructor", "admin", "administrator", "technician"].includes(String(scope.role || "").toLowerCase())) {
    return res.status(403).json({ error: "Your account is not allowed to request equipment." });
  }
  if (studentQrHandoff && String(scope.role || "").trim().toLowerCase() !== "student") {
    return res.status(403).json({ error: "Only Students can submit equipment QR handoff requests." });
  }

  let {
    instructorName,
    instructor_name,
    equipmentType,
    laboratoryRoom,
    equipmentId,
    equipmentName,
    quantity,
    borrowDate,
    borrowStartTime,
    expectedReturnDate,
    expectedReturnTime,
    purpose
  } = req.body;

  const sessionUser = await User.findByPk(scope.userId);
  if (!sessionUser) {
    return res.status(401).json({ error: "Authenticated user was not found." });
  }
  const facultyRequest = isFacultyRole(scope.role);
  const requesterRole = String(scope.role || "").trim().toLowerCase();
  const studentRequest = requesterRole === "student";
  const selfServiceRequest = ["student", "faculty", "instructor"].includes(requesterRole);
  if ((facultyRequest || requesterRole === "instructor") && !String(sessionUser.college || "").trim()) {
    return res.status(400).json({ error: "Select your College / Institute from your profile before requesting equipment." });
  }
  const borrowerName = sessionUser.name;
  const borrowerType = facultyRequest
    ? "Faculty"
    : String(scope.role || "").toLowerCase() === "student"
      ? "Student"
      : isTechnicianRole(scope.role)
        ? "Technician"
        : "Admin";
  const departmentInfo = [
    sessionUser.college,
    ...(facultyRequest ? [] : [sessionUser.program, sessionUser.year, sessionUser.section])
  ].filter(Boolean).join(" • ") || null;

  if (selfServiceRequest) {
    const requestedAt = getCampusDateTime();
    borrowDate = requestedAt.date;
    borrowStartTime = requestedAt.time;
    expectedReturnDate = null;
    expectedReturnTime = null;
  }

  if (!equipmentId || !borrowDate || (!selfServiceRequest && (!expectedReturnDate || !borrowStartTime || !expectedReturnTime))) {
    return res.status(400).json({ error: "Equipment and required borrowing dates are missing." });
  }

  equipmentId = String(equipmentId).trim();

  const normalizedBorrowDate = String(borrowDate).slice(0, 10);
  const normalizedExpectedReturnDate = expectedReturnDate ? String(expectedReturnDate).slice(0, 10) : null;
  const requestStartDate = parseDateTime(normalizedBorrowDate, borrowStartTime);
  const requestEndDate = selfServiceRequest ? Number.POSITIVE_INFINITY : parseDateTime(normalizedExpectedReturnDate, expectedReturnTime);

  if (!requestStartDate || !requestEndDate || requestEndDate <= requestStartDate) {
    return res.status(400).json({ error: "The requested borrowing time range is invalid." });
  }

  try {
    const equipmentWhere = { equipmentId };
    if (!scope.centralAdministrator) {
      equipmentWhere.campus = { [Op.in]: getCampusVariants(scope.campus) };
    }
    const equipment = await Equipment.findOne({ where: equipmentWhere });
    if (!equipment) {
      return res.status(404).json({ error: "Equipment not found in your campus." });
    }
    if ((await getArchivedEntityIds("equipment")).includes(String(equipment.equipmentId))) {
      return res.status(404).json({ error: "Equipment not found in your campus." });
    }
    equipmentId = equipment.equipmentId;
    equipmentName = equipment.name;

    let accountability = null;
    if (facultyRequest || studentRequest) {
      accountability = await EquipmentAssignment.findOne({
        where: { equipmentRecordId: equipment.id, unassignedAt: null },
        order: [["assignedAt", "DESC"]]
      });
      if (!accountability) {
        return res.status(409).json({ error: "This equipment has no current MR Faculty assignment and cannot be borrowed." });
      }
    }

    const normalizedEquipmentType = String(equipmentType || '').trim().toLowerCase();
    const equipmentCategory = String(equipment.category || '').trim().toLowerCase();
    const equipmentNameValue = String(equipment.name || '').trim().toLowerCase();
    if (equipmentType && normalizedEquipmentType !== equipmentCategory && normalizedEquipmentType !== equipmentNameValue) {
      return res.status(400).json({ error: "Selected equipment type does not match the equipment record." });
    }

    if (laboratoryRoom && String(laboratoryRoom).trim() !== String(equipment.laboratoryRoom || '').trim()) {
      return res.status(400).json({ error: "Selected laboratory does not match the equipment record." });
    }

    const isQrHandoffableStatus = studentQrHandoff && /^(borrowed|in use)$/i.test(String(equipment.status || "").trim());
    if (isUnavailableForBorrowing(equipment.status) && !isQrHandoffableStatus) {
      return res.status(400).json({ error: getUnavailableReason(equipment.status) });
    }

    // If equipment belongs to a PC Set, check if any sibling component is Missing
    if (equipment.setId) {
      const { Op: OpLocal } = await import("sequelize");
      const { Equipment: EquipmentModel } = await import("../models/equipmentModel.js");
      const missingComponents = await EquipmentModel.findAll({
        where: {
          setId: equipment.setId,
          status: "Missing",
          id: { [OpLocal.ne]: equipment.id }
        },
        attributes: ["equipmentId", "name", "serialNumber", "category"]
      });
      if (missingComponents.length > 0) {
        const detail = missingComponents.map(c =>
          `${c.name} (${c.equipmentId}${c.serialNumber ? `, SN: ${c.serialNumber}` : ''})`
        ).join(', ');
        return res.status(400).json({
          error: `Cannot borrow equipment from ${equipment.setId} because the following component(s) are Missing: ${detail}.`
        });
      }
    }

    const duplicateRequest = await BorrowRecord.findOne({
      where: {
        borrowerName,
        equipmentId,
        borrowDate: normalizedBorrowDate,
        borrowStartTime: String(borrowStartTime).slice(0, 5),
        expectedReturnDate: normalizedExpectedReturnDate,
        expectedReturnTime: expectedReturnTime ? String(expectedReturnTime).slice(0, 5) : null,
        purpose: purpose ? String(purpose).trim() : null,
        campus: { [Op.in]: getCampusVariants(String(equipment.campus || "").trim()) },
        status: { [Op.in]: ["Pending", "Approved", "Borrowed"] }
      }
    });

    if (duplicateRequest) {
      const duplicateIdentity = await BorrowRequestAccountability.findByPk(duplicateRequest.id);
      if (Number(duplicateIdentity?.requesterUserId) === Number(scope.userId)) {
        return res.status(200).json(buildBorrowResponse(duplicateRequest, equipment));
      }
      return res.status(409).json({ error: "This equipment already has a matching request for that time." });
    }

    const equipmentCampus = String(equipment.campus || "").trim();
    if (!equipmentCampus) {
      return res.status(400).json({ error: "Equipment is not associated with a campus." });
    }

    const requestedQty = selfServiceRequest
      ? 1
      : quantity === undefined || quantity === null || quantity === "" ? 1 : Number(quantity);
    const totalInventory = Number(equipment.quantity ?? equipment.availableQuantity ?? 0);
    if (!Number.isInteger(requestedQty) || requestedQty < 1 || requestedQty > totalInventory) {
      return res.status(400).json({ error: "Requested quantity exceeds available inventory." });
    }

    const recordId = `borrow-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    const result = await BorrowRecord.sequelize.transaction(async (transaction) => {
      const lockedEquipment = await Equipment.findByPk(equipment.id, {
        transaction,
        lock: transaction.LOCK.UPDATE
      });
      const lockedQrHandoffableStatus = studentQrHandoff && /^(borrowed|in use)$/i.test(String(lockedEquipment?.status || "").trim());
      if (!lockedEquipment || (isUnavailableForBorrowing(lockedEquipment.status) && !lockedQrHandoffableStatus)) {
        return { unavailable: true };
      }
      const lockedInventory = Number(lockedEquipment.quantity ?? lockedEquipment.availableQuantity ?? 0);
      if (requestedQty > lockedInventory) return { tooMany: true };

      if (facultyRequest || studentRequest) {
        accountability = await EquipmentAssignment.findOne({
          where: { equipmentRecordId: lockedEquipment.id, unassignedAt: null },
          order: [["assignedAt", "DESC"]],
          transaction,
          lock: transaction.LOCK.UPDATE
        });
        if (!accountability) return { unassigned: true };
      }

      const activeBorrowRecords = await BorrowRecord.findAll({
        where: {
          equipmentId,
          campus: { [Op.in]: getCampusVariants(equipmentCampus) },
          status: { [Op.in]: ["Pending", "Approved", "Borrowed"] }
        },
        transaction
      });
      let reservedQty = 0;
      const activeBorrowedRecords = [];
      for (const activeRecord of activeBorrowRecords) {
        if (studentQrHandoff && String(activeRecord.status || "").toLowerCase() === "borrowed") {
          activeBorrowedRecords.push(activeRecord);
          continue;
        }
        const recordStart = parseDateTime(activeRecord.borrowDate, activeRecord.borrowStartTime || "00:00");
        const recordEnd = activeRecord.expectedReturnDate
          ? parseDateTime(activeRecord.expectedReturnDate, activeRecord.expectedReturnTime || "23:59")
          : Number.POSITIVE_INFINITY;
        if (recordStart && recordEnd && hasTimeOverlap(requestStartDate, requestEndDate, recordStart, recordEnd)) {
          reservedQty += Number(activeRecord.quantity || 1);
        }
      }
      if (studentQrHandoff && activeBorrowedRecords.length > 1) return { conflict: true };
      if (studentQrHandoff && activeBorrowedRecords.length === 1) {
        const currentHolder = await BorrowRequestAccountability.findByPk(activeBorrowedRecords[0].id, { transaction });
        if (Number(currentHolder?.requesterUserId) === Number(scope.userId)) {
          return { alreadyBorrowed: true };
        }
      }
      if (reservedQty + requestedQty > lockedInventory) return { conflict: true };

      const created = await BorrowRecord.create({
        id: recordId,
        borrowerName,
        borrowerType: borrowerType || "Student",
        departmentInfo,
        instructorName: instructorName || instructor_name || null,
        equipmentId,
        equipmentRecordId: equipment.id,
        serialNumber: equipment.serialNumber || null,
        equipmentName: equipment.name,
        quantity: requestedQty,
        borrowDate: normalizedBorrowDate,
        borrowStartTime: String(borrowStartTime).slice(0, 5),
        expectedReturnDate: normalizedExpectedReturnDate,
        expectedReturnTime: expectedReturnTime ? String(expectedReturnTime).slice(0, 5) : null,
        campus: equipmentCampus,
        purpose,
        remarks: studentQrHandoff ? "Student QR handoff request" : null,
        status: "Pending",
        processedBy: null
      }, { transaction });

      await BorrowRequestAccountability.create({
        borrowRecordId: created.id,
        requesterUserId: scope.userId,
        accountableFacultyUserId: accountability?.facultyUserId || null,
        approvalRequired: facultyRequest || studentRequest
      }, { transaction });

      return { record: created };
    });
    if (result.unavailable) {
      return res.status(409).json({ error: "Equipment is no longer available for borrowing." });
    }
    if (result.unassigned) {
      return res.status(409).json({ error: "This equipment has no accountable Faculty member assigned yet." });
    }
    if (result.alreadyBorrowed) {
      return res.status(409).json({ error: "You already have this equipment borrowed. Use My Requests to mark it as returned." });
    }
    if (result.tooMany) {
      return res.status(409).json({ error: "Requested quantity exceeds the current inventory." });
    }
    if (result.conflict) {
      return res.status(409).json({ error: "This equipment already has a conflicting pending request or borrowing for the selected time." });
    }
    const record = result.record;

    await BorrowHistory.create({
      recordId: record.id,
      borrowerName,
      equipmentId,
      equipmentRecordId: equipment.id,
      serialNumber: equipment.serialNumber || null,
      equipmentName: equipment.name,
      borrowDate: normalizedBorrowDate,
      borrowStartTime: record.borrowStartTime,
      returnDate: record.returnDate,
      returnTime: record.returnTime,
      expectedReturnTime: record.expectedReturnTime,
      purpose,
      remarks: facultyRequest || studentRequest
        ? `Borrow request submitted for approval by accountable Faculty member ${accountability.facultyUserId}.`
        : "Borrow request submitted and pending staff approval",
      processedBy: null,
      eventType: "pending"
    });

    await logAuditEntry(req, {
      action: "Borrow Request Submitted",
      module: "Borrow Management",
      resourceId: record.id,
      description: `${borrowerName} submitted a pending borrow request for ${requestedQty}x ${equipmentName} (${equipmentId})${studentQrHandoff ? " through QR handoff" : ""}.`,
      details: {
        borrowRecordId: record.id,
        equipmentId,
        equipmentName,
        borrowerName,
        instructorName: instructorName || instructor_name || null,
        quantity: requestedQty,
        borrowDate: normalizedBorrowDate,
        borrowStartTime: String(borrowStartTime).slice(0, 5),
        expectedReturnDate: normalizedExpectedReturnDate,
        expectedReturnTime: expectedReturnTime ? String(expectedReturnTime).slice(0, 5) : null,
        status: "Pending",
        requesterUserId: scope.userId,
        accountableFacultyUserId: accountability?.facultyUserId || null
      }
    });
    await logEquipmentBorrowAudit(req, {
      equipment,
      actionType: "borrow_requested",
      description: `${borrowerName} submitted a pending request for ${requestedQty}x ${equipmentName} (${equipmentId}).`,
      beforeState: { borrowStatus: null },
      afterState: {
        borrowRecordId: record.id,
        borrowStatus: "Pending",
        borrowerName,
        borrowerType,
        quantity: requestedQty,
        borrowDate: normalizedBorrowDate,
        borrowStartTime: String(borrowStartTime).slice(0, 5),
        expectedReturnDate: normalizedExpectedReturnDate,
        expectedReturnTime: expectedReturnTime ? String(expectedReturnTime).slice(0, 5) : null
      }
    });

    const responsePayload = buildBorrowResponse(record, equipment);
    if (studentQrHandoff) {
      const accountableFaculty = accountability?.facultyUserId
        ? await User.findByPk(accountability.facultyUserId, { attributes: ["id", "name"] })
        : null;
      responsePayload.accountableFacultyName = accountableFaculty?.name || null;
    }
    res.status(201).json(responsePayload);
  } catch (error) {
    console.error("Failed to create borrow record.", error);
    res.status(500).json({ error: `Failed to create borrow record: ${error.message}` });
  }
};

export const createBorrowRecord = (req, res) => createBorrowRecordHandler(req, res);

export const createStudentQrBorrowRecord = (req, res) =>
  createBorrowRecordHandler(req, res, { studentQrHandoff: true });

export const createFacultyQrBorrowRecord = async (req, res) => {
  try {
    const scope = await getBorrowAccessScope(req);
    if (!scope.authenticated) return res.status(401).json({ error: "Please log in to borrow equipment." });
    if (!isFacultyRole(scope.role)) {
      return res.status(403).json({ error: "Only Faculty members can borrow equipment through QR scanning." });
    }
    if (!scope.where) return res.status(403).json({ error: "User campus is not assigned." });

    const borrower = await User.findByPk(scope.userId);
    if (!borrower) return res.status(401).json({ error: "Authenticated Faculty account was not found." });
    if (!String(borrower.college || "").trim()) {
      return res.status(400).json({ error: "Select your College / Institute from your profile before borrowing equipment." });
    }

    const equipmentId = String(req.body?.equipmentId || "").trim();
    const purpose = String(req.body?.purpose || "").trim() || null;
    const requestedDurationHours = req.body?.durationHours;
    if (!equipmentId) return res.status(400).json({ error: "Scan an equipment QR code before borrowing." });
    if (purpose && purpose.length > 1000) return res.status(400).json({ error: "The optional reason must be 1000 characters or fewer." });
    if (requestedDurationHours !== undefined && requestedDurationHours !== null && requestedDurationHours !== "") {
      const durationHours = Number(requestedDurationHours);
      if (!Number.isFinite(durationHours) || durationHours <= 0 || durationHours > 8760) {
        return res.status(400).json({ error: "Borrow duration must be greater than 0 and no more than 8760 hours." });
      }
    }

    const equipmentWhere = { equipmentId, campus: { [Op.in]: getCampusVariants(scope.campus) } };
    const equipment = await Equipment.findOne({ where: equipmentWhere });
    if (!equipment) return res.status(404).json({ error: "Equipment not found in your campus." });
    if ((await getArchivedEntityIds("equipment")).includes(String(equipment.equipmentId))) {
      return res.status(404).json({ error: "Equipment not found in your campus." });
    }
    const currentAssignment = await EquipmentAssignment.findOne({
      where: { equipmentRecordId: equipment.id, unassignedAt: null },
      order: [["assignedAt", "DESC"], ["id", "DESC"]]
    });
    if (!currentAssignment) {
      return res.status(409).json({ error: "This equipment has no current MR Faculty assignment and cannot be borrowed." });
    }
    if (isUnavailableForBorrowing(equipment.status)) {
      return res.status(409).json({ error: getUnavailableReason(equipment.status) });
    }
    const equipmentCampus = String(equipment.campus || "").trim();
    if (!equipmentCampus) return res.status(400).json({ error: "Equipment is not associated with a campus." });
    if (Number(equipment.quantity ?? equipment.availableQuantity ?? 0) < 1) {
      return res.status(409).json({ error: "No inventory is currently available for this equipment." });
    }

    if (equipment.setId) {
      const { Op: OpLocal } = await import("sequelize");
      const { Equipment: EquipmentModel } = await import("../models/equipmentModel.js");
      const missingComponents = await EquipmentModel.findAll({
        where: { setId: equipment.setId, status: "Missing", id: { [OpLocal.ne]: equipment.id } },
        attributes: ["equipmentId", "name", "serialNumber"]
      });
      if (missingComponents.length) {
        const details = missingComponents.map((component) =>
          `${component.name} (${component.equipmentId}${component.serialNumber ? `, SN: ${component.serialNumber}` : ""})`
        ).join(", ");
        return res.status(409).json({
          error: `Cannot borrow equipment from ${equipment.setId} because these components are Missing: ${details}.`
        });
      }
    }

    const { date: borrowDate, time: borrowStartTime } = getCampusDateTime();
    const durationMinutes = requestedDurationHours === undefined || requestedDurationHours === null || requestedDurationHours === ""
      ? null
      : Math.ceil(Number(requestedDurationHours) * 60);
    const recordId = `borrow-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    const result = await BorrowRecord.sequelize.transaction(async (transaction) => {
      const lockedEquipment = await Equipment.findByPk(equipment.id, {
        transaction,
        lock: transaction.LOCK.UPDATE
      });
      if (!lockedEquipment || isUnavailableForBorrowing(lockedEquipment.status)) return { unavailable: true };
      if (String(lockedEquipment.equipmentId) !== equipmentId ||
          normalizeCampus(lockedEquipment.campus) !== normalizeCampus(scope.campus)) {
        return { notFound: true };
      }
      if (Number(lockedEquipment.quantity ?? lockedEquipment.availableQuantity ?? 0) < 1) return { unavailable: true };

      const now = parseDateTime(borrowDate, borrowStartTime);
      const activeRecords = await BorrowRecord.findAll({
        where: {
          equipmentId: lockedEquipment.equipmentId,
          campus: { [Op.in]: getCampusVariants(equipmentCampus) },
          status: { [Op.in]: ["Pending", "Approved", "Borrowed"] }
        },
        transaction,
        lock: transaction.LOCK.UPDATE
      });
      const activeBorrowRecords = activeRecords.filter((activeRecord) =>
        String(activeRecord.status || "").toLowerCase() === "borrowed"
      );
      const reservationConflict = activeRecords.some((activeRecord) => {
        if (String(activeRecord.status || "").toLowerCase() === "borrowed") return false;
        const startsAt = parseDateTime(activeRecord.borrowDate, activeRecord.borrowStartTime || "00:00");
        const endsAt = activeRecord.expectedReturnDate
          ? parseDateTime(activeRecord.expectedReturnDate, activeRecord.expectedReturnTime || "23:59")
          : Number.POSITIVE_INFINITY;
        return startsAt && endsAt && hasTimeOverlap(now, Number.POSITIVE_INFINITY, startsAt, endsAt);
      });
      if (reservationConflict || activeBorrowRecords.length > 1) return { conflict: true };
      const activeBorrowRecord = activeBorrowRecords[0] || null;
      let previousBorrower = null;
      if (activeBorrowRecord) {
        const activeIdentity = await BorrowRequestAccountability.findByPk(activeBorrowRecord.id, { transaction, lock: transaction.LOCK.UPDATE });
        if (!activeIdentity || !isFacultyRole(activeBorrowRecord.borrowerType)) return { conflict: true };
        if (Number(activeIdentity.requesterUserId) === Number(borrower.id)) return { alreadyBorrowed: activeBorrowRecord };
        previousBorrower = await User.findByPk(activeIdentity.requesterUserId, {
          attributes: ["id", "name", "college", "role"],
          transaction,
          lock: transaction.LOCK.UPDATE
        });
        if (!previousBorrower) return { conflict: true };
      }

      const currentAssignments = await EquipmentAssignment.findAll({
        where: { equipmentRecordId: lockedEquipment.id, unassignedAt: null },
        order: [["assignedAt", "DESC"], ["id", "DESC"]],
        transaction,
        lock: transaction.LOCK.UPDATE
      });
      if (!currentAssignments.length) return { unassigned: true };
      const previousAccountable = currentAssignments.length
        ? await User.findByPk(currentAssignments[0].facultyUserId, {
            attributes: ["id", "name", "email"],
            transaction
          })
        : null;
      const borrowedAt = new Date();
      const expectedReturn = durationMinutes
        ? getCampusDateTime(new Date(Math.ceil((borrowedAt.getTime() + durationMinutes * 60_000) / 60_000) * 60_000))
        : { date: null, time: null };
      let transferredBorrowRecordId = null;
      let transferReturnDate = null;
      let transferReturnTime = null;
      if (activeBorrowRecord) {
        const { date: returnDate, time: returnTime } = getCampusDateTime(borrowedAt);
        transferReturnDate = returnDate;
        transferReturnTime = returnTime;
        const transferRemarks = `Transferred to ${borrower.name} (${borrower.college}) via equipment QR handoff.`;
        await activeBorrowRecord.update({
          status: "Returned",
          returnDate,
          returnTime,
          condition: "Good",
          remarks: transferRemarks,
          processedBy: borrower.name
        }, { transaction });
        await BorrowHistory.create({
          recordId: activeBorrowRecord.id,
          borrowerName: activeBorrowRecord.borrowerName,
          equipmentId: lockedEquipment.equipmentId,
          equipmentRecordId: lockedEquipment.id,
          serialNumber: lockedEquipment.serialNumber || activeBorrowRecord.serialNumber,
          equipmentName: lockedEquipment.name,
          borrowDate: activeBorrowRecord.borrowDate,
          borrowStartTime: activeBorrowRecord.borrowStartTime,
          returnDate,
          returnTime,
          expectedReturnTime: activeBorrowRecord.expectedReturnTime,
          condition: "Good",
          purpose: activeBorrowRecord.purpose,
          remarks: transferRemarks,
          processedBy: borrower.name,
          eventType: "returned"
        }, { transaction });
        transferredBorrowRecordId = activeBorrowRecord.id;
      }
      const record = await BorrowRecord.create({
        id: recordId,
        borrowerName: borrower.name,
        borrowerType: "Faculty",
        departmentInfo: String(borrower.college || "").trim(),
        equipmentId: lockedEquipment.equipmentId,
        equipmentRecordId: lockedEquipment.id,
        serialNumber: lockedEquipment.serialNumber || null,
        equipmentName: lockedEquipment.name,
        quantity: 1,
        borrowDate,
        borrowStartTime,
        expectedReturnDate: expectedReturn.date,
        expectedReturnTime: expectedReturn.time,
        campus: equipmentCampus,
        purpose,
        status: "Borrowed",
        processedBy: borrower.name
      }, { transaction });

      await BorrowRequestAccountability.create({
        borrowRecordId: record.id,
        requesterUserId: borrower.id,
        accountableFacultyUserId: currentAssignments[0]?.facultyUserId || null,
        approvalRequired: false
      }, { transaction });
      await BorrowHistory.create({
        recordId: record.id,
        borrowerName: borrower.name,
        equipmentId: lockedEquipment.equipmentId,
        equipmentRecordId: lockedEquipment.id,
        serialNumber: lockedEquipment.serialNumber || null,
        equipmentName: lockedEquipment.name,
        borrowDate,
        borrowStartTime,
        purpose,
        remarks: activeBorrowRecord
          ? `Borrowed directly via QR handoff from ${previousBorrower.name} (${previousBorrower.college}). The previous borrow was closed and accountability remains unchanged.`
          : "Borrowed directly via QR scan; MR accountability was not changed.",
        processedBy: borrower.name,
        eventType: "borrowed"
      }, { transaction });
      await EquipmentAuditTrail.create({
        equipmentId: lockedEquipment.id,
        serialNumber: lockedEquipment.serialNumber || null,
        actionType: "borrowed",
        actionDescription: `${borrower.name} borrowed ${lockedEquipment.name} (${lockedEquipment.equipmentId}) by scanning its QR code.`,
        performedBy: borrower.id,
        performedByName: borrower.name,
        userRole: "faculty",
        beforeState: { borrowStatus: null, accountableFaculty: previousAccountable?.name || null },
        afterState: {
          borrowRecordId: record.id,
          borrowStatus: "Borrowed",
          borrowerName: borrower.name,
          borrowerUserId: borrower.id,
          borrowerRole: "Faculty",
          accountableFaculty: previousAccountable?.name || null,
          lastBorrower: true,
          takenOverFrom: previousBorrower?.name || null,
          takenOverFromRole: previousBorrower?.role || null,
          purpose
        },
        ipAddress: req.ip || null,
        userAgent: req.get("user-agent") || null,
        actionTimestamp: borrowedAt
      }, { transaction });

      return {
        record,
        equipment: lockedEquipment,
        previousAccountable,
        expectedReturn,
        previousBorrower,
        transferredBorrowRecordId,
        transferReturnDate,
        transferReturnTime
      };
    });

    if (result.notFound) return res.status(404).json({ error: "Equipment is no longer available in your campus." });
    if (result.unassigned) {
      return res.status(409).json({ error: "This equipment has no current MR Faculty assignment and cannot be borrowed." });
    }
    if (result.unavailable) return res.status(409).json({ error: "Equipment is no longer available for borrowing." });
    if (result.conflict) return res.status(409).json({ error: "This equipment already has an active borrow request or borrowing." });
    if (result.alreadyBorrowed) return res.status(409).json({ error: "You already have this equipment borrowed. Scan again to mark it as returned." });

    if (result.transferredBorrowRecordId) {
      await logEquipmentBorrowAudit(req, {
        equipment: result.equipment,
        actionType: "returned",
        description: `Borrow record ${result.transferredBorrowRecordId} was transferred from ${result.previousBorrower.name} to ${borrower.name} by QR handoff.`,
        beforeState: { borrowStatus: "Borrowed", borrowerName: result.previousBorrower.name },
        afterState: {
          borrowStatus: "Returned",
          transferredTo: borrower.name,
          replacementBorrowRecordId: result.record.id,
          returnDate: result.transferReturnDate,
          returnTime: result.transferReturnTime
        }
      });
    }

    await logAuditEntry(req, {
      action: result.transferredBorrowRecordId ? "Equipment Borrow Transferred via QR" : "Equipment Borrowed via QR",
      module: "Borrow Management",
      resourceId: result.record.id,
      description: result.previousBorrower
        ? `${borrower.name} took over ${result.equipment.name} (${result.equipment.equipmentId}) from ${result.previousBorrower.name} via QR; the previous borrow was closed.`
        : `${borrower.name} borrowed ${result.equipment.name} (${result.equipment.equipmentId}) via QR; MR accountability was not changed.`,
      details: result.previousBorrower ? {
        previousBorrower: result.previousBorrower.name,
        previousBorrowerCollege: result.previousBorrower.college || null,
        newBorrower: borrower.name,
        newBorrowerCollege: borrower.college,
        previousBorrowRecordId: result.transferredBorrowRecordId,
        newBorrowRecordId: result.record.id
      } : { borrower: borrower.name, borrowRecordId: result.record.id }
    });

    return res.status(201).json({
      ...buildBorrowResponse(result.record, result.equipment),
      isLastBorrower: true,
      currentAccountableFacultyName: result.previousAccountable?.name || null,
      previousAccountableFacultyName: result.previousAccountable?.name || null,
      transferredFrom: result.previousBorrower
        ? { name: result.previousBorrower.name, college: result.previousBorrower.college || null }
        : null,
      expectedReturnDate: result.expectedReturn.date,
      expectedReturnTime: result.expectedReturn.time
    });
  } catch (error) {
    console.error("Failed to complete Faculty QR borrowing.", error);
    return res.status(500).json({ error: "Unable to complete this equipment borrowing. Please try again." });
  }
};

export const approveBorrowRecord = async (req, res) => {
  const { id } = req.params;

  try {
    const record = await BorrowRecord.findByPk(id);
    if (!record) {
      return res.status(404).json({ error: "Borrow record not found." });
    }

    const scope = await getBorrowAccessScope(req);
    if (!scope.authenticated || !canAccessBorrowRecord(scope, record.campus)) {
      return res.status(403).json({ error: "You do not have permission to approve borrow records from another campus." });
    }

    const approver = await User.findByPk(scope.userId, { attributes: ["name"] });
    const approverName = approver?.name || (isAdminRole(scope.role) ? "Admin" : "Faculty");
    const result = await BorrowRecord.sequelize.transaction(async (transaction) => {
      const equipment = record.equipmentRecordId
        ? await Equipment.findByPk(record.equipmentRecordId, { transaction, lock: transaction.LOCK.UPDATE })
        : await Equipment.findOne({
            where: {
              equipmentId: record.equipmentId,
              campus: { [Op.in]: getCampusVariants(record.campus) }
            },
            transaction,
            lock: transaction.LOCK.UPDATE
          });
      if (!equipment || String(equipment.equipmentId) !== String(record.equipmentId) ||
          normalizeCampus(equipment.campus) !== normalizeCampus(record.campus)) {
        return { notFound: true };
      }
      const lockedRecord = await BorrowRecord.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE });
      if (!lockedRecord || String(lockedRecord.status || "").trim().toLowerCase() !== "pending") {
        return { processed: true };
      }
      const identity = await BorrowRequestAccountability.findByPk(lockedRecord.id, { transaction, lock: transaction.LOCK.UPDATE });
      const decisionAccess = await getBorrowDecisionAccess(scope, lockedRecord, identity, transaction);
      if (!decisionAccess.allowed) return { denied: true, decisionAccess };
      if (getBorrowRecordEffectiveStatus(lockedRecord.toJSON()) === "Overdue") return { expired: true };
      const studentQrHandoff = lockedRecord.remarks === "Student QR handoff request";
      const canHandoffBorrowedStatus = studentQrHandoff &&
        /^(borrowed|in use)$/i.test(String(equipment.status || "").trim());
      if (String(equipment.name || "") !== String(lockedRecord.equipmentName || "") ||
          (isUnavailableForBorrowing(equipment.status) && !canHandoffBorrowedStatus)) {
        return { unavailable: true };
      }

      if (studentQrHandoff) {
        if (!identity?.approvalRequired || !Number.isInteger(Number(identity.requesterUserId)) ||
            Number(identity.requesterUserId) <= 0) {
          return { invalidHandoff: true };
        }
        const requester = await User.findByPk(identity.requesterUserId, {
          attributes: ["id", "name", "role"],
          transaction
        });
        if (String(requester?.role || "").trim().toLowerCase() !== "student") {
          return { invalidHandoff: true };
        }
      }

      const activeRecords = await BorrowRecord.findAll({
        where: {
          equipmentId: lockedRecord.equipmentId,
          campus: { [Op.in]: getCampusVariants(lockedRecord.campus) },
          id: { [Op.ne]: lockedRecord.id },
          status: { [Op.in]: ["Pending", "Approved", "Borrowed"] }
        },
        transaction,
        lock: transaction.LOCK.UPDATE
      });
      const previousBorrowers = studentQrHandoff
        ? activeRecords.filter((activeRecord) => String(activeRecord.status || "").toLowerCase() === "borrowed")
        : [];
      if (studentQrHandoff && previousBorrowers.length > 1) return { unavailable: true };
      const requestStart = parseDateTime(lockedRecord.borrowDate, lockedRecord.borrowStartTime || "00:00");
      const requestEnd = lockedRecord.expectedReturnDate
        ? parseDateTime(lockedRecord.expectedReturnDate, lockedRecord.expectedReturnTime || "23:59")
        : Number.POSITIVE_INFINITY;
      const overlappingQuantity = activeRecords.reduce((total, activeRecord) => {
        if (studentQrHandoff && String(activeRecord.status || "").toLowerCase() === "borrowed") return total;
        const activeStart = parseDateTime(activeRecord.borrowDate, activeRecord.borrowStartTime || "00:00");
        const activeEnd = activeRecord.expectedReturnDate
          ? parseDateTime(activeRecord.expectedReturnDate, activeRecord.expectedReturnTime || "23:59")
          : Number.POSITIVE_INFINITY;
        return activeStart && activeEnd && hasTimeOverlap(requestStart, requestEnd, activeStart, activeEnd)
          ? total + Number(activeRecord.quantity || 1)
          : total;
      }, 0);
      if (overlappingQuantity + Number(lockedRecord.quantity || 1) > Number(equipment.quantity || 0)) {
        return { unavailable: true };
      }

      const borrowedAt = studentQrHandoff ? getCampusDateTime() : null;
      let transferFrom = null;
      if (studentQrHandoff && previousBorrowers.length) {
        const previousRecord = previousBorrowers[0];
        const previousIdentity = await BorrowRequestAccountability.findByPk(previousRecord.id, { transaction });
        if (Number(previousIdentity?.requesterUserId) === Number(identity.requesterUserId)) {
          return { alreadyBorrowed: true };
        }
        const previousBorrower = previousIdentity?.requesterUserId
          ? await User.findByPk(previousIdentity.requesterUserId, { attributes: ["name", "role"], transaction })
          : null;
        const transferRemarks = `Transferred to ${lockedRecord.borrowerName} via QR handoff after MR approval by ${approverName}.`;
        await previousRecord.update({
          status: "Returned",
          returnDate: borrowedAt.date,
          returnTime: borrowedAt.time,
          condition: "Good",
          remarks: transferRemarks,
          processedBy: approverName
        }, { transaction });
        await BorrowHistory.create({
          recordId: previousRecord.id,
          borrowerName: previousRecord.borrowerName,
          equipmentId: previousRecord.equipmentId,
          equipmentRecordId: equipment.id,
          serialNumber: equipment.serialNumber || null,
          equipmentName: previousRecord.equipmentName,
          borrowDate: previousRecord.borrowDate,
          borrowStartTime: previousRecord.borrowStartTime,
          returnDate: borrowedAt.date,
          returnTime: borrowedAt.time,
          expectedReturnTime: previousRecord.expectedReturnTime,
          purpose: previousRecord.purpose,
          condition: "Good",
          remarks: transferRemarks,
          processedBy: approverName,
          eventType: "returned"
        }, { transaction });
        transferFrom = {
          name: previousRecord.borrowerName,
          role: previousBorrower?.role || previousRecord.borrowerType || "Borrower",
          userId: previousIdentity?.requesterUserId || null
        };
      }

      await lockedRecord.update({
        status: studentQrHandoff ? "Borrowed" : "Approved",
        borrowDate: borrowedAt?.date || lockedRecord.borrowDate,
        borrowStartTime: borrowedAt?.time || lockedRecord.borrowStartTime,
        returnDate: studentQrHandoff ? null : lockedRecord.returnDate,
        returnTime: studentQrHandoff ? null : lockedRecord.returnTime,
        processedBy: approverName,
        remarks: studentQrHandoff ? null : lockedRecord.remarks
      }, { transaction });
      if (identity) {
        await identity.update({
          approvedByUserId: scope.userId,
          approvedAt: new Date(),
          rejectionReason: null
        }, { transaction });
      }
      if (studentQrHandoff) {
        const handoffRemarks = transferFrom
          ? `Borrowed directly via QR handoff from ${transferFrom.name} (${transferFrom.role}). MR approval by ${approverName}.`
          : `Borrowed via equipment QR after MR approval by ${approverName}.`;
        await BorrowHistory.create({
          recordId: lockedRecord.id,
          borrowerName: lockedRecord.borrowerName,
          equipmentId: lockedRecord.equipmentId,
          equipmentRecordId: equipment.id,
          serialNumber: equipment.serialNumber || null,
          equipmentName: lockedRecord.equipmentName,
          borrowDate: lockedRecord.borrowDate,
          borrowStartTime: lockedRecord.borrowStartTime,
          expectedReturnTime: lockedRecord.expectedReturnTime,
          purpose: lockedRecord.purpose,
          remarks: handoffRemarks,
          processedBy: approverName,
          eventType: "borrowed"
        }, { transaction });
      } else {
        await BorrowHistory.create({
          recordId: lockedRecord.id,
          borrowerName: lockedRecord.borrowerName,
          equipmentId: lockedRecord.equipmentId,
          equipmentRecordId: equipment.id,
          serialNumber: equipment.serialNumber || null,
          equipmentName: lockedRecord.equipmentName,
          borrowDate: lockedRecord.borrowDate,
          borrowStartTime: lockedRecord.borrowStartTime,
          expectedReturnTime: lockedRecord.expectedReturnTime,
          purpose: lockedRecord.purpose,
          remarks: `Borrow request approved by ${approverName}`,
          processedBy: approverName,
          eventType: "approved"
        }, { transaction });
      }
      return {
        updated: lockedRecord,
        equipment,
        studentQrHandoff,
        transferFrom,
        accountableFacultyUserId: identity?.accountableFacultyUserId || null
      };
    });
    if (result.notFound) return res.status(404).json({ error: "Equipment not found in the borrow record's campus." });
    if (result.processed) return res.status(409).json({ error: "This borrow request has already been processed." });
    if (result.invalidHandoff) return res.status(409).json({ error: "This student QR handoff request is invalid and cannot be approved." });
    if (result.alreadyBorrowed) return res.status(409).json({ error: "This Student already has this equipment borrowed." });
    if (result.denied) {
      if (result.decisionAccess.selfApproval) {
        return res.status(403).json({ error: "You cannot approve your own borrow request." });
      }
      if (result.decisionAccess.assignmentChanged) {
        return res.status(409).json({ error: "The accountable Faculty assignment changed. An administrator must review this request." });
      }
      return res.status(403).json({ error: "Only the accountable Faculty member or an administrator can approve this request." });
    }
    if (result.expired) return res.status(409).json({ error: "This request's return deadline has passed. Ask the requester to submit a new request." });
    if (result.unavailable) return res.status(409).json({ error: "Equipment is no longer available for borrowing." });
    const { updated, equipment } = result;

    const handoffDescription = result.studentQrHandoff
      ? result.transferFrom
        ? `${updated.borrowerName} took over ${updated.equipmentId} from ${result.transferFrom.name}; MR Faculty ${approverName} approved the QR handoff.`
        : `${updated.borrowerName} borrowed ${updated.equipmentId} through QR after MR Faculty ${approverName} approval.`
      : `Borrow request ${updated.id} for ${updated.equipmentId} was approved by ${approverName} for ${updated.borrowerName}. Status: Approved.`;
    await logAuditEntry(req, {
      action: result.studentQrHandoff ? "STUDENT_QR_HANDOFF_APPROVED" : "BORROW_REQUEST_APPROVED",
      module: "Borrow Management",
      resourceId: updated.id,
      description: handoffDescription,
      details: {
        borrowRecordId: updated.id,
        equipmentId: updated.equipmentId,
        borrowerName: updated.borrowerName,
        borrowerRole: updated.borrowerType,
        accountableFacultyUserId: result.studentQrHandoff ? result.accountableFacultyUserId : null,
        approvedByUserId: scope.userId,
        status: updated.status,
        transferredFrom: result.transferFrom?.name || null
      }
    });
    if (result.studentQrHandoff) {
      await logEquipmentBorrowAudit(req, {
        equipment,
        actionType: "borrowed",
        description: handoffDescription,
        beforeState: {
          borrowStatus: result.transferFrom ? "Borrowed" : null,
          previousBorrower: result.transferFrom?.name || null
        },
        afterState: {
          borrowRecordId: updated.id,
          borrowStatus: "Borrowed",
          borrowerName: updated.borrowerName,
          borrowerType: "Student",
          approvedBy: approverName,
          takenOverFrom: result.transferFrom?.name || null,
          takenOverFromRole: result.transferFrom?.role || null,
          purpose: updated.purpose || null,
          borrowDate: updated.borrowDate,
          borrowStartTime: updated.borrowStartTime
        }
      });
    }
    res.json(buildBorrowResponse(updated, equipment));
  } catch (error) {
    console.error("Failed to approve borrow request.", error);
    res.status(500).json({ error: "Failed to approve borrow request." });
  }
};

export const rejectBorrowRecord = async (req, res) => {
  const { id } = req.params;
  const { reason = "" } = req.body;
  const rejectionReason = String(reason || "").trim();
  if (!rejectionReason) {
    return res.status(400).json({ error: "A reason is required to reject a borrow request." });
  }

  try {
    const record = await BorrowRecord.findByPk(id);
    if (!record) {
      return res.status(404).json({ error: "Borrow record not found." });
    }

    const scope = await getBorrowAccessScope(req);
    if (!scope.authenticated || !canAccessBorrowRecord(scope, record.campus)) {
      return res.status(403).json({ error: "You do not have permission to reject borrow records from another campus." });
    }

    const approver = await User.findByPk(scope.userId, { attributes: ["name"] });
    const approverName = approver?.name || (isAdminRole(scope.role) ? "Admin" : "Faculty");
    const result = await BorrowRecord.sequelize.transaction(async (transaction) => {
      const equipment = record.equipmentRecordId
        ? await Equipment.findByPk(record.equipmentRecordId, { transaction, lock: transaction.LOCK.UPDATE })
        : await findEquipmentForBorrowRecord(record);
      const lockedRecord = await BorrowRecord.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE });
      if (!lockedRecord || String(lockedRecord.status || "").trim().toLowerCase() !== "pending") {
        return { processed: true };
      }
      const identity = await BorrowRequestAccountability.findByPk(lockedRecord.id, { transaction, lock: transaction.LOCK.UPDATE });
      const decisionAccess = await getBorrowDecisionAccess(scope, lockedRecord, identity, transaction);
      if (!decisionAccess.allowed) return { denied: true, decisionAccess };

      await lockedRecord.update({
        status: "Rejected",
        remarks: rejectionReason,
        processedBy: approverName
      }, { transaction });
      if (identity) {
        await identity.update({
          approvedByUserId: scope.userId,
          approvedAt: new Date(),
          rejectionReason
        }, { transaction });
      }
      return { updated: lockedRecord, equipment };
    });
    if (result.processed) return res.status(409).json({ error: "This borrow request has already been processed." });
    if (result.denied) {
      if (result.decisionAccess.selfApproval) {
        return res.status(403).json({ error: "You cannot reject your own borrow request." });
      }
      if (result.decisionAccess.assignmentChanged) {
        return res.status(409).json({ error: "The accountable Faculty assignment changed. An administrator must review this request." });
      }
      return res.status(403).json({ error: "Only the accountable Faculty member or an administrator can reject this request." });
    }
    const { updated, equipment } = result;

    await BorrowHistory.create({
      recordId: updated.id,
      borrowerName: updated.borrowerName,
      equipmentId: updated.equipmentId,
      equipmentRecordId: updated.equipmentRecordId,
      serialNumber: equipment?.serialNumber || updated.serialNumber,
      equipmentName: updated.equipmentName,
      borrowDate: updated.borrowDate,
      borrowStartTime: updated.borrowStartTime,
      expectedReturnTime: updated.expectedReturnTime,
      purpose: updated.purpose,
      remarks: rejectionReason || `Borrow request rejected by ${approverName}`,
      processedBy: updated.processedBy,
      eventType: "rejected"
    });

    await logAuditEntry(req, {
      action: "BORROW_REQUEST_REJECTED",
      module: "Borrow Management",
      resourceId: updated.id,
      description: `Borrow request ${updated.id} for ${updated.equipmentId} was rejected by ${approverName} for ${updated.borrowerName}. Reason: ${rejectionReason || "No reason provided"}.`
    });

    res.json(buildBorrowResponse(updated));
  } catch (error) {
    console.error("Failed to reject borrow request.", error);
    res.status(500).json({ error: "Failed to reject borrow request." });
  }
};

export const cancelBorrowRecord = async (req, res) => {
  const { id } = req.params;

  try {
    const scope = await getBorrowAccessScope(req);
    if (!scope.authenticated) return res.status(401).json({ error: "Please log in to cancel a borrow request." });

    const requester = await User.findByPk(scope.userId, { attributes: ["name"] });
    const requesterName = requester?.name || req.session?.userName || "Requester";
    const result = await BorrowRecord.sequelize.transaction(async (transaction) => {
      const record = await BorrowRecord.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE });
      if (!record) return { notFound: true };
      if (!canAccessBorrowRecord(scope, record.campus)) return { inaccessible: true };

      const identity = await BorrowRequestAccountability.findByPk(record.id, {
        transaction,
        lock: transaction.LOCK.UPDATE
      });
      if (!identity || Number(identity.requesterUserId) !== Number(scope.userId)) {
        return { notRequester: true };
      }
      if (String(record.status || "").trim().toLowerCase() !== "pending") {
        return { processed: true };
      }

      const remarks = "Borrow request cancelled by requester.";
      await record.update({
        status: "Cancelled",
        remarks,
        processedBy: requesterName
      }, { transaction });
      await BorrowHistory.create({
        recordId: record.id,
        borrowerName: record.borrowerName,
        equipmentId: record.equipmentId,
        equipmentRecordId: record.equipmentRecordId,
        serialNumber: record.serialNumber,
        equipmentName: record.equipmentName,
        borrowDate: record.borrowDate,
        borrowStartTime: record.borrowStartTime,
        expectedReturnTime: record.expectedReturnTime,
        purpose: record.purpose,
        remarks,
        processedBy: requesterName,
        eventType: "cancelled"
      }, { transaction });
      return { record };
    });

    if (result.notFound) return res.status(404).json({ error: "Borrow request not found." });
    if (result.inaccessible) return res.status(403).json({ error: "You do not have permission to cancel borrow requests from another campus." });
    if (result.notRequester) return res.status(403).json({ error: "You can only cancel your own borrow requests." });
    if (result.processed) return res.status(409).json({ error: "Only pending borrow requests can be cancelled." });

    await logAuditEntry(req, {
      action: "BORROW_REQUEST_CANCELLED",
      module: "Borrow Management",
      resourceId: result.record.id,
      description: `Borrow request ${result.record.id} for ${result.record.equipmentId} was cancelled by ${requesterName}.`
    });

    return res.json({ id: result.record.id, status: result.record.status });
  } catch (error) {
    console.error("Failed to cancel borrow request.", error);
    return res.status(500).json({ error: "Failed to cancel borrow request." });
  }
};

export const requestBorrowReturn = async (req, res) => {
  const { id } = req.params;
  const remarks = String(req.body?.remarks || "").trim();
  if (remarks.length > 500) {
    return res.status(400).json({ error: "Return notes must be 500 characters or fewer." });
  }

  try {
    const scope = await getBorrowAccessScope(req);
    if (!scope.authenticated) return res.status(401).json({ error: "Please log in to request an equipment return." });
    if (!["student", "faculty", "instructor"].includes(String(scope.role || "").trim().toLowerCase())) {
      return res.status(403).json({ error: "Only the borrower can request a return through this page." });
    }

    const user = await User.findByPk(scope.userId, { attributes: ["name"] });
    const snapshot = await BorrowRecord.findByPk(id);
    if (!snapshot) return res.status(404).json({ error: "Borrow record not found." });
    const result = await BorrowRecord.sequelize.transaction(async (transaction) => {
      const equipment = snapshot.equipmentRecordId
        ? await Equipment.findByPk(snapshot.equipmentRecordId, { transaction, lock: transaction.LOCK.UPDATE })
        : null;
      const record = await BorrowRecord.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE });
      if (!record) return { notFound: true };
      if (!canAccessBorrowRecord(scope, record.campus)) return { campusDenied: true };
      if (String(record.status || "").trim().toLowerCase() !== "borrowed") return { notBorrowed: true };

      const identity = await BorrowRequestAccountability.findByPk(record.id, { transaction });
      if (!identity || Number(identity.requesterUserId) !== Number(scope.userId)) return { notRequester: true };
      if (isFacultyRole(scope.role)) {
        const currentAccountability = equipment
          ? await EquipmentAssignment.findOne({
              where: {
                equipmentRecordId: equipment.id,
                facultyUserId: scope.userId,
                unassignedAt: null
              },
              order: [["assignedAt", "DESC"], ["id", "DESC"]],
              transaction,
              lock: transaction.LOCK.UPDATE
            })
          : null;
        if (!currentAccountability) return { notLastBorrower: true };
      }

      const existingRequest = await BorrowHistory.findOne({
        where: { recordId: record.id, eventType: "return_requested" },
        transaction,
        lock: transaction.LOCK.UPDATE
      });
      if (existingRequest) return { alreadyRequested: true, event: existingRequest };

      const requestedAt = new Date();
      const { date: returnDate, time: returnTime } = getCampusDateTime(requestedAt);
      await record.update({ returnDate, returnTime }, { transaction });
      const event = await BorrowHistory.create({
        recordId: record.id,
        borrowerName: record.borrowerName,
        equipmentId: record.equipmentId,
        equipmentRecordId: record.equipmentRecordId,
        serialNumber: record.serialNumber,
        equipmentName: record.equipmentName,
        borrowDate: record.borrowDate,
        borrowStartTime: record.borrowStartTime,
        returnDate,
        returnTime,
        expectedReturnTime: record.expectedReturnTime,
        condition: null,
        purpose: record.purpose,
        remarks: remarks || "Borrower requested to return the equipment.",
        processedBy: user?.name || record.borrowerName,
        eventType: "return_requested"
      }, { transaction });
      return { event, record, equipment, requestedAt, returnDate, returnTime };
    });

    if (result.notFound) return res.status(404).json({ error: "Borrow record not found." });
    if (result.campusDenied) return res.status(403).json({ error: "You do not have access to this campus." });
    if (result.notBorrowed) return res.status(409).json({ error: "Only released equipment can have a return request." });
    if (result.notRequester) return res.status(403).json({ error: "Only the borrower who submitted this request can request its return." });
    if (result.notLastBorrower) return res.status(403).json({ error: "Only the current last Faculty borrower who holds equipment accountability can request its return." });

    const event = result.event;
    if (!result.alreadyRequested) {
      await logAuditEntry(req, {
        action: "BORROW_RETURN_REQUESTED",
        module: "Borrow Management",
        resourceId: result.record.id,
        description: `${result.record.borrowerName} requested to return ${result.record.equipmentId}.`,
        details: {
          borrowRecordId: result.record.id,
          equipmentRecordId: result.record.equipmentRecordId,
          borrowerName: result.record.borrowerName,
          requestedAt: result.requestedAt.toISOString(),
          remarks
        }
      });
      await logEquipmentBorrowAudit(req, {
        equipment: result.equipment,
        actionType: "return_requested",
        description: `${result.record.borrowerName} marked ${result.record.equipmentId} for return at ${result.returnDate} ${result.returnTime}.`,
        beforeState: { borrowStatus: "Borrowed" },
        afterState: {
          borrowRecordId: result.record.id,
          borrowStatus: "Return Requested",
          borrowerName: result.record.borrowerName,
          returnDate: result.returnDate,
          returnTime: result.returnTime,
          remarks
        }
      });
    }
    return res.status(result.alreadyRequested ? 200 : 201).json({
      success: true,
      alreadyRequested: Boolean(result.alreadyRequested),
      returnRequestedAt: event.created_at || event.createdAt || result.requestedAt,
      returnDate: result.returnDate || event.returnDate || null,
      returnTime: result.returnTime || event.returnTime || null,
      returnRequestedBy: event.processedBy,
      returnRequestRemarks: event.remarks
    });
  } catch (error) {
    console.error("Failed to request equipment return.", error);
    return res.status(500).json({ error: "Failed to submit equipment return request." });
  }
};

export const getFacultyQrBorrowStatus = async (req, res) => {
  try {
    const scope = await getBorrowAccessScope(req);
    if (!scope.authenticated) return res.status(401).json({ error: "Please log in to view your QR borrow status." });
    if (!isFacultyRole(scope.role)) {
      return res.status(403).json({ error: "Only Faculty members can view QR borrow status." });
    }
    if (!scope.campus) return res.status(403).json({ error: "User campus is not assigned." });

    const equipment = await Equipment.findOne({
      where: {
        equipmentId: String(req.params.equipmentId || "").trim(),
        campus: { [Op.in]: getCampusVariants(scope.campus) }
      },
      attributes: ["id", "equipmentId"]
    });
    if (!equipment) return res.status(404).json({ error: "Equipment not found in your campus." });

    const record = await BorrowRecord.findOne({
      where: {
        equipmentRecordId: equipment.id,
        campus: { [Op.in]: getCampusVariants(scope.campus) },
        status: "Borrowed"
      },
      order: [["borrowDate", "DESC"], ["borrowStartTime", "DESC"], ["created_at", "DESC"]]
    });
    if (!record) return res.json({ activeBorrow: null });
    const identity = await BorrowRequestAccountability.findByPk(record.id);
    const currentBorrower = identity
      ? await User.findByPk(identity.requesterUserId, { attributes: ["id", "name", "college", "role"] })
      : null;

    const expectedReturn = record.expectedReturnDate
      ? new Date(`${String(record.expectedReturnDate).slice(0, 10)}T${String(record.expectedReturnTime || "23:59").slice(0, 5)}:00+08:00`)
      : null;
    return res.json({
      activeBorrow: {
        id: record.id,
        borrowerName: record.borrowerName || currentBorrower?.name || "Unknown borrower",
        borrowerCollege: record.departmentInfo || currentBorrower?.college || null,
        isFacultyBorrow: isFacultyRole(record.borrowerType) && isFacultyRole(currentBorrower?.role),
        isMine: Number(identity?.requesterUserId) === Number(scope.userId),
        expectedReturnDate: record.expectedReturnDate || null,
        expectedReturnTime: record.expectedReturnTime || null,
        isDue: Boolean(expectedReturn && expectedReturn <= new Date())
      }
    });
  } catch (error) {
    console.error("Failed to load Faculty QR borrow status.", error);
    return res.status(500).json({ error: "Failed to load QR borrow status." });
  }
};

export const getStudentQrBorrowStatus = async (req, res) => {
  try {
    const scope = await getBorrowAccessScope(req);
    if (!scope.authenticated) return res.status(401).json({ error: "Please log in to view your QR borrow status." });
    if (String(scope.role || "").trim().toLowerCase() !== "student") {
      return res.status(403).json({ error: "Only Students can view Student QR borrow status." });
    }
    if (!scope.campus) return res.status(403).json({ error: "User campus is not assigned." });

    const equipment = await Equipment.findOne({
      where: {
        equipmentId: String(req.params.equipmentId || "").trim(),
        campus: { [Op.in]: getCampusVariants(scope.campus) }
      },
      attributes: ["id", "equipmentId"]
    });
    if (!equipment) return res.status(404).json({ error: "Equipment not found in your campus." });

    const records = await BorrowRecord.findAll({
      where: {
        equipmentRecordId: equipment.id,
        campus: { [Op.in]: getCampusVariants(scope.campus) }
      },
      order: [["created_at", "DESC"], ["id", "DESC"]]
    });
    if (!records.length) return res.json({ request: null });

    const identities = await BorrowRequestAccountability.findAll({
      where: { borrowRecordId: { [Op.in]: records.map((record) => record.id) } }
    });
    const identityByRecord = new Map(identities.map((identity) => [String(identity.borrowRecordId), identity]));
    const latestRequest = records.find((record) =>
      Number(identityByRecord.get(String(record.id))?.requesterUserId) === Number(scope.userId)
    );
    if (!latestRequest) return res.json({ request: null });
    const identity = identityByRecord.get(String(latestRequest.id));
    const approver = identity?.approvedByUserId
      ? await User.findByPk(identity.approvedByUserId, { attributes: ["name"] })
      : null;

    return res.json({
      request: {
        id: latestRequest.id,
        status: latestRequest.status,
        reason: String(latestRequest.status || "").toLowerCase() === "rejected"
          ? identity?.rejectionReason || latestRequest.remarks || null
          : null,
        approvedByName: approver?.name || null,
        requestedAt: latestRequest.created_at || null
      }
    });
  } catch (error) {
    console.error("Failed to load Student QR borrow status.", error);
    return res.status(500).json({ error: "Failed to load QR borrow status." });
  }
};

export const releaseBorrowRecord = async (req, res) => {
  const { id } = req.params;

  try {
    const scope = await getBorrowAccessScope(req);
    if (!scope.authenticated) return res.status(401).json({ error: "Please log in to release equipment." });
    if (!isAdminRole(scope.role) && !isTechnicianRole(scope.role)) {
      return res.status(403).json({ error: "Only an administrator or technician can release equipment." });
    }

    const user = await User.findByPk(scope.userId, { attributes: ["name"] });
    const issuedBy = user?.name || (isAdminRole(scope.role) ? "Admin" : "Technician");
    const snapshot = await BorrowRecord.findByPk(id);
    if (!snapshot) return res.status(404).json({ error: "Borrow record not found." });
    if (!canAccessBorrowRecord(scope, snapshot.campus)) {
      return res.status(403).json({ error: "You do not have permission to release equipment from another campus." });
    }
    const result = await BorrowRecord.sequelize.transaction(async (transaction) => {
      const equipment = snapshot.equipmentRecordId
        ? await Equipment.findByPk(snapshot.equipmentRecordId, { transaction, lock: transaction.LOCK.UPDATE })
        : await Equipment.findOne({
            where: {
              equipmentId: snapshot.equipmentId,
              campus: { [Op.in]: getCampusVariants(snapshot.campus) },
              name: snapshot.equipmentName
            },
            transaction,
            lock: transaction.LOCK.UPDATE
          });
      const record = await BorrowRecord.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE });
      if (!record) return { notFound: true };
      if (!canAccessBorrowRecord(scope, record.campus)) return { denied: true };
      if (String(record.status || "").trim().toLowerCase() !== "approved") return { processed: true };
      if (getBorrowRecordEffectiveStatus(record.toJSON()) === "Overdue") return { expired: true };

      if (!equipment || String(equipment.equipmentId) !== String(record.equipmentId) ||
          normalizeCampus(equipment.campus) !== normalizeCampus(record.campus) ||
          String(equipment.name || "") !== String(record.equipmentName || "")) {
        return { unresolved: true };
      }

      const identity = await BorrowRequestAccountability.findByPk(record.id, { transaction, lock: transaction.LOCK.UPDATE });
      const requester = identity
        ? await User.findByPk(identity.requesterUserId, {
            attributes: ["id", "name", "email", "role"],
            transaction,
            lock: transaction.LOCK.UPDATE
          })
        : null;
      const facultyBorrow = isFacultyRole(record.borrowerType);
      if (facultyBorrow && (!identity || !requester || !isFacultyRole(requester.role))) {
        return { invalidFacultyBorrower: true };
      }

      const issuedAt = new Date();
      await record.update({ status: "Borrowed", processedBy: issuedBy }, { transaction });
      await BorrowHistory.create({
        recordId: record.id,
        borrowerName: record.borrowerName,
        equipmentId: record.equipmentId,
        equipmentRecordId: equipment.id,
        serialNumber: equipment.serialNumber || record.serialNumber,
        equipmentName: record.equipmentName,
        borrowDate: record.borrowDate,
        borrowStartTime: record.borrowStartTime,
        expectedReturnTime: record.expectedReturnTime,
        condition: equipment.condition || null,
        purpose: record.purpose,
        remarks: `Equipment released to ${record.borrowerName}. MR accountability was not changed.`,
        processedBy: issuedBy,
        eventType: "borrowed"
      }, { transaction });
      return { record, equipment, issuedAt, lastBorrowerName: requester?.name || record.borrowerName };
    });

    if (result.notFound) return res.status(404).json({ error: "Borrow record not found." });
    if (result.denied) return res.status(403).json({ error: "You do not have permission to release equipment from another campus." });
    if (result.processed) return res.status(409).json({ error: "Only an approved request can be released, and this request may already have been processed." });
    if (result.expired) return res.status(409).json({ error: "This approved request has passed its return deadline and can no longer be released." });
    if (result.unresolved) return res.status(409).json({ error: "The equipment reference could not be verified. Ask an administrator to review this record." });
    if (result.invalidFacultyBorrower) return res.status(409).json({ error: "The Faculty borrower could not be verified, so equipment accountability was not changed." });

    const { record, equipment, issuedAt, lastBorrowerName } = result;
    await logAuditEntry(req, {
      action: "BORROW_EQUIPMENT_RELEASED",
      module: "Borrow Management",
      resourceId: record.id,
      description: `${record.equipmentId} was released to ${record.borrowerName} by ${issuedBy}.`,
      details: {
        borrowRecordId: record.id,
        equipmentRecordId: equipment.id,
        borrowerName: record.borrowerName,
        quantity: record.quantity,
        releasedAt: issuedAt.toISOString(),
        releasedBy: issuedBy,
        accountabilityChanged: false
      }
    });
    await logEquipmentBorrowAudit(req, {
      equipment,
      actionType: "borrowed",
      description: `${record.quantity} unit(s) of ${record.equipmentId} were released to ${record.borrowerName} by ${issuedBy}. MR accountability was not changed.`,
      beforeState: { borrowStatus: "Approved" },
      afterState: {
        borrowRecordId: record.id,
        borrowStatus: "Borrowed",
        currentHolder: record.borrowerName,
        lastBorrower: lastBorrowerName,
        borrowerName: record.borrowerName,
        borrowerType: record.borrowerType,
        purpose: record.purpose || null,
        accountabilityChanged: false,
        quantity: record.quantity,
        releasedAt: issuedAt.toISOString(),
        releasedBy: issuedBy
      }
    });
    return res.json(buildBorrowResponse(record, equipment));
  } catch (error) {
    console.error("Failed to release borrow record.", error);
    return res.status(500).json({ error: "Failed to release equipment." });
  }
};

export const returnBorrowRecord = async (req, res) => {
  const { id } = req.params;
  const allowedConditions = new Set(["Good", "Needs Cleaning", "Minor Damage", "Damaged", "Lost"]);
  const condition = String(req.body?.condition || "Good").trim();
  const remarks = String(req.body?.remarks || "").trim();
  if (!allowedConditions.has(condition)) {
    return res.status(400).json({ error: "Select a valid condition for the returned equipment." });
  }

  try {
    const scope = await getBorrowAccessScope(req);
    if (!scope.authenticated) return res.status(401).json({ error: "Please log in to process equipment returns." });
    const facultySelfReturn = isFacultyRole(scope.role);
    const studentSelfReturn = String(scope.role || "").trim().toLowerCase() === "student";
    if (!isAdminRole(scope.role) && !isTechnicianRole(scope.role) && !facultySelfReturn && !studentSelfReturn) {
      return res.status(403).json({ error: "Only the borrower, an administrator, or a technician can return equipment." });
    }
    if ((facultySelfReturn || studentSelfReturn) && condition !== "Good") {
      return res.status(400).json({ error: "Borrower self-service returns can only be marked as returned in good condition. Submit an equipment issue report for damage or loss." });
    }

    const snapshot = await BorrowRecord.findByPk(id);
    if (!snapshot) return res.status(404).json({ error: "Borrow record not found." });
    if (!canAccessBorrowRecord(scope, snapshot.campus)) {
      return res.status(403).json({ error: "You do not have permission to process returns from another campus." });
    }
    let facultyMirReturn = false;
    let studentOwnReturn = false;
    if (facultySelfReturn) {
      const identity = await BorrowRequestAccountability.findByPk(snapshot.id);
      if (identity && Number(identity.requesterUserId) === Number(scope.userId) && isFacultyRole(snapshot.borrowerType)) {
        facultyMirReturn = false;
      } else if (identity && Number(identity.accountableFacultyUserId) === Number(scope.userId) &&
          String(snapshot.borrowerType || "").trim().toLowerCase() === "student") {
        const requester = await User.findByPk(identity.requesterUserId, { attributes: ["role"] });
        const assignment = snapshot.equipmentRecordId
          ? await EquipmentAssignment.findOne({
              where: { equipmentRecordId: snapshot.equipmentRecordId, facultyUserId: scope.userId, unassignedAt: null },
              attributes: ["id"]
            })
          : null;
        if (String(requester?.role || "").trim().toLowerCase() !== "student" || !assignment) {
          return res.status(403).json({ error: "Only the currently accountable MR Faculty member can mark this Student's equipment as returned." });
        }
        facultyMirReturn = true;
      } else {
        return res.status(403).json({ error: "You can only mark your own Faculty borrow as returned." });
      }
    }
    if (studentSelfReturn) {
      const identity = await BorrowRequestAccountability.findByPk(snapshot.id);
      if (!identity || Number(identity.requesterUserId) !== Number(scope.userId) ||
          String(snapshot.borrowerType || "").trim().toLowerCase() !== "student") {
        return res.status(403).json({ error: "You can only mark your own Student borrow as returned." });
      }
      studentOwnReturn = true;
    }
    const user = await User.findByPk(scope.userId, { attributes: ["name"] });
    const receivedBy = user?.name || (studentSelfReturn ? "Student" : facultySelfReturn ? "Faculty member" : isAdminRole(scope.role) ? "Admin" : "Technician");
    const result = await BorrowRecord.sequelize.transaction(async (transaction) => {
      const equipment = snapshot.equipmentRecordId
        ? await Equipment.findByPk(snapshot.equipmentRecordId, { transaction, lock: transaction.LOCK.UPDATE })
        : await Equipment.findOne({
            where: {
              equipmentId: snapshot.equipmentId,
              campus: { [Op.in]: getCampusVariants(snapshot.campus) },
              name: snapshot.equipmentName
            },
            transaction,
            lock: transaction.LOCK.UPDATE
          });
      const record = await BorrowRecord.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE });
      if (!record) return { notFound: true };
      if (!canAccessBorrowRecord(scope, record.campus)) return { denied: true };
      if (facultySelfReturn && !facultyMirReturn) {
        const identity = await BorrowRequestAccountability.findByPk(record.id, { transaction, lock: transaction.LOCK.UPDATE });
        if (!identity || Number(identity.requesterUserId) !== Number(scope.userId) || !isFacultyRole(record.borrowerType)) {
          return { denied: true };
        }
      }
      if (studentSelfReturn) {
        const identity = await BorrowRequestAccountability.findByPk(record.id, { transaction, lock: transaction.LOCK.UPDATE });
        if (!identity || Number(identity.requesterUserId) !== Number(scope.userId) ||
            String(record.borrowerType || "").trim().toLowerCase() !== "student") {
          return { denied: true };
        }
      }
      if (facultyMirReturn) {
        const identity = await BorrowRequestAccountability.findByPk(record.id, { transaction, lock: transaction.LOCK.UPDATE });
        const requester = identity?.requesterUserId
          ? await User.findByPk(identity.requesterUserId, { attributes: ["role"], transaction })
          : null;
        const assignment = record.equipmentRecordId
          ? await EquipmentAssignment.findOne({
              where: { equipmentRecordId: record.equipmentRecordId, facultyUserId: scope.userId, unassignedAt: null },
              transaction,
              lock: transaction.LOCK.UPDATE
            })
          : null;
        if (!identity || Number(identity.accountableFacultyUserId) !== Number(scope.userId) ||
            String(record.borrowerType || "").trim().toLowerCase() !== "student" ||
            String(requester?.role || "").trim().toLowerCase() !== "student" || !assignment) {
          return { denied: true };
        }
      }
      if (String(record.status || "").trim().toLowerCase() !== "borrowed") return { notBorrowed: true };

      if (!equipment || String(equipment.equipmentId) !== String(record.equipmentId) ||
          normalizeCampus(equipment.campus) !== normalizeCampus(record.campus) ||
          String(equipment.name || "") !== String(record.equipmentName || "")) {
        return { unresolved: true };
      }

      const returnedAt = new Date();
      const { date: returnDate, time: returnTime } = getCampusDateTime(returnedAt);
      const status = condition === "Lost" ? "Pending Replacement" : "Returned";
      await record.update({
        status,
        returnDate,
        returnTime,
        condition,
        remarks: facultySelfReturn
          ? facultyMirReturn
            ? `Marked returned by accountable MR Faculty member ${receivedBy}.`
            : "Marked returned by the borrowing Faculty member via equipment QR scan."
          : studentOwnReturn
            ? "Marked returned by the borrowing Student via equipment QR scan."
            : remarks,
        processedBy: receivedBy
      }, { transaction });
      if (condition === "Lost") {
        const remainingQuantity = Math.max(0, Number(equipment.quantity || 0) - Number(record.quantity || 1));
        await equipment.update({
          quantity: remainingQuantity,
          ...(remainingQuantity === 0 ? { status: "Lost" } : {})
        }, { transaction });
      }
      await BorrowHistory.create({
        recordId: record.id,
        borrowerName: record.borrowerName,
        equipmentId: record.equipmentId,
        equipmentRecordId: equipment.id,
        serialNumber: equipment.serialNumber || record.serialNumber,
        equipmentName: record.equipmentName,
        borrowDate: record.borrowDate,
        borrowStartTime: record.borrowStartTime,
        returnDate: record.returnDate,
        returnTime: record.returnTime,
        expectedReturnTime: record.expectedReturnTime,
        condition,
        purpose: record.purpose,
        remarks: facultySelfReturn
          ? facultyMirReturn
            ? `Equipment borrowed by ${record.borrowerName} was marked returned by accountable MR Faculty member ${receivedBy}.`
            : `Equipment marked returned by ${record.borrowerName} via QR scan.`
          : studentOwnReturn
            ? `Equipment marked returned by borrowing Student ${record.borrowerName} via QR scan.`
            : remarks || `Equipment returned by ${record.borrowerName}.`,
        processedBy: receivedBy,
        eventType: condition === "Lost" ? "lost" : "returned"
      }, { transaction });

      if (condition === "Damaged" || condition === "Minor Damage") {
        await MaintenanceRequest.create({
          equipmentId: record.equipmentId,
          equipmentName: record.equipmentName,
          issueTitle: `Equipment returned damaged: ${record.equipmentName}`,
          description: remarks || `Equipment returned in ${condition.toLowerCase()} condition during borrow record ${record.id}`,
          category: "Equipment Damage",
          priority: condition === "Damaged" ? "High" : "Low",
          status: "Pending",
          campus: record.campus,
          dateReported: returnedAt,
          reportedBy: null
        }, { transaction });
      }
      return { record, equipment, returnedAt, beforeStatus: "Borrowed" };
    });

    if (result.notFound) return res.status(404).json({ error: "Borrow record not found." });
    if (result.denied) return res.status(403).json({ error: "You do not have permission to process returns from another campus." });
    if (result.notBorrowed) return res.status(409).json({ error: "Only equipment that has been released can be returned." });
    if (result.unresolved) return res.status(409).json({ error: "The equipment reference could not be verified. Ask an administrator to review this record." });
    const { record: updated, equipment: resolvedEquipment, returnedAt } = result;

    await logAuditEntry(req, {
      action: condition === "Lost" ? "BORROW_EQUIPMENT_REPORTED_LOST" : "BORROW_EQUIPMENT_RETURNED",
      module: "Borrow Management",
      resourceId: updated.id,
      description: facultySelfReturn
        ? facultyMirReturn
          ? `${updated.equipmentId} borrowed by Student ${updated.borrowerName} was marked returned by accountable MR Faculty member ${receivedBy}.`
          : `${updated.equipmentId} was marked returned by borrowing Faculty member ${updated.borrowerName}.`
        : studentOwnReturn
          ? `${updated.equipmentId} was marked returned by borrowing Student ${updated.borrowerName}.`
        : `${updated.equipmentId} was ${condition === "Lost" ? "reported lost" : "returned"} by ${updated.borrowerName}; received by ${receivedBy}. Condition: ${condition}.`,
      details: {
        borrowRecordId: updated.id,
        equipmentRecordId: resolvedEquipment.id,
        borrowerName: updated.borrowerName,
        condition,
        returnedAt: returnedAt.toISOString(),
        receivedBy
      }
    });

    await logEquipmentBorrowAudit(req, {
      equipment: resolvedEquipment,
      actionType: condition === "Lost" ? "status_changed" : "returned",
      description: `Equipment ${updated.equipmentId} was ${condition === "Lost" ? "reported lost" : "returned"} by ${updated.borrowerName} in ${condition} condition; received by ${receivedBy}.`,
      beforeState: { borrowStatus: "Borrowed" },
      afterState: {
        status: updated.status,
        condition: updated.condition,
        returnDate: updated.returnDate,
        returnTime: updated.returnTime,
        remarks: updated.remarks,
        receivedBy
      }
    });

    res.json(buildBorrowResponse(updated, resolvedEquipment));
  } catch (error) {
    console.error("Failed to update borrow return.", error);
    res.status(500).json({ error: "Failed to update borrow return." });
  }
};

export const markBorrowRecordLost = async (req, res) => {
  const { id } = req.params;

  try {
    const scope = await getBorrowAccessScope(req);
    if (!scope.authenticated || !isTechnicianRole(scope.role)) {
      return res.status(403).json({ error: "Only technicians for this campus can mark equipment as lost." });
    }
    const snapshot = await BorrowRecord.findByPk(id);
    if (!snapshot) return res.status(404).json({ error: "Borrow record not found." });
    if (!canAccessBorrowRecord(scope, snapshot.campus)) {
      return res.status(403).json({ error: "Only technicians for this campus can mark equipment as lost." });
    }
    if (String(snapshot.status || "").trim().toLowerCase() !== "borrowed" ||
        getBorrowRecordEffectiveStatus(snapshot.toJSON()) !== "Overdue") {
      return res.status(409).json({ error: "Only overdue equipment can be marked as lost." });
    }

    const user = await User.findByPk(scope.userId, { attributes: ["name"] });
    const processedBy = user?.name || "Technician";
    const result = await BorrowRecord.sequelize.transaction(async (transaction) => {
      const equipment = snapshot.equipmentRecordId
        ? await Equipment.findByPk(snapshot.equipmentRecordId, { transaction, lock: transaction.LOCK.UPDATE })
        : await Equipment.findOne({
            where: {
              equipmentId: snapshot.equipmentId,
              campus: { [Op.in]: getCampusVariants(snapshot.campus) },
              name: snapshot.equipmentName
            },
            transaction,
            lock: transaction.LOCK.UPDATE
          });
      const record = await BorrowRecord.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE });
      if (!record || String(record.status || "").trim().toLowerCase() !== "borrowed" ||
          getBorrowRecordEffectiveStatus(record.toJSON()) !== "Overdue") {
        return { processed: true };
      }
      if (!equipment || String(equipment.equipmentId) !== String(record.equipmentId) ||
          normalizeCampus(equipment.campus) !== normalizeCampus(record.campus) ||
          String(equipment.name || "") !== String(record.equipmentName || "")) {
        return { unresolved: true };
      }
      const remainingQuantity = Math.max(0, Number(equipment.quantity || 0) - Number(record.quantity || 1));
      await equipment.update({
        quantity: remainingQuantity,
        ...(remainingQuantity === 0 ? { status: "Lost" } : {})
      }, { transaction });
      await record.update({
        status: "Lost",
        remarks: String(record.remarks || "").trim() || "Marked lost by technician after overdue confirmation.",
        processedBy
      }, { transaction });
      await BorrowHistory.create({
        recordId: record.id,
        borrowerName: record.borrowerName,
        equipmentId: record.equipmentId,
        equipmentRecordId: equipment.id,
        serialNumber: equipment.serialNumber || record.serialNumber,
        equipmentName: record.equipmentName,
        borrowDate: record.borrowDate,
        borrowStartTime: record.borrowStartTime,
        returnDate: record.returnDate,
        expectedReturnTime: record.expectedReturnTime,
        condition: "Lost",
        purpose: record.purpose,
        remarks: record.remarks,
        processedBy,
        eventType: "lost"
      }, { transaction });
      return { record, equipment };
    });
    if (result.processed) return res.status(409).json({ error: "This equipment is already no longer overdue or has been processed." });
    if (result.unresolved) return res.status(409).json({ error: "The equipment reference could not be verified. Ask an administrator to review this record." });
    const { record: updated, equipment } = result;

    await logAuditEntry(req, {
      action: "Marked Equipment as Lost",
      module: "Borrow Management",
      resourceId: updated.id,
      description: `Technician marked ${updated.equipmentId} (${updated.equipmentName}) as Lost for borrower ${updated.borrowerName} in ${updated.campus}.`,
      actorName: processedBy,
      actorRole: "Technician"
    });
    await logEquipmentBorrowAudit(req, {
      equipment,
      actionType: "status_changed",
      description: `Equipment ${updated.equipmentId} was marked Lost for borrower ${updated.borrowerName}.`,
      beforeState: { status: record.status },
      afterState: { status: updated.status, borrowRecordId: updated.id }
    });

    res.json(buildBorrowResponse(updated, equipment));
  } catch (error) {
    console.error("Failed to mark borrow record as lost.", error);
    res.status(500).json({ error: "Failed to mark equipment as lost." });
  }
};

export const getBorrowHistory = async (req, res) => {
  const { id } = req.params;

  try {
    const scope = await getBorrowAccessScope(req);
    if (!scope.authenticated) return res.status(401).json({ error: "Please log in to view borrow history." });
    const strictWhere = getStrictBorrowWhere(scope);
    if (!strictWhere) return res.status(403).json({ error: "User campus is not assigned." });

    const record = await BorrowRecord.findOne({ where: { id, ...strictWhere } });
    if (!record) return res.status(404).json({ error: "Borrow record not found." });

    const history = await BorrowHistory.findAll({ where: { recordId: id }, order: [["created_at", "ASC"]] });
    res.json(history.map((entry) => entry.toJSON()));
  } catch (error) {
    console.error("Failed to load borrow history.", error);
    res.status(500).json({ error: "Failed to load borrow history." });
  }
};
