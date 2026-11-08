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

import express from "express";
import {
  createMaintenanceRequest,
  getAllMaintenanceRequests,
  getMaintenanceRequestById,
  getMaintenanceHistoryForEquipment,
  updateMaintenanceStatus,
  assignTechnician,
  deleteMaintenanceRequest,
  getMaintenanceSummary,
  getTechnicianActivities,
  getStudentMaintenanceContextRoute,
  cancelStudentMaintenanceRequest
} from "../controllers/maintenanceController.js";

const router = express.Router();

// POST - Create new maintenance request
router.post("/api/maintenance", createMaintenanceRequest);

// GET - Retrieve all maintenance requests with optional filters
router.get("/api/maintenance", getAllMaintenanceRequests);
router.get("/api/maintenance/equipment/:equipmentId/history", getMaintenanceHistoryForEquipment);

// GET - Retrieve the student lab context and equipment list for damage reporting
router.get("/api/student/maintenance-context", getStudentMaintenanceContextRoute);

// GET - Retrieve specific maintenance request by ID
router.get("/api/maintenance/:id", getMaintenanceRequestById);

// PUT - Update maintenance request status
router.put("/api/maintenance/:id/status", updateMaintenanceStatus);
router.post("/api/maintenance/:id/cancel", cancelStudentMaintenanceRequest);

// PUT - Assign technician to maintenance request
router.put("/api/maintenance/:id/assign", assignTechnician);

// GET - Maintenance summary for dashboard
router.get("/api/maintenance-summary", getMaintenanceSummary);

// GET - Technician activity metrics for admin dashboard
router.get("/api/technician-activities", getTechnicianActivities);

// DELETE - Delete maintenance request
router.delete("/api/maintenance/:id", deleteMaintenanceRequest);

export default router;
