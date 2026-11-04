import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { User } from "../models/userModel.js";
import {
  archiveRecord,
  deleteArchivedRecord,
  getArchivedRecordsRevision,
  listArchivedRecords,
  restoreArchivedRecordPayload,
  restoreArchivedRecordsPayload,
  restoreArchivedRecords,
  restoreArchivedRecord
} from "../controllers/archiveController.js";

const router = express.Router();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const adminRoles = new Set(["admin", "administrator", "superadmin", "centraladmin", "systemadmin"]);

async function requireAdminPage(req, res, next) {
  if (!req.session?.userId) return res.redirect("/login");

  try {
    const user = await User.findByPk(req.session.userId, { attributes: ["role"] });
    if (!user || !adminRoles.has(String(user.role || "").trim().toLowerCase().replace(/[_-]+/g, ""))) {
      return res.status(403).send("Forbidden: administrator access required.");
    }
    return next();
  } catch (error) {
    console.error("Failed to authorize archived records page:", error);
    return res.status(500).send("Unable to authorize archived records page.");
  }
}

router.get("/archived-records", requireAdminPage, (req, res) => {
  res.set("Cache-Control", "no-store");
  res.sendFile(path.join(__dirname, "../views/admin/archived-records.html"));
});
router.get("/api/archived-records/revision", getArchivedRecordsRevision);
router.get("/api/archived-records", listArchivedRecords);
router.delete("/api/archive/:archiveId", deleteArchivedRecord);
router.post("/api/archive/restore", restoreArchivedRecordPayload);
router.post("/api/archive/restore-selected", restoreArchivedRecordsPayload);
router.post("/api/archived-records/restore", restoreArchivedRecordPayload);
router.post("/api/archived-records/restore-selected", restoreArchivedRecordsPayload);
router.post("/api/archived-records/restore-by-id", restoreArchivedRecords);
router.post("/api/archived-records/:archiveId/restore", restoreArchivedRecord);
router.post("/api/archive/:archiveId/restore", restoreArchivedRecord);
router.post("/api/archive/computer-lab/:id", archiveRecord);
router.post(
  "/api/archive/:entityType(equipment|equipment-category|pc-set|laboratory-schedule|computer-lab|maintenance-report|technician-report|borrow-record|borrow-request)/:entityId",
  archiveRecord
);

export default router;
