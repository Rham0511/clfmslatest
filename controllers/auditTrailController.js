/**
 * Audit Trail Controller
 * Views and queries equipment audit logs
 */

import EquipmentAuditTrail from '../models/equipmentAuditTrailModel.js';
import { Equipment } from '../models/equipmentModel.js';
import { User } from '../models/userModel.js';
import { Op } from 'sequelize';

function getAuditStateObject(state) {
    if (!state) return {};
    if (typeof state === 'object') return state;
    if (typeof state !== 'string') return {};
    try {
        const parsed = JSON.parse(state);
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (error) {
        console.error('Failed to parse equipment audit state:', error);
        return {};
    }
}

/**
 * Get all audit trail entries with filtering
 */
async function getAuditTrail(req, res) {
    try {
        const {
            equipmentId,
            serialNumber,
            actionType,
            performedBy,
            campusId,
            startDate,
            endDate,
            limit = 100,
            offset = 0
        } = req.query;
        
        const whereClause = {};
        
        if (equipmentId) whereClause.equipmentId = equipmentId;
        if (serialNumber) whereClause.serialNumber = serialNumber;
        if (actionType) whereClause.actionType = actionType;
        if (performedBy) whereClause.performedBy = performedBy;
        if (campusId) whereClause.campusId = campusId;
        
        if (startDate || endDate) {
            whereClause.actionTimestamp = {};
            if (startDate) whereClause.actionTimestamp[Op.gte] = startDate;
            if (endDate) whereClause.actionTimestamp[Op.lte] = endDate;
        }
        
        const { count, rows } = await EquipmentAuditTrail.findAndCountAll({
            where: whereClause,
            order: [['actionTimestamp', 'DESC']],
            limit: parseInt(limit),
            offset: parseInt(offset)
        });
        
        const equipmentIds = [...new Set(rows.map((row) => row.equipmentId).filter(Boolean))];
        const equipmentRecords = equipmentIds.length
            ? await Equipment.findAll({
                where: { id: { [Op.in]: equipmentIds } },
                attributes: ['id', 'equipmentId', 'name']
            })
            : [];
        const performerIds = [...new Set(rows.map((row) => Number(row.performedBy)).filter(Number.isInteger))];
        const performers = performerIds.length
            ? await User.findAll({
                where: { id: { [Op.in]: performerIds } },
                attributes: ['id', 'college', 'program', 'year', 'section']
            })
            : [];
        const equipmentById = new Map(equipmentRecords.map((equipment) => [equipment.id, equipment]));
        const performerById = new Map(performers.map((performer) => [Number(performer.id), performer]));
        const trail = rows.map((row) => {
            const equipment = equipmentById.get(row.equipmentId);
            const performer = performerById.get(Number(row.performedBy));
            const state = getAuditStateObject(
                row.actionType === 'accountability_removed' ? row.beforeState : row.afterState
            );
            const accountabilityFaculty = state.accountableFaculty || null;
            return {
                ...row.toJSON(),
                equipmentCode: equipment?.equipmentId || null,
                equipmentName: equipment?.name || null,
                accountabilityFacultyName: accountabilityFaculty?.name || null,
                accountabilityFacultyEmail: accountabilityFaculty?.email || null,
                performedByCollege: performer?.college || null,
                performedByProgram: performer?.program || null,
                performedByYear: performer?.year || null,
                performedBySection: performer?.section || null
            };
        });

        res.json({
            success: true,
            auditTrail: trail,
            pagination: {
                total: count,
                limit: parseInt(limit),
                offset: parseInt(offset),
                pages: Math.ceil(count / parseInt(limit))
            }
        });
        
    } catch (error) {
        console.error('Error fetching audit trail:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch audit trail',
            error: error.message
        });
    }
}

/**
 * Get audit trail for specific equipment
 */
async function getEquipmentAuditTrail(req, res) {
    try {
        const { equipmentId } = req.params;
        const { limit = 50 } = req.query;
        
        // Check if it's serial number or equipment ID
        const whereClause = {};
        if (isNaN(equipmentId)) {
            whereClause.serialNumber = equipmentId;
        } else {
            whereClause.equipmentId = equipmentId;
        }
        
        const auditTrail = await EquipmentAuditTrail.findAll({
            where: whereClause,
            order: [['actionTimestamp', 'DESC']],
            limit: parseInt(limit)
        });
        
        res.json({
            success: true,
            auditTrail
        });
        
    } catch (error) {
        console.error('Error fetching equipment audit trail:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch equipment audit trail',
            error: error.message
        });
    }
}

/**
 * Get audit trail by user
 */
async function getUserAuditTrail(req, res) {
    try {
        const { userId } = req.params;
        const { limit = 50, startDate, endDate } = req.query;
        
        const whereClause = { performedBy: userId };
        
        if (startDate || endDate) {
            whereClause.actionTimestamp = {};
            if (startDate) whereClause.actionTimestamp[Op.gte] = startDate;
            if (endDate) whereClause.actionTimestamp[Op.lte] = endDate;
        }
        
        const auditTrail = await EquipmentAuditTrail.findAll({
            where: whereClause,
            order: [['actionTimestamp', 'DESC']],
            limit: parseInt(limit)
        });
        
        res.json({
            success: true,
            auditTrail
        });
        
    } catch (error) {
        console.error('Error fetching user audit trail:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch user audit trail',
            error: error.message
        });
    }
}

/**
 * Get audit statistics
 */
