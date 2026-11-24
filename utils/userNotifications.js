import { col, Op } from "sequelize";
import { User } from "../models/userModel.js";
import { UserNotification } from "../models/userNotificationModel.js";
import { BorrowHistory, BorrowRecord } from "../models/borrowRecordModel.js";
import { BorrowRequestAccountability } from "../models/borrowRequestAccountabilityModel.js";
import { Equipment } from "../models/equipmentModel.js";
import { EquipmentAssignment } from "../models/equipmentAssignmentModel.js";
import EquipmentTechnicianReport from "../models/equipmentTechnicianReportModel.js";
import { MaintenanceRequest } from "../models/maintenanceRequestModel.js";
import { getArchivedEntityIds } from "../models/archiveRecords.js";

const CAMPUS_ROLES = {
  admin: ["admin", "administrator"],
  technician: ["technician", "laboratory technician", "lab technician"]
};

function getCampusVariants(campus) {
  const normalized = String(campus || "").trim();
  const shortName = normalized.replace(/\s*Campus\s*$/i, "").trim();
  return [...new Set([normalized, shortName, `${shortName} Campus`].filter(Boolean))];
}

export async function getCampusUserIds(campus, roles) {
  const campusVariants = getCampusVariants(campus);
  const roleNames = [...new Set((roles || []).map((role) => String(role || "").trim().toLowerCase()).filter(Boolean))];
  if (!campusVariants.length || !roleNames.length) return [];

  const users = await User.findAll({
    where: {
      campus: { [Op.in]: campusVariants },
      role: { [Op.in]: roleNames }
    },
    attributes: ["id"],
    raw: true
  });
  return users.map((user) => Number(user.id)).filter((id) => Number.isInteger(id) && id > 0);
}

export async function createUserNotifications({
  recipientIds,
  eventKey,
  type,
  title,
  message,
  targetUrl,
  campus = null,
  transaction
}) {
  return createUserNotificationsBatch([{
    recipientIds,
    eventKey,
    type,
    title,
    message,
    targetUrl,
    campus
  }], { transaction });
}

export async function createUserNotificationsBatch(events, { transaction } = {}) {
  const rows = (events || []).flatMap((event) => {
    const userIds = [...new Set((event.recipientIds || []).map(Number).filter((id) => Number.isInteger(id) && id > 0))];
    if (!userIds.length) return [];
    if (!event.eventKey || !event.type || !event.title || !event.message || !event.targetUrl) {
      throw new Error("A notification event key, type, title, message, and target URL are required.");
    }
    return userIds.map((recipientUserId) => ({
      recipientUserId,
      eventKey: `${String(event.eventKey).slice(0, 170)}:u${recipientUserId}`,
      sourceKey: event.sourceKey || getNotificationSourceKey(event.eventKey, event.type, event.targetUrl),
      type: event.type,
      title: event.title,
      message: event.message,
      targetUrl: event.targetUrl,
      campus: event.campus || null,
      ...(event.createdAt ? { created_at: event.createdAt } : {})
    }));
  });
  if (!rows.length) return;
  try {
    const recipientIds = [...new Set(rows.map((row) => row.recipientUserId))];
    const sourceKeys = [...new Set(rows.map((row) => row.sourceKey))];
    const mutedSources = await UserNotification.findAll({
      where: {
        recipientUserId: { [Op.in]: recipientIds },
        sourceKey: { [Op.in]: sourceKeys },
        mutedAt: { [Op.not]: null }
      },
      attributes: ["recipientUserId", "sourceKey"],
      raw: true,
      transaction
    });
    const mutedSourceKeys = new Set(
      mutedSources.map((row) => `${row.recipientUserId}:${row.sourceKey}`)
    );
    const unmutedRows = rows.filter(
      (row) => !mutedSourceKeys.has(`${row.recipientUserId}:${row.sourceKey}`)
    );
    if (!unmutedRows.length) return;
    await UserNotification.bulkCreate(unmutedRows, {
      updateOnDuplicate: ["type", "title", "message", "targetUrl", "campus", "created_at"],
      transaction
    });
  } catch (error) {
    console.error(`[notifications] Failed to create ${rows.length} notification(s).`, error);
    throw error;
  }
}

