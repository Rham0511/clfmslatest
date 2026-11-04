/**
 * Equipment Controller Enhancement Layer
 * 
 * This module provides enhanced equipment functions that integrate:
 * - Audit trail logging
 * - Serial number generation
 * - Equipment set management
 * 
 * Import these functions in your existing equipment controller to add
 * the new features without breaking existing code.
 */

import { Op } from 'sequelize';
import { Equipment } from '../models/equipmentModel.js';
import EquipmentSet from '../models/equipmentSetModel.js';
import EquipmentUsageLog from '../models/equipmentUsageLogModel.js';
import EquipmentAuditTrail from '../models/equipmentAuditTrailModel.js';
import { generateSerialNumber, generateSetId } from '../utils/serialNumberGenerator.js';
import {
    logEquipmentCreated,
    logEquipmentUpdated,
    logEquipmentDeleted,
    logStatusChanged,
    logConditionChanged,
    logLocationChanged
} from '../utils/auditLogger.js';

/**
 * Enhanced equipment creation with audit logging and serial number
 * 
 * Usage in your existing createEquipment function:
 * 
 * const { enhancedCreateEquipment } = require('./equipmentControllerEnhanced');
 * 
 * // After creating equipment in your existing code:
 * const enhancements = await enhancedCreateEquipment(equipment, req, {
 *   manufacturer: req.body.manufacturer,
 *   model: req.body.model,
 *   purchaseDate: req.body.purchaseDate,
 *   warrantyExpiry: req.body.warrantyExpiry,
 *   condition: req.body.condition || 'good',
 *   location: req.body.location,
 *   remarks: req.body.remarks
 * });
 */
async function enhancedCreateEquipment(equipment, req, additionalFields = {}) {
    try {
        const updates = {};
        
        // Generate serial number if not provided
        if (!equipment.serialNumber && !additionalFields.serialNumber) {
            const category = equipment.category || equipment.name;
            const campus = equipment.campus;
            updates.serialNumber = await generateSerialNumber(category, campus);
        } else if (additionalFields.serialNumber) {
            updates.serialNumber = additionalFields.serialNumber;
        }
        
        // Add additional fields if provided
        if (additionalFields.manufacturer) updates.manufacturer = additionalFields.manufacturer;
        if (additionalFields.model) updates.model = additionalFields.model;
        if (additionalFields.purchaseDate) updates.purchaseDate = additionalFields.purchaseDate;
        if (additionalFields.warrantyExpiry) updates.warrantyExpiry = additionalFields.warrantyExpiry;
        if (additionalFields.condition) updates.condition = additionalFields.condition;
        if (additionalFields.location) updates.location = additionalFields.location;
        if (additionalFields.remarks) updates.remarks = additionalFields.remarks;
        if (additionalFields.setId) updates.setId = additionalFields.setId;
        
        // Update equipment with enhancements
        if (Object.keys(updates).length > 0) {
            await equipment.update(updates);
        }
        
        // Log to audit trail
        await logEquipmentCreated(equipment, req.session || req.user, req);
        
        return {
            success: true,
            serialNumber: updates.serialNumber || equipment.serialNumber,
            updates
        };
        
    } catch (error) {
        console.error('Error in enhancedCreateEquipment:', error);
        // Don't throw - let the main function succeed even if enhancements fail
        return {
            success: false,
            error: error.message
        };
    }
}

/**
 * Enhanced equipment update with audit logging and change tracking
 * 
 * Usage in your existing updateEquipment function:
 * 
 * // Before updating equipment:
 * const equipmentBefore = equipment.toJSON();
 * 
 * // After updating equipment:
 * await enhancedUpdateEquipment(equipmentBefore, equipment, req);
 */
async function enhancedUpdateEquipment(equipmentBefore, equipmentAfter, req) {
    try {
        // Detect specific changes for targeted logging
        if (equipmentBefore.status !== equipmentAfter.status) {
            await logStatusChanged(
                equipmentAfter,
                equipmentBefore.status,
                equipmentAfter.status,
                req.session || req.user,
                req
            );
        }
        
        if (equipmentBefore.condition !== equipmentAfter.condition) {
            await logConditionChanged(
                equipmentAfter,
                equipmentBefore.condition,
                equipmentAfter.condition,
                req.session || req.user,
                req
            );
        }
        
        if (equipmentBefore.location !== equipmentAfter.location) {
            await logLocationChanged(
                equipmentAfter,
                equipmentBefore.location,
                equipmentAfter.location,
                req.session || req.user,
                req
            );
        }
        
        // General update log
        await logEquipmentUpdated(
            equipmentBefore,
            equipmentAfter,
            req.session || req.user,
            req
        );
        
        return { success: true };
        
    } catch (error) {
        console.error('Error in enhancedUpdateEquipment:', error);
        return {
            success: false,
            error: error.message
        };
    }
}

/**
 * Enhanced equipment deletion with audit logging
 * 
 * Usage in your existing deleteEquipment function:
 * 
 * // Before deleting equipment:
 * await enhancedDeleteEquipment(equipment, req);
 * // Then proceed with deletion
 */
