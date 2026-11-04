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

import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import QRCode from "qrcode";
import { Op, QueryTypes } from "sequelize";
import { Equipment, EquipmentSequence, EquipmentCategory, sequelize } from "../models/equipmentModel.js";
import { EquipmentAssignment } from "../models/equipmentAssignmentModel.js";
import { BorrowHistory, BorrowRecord } from "../models/borrowRecordModel.js";
import { BorrowRequestAccountability } from "../models/borrowRequestAccountabilityModel.js";
import { User } from "../models/userModel.js";
import { logAuditEntry } from "./auditController.js";
import EquipmentAuditTrail from "../models/equipmentAuditTrailModel.js";
import { createQrLinkToken, readQrLinkToken } from "../utils/qrLinkToken.js";
import { getArchivedEntityIds } from "../models/archiveRecords.js";
import { findComputerLabByLabel, getLegacyComputerLabNumber } from "../models/computerLabService.js";
import {
  getUserAuthContext,
  getUserCampusFromSession,
  canManageRecord,
  isAdminRole,
  isTechnicianRole,
  normalizeRoleName
} from "./campusAuthController.js";

function buildEquipmentQrUrl(equipmentId) {
  const token = createQrLinkToken("equipment", equipmentId);
  const path = `/equipment/uid/${encodeURIComponent(token)}`;
  const baseUrl = process.env.BASE_URL?.trim();
  if (!baseUrl) {
    console.warn("[equipment] BASE_URL is not configured. Set BASE_URL to your server address so QR codes work on mobile devices.");
    return path;
  }

  return `${baseUrl.replace(/\/+$/, "")}${path}`;
}

function isEquipmentQrUrl(value, equipmentId) {
  if (typeof value !== "string") return false;
  try {
    const match = new URL(value, "http://localhost").pathname.match(/^\/equipment\/uid\/([A-Za-z0-9_-]+)\/?$/i);
    return Boolean(match && readQrLinkToken(match[1], "equipment") === equipmentId);
  } catch {
    return false;
  }
}

async function generateQrImage(payload) {
  return QRCode.toDataURL(payload, {
    type: "image/png",
    width: 1200,
    margin: 4,
    errorCorrectionLevel: "H",
    color: {
      dark: "#000000",
      light: "#ffffff"
    }
  });
}

const defaultCategories = [
  { name: "Computer", prefix: "CMP" },
  { name: "System Unit", prefix: "CPU" },
  { name: "Monitor", prefix: "MON" },
  { name: "Keyboard", prefix: "KEY" },
  { name: "Mouse", prefix: "MOU" },
  { name: "Chair", prefix: "CHR" },
  { name: "Table", prefix: "TBL" },
  { name: "Printer", prefix: "PRN" },
  { name: "Projector", prefix: "PRJ" },
  { name: "Scanner", prefix: "SCN" },
  { name: "Speaker", prefix: "SPK" },
  { name: "Webcam", prefix: "WBC" },
  { name: "Microphone", prefix: "MIC" },
  { name: "Router", prefix: "RTR" },
  { name: "Switch", prefix: "SWT" },
  { name: "Access Point", prefix: "ACP" },
  { name: "HDMI Cable", prefix: "HDM" },
  { name: "LAN Cable", prefix: "LNC" },
  { name: "Extension Cord", prefix: "EXT" },
  { name: "UPS", prefix: "UPS" },
  { name: "AVR", prefix: "AVR" },
  { name: "Cabinet", prefix: "CBT" },
  { name: "Whiteboard", prefix: "WBD" },
  { name: "Electric Fan", prefix: "FAN" },
  { name: "Air Conditioner", prefix: "AC" },
  { name: "Fire Extinguisher", prefix: "FEX" },
  { name: "Other", prefix: "OTH" }
];

function normalizeEquipmentType(value) {
  const name = String(value || "").trim();
  return name.toLowerCase() === "cpu" ? "System Unit" : name;
}

