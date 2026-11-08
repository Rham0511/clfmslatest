/**
 * Usage Tracking Controller
 * Tracks equipment usage and links to attendance system
 */

import EquipmentUsageLog from '../models/equipmentUsageLogModel.js';
import { Equipment } from '../models/equipmentModel.js';
import { Op } from 'sequelize';

/**
 * Start equipment usage session
 * Called when student checks in and selects equipment
 */
async function startUsageSession(req, res) {
    try {
        const {
            attendanceId,
            equipmentId,
            serialNumber,
            userId,
            campusId,
            laboratoryId,
            sessionNotes
        } = req.body;
        
        // Validate required fields
        if (!userId || !campusId) {
            return res.status(400).json({
                success: false,
                message: 'User ID and campus ID are required'
            });
        }
        
        if (!equipmentId && !serialNumber) {
            return res.status(400).json({
                success: false,
                message: 'Equipment ID or serial number is required'
            });
        }
        
        // Check if equipment is available
        let equipment = null;
        if (equipmentId) {
            equipment = await Equipment.findByPk(equipmentId);
        } else if (serialNumber) {
            equipment = await Equipment.findOne({
                where: { serialNumber }
            });
        }
        
        if (!equipment) {
            return res.status(404).json({
                success: false,
                message: 'Equipment not found'
            });
        }
        
        // Check if equipment is already in use
        const activeSession = await EquipmentUsageLog.findOne({
            where: {
                equipmentId: equipment.id,
                usageEndTime: null
            }
        });
        
        if (activeSession) {
            return res.status(400).json({
                success: false,
                message: 'Equipment is currently in use by another user',
                activeSession
            });
        }
        
        // Create usage log
        const usageLog = await EquipmentUsageLog.create({
            attendanceId,
            equipmentId: equipment.id,
            serialNumber: equipment.serialNumber || serialNumber,
            userId,
            campusId,
            laboratoryId,
            usageStartTime: new Date(),
            sessionNotes
        });
        
        res.status(201).json({
            success: true,
            message: 'Usage session started',
            usageLog
        });
        
    } catch (error) {
        console.error('Error starting usage session:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to start usage session',
            error: error.message
        });
    }
}

/**
 * End equipment usage session
 * Called when student checks out
 */
async function endUsageSession(req, res) {
    try {
        const { id } = req.params;
        const { sessionNotes } = req.body;
        
        const usageLog = await EquipmentUsageLog.findByPk(id);
        
        if (!usageLog) {
            return res.status(404).json({
                success: false,
                message: 'Usage session not found'
            });
        }
        
        if (usageLog.usageEndTime) {
            return res.status(400).json({
                success: false,
                message: 'Usage session already ended'
            });
        }
        
        const endTime = new Date();
        const startTime = new Date(usageLog.usageStartTime);
        const durationMinutes = Math.max(1, Math.round((endTime - startTime) / 60000));
        
        await usageLog.update({
            usageEndTime: endTime,
            durationMinutes,
            sessionNotes: sessionNotes || usageLog.sessionNotes
        });
        
        res.json({
            success: true,
            message: 'Usage session ended',
            usageLog,
            durationMinutes
        });
        
    } catch (error) {
        console.error('Error ending usage session:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to end usage session',
            error: error.message
        });
    }
}

/**
 * Get equipment usage history
 */
async function getEquipmentUsageHistory(req, res) {
    try {
        const { equipmentId } = req.params;
        const { startDate, endDate, limit = 50 } = req.query;
        
        const whereClause = {};
        
        if (equipmentId) {
            // Check if it's a serial number or equipment ID
            if (isNaN(equipmentId)) {
                whereClause.serialNumber = equipmentId;
            } else {
                whereClause.equipmentId = equipmentId;
            }
        }
        
        if (startDate || endDate) {
            whereClause.usageStartTime = {};
            if (startDate) whereClause.usageStartTime[Op.gte] = startDate;
            if (endDate) whereClause.usageStartTime[Op.lte] = endDate;
        }
        
        const usageLogs = await EquipmentUsageLog.findAll({
            where: whereClause,
            order: [['usageStartTime', 'DESC']],
            limit: parseInt(limit)
        });
        
        res.json({
            success: true,
            usageHistory: usageLogs
        });
        
    } catch (error) {
        console.error('Error fetching usage history:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch usage history',
            error: error.message
        });
    }
}

/**
 * Get user usage history
 */
