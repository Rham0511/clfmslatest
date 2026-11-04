/**
 * Campus-based Access Control
 * 
 * Provides authorization helpers to enforce campus-based access restrictions.
 * Users can fully manage records from their own campus, but can only view
 * records from other campuses.
 */

import { Op } from "sequelize";
import { User } from "../models/userModel.js";
import { isEntityArchived } from "../models/archiveRecords.js";

export const normalizeRoleName = (role) => String(role || "").trim().toLowerCase();

export const isAdminRole = (role) => {
  const normalizedRole = normalizeRoleName(role);
  return normalizedRole === "admin" || normalizedRole === "administrator";
};

export const isTechnicianRole = (role) => {
  return normalizeRoleName(role) === "technician";
};

/**
 * Get the authenticated user's full profile from the session for authorization.
 * ALWAYS use this for authorization, never trust client-supplied campus values.
 * 
 * Returns: { userId, campus, role } or { userId: null } if not authenticated
 */
export const getUserAuthContext = async (req) => {
  const userId = req.session?.userId;
  const sessionCampus = req.session?.userCampus;
  const sessionRole = req.session?.userRole;

  // If user is not authenticated at all
  if (!userId) {
    return { userId: null, campus: null, role: null };
  }

  // Try to use session values first
  let campus = sessionCampus || null;
  let role = sessionRole || null;

  // If campus or role not in session, fetch from database
  if (!campus || !role) {
    try {
      const user = await User.findByPk(userId, { attributes: ["campus", "role"] });
      if (user) {
        campus = campus || user.campus || null;
        role = role || user.role || null;
      }
    } catch (error) {
      console.warn("[campusAuth] Failed to fetch user from DB:", error?.message || error);
    }
  }

  if (
    ["faculty", "instructor"].includes(normalizeRoleName(role)) &&
    await isEntityArchived("faculty-account", userId)
  ) {
    return { userId: null, campus: null, role: null };
  }

  return { userId, campus, role };
};

/**
 * Get the authenticated user's campus from the session.
 * ALWAYS use this for authorization, never trust client-supplied campus values.
 * 
 * Returns: campus string or null if not set
 */
export const getUserCampusFromSession = async (req) => {
  const context = await getUserAuthContext(req);
  return context.campus;
};

/**
 * Normalize campus values for consistent comparison
 * Handles variations like:
 * - "Bongabong" vs "Bongabong Campus"
 * - "victoria" vs "Victoria"
 * - " Calapan  " vs "Calapan Campus"
 */
const normalizeCampusValue = (value) => {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s*campus\s*$/i, "") // Remove "Campus" suffix if present
    .replace(/\s+/g, " ") // Normalize whitespace
    .trim();
  return normalized;
};

const recognizedCampusNames = new Set(["bongabong", "victoria", "calapan"]);

/**
 * Check if user can manage (edit/delete) a record.
 * User can manage if:
 * 1. User's campus matches record's campus
 * 2. User is authenticated
 * 
 * @param {string} userCampus - Authenticated user's campus (from session/DB)
 * @param {string} recordCampus - Target record's campus
 * @param {string} userRole - User's role (optional, for logging)
 * @returns {boolean} - true if user can manage, false if view-only
 */
export const canManageRecord = (userCampus, recordCampus, userRole = null) => {
  const userCampusNorm = normalizeCampusValue(userCampus);
  const recordCampusNorm = normalizeCampusValue(recordCampus);

  if (!recognizedCampusNames.has(userCampusNorm) || !recognizedCampusNames.has(recordCampusNorm)) {
    return false;
  }

  return userCampusNorm === recordCampusNorm;
};

/**
 * Middleware to verify campus access for a specific record.
 * 
 * Returns:
 * - { authorized: true, canManage: true } - User can fully manage
 * - { authorized: true, canManage: false } - User can view only
 * - { authorized: false } - User not authenticated or invalid campus
 */
export const verifyCampusAccess = async (req, recordCampus) => {
  const userId = req.session?.userId;

  if (!userId) {
    return { authorized: false };
  }

  const userCampus = await getUserCampusFromSession(req);

  if (!userCampus) {
    return { authorized: false };
  }

  const canManage = canManageRecord(userCampus, recordCampus, req.session?.userRole);

  return {
    authorized: true,
    canManage,
    userCampus,
    recordCampus
  };
};

/**
 * Require same-campus authorization for destructive operations.
 * Returns true if user can proceed, false if they should get a 403.
 */
export const requireSameCampusForModification = async (req, recordCampus) => {
  const access = await verifyCampusAccess(req, recordCampus);

  if (!access.authorized || !access.canManage) {
    return false;
  }

  return true;
};

/**
 * Filter records by user's accessible campus.
 * If user can access multiple campuses, include all;
 * for now, only authenticated users can view any campus but can only modify their own.
 */
export const applyCampusFilter = (userCampus) => {
  if (!userCampus || !String(userCampus).trim()) {
    return {};
  }

  const normalizedCampus = String(userCampus).trim();
  return {
    campus: {
      [Op.in]: [...new Set([
        normalizedCampus,
        normalizedCampus.replace(/\s*Campus\s*$/i, "").trim(),
        `${normalizedCampus.replace(/\s*Campus\s*$/i, "").trim()} Campus`
      ].filter(Boolean))]
    }
  };
};