export function getNotificationSourceKey(eventKey, type, targetUrl) {
  const normalizedType = String(type || "").trim().toLowerCase();
  const target = new URL(String(targetUrl || ""), "http://comlab.local");
  const targetId = normalizedType.startsWith("borrow")
    ? target.searchParams.get("borrowRecordId")
    : normalizedType.startsWith("maintenance")
      ? target.searchParams.get("maintenanceId")
      : normalizedType === "technician_report"
        ? target.searchParams.get("reportId")
        : null;
  if (targetId) {
    const prefix = normalizedType.startsWith("borrow")
      ? "borrow"
      : normalizedType.startsWith("maintenance")
        ? "maintenance"
        : "technician-report";
    return `${prefix}:${targetId}`;
  }
  const [category, sourceId] = String(eventKey || "").replace(/:u\d+$/, "").split(":");
  return category && sourceId ? `${category}:${sourceId}` : String(eventKey || "");
}

function getRoleName(role) {
  return String(role || "").trim().toLowerCase();
}

function getStatusNotification(status) {
  const normalized = String(status || "").trim().toLowerCase();
  if (normalized === "approved") return "approved";
  if (normalized === "rejected") return "rejected";
  if (normalized === "cancelled" || normalized === "canceled") return "cancelled";
  if (normalized === "borrowed") return "released";
  if (normalized === "returned") return "returned";
  if (normalized === "lost" || normalized === "pending replacement") return "lost";
  return null;
}

function getDateEventKey(value) {
  const timestamp = new Date(value || Date.now()).getTime();
  return Number.isFinite(timestamp) ? String(timestamp) : "latest";
}

async function getExistingPendingBorrowRecordIds(userId) {
  const suffix = `:pending:u${userId}`;
  const notifications = await UserNotification.findAll({
    where: {
      recipientUserId: userId,
      eventKey: { [Op.like]: `borrow:%${suffix}` },
      hiddenAt: null,
      deletedAt: null
    },
    attributes: ["eventKey"],
    order: [["id", "DESC"]],
    limit: 50,
    raw: true
  });
  return [...new Set(
    notifications
      .map(({ eventKey }) => {
        const value = String(eventKey || "");
        return value.startsWith("borrow:") && value.endsWith(suffix)
          ? value.slice("borrow:".length, -suffix.length)
          : "";
      })
      .filter((recordId) => /^\d+$/.test(recordId))
  )];
}