async function getAuditStatistics(req, res) {
    try {
        const { campusId, startDate, endDate } = req.query;
        
        const whereClause = {};
        if (campusId) whereClause.campusId = campusId;
        
        if (startDate || endDate) {
            whereClause.actionTimestamp = {};
            if (startDate) whereClause.actionTimestamp[Op.gte] = startDate;
            if (endDate) whereClause.actionTimestamp[Op.lte] = endDate;
        }
        
        const auditEntries = await EquipmentAuditTrail.findAll({
            where: whereClause,
            attributes: ['actionType', 'performedBy', 'userRole', 'actionTimestamp']
        });
        
        // Calculate statistics
        const totalActions = auditEntries.length;
        
        // Actions by type
        const actionsByType = {};
        auditEntries.forEach(entry => {
            if (!actionsByType[entry.actionType]) {
                actionsByType[entry.actionType] = 0;
            }
            actionsByType[entry.actionType]++;
        });
        
        // Actions by user
        const actionsByUser = {};
        auditEntries.forEach(entry => {
            if (!actionsByUser[entry.performedBy]) {
                actionsByUser[entry.performedBy] = 0;
            }
            actionsByUser[entry.performedBy]++;
        });
        
        // Actions by role
        const actionsByRole = {};
        auditEntries.forEach(entry => {
            const role = entry.userRole || 'unknown';
            if (!actionsByRole[role]) {
                actionsByRole[role] = 0;
            }
            actionsByRole[role]++;
        });
        
        // Most active users
        const mostActiveUsers = Object.entries(actionsByUser)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10)
            .map(([userId, count]) => ({ userId, actionCount: count }));
        
        // Actions over time (daily)
        const actionsByDate = {};
        auditEntries.forEach(entry => {
            const date = new Date(entry.actionTimestamp).toISOString().split('T')[0];
            if (!actionsByDate[date]) {
                actionsByDate[date] = 0;
            }
            actionsByDate[date]++;
        });
        
        res.json({
            success: true,
            statistics: {
                totalActions,
                actionsByType,
                actionsByRole,
                mostActiveUsers,
                actionsByDate
            }
        });
        
    } catch (error) {
        console.error('Error fetching audit statistics:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch audit statistics',
            error: error.message
        });
    }
}

/**
 * Get recent activity
 */
async function getRecentActivity(req, res) {
    try {
        const { campusId, limit = 20 } = req.query;
        
        const whereClause = {};
        if (campusId) whereClause.campusId = campusId;
        
        const recentActivity = await EquipmentAuditTrail.findAll({
            where: whereClause,
            order: [['actionTimestamp', 'DESC']],
            limit: parseInt(limit)
        });
        
        res.json({
            success: true,
            recentActivity
        });
        
    } catch (error) {
        console.error('Error fetching recent activity:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch recent activity',
            error: error.message
        });
    }
}

/**
 * Search audit trail
 */
async function searchAuditTrail(req, res) {
    try {
        const { query, limit = 50 } = req.query;
        
        if (!query || query.trim().length < 3) {
            return res.status(400).json({
                success: false,
                message: 'Search query must be at least 3 characters'
            });
        }
        
        const auditEntries = await EquipmentAuditTrail.findAll({
            where: {
                [Op.or]: [
                    { serialNumber: { [Op.like]: `%${query}%` } },
                    { actionDescription: { [Op.like]: `%${query}%` } },
                    { performedByName: { [Op.like]: `%${query}%` } }
                ]
            },
            order: [['actionTimestamp', 'DESC']],
            limit: parseInt(limit)
        });
        
        res.json({
            success: true,
            results: auditEntries,
            count: auditEntries.length
        });
        
    } catch (error) {
        console.error('Error searching audit trail:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to search audit trail',
            error: error.message
        });
    }
}

/**
 * Export audit trail to CSV
 */
async function exportAuditTrail(req, res) {
    try {
        const { campusId, startDate, endDate } = req.query;
        
        const whereClause = {};
        if (campusId) whereClause.campusId = campusId;
        
        if (startDate || endDate) {
            whereClause.actionTimestamp = {};
            if (startDate) whereClause.actionTimestamp[Op.gte] = startDate;
            if (endDate) whereClause.actionTimestamp[Op.lte] = endDate;
        }
        
        const auditEntries = await EquipmentAuditTrail.findAll({
            where: whereClause,
            order: [['actionTimestamp', 'DESC']]
        });
        
        // Generate CSV
        const headers = [
            'Timestamp',
            'Equipment ID',
            'Serial Number',
            'Action Type',
            'Description',
            'Performed By',
            'User Role',
            'Campus ID',
            'IP Address'
        ];
        
        let csv = headers.join(',') + '\n';
        
        auditEntries.forEach(entry => {
            const row = [
                entry.actionTimestamp,
                entry.equipmentId || '',
                entry.serialNumber || '',
                entry.actionType,
                `"${(entry.actionDescription || '').replace(/"/g, '""')}"`,
                entry.performedByName || entry.performedBy,
                entry.userRole || '',
                entry.campusId || '',
                entry.ipAddress || ''
            ];
            csv += row.join(',') + '\n';
        });
        
        // Set headers for file download
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename=audit_trail_${Date.now()}.csv`);
        res.send(csv);
        
    } catch (error) {
        console.error('Error exporting audit trail:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to export audit trail',
            error: error.message
        });
    }
}

export {
    getAuditTrail,
    getEquipmentAuditTrail,
    getUserAuditTrail,
    getAuditStatistics,
    getRecentActivity,
    searchAuditTrail,
    exportAuditTrail
};