async function getUserUsageHistory(req, res) {
    try {
        const { userId } = req.params;
        const { startDate, endDate, limit = 50 } = req.query;
        
        const whereClause = { userId };
        
        if (startDate || endDate) {
            whereClause.usageStartTime = {};
            if (startDate) whereClause.usageStartTime[Op.gte] = startDate;
            if (endDate) whereClause.usageStartTime[Op.lte] = endDate;
        }
        
        const usageLogs = await EquipmentUsageLog.findAll({
            where: whereClause,
            order: [['usageStartTime', 'DESC']],
            limit: parseInt(limit)
        });
        
        res.json({
            success: true,
            usageHistory: usageLogs
        });
        
    } catch (error) {
        console.error('Error fetching user usage history:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch user usage history',
            error: error.message
        });
    }
}

/**
 * Get usage statistics
 */
async function getUsageStatistics(req, res) {
    try {
        const { campusId, laboratoryId, startDate, endDate } = req.query;
        
        const whereClause = {};
        if (campusId) whereClause.campusId = campusId;
        if (laboratoryId) whereClause.laboratoryId = laboratoryId;
        
        if (startDate || endDate) {
            whereClause.usageStartTime = {};
            if (startDate) whereClause.usageStartTime[Op.gte] = startDate;
            if (endDate) whereClause.usageStartTime[Op.lte] = endDate;
        }
        
        const usageLogs = await EquipmentUsageLog.findAll({
            where: whereClause,
            attributes: ['equipmentId', 'serialNumber', 'durationMinutes', 'usageStartTime']
        });
        
        // Calculate statistics
        const totalSessions = usageLogs.length;
        const completedSessions = usageLogs.filter(log => log.durationMinutes !== null).length;
        const activeSessions = totalSessions - completedSessions;
        
        const totalMinutes = usageLogs.reduce((sum, log) => sum + (log.durationMinutes || 0), 0);
        const averageDuration = completedSessions > 0 ? (totalMinutes / completedSessions).toFixed(2) : 0;
        
        // Equipment usage frequency
        const equipmentUsage = {};
        usageLogs.forEach(log => {
            const key = log.serialNumber || log.equipmentId;
            if (!equipmentUsage[key]) {
                equipmentUsage[key] = 0;
            }
            equipmentUsage[key]++;
        });
        
        const mostUsedEquipment = Object.entries(equipmentUsage)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10)
            .map(([key, count]) => ({ identifier: key, usageCount: count }));
        
        res.json({
            success: true,
            statistics: {
                totalSessions,
                completedSessions,
                activeSessions,
                totalMinutes,
                totalHours: (totalMinutes / 60).toFixed(2),
                averageDurationMinutes: averageDuration,
                mostUsedEquipment
            }
        });
        
    } catch (error) {
        console.error('Error fetching usage statistics:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch usage statistics',
            error: error.message
        });
    }
}

/**
 * Get currently active sessions
 */
async function getActiveSessions(req, res) {
    try {
        const { campusId, laboratoryId } = req.query;
        
        const whereClause = {
            usageEndTime: null
        };
        
        if (campusId) whereClause.campusId = campusId;
        if (laboratoryId) whereClause.laboratoryId = laboratoryId;
        
        const activeSessions = await EquipmentUsageLog.findAll({
            where: whereClause,
            order: [['usageStartTime', 'DESC']]
        });
        
        res.json({
            success: true,
            activeSessions
        });
        
    } catch (error) {
        console.error('Error fetching active sessions:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch active sessions',
            error: error.message
        });
    }
}

/**
 * Link usage log to attendance
 * Updates existing usage log with attendance ID
 */
async function linkToAttendance(req, res) {
    try {
        const { usageLogId, attendanceId } = req.body;
        
        if (!usageLogId || !attendanceId) {
            return res.status(400).json({
                success: false,
                message: 'Usage log ID and attendance ID are required'
            });
        }
        
        const usageLog = await EquipmentUsageLog.findByPk(usageLogId);
        
        if (!usageLog) {
            return res.status(404).json({
                success: false,
                message: 'Usage log not found'
            });
        }
        
        await usageLog.update({ attendanceId });
        
        res.json({
            success: true,
            message: 'Usage log linked to attendance',
            usageLog
        });
        
    } catch (error) {
        console.error('Error linking to attendance:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to link usage log to attendance',
            error: error.message
        });
    }
}

export {
    startUsageSession,
    endUsageSession,
    getEquipmentUsageHistory,
    getUserUsageHistory,
    getUsageStatistics,
    getActiveSessions,
    linkToAttendance
};
