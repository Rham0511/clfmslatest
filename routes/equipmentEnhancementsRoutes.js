/**
 * Equipment Enhancements API Routes
 * Consolidates all new equipment management features
 */

import express from 'express';
const router = express.Router();

const requireInventoryRole = (req, res, next) => {
    const role = String(req.session?.userRole || '').toLowerCase();
    if (!req.session?.userId) return res.status(401).json({ success: false, message: 'Authentication required.' });
    if (!['technician', 'laboratory technician', 'lab technician', 'admin', 'administrator'].includes(role)) {
        return res.status(403).json({ success: false, message: 'Only technicians and administrators can access weekly inventory.' });
    }
    next();
};

const requireTechnicianReportRole = (req, res, next) => {
    const role = String(req.session?.userRole || '').toLowerCase();
    if (!req.session?.userId) return res.status(401).json({ success: false, message: 'Authentication required.' });
    if (!['technician', 'laboratory technician', 'lab technician', 'admin', 'administrator'].includes(role)) {
        return res.status(403).json({ success: false, message: 'Only technicians and administrators can submit equipment reports.' });
    }
    next();
};

// Import controllers
import * as equipmentSetController from '../controllers/equipmentSetController.js';
import * as inventoryCheckController from '../controllers/inventoryCheckController.js';
import * as usageTrackingController from '../controllers/usageTrackingController.js';
import * as auditTrailController from '../controllers/auditTrailController.js';
import * as technicianReportController from '../controllers/technicianReportController.js';

// Middleware (assuming you have authentication middleware)
// const { authenticate, authorize } = require('../middleware/auth');

// ============================================================================
// EQUIPMENT SETS ROUTES
// ============================================================================

// Get all equipment sets
router.get('/sets', equipmentSetController.getAllPCSets);

// Get single equipment set with its equipment
router.get('/sets/:id', equipmentSetController.getPCSetDetails);

// Create new equipment set (admin/technician only)
router.post('/sets', equipmentSetController.createPCSet);

// Update equipment set (admin/technician only)
router.put('/sets/:id', equipmentSetController.updatePCSet);

// Delete equipment set (admin only - must be empty)
router.delete('/sets/:id', equipmentSetController.deletePCSet);

// Add equipment to set
router.post('/sets/:setId/equipment', equipmentSetController.addComponentToSet);

// Remove equipment from set
router.delete('/sets/:setId/equipment', equipmentSetController.removeComponentFromSet);

// ============================================================================
// INVENTORY CHECK ROUTES
// ============================================================================

// Get all inventory checks
router.get('/inventory-checks', inventoryCheckController.getAllChecks);
router.get('/inventory-checks/stats/summary', inventoryCheckController.getInventoryStats);

// Get single inventory check with items
router.get('/inventory-checks/:id', inventoryCheckController.getCheckById);

// Create new inventory check (technician/admin only)
router.post('/inventory-checks', requireInventoryRole, inventoryCheckController.createCheck);

// Add item to inventory check
router.post('/inventory-checks/:checkId/items', requireInventoryRole, inventoryCheckController.addCheckItem);

// Complete inventory check
router.post('/inventory-checks/:id/complete', requireInventoryRole, inventoryCheckController.completeCheck);

// Review inventory check (admin only)
router.post('/inventory-checks/:id/review', inventoryCheckController.reviewCheck);

// ============================================================================
// USAGE TRACKING ROUTES
// ============================================================================

// Start equipment usage session
router.post('/usage/start', usageTrackingController.startUsageSession);

// End equipment usage session
router.post('/usage/:id/end', usageTrackingController.endUsageSession);

// Get equipment usage history
router.get('/usage/equipment/:equipmentId', usageTrackingController.getEquipmentUsageHistory);

// Get user usage history
router.get('/usage/user/:userId', usageTrackingController.getUserUsageHistory);

// Get usage statistics
router.get('/usage/stats', usageTrackingController.getUsageStatistics);

// Get currently active sessions
router.get('/usage/active', usageTrackingController.getActiveSessions);

// Link usage log to attendance
router.post('/usage/link-attendance', usageTrackingController.linkToAttendance);

// ============================================================================
// AUDIT TRAIL ROUTES
// ============================================================================

// Get all audit trail entries (with filtering)
router.get('/audit', requireInventoryRole, auditTrailController.getAuditTrail);

// Get audit trail for specific equipment
router.get('/audit/equipment/:equipmentId', requireInventoryRole, auditTrailController.getEquipmentAuditTrail);

// Get audit trail by user
router.get('/audit/user/:userId', requireInventoryRole, auditTrailController.getUserAuditTrail);

// Get audit statistics
router.get('/audit/stats', requireInventoryRole, auditTrailController.getAuditStatistics);

// Get recent activity
router.get('/audit/recent', requireInventoryRole, auditTrailController.getRecentActivity);

// Search audit trail
router.get('/audit/search', requireInventoryRole, auditTrailController.searchAuditTrail);

// Export audit trail to CSV (admin only)
router.get('/audit/export/csv', requireInventoryRole, auditTrailController.exportAuditTrail);

// ============================================================================
// TECHNICIAN REPORT ROUTES
// ============================================================================

// Get all technician reports
router.get('/reports', requireTechnicianReportRole, technicianReportController.getAllReports);
router.get('/reports/mine', requireTechnicianReportRole, technicianReportController.getMyReports);

// Equipment lookup used by the technician report form
router.get('/reports/equipment-options', requireTechnicianReportRole, technicianReportController.getReportEquipmentOptions);

// Download a report in Word or PDF format (technician owner only)
router.get('/reports/:id/download', requireTechnicianReportRole, technicianReportController.downloadReport);

// Get single report
router.get('/reports/:id', requireTechnicianReportRole, technicianReportController.getReportById);

// Create new report (technicians only; enforced by the controller)
router.post('/reports', requireTechnicianReportRole, technicianReportController.createReport);

// Update a technician's own draft only
router.put('/reports/:id', requireTechnicianReportRole, technicianReportController.updateReport);

// Submit report for review
router.post('/reports/:id/submit', requireTechnicianReportRole, technicianReportController.submitReport);

// Legacy endpoint retained for compatibility; reports are read-only for admins
router.post('/reports/:id/review', requireTechnicianReportRole, technicianReportController.reviewReport);

// Delete the authenticated technician's own draft report only
router.delete('/reports/:id', technicianReportController.deleteReport);

// Get report statistics
router.get('/reports/stats/summary', requireTechnicianReportRole, technicianReportController.getReportStatistics);

// ============================================================================
// HEALTH CHECK
// ============================================================================

router.get('/health', (req, res) => {
    res.json({
        success: true,
        message: 'Equipment Enhancements API is running',
        version: '1.0.0',
        features: [
            'Serial Number Tracking',
            'Equipment Sets',
            'Usage Tracking',
            'Audit Trail',
            'Inventory Checks',
            'Technician Reports'
        ]
    });
});

export default router;