async function enhancedDeleteEquipment(equipment, req) {
    try {
        await logEquipmentDeleted(equipment, req.session || req.user, req);
        return { success: true };
        
    } catch (error) {
        console.error('Error in enhancedDeleteEquipment:', error);
        return {
            success: false,
            error: error.message
        };
    }
}

/**
 * Get equipment with enhanced fields
 * Adds serial number and set information to equipment query results
 */
async function getEquipmentWithEnhancements(whereClause = {}, options = {}) {
    try {
        const equipment = await Equipment.findAll({
            where: whereClause,
            ...options,
            include: options.include || []
        });
        
        // Enhance with set information if equipment has setId
        const enhancedEquipment = await Promise.all(equipment.map(async (item) => {
            const itemJson = item.toJSON();
            
            if (itemJson.setId) {
                const set = await EquipmentSet.findOne({
                    where: { setId: itemJson.setId }
                });
                
                if (set) {
                    itemJson.set = {
                        id: set.id,
                        setId: set.setId,
                        setName: set.setName,
                        status: set.status
                    };
                }
            }
            
            return itemJson;
        }));
        
        return enhancedEquipment;
        
    } catch (error) {
        console.error('Error in getEquipmentWithEnhancements:', error);
        throw error;
    }
}

/**
 * Search equipment by serial number
 */
async function findEquipmentBySerialNumber(serialNumber) {
    try {
        const equipment = await Equipment.findOne({
            where: { serialNumber }
        });
        
        return equipment;
        
    } catch (error) {
        console.error('Error finding equipment by serial number:', error);
        return null;
    }
}

/**
 * Get equipment usage summary
 * Shows how much an equipment has been used
 */
async function getEquipmentUsageSummary(equipmentId) {
    try {
        const usageLogs = await EquipmentUsageLog.findAll({
            where: {
                equipmentId,
                durationMinutes: { [Op.not]: null }
            }
        });
        
        const totalMinutes = usageLogs.reduce((sum, log) => sum + (log.durationMinutes || 0), 0);
        const totalSessions = usageLogs.length;
        const averageMinutes = totalSessions > 0 ? totalMinutes / totalSessions : 0;
        
        return {
            totalSessions,
            totalMinutes,
            totalHours: (totalMinutes / 60).toFixed(2),
            averageSessionMinutes: averageMinutes.toFixed(2),
            averageSessionHours: (averageMinutes / 60).toFixed(2)
        };
        
    } catch (error) {
        console.error('Error getting equipment usage summary:', error);
        return null;
    }
}

/**
 * Check if equipment is currently in use
 */
async function isEquipmentInUse(equipmentId) {
    try {
        const activeSession = await EquipmentUsageLog.findOne({
            where: {
                equipmentId,
                usageEndTime: null
            }
        });
        
        return {
            inUse: !!activeSession,
            session: activeSession
        };
        
    } catch (error) {
        console.error('Error checking equipment usage:', error);
        return { inUse: false };
    }
}

/**
 * Get equipment maintenance history
 */
async function getEquipmentMaintenanceHistory(equipmentId, limit = 10) {
    try {
        const maintenanceHistory = await EquipmentAuditTrail.findAll({
            where: {
                equipmentId,
                actionType: ['maintenance_started', 'maintenance_completed']
            },
            order: [['actionTimestamp', 'DESC']],
            limit
        });
        
        return maintenanceHistory;
        
    } catch (error) {
        console.error('Error getting maintenance history:', error);
        return [];
    }
}

/**
 * Validate serial number uniqueness
 */
async function isSerialNumberAvailable(serialNumber, excludeEquipmentId = null) {
    try {
        const whereClause = { serialNumber };
        if (excludeEquipmentId) {
            whereClause.id = { [Op.ne]: excludeEquipmentId };
        }
        
        const existing = await Equipment.findOne({
            where: whereClause
        });
        
        return !existing;
        
    } catch (error) {
        console.error('Error checking serial number availability:', error);
        return false;
    }
}

/**
 * Bulk update equipment condition (for inventory checks)
 */
async function bulkUpdateEquipmentCondition(updates, performedBy, req) {
    try {
        const results = [];
        
        for (const update of updates) {
            const { equipmentId, condition, notes } = update;
            
            const equipment = await Equipment.findByPk(equipmentId);
            if (!equipment) {
                results.push({
                    equipmentId,
                    success: false,
                    error: 'Equipment not found'
                });
                continue;
            }
            
            const oldCondition = equipment.condition;
            await equipment.update({ 
                condition,
                remarks: notes || equipment.remarks
            });
            
            // Log condition change
            await logConditionChanged(
                equipment,
                oldCondition,
                condition,
                performedBy,
                req
            );
            
            results.push({
                equipmentId,
                success: true,
                oldCondition,
                newCondition: condition
            });
        }
        
        return results;
        
    } catch (error) {
        console.error('Error in bulk update:', error);
        throw error;
    }
}

export {
    enhancedCreateEquipment,
    enhancedUpdateEquipment,
    enhancedDeleteEquipment,
    getEquipmentWithEnhancements,
    findEquipmentBySerialNumber,
    getEquipmentUsageSummary,
    isEquipmentInUse,
    getEquipmentMaintenanceHistory,
    isSerialNumberAvailable,
    bulkUpdateEquipmentCondition
};