async function syncBorrowNotificationsForUser(user, events) {
  const userId = Number(user.id);
  const role = getRoleName(user.role);
  const campusVariants = getCampusVariants(user.campus);
  const isCampusAdmin = CAMPUS_ROLES.admin.includes(role);

  if (isCampusAdmin || (CAMPUS_ROLES.technician.includes(role) && campusVariants.length)) {
    const existingRecordIds = await getExistingPendingBorrowRecordIds(userId);
    const [pendingRecords, existingRecords] = await Promise.all([
      BorrowRecord.findAll({
        where: {
          ...(campusVariants.length ? { campus: { [Op.in]: campusVariants } } : {}),
          status: "Pending"
        },
        order: [["created_at", "DESC"]],
        limit: 100
      }),
      existingRecordIds.length
        ? BorrowRecord.findAll({
          where: {
            id: { [Op.in]: existingRecordIds },
            ...(campusVariants.length ? { campus: { [Op.in]: campusVariants } } : {})
          }
        })
        : []
    ]);
    const records = [...new Map([...pendingRecords, ...existingRecords]
      .map((record) => [String(record.id), record])).values()];
    records.forEach((record) => {
      const isPending = String(record.status || "").toLowerCase() === "pending";
      events.push({
        recipientIds: [userId],
        eventKey: `borrow:${record.id}:pending`,
        type: "borrow_request",
        title: isPending ? "New borrow request" : "Borrow request status updated",
        message: `${record.borrowerName} requested ${record.equipmentId} — ${record.equipmentName}.${isPending ? "" : ` Current status: ${record.status}.`}`,
        targetUrl: getBorrowNotificationTarget(role, record.id),
        campus: record.campus,
        createdAt: isPending ? record.created_at : record.updated_at || record.created_at
      });
    });

    const borrowedRecords = await BorrowRecord.findAll({
      where: {
        ...(campusVariants.length ? { campus: { [Op.in]: campusVariants } } : {}),
        status: "Borrowed"
      },
      attributes: ["id", "borrowerName", "equipmentId", "equipmentName", "campus"],
      order: [["created_at", "DESC"]],
      limit: 200
    });
    if (borrowedRecords.length) {
      const returnEvents = await BorrowHistory.findAll({
        where: {
          recordId: { [Op.in]: borrowedRecords.map((record) => record.id) },
          eventType: "return_requested"
        },
        order: [["created_at", "DESC"], ["id", "DESC"]]
      });
      const borrowedById = new Map(borrowedRecords.map((record) => [String(record.id), record]));
      returnEvents.forEach((event) => {
        const record = borrowedById.get(String(event.recordId));
        if (!record) return;
        events.push({
          recipientIds: [userId],
          eventKey: `borrow-return:${event.id}`,
          type: "borrow_return_request",
          title: "Equipment return requested",
          message: `${event.processedBy || record.borrowerName} requested to return ${record.equipmentId} — ${record.equipmentName}.`,
          targetUrl: getBorrowNotificationTarget(role, record.id),
          campus: record.campus,
          createdAt: event.created_at
        });
      });
    }
  }

  if (["faculty", "instructor"].includes(role)) {
    const assignedIdentities = await BorrowRequestAccountability.findAll({
      where: { accountableFacultyUserId: userId },
      attributes: ["borrowRecordId"]
    });
    const assignedRecordIds = assignedIdentities.map((identity) => identity.borrowRecordId).filter(Boolean);
    if (assignedRecordIds.length) {
      const existingRecordIds = await getExistingPendingBorrowRecordIds(userId);
      const [pendingRecords, existingRecords] = await Promise.all([
        BorrowRecord.findAll({
          where: {
            id: { [Op.in]: assignedRecordIds },
            ...(campusVariants.length ? { campus: { [Op.in]: campusVariants } } : {}),
            status: "Pending"
          },
          order: [["created_at", "DESC"]],
          limit: 100
        }),
        existingRecordIds.length
          ? BorrowRecord.findAll({
            where: {
              id: { [Op.in]: existingRecordIds.filter((recordId) =>
                assignedRecordIds.some((assignedId) => String(assignedId) === recordId)
              ) },
              ...(campusVariants.length ? { campus: { [Op.in]: campusVariants } } : {})
            }
          })
          : []
      ]);
      const records = [...new Map([...pendingRecords, ...existingRecords]
        .map((record) => [String(record.id), record])).values()];
      records.forEach((record) => {
        const isPending = String(record.status || "").toLowerCase() === "pending";
        events.push({
          recipientIds: [userId],
          eventKey: `borrow:${record.id}:pending`,
          type: "borrow_request",
          title: isPending ? "Borrow request needs your review" : "Borrow request status updated",
          message: `${record.borrowerName} requested ${record.equipmentId} — ${record.equipmentName}.${isPending ? "" : ` Current status: ${record.status}.`}`,
          targetUrl: getBorrowNotificationTarget(role, record.id),
          campus: record.campus,
          createdAt: isPending ? record.created_at : record.updated_at || record.created_at
        });
      });

      const borrowedRecords = await BorrowRecord.findAll({
        where: {
          id: { [Op.in]: assignedRecordIds },
          ...(campusVariants.length ? { campus: { [Op.in]: campusVariants } } : {}),
          status: "Borrowed"
        },
        attributes: ["id", "borrowerName", "equipmentId", "equipmentName", "campus"],
        limit: 200
      });
      if (borrowedRecords.length) {
        const returnEvents = await BorrowHistory.findAll({
          where: {
            recordId: { [Op.in]: borrowedRecords.map((record) => record.id) },
            eventType: "return_requested"
          },
          order: [["created_at", "DESC"], ["id", "DESC"]]
        });
        const recordsById = new Map(borrowedRecords.map((record) => [String(record.id), record]));
        returnEvents.forEach((event) => {
          const record = recordsById.get(String(event.recordId));
          if (!record) return;
          events.push({
            recipientIds: [userId],
            eventKey: `borrow-return:${event.id}`,
            type: "borrow_return_request",
            title: "Student return request",
            message: `${event.processedBy || record.borrowerName} requested to return ${record.equipmentId} — ${record.equipmentName}.`,
            targetUrl: getBorrowNotificationTarget(role, record.id),
            campus: record.campus,
            createdAt: event.created_at
          });
        });
      }
    }

    const activeAssignments = await EquipmentAssignment.findAll({
      where: { facultyUserId: userId, unassignedAt: null },
      attributes: ["equipmentRecordId"]
    });
    const equipmentRecordIds = activeAssignments.map((assignment) => Number(assignment.equipmentRecordId)).filter(Number.isInteger);
    if (equipmentRecordIds.length) {
      const assignedEquipment = await Equipment.findAll({
        where: { id: { [Op.in]: equipmentRecordIds } },
        attributes: ["equipmentId"]
      });
      const equipmentIds = assignedEquipment.map((item) => item.equipmentId).filter(Boolean);
      if (equipmentIds.length) {
        const reports = await MaintenanceRequest.findAll({
          where: {
            ...(campusVariants.length ? { campus: { [Op.in]: campusVariants } } : {}),
            [Op.or]: [{ equipmentId: { [Op.in]: equipmentIds } }, { equipment_id: { [Op.in]: equipmentIds } }],
            status: { [Op.in]: ["Pending", "In Progress"] },
            id: { [Op.notIn]: await getArchivedEntityIds("maintenance-report") }
          },
          order: [["created_at", "DESC"]],
          limit: 100
        });
        reports.forEach((report) => events.push({
          recipientIds: [userId],
          eventKey: `maintenance:${report.id}:created`,
          type: "maintenance_report",
          title: "Report on your assigned equipment",
          message: `${report.issueTitle || report.equipmentId || report.equipment_id}: ${report.description}`,
          targetUrl: getMaintenanceNotificationTarget(role, report.id),
          campus: report.campus,
          createdAt: report.created_at
        }));
      }
    }
  }

  if (["student", "faculty", "instructor"].includes(role)) {
    const identities = await BorrowRequestAccountability.findAll({
      where: { requesterUserId: userId },
      attributes: ["borrowRecordId"]
    });
    const recordIds = identities.map((identity) => identity.borrowRecordId).filter(Boolean);
    if (recordIds.length) {
      const recentCutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const submittedEventSuffix = `:submitted:u${userId}`;
      const existingSubmittedNotifications = await UserNotification.findAll({
        where: {
          recipientUserId: userId,
          eventKey: { [Op.like]: `borrow:%${submittedEventSuffix}` }
        },
        attributes: ["eventKey"],
        raw: true
      });
      const existingSubmittedRecordIds = existingSubmittedNotifications
        .map(({ eventKey }) => {
          const value = String(eventKey || "");
          return value.startsWith("borrow:") && value.endsWith(submittedEventSuffix)
            ? value.slice("borrow:".length, -submittedEventSuffix.length)
            : "";
        })
        .filter(Boolean);
      const submittedRecords = await BorrowRecord.findAll({
        where: {
          id: { [Op.in]: [...new Set([...recordIds, ...existingSubmittedRecordIds])] },
          ...(campusVariants.length ? { campus: { [Op.in]: campusVariants } } : {}),
          [Op.or]: [
            { status: "Pending" },
            { created_at: { [Op.gte]: recentCutoff } },
            ...(existingSubmittedRecordIds.length
              ? [{ id: { [Op.in]: existingSubmittedRecordIds } }]
              : [])
          ]
        },
        order: [["created_at", "DESC"]],
        limit: Math.max(100, existingSubmittedRecordIds.length + 100)
      });
      submittedRecords.forEach((record) => events.push({
        recipientIds: [userId],
        eventKey: `borrow:${record.id}:submitted`,
        type: "borrow_status",
        title: "Borrow request submitted",
        message: String(record.status || "").toLowerCase() === "pending"
          ? `Your request for ${record.equipmentId} — ${record.equipmentName} is awaiting review.`
          : `You submitted a request for ${record.equipmentId} — ${record.equipmentName}.`,
        targetUrl: getBorrowNotificationTarget(role, record.id),
        campus: record.campus,
        createdAt: record.created_at
      }));

      const recentEvents = await BorrowHistory.findAll({
        where: {
          recordId: { [Op.in]: recordIds },
          eventType: { [Op.in]: ["approved", "rejected", "cancelled", "canceled", "borrowed", "returned", "lost"] },
          created_at: { [Op.gte]: recentCutoff }
        },
        order: [["created_at", "DESC"], ["id", "DESC"]],
        limit: 100
      });
      const records = await BorrowRecord.findAll({
        where: { id: { [Op.in]: [...new Set(recentEvents.map((event) => event.recordId))] } },
        attributes: ["id", "equipmentId", "equipmentName", "campus", "status"]
      });
      const recordById = new Map(records.map((record) => [String(record.id), record]));
      recentEvents.forEach((event) => {
        const record = recordById.get(String(event.recordId));
        if (!record) return;
        const state = getStatusNotification(event.eventType);
        if (!state) return;
        const title = state === "rejected" ? "Borrow request rejected"
          : state === "approved" ? "Borrow request approved"
            : state === "cancelled" ? "Borrow request cancelled"
            : state === "released" ? "Equipment released"
              : state === "returned" ? "Equipment return recorded"
                : "Equipment marked lost";
        events.push({
          recipientIds: [userId],
          eventKey: `borrow-history:${event.id}`,
          type: "borrow_status",
          title,
          message: `${record.equipmentId} — ${record.equipmentName}${event.remarks ? `: ${event.remarks}` : "."}`,
          targetUrl: getBorrowNotificationTarget(role, record.id),
          campus: record.campus,
          createdAt: event.created_at
        });
      });
    }
  }
}