function getLaboratoryNumber(value) {
  const normalized = String(value || "").toLowerCase();
  const labMatch = normalized.match(/(?:com\s*lab|laboratory|lab)\s*[-#]?\s*([12])/);
  if (labMatch) return labMatch[1];
  const roomMatch = normalized.match(/room\s*(202|204)/);
  return roomMatch ? (roomMatch[1] === "202" ? "1" : "2") : "";
}

async function migrateCpuCategoryToSystemUnit() {
  const [updatedEquipmentCount] = await Equipment.update(
    { category: "System Unit" },
    { where: { category: "CPU" } }
  );
  await Equipment.update(
    { name: "System Unit" },
    { where: { category: "System Unit", name: "CPU" } }
  );

  const cpuCategory = await EquipmentCategory.findOne({ where: { name: "CPU" } });
  if (cpuCategory) {
    const systemUnitCategory = await EquipmentCategory.findOne({ where: { name: "System Unit" } });
    if (systemUnitCategory) {
      await cpuCategory.destroy();
    } else {
      await cpuCategory.update({ name: "System Unit" });
    }
  }

  if (updatedEquipmentCount > 0) {
    console.info(`[equipment] Renamed ${updatedEquipmentCount} CPU item(s) to System Unit.`);
  }
}

async function seedDefaultCategories() {
  for (const category of defaultCategories) {
    try {
      const existing = await EquipmentCategory.findOne({ where: { name: category.name } });
      if (existing) {
        if (existing.prefix !== category.prefix) {
          const prefixConflict = await EquipmentCategory.findOne({ where: { prefix: category.prefix } });
          if (!prefixConflict || prefixConflict.name === category.name) {
            await existing.update({ prefix: category.prefix });
          }
        }
        continue;
      }

      const duplicatePrefix = await EquipmentCategory.findOne({ where: { prefix: category.prefix } });
      if (duplicatePrefix) {
        continue;
      }

      await EquipmentCategory.create({ name: category.name, prefix: category.prefix });
    } catch (err) {
      // Silently skip duplicate entries
      if (err.name === 'SequelizeUniqueConstraintError') {
        continue;
      }
      throw err;
    }
  }
}

async function getCategoryPrefix(category, transaction) {
  if (!category || typeof category !== "string") {
    return "OTH";
  }

  const normalizedName = category.trim();
  if (!normalizedName) {
    return "OTH";
  }

  const record = await EquipmentCategory.findOne({
    where: { name: normalizedName },
    transaction
  });

  if (record && record.prefix) {
    return record.prefix.toUpperCase();
  }

  return normalizedName.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 3) || "OTH";
}

async function generateEquipmentId(category, campus) {
  return await sequelize.transaction(async (transaction) => {
    const campusName = String(campus || "").trim().replace(/\s*Campus\s*$/i, "").trim();
    const campusVariants = [campusName, `${campusName} Campus`];
    const campusWidth = {
      victoria: 2,
      bongabong: 3,
      calapan: 4
    }[campusName.toLowerCase()] || 3;
    const prefix = await getCategoryPrefix(category, transaction);
    const sequenceKey = `${campusName.toLowerCase()}:${prefix}`;
    const [sequence] = await EquipmentSequence.findOrCreate({
      where: { prefix: sequenceKey },
      defaults: { lastNumber: 0 },
      transaction
    });

    const existingEquipment = await Equipment.findAll({
      where: {
        campus: { [Op.in]: campusVariants },
        category,
        equipmentId: {
          [Op.like]: `${prefix}-%`
        }
      },
      attributes: ["equipmentId"],
      transaction
    });
    const highestExisting = existingEquipment.reduce((max, row) => {
      const match = row.equipmentId.match(new RegExp(`^${prefix}-(\\d+)$`));
      if (!match) return max;
      const value = Number(match[1]);
      return Number.isFinite(value) ? Math.max(max, value) : max;
    }, 0);
    if (highestExisting > Number(sequence.lastNumber || 0)) {
      sequence.lastNumber = highestExisting;
    }

    const nextNumber = sequence.lastNumber + 1;
    sequence.lastNumber = nextNumber;
    await sequence.save({ transaction });

    return `${prefix}-${String(nextNumber).padStart(campusWidth, "0")}`;
  });
}

function getCanonicalCampusName(campus) {
  const campusName = String(campus || "").trim().replace(/\s*Campus\s*$/i, "").trim();
  return campusName ? `${campusName} Campus` : "";
}

function getCampusVariants(campus) {
  const normalizedCampus = String(campus || "").trim();
  const campusName = normalizedCampus.replace(/\s*Campus\s*$/i, "").trim();
  return [...new Set([normalizedCampus, campusName, `${campusName} Campus`].filter(Boolean))];
}

await Equipment.sync();
await EquipmentSequence.sync();
await EquipmentCategory.sync();
await migrateCpuCategoryToSystemUnit();
await seedDefaultCategories();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(import.meta.url);

async function findEquipmentByIdentifier(identifier, req = null) {
  if (identifier === undefined || identifier === null) {
    return null;
  }

  const normalized = String(identifier).trim();
  if (!normalized) {
    return null;
  }

  const authContext = req ? await getUserAuthContext(req) : null;
  const campusVariants = authContext?.campus ? getCampusVariants(authContext.campus) : [];
  const campusWhere = campusVariants.length ? { campus: { [Op.in]: campusVariants } } : null;
  const numericId = Number(normalized);
  if (Number.isInteger(numericId)) {
    const byPk = await Equipment.findOne({
      where: { id: numericId, ...(campusWhere || {}) }
    });
    if (byPk) {
      const archivedIds = await getArchivedEntityIds("equipment");
      return archivedIds.includes(String(byPk.equipmentId)) ? null : byPk;
    }
  }

  const matches = await Equipment.findAll({
    where: { equipmentId: normalized, ...(campusWhere || {}) },
    limit: 2
  });
  if (matches.length !== 1) return null;
  const archivedIds = await getArchivedEntityIds("equipment");
  return archivedIds.includes(String(matches[0].equipmentId)) ? null : matches[0];
}

export const inventoryPage = async (req, res) => {
  try {
    const authContext = await getUserAuthContext(req);
    if (!authContext.userId) {
      return res.redirect("/login");
    }

    const normalizedRole = normalizeRoleName(authContext.role);
    const canViewInventoryPage = isAdminRole(normalizedRole) ||
      isTechnicianRole(normalizedRole);
    if (!canViewInventoryPage) {
      return res.status(403).send("Forbidden: admin or technician access required.");
    }

    const currentUserId = req.session?.userId;
    let currentUser = null;

    if (currentUserId) {
      const user = await User.findByPk(currentUserId, {
        attributes: ["name", "email", "role", "campus", "photo"]
      });

      if (user) {
        const userName = user.name || "Administrator";
        const initials = userName
          .split(/\s+/)
          .filter(Boolean)
          .slice(0, 2)
          .map((part) => part.charAt(0).toUpperCase())
          .join("") || "AD";

        currentUser = {
          id: currentUserId,
          name: userName,
          email: user.email || "",
          role: user.role || "admin",
          campus: user.campus || null,
          photo: user.photo || null,
          initials
        };
      }
    }

    const filePath = path.join(process.cwd(), "views", "admin", "equipment-inventory.html");
    const html = await fs.promises.readFile(filePath, "utf8");
    const currentUserJson = JSON.stringify(currentUser).replaceAll("<", "\\u003c");
    const hydratedHtml = html.replaceAll("__CURRENT_USER_JSON__", currentUserJson);

    res.set({
      "Cache-Control": "no-store, no-cache, must-revalidate, private",
      "Pragma": "no-cache",
      "Expires": "0",
      "Surrogate-Control": "no-store"
    });
    res.type("html").send(hydratedHtml);
  } catch (error) {
    console.error("Failed to serve equipment inventory page:", error);
    res.status(500).send("Failed to load equipment inventory page.");
  }
};

export const viewEquipmentPage = async (req, res) => {
  try {
    const { equipmentId } = req.params;
    const equipment = await findEquipmentByIdentifier(equipmentId, req);

    if (!equipment) {
      return res.status(404).send(`<!DOCTYPE html><html><body><h1>Equipment not found</h1></body></html>`);
    }

    if (!req.session?.userId) {
      req.session.redirectTo = `/equipment/uid/${encodeURIComponent(req.params.qrToken)}`;
      return req.session.save((error) => {
        if (error) {
          console.error("Failed to save QR equipment login redirect.", error);
          return res.status(500).send("Unable to continue to login. Please try again.");
        }
        return res.redirect("/login");
      });
    }

    const authContext = await getUserAuthContext(req);
    const role = normalizeRoleName(authContext.role);
    if (["faculty", "instructor"].includes(role)) {
      const query = req.params.qrToken
        ? `equipmentQr=${encodeURIComponent(req.params.qrToken)}`
        : `equipmentId=${encodeURIComponent(equipment.equipmentId)}`;
      return res.redirect(`/faculty-borrow-equipment?${query}`);
    }
    if (role === "student") {
      const query = req.params.qrToken
        ? `equipmentQr=${encodeURIComponent(req.params.qrToken)}`
        : `equipmentId=${encodeURIComponent(equipment.equipmentId)}`;
      return res.redirect(`/student/borrow-equipment?${query}`);
    }

    const userCampus = await getUserCampusFromSession(req);
    if (userCampus && !canManageRecord(userCampus, equipment.campus)) {
      return res.status(403).send("You do not have permission to view equipment from another campus.");
    }

    const formattedDate = equipment.dateAdded
      ? new Date(equipment.dateAdded).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })
      : "Not Available";

    const equipmentName = String(equipment.name || "Equipment").trim() || "Equipment";

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${equipmentName}</title>
  <style>
    :root { color-scheme: dark; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      background: radial-gradient(circle at top left, rgba(16, 185, 129, 0.16), transparent 35%), linear-gradient(135deg, #07120c 0%, #0d1712 55%, #08110c 100%);
      color: #f2f8f4;
      font-family: Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      padding: 1rem;
    }
    .page-shell {
      width: min(100%, 720px);
      border: 2px solid rgba(6, 78, 59, 0.6);
      border-radius: 1.5rem;
      padding: 1.15rem;
      background: rgba(5, 12, 10, 0.82);
      box-shadow: 0 26px 70px rgba(2, 8, 23, 0.46);
      backdrop-filter: blur(16px);
    }
    .card {
      border-radius: 1.2rem;
      background: linear-gradient(145deg, rgba(8, 19, 14, 0.98), rgba(4, 10, 8, 0.96));
      border: 1px solid rgba(16, 185, 129, 0.2);
      padding: 1.35rem;
      box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.05);
    }
    .eyebrow { font-size: 0.74rem; font-weight: 800; letter-spacing: 0.32em; text-transform: uppercase; color: #6ee7b7; }
    .title-row { display: flex; align-items: center; gap: 0.9rem; margin-top: 0.7rem; }
    .icon { width: 2.6rem; height: 2.6rem; border-radius: 999px; display: grid; place-items: center; background: rgba(16, 185, 129, 0.16); border: 1px solid rgba(110, 231, 183, 0.26); color: #d1fae5; flex-shrink: 0; }
    .title { margin: 0; font-size: 1.8rem; color: #a7f3d0; font-weight: 700; letter-spacing: 0.01em; }
    .subtitle { margin-top: 0.25rem; color: rgba(187, 247, 208, 0.92); font-size: 0.95rem; }
    .meta { display: grid; gap: 0; margin-top: 1.05rem; border-radius: 1rem; overflow: hidden; border: 1px solid rgba(16, 185, 129, 0.2); background: rgba(6, 14, 10, 0.7); }
    .row { display: flex; justify-content: space-between; gap: 1rem; padding: 0.92rem 1rem; background: rgba(6, 14, 10, 0.78); border-bottom: 1px solid rgba(16, 185, 129, 0.24); }
    .row:last-child { border-bottom: none; }
    .label { color: #6ee7b7; font-weight: 700; letter-spacing: 0.01em; }
    .value { color: #f5f7f2; font-weight: 600; text-align: right; }
    .status-badge { display: inline-block; padding: 0.2rem 0.7rem; border-radius: 999px; font-size: 0.8rem; font-weight: 700; }
    .status-serviceable { background: rgba(34,197,94,0.15); color: #4ade80; border: 1px solid rgba(34,197,94,0.3); }
    .status-in-use { background: rgba(59,130,246,0.15); color: #93c5fd; border: 1px solid rgba(59,130,246,0.3); }
    .status-missing { background: rgba(239,68,68,0.15); color: #f87171; border: 1px solid rgba(239,68,68,0.3); }
    .status-maintenance { background: rgba(234,179,8,0.15); color: #fbbf24; border: 1px solid rgba(234,179,8,0.3); }
    .status-disposal { background: rgba(168,85,247,0.15); color: #d8b4fe; border: 1px solid rgba(168,85,247,0.3); }
    .status-unserviceable { background: rgba(107,114,128,0.15); color: #9ca3af; border: 1px solid rgba(107,114,128,0.3); }
    @media (max-width: 640px) { .row { flex-direction: column; align-items: flex-start; } .value { text-align: left; } }
  </style>
</head>
<body>
  <div class="page-shell">
    <div class="card">
      <div class="eyebrow">Equipment Information</div>
      <div class="title-row">
        <div class="icon" aria-hidden="true">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="M4 7h16"></path><path d="M7 7v10a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2V7"></path><path d="M9 11h6"></path><path d="M9 15h6"></path>
          </svg>
        </div>
        <div>
          <h1 class="title">${equipmentName}</h1>
          <div class="subtitle">Asset record • ${equipment.equipmentId}</div>
        </div>
      </div>
      <div class="meta">
        <div class="row"><span class="label">Equipment ID</span><span class="value">${equipment.equipmentId}</span></div>
        <div class="row"><span class="label">Equipment Name</span><span class="value">${equipmentName}</span></div>
        <div class="row"><span class="label">Serial Number</span><span class="value">${equipment.serialNumber || 'Not Assigned'}</span></div>
        <div class="row"><span class="label">PC Set</span><span class="value">${equipment.setId || 'Not Assigned'}</span></div>
        <div class="row"><span class="label">Category</span><span class="value">${equipment.category || 'N/A'}</span></div>
        <div class="row"><span class="label">Laboratory</span><span class="value">${equipment.laboratoryRoom || 'Not Assigned'}</span></div>
        <div class="row"><span class="label">Location</span><span class="value">${equipment.location || 'Not Specified'}</span></div>
        <div class="row"><span class="label">Campus</span><span class="value">${equipment.campus}</span></div>
        <div class="row"><span class="label">Status</span><span class="value">
          <span class="status-badge ${
            equipment.status === 'Serviceable' ? 'status-serviceable' :
            equipment.status === 'In Use' ? 'status-in-use' :
            equipment.status === 'Missing' ? 'status-missing' :
            ['Under Maintenance', 'For Repair'].includes(equipment.status) ? 'status-maintenance' :
            equipment.status === 'For Disposal' ? 'status-disposal' :
            'status-unserviceable'
          }">${equipment.status}</span>
        </span></div>
        <div class="row"><span class="label">Date Added</span><span class="value">${formattedDate}</span></div>
        ${equipment.status === 'Missing' && equipment.missingReportedAt ? `<div class="row"><span class="label">Reported Missing</span><span class="value" style="color:#f87171;">${new Date(equipment.missingReportedAt).toLocaleDateString('en-US', {month:'short',day:'numeric',year:'numeric'})}</span></div>` : ''}
      </div>
    </div>
  </div>
</body>
</html>`;

    res.type("html").send(html);
  } catch (error) {
    console.error("Failed to render equipment info page.", error);
    res.status(500).send("Failed to load equipment information.");
  }
};

export const scanEquipmentQr = async (req, res) => {
  const equipmentId = readQrLinkToken(req.params.token, "equipment");
  if (!equipmentId) return res.status(400).send("Invalid equipment QR code.");
  req.params.equipmentId = equipmentId;
  req.params.qrToken = req.params.token;
  return viewEquipmentPage(req, res);
};

export const redirectLegacyEquipmentQr = async (req, res) => {
  try {
    const equipment = await findEquipmentByIdentifier(req.params.equipmentId, req);
    if (!equipment) return res.status(404).send("Equipment not found.");
    return res.redirect(302, buildEquipmentQrUrl(equipment.equipmentId));
  } catch (error) {
    console.error("[equipment] Failed to update legacy QR link:", error);
    return res.status(500).send("Unable to open this equipment QR code.");
  }
};

export const resolveEquipmentQrToken = async (req, res) => {
  if (!req.session?.userId) {
    return res.status(401).json({ error: "Please log in to scan equipment QR codes." });
  }

  const equipmentId = readQrLinkToken(req.params.token, "equipment");
  if (!equipmentId) return res.status(400).json({ error: "Invalid equipment QR code." });

  try {
    const equipment = await findEquipmentByIdentifier(equipmentId, req);
    if (!equipment) return res.status(404).json({ error: "Equipment not found in your campus." });

    const userCampus = await getUserCampusFromSession(req);
    if (userCampus && !canManageRecord(userCampus, equipment.campus)) {
      return res.status(403).json({ error: "You do not have permission to view this equipment." });
    }

    return res.json({ equipmentId: equipment.equipmentId });
  } catch (error) {
    console.error("[equipment] Failed to resolve equipment QR token:", error);
    return res.status(500).json({ error: "Failed to resolve equipment QR code." });
  }
};

export const getEquipment = async (req, res) => {
  const { search = "", status, campus, sortBy, assignment } = req.query;
  const isPaginatedRequest = req.query.page !== undefined || req.query.pageSize !== undefined;
  const parsePositiveInteger = (value, fallback) => {
    const parsed = Number.parseInt(String(value), 10);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
  };
  const pageSize = Math.min(parsePositiveInteger(req.query.pageSize, 10), 10);
  const requestedPage = parsePositiveInteger(req.query.page, 1);
  try {
    const authContext = await getUserAuthContext(req);
    if (!authContext.userId) {
      return res.status(401).json({ error: "Please log in to view equipment inventory." });
    }

    const normalizedRole = normalizeRoleName(authContext.role);
    const canViewInventory = isAdminRole(normalizedRole) ||
      isTechnicianRole(normalizedRole);
    if (!canViewInventory) {
      return res.status(403).json({ error: "Admin or technician access is required." });
    }

    const where = {};
    const userCampus = authContext.campus || await getUserCampusFromSession(req);
    const requestedCampus = String(campus || "").trim();
    const isAllCampuses = !requestedCampus || /^all\s+campuses?$/i.test(requestedCampus);

    if (userCampus) {
      // Campus-scoped users receive individual records only from their own campus.
      // Totals for other campuses come from the separate campus-totals endpoint.
      if (!isAllCampuses && !canManageRecord(userCampus, requestedCampus)) {
        where.id = { [Op.eq]: 0 };
      } else {
        const campusTrimmed = String(userCampus).trim();
        const campusName = campusTrimmed.replace(/\s*Campus\s*$/i, "");
        where[Op.or] = [
          { campus: campusTrimmed },
          { campus: campusName },
          { campus: `${campusName} Campus` }
        ];
      }
    } else if (!isAllCampuses) {
      const campusTrimmed = requestedCampus;
      const campusName = campusTrimmed.replace(/\s*Campus\s*$/i, "");
      where[Op.or] = [
        { campus: campusTrimmed },
        { campus: campusName },
        { campus: `${campusName} Campus` }
      ];
    }

    const records = await Equipment.findAll({
      where,
      order: [["dateAdded", "DESC"]]
    });

    const archivedEquipmentIds = new Set(await getArchivedEntityIds("equipment"));
    const filtered = records
      .map((item) => item.toJSON())
      .filter((item) => !archivedEquipmentIds.has(String(item.equipmentId)))
      .filter((item) => {
        const matchesSearch = search
          .toString()
          .toLowerCase()
          .split(" ")
          .every((token) =>
            token === "" ||
            item.equipmentId.toLowerCase().includes(token) ||
            item.name.toLowerCase().includes(token) ||
            String(item.campus || "").toLowerCase().includes(token)
          );
        const matchesStatus = !status || item.status === status;
        const matchesAssignment = !["assigned", "unassigned"].includes(String(assignment || "").toLowerCase()) ||
          (String(assignment).toLowerCase() === "assigned"
            ? Boolean(String(item.setId || "").trim())
            : !String(item.setId || "").trim());
        return matchesSearch && matchesStatus && matchesAssignment;
      });

    if (String(sortBy || "").trim().toLowerCase() === "name") {
      filtered.sort((left, right) =>
        String(left.name || "").localeCompare(String(right.name || ""), undefined, { sensitivity: "base", numeric: true }) ||
        String(left.equipmentId || "").localeCompare(String(right.equipmentId || ""), undefined, { sensitivity: "base", numeric: true })
      );
    }

    const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
    const page = Math.min(requestedPage, totalPages);
    const responseItems = isPaginatedRequest
      ? filtered.slice((page - 1) * pageSize, page * pageSize)
      : filtered;
    const equipmentRecordIds = responseItems.map((item) => item.id);
    const activeBorrowRecords = equipmentRecordIds.length
      ? await BorrowRecord.findAll({
          where: {
            equipmentRecordId: { [Op.in]: equipmentRecordIds },
            status: "Borrowed"
          },
          attributes: ["id", "equipmentRecordId", "borrowerName", "quantity", "borrowDate", "borrowStartTime", "created_at"],
          order: [["created_at", "DESC"], ["id", "DESC"]]
        })
      : [];
    const currentHoldersByEquipment = new Map();
    activeBorrowRecords.forEach((record) => {
      const holders = currentHoldersByEquipment.get(Number(record.equipmentRecordId)) || [];
      holders.push({ name: record.borrowerName, quantity: Number(record.quantity || 1) });
      currentHoldersByEquipment.set(Number(record.equipmentRecordId), holders);
    });
    const lastBorrowerByEquipment = new Map();
    activeBorrowRecords.forEach((record) => {
      const id = Number(record.equipmentRecordId);
      if (!lastBorrowerByEquipment.has(id)) {
        lastBorrowerByEquipment.set(id, {
          name: record.borrowerName,
          releasedAt: record.created_at || null,
          isCurrent: true
        });
      }
    });
    const equipmentResponse = responseItems.map((item) => ({
      ...item,
      currentHolders: currentHoldersByEquipment.get(Number(item.id)) || [],
      lastBorrower: lastBorrowerByEquipment.get(Number(item.id)) || null
    }));
    res.json(isPaginatedRequest
      ? { records: equipmentResponse, pagination: { page, pageSize, total: filtered.length, totalPages } }
      : equipmentResponse);
  } catch (error) {
    console.error("[equipment] Get equipment error:", error);
    res.status(500).json({ error: "Failed to load equipment." });
  }
};

export const getStudentEquipment = async (req, res) => {
  try {
    const authContext = await getUserAuthContext(req);
    if (!authContext.userId) {
      return res.status(401).json({ error: "Please log in to view available equipment." });
    }

    if (!["student", "faculty", "instructor"].includes(normalizeRoleName(authContext.role))) {
      return res.status(403).json({ error: "Student or Faculty access is required." });
    }
    const canViewAccountabilityTrail = ["faculty", "instructor"].includes(normalizeRoleName(authContext.role));

    const campusName = String(authContext.campus || "").trim().replace(/\s*Campus\s*$/i, "");
    if (!campusName) {
      return res.status(403).json({ error: "User campus is not assigned." });
    }

    const archivedEquipmentIds = await getArchivedEntityIds("equipment");
    const records = await Equipment.findAll({
      where: {
        equipmentId: { [Op.notIn]: archivedEquipmentIds },
        campus: {
          [Op.in]: [campusName, `${campusName} Campus`]
        }
      },
      attributes: ["id", "equipmentId", "name", "category", "laboratoryRoom", "status", "quantity", "setId", "serialNumber"],
      order: [["name", "ASC"], ["equipmentId", "ASC"]]
    });

    const activeBorrowRecords = records.length
      ? await BorrowRecord.findAll({
          where: {
            equipmentRecordId: { [Op.in]: records.map((item) => item.id) },
            status: { [Op.in]: ["Pending", "Approved", "Borrowed"] }
          },
          attributes: ["equipmentRecordId", "status"]
        })
      : [];
    const activeBorrowByEquipment = new Set(
      activeBorrowRecords.map((record) => Number(record.equipmentRecordId))
    );
    const activeBorrowStatusByEquipment = new Map();
    activeBorrowRecords.forEach((record) => {
      const key = Number(record.equipmentRecordId);
      const current = activeBorrowStatusByEquipment.get(key);
      if (!current || String(record.status || "").toLowerCase() === "borrowed") {
        activeBorrowStatusByEquipment.set(key, record.status);
      }
    });

    const assignments = records.length
      ? await EquipmentAssignment.findAll({
          where: {
            equipmentRecordId: { [Op.in]: records.map((item) => item.id) }
          },
          order: [["assignedAt", "ASC"], ["id", "ASC"]]
        })
      : [];
    const activeByEquipment = new Map();
    const assignmentsByEquipment = new Map();
    assignments.forEach((assignment) => {
      const key = Number(assignment.equipmentRecordId);
      const history = assignmentsByEquipment.get(key) || [];
      history.push(assignment);
      assignmentsByEquipment.set(key, history);
      if (!assignment.unassignedAt) {
        activeByEquipment.set(key, assignment);
      }
    });
    const borrowEvents = records.length
      ? await BorrowHistory.findAll({
          where: {
            equipmentRecordId: { [Op.in]: records.map((item) => item.id) },
            eventType: "borrowed"
          },
          attributes: ["recordId", "equipmentRecordId", "borrowerName", "created_at"],
          order: [["created_at", "DESC"], ["id", "DESC"]]
        })
      : [];
    const borrowerIdentities = borrowEvents.length
      ? await BorrowRequestAccountability.findAll({
          where: { borrowRecordId: { [Op.in]: borrowEvents.map((event) => event.recordId) } },
          attributes: ["borrowRecordId", "requesterUserId"]
        })
      : [];
    const borrowerIdByRecord = new Map(borrowerIdentities.map((identity) => [
      String(identity.borrowRecordId),
      Number(identity.requesterUserId)
    ]));
    const lastBorrowerByEquipment = new Map();
    borrowEvents.forEach((event) => {
      const equipmentRecordId = Number(event.equipmentRecordId);
      if (!lastBorrowerByEquipment.has(equipmentRecordId)) {
        lastBorrowerByEquipment.set(equipmentRecordId, {
          name: event.borrowerName,
          userId: borrowerIdByRecord.get(String(event.recordId)) || null,
          borrowedAt: event.created_at || null
        });
      }
    });
    const facultyIds = [...new Set(assignments.map((assignment) => Number(assignment.facultyUserId)))];
    const faculty = facultyIds.length
      ? await User.findAll({ where: { id: { [Op.in]: facultyIds } }, attributes: ["id", "name"] })
      : [];
    const facultyById = new Map(faculty.map((person) => [Number(person.id), person.name]));

    return res.json(records.map((record) => {
      const equipmentAssignments = assignmentsByEquipment.get(Number(record.id)) || [];
      const assignment = activeByEquipment.get(Number(record.id));
      return {
        ...record.toJSON(),
        hasActiveBorrowRecord: activeBorrowByEquipment.has(Number(record.id)),
        activeBorrowStatus: activeBorrowStatusByEquipment.get(Number(record.id)) || null,
        accountableFacultyUserId: assignment ? Number(assignment.facultyUserId) : null,
        accountableFacultyName: assignment ? facultyById.get(Number(assignment.facultyUserId)) || null : null,
        lastBorrower: canViewAccountabilityTrail
          ? lastBorrowerByEquipment.get(Number(record.id)) || null
          : null,
        accountabilityHistory: canViewAccountabilityTrail
          ? equipmentAssignments.map((entry) => ({
          assignmentId: entry.id,
          facultyUserId: Number(entry.facultyUserId),
          facultyName: facultyById.get(Number(entry.facultyUserId)) || `Faculty account #${entry.facultyUserId}`,
          assignedAt: entry.assignedAt,
          unassignedAt: entry.unassignedAt || null,
          remarks: entry.unassignmentRemarks || entry.remarks || null,
          isCurrent: !entry.unassignedAt
          }))
          : []
      };
    }));
  } catch (error) {
    console.error("[equipment] Get student equipment error:", error);
    return res.status(500).json({ error: "Failed to load available equipment." });
  }
};

export const getEquipmentCampusTotals = async (req, res) => {
  try {
    const authContext = await getUserAuthContext(req);
    if (!authContext.userId) {
      return res.status(401).json({ error: "Please log in to view equipment campus totals." });
    }

    const normalizedRole = normalizeRoleName(authContext.role);
    const canViewTotals = isAdminRole(normalizedRole) ||
      isTechnicianRole(normalizedRole);
    if (!canViewTotals) {
      return res.status(403).json({ error: "Admin or technician access is required." });
    }

    const userCampus = authContext.campus || null;
    const campusName = String(userCampus || "").trim().replace(/\s*Campus\s*$/i, "");
    if (isTechnicianRole(normalizedRole) && !campusName) {
      return res.status(403).json({ error: "User campus is not assigned." });
    }

    const where = {
      equipmentId: { [Op.notIn]: await getArchivedEntityIds("equipment") },
      ...(isTechnicianRole(normalizedRole)
        ? {
          campus: {
            [Op.in]: [campusName, `${campusName} Campus`]
          }
        }
        : {})
    };

    const rows = await Equipment.findAll({
      where,
      attributes: [
        "campus",
        [sequelize.fn("COUNT", sequelize.col("id")), "total"],
        [sequelize.fn("SUM", sequelize.literal("CASE WHEN setId IS NOT NULL AND TRIM(setId) <> '' THEN 1 ELSE 0 END")), "assigned"],
        [sequelize.fn("SUM", sequelize.literal("CASE WHEN setId IS NULL OR TRIM(setId) = '' THEN 1 ELSE 0 END")), "unassigned"],
        [sequelize.fn("SUM", sequelize.literal("CASE WHEN status = 'Serviceable' THEN 1 ELSE 0 END")), "serviceable"],
        [sequelize.fn("SUM", sequelize.literal("CASE WHEN status = 'Unserviceable' THEN 1 ELSE 0 END")), "unserviceable"],
        [sequelize.fn("SUM", sequelize.literal("CASE WHEN status = 'Lost' THEN 1 ELSE 0 END")), "lost"],
        [sequelize.fn("SUM", sequelize.literal("CASE WHEN status = 'Missing' THEN 1 ELSE 0 END")), "missing"]
      ],
      group: ["campus"],
      raw: true
    });

    const campusCounts = {};
    const allCampuses = { total: 0, assigned: 0, unassigned: 0, Serviceable: 0, Unserviceable: 0, Lost: 0, Missing: 0 };

    for (const row of rows) {
      const campusName = String(row.campus || "").trim();
      if (!campusName) continue;

      const summary = {
        total: Number(row.total || 0),
        assigned: Number(row.assigned || 0),
        unassigned: Number(row.unassigned || 0),
        Serviceable: Number(row.serviceable || 0),
        Unserviceable: Number(row.unserviceable || 0),
        Lost: Number(row.lost || 0),
        Missing: Number(row.missing || 0)
      };

      campusCounts[campusName] = summary;
      allCampuses.total += summary.total;
      allCampuses.assigned += summary.assigned;
      allCampuses.unassigned += summary.unassigned;
      allCampuses.Serviceable += summary.Serviceable;
      allCampuses.Unserviceable += summary.Unserviceable;
      allCampuses.Lost += summary.Lost;
      allCampuses.Missing += summary.Missing;
    }

    res.json({
      userCampus: userCampus || null,
      campusCounts,
      allCampuses
    });
  } catch (error) {
    console.error("[equipment] Get campus totals error:", error);
    res.status(500).json({ error: "Failed to load equipment campus totals." });
  }
};

export const getEquipmentQr = async (req, res) => {
  const { id } = req.params;
  try {
    const equipment = await findEquipmentByIdentifier(id, req);
    if (!equipment) {
      return res.status(404).json({ error: "Equipment not found." });
    }

    const userCampus = await getUserCampusFromSession(req);
    if (userCampus && !canManageRecord(userCampus, equipment.campus)) {
      return res.status(403).json({ error: "You do not have permission to view equipment from another campus." });
    }

    let qrCode = equipment.qrCode;
    let qrImage = equipment.qrImage;
    let qrGeneratedAt = equipment.qrGeneratedAt;

    const shouldRefreshQr = !qrCode || !qrImage || !isEquipmentQrUrl(qrCode, equipment.equipmentId);

    if (shouldRefreshQr) {
      const payload = buildEquipmentQrUrl(equipment.equipmentId);
      qrCode = payload;
      qrImage = await generateQrImage(payload);
      qrGeneratedAt = new Date();
      await equipment.update({ qrCode, qrImage, qrGeneratedAt });
    }

    res.json({
      equipment: {
        ...equipment.toJSON(),
        serialNumber: equipment.serialNumber || null,
        setId: equipment.setId || null,
        location: equipment.location || null
      },
      qrCode, qrImage, qrGeneratedAt
    });
  } catch (error) {
    res.status(500).json({ error: "Failed to load equipment QR." });
  }
};

export const createEquipment = async (req, res) => {
  const { assetNumber = "", name, campus: requestedCampus, laboratoryRoom, status, serialNumber, setId, manufacturer, model, purchaseDate, warrantyExpiry, condition, location, remarks } = req.body;
  const equipmentType = normalizeEquipmentType(name);
  const sessionRole = String(req.session?.userRole || "").toLowerCase();
  const allowedStatuses = ["Serviceable", "Unserviceable", "Lost", "Missing", "Under Maintenance", "In Use", "For Repair", "For Disposal"];
  const requestedStatus = typeof status === "string" ? status.trim() : "";
  if (requestedStatus && !allowedStatuses.includes(requestedStatus)) {
    return res.status(400).json({ error: `Invalid equipment status. Allowed values: ${allowedStatuses.join(", ")}.` });
  }
  const nextStatus = ["technician", "laboratory technician", "lab technician", "admin", "administrator"].includes(sessionRole)
    ? (requestedStatus || "Serviceable")
    : "Serviceable";
  if (!equipmentType) {
    return res.status(400).json({ error: "Equipment name is required." });
  }

  try {
    const userId = req.session?.userId;
    if (!userId) {
      return res.status(403).json({ error: "Unauthorized: Not authenticated." });
    }

    const userCampus = await getUserCampusFromSession(req);
    if (!userCampus) {
      return res.status(403).json({ error: "Unauthorized: Your account does not have a campus assigned. Contact administrator." });
    }

    if (requestedCampus && !canManageRecord(userCampus, requestedCampus)) {
      return res.status(403).json({ error: "You do not have permission to create equipment for this campus." });
    }

    const computerLab = laboratoryRoom ? await findComputerLabByLabel(laboratoryRoom, userCampus) : null;
    if (laboratoryRoom && !computerLab) {
      return res.status(400).json({ error: "Select a computer lab registered at your campus." });
    }

    // --- SERIAL NUMBER UNIQUENESS VALIDATION ---
    if (serialNumber && String(serialNumber).trim()) {
      const trimmedSN = String(serialNumber).trim();
      const snConflict = await Equipment.findOne({ where: { serialNumber: trimmedSN } });
      if (snConflict) {
        return res.status(409).json({
          error: `Serial number '${trimmedSN}' already exists. Each equipment must have a unique serial number.`,
          conflict: { equipmentId: snConflict.equipmentId, name: snConflict.name, campus: snConflict.campus }
        });
      }
    }

    // --- PC SET VALIDATION ---
    if (setId && String(setId).trim()) {
      const trimmedSetId = String(setId).trim();
      const [setRows] = await sequelize.query(
        'SELECT id, location, computerLabId, createdBy FROM equipment_sets WHERE setId = ? LIMIT 1',
        { replacements: [trimmedSetId] }
      );
      if (!setRows.length) {
        return res.status(404).json({ error: `Target PC Set '${trimmedSetId}' does not exist.` });
      }
      if (Number(setRows[0].createdBy) !== Number(userId)) {
        const componentCount = await Equipment.count({ where: { setId: trimmedSetId } });
        if (componentCount === 0) {
          return res.status(403).json({ error: "Only the PC set's creator can add its first component." });
        }
      }
      const setLabId = Number(setRows[0].computerLabId || 0) || null;
      const setLab = getLaboratoryNumber(setRows[0].location);
      const componentLab = getLegacyComputerLabNumber(computerLab) || getLaboratoryNumber(laboratoryRoom);
      if ((setLabId && Number(computerLab?.id) !== setLabId) || (!setLabId && (!setLab || componentLab !== setLab))) {
        return res.status(400).json({ error: "The selected PC set belongs to a different computer lab. Choose the matching lab for its component." });
      }
      const existingComponents = await Equipment.findAll({
        where: { setId: trimmedSetId },
        attributes: ["campus", "laboratoryRoom", "computerLabId"],
        raw: true
      });
      const mismatchedComponent = existingComponents.find((component) =>
        !canManageRecord(userCampus, component.campus) ||
        (setLabId
          ? Number(component.computerLabId || 0) !== setLabId
          : getLaboratoryNumber(component.laboratoryRoom) !== setLab)
      );
      if (mismatchedComponent) {
        return res.status(409).json({ error: `PC Set '${trimmedSetId}' already contains equipment assigned to a different campus or ComLab.` });
      }
      const duplicateType = await Equipment.findOne({
        where: { setId: trimmedSetId, category: equipmentType }
      });
      if (duplicateType) {
        return res.status(409).json({
          error: `PC Set '${trimmedSetId}' already contains a ${duplicateType.category} component. Duplicate component types are not allowed.`
        });
      }
    }

    const campus = getCanonicalCampusName(userCampus);
    const equipmentId = await generateEquipmentId(equipmentType, campus);
    const existing = await Equipment.findOne({
      where: { campus: { [Op.in]: [campus, campus.replace(/\s*Campus\s*$/i, "")] }, category: equipmentType, equipmentId }
    });
    if (existing) {
      return res.status(409).json({ error: "Generated Equipment ID already exists. Please try again." });
    }

    const dateAdded = new Date();
    const qrCode = buildEquipmentQrUrl(equipmentId);
    const qrImage = await generateQrImage(qrCode);
    const qrGeneratedAt = new Date();

    const equipment = await Equipment.create({
      equipmentId, assetNumber, name: equipmentType, category: equipmentType, campus, laboratoryRoom, computerLabId: computerLab?.id || null,
      status: nextStatus, dateAdded, qrCode, qrImage, qrGeneratedAt,
      serialNumber: serialNumber ? String(serialNumber).trim() : null,
      setId: setId ? String(setId).trim() : null,
      manufacturer: manufacturer || null, model: model || null,
      purchaseDate: purchaseDate || null, warrantyExpiry: warrantyExpiry || null,
      condition: condition || 'good', location: location || null, remarks: remarks || null
    });

    await logAuditEntry(req, {
      action: "Equipment Created",
      module: "Equipment Inventory",
      resourceId: equipment.equipmentId,
      description: `Equipment ${equipment.equipmentId} (${equipment.name}) was added to ${campus} campus.${equipment.serialNumber ? ` SN: ${equipment.serialNumber}.` : ''}${equipment.setId ? ` Set: ${equipment.setId}.` : ''}`
    });

    // Recalculate set status if assigned to a set
    if (equipment.setId) {
      await recalculateSetStatus(equipment.setId);
    }

    res.status(201).json(equipment);
  } catch (error) {
    console.error("[equipment] Create error:", error);
    if (error.name === "SequelizeUniqueConstraintError" && error.fields?.serialNumber) {
      return res.status(409).json({ error: "Serial number already exists. Each equipment must have a unique serial number." });
    }
    res.status(500).json({ error: "Failed to add equipment." });
  }
};

export const updateEquipment = async (req, res) => {
  const { id } = req.params;
  const { assetNumber = "", name, campus, laboratoryRoom, status, serialNumber, setId, manufacturer, model, purchaseDate, warrantyExpiry, condition, location, remarks } = req.body;
  const equipmentType = normalizeEquipmentType(name);
  if (!equipmentType || !campus) {
    return res.status(400).json({ error: "Equipment name and campus are required." });
  }

  try {
    const equipment = await findEquipmentByIdentifier(id, req);
    if (!equipment) {
      return res.status(404).json({ error: "Equipment not found." });
    }

    const sessionRole = String(req.session?.userRole || "").toLowerCase();
    const requestedStatus = typeof status === "string" ? status.trim() : "";

    const allowedStatuses = ["Serviceable", "Unserviceable", "Lost", "Missing", "Under Maintenance", "In Use", "For Repair", "For Disposal"];
    if (requestedStatus && !allowedStatuses.includes(requestedStatus)) {
      return res.status(400).json({ error: `Invalid equipment status. Allowed values: ${allowedStatuses.join(", ")}.` });
    }

    // Missing and maintenance statuses have dedicated workflows.
    // Those have dedicated endpoints: /report-missing and maintenance workflow
    if (requestedStatus && ["Missing", "Under Maintenance"].includes(requestedStatus)) {
      return res.status(400).json({ error: `Use the dedicated endpoint to mark equipment as '${requestedStatus}'.` });
    }

    if (requestedStatus && requestedStatus !== equipment.status && sessionRole !== "technician" && !isAdminRole(sessionRole)) {
      return res.status(403).json({ error: "Only technicians or admins may update equipment status." });
    }

    const userId = req.session?.userId;
    if (!userId) {
      return res.status(403).json({ error: "Unauthorized: Not authenticated." });
    }

    const userCampus = await getUserCampusFromSession(req);
    const equipmentCampus = equipment.campus;
    if (!userCampus || !canManageRecord(userCampus, equipmentCampus)) {
      return res.status(403).json({ error: "You do not have permission to modify equipment from another campus." });
    }
    if (!canManageRecord(userCampus, campus)) {
      return res.status(403).json({ error: "You do not have permission to assign equipment to another campus." });
    }

    const resolvedComputerLab = laboratoryRoom
      ? await findComputerLabByLabel(laboratoryRoom, campus)
      : null;
    if (laboratoryRoom && !resolvedComputerLab) {
      return res.status(400).json({ error: "Select a computer lab registered at your campus." });
    }

    // --- SERIAL NUMBER UNIQUENESS VALIDATION ---
    if (serialNumber !== undefined) {
      const trimmedSN = serialNumber ? String(serialNumber).trim() : null;
      if (trimmedSN) {
        const snConflict = await Equipment.findOne({
          where: { serialNumber: trimmedSN, id: { [Op.ne]: equipment.id } }
        });
        if (snConflict) {
          return res.status(409).json({
            error: `Serial number '${trimmedSN}' already exists on equipment ${snConflict.equipmentId} (${snConflict.name}).`,
            conflict: { equipmentId: snConflict.equipmentId, name: snConflict.name, campus: snConflict.campus }
          });
        }
      }
    }

    const nextSetId = setId === undefined ? equipment.setId : (setId ? String(setId).trim() : null);
    if (nextSetId) {
      const [setRows] = await sequelize.query(
        "SELECT id FROM equipment_sets WHERE setId = ? LIMIT 1",
        { replacements: [nextSetId], type: QueryTypes.SELECT }
      );
      if (!setRows) {
        return res.status(404).json({ error: `Target PC Set '${nextSetId}' does not exist.` });
      }
      const duplicateType = await Equipment.findOne({
        where: {
          setId: nextSetId,
          category: equipmentType,
          id: { [Op.ne]: equipment.id }
        }
      });
      if (duplicateType) {
        return res.status(409).json({
          error: `PC Set '${nextSetId}' already contains a ${duplicateType.category} component. Duplicate component types are not allowed.`
        });
      }
    }

    const oldCampus = equipment.campus;
    const oldSetId = equipment.setId || null;
    const nextStatus = requestedStatus || equipment.status || "Serviceable";
    const updateData = {
      assetNumber, name: equipmentType, category: equipmentType, campus, laboratoryRoom, computerLabId: resolvedComputerLab?.id || null, status: nextStatus,
      manufacturer: manufacturer !== undefined ? manufacturer || null : equipment.manufacturer,
      model: model !== undefined ? model || null : equipment.model,
      purchaseDate: purchaseDate !== undefined ? purchaseDate || null : equipment.purchaseDate,
      warrantyExpiry: warrantyExpiry !== undefined ? warrantyExpiry || null : equipment.warrantyExpiry,
      condition: condition !== undefined ? condition || equipment.condition : equipment.condition,
      location: location !== undefined ? location || null : equipment.location,
      remarks: remarks !== undefined ? remarks || null : equipment.remarks,
      setId: nextSetId,
    };
    if (serialNumber !== undefined) {
      updateData.serialNumber = serialNumber ? String(serialNumber).trim() : null;
    }
    await equipment.update(updateData);
    if (oldSetId && oldSetId !== nextSetId) await recalculateSetStatus(oldSetId);
    if (nextSetId) await recalculateSetStatus(nextSetId);

    const campusChange = oldCampus !== campus ? ` (moved from ${oldCampus})` : "";
    await logAuditEntry(req, {
      action: "Equipment Updated",
      module: "Equipment Inventory",
      resourceId: equipment.equipmentId,
      description: `Equipment ${equipment.equipmentId} (${name}) was updated${campusChange}.${updateData.serialNumber ? ` SN: ${updateData.serialNumber}.` : ''}`
    });

    res.json(equipment);
  } catch (error) {
    console.error("[equipment] Update error:", error);
    if (error.name === "SequelizeUniqueConstraintError" && error.fields?.serialNumber) {
      return res.status(409).json({ error: "Serial number already exists. Each equipment must have a unique serial number." });
    }
    res.status(500).json({ error: "Failed to update equipment." });
  }
};

export const updateEquipmentStatus = async (req, res) => {
  const { id } = req.params;
  const requestedStatus = String(req.body?.status || "").trim();
  // Missing and Under Maintenance have their own dedicated endpoints
  const validStatuses = ["Serviceable", "Unserviceable", "Lost", "In Use", "For Repair", "For Disposal"];

  if (!validStatuses.includes(requestedStatus)) {
    return res.status(400).json({ error: `Status must be one of: ${validStatuses.join(', ')}. Use /report-missing or the maintenance workflow for Missing/Under Maintenance.` });
  }

  try {
    const equipment = await findEquipmentByIdentifier(id, req);
    if (!equipment) {
      return res.status(404).json({ error: "Equipment not found." });
    }

    const sessionRole = String(req.session?.userRole || "").toLowerCase();
    if (sessionRole !== "technician") {
      return res.status(403).json({ error: "Only technicians may update equipment condition status." });
    }

    const userCampus = await getUserCampusFromSession(req);
    if (!userCampus || !canManageRecord(userCampus, equipment.campus)) {
      return res.status(403).json({ error: "You do not have permission to manage equipment in this campus." });
    }

    const previousStatus = equipment.status;
    await equipment.update({ status: requestedStatus });

    // Recalculate set status if part of a set
    if (equipment.setId) {
      await recalculateSetStatus(equipment.setId);
    }

    await logAuditEntry(req, {
      action: "Equipment Status Updated",
      module: "Equipment Inventory",
      resourceId: equipment.equipmentId,
      description: `Equipment ${equipment.equipmentId} (${equipment.name}) was marked ${requestedStatus} by the technician.`,
      details: {
        equipmentId: equipment.equipmentId,
        campus: equipment.campus,
        previousStatus,
        newStatus: requestedStatus
      }
    });

    return res.json({
      success: true,
      equipment,
      status: requestedStatus,
      previousStatus
    });
  } catch (error) {
    console.error("[equipment] Update status error:", error);
    return res.status(500).json({ error: "Failed to update equipment status." });
  }
};

export const deleteEquipment = async (req, res) => {
  return res.status(410).json({ error: "Permanent deletion is disabled. Use Archive instead." });
};

export const getEquipmentCategories = async (req, res) => {
  try {
    const archivedIds = await getArchivedEntityIds("equipment-category");
    const categories = await EquipmentCategory.findAll({ order: [["name", "ASC"]] });
    res.json(categories.filter((category) => !archivedIds.includes(String(category.id))));
  } catch (error) {
    res.status(500).json({ error: "Failed to load categories." });
  }
};

export const createEquipmentCategory = async (req, res) => {
  const { name, prefix } = req.body;
  if (!name || !prefix) {
    return res.status(400).json({ error: "Category name and prefix are required." });
  }

  const trimmedName = String(name).trim();
  const trimmedPrefix = String(prefix).trim().toUpperCase();

  if (!trimmedName || !trimmedPrefix) {
    return res.status(400).json({ error: "Category name and prefix cannot be empty." });
  }

  try {
    const existingName = await EquipmentCategory.findOne({ where: { name: trimmedName } });
    if (existingName) {
      return res.status(409).json({ error: "Category name already exists." });
    }

    const existingPrefix = await EquipmentCategory.findOne({ where: { prefix: trimmedPrefix } });
    if (existingPrefix) {
      return res.status(409).json({ error: "Prefix already exists." });
    }

    const category = await EquipmentCategory.create({ name: trimmedName, prefix: trimmedPrefix });
    res.status(201).json(category);
  } catch (error) {
    if (error.name === "SequelizeUniqueConstraintError") {
      return res.status(409).json({ error: "Category name or prefix already exists." });
    }
    res.status(500).json({ error: "Failed to create category." });
  }
};

export const deleteEquipmentCategory = async (req, res) => {
  return res.status(410).json({ error: "Permanent deletion is disabled. Use Archive instead." });
};

// ============================================================
// EQUIPMENT INVENTORY ENHANCEMENTS — Phase 2
// ============================================================
import { MissingEquipmentHistory } from "../models/missingEquipmentHistoryModel.js";

/**
 * Shared helper: recalculate and persist a PC Set's status
 * based on the current condition of all its components.
 * Rules:
 *   - Any component is "Missing"        → incomplete
 *   - Any component is "Under Maintenance" → maintenance
 *   - Any component is "Unserviceable"  → incomplete
 *   - All components Serviceable + has System Unit+Monitor → active
 *   - Has components but missing essentials → incomplete
 *   - No components → incomplete
 */
export async function recalculateSetStatus(setId) {
  if (!setId) return;
  try {
    const components = await Equipment.findAll({
      where: { setId },
      attributes: ["category", "status"]
    });

    if (!components.length) {
      await sequelize.query(
        "UPDATE equipment_sets SET status = 'incomplete', updatedAt = NOW() WHERE setId = ?",
        { replacements: [setId] }
      );
      return;
    }

    const statuses = components.map(c => String(c.status || "").toLowerCase());
    const categories = components.map(c => String(c.category || "").toLowerCase());

    let newStatus = "active";

    if (statuses.some(s => s === "missing")) {
      newStatus = "incomplete";
    } else if (statuses.some(s => s === "under maintenance")) {
      newStatus = "maintenance";
    } else if (statuses.some(s => s === "unserviceable")) {
      newStatus = "incomplete";
    } else {
      // All serviceable — check essentials
      const hasSystemUnit = categories.some(c => c === "cpu" || c === "computer" || c === "system unit");
      const hasMonitor = categories.some(c => c === "monitor");
      if (!hasSystemUnit || !hasMonitor) newStatus = "incomplete";
    }

    await sequelize.query(
      "UPDATE equipment_sets SET status = ?, updatedAt = NOW() WHERE setId = ?",
      { replacements: [newStatus, setId] }
    );
  } catch (err) {
    console.warn(`[equipment] recalculateSetStatus failed for ${setId}:`, err.message);
  }
}

// ---- TASK 5: REPORT MISSING ----
export const reportEquipmentMissing = async (req, res) => {
  const { id } = req.params;
  const { reason } = req.body;

  if (!reason || !String(reason).trim()) {
    return res.status(400).json({ error: "A reason or notes are required when reporting equipment as missing." });
  }

  try {
    const equipment = await findEquipmentByIdentifier(id, req);
    if (!equipment) return res.status(404).json({ error: "Equipment not found." });

    const userCampus = await getUserCampusFromSession(req);
    if (userCampus && !canManageRecord(userCampus, equipment.campus)) {
      return res.status(403).json({ error: "You do not have permission to manage equipment from another campus." });
    }

    if (equipment.status === "Missing") {
      return res.status(409).json({ error: "Equipment is already marked as Missing." });
    }

    const userId = req.session?.userId || null;
    const user = userId ? await User.findByPk(userId, { attributes: ["name"] }) : null;
    const userName = user?.name || "Unknown User";
    const now = new Date();

    // Preserve setId — do NOT clear it
    const originalSetId = equipment.setId;

    // Update equipment status — keep setId unchanged
    await equipment.update({
      status: "Missing",
      missingReportedAt: now,
      missingReportedBy: userId,
      missingReason: String(reason).trim(),
      foundAt: null,
      foundBy: null
    });

    // Create missing history record
    await MissingEquipmentHistory.create({
      equipmentId: equipment.id,
      equipmentCode: equipment.equipmentId,
      serialNumber: equipment.serialNumber || null,
      setId: originalSetId || null,
      campus: equipment.campus,
      laboratoryRoom: equipment.laboratoryRoom || null,
      location: equipment.location || null,
      eventType: "reported_missing",
      reportedBy: userId,
      reportedByName: userName,
      reportedAt: now,
      reason: String(reason).trim()
    });

    // Audit log
    await logAuditEntry(req, {
      action: "Equipment Reported Missing",
      module: "Equipment Inventory",
      resourceId: equipment.equipmentId,
      description: `Equipment ${equipment.equipmentId} (${equipment.name}) reported as Missing by ${userName}.${equipment.serialNumber ? ` SN: ${equipment.serialNumber}.` : ''}${originalSetId ? ` Original Set: ${originalSetId}.` : ''} Reason: ${String(reason).trim()}`
    });

    // Recalculate set status (set becomes incomplete)
    if (originalSetId) {
      await recalculateSetStatus(originalSetId);
    }

    return res.json({
      success: true,
      message: "Equipment has been marked as Missing.",
      equipment: {
        id: equipment.id,
        equipmentId: equipment.equipmentId,
        name: equipment.name,
        serialNumber: equipment.serialNumber,
        setId: equipment.setId,  // setId preserved
        status: "Missing",
        missingReportedAt: now,
        campus: equipment.campus
      }
    });
  } catch (error) {
    console.error("[equipment] reportMissing error:", error);
    return res.status(500).json({ error: "Failed to report equipment as missing." });
  }
};

// ---- TASK 6: MARK AS FOUND ----
export const markEquipmentFound = async (req, res) => {
  const { id } = req.params;
  const { notes } = req.body;

  try {
    const equipment = await findEquipmentByIdentifier(id, req);
    if (!equipment) return res.status(404).json({ error: "Equipment not found." });

    const userCampus = await getUserCampusFromSession(req);
    if (userCampus && !canManageRecord(userCampus, equipment.campus)) {
      return res.status(403).json({ error: "You do not have permission to manage equipment from another campus." });
    }

    if (equipment.status !== "Missing") {
      return res.status(409).json({
        error: `Equipment cannot be marked as Found because it is not currently Missing. Current status: ${equipment.status}.`
      });
    }

    const userId = req.session?.userId || null;
    const user = userId ? await User.findByPk(userId, { attributes: ["name"] }) : null;
    const userName = user?.name || "Unknown User";
    const now = new Date();
    const originalSetId = equipment.setId;

    // Restore to Serviceable — keep equipmentId, serialNumber, setId all unchanged
    await equipment.update({
      status: "Serviceable",
      foundAt: now,
      foundBy: userId
    });

    // Create found history record
    await MissingEquipmentHistory.create({
      equipmentId: equipment.id,
      equipmentCode: equipment.equipmentId,
      serialNumber: equipment.serialNumber || null,
      setId: originalSetId || null,
      campus: equipment.campus,
      laboratoryRoom: equipment.laboratoryRoom || null,
      location: equipment.location || null,
      eventType: "found",
      reportedBy: userId,
      reportedByName: userName,
      reportedAt: now,
      reason: notes ? String(notes).trim() : null,
      resolvedAt: now,
      resolvedBy: userId,
      resolvedByName: userName
    });

    await logAuditEntry(req, {
      action: "Equipment Marked Found",
      module: "Equipment Inventory",
      resourceId: equipment.equipmentId,
      description: `Equipment ${equipment.equipmentId} (${equipment.name}) marked as Found by ${userName}.${equipment.serialNumber ? ` SN: ${equipment.serialNumber}.` : ''}${originalSetId ? ` Restored to Set: ${originalSetId}.` : ''}`
    });

    // Recalculate set status (may become active again)
    if (originalSetId) {
      await recalculateSetStatus(originalSetId);
    }

    return res.json({
      success: true,
      message: "Equipment has been marked as Found and restored to Serviceable.",
      equipment: {
        id: equipment.id,
        equipmentId: equipment.equipmentId,
        name: equipment.name,
        serialNumber: equipment.serialNumber,
        setId: equipment.setId,  // setId unchanged
        status: "Serviceable",
        foundAt: now,
        campus: equipment.campus
      }
    });
  } catch (error) {
    console.error("[equipment] markFound error:", error);
    return res.status(500).json({ error: "Failed to mark equipment as found." });
  }
};

// ---- TASK 7: TRANSFER EQUIPMENT BETWEEN SETS ----
export const transferEquipmentSet = async (req, res) => {
  const { id } = req.params;
  const { targetSetId, reason } = req.body;

  if (!reason || !String(reason).trim()) {
    return res.status(400).json({ error: "A reason is required for transferring equipment between sets." });
  }

  try {
    const equipment = await findEquipmentByIdentifier(id, req);
    if (!equipment) return res.status(404).json({ error: "Equipment not found." });

    const userCampus = await getUserCampusFromSession(req);
    if (userCampus && !canManageRecord(userCampus, equipment.campus)) {
      return res.status(403).json({ error: "You do not have permission to manage equipment from another campus." });
    }

    // Block transfer of Missing equipment
    if (equipment.status === "Missing") {
      return res.status(409).json({
        error: "Cannot transfer Missing equipment. Mark it as Found first before transferring to another set."
      });
    }

    const oldSetId = equipment.setId || null;
    const newSetId = targetSetId ? String(targetSetId).trim() : null;

    if (oldSetId === newSetId) {
      return res.status(409).json({ error: "Equipment is already assigned to this set." });
    }

    // Validate target set exists
    if (newSetId) {
      let targetSetExists = false;
      try {
        const setRows = await sequelize.query(
          "SELECT id, setName FROM equipment_sets WHERE setId = ? LIMIT 1",
          { replacements: [newSetId], type: "SELECT" }
        );
        targetSetExists = Array.isArray(setRows) && setRows.length > 0;
      } catch (setLookupError) {
        // Some existing installations derive PC sets directly from equipment.setId
        // and do not have the optional equipment_sets table.
        if (!/table.*doesn't exist|unknown table/i.test(String(setLookupError.message))) {
          throw setLookupError;
        }
        targetSetExists = await Equipment.count({ where: { setId: newSetId } }) > 0;
      }

      if (!targetSetExists) {
        return res.status(404).json({ error: `Target PC Set '${newSetId}' does not exist.` });
      }

      const duplicateType = await Equipment.findOne({
        where: {
          setId: newSetId,
          category: equipment.category,
          id: { [Op.ne]: equipment.id }
        }
      });
      if (duplicateType) {
        return res.status(409).json({
          error: `PC Set '${newSetId}' already contains a ${duplicateType.category} component. Duplicate component types are not allowed.`
        });
      }
    }

    const userId = req.session?.userId || null;
    const user = userId ? await User.findByPk(userId, { attributes: ["name"] }) : null;
    const userName = user?.name || "Unknown User";
    const now = new Date();

    // Update the setId
    await equipment.update({ setId: newSetId });

    // Create transfer history record
    await MissingEquipmentHistory.create({
      equipmentId: equipment.id,
      equipmentCode: equipment.equipmentId,
      serialNumber: equipment.serialNumber || null,
      setId: newSetId || null,
      campus: equipment.campus,
      laboratoryRoom: equipment.laboratoryRoom || null,
      location: equipment.location || null,
      eventType: "transferred",
      reportedBy: userId,
      reportedByName: userName,
      reportedAt: now,
      reason: `Transferred from Set: ${oldSetId || 'None'} → ${newSetId || 'None'}. ${String(reason).trim()}`,
      notes: `Previous Set: ${oldSetId || 'None'}`
    });

    const rawRole = String(req.session?.userRole || "").trim().toLowerCase();
    const auditRole = ["student", "faculty", "technician", "admin"].includes(rawRole) ? rawRole : "admin";

    await EquipmentAuditTrail.create({
      equipmentId: equipment.id,
      serialNumber: equipment.serialNumber || null,
      actionType: newSetId ? "assigned_to_set" : "removed_from_set",
      actionDescription: `Equipment ${equipment.equipmentId} moved from Set ${oldSetId || 'None'} to ${newSetId || 'None'}. Reason: ${String(reason).trim()}`,
      performedBy: userId,
      performedByName: userName,
      userRole: auditRole,
      beforeState: { setId: oldSetId },
      afterState: { setId: newSetId, reason: String(reason).trim() },
      ipAddress: req.ip || null,
      userAgent: req.get("user-agent") || null,
      actionTimestamp: now
    });

    // Recalculate both old and new set statuses
    if (oldSetId) await recalculateSetStatus(oldSetId);
    if (newSetId) await recalculateSetStatus(newSetId);

    return res.json({
      success: true,
      message: `Equipment transferred from ${oldSetId || 'No Set'} to ${newSetId || 'No Set'}.`,
      equipment: {
        id: equipment.id,
        equipmentId: equipment.equipmentId,
        name: equipment.name,
        serialNumber: equipment.serialNumber,
        setId: newSetId,
        previousSetId: oldSetId,
        status: equipment.status,
        campus: equipment.campus
      }
    });
  } catch (error) {
    console.error("[equipment] transferSet error:", error);
    return res.status(500).json({ error: "Failed to transfer equipment to target set." });
  }
};

// ---- TASK 8A: GET ALL MISSING EQUIPMENT ----
export const getMissingEquipment = async (req, res) => {
  try {
    const userCampus = await getUserCampusFromSession(req);
    if (!userCampus) return res.status(403).json({ error: "User campus is not assigned." });

    const campusVariants = getCampusVariants(userCampus);
    const missing = await Equipment.findAll({
      where: {
        status: "Missing",
        campus: { [Op.in]: campusVariants }
      },
      order: [["missingReportedAt", "DESC"]]
    });

    // Enrich with reporter name
    const userIds = [...new Set(missing.map(e => e.missingReportedBy).filter(Boolean))];
    const users = userIds.length
      ? await User.findAll({ where: { id: { [Op.in]: userIds } }, attributes: ["id", "name"] })
      : [];
    const userMap = new Map(users.map(u => [u.id, u.name]));

    const result = missing.map(e => ({
      id: e.id,
      equipmentId: e.equipmentId,
      name: e.name,
      category: e.category,
      serialNumber: e.serialNumber || null,
      setId: e.setId || null,
      campus: e.campus,
      laboratoryRoom: e.laboratoryRoom || null,
      location: e.location || null,
      status: e.status,
      missingReportedAt: e.missingReportedAt,
      missingReportedBy: e.missingReportedBy,
      missingReportedByName: userMap.get(e.missingReportedBy) || null,
      missingReason: e.missingReason || null
    }));

    return res.json(result);
  } catch (error) {
    console.error("[equipment] getMissingEquipment error:", error);
    return res.status(500).json({ error: "Failed to load missing equipment." });
  }
};

// ---- TASK 8B: GET EQUIPMENT HISTORY (missing/found/transfer events) ----
export const getEquipmentHistory = async (req, res) => {
  const { id } = req.params;
  try {
    const equipment = await findEquipmentByIdentifier(id, req);
    if (!equipment) return res.status(404).json({ error: "Equipment not found." });

    const userCampus = await getUserCampusFromSession(req);
    if (userCampus && !canManageRecord(userCampus, equipment.campus)) {
      return res.status(403).json({ error: "You do not have permission to view this equipment." });
    }

    const history = await sequelize.query(
      `SELECT meh.*,
              COALESCE(NULLIF(NULLIF(meh.reportedByName, ''), 'Unknown User'), reporter.name, reporter.email,
                CASE WHEN meh.reportedBy IS NULL THEN NULL ELSE CONCAT('User #', meh.reportedBy) END) AS reportedByDisplayName,
              COALESCE(NULLIF(NULLIF(meh.resolvedByName, ''), 'Unknown User'), resolver.name, resolver.email,
                CASE WHEN meh.resolvedBy IS NULL THEN NULL ELSE CONCAT('User #', meh.resolvedBy) END) AS resolvedByDisplayName
       FROM missing_equipment_history meh
       LEFT JOIN users reporter ON reporter.id = meh.reportedBy
       LEFT JOIN users resolver ON resolver.id = meh.resolvedBy
       WHERE meh.equipmentId = ?
       ORDER BY meh.reportedAt DESC`,
      { replacements: [equipment.id], type: QueryTypes.SELECT }
    );
    const usageHistory = await sequelize.query(
      `SELECT eul.id, eul.userId, eul.attendanceId, eul.pcSetId,
            eul.serialNumber, eul.usageStartTime, eul.usageEndTime,
            eul.durationMinutes, eul.sessionNotes,
            u.name AS userName, u.email AS userEmail, u.student_number AS studentNumber,
            a.subject, a.courseSection, a.instructor, a.lab,
            CASE WHEN a.id IS NULL THEN 'Class not linked' ELSE 'Linked to attendance' END AS traceStatus
       FROM equipment_usage_logs eul
       LEFT JOIN users u ON u.id = eul.userId
       LEFT JOIN attendance a ON a.id = eul.attendanceId
       WHERE eul.equipmentId = ?
       ORDER BY eul.usageStartTime DESC
       LIMIT 100`,
      { replacements: [equipment.id], type: QueryTypes.SELECT }
    );
    const auditHistory = await EquipmentAuditTrail.findAll({
      where: { equipmentId: equipment.id },
      order: [["actionTimestamp", "DESC"]],
      limit: 100
    });
    const auditEvents = auditHistory.map((entry) => {
      const item = entry.toJSON();
      return {
        eventType: item.actionType,
        reportedAt: item.actionTimestamp,
        reportedByDisplayName: item.performedByName || (item.performedBy ? `User #${item.performedBy}` : null),
        reason: item.actionDescription,
        notes: item.afterState || null,
        setId: item.afterState?.setId || null,
        serialNumber: item.serialNumber || equipment.serialNumber || null
      };

    });
    const recordedAssignment = [...history, ...auditEvents].some((event) =>
      ["assigned_to_set", "transferred"].includes(event.eventType) &&
      event.setId === equipment.setId
    );
    const legacyAssignment = equipment.setId && !recordedAssignment
      ? [{
          eventType: "legacy_assignment",
          reportedAt: null,
          reportedByDisplayName: "Unavailable (legacy assignment)",
          reason: "This equipment is currently assigned to this set, but the original assignment date and user were not recorded.",
          setId: equipment.setId,
          serialNumber: equipment.serialNumber || null
        }]
      : [];

    return res.json({
      equipment: {
        id: equipment.id,
        equipmentId: equipment.equipmentId,
        name: equipment.name,
        category: equipment.category,
        serialNumber: equipment.serialNumber || null,
        setId: equipment.setId || null,
        campus: equipment.campus,
        status: equipment.status,
        missingReportedAt: equipment.missingReportedAt || null,
        missingReportedBy: equipment.missingReportedBy || null,
        missingReason: equipment.missingReason || null,
        foundAt: equipment.foundAt || null
      },
      history: [...history, ...auditEvents, ...legacyAssignment].sort((left, right) =>
        new Date(right.reportedAt || 0).getTime() - new Date(left.reportedAt || 0).getTime()
      ),
      usageHistory
    });
  } catch (error) {
    console.error("[equipment] getEquipmentHistory error:", error);
    return res.status(500).json({ error: "Failed to load equipment history." });
  }
};

export const getEquipmentBorrowCycle = async (req, res) => {
  try {
    const equipment = await findEquipmentByIdentifier(req.params.id, req);
    if (!equipment) return res.status(404).json({ error: "Equipment not found." });

    const authContext = await getUserAuthContext(req);
    if (!authContext.userId) return res.status(401).json({ error: "Please log in to view this equipment's borrow cycle." });
    const userCampus = await getUserCampusFromSession(req);
    if (userCampus && !canManageRecord(userCampus, equipment.campus)) {
      return res.status(403).json({ error: "You do not have permission to view this equipment's borrow cycle." });
    }

    const campusVariants = getCampusVariants(equipment.campus);
    const [assignments, borrowRecords] = await Promise.all([
      EquipmentAssignment.findAll({
        where: { equipmentRecordId: equipment.id },
        order: [["assignedAt", "ASC"], ["id", "ASC"]]
      }),
      BorrowRecord.findAll({
        where: {
          [Op.or]: [
            { equipmentRecordId: equipment.id },
            {
              equipmentRecordId: null,
              equipmentId: equipment.equipmentId,
              campus: { [Op.in]: campusVariants }
            }
          ],
          status: { [Op.in]: ["Borrowed", "Returned", "Lost", "Pending Replacement", "borrowed", "returned", "lost", "pending replacement"] }
        },
        order: [["borrowDate", "ASC"], ["borrowStartTime", "ASC"], ["created_at", "ASC"]]
      })
    ]);
    const identities = borrowRecords.length
      ? await BorrowRequestAccountability.findAll({
          where: { borrowRecordId: { [Op.in]: borrowRecords.map((record) => record.id) } },
          attributes: ["borrowRecordId", "requesterUserId"]
        })
      : [];
    const userIds = [...new Set([
      ...assignments.flatMap((assignment) => [Number(assignment.facultyUserId), Number(assignment.assignedByAdminId)]),
      ...identities.map((identity) => Number(identity.requesterUserId))
    ].filter((id) => Number.isInteger(id) && id > 0))];
    const users = userIds.length
      ? await User.findAll({ where: { id: { [Op.in]: userIds } }, attributes: ["id", "name", "role", "college"] })
      : [];
    const userById = new Map(users.map((user) => [Number(user.id), user.name]));
    const roleById = new Map(users.map((user) => [Number(user.id), user.role]));
    const collegeById = new Map(users.map((user) => [Number(user.id), user.college]));
    const borrowerIdByRecord = new Map(identities.map((identity) => [
      String(identity.borrowRecordId),
      Number(identity.requesterUserId)
    ]));

    const events = [
      ...assignments.map((assignment) => ({
        type: "mir",
        occurredAt: assignment.assignedAt,
        facultyName: userById.get(Number(assignment.facultyUserId)) || `Faculty account #${assignment.facultyUserId}`,
        assignedByName: userById.get(Number(assignment.assignedByAdminId)) || null,
        isCurrent: !assignment.unassignedAt
      })),
      ...borrowRecords.map((record) => {
        const date = record.borrowDate instanceof Date
          ? record.borrowDate.toISOString().slice(0, 10)
          : String(record.borrowDate || "").slice(0, 10);
        const time = String(record.borrowStartTime || "00:00").slice(0, 5);
        const occurredAt = date
          ? new Date(`${date}T${time}:00+08:00`)
          : record.created_at;
        const borrowerUserId = borrowerIdByRecord.get(String(record.id)) || null;
        return {
          type: "borrowed",
          occurredAt,
          borrowDate: date || null,
          borrowStartTime: time,
          borrowerName: record.borrowerName || "Unknown borrower",
          borrowerUserId,
          borrowerRole: borrowerUserId ? roleById.get(borrowerUserId) || record.borrowerType : record.borrowerType,
          borrowerCollege: record.departmentInfo || (borrowerUserId && collegeById.get(borrowerUserId)) || null,
          status: record.status,
          returnDate: record.returnDate || null,
          returnTime: record.returnTime || null,
          condition: record.condition || null,
          remarks: record.remarks || null,
          createdAt: record.created_at || null,
          recordId: record.id
        };
      })
    ].sort((left, right) => {
      const leftTime = new Date(left.occurredAt || 0).getTime();
      const rightTime = new Date(right.occurredAt || 0).getTime();
      const leftMinute = Math.floor(leftTime / 60_000);
      const rightMinute = Math.floor(rightTime / 60_000);
      if (leftMinute !== rightMinute) return leftMinute - rightMinute;
      if (left.type === "borrowed" && right.type === "borrowed") {
        const leftCreatedAt = new Date(left.createdAt || 0).getTime();
        const rightCreatedAt = new Date(right.createdAt || 0).getTime();
        if (leftCreatedAt !== rightCreatedAt) return leftCreatedAt - rightCreatedAt;
      }
      if (left.type === right.type && leftTime !== rightTime) return leftTime - rightTime;
      if (left.type !== right.type) return left.type === "mir" ? -1 : 1;
      return String(left.recordId || left.facultyName || "").localeCompare(
        String(right.recordId || right.facultyName || "")
      );
    });
    const lastBorrowEvent = [...events].reverse().find((event) => event.type === "borrowed");
    if (lastBorrowEvent) lastBorrowEvent.isLastBorrower = true;

    return res.json({
      equipment: {
        equipmentId: equipment.equipmentId,
        name: equipment.name,
        serialNumber: equipment.serialNumber || null
      },
      currentMIR: assignments
        .filter((assignment) => !assignment.unassignedAt)
        .map((assignment) => userById.get(Number(assignment.facultyUserId)) || `Faculty account #${assignment.facultyUserId}`),
      lastBorrower: lastBorrowEvent?.borrowerName || null,
      lastBorrowerStatus: lastBorrowEvent?.status || null,
      lastBorrowerReturnDate: lastBorrowEvent?.returnDate || null,
      lastBorrowerReturnTime: lastBorrowEvent?.returnTime || null,
      events
    });
  } catch (error) {
    console.error("[equipment] Failed to load equipment borrow cycle:", error);
    return res.status(500).json({ error: "Failed to load equipment borrow cycle." });
  }
};

export const logEquipmentScan = async (req, res) => {
  try {
    const authContext = await getUserAuthContext(req);
    if (!authContext.userId) return res.status(401).json({ error: "Please log in to record an equipment scan." });
    if (!authContext.campus) return res.status(403).json({ error: "Your account must be assigned to a campus to record equipment scans." });

    const equipment = await findEquipmentByIdentifier(req.params.id, req);
    if (!equipment) return res.status(404).json({ error: "Equipment not found in your campus." });
    if (!canManageRecord(authContext.campus, equipment.campus)) {
      return res.status(403).json({ error: "You do not have permission to record a scan for this equipment." });
    }

    const user = await User.findByPk(authContext.userId, { attributes: ["name", "role"] });
    if (!user) return res.status(401).json({ error: "Authenticated user could not be found." });
    const role = normalizeRoleName(user.role || authContext.role);
    const userRole = role.includes("admin")
      ? "admin"
      : role.includes("technician")
        ? "technician"
        : ["faculty", "instructor"].includes(role)
          ? "faculty"
          : role === "student" ? "student" : null;
    if (!userRole) return res.status(403).json({ error: "Your account role cannot record equipment scans." });

    const entry = await EquipmentAuditTrail.create({
      equipmentId: equipment.id,
      serialNumber: equipment.serialNumber || null,
      actionType: "equipment_scanned",
      actionDescription: `Equipment QR scanned: ${equipment.name} (${equipment.equipmentId})`,
      performedBy: authContext.userId,
      performedByName: user.name || null,
      userRole,
      ipAddress: req.ip || null,
      userAgent: req.get("user-agent") || null,
      actionTimestamp: new Date()
    });
    return res.status(201).json({ success: true, scannedAt: entry.actionTimestamp });
  } catch (error) {
    console.error("[equipment] Failed to record equipment scan:", error);
    return res.status(500).json({ error: "Failed to record equipment scan." });
  }
};

export const getEquipmentScanHistory = async (req, res) => {
  try {
    const authContext = await getUserAuthContext(req);
    if (!authContext.userId) return res.status(401).json({ error: "Please log in to view equipment scan history." });

    const role = normalizeRoleName(authContext.role);
    if (!["faculty", "instructor", "student", "admin", "administrator", "technician"].includes(role)) {
      return res.status(403).json({ error: "You do not have permission to view equipment scan history." });
    }
    if (!authContext.campus) {
      return res.status(403).json({ error: "Your account must be assigned to a campus to view equipment scan history." });
    }

    const campusVariants = getCampusVariants(authContext.campus);
    const isFaculty = ["faculty", "instructor"].includes(role);
    const assignedEquipmentIds = isFaculty
      ? [...new Set((await EquipmentAssignment.findAll({
          where: { facultyUserId: authContext.userId, unassignedAt: null },
          attributes: ["equipmentRecordId"]
        })).map((assignment) => Number(assignment.equipmentRecordId)).filter(Number.isInteger))]
      : [];
    const assignedEquipmentFilter = assignedEquipmentIds.length
      ? " OR eat.equipmentId IN (?)"
      : "";
    const canReviewCampusActivity = ["technician", "admin", "administrator"].includes(role);
    const actorFilter = canReviewCampusActivity
      ? "1 = 1"
      : `(eat.performedBy = ?${assignedEquipmentFilter})`;
    const data = await sequelize.query(
      `SELECT eat.id, eat.equipmentId, eat.serialNumber, eat.actionType, eat.actionDescription,
              eat.performedBy, eat.performedByName, eat.actionTimestamp, e.name AS equipmentName,
              e.equipmentId AS equipmentAssetId, e.category AS equipmentCategory,
              e.campus AS campus, e.laboratoryRoom AS laboratoryRoom, e.status AS equipmentStatus,
              u.name AS scannerName, u.role AS scannerRole, u.program AS scannerProgram,
              u.college AS scannerCollege,
              u.year AS scannerYear, u.section AS scannerSection,
              JSON_UNQUOTE(JSON_EXTRACT(eat.afterState, '$.maintenanceRequestId')) AS maintenanceRequestId,
              JSON_UNQUOTE(JSON_EXTRACT(eat.afterState, '$.category')) AS reportCategory
       FROM equipment_audit_trail eat
       INNER JOIN equipment e ON e.id = eat.equipmentId
       LEFT JOIN users u ON u.id = eat.performedBy
       WHERE eat.actionType IN (?, ?)
         AND ${actorFilter}
         AND e.campus IN (?)
       ORDER BY eat.actionTimestamp DESC
       LIMIT 200`,
      {
        replacements: [
          "equipment_scanned",
          "equipment_issue_reported",
          ...(!canReviewCampusActivity
            ? [authContext.userId, ...(assignedEquipmentIds.length ? [assignedEquipmentIds] : [])]
            : []),
          campusVariants
        ],
        type: QueryTypes.SELECT
      }
    );

    const equipmentRecordIds = [...new Set(data.map((event) => Number(event.equipmentId)).filter(Number.isInteger))];
    const [activeBorrowers, activeAssignments] = equipmentRecordIds.length
      ? await Promise.all([
          BorrowRecord.findAll({
            where: { equipmentRecordId: { [Op.in]: equipmentRecordIds }, status: "Borrowed" },
            attributes: ["equipmentRecordId", "borrowerName", "quantity"]
          }),
          EquipmentAssignment.findAll({
            where: { equipmentRecordId: { [Op.in]: equipmentRecordIds }, unassignedAt: null },
            attributes: ["equipmentRecordId", "facultyUserId"]
          })
        ])
      : [[], []];
    const assignmentUserIds = [...new Set(activeAssignments.map((assignment) => Number(assignment.facultyUserId)).filter(Number.isInteger))];
    const assignedUsers = assignmentUserIds.length
      ? await User.findAll({ where: { id: { [Op.in]: assignmentUserIds } }, attributes: ["id", "name"] })
      : [];
    const assignedUserNames = new Map(assignedUsers.map((user) => [Number(user.id), user.name]));
    const borrowersByEquipment = new Map();
    activeBorrowers.forEach((record) => {
      const key = Number(record.equipmentRecordId);
      const holders = borrowersByEquipment.get(key) || [];
      holders.push({ name: record.borrowerName, quantity: Number(record.quantity || 1) });
      borrowersByEquipment.set(key, holders);
    });
    const assigneesByEquipment = new Map();
    activeAssignments.forEach((assignment) => {
      const key = Number(assignment.equipmentRecordId);
      const assignees = assigneesByEquipment.get(key) || [];
      assignees.push(assignedUserNames.get(Number(assignment.facultyUserId)) || "Unknown faculty");
      assigneesByEquipment.set(key, assignees);
    });
    data.forEach((event) => {
      const key = Number(event.equipmentId);
      event.currentHolders = borrowersByEquipment.get(key) || [];
      event.assignedTo = assigneesByEquipment.get(key) || [];
    });

    return res.json({
      data,
      meta: { total: data.length, limit: 200 }
    });
  } catch (error) {
    console.error("[equipment] Failed to load equipment scan history:", error);
    return res.status(500).json({ error: "Failed to load equipment scan history." });
  }
};
