/**
 * Serial Number Generator Utility
 * Generates unique serial numbers for equipment
 * Format: {CATEGORY}-{CAMPUS}-{YEAR}-{SEQUENCE}
 * Example: PC-CALAPAN-2026-00001
 */

import { Equipment } from '../models/equipmentModel.js';
import EquipmentSet from '../models/equipmentSetModel.js';
import { Op } from 'sequelize';

/**
 * Generate a unique serial number for equipment
 * @param {string} category - Equipment category (e.g., 'PC', 'MONITOR', 'KEYBOARD')
 * @param {string} campus - Campus name (e.g., 'CALAPAN', 'BONGABONG')
 * @param {string} customPrefix - Optional custom prefix instead of auto-generated
 * @returns {Promise<string>} Generated serial number
 */
async function generateSerialNumber(category, campus, customPrefix = null) {
    try {
        // Normalize inputs
        const categoryCode = category.toUpperCase().replace(/\s+/g, '-').substring(0, 10);
        const campusCode = campus.toUpperCase().replace(/\s+/g, '-').substring(0, 15);
        const currentYear = new Date().getFullYear();
        
        // Build prefix
        const prefix = customPrefix || `${categoryCode}-${campusCode}-${currentYear}`;
        
        // Find the highest sequence number for this prefix
        const lastEquipment = await Equipment.findOne({
            where: {
                serialNumber: {
                    [Op.like]: `${prefix}-%`
                }
            },
            order: [['serialNumber', 'DESC']],
            attributes: ['serialNumber']
        });
        
        let nextSequence = 1;
        
        if (lastEquipment && lastEquipment.serialNumber) {
            // Extract sequence number from last serial
            const parts = lastEquipment.serialNumber.split('-');
            const lastSequence = parseInt(parts[parts.length - 1]) || 0;
            nextSequence = lastSequence + 1;
        }
        
        // Format sequence with leading zeros (5 digits)
        const sequenceStr = String(nextSequence).padStart(5, '0');
        
        // Build final serial number
        const serialNumber = `${prefix}-${sequenceStr}`;
        
        return serialNumber;
    } catch (error) {
        console.error('Error generating serial number:', error);
        throw new Error('Failed to generate serial number');
    }
}

/**
 * Validate serial number format
 * @param {string} serialNumber - Serial number to validate
 * @returns {boolean} True if valid format
 */
function validateSerialNumber(serialNumber) {
    if (!serialNumber || typeof serialNumber !== 'string') {
        return false;
    }
    
    // Basic format check: at least 3 parts separated by dashes
    const parts = serialNumber.split('-');
    if (parts.length < 3) {
        return false;
    }
    
    // Last part should be numeric
    const lastPart = parts[parts.length - 1];
    if (!/^\d+$/.test(lastPart)) {
        return false;
    }
    
    return true;
}

/**
 * Check if serial number already exists
 * @param {string} serialNumber - Serial number to check
 * @param {number} excludeEquipmentId - Optional equipment ID to exclude from check
 * @returns {Promise<boolean>} True if exists
 */
async function serialNumberExists(serialNumber, excludeEquipmentId = null) {
    try {
        const whereClause = {
            serialNumber: serialNumber
        };
        
        if (excludeEquipmentId) {
            whereClause.id = {
                [Op.ne]: excludeEquipmentId
            };
        }
        
        const count = await Equipment.count({
            where: whereClause
        });
        
        return count > 0;
    } catch (error) {
        console.error('Error checking serial number existence:', error);
        return false;
    }
}

/**
 * Generate set ID for equipment sets
 * Format: {TYPE}-SET-{CAMPUS}-{SEQUENCE}
 * Example: PC-SET-CALAPAN-001
 */
async function generateSetId(type, campus) {
    try {
        const typeCode = type.toUpperCase().replace(/\s+/g, '-').substring(0, 10);
        const campusCode = campus.toUpperCase().replace(/\s+/g, '-').substring(0, 15);
        
        const prefix = `${typeCode}-SET-${campusCode}`;
        
        // Find highest sequence for this prefix
        const lastSet = await EquipmentSet.findOne({
            where: {
                setId: {
                    [Op.like]: `${prefix}-%`
                }
            },
            order: [['setId', 'DESC']],
            attributes: ['setId']
        });
        
        let nextSequence = 1;
        
        if (lastSet && lastSet.setId) {
            const parts = lastSet.setId.split('-');
            const lastSequence = parseInt(parts[parts.length - 1]) || 0;
            nextSequence = lastSequence + 1;
        }
        
        const sequenceStr = String(nextSequence).padStart(3, '0');
        const setId = `${prefix}-${sequenceStr}`;
        
        return setId;
    } catch (error) {
        console.error('Error generating set ID:', error);
        throw new Error('Failed to generate set ID');
    }
}

export {
    generateSerialNumber,
    validateSerialNumber,
    serialNumberExists,
    generateSetId
};