async function syncMaintenanceNotificationsForUser(user, events) {
  const userId = Number(user.id);
  const role = getRoleName(user.role);
  const campusVariants = getCampusVariants(user.campus);
  const isCampusAdmin = CAMPUS_ROLES.admin.includes(role);

  if (isCampusAdmin || (CAMPUS_ROLES.technician.includes(role) && campusVariants.length)) {
    const reports = await MaintenanceRequest.findAll({
      where: {
        ...(campusVariants.length ? { campus: { [Op.in]: campusVariants } } : {}),
        status: { [Op.in]: ["Pending", "New"] },
        id: { [Op.notIn]: await getArchivedEntityIds("maintenance-report") }
      },
      order: [["created_at", "DESC"]],
      limit: 100
    });
    reports.forEach((report) => events.push({
      recipientIds: [userId],
      eventKey: `maintenance:${report.id}:created`,
      type: "maintenance_report",
      title: "New equipment report",
      message: `${report.issueTitle || report.equipmentId || report.equipment_id}: ${report.description}`,
      targetUrl: getMaintenanceNotificationTarget(role, report.id),
      campus: report.campus,
      createdAt: report.created_at
    }));
  }

  if (CAMPUS_ROLES.technician.includes(role)) {
    const assignedReports = await MaintenanceRequest.findAll({
      where: {
        assignedTo: userId,
        status: { [Op.notIn]: ["Resolved", "Rejected", "Cancelled", "Canceled"] },
        id: { [Op.notIn]: await getArchivedEntityIds("maintenance-report") }
      },
      order: [["updated_at", "DESC"]],
      limit: 100
    });
    assignedReports.forEach((report) => events.push({
      recipientIds: [userId],
      eventKey: `maintenance:${report.id}:assigned`,
      type: "maintenance_assignment",
      title: "Maintenance report assigned to you",
      message: `${report.issueTitle || report.equipmentId || report.equipment_id}: ${report.description}`,
      targetUrl: getMaintenanceNotificationTarget(role, report.id),
      campus: report.campus,
      createdAt: report.updated_at || report.created_at
    }));
  }

  if (["student", "faculty", "instructor"].includes(role)) {
    const archivedReportIds = await getArchivedEntityIds("maintenance-report");
    const recentCutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const reports = await MaintenanceRequest.findAll({
      where: {
        [Op.and]: [
          { [Op.or]: [{ reportedBy: userId }, { student_id: userId }] },
          {
            [Op.or]: [
              {
                [Op.and]: [
                  { updated_at: { [Op.gt]: col("created_at") } },
                  { updated_at: { [Op.gte]: recentCutoff } }
                ]
              },
              { created_at: { [Op.gte]: recentCutoff } }
            ]
          },
          { id: { [Op.notIn]: archivedReportIds } }
        ],
      },
      order: [["updated_at", "DESC"]],
      limit: 50
    });
    reports.forEach((report) => {
      const recentlySubmitted = new Date(report.created_at).getTime() >= Date.now() - 30 * 24 * 60 * 60 * 1000;
      const hasUpdate = new Date(report.updated_at).getTime() > new Date(report.created_at).getTime();
      events.push({
        recipientIds: [userId],
        eventKey: recentlySubmitted && !hasUpdate
          ? `maintenance:${report.id}:submitted`
          : `maintenance:${report.id}:update:${getDateEventKey(report.updated_at)}`,
        type: recentlySubmitted && !hasUpdate ? "maintenance_report_submitted" : "maintenance_update",
        title: recentlySubmitted && !hasUpdate
          ? "Equipment report submitted"
          : report.technicianNotes ? "Reply to your equipment report" : "Equipment report updated",
        message: `${report.issueTitle || report.equipmentId || report.equipment_id}: ${report.technicianNotes || (recentlySubmitted && !hasUpdate ? "Your report has been received." : `Status: ${report.status}`)}`,
        targetUrl: getMaintenanceNotificationTarget(role, report.id),
        campus: report.campus,
        createdAt: recentlySubmitted && !hasUpdate ? report.created_at : report.updated_at
      });
    });
  }
}

