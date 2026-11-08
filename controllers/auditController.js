import { QueryTypes } from "sequelize";
import { AuditLog } from "../models/auditLogModel.js";
import { sequelize } from "../models/db.js";
import { User } from "../models/userModel.js";

const safeStringify = (value) => {
  if (value === undefined || value === null) return null;
  if (typeof value === "string") return value;
  try {
    return typeof value === "object" ? JSON.stringify(value) : String(value);
  } catch {
    return String(value);
  }
};

export const normalizeRoleName = (role) => String(role || "").trim().toLowerCase();

export const getRequestRoleValue = (req) => {
  const candidates = [
    req?.session?.userRole,
    req?.session?.user?.role,
    req?.session?.role,
    req?.user?.role,
    req?.headers?.["x-user-role"],
    req?.headers?.["X-User-Role"]
  ];

  return candidates.find((candidate) => candidate != null && String(candidate).trim() !== "") || "";
};

export const resolveUserRoleFromSession = async (req) => {
  const sessionRole = getRequestRoleValue(req);
  if (sessionRole) {
    return normalizeRoleName(sessionRole);
  }

  const userId = req?.session?.userId ?? req?.user?.id ?? null;
  if (!userId) {
    return "";
  }

  try {
    const user = await User.findByPk(userId, { attributes: ["role"] });
    return normalizeRoleName(user?.role || "");
  } catch (error) {
    console.warn("Failed to resolve user role from session for audit access.", error?.message || error);
    return "";
  }
};

export const isAdminRole = (role) => {
  const normalizedRole = normalizeRoleName(role);
  return normalizedRole === "admin" || normalizedRole === "administrator";
};

const isCentralAdminRole = (role) => {
  const normalizedRole = normalizeRoleName(role).replace(/[_-]+/g, "");
  return ["superadmin", "centraladmin", "systemadmin"].includes(normalizedRole);
};

export const canBypassAuditAccessForDev = (req) => {
  if (process.env.NODE_ENV !== "development") return false;
  const devRole = normalizeRoleName(req?.headers?.["x-dev-role"] || req?.query?.devRole || req?.query?.role);
  const rawDevBypass = String(req?.query?.devBypass || "").toLowerCase();
  const devBypass = rawDevBypass === "1" || rawDevBypass === "true";
  return devRole === "admin" || devBypass;
};

export const logAuditEntry = async (req, { action, module, resourceId = null, description = null, actorName = null, actorRole = null, actorUserId = null }) => {
  try {
    const userId = req?.session?.userId || actorUserId || null;
    const sessionRole = req?.session?.userRole || null;
    const roleValue = actorRole || sessionRole || null;
    let nameValue = actorName || null;
    let campusValue = null;

    if (userId) {
      const user = await User.findByPk(userId, { attributes: ["name", "campus"] });
      if (!nameValue && user?.name) nameValue = user.name;
      campusValue = user?.campus || null;
    }

    await AuditLog.create({
      userId,
      actorName: nameValue,
      actorRole: roleValue,
      action: String(action || "Unknown Action").trim(),
      module: String(module || "System").trim(),
      resourceId: resourceId != null ? String(resourceId) : null,
      description: description != null ? String(description) : null,
      userCampus: campusValue
    });
  } catch (error) {
    console.warn("Failed to write audit log entry:", error?.message || error);
  }
};

export const requireAdminForAudit = async (req, res, next) => {
  if (canBypassAuditAccessForDev(req)) {
    return next();
  }

  if (!req.session?.userId) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const resolvedRole = await resolveUserRoleFromSession(req);
  if (isAdminRole(resolvedRole) || isCentralAdminRole(resolvedRole)) {
    return next();
  }

  return res.status(403).json({ error: "Forbidden" });
};

export const normalizeCampusValue = (value) => {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s*campus\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
  return normalized;
};

export const getAuditLogs = async (req, res) => {
  const { q, userId, dateFrom, dateTo, campus, role, action, station, scope, page = 1, pageSize = 25, exportAll = false } = req.query;

  try {
    const where = {};
    const { Op } = await import("sequelize");
    const shouldExportAll = String(exportAll || "").toLowerCase() === "1" || String(exportAll || "").toLowerCase() === "true";
    const authenticatedUser = req.session?.userId
      ? await User.findByPk(req.session.userId, { attributes: ["id", "role", "campus"] })
      : null;
    const developmentBypass = canBypassAuditAccessForDev(req);
    if (!authenticatedUser && !developmentBypass) return res.status(403).json({ error: "Forbidden" });

    const authenticatedRole = normalizeRoleName(authenticatedUser?.role);
    const canViewAllAuditLogs = isAdminRole(authenticatedRole) || isCentralAdminRole(authenticatedRole);
    const isUserScopedRequest = !canViewAllAuditLogs;
    const selectedScope = String(scope || "authentication").trim().toLowerCase();
    if (!["authentication", "pc-station", "system", "student-activity"].includes(selectedScope)) {
      return res.status(400).json({ error: "Select a valid audit log scope." });
    }
    if (selectedScope === "system" && !canViewAllAuditLogs && !developmentBypass) {
      return res.status(403).json({ error: "System audit logs are only available to administrators." });
    }
    if (selectedScope === "student-activity" && authenticatedRole !== "student") {
      return res.status(403).json({ error: "Student activity logs are only available to the signed-in student." });
    }
    const studentActivityCategory = String(req.query.category || "all").trim().toLowerCase();
    const studentActivityCategories = new Set(["all", "access", "profile", "borrow", "reports", "attendance", "security", "other"]);
    if (selectedScope === "student-activity" && !studentActivityCategories.has(studentActivityCategory)) {
      return res.status(400).json({ error: "Select a valid student activity category." });
    }
    const roleGroups = {
      admin: ["admin", "administrator"],
      faculty: ["faculty", "faculties", "instructor", "instructors"],
      student: ["student"]
    };
    const selectedRole = String(role || "").trim().toLowerCase();
    if (selectedRole && !Object.hasOwn(roleGroups, selectedRole)) {
      return res.status(400).json({ error: "Select a valid role: admin, faculty, or student." });
    }
    const selectedAction = String(action || "").trim().toLowerCase();
    if (selectedScope === "pc-station" && selectedAction && !["login", "logout"].includes(selectedAction)) {
      return res.status(400).json({ error: "Select a valid PC station action: login or logout." });
    }
    const selectedStation = String(station || "").trim();
    if (selectedScope === "pc-station" && selectedStation.length > 100) {
      return res.status(400).json({ error: "Select a valid PC station." });
    }
    if (isUserScopedRequest && selectedRole) {
      const ownRole = Object.entries(roleGroups).find(([, aliases]) => aliases.includes(authenticatedRole))?.[0];
      if (selectedRole !== ownRole) {
        return res.status(403).json({ error: "You may only view your own authentication audit logs." });
      }
    }
    const requestedUserId = userId == null || userId === "" ? null : Number(userId);
    if (requestedUserId !== null && (!Number.isInteger(requestedUserId) || requestedUserId < 1)) {
      return res.status(400).json({ error: "A valid user ID is required." });
    }

    if (isUserScopedRequest && !developmentBypass &&
        requestedUserId !== null &&
        requestedUserId !== Number(authenticatedUser.id)) {
      return res.status(403).json({ error: "You may only view your own authentication audit logs." });
    }

    // PC station records are identified by their station resource ID. Do not
    // filter by description text: older login/logout messages use different
    // wording even though they are valid station events.
    where[Op.and] = [];
    if (selectedScope === "authentication" || selectedScope === "pc-station") {
      where[Op.and].push({
        module: "Authentication",
        action: selectedScope === "pc-station" && selectedAction
          ? selectedAction === "login" ? "Login" : "Logout"
          : { [Op.in]: ["Login", "Logout"] }
      });
      if (selectedScope === "pc-station") {
        where[Op.and].push({
          [Op.and]: [
            { resourceId: { [Op.ne]: null } },
            { resourceId: { [Op.ne]: "" } }
          ]
        });
        if (selectedStation) where[Op.and].push({ resourceId: selectedStation });
      }
      if (selectedRole) {
        where[Op.and].push({ actorRole: { [Op.in]: roleGroups[selectedRole] } });
      }
    } else if (selectedScope === "student-activity") {
      // Students can only read their own general audit events. PC station QR
      // sessions stay in the dedicated PC Logs tab and are excluded here.
      where[Op.and].push({
        [Op.or]: [
          { module: { [Op.ne]: "Authentication" } },
          { action: { [Op.notIn]: ["Login", "Logout"] } },
          { resourceId: null },
          { description: { [Op.notLike]: "%PC station%" } }
        ]
      });

      const categoryConditions = {
        access: { module: "Authentication", action: { [Op.in]: ["Login", "Logout"] } },
        profile: { module: "User Management", action: "User Updated" },
        borrow: { module: "Borrow Management" },
        reports: { module: "Maintenance Monitoring" },
        attendance: { module: "Attendance Monitoring" },
        security: { module: "Authentication", action: { [Op.notIn]: ["Login", "Logout"] } },
        other: { module: { [Op.notIn]: ["Authentication", "User Management", "Borrow Management", "Maintenance Monitoring", "Attendance Monitoring"] } }
      };
      if (studentActivityCategory !== "all") {
        where[Op.and].push(categoryConditions[studentActivityCategory]);
      }
    } else {
      // Keep regular authentication events in PC Logs, while exposing completed
      // password resets in System Logs for account-security auditing.
      where[Op.or] = [
        { module: { [Op.ne]: "Authentication" } },
        { module: "Authentication", action: "Password Reset" }
      ];
    }

    const userCampus = authenticatedUser?.campus || null;
    const selectedCampus = campus ? String(campus).trim() : "";
    const selectedCampusKey = normalizeCampusValue(selectedCampus);
    const userCampusKey = normalizeCampusValue(userCampus || "");

    if (isUserScopedRequest && selectedCampusKey && selectedCampusKey !== userCampusKey) {
      return res.status(403).json({ error: "You do not have permission to view audit logs for another campus." });
    }

    const effectiveCampusKey = isUserScopedRequest ? userCampusKey : selectedCampusKey;
    if (effectiveCampusKey) {
      const campusUsers = await User.findAll({
        where: {
          campus: {
            [Op.or]: [
              { [Op.like]: effectiveCampusKey },
              { [Op.like]: `${effectiveCampusKey} Campus` }
            ]
          }
        },
        attributes: ["id"]
      });
      const campusUserIds = campusUsers.map((user) => user.id);
      const campusRecordConditions = [
        ...(campusUserIds.length ? [{ userId: { [Op.in]: campusUserIds } }] : []),
        {
          userId: null,
          userCampus: {
            [Op.or]: [
              { [Op.like]: effectiveCampusKey },
              { [Op.like]: `${effectiveCampusKey} Campus` }
            ]
          }
        }
      ];
      where[Op.and] = [
        ...(where[Op.and] || []),
        { [Op.or]: campusRecordConditions }
      ];
    }

    const filterConditions = [];

    if (isUserScopedRequest && !developmentBypass) {
      filterConditions.push({ userId: Number(authenticatedUser.id) });
    }

    if (requestedUserId !== null && Number.isInteger(requestedUserId) && requestedUserId > 0) {
      filterConditions.push({ userId: requestedUserId });
    }

    if (dateFrom || dateTo) {
      const createdAtRange = {};
      if (dateFrom) {
        createdAtRange[Op.gte] = new Date(dateFrom);
      }
      if (dateTo) {
        const toDate = new Date(dateTo);
        if (/^\d{4}-\d{2}-\d{2}$/.test(String(dateTo))) {
          toDate.setHours(23, 59, 59, 999);
        }
        createdAtRange[Op.lte] = toDate;
      }
      filterConditions.push({ createdAt: createdAtRange });
    }

    if (q) {
      const term = String(q).trim();
      if (term) {
        filterConditions.push({
          [Op.or]: [
            { actorName: { [Op.like]: `%${term}%` } },
            { actorRole: { [Op.like]: `%${term}%` } },
            { action: { [Op.like]: `%${term}%` } },
            { module: { [Op.like]: `%${term}%` } },
            { description: { [Op.like]: `%${term}%` } }
          ]
        });
      }
    }

    if (filterConditions.length) {
      where[Op.and] = [...(where[Op.and] || []), ...filterConditions];
    }

    const resolvedPage = Math.max(1, Number(page) || 1);
    const requestedPageSize = Math.max(1, Number(pageSize) || 25);
    const resolvedPageSize = shouldExportAll
      ? Math.min(5000, requestedPageSize)
      : selectedScope === "system"
        ? 7
        : Math.min(100, requestedPageSize);
    const offset = (resolvedPage - 1) * resolvedPageSize;
    const addActorCollege = async (rows) => {
      const userIds = [...new Set(rows.flatMap((row) => {
        const ids = [Number(row.userId)];
        if (row.module === "Authentication" && row.action === "Password Reset") {
          ids.push(Number(row.resourceId));
        }
        return ids.filter((id) => Number.isInteger(id) && id > 0);
      }))];
      const users = userIds.length
        ? await User.findAll({ where: { id: { [Op.in]: userIds } }, attributes: ["id", "name", "role", "college"] })
        : [];
      const userById = new Map(users.map((user) => [Number(user.id), user]));
      return rows.map((row) => {
        const record = row.toJSON();
        const actor = userById.get(Number(row.userId)) || (
          row.module === "Authentication" && row.action === "Password Reset"
            ? userById.get(Number(row.resourceId))
            : null
        );
        return {
          ...record,
          actorName: record.actorName || actor?.name || null,
          actorRole: record.actorRole || actor?.role || null,
          actorCollege: actor?.college || null
        };
      });
    };
    const enrichAuditRows = async (rows) => {
      const enrichedRows = await addActorCollege(rows);
      if (selectedScope !== "pc-station" || !enrichedRows.length) return enrichedRows;

      const stationIds = [...new Set(enrichedRows.map((row) => String(row.resourceId || "").trim()).filter(Boolean))];
      if (!stationIds.length) return enrichedRows;

      try {
        const stations = await sequelize.query(
          `SELECT station_set.setId,
                  labs.name AS laboratoryName,
                  labs.roomNumber,
                  station_set.location AS stationLocation
           FROM equipment_sets AS station_set
           LEFT JOIN computer_labs AS labs ON labs.id = station_set.laboratoryId
           WHERE station_set.setId IN (:stationIds)`,
          { replacements: { stationIds }, type: QueryTypes.SELECT }
        );
        const locationBySetId = new Map(stations.map((station) => {
          const laboratoryName = String(station.laboratoryName || "").trim();
          const roomNumber = String(station.roomNumber || "").trim();
          const savedLocation = String(station.stationLocation || "").trim();
          const location = laboratoryName && roomNumber
            ? `${laboratoryName} — Room ${roomNumber}`
            : laboratoryName || savedLocation || (roomNumber ? `Room ${roomNumber}` : "");
          return [String(station.setId), location];
        }));
        return enrichedRows.map((row) => ({
          ...row,
          stationLocation: locationBySetId.get(String(row.resourceId || "")) || null
        }));
      } catch (error) {
        console.warn("Unable to attach PC station room information to audit logs:", error.message);
        return enrichedRows;
      }
    };

    if (shouldExportAll) {
      const rows = await AuditLog.findAll({
        where,
        order: [["createdAt", "DESC"], ["id", "DESC"]]
      });

      return res.json({
        data: await enrichAuditRows(rows),
        meta: {
          total: rows.length,
          page: 1,
          pageSize: rows.length,
          totalPages: 1
        }
      });
    }

    const { count, rows } = await AuditLog.findAndCountAll({
      where,
      order: [["createdAt", "DESC"], ["id", "DESC"]],
      offset,
      limit: resolvedPageSize
    });

    res.json({
      data: await enrichAuditRows(rows),
      meta: {
        total: count,
        page: resolvedPage,
        pageSize: resolvedPageSize,
        totalPages: Math.ceil(count / resolvedPageSize)
      }
    });
  } catch (error) {
    console.error("Failed to load audit logs:", error);
    res.status(500).json({ error: "Failed to load audit logs." });
  }
};