export async function syncCurrentUserNotifications(user) {
  const events = [];
  await Promise.all([
    syncBorrowNotificationsForUser(user, events),
    syncMaintenanceNotificationsForUser(user, events)
  ]);
  if (CAMPUS_ROLES.admin.includes(getRoleName(user.role))) {
    const campusVariants = getCampusVariants(user.campus);
    const reports = await EquipmentTechnicianReport.findAll({
      where: {
        ...(campusVariants.length ? { campusId: { [Op.in]: campusVariants } } : {}),
        status: "submitted"
      },
      order: [["submittedAt", "DESC"]],
      limit: 100
    });
    reports.forEach((report) => events.push({
      recipientIds: [Number(user.id)],
      eventKey: `technician-report:${report.id}:submitted`,
      type: "technician_report",
      title: "Technician report submitted",
      message: `${report.reportId} was submitted by ${report.technicianName || "a technician"} for review.`,
      targetUrl: `/technician-accomplishments?reportId=${encodeURIComponent(String(report.id))}`,
      campus: report.campusId,
      createdAt: report.submittedAt
    }));
  }
  await createUserNotificationsBatch(events);
}

export function getBorrowNotificationTarget(role, recordId) {
  const encodedId = encodeURIComponent(String(recordId));
  const normalizedRole = String(role || "").trim().toLowerCase();
  if (["student"].includes(normalizedRole)) return `/student-borrow-equipment?borrowRecordId=${encodedId}`;
  if (["faculty", "instructor"].includes(normalizedRole)) return `/faculty-my-requests?borrowRecordId=${encodedId}`;
  if (CAMPUS_ROLES.technician.includes(normalizedRole)) return `/technician-dashboard?borrowRecordId=${encodedId}#borrow-requests`;
  return `/borrow-equipment?borrowRecordId=${encodedId}`;
}

export function getMaintenanceNotificationTarget(role, reportId) {
  const encodedId = encodeURIComponent(String(reportId));
  const normalizedRole = String(role || "").trim().toLowerCase();
  if (["student", "faculty", "instructor"].includes(normalizedRole)) return `/student-my-requests?maintenanceId=${encodedId}`;
  if (CAMPUS_ROLES.technician.includes(normalizedRole)) return `/technician-dashboard?maintenanceId=${encodedId}#new-reports`;
  return `/maintenance-monitoring?maintenanceId=${encodedId}`;
}

export function getRoleUserIdsForCampus(campus, roleGroup) {
  return getCampusUserIds(campus, CAMPUS_ROLES[roleGroup] || []);
}
